# MongoDB Restore — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on data loss and application impact  
**Applies to:** MongoDB production databases

**Purpose:** Safely restore MongoDB data from an approved backup while protecting existing data and replica-set availability.

---

## 1. Trigger

Use this runbook when:

- Data was accidentally deleted or modified.
- A database must be restored from backup.
- A MongoDB node must be rebuilt from backup.
- Disaster recovery testing requires a restore.
- A backup needs to be validated.

> ⚠️ **Never restore directly over a production database without an approved recovery plan and confirmation of the restore point.**

---

## 2. Quick Decision Flow

```text
MongoDB Restore Required
          │
          ▼
Identify Restore Type
          │
 ┌────────┼───────────┐
 ▼        ▼           ▼
Single   Full DB     Full Server
DB       Restore     / Disaster
 │        │           │
 └────────┴───────────┘
          │
          ▼
Verify Backup
          │
          ▼
Verify Restore Point
          │
          ▼
Prepare Target
          │
          ▼
Restore Data
          │
          ▼
Validate Data
          │
          ▼
Verify MongoDB
          │
          ▼
Verify Application
```

---

## 3. Step 1 — Confirm the Restore Request

Before restoring, confirm:

```text
[ ] Correct MongoDB cluster
[ ] Correct database
[ ] Correct backup
[ ] Correct restore point
[ ] Reason for restore documented
[ ] Application impact understood
[ ] Approved recovery/change exists
```

Record:

```text
Cluster:
Database:
Backup:
Backup timestamp:
Target server:
Requested restore point:
Requested by:
Reason:
```

---

## 4. Step 2 — Identify the Backup Type

Common backup sources:

```text
mongodump
Filesystem snapshot
Cloud volume snapshot
Storage snapshot
Managed backup
Other approved backup system
```

Identify exactly which backup method was used.

> Use the restore procedure that matches the backup type. Do not assume a filesystem copy can be restored using `mongorestore`, or vice versa.

---

## 5. Step 3 — Verify Backup Exists

Check the backup location:

```bash
ls -lh <backup-path>
```

Check backup size:

```bash
du -sh <backup-path>
```

Verify the backup is complete according to your backup system.

If checksums are available:

```bash
sha256sum <backup-file>
```

Compare with the recorded checksum.

Confirm:

```text
[ ] Backup exists
[ ] Backup is complete
[ ] Backup timestamp is correct
[ ] Backup is readable
[ ] Backup has not expired
[ ] Backup is from the expected cluster
```

> **Never assume that a backup job reporting "success" means the backup is restorable.**

---

## 6. Step 4 — Check Target Disk Space

Before restoring:

```bash
df -h
```

Check MongoDB filesystem:

```bash
df -h /var/lib/mongodb
```

Check available space:

```bash
du -sh <backup-path>
```

The target must have sufficient space for the restored database plus required operational overhead.

If disk is insufficient, stop and expand storage before continuing.

---

## 7. Step 5 — Protect the Existing Data

Before replacing or restoring data, make sure the current data is protected.

For a node rebuild:

```bash
systemctl stop mongod
```

Confirm:

```bash
systemctl status mongod
```

If the existing database files must be preserved, move them rather than immediately deleting them:

```bash
mv /var/lib/mongodb /var/lib/mongodb.old
mkdir /var/lib/mongodb
chown -R mongodb:mongodb /var/lib/mongodb
```

> ⚠️ Keep the old directory until the restored database has been validated and the recovery process is complete.

---

## 8. Step 6 — Restore Using `mongorestore`

For a `mongodump` backup:

Example:

```bash
mongorestore \
  --host <mongodb-host> \
  --username <username> \
  --password \
  --authenticationDatabase admin \
  <backup-directory>
```

For a specific database:

```bash
mongorestore \
  --host <mongodb-host> \
  --username <username> \
  --password \
  --authenticationDatabase admin \
  --nsInclude "<database>.*" \
  <backup-directory>
```

> Do not put production passwords directly into shell history.

---

## 9. Step 7 — Restore to a New Database First When Possible

For a logical restore, validate the backup in an isolated database/environment when practical.

Example:

```bash
mongorestore \
  --host <mongodb-host> \
  --username <username> \
  --password \
  --authenticationDatabase admin \
  --nsFrom="<database>.*" \
  --nsTo="<database>_restore.*" \
  <backup-directory>
```

Then validate:

```javascript
use <database>_restore
show collections
db.stats()
```

Check expected collections and document counts.

> Restoring to a separate database is safer for validation because it avoids immediately overwriting the original data.

---

## 10. Step 8 — Full Server / Node Restore

If restoring an entire MongoDB node:

```text
1. Stop mongod
2. Protect existing data
3. Restore database files or snapshot
4. Verify ownership and permissions
5. Verify mongod.conf
6. Start mongod
7. Check replica-set state
8. Allow replication/recovery
9. Validate application
```

Check ownership:

```bash
ls -ld /var/lib/mongodb
```

Expected owner is normally the MongoDB service account used by the installation.

If required:

```bash
chown -R mongodb:mongodb /var/lib/mongodb
```

---

## 11. Step 9 — Start MongoDB

```bash
systemctl start mongod
```

Check:

```bash
systemctl status mongod
```

Check logs:

```bash
tail -100 /var/log/mongodb/mongod.log
```

Look for:

```text
FATAL
WiredTiger
corruption
permission denied
No space left on device
replica set
rollback
```

---

## 12. Step 10 — Verify Replica Set

For a restored replica-set member:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

Expected healthy state:

```text
PRIMARY     1
SECONDARY   1
SECONDARY   1
```

A restored member may temporarily show:

```text
STARTUP2
RECOVERING
```

Wait for it to reach:

```text
SECONDARY
```

If initial sync fails, use:

```text
MongoDB-Initial-Sync-Failure.md
```

---

## 13. Step 11 — Validate Restored Data

Check database:

```javascript
use <database>
```

List collections:

```javascript
show collections
```

Check database statistics:

```javascript
db.stats()
```

Check important collection counts:

```javascript
db.<collection>.countDocuments({})
```

Check indexes:

```javascript
db.<collection>.getIndexes()
```

Validate critical application data:

```text
[ ] Expected collections exist
[ ] Expected indexes exist
[ ] Document counts are reasonable
[ ] Recent required data exists
[ ] No unexpected data loss
```

> Do not rely only on document counts. Validate important business records and application functionality.

---

## 14. Step 12 — Verify Application

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Look for:

```text
MongoServerSelectionError
MongoNetworkError
authentication failed
timeout
```

Check application health:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

Perform an approved application-level read/write test if required.

---

## 15. Step 13 — Verify Backup Recovery

Record:

```text
Backup used:
Backup timestamp:
Restore started:
Restore completed:
Database:
Collections restored:
Validation completed:
Application validation:
```

If this was a disaster-recovery test, record the recovery time:

```text
RTO:
RPO:
```

---

## 16. Section A — Accidental Data Deletion

If a user accidentally deleted data:

```text
DO NOT immediately restore the entire database.
```

First determine:

```text
What data was deleted?
When was it deleted?
Which database?
Which collection?
How much data?
Can the deleted data be isolated?
```

If possible, restore into a separate database:

```text
production_db
      +
backup
      ↓
production_db_restore
```

Then identify the missing records and restore only the required data using an approved procedure.

---

## 17. Section B — Full Database Restore

Use a full database restore when:

- Database is corrupted.
- Large amounts of data were deleted.
- Disaster recovery requires a full restore.
- Approved recovery procedure requires replacement of the database.

Before proceeding:

```text
[ ] Application impact confirmed
[ ] Backup verified
[ ] Restore point confirmed
[ ] Current data protected
[ ] Sufficient disk available
[ ] Recovery approval confirmed
```

---

## 18. Section C — Replica Set Member Rebuild

If rebuilding a Secondary, prefer rebuilding it from a healthy replica-set member using the approved MongoDB resync procedure when possible.

Before rebuilding:

```text
[ ] PRIMARY healthy
[ ] At least one other healthy SECONDARY
[ ] Data exists on healthy members
[ ] Affected member is safe to rebuild
```

After rebuild:

```text
STARTUP2
   ↓
RECOVERING
   ↓
SECONDARY
```

Verify replication:

```bash
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

---

## 19. Do NOT Do These Things

### ❌ Don't restore over production without approval

A restore can overwrite valid current data.

### ❌ Don't delete the only existing database copy

Preserve the original data until recovery is validated.

### ❌ Don't assume the newest backup is the correct backup

Confirm the requested restore point.

### ❌ Don't expose database passwords

Do not put passwords in:

```text
Shell history
Runbooks
Logs
Tickets
Git
Chat
```

### ❌ Don't skip restore validation

A backup is useful only if it can actually be restored.

### ❌ Don't rebuild all replica-set members at once

Maintain replica-set availability and redundancy.

---

## 20. Quick Reference

```bash
# Check backup
ls -lh <backup-path>
du -sh <backup-path>

# Check disk
df -h
df -h /var/lib/mongodb

# Stop MongoDB
systemctl stop mongod

# Start MongoDB
systemctl start mongod

# MongoDB status
systemctl status mongod

# MongoDB logs
tail -100 /var/log/mongodb/mongod.log

# Restore full mongodump
mongorestore \
  --host <mongodb-host> \
  --username <username> \
  --password \
  --authenticationDatabase admin \
  <backup-directory>

# Restore specific database
mongorestore \
  --host <mongodb-host> \
  --username <username> \
  --password \
  --authenticationDatabase admin \
  --nsInclude "<database>.*" \
  <backup-directory>

# Check replica set
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'

# Replication lag
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

---

## 21. Recovery Criteria

- [ ] Correct backup was selected.
- [ ] Backup integrity was verified.
- [ ] Correct restore point was confirmed.
- [ ] Target has sufficient disk space.
- [ ] Existing data was protected where required.
- [ ] Restore completed without errors.
- [ ] MongoDB is `active (running)`.
- [ ] Expected databases exist.
- [ ] Expected collections exist.
- [ ] Critical data was validated.
- [ ] Indexes were validated.
- [ ] Replica set is healthy.
- [ ] Restored member is `SECONDARY` if rebuilding a member.
- [ ] Replication lag is acceptable.
- [ ] Application health check succeeds.
- [ ] Recovery/RTO/RPO information was recorded.

---

## 22. Escalation

Escalate to **Database/SRE** when:

- Backup cannot be restored.
- Backup integrity is uncertain.
- Data loss is suspected.
- Full database restore is required.
- Replica-set rebuild is required.
- Data consistency is uncertain.

Escalate to **Infrastructure/SRE** when:

- Storage is insufficient.
- Backup storage is unavailable.
- Snapshot/volume restore fails.

Escalate to the **Application Owner** when:

- Application-level data validation fails.
- The restore point is unclear.
- Business-critical records are missing.
- Application migrations/schema changes affect the restore.

---

## Golden Rule

```text
MongoDB Restore
       ↓
VERIFY BACKUP
       ↓
VERIFY RESTORE POINT
       ↓
PROTECT EXISTING DATA
       ↓
CHECK DISK SPACE
       ↓
RESTORE
       ↓
VALIDATE DATA
       ↓
VERIFY MONGODB
       ↓
VERIFY REPLICA SET
       ↓
VERIFY APPLICATION
```

> **MongoDB Restore = verify the backup and restore point first, protect existing data, restore safely, then validate both the database and the application before closing the incident.**
