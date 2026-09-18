# MongoDB Disk Full — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on application impact  
**Applies to:** MongoDB production replica sets

**Purpose:** Safely identify and recover a MongoDB server when disk space is critically low or exhausted.

---

## 1. Trigger

Use this runbook when:

- Disk usage is above the configured alert threshold.
- MongoDB reports `No space left on device`.
- `mongod` stops or crashes because the disk is full.
- MongoDB cannot write.
- Monitoring reports filesystem usage above 85–90%.

> ⚠️ **Do not delete MongoDB database files to free space.**

---

## 2. Quick Decision Flow

```text
MongoDB Disk Full
       │
       ▼
Check replica-set health
       │
       ▼
Check disk + inode usage
       │
       ▼
Find what is consuming space
       │
 ┌─────┼──────────┬──────────┐
 ▼     ▼          ▼          ▼
Logs  MongoDB    Backups    Other
      Data                  Files
 │     │          │          │
 └─────┴──────────┴──────────┘
              │
              ▼
       Safely free/expand
             space
              │
              ▼
       Verify MongoDB
              │
              ▼
       Verify replica set
              │
              ▼
       Verify application
```

---

## 3. Step 1 — Check Disk Usage

```bash
df -h
```

Check inode usage:

```bash
df -i
```

Check the MongoDB filesystem:

```bash
df -h /var/lib/mongodb
```

Check MongoDB directory:

```bash
du -sh /var/lib/mongodb
```

---

## 4. Step 2 — Check MongoDB Status

```bash
systemctl status mongod
```

Check recent logs:

```bash
journalctl -u mongod --since "30 minutes ago" --no-pager
```

MongoDB log:

```bash
tail -100 /var/log/mongodb/mongod.log
```

Look for:

- `No space left on device`
- `WiredTiger`
- `I/O error`
- `write failed`
- `cannot allocate space`

---

## 5. Step 3 — Check Replica Set FIRST

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

Identify the affected node.

> If the affected node is a **SECONDARY**, you have more recovery flexibility.
>
> If it is the **PRIMARY**, protect application availability before performing maintenance.

---

## 6. Step 4 — Find What Is Consuming Disk

Check major directories:

```bash
du -xhd1 /var | sort -h
```

Check MongoDB filesystem:

```bash
du -xhd1 /var/lib | sort -h
```

Check logs:

```bash
du -sh /var/log/*
```

Check MongoDB logs:

```bash
du -sh /var/log/mongodb
```

Check backup files:

```bash
find /var/backups -type f -size +1G -ls 2>/dev/null
```

Check deleted files still held open:

```bash
lsof +L1
```

---

## 7. Identify the Cause

| Finding | Likely Cause | Action |
|---|---|---|
| `/var/log` large | Log growth | Rotate/remove approved old logs |
| `/var/lib/mongodb` large | MongoDB data | Do **not** manually delete |
| Backup directory large | Old backups | Remove according to retention policy |
| Deleted files still open | Process holds files | Identify process |
| Inodes 100% | Too many files | Find source |
| Disk generally undersized | Capacity problem | Expand disk |

---

## 8. Section A — Logs Consuming Space

Check:

```bash
du -sh /var/log/mongodb
```

Check log files:

```bash
ls -lh /var/log/mongodb/
```

Check configuration:

```bash
grep -n "systemLog" -A10 /etc/mongod.conf
```

Use the approved log-rotation procedure.

> **Do not simply delete the active MongoDB log while `mongod` is running.**

After cleanup:

```bash
df -h
```

---

## 9. Section B — Backup Files Consuming Space

Find large backups:

```bash
find /var/backups -type f -size +1G -ls 2>/dev/null
```

Check backup retention.

Only remove backups that are confirmed to be:

- Expired
- Redundant
- Not required for an active restore
- Covered by the backup retention policy

Then:

```bash
df -h
```

---

## 10. Section C — MongoDB Data Consuming Space

If most space is:

```text
/var/lib/mongodb
```

**Do not run:**

```bash
rm -rf /var/lib/mongodb/*
```

Do not manually delete:

- WiredTiger files
- Collection files
- Index files
- Journal files

MongoDB manages these files.

Instead:

1. Check replica-set health.
2. Check whether the node is Primary or Secondary.
3. Determine whether storage needs to be expanded.
4. Review MongoDB storage growth.
5. Use the approved database maintenance procedure.

Check database statistics:

```javascript
db.stats()
```

For a specific database:

```javascript
db.getSiblingDB("<database>").stats()
```

---

## 11. Section D — Disk Full on Secondary

If the affected node is a `SECONDARY`:

```text
PRIMARY
   │
   ├── SECONDARY  ← Disk full
   │
   └── SECONDARY
```

First protect the healthy replica set.

If necessary, remove the affected Secondary from application traffic if your architecture sends reads to it.

Then free/expand storage safely.

After recovery:

```bash
systemctl start mongod
```

Monitor:

```javascript
rs.status()
```

The member may enter:

```text
STARTUP2
```

and later:

```text
SECONDARY
```

---

## 12. Section E — Disk Full on Primary

If the affected node is:

```text
PRIMARY
```

**Do not immediately restart or shut down MongoDB.**

First verify:

```bash
df -h
```

and replica-set health:

```javascript
rs.status()
```

Confirm another eligible Secondary is healthy enough to become Primary.

If application availability is at risk, follow your approved **MongoDB Primary Failure / Step-Down Runbook** before maintenance.

> Do not manually force an election unless there is a specific approved reason.

---

## 13. Step 5 — Free or Expand Disk

Preferred order:

1. Remove approved temporary/old files
2. Clean expired backups
3. Rotate logs
4. Remove other non-MongoDB files
5. Expand filesystem/storage if necessary

After cleanup:

```bash
df -h
```

Target:

```text
Disk usage back below alert threshold
```

If the MongoDB filesystem itself is full and cannot be safely cleaned, **expand the disk/filesystem** according to your infrastructure procedure.

---

## 14. Step 6 — Restart MongoDB Only If Required

If `mongod` stopped because the disk was full:

```bash
systemctl status mongod
```

If the disk problem is resolved:

```bash
systemctl start mongod
```

Check:

```bash
systemctl status mongod
```

Then:

```bash
tail -100 /var/log/mongodb/mongod.log
```

Make sure there are no continuing:

- `No space left on device`
- `WiredTiger errors`
- `I/O errors`

---

## 15. Step 7 — Verify Replica Set

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

The recovered node should eventually return to:

```text
SECONDARY
```

---

## 16. Step 8 — Verify Application

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Look for continuing:

- `MongoServerSelectionError`
- `connection refused`
- `timeout`
- `write failed`

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

### ❌ Don't delete `/var/lib/mongodb/*`

This can destroy database data and replica-set recovery capability.

### ❌ Don't delete WiredTiger files manually

MongoDB owns these files.

### ❌ Don't blindly delete logs

Use log rotation/retention procedures.

### ❌ Don't delete backups without checking retention

You may remove your only recovery point.

### ❌ Don't immediately restart the Primary

First check replica-set health and application impact.

### ❌ Don't run `mongod --repair` as a disk-cleanup solution

A full disk is not automatically data corruption.

---

## 18. Quick Reference

```bash
# Disk
df -h
df -i

# MongoDB filesystem
df -h /var/lib/mongodb
du -sh /var/lib/mongodb

# Find large directories
du -xhd1 /var | sort -h

# Find large files
find /var -xdev -type f -size +1G -ls 2>/dev/null

# Deleted files still consuming space
lsof +L1

# MongoDB status
systemctl status mongod

# MongoDB logs
tail -100 /var/log/mongodb/mongod.log

# Service logs
journalctl -u mongod --since "30 minutes ago"

# Replica set
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'

# Replication lag
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'

# Database size
mongosh --quiet --eval 'db.stats()'

# Start MongoDB
systemctl start mongod
```

---

## 19. Recovery Criteria

- [ ] Disk usage is below the alert threshold.
- [ ] Inode usage is normal.
- [ ] `mongod` is `active (running)`.
- [ ] No continuing disk/I/O errors.
- [ ] Replica set has a healthy Primary.
- [ ] Recovered member is `SECONDARY` or otherwise healthy.
- [ ] Replication lag is acceptable.
- [ ] Applications can connect.
- [ ] Application health check succeeds.
- [ ] Root cause of disk growth is identified.

---

## 20. Escalation

Escalate to **Database/SRE** when:

- `/var/lib/mongodb` is consuming unexpected space.
- MongoDB storage continues growing rapidly.
- WiredTiger/storage errors appear.
- Replica-set health is degraded.
- Disk cannot be safely freed.

Escalate to **Infrastructure/SRE** when:

- Filesystem cannot be expanded.
- Disk/storage device has I/O errors.
- Node storage is failing.

Escalate to the **Application Owner** when:

- Unexpected application data growth caused the problem.
- Large collections are growing unexpectedly.
- Application logging or temporary files caused disk exhaustion.

---

## Golden Rule

```text
MongoDB Disk Full
       ↓
DON'T DELETE MONGODB DATA
       ↓
Check Replica Set
       ↓
Check df -h / df -i
       ↓
Find What Consumes Space
       ↓
Safely Clean or Expand Disk
       ↓
Verify MongoDB
       ↓
Verify Replica Set
       ↓
Verify Application
```

> **Disk full = first protect the data and replica set, then free/expand storage safely.**
