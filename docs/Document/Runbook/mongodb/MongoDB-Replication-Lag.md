# MongoDB Replication Lag — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P2–P1 depending on lag and application impact  
**Applies to:** MongoDB production replica sets

**Purpose:** Identify and safely resolve excessive replication lag between a MongoDB Secondary and the Primary.

---

## 1. Trigger

Use this runbook when:

- Monitoring reports replication lag.
- A Secondary is significantly behind the Primary.
- Applications using Secondary reads return stale data.
- A Secondary cannot keep up with writes.
- `rs.printSecondaryReplicationInfo()` shows increasing lag.

> ⚠️ **Do not immediately restart or resync a Secondary. First identify why it cannot keep up.**

---

## 2. Quick Decision Flow

```text
Replication Lag
      │
      ▼
Check Replica Set Health
      │
      ▼
Measure Lag
      │
      ▼
Identify Cause
      │
 ┌────┼─────────┬──────────┬──────────┐
 ▼    ▼         ▼          ▼          ▼
CPU  Disk I/O  Network   Heavy       Oplog
/RAM            /DNS      Workload    Window
 │    │          │          │           │
 └────┴──────────┴─────────┴───────────┘
                    │
                    ▼
                Fix Cause
                    │
                    ▼
             Monitor Recovery
                    │
                    ▼
             Verify SECONDARY
                    │
                    ▼
              Verify Lag
```

---

## 3. Step 1 — Check Replica Set Health

Run from a healthy member:

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

Identify the lagging Secondary.

---

## 4. Step 2 — Measure Replication Lag

Run:

```bash
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

Review:

```text
syncedTo
timeDiff
```

Example:

```text
source: legacy-db-1
syncedTo: ...
0 secs (0 hrs) behind the primary
```

A useful operational classification:

```text
0–10 seconds       Normal / monitor
10–60 seconds      Investigate if unexpected
1–5 minutes        High — investigate
>5 minutes         Critical depending on workload
Continuously rising Critical
```

> Set thresholds according to your application's RPO/RPO-like freshness requirements and monitoring policy. Do not treat these example values as universal MongoDB limits.

---

## 5. Step 3 — Check the Lagging Member

SSH to the affected Secondary.

Check MongoDB:

```bash
systemctl status mongod
```

Check server resources:

```bash
uptime
free -h
df -h
```

Check CPU:

```bash
top
```

Check disk I/O:

```bash
iostat -xz 1 5
```

If `iostat` is unavailable, install/use your approved system monitoring tool.

---

## 6. Step 4 — Check MongoDB Logs

```bash
tail -200 /var/log/mongodb/mongod.log
```

Search for relevant errors:

```bash
grep -Ei \
'repl|replication|oplog|rollback|WiredTiger|error|slow|timeout' \
/var/log/mongodb/mongod.log | tail -100
```

Look for:

```text
replication errors
oplog errors
WiredTiger errors
slow operations
network timeout
rollback
initial sync
disk errors
```

---

## 7. Step 5 — Check CPU and Memory

Check memory:

```bash
free -h
```

Check memory consumers:

```bash
ps aux --sort=-%mem | head -15
```

Check CPU:

```bash
top
```

Common symptoms:

```text
High CPU
High memory pressure
OOM events
CPU throttling
```

If MongoDB is OOM-killed, use:

```text
MongoDB-OOM.md
```

---

## 8. Step 6 — Check Disk and I/O

Check disk:

```bash
df -h
```

Check inode usage:

```bash
df -i
```

Check MongoDB filesystem:

```bash
df -h /var/lib/mongodb
```

Check I/O:

```bash
iostat -xz 1 5
```

If disk usage is critical, use:

```text
MongoDB-Disk-Full.md
```

A Secondary with slow storage may remain healthy but continuously fall behind the Primary.

---

## 9. Step 7 — Check Network Connectivity

The Secondary must continuously receive replication traffic.

Test Primary connectivity:

```bash
nc -vz <primary-host> 27017
```

Check DNS:

```bash
getent hosts <primary-host>
```

Check routes:

```bash
ip route
```

Check packet/network errors:

```bash
ip -s link
```

Check firewall:

```bash
iptables -L -n
```

If using UFW:

```bash
ufw status
```

Look for:

```text
Packet loss
High latency
Connection resets
Network errors
DNS failures
Firewall blocks
```

---

## 10. Step 8 — Check Primary Write Load

Replication lag can increase when the Primary is generating writes faster than the Secondary can apply them.

Check Primary resource usage:

```bash
free -h
```

```bash
top
```

```bash
iostat -xz 1 5
```

Check MongoDB activity:

```javascript
db.currentOp({
  active: true
})
```

Look for:

```text
High write volume
Long-running operations
Heavy aggregations
Large index builds
Resource contention
```

---

## 11. Step 9 — Check for Slow Secondary Operations

A Secondary may fall behind because it cannot apply operations quickly enough.

Check logs:

```bash
grep -Ei 'slow|oplog|replication' \
/var/log/mongodb/mongod.log | tail -100
```

Check:

```text
CPU
Memory
Disk latency
Disk throughput
WiredTiger activity
```

If storage latency is consistently high, investigate the underlying disk/volume.

---

## 12. Step 10 — Check Oplog Window

From a healthy member:

```bash
mongosh --quiet --eval 'rs.printReplicationInfo()'
```

Review:

```text
configured oplog size
oplog time range
oplog first event time
oplog last event time
```

The oplog window must be large enough for a Secondary to catch up.

If the lagging Secondary falls outside the available oplog history, it may require an initial sync.

> Do not resize or recreate the oplog during an incident without understanding the operational impact and using an approved MongoDB procedure.

---

## 13. Step 11 — Check Secondary State

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health, m.optimeDate))'
```

Expected:

```text
PRIMARY     health=1
SECONDARY   health=1
SECONDARY   health=1
```

If the member is:

```text
STARTUP2
```

use:

```text
MongoDB-Initial-Sync-Failure.md
```

If the member is:

```text
DOWN
```

use:

```text
MongoDB-ReplicaSet-Member-Down.md
```

---

## 14. Step 12 — Fix the Root Cause

Typical fixes:

### High CPU

- Identify the workload.
- Reduce abnormal query/write load.
- Increase server capacity if required.

### High Memory

- Identify memory consumers.
- Resolve OOM/resource pressure.
- Review MongoDB/application workload.

### Slow Disk

- Investigate storage latency.
- Expand or move to appropriate storage.
- Remove unrelated disk pressure.

### Network Problem

- Fix connectivity.
- Fix DNS.
- Fix firewall/routing.

### High Primary Write Volume

- Investigate application traffic.
- Reduce abnormal write workload if appropriate.
- Increase Secondary capacity if required.

---

## 15. Step 13 — Monitor Recovery

Run:

```bash
watch -n5 \
'mongosh --quiet --eval "rs.printSecondaryReplicationInfo()"'
```

Or:

```bash
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

Expected behavior:

```text
Replication lag
      ↓
Decreasing
      ↓
Near normal
      ↓
Stable
```

The important signal is that lag is **decreasing**, not just that the Secondary is running.

---

## 16. Step 14 — Verify Replica Set

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

Then:

```bash
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

Confirm:

```text
[ ] Secondary is healthy
[ ] Lag is decreasing
[ ] Lag is within the operational threshold
[ ] Replication remains stable
```

---

## 17. Step 15 — Verify Application

If the application uses Secondary reads, verify that stale reads are no longer occurring.

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Look for:

```text
MongoServerSelectionError
MongoNetworkError
timeout
read preference errors
```

Check application health:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

---

## 18. Do NOT Do These Things

### ❌ Don't immediately restart the Secondary

Restarting may temporarily hide the symptom while the underlying problem remains.

### ❌ Don't immediately resync the Secondary

First determine whether it can catch up normally.

### ❌ Don't remove the Secondary from the replica set blindly

A healthy but lagging Secondary still provides redundancy.

### ❌ Don't increase oplog size blindly

First understand the current oplog window and workload.

### ❌ Don't assume every lag problem is a network problem

Disk I/O, CPU, memory, and write workload are common causes.

### ❌ Don't ignore increasing lag

A Secondary that is continuously falling behind may eventually require a full initial sync.

---

## 19. Quick Reference

```bash
# Replica set health
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'

# Replication lag
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'

# Oplog window
mongosh --quiet --eval 'rs.printReplicationInfo()'

# Detailed member status
mongosh --quiet --eval 'rs.status().members'

# MongoDB status
systemctl status mongod

# MongoDB logs
tail -200 /var/log/mongodb/mongod.log

# Replication-related logs
grep -Ei 'repl|replication|oplog|rollback|WiredTiger|error|slow|timeout' \
/var/log/mongodb/mongod.log | tail -100

# Memory
free -h

# CPU
top

# Disk
df -h
df -i

# Disk I/O
iostat -xz 1 5

# Network
nc -vz <primary-host> 27017
getent hosts <primary-host>
ip route
ip -s link

# Firewall
iptables -L -n

# Active operations
mongosh --quiet --eval 'db.currentOp({active:true})'
```

---

## 20. Recovery Criteria

- [ ] Primary is healthy.
- [ ] All expected replica-set members are present.
- [ ] Lagging member is `SECONDARY`.
- [ ] `health = 1`.
- [ ] Replication lag is decreasing.
- [ ] Replication lag is within the operational threshold.
- [ ] Oplog window is sufficient.
- [ ] No continuing disk/CPU/memory/network errors.
- [ ] No recurring replication errors.
- [ ] Application is healthy.
- [ ] Replica-set redundancy is restored.

---

## 21. Escalation

Escalate to **Database/SRE** when:

- Replication lag continues increasing.
- Secondary cannot catch up.
- Oplog window may be insufficient.
- Secondary repeatedly falls behind.
- Multiple members are lagging.
- Replica-set redundancy is at risk.

Escalate to **Infrastructure/SRE** when:

- Disk I/O is slow.
- Network connectivity is unstable.
- Server CPU/memory capacity is insufficient.
- Storage performance is degraded.

Escalate to the **Application Owner** when:

- Write volume suddenly increased.
- A deployment caused abnormal database load.
- Heavy queries or index builds are affecting replication.
- Application traffic is causing sustained Primary overload.

---

## Golden Rule

```text
Replication Lag
      ↓
DON'T RESYNC FIRST
      ↓
Measure Lag
      ↓
Check Secondary Health
      ↓
Check CPU / Memory / Disk / Network
      ↓
Check Primary Write Load
      ↓
Check Oplog Window
      ↓
FIX ROOT CAUSE
      ↓
Monitor Lag Decreasing
      ↓
Verify SECONDARY
      ↓
Verify Application
```

> **Replication lag = first find why the Secondary cannot keep up. If lag is increasing continuously, treat it as an active production risk.**
