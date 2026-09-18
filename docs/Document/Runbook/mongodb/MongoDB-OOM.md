# MongoDB OOM — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on application impact  
**Applies to:** MongoDB production replica sets

**Purpose:** Safely identify and recover a MongoDB server when it runs out of memory or is killed by the Linux OOM killer.

---

## 1. Trigger

Use this runbook when:

- `mongod` is killed unexpectedly.
- `systemctl status mongod` shows a crash/restart.
- Kernel logs show `Out of memory` or `oom-kill`.
- MongoDB memory usage is continuously increasing.
- Applications report MongoDB connection failures during memory pressure.

> ⚠️ **Do not blindly increase or decrease MongoDB cache settings. First identify what is consuming memory.**

---

## 2. Quick Decision Flow

```text
MongoDB OOM
     │
     ▼
Check replica-set health
     │
     ▼
Check system memory + OOM logs
     │
     ▼
Identify memory consumer
     │
 ┌───┼──────────┬──────────┐
 ▼   ▼          ▼          ▼
MongoDB  Index/Query   Other     Node
Cache    Workload      Process   Capacity
 │       │             │         │
 └───────┴─────────────┴─────────┘
                 │
                 ▼
           Reduce pressure
                 │
                 ▼
          Start/restore MongoDB
                 │
                 ▼
          Verify replica set
                 │
                 ▼
          Verify application
```

---

## 3. Step 1 — Check MongoDB Status

```bash
systemctl status mongod
```

Check service logs:

```bash
journalctl -u mongod --since "30 minutes ago" --no-pager
```

MongoDB log:

```bash
tail -100 /var/log/mongodb/mongod.log
```

Look for:

- `Out of memory`
- `oom-kill`
- `Killed`
- `FATAL`
- repeated restarts

---

## 4. Step 2 — Check System Memory

```bash
free -h
```

Check memory pressure:

```bash
vmstat 1 5
```

Check top memory consumers:

```bash
ps aux --sort=-%mem | head -15
```

If `sysstat` is available:

```bash
sar -r 1 5
```

---

## 5. Step 3 — Confirm Linux OOM Killer

Check kernel messages:

```bash
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20
```

Or:

```bash
journalctl -k --since "30 minutes ago" | \
grep -Ei 'oom|out of memory|killed process'
```

Typical evidence:

```text
Out of memory: Killed process ... mongod
```

If MongoDB was killed by the kernel, continue with this runbook.

---

## 6. Step 4 — Check Replica Set FIRST

If another member is healthy:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

Expected:

```text
PRIMARY     1
SECONDARY   1
SECONDARY   1
```

Identify whether the affected node is:

```text
PRIMARY
SECONDARY
```

> If the affected node is a **SECONDARY**, recovery is normally safer because another member can continue serving the replica set.

---

## 7. Step 5 — Identify the Memory Consumer

Check the biggest processes:

```bash
ps aux --sort=-%mem | head -15
```

Check MongoDB:

```bash
pgrep -a mongod
```

Check MongoDB process memory:

```bash
ps -o pid,ppid,%mem,rss,vsz,cmd -C mongod
```

Check overall memory:

```bash
free -h
```

Determine whether memory pressure is caused by:

- MongoDB
- Index build
- Large query/workload
- Application process
- Container
- Backup process
- Another system process

---

## 8. Section A — MongoDB Memory

Check MongoDB configuration:

```bash
grep -n -A10 'wiredTiger' /etc/mongod.conf
```

If `cacheSizeGB` is configured, record its value.

> **Do not change `cacheSizeGB` during an active incident unless the value is known to be incorrect and the change is approved.**

MongoDB's WiredTiger cache is only one part of MongoDB's total memory usage.

---

## 9. Section B — Check for Heavy Queries / Index Builds

Check current operations:

```javascript
db.currentOp({
  active: true
})
```

Look for:

- Large aggregation
- Large sort
- Long-running query
- Index build
- Unexpected workload

Check recent MongoDB logs:

```bash
grep -Ei 'slow|COLLSCAN|index' \
/var/log/mongodb/mongod.log | tail -50
```

If a known application workload is causing the memory spike, involve the application/database owner before making query or index changes.

---

## 10. Section C — Check Other Processes

```bash
ps aux --sort=-%mem | head -20
```

Common unexpected consumers:

```text
Backup process
Java/Node application
Monitoring agent
Log processor
Docker/container workload
Another database
```

Stop or limit a non-critical process only through the approved operational procedure.

---

## 11. Section D — Check Node Capacity

Check total memory:

```bash
free -h
```

Check node/VM size:

```bash
lscpu
```

Check swap:

```bash
swapon --show
```

Check:

```bash
cat /proc/meminfo | head -20
```

If the server consistently runs out of memory, consider:

- Increasing server RAM.
- Reducing workload.
- Correcting oversized memory requests.
- Moving other workloads.
- Reviewing MongoDB cache configuration.
- Reviewing query/index workload.

> Adding RAM is often safer than aggressively limiting MongoDB cache when the workload genuinely requires more memory.

---

## 12. Step 5 — Reduce Memory Pressure

Preferred order:

```text
1. Stop/limit non-critical memory consumers
2. Reduce abnormal application workload
3. Stop problematic maintenance/query workload if approved
4. Increase server memory if capacity is insufficient
5. Review MongoDB configuration
```

Do not kill `mongod` manually just to reduce memory unless the recovery procedure requires it.

---

## 13. Step 6 — Start MongoDB If It Was Killed

First confirm memory pressure is under control:

```bash
free -h
```

Then:

```bash
systemctl start mongod
```

Check:

```bash
systemctl status mongod
```

Expected:

```text
Active: active (running)
```

Check logs:

```bash
tail -100 /var/log/mongodb/mongod.log
```

---

## 14. Step 7 — Verify Replica Set

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

Expected:

```text
PRIMARY     1
SECONDARY   1
SECONDARY   1
```

Check replication:

```javascript
rs.printSecondaryReplicationInfo()
```

The recovered node may temporarily show:

```text
STARTUP2
RECOVERING
```

It should eventually return to:

```text
SECONDARY
```

---

## 15. Step 8 — Monitor Memory After Recovery

```bash
watch -n5 'free -h'
```

Monitor MongoDB process:

```bash
watch -n5 'ps -o pid,%mem,rss,vsz,cmd -C mongod'
```

Watch MongoDB logs:

```bash
tail -f /var/log/mongodb/mongod.log
```

Confirm memory is stable and the OOM condition does not repeat.

---

## 16. Step 9 — Verify Application

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Look for continuing:

- `MongoServerSelectionError`
- `connection refused`
- `timeout`
- `MongoNetworkError`

Check application health:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

---

## 17. Do NOT Do These Things

### ❌ Don't blindly change `cacheSizeGB`

First determine the actual memory consumer.

### ❌ Don't immediately restart MongoDB repeatedly

If the kernel keeps killing `mongod`, repeated restarts will not solve the root cause.

### ❌ Don't kill random processes

Identify the process and its purpose first.

### ❌ Don't run large index builds during memory pressure

Index builds can increase resource consumption.

### ❌ Don't terminate production queries blindly

Confirm the query and business impact before stopping it.

### ❌ Don't disable security/monitoring services to free memory

Use approved capacity or workload-management procedures.

---

## 18. Quick Reference

```bash
# MongoDB status
systemctl status mongod

# MongoDB service logs
journalctl -u mongod --since "30 minutes ago"

# MongoDB log
tail -100 /var/log/mongodb/mongod.log

# Memory
free -h

# Memory pressure
vmstat 1 5

# Top memory processes
ps aux --sort=-%mem | head -15

# MongoDB process memory
ps -o pid,ppid,%mem,rss,vsz,cmd -C mongod

# OOM killer
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20

# Kernel OOM logs
journalctl -k --since "30 minutes ago" | \
grep -Ei 'oom|out of memory|killed process'

# Swap
swapon --show

# MongoDB configuration
grep -n -A10 'wiredTiger' /etc/mongod.conf

# Replica set
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'

# Replication lag
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'

# Start MongoDB
systemctl start mongod
```

---

## 19. Recovery Criteria

- [ ] `mongod` is `active (running)`.
- [ ] No continuing Linux OOM events.
- [ ] Memory usage is stable.
- [ ] No unexpected process is consuming memory.
- [ ] Replica set has a healthy Primary.
- [ ] Recovered member is `SECONDARY` or otherwise healthy.
- [ ] Replication lag is acceptable.
- [ ] Applications can connect to MongoDB.
- [ ] Application health check succeeds.
- [ ] Root cause of memory exhaustion is identified.

---

## 20. Escalation

Escalate to **Database/SRE** when:

- MongoDB repeatedly gets OOM-killed.
- Memory usage continues growing.
- WiredTiger/query/index workload is suspected.
- Replica-set health is degraded.

Escalate to **Infrastructure/SRE** when:

- Server RAM is insufficient.
- Multiple system processes cause memory exhaustion.
- Node-level memory pressure is recurring.

Escalate to the **Application Owner** when:

- A query or aggregation caused abnormal memory usage.
- An application deployment caused a memory spike.
- Connection/query volume increased unexpectedly.

---

## Golden Rule

```text
MongoDB OOM
     ↓
DON'T BLINDLY CHANGE CACHE
     ↓
Check Replica Set
     ↓
Check free -h + OOM logs
     ↓
Find Memory Consumer
     ↓
Reduce Memory Pressure
     ↓
Start/Recover MongoDB
     ↓
Verify Replica Set
     ↓
Monitor Memory
     ↓
Verify Application
```

> **MongoDB OOM = first determine who consumed the memory, then reduce the pressure and verify the replica set before closing the incident.**
