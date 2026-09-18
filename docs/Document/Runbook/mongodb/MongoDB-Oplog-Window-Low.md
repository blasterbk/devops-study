# MongoDB Oplog Window Low — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on replica-set lag and recovery risk  
**Applies to:** MongoDB production replica sets

**Purpose:** Detect and safely resolve a MongoDB replica set with an oplog window that is too small to allow a lagging Secondary to catch up safely.

---

## 1. Trigger

Use this runbook when:

- Monitoring reports a low oplog window.
- A Secondary is falling significantly behind the Primary.
- Replication lag is approaching the available oplog window.
- A Secondary may require initial sync because required oplog history could be overwritten.
- `rs.printReplicationInfo()` shows a short oplog time range.

> ⚠️ **Low oplog window is a replication recovery risk. Do not wait until a Secondary falls outside the oplog history.**

---

## 2. Quick Decision Flow

```text
Low Oplog Window
       │
       ▼
Check Replica Set Health
       │
       ▼
Check Oplog Window
       │
       ▼
Check Replication Lag
       │
       ▼
Is Lag Approaching Oplog Window?
       │
   ┌───┴────┐
   ▼        ▼
  YES       NO
   │         │
   ▼         ▼
Urgent     Monitor
Action
   │
   ▼
Find Cause
   │
 ┌─┼──────────────┬───────────┐
 ▼ ▼              ▼           ▼
High Write      Slow        Secondary
Volume          Secondary   / Network
 │               │           │
 └───────────────┴───────────┘
                 │
                 ▼
             Fix Cause
                 │
                 ▼
          Increase Oplog if
          required/approved
                 │
                 ▼
          Verify Oplog Window
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

Identify:

```text
PRIMARY
SECONDARY
DOWN
STARTUP2
RECOVERING
```

If a member is down:

```text
MongoDB-ReplicaSet-Member-Down.md
```

If a member is in initial sync:

```text
MongoDB-Initial-Sync-Failure.md
```

---

## 4. Step 2 — Check Oplog Window

Run:

```bash
mongosh --quiet --eval 'rs.printReplicationInfo()'
```

Review:

```text
configured oplog size
log length
oplog first event time
oplog last event time
```

Example:

```text
configured oplog size: 100GB
log length: 18hrs
oplog first event time: ...
oplog last event time: ...
```

The important value is the approximate time range covered by the oplog.

---

## 5. Step 3 — Check Replication Lag

Run:

```bash
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

Example:

```text
legacy-db-2
  syncedTo: ...
  2 hrs 10 mins behind the primary
```

Compare:

```text
Replication lag
       VS
Oplog window
```

Example:

```text
Oplog window:       18 hours
Secondary lag:       2 hours
Risk:               Moderate

Oplog window:        2 hours
Secondary lag:       2 hours
Risk:               Critical
```

> These are operational examples, not universal MongoDB thresholds. Define your alert threshold according to your recovery requirements.

---

## 6. Step 4 — Calculate the Safety Margin

Think of the safety margin as:

```text
Oplog Window - Replication Lag
```

Example:

```text
Oplog Window:       12 hours
Replication Lag:     3 hours

Safety Margin:       9 hours
```

If the margin is continuously decreasing:

```text
12h → 10h → 8h → 6h
```

the Secondary is approaching a point where required oplog entries may no longer exist.

---

## 7. Step 5 — Check Primary Write Volume

A high write workload can cause the oplog to rotate quickly.

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
Large write volume
Bulk writes
Batch jobs
Large imports
Application traffic spikes
Unexpected write activity
```

If write volume suddenly increased, investigate the Application Owner.

---

## 8. Step 6 — Check Secondary Performance

On the lagging Secondary:

```bash
top
```

```bash
free -h
```

```bash
iostat -xz 1 5
```

Check disk:

```bash
df -h
```

Look for:

```text
High CPU
Memory pressure
High disk latency
High disk utilization
Storage errors
```

A slow Secondary can fall behind while the Primary continues generating oplog entries.

If the issue is replication lag:

```text
MongoDB-Replication-Lag.md
```

If the Secondary is not progressing:

```text
MongoDB-Secondary-Not-Syncing.md
```

---

## 9. Step 7 — Check Network

Test connectivity from Secondary to Primary:

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

Check interface statistics:

```bash
ip -s link
```

Look for:

```text
Packet loss
Connection resets
High latency
DNS failures
Network interruptions
```

---

## 10. Step 8 — Check Oplog Size Configuration

MongoDB exposes the current oplog size through:

```bash
mongosh --quiet --eval 'rs.printReplicationInfo()'
```

Record:

```text
Configured oplog size:
Current oplog window:
Primary write rate:
Maximum observed replication lag:
```

> Do not change the oplog size blindly. A larger oplog consumes additional disk space.

---

## 11. Step 9 — Determine the Root Cause

Common causes:

### A. High Primary Write Volume

```text
More writes
    ↓
Oplog fills faster
    ↓
Older entries removed sooner
    ↓
Oplog window becomes shorter
```

### B. Slow Secondary

```text
Secondary applies operations slowly
    ↓
Replication lag increases
    ↓
Secondary approaches oplog window
```

### C. Network Problem

```text
Replication traffic interrupted
    ↓
Secondary falls behind
    ↓
Oplog safety margin decreases
```

### D. Insufficient Oplog Size

```text
Normal workload
    +
Small oplog
    ↓
Short oplog window
```

---

## 12. Step 10 — Immediate Mitigation

If the Secondary is approaching the oplog window:

```text
1. Protect the healthy Primary.
2. Protect at least one healthy Secondary.
3. Investigate the lagging Secondary immediately.
4. Reduce abnormal write workload if appropriate.
5. Fix network/storage/resource problems.
6. Monitor the safety margin continuously.
```

If an application deployment caused a sudden write spike, consider temporarily reducing the abnormal workload through the approved application procedure.

---

## 13. Step 11 — Increase Oplog Size When Required

If the workload consistently produces a short oplog window, review whether a larger oplog is required.

Before changing it, confirm:

```text
[ ] Enough disk space exists
[ ] Current oplog size is known
[ ] Current oplog window is known
[ ] Write workload is understood
[ ] Replica-set topology is understood
[ ] Change is approved
[ ] Recovery plan exists
```

Use the MongoDB-version-appropriate documented procedure for resizing the oplog.

> **Do not blindly edit the oplog collection or database files manually.**

After resizing, verify:

```bash
mongosh --quiet --eval 'rs.printReplicationInfo()'
```

---

## 14. Step 12 — Monitor the Oplog Window

Run repeatedly:

```bash
watch -n30 \
'mongosh --quiet --eval "rs.printReplicationInfo()"'
```

Monitor:

```text
Oplog window
Replication lag
Safety margin
Primary write workload
Secondary performance
```

Expected:

```text
Oplog window
     ↓
Stable or increasing

Replication lag
     ↓
Stable or decreasing

Safety margin
     ↓
Stable or increasing
```

---

## 15. Step 13 — Check Whether a Secondary Needs Initial Sync

If the required oplog history is no longer available to the Secondary, normal replication may no longer be possible.

Indicators include:

```text
Secondary is too far behind
Required oplog entries are gone
Initial sync required
```

Use:

```text
MongoDB-Initial-Sync-Failure.md
```

Before rebuilding, confirm:

```text
[ ] Healthy PRIMARY exists
[ ] Another healthy replica exists
[ ] Required data exists on healthy members
[ ] Affected Secondary is safe to rebuild
```

---

## 16. Step 14 — Verify Recovery

Run:

```bash
mongosh --quiet --eval 'rs.printReplicationInfo()'
```

Then:

```bash
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

Check replica-set health:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'
```

Expected:

```text
PRIMARY     1
SECONDARY   1
SECONDARY   1
```

Confirm:

```text
[ ] Oplog window is healthy
[ ] Replication lag is decreasing
[ ] Safety margin is increasing/stable
[ ] Secondary is healthy
[ ] No replication errors
```

---

## 17. Do NOT Do These Things

### ❌ Don't wait until the Secondary falls outside the oplog window

At that point, an initial sync may be required.

### ❌ Don't delete or manually modify the oplog

Use MongoDB's supported procedures.

### ❌ Don't increase oplog size without checking disk space

The oplog consumes storage.

### ❌ Don't assume a larger oplog fixes replication lag

It provides more recovery time; it does not make a slow Secondary faster.

### ❌ Don't ignore Primary write spikes

High write volume can rapidly shorten the oplog window.

### ❌ Don't rebuild the Secondary immediately

First determine whether it can catch up normally.

---

## 18. Quick Reference

```bash
# Replica set health
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'

# Oplog window
mongosh --quiet --eval 'rs.printReplicationInfo()'

# Replication lag
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'

# Detailed replica status
mongosh --quiet --eval 'rs.status().members'

# CPU
top

# Memory
free -h

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

# Active MongoDB operations
mongosh --quiet --eval 'db.currentOp({active:true})'
```

---

## 19. Recovery Criteria

- [ ] Oplog window measured.
- [ ] Replication lag measured.
- [ ] Safety margin calculated.
- [ ] Primary write workload checked.
- [ ] Secondary CPU/memory/disk checked.
- [ ] Network connectivity checked.
- [ ] Oplog size reviewed.
- [ ] Root cause identified.
- [ ] Root cause fixed.
- [ ] Oplog window is stable or increasing.
- [ ] Replication lag is decreasing or within the operational threshold.
- [ ] Secondary is `SECONDARY`.
- [ ] Replica-set health is normal.
- [ ] No member is at immediate risk of falling outside the oplog window.
- [ ] Monitoring/alerting is working.

---

## 20. Escalation

Escalate to **Database/SRE** when:

- Oplog window is rapidly decreasing.
- Secondary lag approaches the oplog window.
- Required oplog history may already be unavailable.
- Oplog resizing is required.
- Initial sync/rebuild may be required.
- Multiple Secondaries are affected.

Escalate to **Application Owner** when:

- A sudden write spike caused the problem.
- A deployment increased write volume.
- A batch job/import is generating abnormal writes.

Escalate to **Infrastructure/SRE** when:

- Storage performance is poor.
- Disk capacity is insufficient.
- Network instability is affecting replication.

---

## Golden Rule

```text
Low Oplog Window
       ↓
MEASURE OPLOG WINDOW
       ↓
MEASURE REPLICATION LAG
       ↓
CALCULATE SAFETY MARGIN
       ↓
Check Write Volume / Secondary / Network
       ↓
FIX ROOT CAUSE
       ↓
Increase Oplog if Required
       ↓
Monitor Window + Lag
       ↓
Verify Replica Set
```

> **Low oplog window = a recovery-time warning. Keep enough oplog history for your slowest expected Secondary to catch up, and investigate any rapidly shrinking safety margin before the oplog history is lost.**
