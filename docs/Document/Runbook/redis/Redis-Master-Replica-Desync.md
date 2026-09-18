# Redis Master-Replica Desync & Replication Lag — Runbook

**Service:** Redis High Availability (Replication / Sentinel)  
**Owner:** DevOps / SRE / Database Team  
**Severity:** P1–P2 (Stale read replica data, infinite full sync loops, master I/O saturation)  
**Applies to:** Redis Sentinel, Redis Cluster, Standalone Master-Replica topologies  

**Purpose:** Diagnose and resolve replication lag, broken replication buffers (`client-output-buffer-limit replica`), continuous PSYNC/FULLRESYNC loops, and Sentinel split-brain failover conditions.

---

## 1. Trigger & Alert Symptoms

Use this runbook when:
- Read replicas return stale data or fail health checks.
- Prometheus alert triggers: `RedisReplicationLagHigh` ($> 10\text{s}$) or `RedisConnectedSlavesMismatch`.
- Master logs report:
  ```text
  Client id=123 scheduled to be closed ASAP for overcoming of output buffer limits.
  SYNC and PSYNC failed with replica 10.0.1.5:6379
  ```
- Replica logs report:
  ```text
  MASTER <-> REPLICA sync: Error reading from master: Resource temporarily unavailable
  Connecting to MASTER 10.0.1.4:6379...
  MASTER <-> REPLICA sync: Receiving 4000 MB data from master...
  ```

---

## 2. Quick Decision Flow

```text
               Redis Replication Failure
                          │
                          ▼
            Inspect `INFO replication` on Master & Replica
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
  Replica State       Replication Lag    Continuous Full
  is `down` or        Offset Growing     Sync Loop (PSYNC)
  `connecting`            (Lag)           (Buffer Overflow)
        │                 │                 │
        ▼                 ▼                 ▼
 Check Network /     Check Replica CPU   Increase repl-backlog
 Auth Password       & Master Write Rate & output buffer limit
 (Section 4)         (Section 5)         (Section 6)
```

---

## 3. Step 1 — Check Replication Status

### 1. On Redis Master:
```bash
redis-cli -h <MASTER_HOST> -a <REDIS_PASSWORD> INFO replication
```
Example Output:
```text
role:master
connected_slaves:2
slave0:ip=10.0.1.5,port=6379,state=online,offset=198472910,lag=0
slave1:ip=10.0.1.6,port=6379,state=online,offset=198472910,lag=12   # Lagging!
master_repl_offset:198472910
repl_backlog_active:1
repl_backlog_size:104857600       # 100MB backlog
```

### 2. On Redis Replica:
```bash
redis-cli -h <REPLICA_HOST> -a <REDIS_PASSWORD> INFO replication
```
Example Output:
```text
role:slave
master_host:10.0.1.4
master_port:6379
master_link_status:down           # Link broken!
master_last_io_seconds_ago:45
master_sync_in_progress:1
```

---

## 4. Remediation: Replica Link Down / Authentication Mismatch

### Common Causes:
1. `masterauth` parameter missing or password updated on master without updating replica.
2. Network firewall / Kubernetes NetworkPolicy blocking port 6379.

### Fix on Replica:
```text
127.0.0.1:6379> CONFIG SET masterauth "current_secure_password"
127.0.0.1:6379> REPLICAOF 10.0.1.4 6379
```

---

## 5. Remediation: Infinite Full Sync Loop & Replication Buffer Overflow

### The Root Cause Mechanism:
1. When a replica disconnects briefly, it tries partial resynchronization (`PSYNC`).
2. If the master's `repl-backlog-size` is too small to hold all missed writes, the master falls back to a **Full Resynchronization** (`FULLRESYNC`), dumping a multi-gigabyte RDB file.
3. During transfer, the master buffers new writes in the `replica output buffer`.
4. If write volume exceeds `client-output-buffer-limit replica`, the master forcefully kills the replica connection, restarting the full sync loop endlessly!

### Immediate Fix on Master:

#### 1. Increase Replication Backlog Size:
```text
CONFIG SET repl-backlog-size 512mb
```

#### 2. Increase Replica Output Buffer Limits:
```text
# Syntax: client-output-buffer-limit replica <hard_limit> <soft_limit> <soft_seconds>
CONFIG SET client-output-buffer-limit "replica 1024mb 512mb 120"
```

#### 3. Enable Diskless Replication:
Avoids writing multi-GB snapshot files to disk before sending over the network:
```text
CONFIG SET repl-diskless-sync yes
CONFIG SET repl-diskless-sync-delay 5
```

---

## 6. Remediation: High Replication Lag Due to Replica Saturation

If the replica connection is alive but `lag` is continuously increasing:

1. **Check if Replica is running heavy Read Queries:**
   Replicas executing `KEYS *` or huge `HGETALL` commands block the main thread and cannot apply replication stream packets from master.
   ```bash
   redis-cli -h <REPLICA_HOST> -a <REDIS_PASSWORD> SLOWLOG GET 5
   ```
2. **Ensure `replica-read-only yes`:**
   Ensure no rogue application is writing directly to the replica:
   ```text
   CONFIG SET replica-read-only yes
   ```

---

## 7. Manual Failover Procedure (Sentinel / Standalone)

If the Master node is failing and automated failover did not execute:

### Using Redis Sentinel:
```bash
redis-cli -h <SENTINEL_HOST> -p 26379 SENTINEL FAILOVER mymaster
```

### Manual Promotion on Replica (Emergency Standalone):
```text
# 1. On the chosen healthy replica:
127.0.0.1:6379> REPLICAOF NO ONE

# 2. On remaining secondary replicas, point to the new promoted master:
127.0.0.1:6379> REPLICAOF <NEW_MASTER_IP> 6379
```

---

## 8. Verification & Metrics

1. **Verify Offsets Match:**
   Check that `master_repl_offset` on master and `master_repl_offset` on replica are identical or within `< 1000` bytes.
2. **Prometheus Alert Rules:**
   ```yaml
   - alert: RedisReplicationLagHigh
     expr: redis_connected_slave_lag_seconds > 30
     for: 2m
     labels:
       severity: critical
     annotations:
       summary: "Redis replica {{ $labels.instance }} is lagging behind master by {{ $value }}s"
   ```
