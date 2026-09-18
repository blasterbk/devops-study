# Redis High CPU Utilization & Slowlog Triage — Runbook

**Service:** Redis Cache / In-Memory Store  
**Owner:** DevOps / SRE / Application Engineers  
**Severity:** P1–P2 (Redis main thread blocked, p99 latency spike, connection timeouts)  
**Applies to:** Redis standalone, Redis Sentinel, Redis Cluster (v6.x, v7.x)  

**Purpose:** Rapidly diagnose and mitigate Redis 100% CPU utilization incidents caused by blocking $O(N)$ operations (`KEYS *`, `HGETALL`, `SMEMBERS`), unindexed key patterns, slow Lua scripts, or hot keys.

---

## 1. Trigger & Alert Symptoms

Use this runbook when:
- Redis container/host CPU utilization reaches **100%** on the main thread core.
- Applications experience Redis command timeouts (`Read timed out after 5000ms`).
- Prometheus alerts trigger: `RedisHighCPUUtilization` or `RedisSlowlogLengthSpike`.
- Redis command execution latency jumps from $< 1\text{ms}$ to $> 500\text{ms}$.

---

## 2. Quick Decision Flow

```text
               Redis 100% CPU / High Latency
                            │
                            ▼
              Query SLOWLOG and Running Commands
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  Dangerous O(N)       Hot Key or Mega     Slow Lua Script /
     Commands             Hash/Set          Forking Overhead
 (KEYS *, HGETALL)    (BigKey Access)       (EVAL / BGSAVE)
        │                   │                   │
        ▼                   ▼                   ▼
 Kill / Ban Bad      Migrate to SCAN     Optimize Scripts /
 Commands            or Shard Key        Tune Forking
 (Section 4)         (Section 5)         (Section 6)
```

---

## 3. Step 1 — Real-Time Diagnostic Commands

Connect to Redis CLI:
```bash
redis-cli -h <REDIS_HOST> -p <REDIS_PORT> -a <REDIS_PASSWORD>
```

### 1. Check Top Slow Queries via `SLOWLOG`
```text
127.0.0.1:6379> SLOWLOG GET 10
```
Example Output:
```text
1) 1) (integer) 42                # Slowlog Entry ID
   2) (integer) 1718901234        # Timestamp
   3) (integer) 152400            # Execution duration in MICROSECONDS (152ms!)
   4) 1) "KEYS"                   # Offending Command
      2) "user:session:*"         # Offending Arguments
```

### 2. Sample Currently Executing Command
If Redis is continuously frozen:
```bash
# Sample live commands (run for 5 seconds only!)
redis-cli -h <REDIS_HOST> -a <REDIS_PASSWORD> MONITOR | head -n 50
```

### 3. Check Real-Time CPU & Operations per Second
```text
127.0.0.1:6379> INFO cpu
127.0.0.1:6379> INFO stats
```
Look at `instantaneous_ops_per_sec`.

---

## 4. Remediation: Blocking $O(N)$ Commands

### Most Common Dangerous Commands & Replacements:

| Dangerous Command | Why it Blocks Redis | Safe Alternative |
|---|---|---|
| `KEYS *` | Scans entire keyspace synchronously ($O(N)$) | `SCAN 0 MATCH pattern COUNT 100` |
| `HGETALL large_hash` | Transmits millions of hash fields | `HSCAN large_hash 0` or `HMGET` |
| `SMEMBERS large_set` | Returns entire set at once | `SSCAN large_set 0` |
| `FLUSHALL` / `DEL large_key` | Synchronously frees memory on main thread | `FLUSHALL ASYNC` / `UNLINK large_key` |

---

## 5. Remediation: BigKeys & HotKeys Audit

### 1. Identify BigKeys (Run against Secondary/Replica if possible):
```bash
redis-cli -h <REDIS_HOST> -a <REDIS_PASSWORD> --bigkeys
```
Example Output:
```text
[00.00%] Biggest hash found 'app:cart:global' has 854,231 fields
```

### 2. Identify HotKeys (Requires `maxmemory-policy` with LFU):
```bash
redis-cli -h <REDIS_HOST> -a <REDIS_PASSWORD> --hotkeys
```

### Fix:
- Refactor application logic to use hashed sub-keys (e.g. `app:cart:<user_id>`).
- Add local application in-memory cache (e.g. Guava / Go-Cache / Node LRU) for read-heavy hot keys.

---

## 6. Remediation: Slow Lua Scripts & Background Forking

### Scenario A: Long-running Lua Script (`EVAL` / `EVALSHA`)
If a custom Lua script is stuck in an infinite loop:
```text
127.0.0.1:6379> SCRIPT KILL
```
*Note: If the Lua script already performed write operations, `SCRIPT KILL` will fail; you must run `SHUTDOWN NOSAVE` to prevent state corruption.*

---

### Scenario B: High Fork Latency During `BGSAVE` or `AOF` Rewrite
Check last fork duration:
```text
127.0.0.1:6379> INFO stats
# Look for: latest_fork_usec (e.g., 500000 = 500ms stop-the-world freeze)
```

**Fix on Linux Host:**
1. Disable Transparent Huge Pages (THP) on the host machine:
   ```bash
   echo never > /sys/kernel/mm/transparent_hugepage/enabled
   ```
2. Enable `vm.overcommit_memory = 1`:
   ```bash
   sysctl vm.overcommit_memory=1
   ```

---

## 7. Prevention: Command Renaming / Disabling

In `redis.conf`, permanently disable dangerous commands in production:
```text
rename-command KEYS ""
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command CONFIG ""
```

---

## 8. Hardening & Alerting

1. **Tune Slowlog Threshold:**
   Log any query taking longer than 10 milliseconds:
   ```text
   CONFIG SET slowlog-log-slower-than 10000
   CONFIG SET slowlog-max-len 1000
   ```
2. **Prometheus Alert Rule for High Redis CPU:**
   ```yaml
   - alert: RedisMainThreadCPUSaturated
     expr: rate(redis_cpu_user_seconds_total[1m]) + rate(redis_cpu_sys_seconds_total[1m]) > 0.90
     for: 3m
     labels:
       severity: critical
     annotations:
       summary: "Redis {{ $labels.instance }} CPU is > 90% saturated"
   ```
