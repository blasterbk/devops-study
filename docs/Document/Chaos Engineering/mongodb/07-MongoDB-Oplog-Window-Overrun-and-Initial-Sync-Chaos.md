# MongoDB Chaos Scenario 07: Oplog Window Overrun & Initial Sync Chaos

**Domain:** Data Replication, Oplog Retention, Member Recovery & File-Copy Initial Sync  
**Chaos Type:** Artificial Oplog Window Starvation, Secondary Falling Off Oplog  
**Target:** MongoDB Secondary Member (`legacy-db-3`)  
**Tools:** `kill -STOP` / `kill -CONT`, `mongosh`, `mongostat`, `iostat`

---

## 1. Experiment Overview

If a Secondary member is paused for an extended period (frozen VM snapshot, prolonged network partition, hung backup process, or hardware failure), the Primary's Oplog — a capped collection with a fixed retention window — continues to cycle. When the accumulated write volume exceeds the oplog's total capacity, the Secondary's last synced optime is overwritten. When the Secondary resumes, it discovers that the oplog entries it needs no longer exist and must execute a **full Initial Sync** — copying the entire dataset from scratch.

The primary experiment tests **Oplog Overrun Detection & Automatic File-Copy Initial Sync Recovery**.

A separate optional experiment tests **Oplog Window Sizing & Preventive Capacity Planning**.

> **Important:** MongoDB 5.0+ uses a fast **file-copy-based initial sync** that copies underlying WiredTiger data files directly, which is significantly faster than the legacy document-by-document cloning. However, initial sync still temporarily doubles storage requirements on the source member and consumes significant network bandwidth.

### Experiment A — Oplog Overrun & Initial Sync

```text
Secondary paused via SIGSTOP (simulating VM freeze or hardware hang)
    ↓
Primary continues accepting high-volume writes for extended period
    ↓
Primary's oplog capped collection cycles past Secondary's last optime
    ↓
Secondary resumed via SIGCONT
    ↓
Secondary attempts to resume normal oplog tailing
    ↓
Secondary discovers oplog gap: required entries no longer exist
    ↓
Secondary transitions to STARTUP2 / RECOVERING state
    ↓
Automated file-copy initial sync begins:
    - Copies all data files from sync source
    - Rebuilds indexes
    - Applies oplog entries accumulated during copy
    ↓
Secondary restored to SECONDARY state ✅
```

### Experiment B — Oplog Window Capacity Planning

```text
Calculate write volume per hour from production metrics
    ↓
Determine minimum oplog window for safety (24-72 hours)
    ↓
Resize oplog dynamically (no mongod restart required!)
    ↓
Verify window covers maintenance, backup, and failure scenarios
```

---

## 2. Steady-State Hypothesis

> **When a Secondary member falls off the Primary's Oplog window due to extended disconnection (simulated by SIGSTOP), MongoDB's automatic initial sync mechanism will re-clone the full dataset without crashing, without impacting the Primary's live write throughput by more than 10%, and without requiring any manual DBA intervention. The Secondary will transition through `STARTUP2` → `SECONDARY` cleanly.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Primary Write Throughput | Drops $< 10\%$ during secondary initial sync |
| Automatic Recovery | Secondary transitions to `STARTUP2` then `SECONDARY` without manual steps |
| Data Consistency | Document count on restored Secondary matches Primary exactly |
| Index Rebuild | All indexes present and valid on restored Secondary |
| Oplog Catch-Up | Post-clone oplog application completes without errors |
| Cluster Impact | Remaining members (Primary + other Secondary) unaffected |

---

## 3. Failure Mechanism Architecture

```text
               Oplog Window Overrun & Initial Sync Recovery

┌─────────────────────────────────────────────────────────────┐
│                 PRIMARY (db-1)                              │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ OPLOG (local.oplog.rs) — Capped Collection            │  │
│  │ Size: 50GB (configurable)                             │  │
│  │                                                       │  │
│  │ ┌─────────────────────────────────────────────────┐   │  │
│  │ │ [Oldest Entry]  ◄── Window Start                │   │  │
│  │ │                                                 │   │  │
│  │ │ db-3's last sync point was HERE ── ❌ GONE!     │   │  │
│  │ │ (overwritten by new entries)                    │   │  │
│  │ │                                                 │   │  │
│  │ │ [Newest Entry]  ◄── Window End (current writes) │   │  │
│  │ └─────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  db-2 (SECONDARY) — Synced normally, lag < 1s ✅           │
│                                                             │
│  db-3 (SECONDARY) — PAUSED via SIGSTOP                     │
│    ↓ Resumed via SIGCONT                                    │
│    ↓ Attempts to read oplog from last sync point            │
│    ↓ Entry NOT FOUND in oplog! ❌                           │
│    ↓ Transitions to STARTUP2                                │
│    ↓ Begins file-copy initial sync from db-1 or db-2       │
│    ↓ Copies all WiredTiger .wt files                        │
│    ↓ Rebuilds all indexes                                   │
│    ↓ Applies oplog entries accumulated during copy          │
│    ↓ Transitions to SECONDARY ✅                            │
└─────────────────────────────────────────────────────────────┘
```

### Important Oplog & Initial Sync Mechanics

- **Oplog is a Capped Collection:** The oplog (`local.oplog.rs`) has a fixed maximum size. When it reaches capacity, the oldest entries are automatically overwritten.
- **Oplog Window:** The time span covered by the oplog entries from oldest to newest. If a secondary's last sync point falls before the oldest entry, it cannot resume normal replication.
- **Initial Sync Triggers:** When a secondary cannot find its last optime in the source's oplog, it automatically initiates an initial sync.
- **File-Copy Initial Sync (MongoDB 5.0+):** Copies WiredTiger data files directly from the source, which is much faster than document-by-document cloning.
- **Impact on Source:** The sync source must serve both live traffic AND initial sync data. Network and disk I/O on the source may increase.

---

# 4. Preconditions

Before running the experiment:

### Verify Replica Set health

```javascript
rs.status().members.map(m => ({
  name: m.name,
  stateStr: m.stateStr,
  health: m.health,
  optimeDate: m.optimeDate
}))
```
*Expected: 1 PRIMARY, 2 SECONDARY, all health=1.*

### Check current Oplog retention window

```javascript
// Run on Primary:
rs.printReplicationInfo()
```
*Record:*
- `configured oplog size` (in MB)
- `log length start to end` (the current window in hours)

### Check Secondary replication info

```javascript
rs.printSecondaryReplicationInfo()
```
*Expected: All secondaries $< 2\text{s}$ behind.*

### Verify MongoDB data size (to estimate initial sync duration)

```javascript
use admin;
db.adminCommand({ listDatabases: 1 }).databases.forEach(d => {
  print(d.name + ": " + (d.sizeOnDisk / (1024*1024*1024)).toFixed(2) + " GB");
});
```

### Verify disk space on sync source (initial sync requires temporary extra space)

```bash
df -h /var/lib/mongodb
```

---

# 5. Step 1 — Record Baseline

Record baseline replication state:

### Oplog window

```javascript
let oplog = rs.printReplicationInfo();
```

### Secondary sync status

```javascript
rs.printSecondaryReplicationInfo()
```

### Data sizes

```javascript
let totalSize = db.adminCommand({ listDatabases: 1 }).totalSize;
print("Total dataset size: " + (totalSize / (1024*1024*1024)).toFixed(2) + " GB");
```

### Baseline write throughput

```bash
mongostat -h 127.0.0.1:27017 --rowcount 5 1
```

Record:
- Oplog window (hours)
- Configured oplog size (MB/GB)
- Total dataset size (GB)
- Primary write ops/sec

---

# 6. Step 2 — Freeze Target Secondary Member

### Pause `mongod` on target secondary via SIGSTOP

On `legacy-db-3`:

```bash
# Get mongod PID
MONGOD_PID=$(pgrep mongod)
echo "Freezing mongod process (PID: $MONGOD_PID)..."

# Send SIGSTOP — process is immediately frozen (not killed)
sudo kill -STOP $MONGOD_PID
```

### Verify process is stopped

```bash
ps aux | grep mongod | grep -v grep
```
*Expected: Process status shows `T` (stopped/traced).*

### Verify from Primary that db-3 is unreachable

```javascript
// Run on Primary:
rs.status().members.find(m => m.name.includes("db-3"))
```
*Expected: `stateStr: "(not reachable/healthy)"` or `health: 0` after heartbeat timeout.*

---

# 7. Step 3 — Flood Primary with Writes to Cycle Oplog

Generate enough write volume to push the oplog past db-3's last sync point.

On Primary (`legacy-db-1`):

```javascript
use chaos_test_db;
print("🚀 Starting heavy write flood to cycle oplog...");

for (let b = 0; b < 50; b++) {
  let docs = [];
  for (let i = 0; i < 5000; i++) {
    docs.push({
      batch: b,
      seq: i,
      payload: "z".repeat(5000),  // 5KB per document
      ts: new Date()
    });
  }
  db.bulk_flooder.insertMany(docs, { writeConcern: { w: 1 } });
  print(`Batch ${b+1}/50 inserted (${(b+1) * 5000 * 5 / 1024} MB total)`);
}
print("✅ Write flood complete. Total: ~1.2GB of oplog entries generated.");
```

### Verify oplog window has shrunk

```javascript
rs.printReplicationInfo()
```
*If the write volume exceeded the oplog size, the window will be much shorter than baseline.*

---

# 8. Step 4 — Resume Secondary & Observe Recovery

### Unfreeze `mongod` on db-3

On `legacy-db-3`:

```bash
MONGOD_PID=$(pgrep mongod)
echo "Resuming mongod process (PID: $MONGOD_PID)..."
sudo kill -CONT $MONGOD_PID
```

### Immediately monitor member status from Primary

```javascript
// Run repeatedly on Primary:
rs.status().members.find(m => m.name.includes("db-3"))
```

### Watch for state transitions

```bash
# Monitor mongod log on db-3 for initial sync activity:
sudo tail -f /var/log/mongodb/mongod.log | grep -i -E "initial sync|sync source|STARTUP|RECOVERING|cloning|index build"
```

*Expected state transition sequence:*

```text
T = 0s:   (not reachable/healthy) → RECOVERING
T = 5s:   RECOVERING → STARTUP2
T = 10s:  STARTUP2 — "Starting initial sync..."
T = Ns:   STARTUP2 — "Cloning databases..." / "Copying data files..."
T = Ms:   STARTUP2 — "Creating indexes..."
T = Ps:   STARTUP2 — "Applying oplog entries..."
T = Qs:   STARTUP2 → SECONDARY ✅
```

---

# 9. Step 5 — Monitor Initial Sync Progress

### Check initial sync progress from Primary

```javascript
rs.status().members.find(m => m.name.includes("db-3")).initialSyncStatus
```

### Monitor disk I/O on sync source during initial sync

```bash
iostat -xz 1
```

### Monitor Primary write throughput during initial sync

```bash
mongostat -h 127.0.0.1:27017 --rowcount 30 2
```
*Verify throughput does not drop more than 10%.*

---

# 10. Abort Conditions

```text
ABORT CONDITIONS

- Primary write throughput drops > 25% during initial sync
- Initial sync fails with fatal error in mongod logs
- Secondary transitions to REMOVED or ROLLBACK state
- Sync source runs out of disk space
- Initial sync duration exceeds 4 hours (for large datasets, adjust threshold)
- WiredTiger invariant errors appear in any member's logs
```

---

# 11. Emergency Stop

### If initial sync must be aborted

```bash
# On db-3:
sudo systemctl restart mongod
```
*This will restart mongod and attempt initial sync again from the beginning.*

### If db-3 needs to be removed from the Replica Set

```javascript
// Run on Primary (last resort):
rs.remove("legacy-db-3:27017")
```

---

# 12. Recovery Validation

After initial sync completes and db-3 reports `SECONDARY`:

### Verify all members are healthy

```javascript
rs.status().members.map(m => ({
  name: m.name,
  stateStr: m.stateStr,
  health: m.health,
  optimeDate: m.optimeDate
}))
```
*Expected: 1 PRIMARY, 2 SECONDARY, all health=1.*

### Verify replication lag is minimal

```javascript
rs.printSecondaryReplicationInfo()
```
*Expected: All secondaries $< 2\text{s}$ behind.*

### Verify document count matches across all members

On Primary:
```javascript
use chaos_test_db;
print("Primary count: " + db.bulk_flooder.countDocuments());
```

On db-3:
```javascript
use chaos_test_db;
print("db-3 count: " + db.bulk_flooder.countDocuments());
```
*Expected: Counts match exactly.*

### Verify indexes on restored secondary

```javascript
// Run on db-3:
use chaos_test_db;
db.bulk_flooder.getIndexes()
```
*Expected: All indexes present and matching Primary.*

### Cleanup test data

```javascript
use chaos_test_db;
db.bulk_flooder.drop();
```

---

# 13. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Secondary falls off oplog during routine maintenance | Oplog too small for maintenance window duration | Resize oplog to cover 72+ hours: `db.adminCommand({replSetResizeOplog: 1, size: 102400})` |
| Initial sync takes 12+ hours | Large dataset (500GB+) with slow network or HDD | Use NVMe storage, 10Gbps network, and MongoDB 5.0+ file-copy sync |
| Initial sync fails mid-way | Source member restarted or storage error during copy | Initial sync automatically retries; ensure source stability during sync |
| Primary throughput drops 30% during sync | Sync source is the Primary under heavy load | Configure secondary to sync from another secondary: `rs.syncFrom("db-2:27017")` |
| Repeated oplog overruns in production | Write-heavy workload with small oplog | Monitor oplog window continuously and auto-resize when $< 24\text{h}$ |

---

# 14. Production Hardening: Oplog Sizing & Monitoring

### 1. Dynamically Resize Oplog (No Restart Required)

```javascript
// Resize oplog to 100GB (provides 72+ hours at typical write volume):
db.adminCommand({ replSetResizeOplog: 1, size: 102400 });
```

Verify:

```javascript
rs.printReplicationInfo()
```

### 2. Oplog Window Monitoring Alert

```yaml
- alert: MongoDBOplogWindowCritical
  expr: mongodb_mongod_replset_oplog_window_seconds < 21600  # < 6 hours
  for: 10m
  labels:
    severity: critical
  annotations:
    summary: "MongoDB oplog window on {{ $labels.instance }} is less than 6 hours!"
    description: "Risk of secondary falling off oplog. Resize oplog immediately."

- alert: MongoDBOplogWindowWarning
  expr: mongodb_mongod_replset_oplog_window_seconds < 86400  # < 24 hours
  for: 30m
  labels:
    severity: warning
  annotations:
    summary: "MongoDB oplog window on {{ $labels.instance }} is less than 24 hours."
```

### 3. Oplog Sizing Formula

```text
Minimum Oplog Size = Peak Write Rate (MB/hour) × Required Window (hours) × Safety Factor

Example:
  Peak write rate: 500 MB/hour
  Required window: 72 hours (covers weekend maintenance)
  Safety factor: 1.5x

  Minimum oplog: 500 × 72 × 1.5 = 54,000 MB ≈ 54 GB

  Recommendation: Set to 100 GB for headroom.
```

---

# 15. Experiment Results

| Metric | Baseline | During Freeze | During Initial Sync | Post-Recovery |
|---|---:|---:|---:|---:|
| db-3 State | SECONDARY | (not reachable) | STARTUP2 | SECONDARY |
| Oplog Window (hours) | | | | |
| Primary Write ops/sec | | | | |
| Initial Sync Duration | N/A | N/A | | N/A |
| Document Count Match | ✅ | N/A | N/A | ✅ |
| Replication Lag | $< 1\text{s}$ | N/A | N/A | $< 1\text{s}$ |

---

# 16. Final Assessment

The experiment is considered successful if:

1. Secondary correctly detects oplog gap and initiates initial sync automatically.
2. Initial sync completes without errors or manual intervention.
3. Document counts match exactly between Primary and restored Secondary.
4. All indexes are rebuilt and valid on the restored Secondary.
5. Primary write throughput drops $< 10\%$ during initial sync.
6. Post-sync replication lag converges to $< 2\text{s}$.
7. No data corruption or WiredTiger invariant errors on any member.

---

## Key Technical Takeaways

```text
Oplog = Capped Collection
    =
Fixed size, oldest entries automatically overwritten

Secondary Lag > Oplog Window
    =
Initial Sync Required (full data re-clone)

MongoDB 5.0+ File-Copy Initial Sync
    =
Fast WiredTiger file-level copy (not document-by-document)

Small Oplog + High Write Volume
    =
Frequent initial sync risk during any maintenance or partition

replSetResizeOplog
    =
Dynamic resize WITHOUT mongod restart (MongoDB 4.0+)

Minimum Oplog Window for Production
    =
72 hours (covers weekends, maintenance, and extended outages)

Successful Oplog Overrun Chaos
    =
Automatic initial sync detection
    +
Zero manual DBA intervention
    +
Exact data parity post-recovery
    +
Minimal Primary throughput impact
```
