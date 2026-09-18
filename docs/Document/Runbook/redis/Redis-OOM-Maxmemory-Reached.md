# Redis OOM & Maxmemory Reached — Runbook

**Service:** Redis Cache / In-Memory Store  
**Owner:** DevOps / SRE / Database Team  
**Severity:** P1 (Write commands failing, cache rejection, application errors)  
**Applies to:** Redis standalone, Redis Sentinel, Redis Cluster (v6.x, v7.x)  

**Purpose:** Diagnose and resolve Redis memory saturation (`maxmemory`), configure appropriate eviction policies (`allkeys-lru` / `volatile-lru`), resolve high memory fragmentation, and clean up runaway keys.

---

## 1. Trigger & Alert Symptoms

Use this runbook when:
- Applications throw `OOM command not allowed when used memory > 'maxmemory'`.
- Redis pod/container is terminated with exit code `137` (`OOMKilled`).
- Prometheus alerts trigger:
  - `RedisMemoryUsageHigh` ($> 90\%$ of `maxmemory`).
  - `RedisMemoryFragmentationRatioHigh` ($> 1.5$).
  - `RedisEvictedKeysSpike`.
- Write latency increases due to real-time eviction overhead.

---

## 2. Quick Decision Flow

```text
               Redis Memory Saturated / OOM
                            │
                            ▼
              Inspect `INFO memory` via CLI
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
 Used Memory >=      High Fragmentation      Linux OOM Killer
    Maxmemory        (ratio > 1.5)           (Exit code 137)
        │                   │                   │
        ▼                   ▼                   ▼
 Change Eviction     Enable Active           Tune Redis Maxmemory
 Policy or Expire    Defrag / Purge          vs Kubernetes Cgroup
 Runaway Keys        Jemalloc Cache          Limits
 (Section 4)         (Section 5)             (Section 6)
```

---

## 3. Step 1 — Connect & Inspect Memory Metrics

Connect to Redis instance:
```bash
redis-cli -h <REDIS_HOST> -p <REDIS_PORT> -a <REDIS_PASSWORD>
```

Run Memory Diagnostics:
```text
127.0.0.1:6379> INFO memory
```

Key fields to check:
```text
used_memory: 3221225472          # Actual data in bytes (~3 GB)
used_memory_human: 3.00G
used_memory_rss: 4831838208      # Memory allocated by OS (~4.5 GB)
used_memory_peak_human: 3.20G
maxmemory: 3221225472            # Max configured threshold (3 GB)
maxmemory_policy: noeviction     # CRITICAL: If 'noeviction', writes fail on 100% full
mem_fragmentation_ratio: 1.50    # RSS / used_memory (> 1.5 = high fragmentation)
```

---

## 4. Immediate Remediation: Clearing Write Outages

### Scenario A: `maxmemory_policy` is `noeviction`
If policy is `noeviction`, Redis will reject all writes when full instead of evicting older keys.

1. **Switch to LRU (Least Recently Used) Eviction dynamically:**
   ```text
   CONFIG SET maxmemory-policy allkeys-lru
   ```
   *Alternative for cache with TTL:* `CONFIG SET maxmemory-policy volatile-lru`

2. **Increase `maxmemory` limit on the fly (if host RAM permits):**
   ```text
   CONFIG SET maxmemory 4gb
   ```

---

### Scenario B: Finding & Deleting Runaway Keys without Blocking Redis
> ⚠️ **NEVER run `KEYS *` or `FLUSHALL` on a production Redis instance! It blocks the single-threaded engine.**

1. **Find Top Key Types & Memory Hogs:**
   ```bash
   redis-cli -h <REDIS_HOST> -a <REDIS_PASSWORD> --bigkeys
   redis-cli -h <REDIS_HOST> -a <REDIS_PASSWORD> --memkeys
   ```

2. **Asynchronously Delete Large Keys (Redis 4.0+):**
   ```text
   UNLINK runaway_key_name
   ```

3. **Check Keys with Missing TTL (Expiry):**
   ```text
   TTL problematic_key
   ```
   *If `-1`, key never expires. Set an emergency TTL:*
   ```text
   EXPIRE problematic_key 3600
   ```

---

## 5. Remediation: High Memory Fragmentation Ratio ($> 1.5$)

When fragmentation ratio is high, Redis holds memory in jemalloc arenas that the OS cannot reclaim.

### 1. Enable Active Memory Defragmentation dynamically:
```text
CONFIG SET activedefrag yes
CONFIG SET active-defrag-ignore-bytes 100mb
CONFIG SET active-defrag-threshold-lower 10
CONFIG SET active-defrag-threshold-upper 30
CONFIG SET active-defrag-cycle-min 5
CONFIG SET active-defrag-cycle-max 50
```

### 2. Manual Memory Purge (Jemalloc):
```text
MEMORY PURGE
```

---

## 6. Fixing Kubernetes Pod OOMKills (`Exit Code 137`)

### Root Cause:
If Redis `maxmemory` is set to `4Gi`, but Kubernetes container limit is also `4Gi`, Redis RSS memory + background save (`BGSAVE` fork / replication buffer) will exceed `4Gi` and the Linux kernel OOM killer terminates the pod.

### Best Practice Formula:
$$\text{Redis maxmemory} \le 75\% \times \text{Container Memory Limit}$$

Example Kubernetes Deployment snippet:
```yaml
spec:
  containers:
  - name: redis
    image: redis:7.2-alpine
    command: ["redis-server", "--maxmemory", "3gb", "--maxmemory-policy", "allkeys-lru"]
    resources:
      requests:
        memory: "4Gi"
        cpu: "1000m"
      limits:
        memory: "4Gi"
        cpu: "2000m"
```

---

## 7. Verification & Monitoring

1. **Verify Write Operations are Restored:**
   ```text
   SET __healthcheck__ 1 EX 10
   GET __healthcheck__
   ```
2. **Prometheus Alert Rules:**
   ```yaml
   - alert: RedisMaxMemoryApproaching
     expr: (redis_memory_used_bytes / redis_memory_max_bytes) * 100 > 85
     for: 5m
     labels:
       severity: warning
     annotations:
       summary: "Redis instance {{ $labels.instance }} memory usage is at {{ $value }}%"
   ```
