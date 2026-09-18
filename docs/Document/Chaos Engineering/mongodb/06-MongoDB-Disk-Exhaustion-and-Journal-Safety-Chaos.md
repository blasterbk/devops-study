# MongoDB Chaos Scenario 06: Disk Full & Journal Safety Chaos

**Domain:** Storage Resilience, Write-Ahead Logging (WAL), Journal Durability & B-Tree Integrity  
**Chaos Type:** 100% Filesystem Saturation on `/var/lib/mongodb`, Write Rejection Under Full Disk  
**Target:** MongoDB Data Partition (`/var/lib/mongodb`)  
**Tools:** `fallocate`, `df`, `mongosh`, `journalctl`, `lsof`, `systemctl`

---

## 1. Experiment Overview

When `/var/lib/mongodb` runs 100% out of disk space, WiredTiger cannot allocate new journal files, write checkpoint blocks, or create temporary files for sorting operations. The database engine must reject new writes cleanly with filesystem errors, preserve existing journal integrity for committed data, and resume write operations without B-tree corruption once disk capacity is restored.

The primary experiment tests **Clean Write Rejection on 100% Disk Full (Zero Bytes Free)**.

A separate optional experiment tests **Post-Space-Expansion Recovery, Journal Checkpoint Verification, and B-Tree Integrity Validation**.

> **Important:** With `journal.enabled: true` (the default and recommended setting), WiredTiger's Write-Ahead Log guarantees transaction durability. Even on catastrophic disk full, all previously committed data remains 100% recoverable. The engine writes journal entries BEFORE modifying data files, ensuring crash consistency.

### Experiment A — Disk Full & Clean Write Rejection

```text
/var/lib/mongodb reaches 100% capacity (0 Bytes Free)
    ↓
WiredTiger attempts to write journal/checkpoint files
    ↓
Kernel returns ENOSPC (No space left on device)
    ↓
WiredTiger safely aborts current uncommitted write
    ↓
Read queries continue serving from WiredTiger cache
    ↓
Existing journal files preserve ALL committed data!
    ↓
Zero corruption to committed B-tree or journal files!
```

### Experiment B — Space Reclamation & Write Resumption

```text
Administrator deletes chaos filler file
    ↓
Filesystem returns available blocks
    ↓
WiredTiger detects available space
    ↓
Database resumes accepting writes
    ↓
Journal checkpoint completes successfully
    ↓
B-tree integrity verified via validate() command
```

---

## 2. Steady-State Hypothesis

> **When `/var/lib/mongodb` reaches 100% storage capacity for up to 5 minutes, WiredTiger will safely reject new writes with actionable `ENOSPC` filesystem errors, existing read queries against cached and indexed data will remain fully operational, and once disk space is freed or expanded, the database will resume writes cleanly with zero B-tree or journal corruption.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Read Availability | Read queries against cached/indexed collections succeed 100% |
| Clean Write Rejection | Write calls fail fast with `No space left on device` (not crash) |
| Process Integrity | `mongod` does NOT enter fatal panic or restart loop |
| Journal Integrity | No journal corruption; checkpoint resumes after space recovery |
| B-Tree Integrity | `db.collection.validate()` reports zero errors post-recovery |
| Post-Cleanup Write Resumption | Database resumes writes immediately once disk is freed |
| Replica Set Stability | Member does not transition to `RECOVERING` or leave the set |

---

## 3. Failure Mechanism Architecture

```text
               WiredTiger Journal & Checkpoint Under Disk Full

┌─────────────────────────────────────────────────────────────┐
│             /var/lib/mongodb PARTITION (e.g. 100 GB)        │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ JOURNAL FILES (Write-Ahead Log)                       │  │
│  │ - WiredTigerLog.0000000001 through WiredTigerLog.N    │  │
│  │ - Stores ALL write operations BEFORE data file update │  │
│  │ - Maximum 100MB per file, auto-rotated                │  │
│  │ - On disk full: Cannot create new journal file ❌     │  │
│  │   → Write operations rejected with ENOSPC             │  │
│  │   → Existing journal files remain intact ✅           │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ DATA FILES (B-Tree + Indexes)                         │  │
│  │ - collection-*.wt, index-*.wt                         │  │
│  │ - Modified in memory (WiredTiger cache)               │  │
│  │ - Flushed to disk during checkpoint (every 60s)       │  │
│  │ - On disk full: Checkpoint cannot write ❌            │  │
│  │   → Dirty pages remain in cache (safe)                │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 🔴 CHAOS FILLER FILE (100% capacity consumed)         │  │
│  │ /var/lib/mongodb/chaos_disk_hog.img                   │  │
│  │ All available blocks consumed → ENOSPC!               │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Important Journal & Checkpoint Mechanics

- **Write-Ahead Logging (WAL):** WiredTiger writes a journal entry for every mutation BEFORE modifying the data file. On crash recovery, the journal is replayed to restore consistency.
- **Checkpoint Interval:** WiredTiger creates a checkpoint every 60 seconds (or when the journal reaches 2GB). Checkpoints flush dirty pages from cache to data files.
- **Journal File Rotation:** Journal files are limited to ~100MB each. Old journal files are deleted after their corresponding checkpoint completes.
- **Disk Full Impact:** When ENOSPC occurs, WiredTiger cannot write new journal entries or checkpoint files. Existing journal files and data files remain intact.

---

# 4. Preconditions

Before running the experiment:

### Verify MongoDB data partition layout

```bash
df -h /var/lib/mongodb
```

### Verify MongoDB is using a dedicated partition

```bash
mount | grep mongodb
```
*If `/var/lib/mongodb` is on the root partition, creating the filler file will affect the entire OS. Prefer a dedicated partition for this experiment.*

### Verify journal is enabled

```javascript
db.serverStatus().wiredTiger.log
```

### Check current disk usage by MongoDB

```bash
sudo du -sh /var/lib/mongodb/
```

---

# 5. Step 1 — Record Baseline

Record baseline storage and database state:

### Disk capacity

```bash
df -h /var/lib/mongodb
df -i /var/lib/mongodb
```

### MongoDB data sizes

```javascript
use admin;
db.adminCommand({ listDatabases: 1 }).databases.forEach(d => {
  print(d.name + ": " + (d.sizeOnDisk / (1024*1024)).toFixed(2) + " MB");
});
```

### Journal file inventory

```bash
ls -la /var/lib/mongodb/journal/
```

### WiredTiger checkpoint status

```javascript
db.serverStatus().wiredTiger.transaction["transaction checkpoint currently running"]
```

### Baseline write test

```javascript
use chaos_test_db;
let t0 = new Date();
db.disk_test.insertOne({ baseline: true, ts: new Date() }, { writeConcern: { w: "majority" } });
print("Baseline write time: " + (new Date() - t0) + "ms");
```

Record:
- Available disk space (MB)
- Available inodes
- MongoDB total data size
- Journal file count and size
- Baseline write latency

---

# 6. Step 2 — Inject 100% Disk Full

### Calculate remaining space and allocate filler file

```bash
FREE_MB=$(df -m /var/lib/mongodb | awk 'NR==2 {print $4}')
echo "Available space: ${FREE_MB}MB — Allocating filler file to simulate 100% disk full..."

# Leave 0 bytes for standard users (root reserved blocks still available if ext4)
sudo fallocate -l "${FREE_MB}M" /var/lib/mongodb/chaos_disk_hog.img
```

### Verify disk is full

```bash
df -h /var/lib/mongodb
```
*Expected: `Use%` shows `100%` or very near `100%`.*

### Verify standard write failure

```bash
touch /var/lib/mongodb/test_write_file
```
*Expected: `touch: cannot touch '/var/lib/mongodb/test_write_file': No space left on device`.*

---

# 7. Step 3 — Verify MongoDB Write Rejection Behavior

### Attempt a write on disk-full database

```javascript
use chaos_test_db;
try {
  db.disk_test.insertOne({ msg: "testing_disk_full_rejection", ts: new Date() });
  print("⚠️ Write unexpectedly succeeded!");
} catch (e) {
  print("✅ Write correctly rejected: " + e.message);
}
```

### Attempt a bulk write

```javascript
try {
  let docs = [];
  for (let i = 0; i < 100; i++) {
    docs.push({ seq: i, payload: "x".repeat(1024), ts: new Date() });
  }
  db.disk_test.insertMany(docs);
  print("⚠️ Bulk write unexpectedly succeeded!");
} catch (e) {
  print("✅ Bulk write correctly rejected: " + e.message);
}
```

---

# 8. Step 4 — Verify Read Query Availability

### Test read operations during disk full

```javascript
// Reads should work from WiredTiger cache and existing data files:
use chaos_test_db;
let doc = db.disk_test.findOne({ baseline: true });
print("✅ Read query result: " + JSON.stringify(doc));
```

### Test index scan reads

```javascript
db.disk_test.find({ baseline: true }).explain("executionStats").executionStats.executionStages
```

### Test administrative commands

```javascript
db.serverStatus().connections
rs.status().members.length
```

---

# 9. Step 5 — Monitor mongod Process Stability

### Check mongod process status

```bash
systemctl status mongod --no-pager
```
*Expected: `active (running)` — NOT crashed or restarting.*

### Check MongoDB logs for disk errors

```bash
sudo grep -i -E "No space|ENOSPC|disk|journal|checkpoint" /var/log/mongodb/mongod.log | tail -20
```

### Check Replica Set member state

```javascript
rs.status().members.find(m => m.self).stateStr
```
*Expected: Still `PRIMARY` or `SECONDARY` — NOT `RECOVERING`.*

---

# 10. Abort Conditions

```text
ABORT CONDITIONS

- mongod process crashes or enters restart loop
- Filesystem remounts read-only (ro)
- WiredTiger reports invariant violation or assertion failure
- Replica Set member transitions to RECOVERING or UNKNOWN
- Host system becomes unresponsive (SSH hangs)
- Journal corruption detected in mongod logs
```

---

# 11. Emergency Space Reclamation

### Remove the filler file immediately

```bash
sudo rm -f /var/lib/mongodb/chaos_disk_hog.img
```

### Verify space is recovered

```bash
df -h /var/lib/mongodb
```

### If `rm` doesn't free space (process holding open FD)

```bash
# Check for processes holding deleted files:
sudo lsof +L1 | grep chaos_disk_hog
```

If found, restart the holding process:

```bash
sudo systemctl restart mongod
```

---

# 12. Recovery Validation

After removing the filler file:

### Verify database write resumption

```javascript
use chaos_test_db;
try {
  db.disk_test.insertOne({ msg: "post_chaos_write_verified", ts: new Date() }, { writeConcern: { w: "majority" } });
  print("✅ Write succeeded! Database has recovered.");
} catch (e) {
  print("❌ Write still failing: " + e.message);
}
```

### Verify journal checkpoint completes

```bash
sudo grep -i "checkpoint" /var/log/mongodb/mongod.log | tail -5
```
*Expected: `WiredTiger message [WT_VERB_CHECKPOINT]` showing successful checkpoint.*

### Validate B-Tree integrity

```javascript
use chaos_test_db;
let result = db.disk_test.validate({ full: true });
print("Valid: " + result.valid);
print("Errors: " + result.errors.length);
print("Warnings: " + result.warnings.length);
```
*Expected: `Valid: true`, `Errors: 0`.*

### Verify Replica Set convergence

```javascript
rs.status().members.map(m => ({
  name: m.name,
  stateStr: m.stateStr,
  health: m.health
}))
```

### Cleanup test data

```javascript
use chaos_test_db;
db.disk_test.drop();
```

---

# 13. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| mongod crashes on disk full | Old MongoDB version with poor ENOSPC handling | Upgrade to MongoDB 5.0+ with improved WiredTiger error handling |
| `rm` filler file but df still shows full | mongod process holding open file descriptor to deleted file | Check `lsof +L1` and restart mongod to release FD |
| B-Tree corruption after disk-full recovery | Unclean shutdown during disk full (power loss + no journal) | Always enable `journal: true`; use `mongod --repair` only as last resort |
| Replica Set member enters RECOVERING | Oplog application failed during disk full period | Free disk space and wait for automatic oplog catch-up |
| Disk fills repeatedly in production | Missing disk space monitoring and alerting | Deploy Prometheus alert at $< 15\%$ free threshold |
| Temporary sort files consume all space | Large aggregation sorts exceeding `allowDiskUse` spill to disk | Configure `storage.dbPath` on dedicated partition with size limits |

---

# 14. Production Hardening: Disk Monitoring & Partition Layout

### 1. Dedicated MongoDB Partition

```bash
# Mount dedicated partition for MongoDB data:
/dev/sdb1 on /var/lib/mongodb type ext4 (rw,noatime,data=ordered)
```

### 2. Prometheus Disk Space Alert

```yaml
- alert: MongoDBDiskSpaceCritical
  expr: (node_filesystem_free_bytes{mountpoint="/var/lib/mongodb"} / node_filesystem_size_bytes{mountpoint="/var/lib/mongodb"}) * 100 < 15
  for: 3m
  labels:
    severity: critical
  annotations:
    summary: "MongoDB partition on {{ $labels.instance }} has less than 15% free disk space!"
    description: "Current free: {{ $value | humanize }}%. Immediate action required to prevent write failures."

- alert: MongoDBDiskSpaceWarning
  expr: (node_filesystem_free_bytes{mountpoint="/var/lib/mongodb"} / node_filesystem_size_bytes{mountpoint="/var/lib/mongodb"}) * 100 < 25
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "MongoDB partition on {{ $labels.instance }} has less than 25% free disk space."
```

### 3. Automatic Data Compaction (Scheduled)

```javascript
// Run during maintenance window to reclaim fragmented space:
db.runCommand({ compact: "large_collection" })
```

---

# 15. Why Journal Enabled = Data Safety on Disk Full

```text
WRITE PATH WITH JOURNAL:

Application Write Request
    ↓
Write to WiredTiger Journal (WAL) — ON DISK ✅
    ↓
Write acknowledged to client (w: "majority" after replication)
    ↓
Data file updated during next checkpoint (async, 60s interval)

ON DISK FULL:
    ↓
Journal write fails (ENOSPC)
    ↓
Write operation rejected — client receives error
    ↓
Existing journal files INTACT — no data loss for committed writes
    ↓
On space recovery → Journal replayed → Checkpoint completes

WRITE PATH WITHOUT JOURNAL (journal: false — NEVER DO THIS):

Application Write Request
    ↓
Write directly to data file
    ↓
On disk full → Partial write possible
    ↓
B-tree corruption risk!
    ↓
Data recovery may be IMPOSSIBLE
```

---

# 16. Experiment Results

| Metric | Baseline | Disk Full (0 Bytes) | Post-Recovery |
|---|---:|---:|---:|
| Disk Free (%) | | 0% | |
| Write Success | Yes | No (ENOSPC) | Yes |
| Read Success | Yes | Yes (from cache) | Yes |
| mongod Status | Active | Active (NOT crashed) | Active |
| Member State | PRIMARY | PRIMARY | PRIMARY |
| B-Tree Validation | Valid | N/A | Valid |
| Journal Checkpoint | Normal | Paused | Resumed |

---

# 17. Final Assessment

The experiment is considered successful if:

1. `mongod` process remains running throughout the disk full period (no crash or restart).
2. Write operations are cleanly rejected with `ENOSPC` errors (not silent data loss).
3. Read operations continue serving data from WiredTiger cache and existing data files.
4. After disk space recovery, writes resume immediately without manual intervention.
5. `db.collection.validate({ full: true })` reports zero errors post-recovery.
6. Journal checkpoint completes successfully after space recovery.
7. Replica Set member state remains `PRIMARY` or `SECONDARY` throughout.

---

## Key Technical Takeaways

```text
Disk Full (ENOSPC)
    ≠
Data Loss (with journal enabled)

Disk Full
    ≠
Database Crash (WiredTiger handles ENOSPC gracefully)

Read Queries
    =
Continue working from WiredTiger cache during disk full

journal: true
    =
Crash-consistent recovery guarantee (WAL before data write)

journal: false
    =
NEVER acceptable in production (B-tree corruption risk)

rm deleted_file
    ≠
Instant space recovery (check lsof +L1 for open FDs)

Successful Disk Full Chaos
    =
Clean write rejection
    +
Continuous read availability
    +
Zero process crashes
    +
Zero B-tree corruption
    +
Immediate write resumption on space recovery
```
