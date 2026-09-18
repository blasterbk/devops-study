# MongoDB Secondary Not Syncing — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P2–P1 depending on replica-set redundancy  
**Applies to:** MongoDB production replica sets

**Purpose:** Diagnose and recover a MongoDB Secondary that is healthy/running but is not progressing with replication from the Primary.

---

## 1. Trigger

Use this runbook when:

- Secondary replication lag keeps increasing.
- Secondary `optime` is not progressing.
- `rs.printSecondaryReplicationInfo()` shows stale data.
- Monitoring reports a Secondary not syncing.
- Secondary remains `SECONDARY` but does not catch up.
- Applications using Secondary reads may return stale data.

> ⚠️ **Do not immediately rebuild the Secondary. First identify why replication is not progressing.**

---

## 2. Quick Decision Flow

```text
Secondary Not Syncing
        │
        ▼
Check Replica Set Health
        │
        ▼
Check Secondary State
        │
        ▼
Measure Replication Lag
        │
        ▼
Is Optime Progressing?
        │
   ┌────┴────┐
   ▼         ▼
  YES        NO
   │         │
   ▼         ▼
Monitor   Check Cause
             │
      ┌──────┼────────┬─────────┐
      ▼      ▼        ▼         ▼
   Network  Disk     CPU/RAM   Oplog
   /DNS     /I/O     /Load     /Source
      │      │        │         │
      └──────┴────────┴─────────┘
                    │
                    ▼
                Fix Cause
                    │
                    ▼
             Monitor Sync
                    │
                    ▼
              SECONDARY
                    │
                    ▼
             Verify Replication
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

Identify the affected Secondary.

---

## 4. Step 2 — Check Secondary State

Run:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health, m.optimeDate))'
```

Common states:

```text
SECONDARY
STARTUP2
RECOVERING
DOWN
UNKNOWN
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

If it is:

```text
SECONDARY
```

but its optime is not progressing, continue this runbook.

---

## 5. Step 3 — Measure Replication Lag

Run:

```bash
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

Check:

```text
syncedTo
timeDiff
```

Then run again after a few minutes.

```bash
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

Determine whether:

```text
Lag decreasing   → Secondary is catching up
Lag stable       → Investigate if unexpected
Lag increasing   → Secondary cannot keep up
Optime unchanged → Replication may be stalled
```

> The most important signal is whether the Secondary's replication progress is moving forward.

---

## 6. Step 4 — Check MongoDB Service

SSH to the Secondary:

```bash
systemctl status mongod
```

Check process:

```bash
pgrep -a mongod
```

Check recent logs:

```bash
journalctl -u mongod --since "30 minutes ago" --no-pager
```

MongoDB log:

```bash
tail -200 /var/log/mongodb/mongod.log
```

Search replication errors:

```bash
grep -Ei \
'repl|replication|oplog|sync|rollback|WiredTiger|error|timeout' \
/var/log/mongodb/mongod.log | tail -100
```

---

## 7. Step 5 — Check Network Connectivity

The Secondary must be able to communicate with the Primary.

Test:

```bash
nc -vz <primary-host> 27017
```

Check DNS:

```bash
getent hosts <primary-host>
```

Check route:

```bash
ip route
```

Check interface errors:

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
Connection timeout
Connection reset
Packet loss
DNS failure
Firewall block
Routing problem
```

---

## 8. Step 6 — Check Disk Space

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

Check disk I/O:

```bash
iostat -xz 1 5
```

Look for:

```text
High await
High utilization
Low available space
I/O errors
```

If disk is full, use:

```text
MongoDB-Disk-Full.md
```

---

## 9. Step 7 — Check CPU and Memory

Check memory:

```bash
free -h
```

Check CPU:

```bash
top
```

Check top memory processes:

```bash
ps aux --sort=-%mem | head -15
```

Check OOM events:

```bash
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20
```

If MongoDB was OOM-killed, use:

```text
MongoDB-OOM.md
```

---

## 10. Step 8 — Check Primary Write Load

The Secondary may be working correctly but unable to keep up with the Primary's write volume.

On the Primary:

```bash
top
```

```bash
iostat -xz 1 5
```

Check active operations:

```javascript
db.currentOp({
  active: true
})
```

Look for:

```text
High write volume
Long-running operations
Large index builds
Heavy aggregations
CPU pressure
Disk pressure
```

If write volume suddenly increased after an application deployment, involve the Application Owner.

---

## 11. Step 9 — Check Oplog Window

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

The Secondary must remain within the available oplog history to catch up normally.

If the Secondary is too far behind and the required oplog entries are no longer available, it may require initial sync.

Use:

```text
MongoDB-Initial-Sync-Failure.md
```

---

## 12. Step 10 — Check Sync Source

From a healthy member:

```bash
mongosh --quiet --eval 'rs.status().members'
```

Check:

```text
PRIMARY
SECONDARY
health
stateStr
optimeDate
```

Confirm that the Primary or another suitable sync source is healthy and reachable.

Do not blindly force a sync source.

MongoDB normally selects an appropriate source automatically.

---

## 13. Step 11 — Check Replication Progress

Run:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.optimeDate))'
```

Run the command again after a few minutes.

Example:

```text
Before:
secondary optimeDate = 10:00:00

After:
secondary optimeDate = 10:02:30
```

If the value is moving forward, replication is progressing.

If the value remains unchanged, continue investigating:

```text
Network
Disk I/O
CPU
Memory
Sync source
Oplog
MongoDB errors
```

---

## 14. Step 12 — Fix the Root Cause

### Network problem

Fix:

```text
DNS
Routing
Firewall
Packet loss
Connectivity
```

### Disk problem

Fix:

```text
Disk capacity
Disk I/O
Filesystem errors
```

### CPU / Memory problem

Fix:

```text
Resource pressure
Unexpected workload
OOM
Insufficient capacity
```

### Primary write overload

Investigate:

```text
Application traffic
Large write workload
Heavy queries
Index builds
Application deployment
```

### Oplog problem

If the required history is no longer available, the Secondary may require a new initial sync.

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

Expected:

```text
Lag increasing
      ↓
Lag stable
      ↓
Lag decreasing
      ↓
Normal
```

Do not close the incident immediately after the Secondary starts syncing.

Confirm that replication remains stable.

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
[ ] Optime is progressing
[ ] Lag is decreasing
[ ] Lag is within the operational threshold
[ ] No recurring replication errors
```

---

## 17. Step 15 — Verify Application

If the application uses Secondary reads, verify that stale-read problems are resolved.

Check:

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

## 18. Step 16 — If Secondary Still Does Not Sync

If the Secondary remains stuck after the root cause is fixed:

```text
1. Check MongoDB logs again.
2. Confirm Primary connectivity.
3. Confirm disk and I/O health.
4. Confirm oplog window.
5. Confirm sync source availability.
6. Confirm authentication/TLS configuration.
7. Check whether the Secondary needs initial sync.
```

If initial sync is required, use:

```text
MongoDB-Initial-Sync-Failure.md
```

If the member is no longer reachable, use:

```text
MongoDB-ReplicaSet-Member-Down.md
```

---

## 19. Do NOT Do These Things

### ❌ Don't immediately resync the Secondary

First determine why it is not syncing.

### ❌ Don't immediately restart MongoDB

A restart may temporarily hide the problem.

### ❌ Don't force a sync source blindly

MongoDB normally chooses a suitable source.

### ❌ Don't increase the oplog blindly

First understand the current oplog window and workload.

### ❌ Don't remove the Secondary

A lagging Secondary still provides redundancy.

### ❌ Don't ignore increasing lag

A continuously falling-behind Secondary can eventually require a full initial sync.

---

## 20. Quick Reference

```bash
# Replica set health
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'

# Replication lag
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'

# Oplog window
mongosh --quiet --eval 'rs.printReplicationInfo()'

# Member progress
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.optimeDate))'

# MongoDB status
systemctl status mongod

# MongoDB logs
tail -200 /var/log/mongodb/mongod.log

# Replication errors
grep -Ei \
'repl|replication|oplog|sync|rollback|WiredTiger|error|timeout' \
/var/log/mongodb/mongod.log | tail -100

# Disk
df -h
df -i

# Disk I/O
iostat -xz 1 5

# Memory
free -h

# CPU
top

# OOM
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20

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

## 21. Recovery Criteria

- [ ] Primary is healthy.
- [ ] Secondary is `SECONDARY`.
- [ ] Secondary `health = 1`.
- [ ] Secondary optime is progressing.
- [ ] Replication lag is decreasing.
- [ ] Lag is within the operational threshold.
- [ ] Oplog window is sufficient.
- [ ] No continuing disk/CPU/memory/network errors.
- [ ] No recurring replication errors.
- [ ] Application is healthy.
- [ ] Replica-set redundancy is restored.

---

## 22. Escalation

Escalate to **Database/SRE** when:

- Secondary remains unsynchronized.
- Lag continues increasing.
- Oplog history may be insufficient.
- Secondary requires initial sync.
- Multiple members are affected.
- Replica-set redundancy is at risk.

Escalate to **Infrastructure/SRE** when:

- Disk I/O is slow.
- Network connectivity is unstable.
- CPU/memory capacity is insufficient.
- Storage performance is degraded.

Escalate to the **Application Owner** when:

- Write volume suddenly increased.
- A deployment caused abnormal database load.
- Heavy queries/index builds are affecting replication.
- Application traffic is overloading the Primary.

---

## Golden Rule

```text
Secondary Not Syncing
        ↓
DON'T RESYNC FIRST
        ↓
Check Replica Set
        ↓
Measure Lag + Optime
        ↓
Check Network / Disk / CPU / Memory
        ↓
Check Primary Write Load
        ↓
Check Oplog + Sync Source
        ↓
FIX ROOT CAUSE
        ↓
Monitor Optime Progress
        ↓
Verify SECONDARY
        ↓
Verify Application
```

> **Secondary not syncing = first prove whether replication is actually stalled, then identify why the Secondary cannot keep up before rebuilding it.**
