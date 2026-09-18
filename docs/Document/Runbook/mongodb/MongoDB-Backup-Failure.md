# MongoDB Backup Failure — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P2–P1 depending on backup SLA and RPO exposure  
**Applies to:** MongoDB production backups

**Purpose:** Rapidly diagnose, troubleshoot, and resolve MongoDB backup failures (logical dumps, volume snapshots, and automated backup jobs) to prevent data loss exposure and maintain disaster-recovery readiness.

---

## 1. Trigger

Use this runbook when:

- Monitoring or alerting systems report a backup job failure.
- A scheduled MongoDB backup CronJob/script fails or times out.
- `mongodump` exits with a non-zero status code or error.
- Backup storage volume or cloud bucket upload fails.
- Backup snapshot creation fails.
- The latest successful backup timestamp exceeds the defined RPO threshold (e.g., > 24 hours).

Common error indicators:

```text
mongodump failed: error dumping metadata
Failed: error writing data to disk: no space left on device
Failed: can't create session: could not connect to server
MongoServerError: not authorized on admin to execute command
Failed: oplog overflow: oplog is too small for dump duration
Failed: error creating archive: broken pipe
Snapshot creation failed: volume in use / quota exceeded
AWS/S3/GCS error: Access Denied / RequestTimeTooSkewed
Backup timed out after 3600s
```

> ⚠️ **A backup alert means your disaster recovery safety net is compromised. Treat recurring backup failures with high urgency before a primary failure occurs.**

---

## 2. Quick Decision Flow

```text
Backup Failure Alert
         │
         ▼
Identify Failed Job & Method
         │
    ┌────┼──────────────┬──────────────┐
    ▼    ▼              ▼              ▼
Logical Dump        Snapshot       K8s CronJob    Remote Upload
(mongodump)         (LVM/Cloud)    (Pod/Job)      (S3/GCS/NFS)
    │    │              │              │
    │    └──────┬───────┴──────────────┘
    ▼           ▼
Check Exact Error & Logs
    │
 ┌──┴────────┬─────────────┬─────────────┬─────────────┐
 ▼           ▼             ▼             ▼             ▼
Disk Full   Auth/TLS      Oplog Rollover Heavy Load    Storage/Auth
on Target   Failure       (--oplog)      Timeout       Network S3
 │           │             │             │             │
 └───┬───────┴─────────────┴─────────────┴─────────────┘
     ▼
Apply Resolution
     │
     ▼
Trigger Manual On-Demand Backup
     │
     ▼
Validate Backup Integrity & Size
     │
     ▼
Confirm Green Status & Metric Reset
```

---

## 3. Step 1 — Identify the Failed Backup Job

Determine which backup system and target failed:

```bash
# Check systemd timer/service (if run via VM systemd)
systemctl list-timers | grep -Ei 'mongo|backup'
journalctl -u mongodb-backup.service --since "24 hours ago" --no-pager

# Check Kubernetes CronJob (if run in Kubernetes)
kubectl get cronjobs -A
kubectl get pods -A -l app=mongodb-backup --sort-by='.metadata.creationTimestamp'
```

Record details:

```text
Cluster / Host:
Backup Tool: (mongodump / filesystem snapshot / cloud snapshot / custom script)
Scheduled Time:
Failure Time:
Exit Code / Error:
Target Destination:
```

---

## 4. Step 2 — Check Backup Logs

Inspect the full log output from the failed backup run.

### Kubernetes Backup Pods:

```bash
# Get failed pod logs
kubectl logs <failed-backup-pod> -n <namespace> --tail=200

# Inspect pod termination reason and events
kubectl describe pod <failed-backup-pod> -n <namespace>
```

### System Host / VM Logs:

```bash
# Tail backup log file
tail -200 /var/log/mongodb/backup.log

# Or systemd journal
journalctl -u mongodb-backup.service -n 100 --no-pager
```

Classify the error:

| Error Category | Typical Symptoms | Jump To |
|---|---|---|
| **Target Storage Exhaustion** | `no space left on device`, `write: broken pipe` | Step 3 |
| **Authentication & Permissions** | `Authentication failed`, `not authorized`, `Unauthorized` | Step 4 |
| **Oplog Overflow** | `oplog loop`, `oplog is too small`, `point-in-time failed` | Step 5 |
| **Resource / Timeout** | `context deadline exceeded`, `SIGKILL`, OOMKilled | Step 6 |
| **Remote / Cloud Upload** | `S3 Error`, `AccessDenied`, `Connection reset` | Step 7 |

---

## 5. Step 3 — Diagnose Disk Space & Target Storage

If the backup target ran out of space:

```bash
# Check local filesystem space
df -h

# Check inode capacity
df -i

# Inspect backup storage directory
du -sh /var/backups/mongodb/* | sort -h
```

If using a dedicated backup volume / NFS:

```bash
df -h /mnt/backups
```

### Resolution:

1. Prune expired backups according to the approved data retention policy:
   ```bash
   # Example: find and list archives older than retention days before deleting
   find /var/backups/mongodb/ -type f -name "*.gz" -mtime +14 -ls
   ```
2. Compress existing uncompressed dumps (`gzip -9`).
3. Expand the backup disk/volume size if data growth exceeded historical thresholds.

---

## 6. Step 4 — Check MongoDB Connectivity and Authentication

If the backup failed during connection acquisition:

```bash
# Test network connectivity from backup runner to MongoDB
nc -vz <mongodb-host> 27017

# Test authentication manually using the backup service credentials
mongosh --host <mongodb-host> \
  -u <backup-user> \
  -p \
  --authenticationDatabase admin \
  --eval 'db.runCommand({ connectionStatus: 1 })'
```

Verify that the backup user has required backup privileges:

```javascript
// Check backup user privileges
use admin
db.getUser("<backup-user>")
```

Expected built-in role:

```javascript
roles: [
  { role: "backup", db: "admin" },
  { role: "clusterMonitor", db: "admin" }
]
```

> If password rotation occurred recently, update the backup script Secret / Vault entry and redeploy.

---

## 7. Step 5 — Check Oplog Rollover / Cursor Timeout

When taking consistent backups with `mongodump --oplog`, `mongodump` tails the oplog during the dump process. If the dump takes longer than the oplog window because of heavy write traffic, the oplog will roll over and cause:

```text
Failed: oplog overflow
oplog is too small for dump duration
```

### Check Oplog Window:

Connect to MongoDB:

```javascript
rs.printReplicationInfo()
```

Look at `oplog configured log size` and `oplog loop length`.

### Resolution:

1. **Target Secondary Node:** Ensure `mongodump` runs against a dedicated healthy Secondary rather than the Primary to avoid production contention.
2. **Increase Oplog Size:**
   ```javascript
   // Resize oplog online (MongoDB 4.4+)
   db.adminCommand({ replSetResizeOplog: 1, size: 20480 }) // size in MB
   ```
3. Use `--numParallelCollections` to speed up collection export on multi-core systems.

---

## 8. Step 6 — Check Resource Saturation and Timeouts

If the backup was terminated midway (e.g., Kubernetes `OOMKilled` or process killed by Linux OOM killer):

```bash
# Check kernel OOM kill events on backup host
dmesg | grep -Ei 'oom|killed process|mongodump' | tail -20

# If Kubernetes Pod, check exit status
kubectl get pod <backup-pod> -n <namespace> -o jsonpath='{.status.containerStatuses[0].state.terminated.reason}'
```

### Resolution:

1. Increase CPU/Memory limits on the Kubernetes backup CronJob:
   ```yaml
   resources:
     requests:
       memory: "1Gi"
       cpu: "500m"
     limits:
       memory: "4Gi"
       cpu: "2000m"
   ```
2. Adjust compression levels or stream directly into archive format to minimize memory footprint:
   ```bash
   mongodump --archive=/path/to/backup.archive --gzip
   ```

---

## 9. Step 7 — Check Remote / Cloud Upload Failures

If the local dump succeeded but upload to S3 / Cloud Storage / MinIO failed:

```bash
# Test AWS CLI / S3 access
aws s3 ls s3://<backup-bucket-name>/

# Check credentials expiry
aws sts get-caller-identity
```

Look for:

* Expired IAM credentials or IAM role permissions.
* S3 Bucket policy changes or bucket storage quota exceeded.
* Network egress firewall / proxy blocking upload endpoints.
* Clock skew:
  ```bash
  date
  timedatectl status
  ```

---

## 10. Step 8 — Execute a Manual Emergency Backup

Once the blocking issue is resolved, trigger a manual on-demand backup immediately to satisfy RPO.

### Option A — Kubernetes CronJob Manual Trigger:

```bash
# Create an on-demand job from existing cronjob definition
kubectl create job --from=cronjob/mongodb-backup mongodb-backup-manual-$(date +%s) -n <namespace>

# Follow logs
kubectl logs -f job/mongodb-backup-manual-<timestamp> -n <namespace>
```

### Option B — Manual `mongodump` Execution (from secondary):

```bash
# Execute compressed archive dump with oplog consistency
mongodump \
  --host "replicaSet/<secondary-host>:27017" \
  --username "<backup-user>" \
  --password \
  --authenticationDatabase admin \
  --readPreference secondary \
  --oplog \
  --gzip \
  --archive="/var/backups/mongodb/manual_dump_$(date +%Y%m%d_%H%M%S).archive.gz"
```

> Never expose database passwords in plain text in command-line arguments if interactive prompt `-p` is available.

---

## 11. Step 9 — Verify Backup Integrity & Restorability

Confirm the newly created backup is valid:

```bash
# Verify file exists and has reasonable size
ls -lh /var/backups/mongodb/

# Inspect archive table of contents / metadata
mongorestore --archive="/var/backups/mongodb/<backup-file>" --gzip --dryRun
```

If checksums are generated:

```bash
sha256sum /var/backups/mongodb/<backup-file> > /var/backups/mongodb/<backup-file>.sha256
```

---

## 12. Do NOT Do These Things

### ❌ Don't ignore a failed backup alert

A cluster without a recent verified backup has zero disaster recovery protection.

### ❌ Don't run intensive backups against the Primary in peak hours

Use `--readPreference secondary` or connect directly to a dedicated hidden/backup Secondary node to avoid starving the Primary of I/O and CPU.

### ❌ Don't delete old backups before a new one succeeds

If disk space is low, do not delete the last known good backup. Expand disk or offload older backups to cold storage.

### ❌ Don't assume non-empty file means the backup is restorable

Always test with `--dryRun` or periodic automated restore tests into staging.

### ❌ Don't hardcode root/admin credentials in unencrypted backup scripts

Use Kubernetes Secrets, Vault, AWS Secrets Manager, or dedicated restricted `backup` role users.

---

## 13. Quick Reference

```bash
# Check backup cronjobs in Kubernetes
kubectl get cronjob,jobs,pods -A -l app=mongodb-backup

# Check disk space on backup target
df -h /var/backups /mnt/backups

# Check oplog window on MongoDB
mongosh --eval "rs.printReplicationInfo()"

# Manual dry run restore verification
mongorestore --archive=<path-to-archive> --gzip --dryRun

# Inspect S3 bucket backups
aws s3 ls s3://<backup-bucket>/mongodb/ --human-readable
```

---

## 14. Recovery Criteria

- [ ] Failed backup root cause identified and fixed.
- [ ] Manual on-demand backup executed successfully.
- [ ] Backup file/archive size is consistent with database size.
- [ ] Backup archive integrity verified (e.g., via `--dryRun`).
- [ ] Cloud/remote storage upload confirmed.
- [ ] Scheduled backup automation (CronJob/systemd) re-enabled and healthy.
- [ ] Backup alert cleared and monitoring green.

---

## 15. Escalation

Escalate to **Database / SRE** when:

- Oplog window is too small to complete consistent dumps and requires architectural resizing.
- Backup failure is caused by underlying database corruption.
- Backup times exceed maintenance windows and require snapshot/EBS-level backup migration.

Escalate to **Infrastructure / Cloud Team** when:

- Backup storage volumes or S3 bucket quotas need capacity expansion.
- IAM permissions, KMS encryption keys, or cloud storage policies have failed.
- Network throughput to backup destination is throttled or dropping packets.

---

## Golden Rule

```text
Backup Failure
      ↓
DON'T DELETE EXISTING BACKUPS
      ↓
Identify Root Cause (Disk / Auth / Oplog / S3)
      ↓
Fix Root Cause
      ↓
Run Manual Backup Immediately
      ↓
Verify Archive with --dryRun
      ↓
Confirm Automated Schedule & Monitoring
```

> **A backup is only as good as its last verified restore. Resolve backup failures immediately before an operational emergency makes them fatal.**
