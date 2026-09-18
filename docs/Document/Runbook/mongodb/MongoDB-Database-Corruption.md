# MongoDB Database Corruption — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on data integrity and replica-set redundancy  
**Applies to:** MongoDB production databases

**Purpose:** Safely identify suspected MongoDB data corruption, protect healthy replica-set members, and recover the affected member or database without making the situation worse.

---

## 1. Trigger

Use this runbook when:

- MongoDB reports WiredTiger corruption or fatal storage errors.
- MongoDB fails to start because of storage/data errors.
- Logs show `WT_PANIC`, `WiredTiger error`, `corruption`, or fatal assertions.
- Queries return unexpected storage/integrity errors.
- A replica-set member repeatedly crashes because of database files.
- MongoDB reports damaged or unreadable data files.

Common indicators:

```text
WiredTiger error
WT_PANIC
corruption
Fatal assertion
Data file error
I/O error
Unable to read
MongoDB cannot start
```

> ⚠️ **Database corruption is a data-integrity incident. Do not start deleting files or run repair commands before confirming replica-set and backup health.**

---

## 2. Quick Decision Flow

```text
Suspected Database Corruption
           │
           ▼
Protect Healthy Replicas
           │
           ▼
Check MongoDB Logs
           │
           ▼
Is MongoDB Running?
      ┌────┴────┐
      ▼         ▼
     YES        NO
      │         │
      ▼         ▼
Check Data   Check Startup
Integrity    / WiredTiger
      │         │
      └────┬────┘
           ▼
     Confirm Cause
           │
      ┌────┴───────────┐
      ▼                ▼
Healthy Replica      No Healthy
Available            Replica
      │                │
      ▼                ▼
Rebuild / Resync     Restore /
Affected Member      Escalate
      │
      ▼
Verify Replication
      │
      ▼
Verify Application
```

---

## 3. Step 1 — Stop and Protect the Replica Set

Before making destructive changes, check the replica set from a healthy member:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

Expected healthy example:

```text
legacy-db-1   PRIMARY     health=1
legacy-db-2   SECONDARY   health=1
legacy-db-3   DOWN        health=0
```

Confirm:

```text
[ ] PRIMARY is healthy
[ ] At least one healthy SECONDARY exists
[ ] Healthy members are accessible
[ ] Current backup status is known
[ ] Affected member is identified
```

> **Do not modify healthy replica-set members while investigating one corrupted member.**

---

## 4. Step 2 — Check MongoDB Logs

If MongoDB is running:

```bash
tail -200 /var/log/mongodb/mongod.log
```

If MongoDB is not running:

```bash
journalctl -u mongod -n 200 --no-pager
```

Search for corruption/storage errors:

```bash
grep -Ei \
'WT_PANIC|WiredTiger|corrupt|corruption|fatal|assertion|I/O error|checksum' \
/var/log/mongodb/mongod.log | tail -100
```

Record the exact error.

Do not classify the database as corrupt only because MongoDB crashed.

---

## 5. Step 3 — Check Disk and Filesystem Health

Check space:

```bash
df -h
```

Check inodes:

```bash
df -i
```

Check MongoDB filesystem:

```bash
df -h /var/lib/mongodb
```

Check kernel I/O errors:

```bash
dmesg | grep -Ei \
'I/O error|filesystem|ext4|xfs|nvme|disk|blk_update' | tail -50
```

If disk is full, use:

```text
MongoDB-Disk-Full.md
```

If underlying storage reports errors, escalate to Infrastructure/SRE.

---

## 6. Step 4 — Check Whether MongoDB Can Start

Try only if there is no evidence that starting the member could worsen an active storage problem.

```bash
systemctl status mongod
```

If stopped:

```bash
systemctl start mongod
```

Then:

```bash
systemctl status mongod
```

If startup fails:

```bash
journalctl -u mongod -n 100 --no-pager
```

and:

```bash
tail -100 /var/log/mongodb/mongod.log
```

If the logs clearly indicate WiredTiger corruption or a fatal storage error, stop repeated restart attempts.

```bash
systemctl stop mongod
```

---

## 7. Step 5 — Determine Whether the Problem Is Local to One Member

From a healthy member:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'
```

If:

```text
PRIMARY     health=1
SECONDARY   health=1
Affected    health=0
```

the healthy replicas may provide a recovery path.

If multiple members show corruption or are unavailable:

```text
STOP
   ↓
Do not rebuild multiple members blindly
   ↓
Protect backups
   ↓
Escalate to Database/SRE
```

---

## 8. Step 6 — Verify Backup Availability

Before any destructive recovery:

```text
[ ] Recent backup exists
[ ] Backup timestamp is known
[ ] Backup is readable
[ ] Backup recovery procedure is known
[ ] Restore point is acceptable
```

If necessary, use:

```text
MongoDB-Restore.md
```

> A replica-set copy and a backup are not the same recovery mechanism. Keep independent backups.

---

## 9. Step 7 — Preferred Recovery: Rebuild a Corrupted Secondary

If:

```text
[ ] PRIMARY is healthy
[ ] At least one healthy SECONDARY exists
[ ] Affected member is a SECONDARY
[ ] Healthy replica contains the required data
```

the preferred approach is normally to rebuild/resync the affected member rather than trying to repair corrupted database files in place.

First stop MongoDB:

```bash
systemctl stop mongod
```

Preserve the existing data directory:

```bash
mv /var/lib/mongodb /var/lib/mongodb.corrupt
mkdir /var/lib/mongodb
chown -R mongodb:mongodb /var/lib/mongodb
```

Start MongoDB:

```bash
systemctl start mongod
```

Monitor:

```bash
tail -f /var/log/mongodb/mongod.log
```

Check state:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'
```

Expected progression:

```text
STARTUP2
    ↓
RECOVERING
    ↓
SECONDARY
```

> **Do not immediately delete `/var/lib/mongodb.corrupt`. Keep it until the rebuilt member has been validated and the approved retention/cleanup process allows removal.**

---

## 10. Step 8 — Verify Initial Sync

If the rebuilt member enters:

```text
STARTUP2
```

monitor logs:

```bash
tail -f /var/log/mongodb/mongod.log
```

Check:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'
```

If initial sync fails:

```text
MongoDB-Initial-Sync-Failure.md
```

---

## 11. Step 9 — Do NOT Use `mongod --repair` as the First Response

Do not immediately run:

```bash
mongod --repair
```

Repair can have significant data-integrity implications and should not be treated as a routine first-line recovery method for a replica-set member when a healthy replica is available.

Preferred order:

```text
Confirm healthy replica
        ↓
Protect backups
        ↓
Preserve corrupted member
        ↓
Rebuild/resync member
        ↓
Validate
```

Use repair only under an approved Database/SRE recovery procedure when appropriate.

---

## 12. Step 10 — If No Healthy Replica Exists

If all replica-set members are affected or no healthy copy is available:

```text
DO NOT:
- Delete database files
- Run repeated repair attempts
- Reinitialize the replica set
- Restore over existing data blindly
```

Immediately:

```text
1. Stop destructive changes.
2. Preserve all database copies.
3. Preserve logs.
4. Verify available backups.
5. Identify the best recovery point.
6. Escalate to Database/SRE.
```

Use:

```text
MongoDB-Restore.md
```

for an approved backup recovery.

---

## 13. Step 11 — Check Replication After Recovery

Run:

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

```bash
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

Confirm:

```text
[ ] Rebuilt member is SECONDARY
[ ] health = 1
[ ] Replication is progressing
[ ] Replication lag is acceptable
```

---

## 14. Step 12 — Validate Data

Check databases:

```javascript
show dbs
```

Check important collections:

```javascript
use <database>
show collections
```

Check counts where appropriate:

```javascript
db.<collection>.countDocuments({})
```

Check indexes:

```javascript
db.<collection>.getIndexes()
```

Validate critical application records.

> Do not rely only on document counts. A count can match while important records or indexes are still incorrect.

---

## 15. Step 13 — Verify Application

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Look for:

```text
MongoServerSelectionError
MongoNetworkError
timeout
WiredTiger
read/write errors
```

Check application health:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

Perform an approved read/write validation if required.

---

## 16. Do NOT Do These Things

### ❌ Don't delete `/var/lib/mongodb` immediately

Preserve evidence and recovery options.

### ❌ Don't run `mongod --repair` blindly

Repair is not the default recovery method when a healthy replica exists.

### ❌ Don't rebuild multiple members at once

Maintain replica-set availability.

### ❌ Don't restore over the only copy

Protect the original data.

### ❌ Don't assume every WiredTiger error means corruption

Read the complete error context and check disk/storage health.

### ❌ Don't repeatedly restart a crashing MongoDB

Repeated restarts can obscure the original failure and complicate diagnosis.

---

## 17. Quick Reference

```bash
# Replica set health
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'

# MongoDB status
systemctl status mongod

# Stop MongoDB
systemctl stop mongod

# Start MongoDB
systemctl start mongod

# MongoDB logs
tail -200 /var/log/mongodb/mongod.log

# Service logs
journalctl -u mongod -n 200 --no-pager

# Corruption/storage errors
grep -Ei \
'WT_PANIC|WiredTiger|corrupt|corruption|fatal|assertion|I/O error|checksum' \
/var/log/mongodb/mongod.log | tail -100

# Disk
df -h
df -i

# MongoDB filesystem
df -h /var/lib/mongodb

# Kernel/storage errors
dmesg | grep -Ei \
'I/O error|filesystem|ext4|xfs|nvme|disk|blk_update' | tail -50

# Replication lag
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

---

## 18. Recovery Criteria

- [ ] Corruption/error was confirmed from logs.
- [ ] Healthy replica-set members were protected.
- [ ] Backup availability was confirmed.
- [ ] Affected member was isolated/recovered safely.
- [ ] Existing database files were preserved where required.
- [ ] Rebuild/resync completed successfully.
- [ ] Member is `SECONDARY`.
- [ ] `health = 1`.
- [ ] Replication is progressing.
- [ ] Replication lag is acceptable.
- [ ] Critical data was validated.
- [ ] Application health check succeeds.
- [ ] Incident evidence and recovery actions were documented.

---

## 19. Escalation

Escalate immediately to **Database/SRE** when:

- Multiple replica-set members show corruption.
- No healthy replica exists.
- Data integrity is uncertain.
- `mongod --repair` is being considered.
- Backup restoration is required.
- Primary data may be affected.

Escalate to **Infrastructure/SRE** when:

- Disk/storage I/O errors are present.
- Filesystem errors are present.
- Underlying volume/VM hardware is suspected.

Escalate to the **Application Owner** when:

- Application-level data validation fails.
- Critical records are missing or inconsistent.

---

## Golden Rule

```text
Suspected Corruption
        ↓
PROTECT HEALTHY REPLICAS
        ↓
CHECK LOGS + STORAGE
        ↓
VERIFY BACKUPS
        ↓
PRESERVE CORRUPTED DATA
        ↓
REBUILD / RESYNC MEMBER
        ↓
VERIFY SECONDARY
        ↓
VALIDATE DATA
        ↓
VERIFY APPLICATION
```

> **MongoDB corruption = protect the healthy copies first. If a healthy replica exists, rebuilding the affected member is generally safer than attempting in-place repair.**
