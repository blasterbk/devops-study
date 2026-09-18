# MongoDB Chaos Scenario 03: Network Partition, Split-Brain & Rollback Chaos

**Domain:** Distributed Consensus, Oplog Reconciliation & Automated Data Rollback  
**Chaos Type:** Asymmetrical Network Partition, Oplog Divergence, Rollback File Generation  
**Target:** 3-Node MongoDB Replica Set (`legacy-rs` — `db-1`, `db-2`, `db-3`)  
**Tools:** `iptables`, `mongosh`, `bsondump`, `journalctl`, `pymongo`

---

## 1. Experiment Overview

When an active Primary is partitioned into a minority network segment while clients attempt writes, it must step down to prevent dual-primary split-brain. If non-majority writes (`w: 1`) were accepted on the old primary before it noticed quorum loss, MongoDB must automatically execute an **uncommitted write rollback** when the partition heals.

The primary experiment tests **Minority Stepdown and Majority Quorum Preservation**.

A separate optional experiment tests **Oplog Reconciliation, BSON Rollback File Inspection, and Data Recovery**.

> **Important:** With `w: "majority"`, data rollbacks are mathematically impossible because writes are only acknowledged after replication to a majority. Rollbacks only occur when writes are accepted with `w: 1` or `w: 0` and the Primary steps down before those writes replicate.

### Experiment A — Minority Stepdown & Quorum Preservation

```text
db-1 (Primary) isolated from db-2 and db-3
    ↓
db-1 fails to receive heartbeat acks from majority (2/3)
    ↓
db-1 steps down to SECONDARY within electionTimeoutMillis (10 seconds)
    ↓
db-2 and db-3 still have mutual connectivity (2/3 majority)
    ↓
db-2 or db-3 calls election and receives majority vote
    ↓
New Primary elected — cluster accepts writes without split brain!
```

### Experiment B — Oplog Divergence & Rollback on Partition Heal

```text
Before stepdown, db-1 accepted writes with w:1
    ↓
These writes were NOT replicated to db-2 or db-3
    ↓
db-2 elected as new Primary — accepts new writes with w:majority
    ↓
Partition heals — db-1 reconnects to cluster
    ↓
db-1 detects oplog divergence (its uncommitted writes conflict)
    ↓
db-1 rolls back uncommitted writes to BSON file
    ↓
db-1 resyncs from new Primary's oplog
    ↓
Rolled-back data available in /var/lib/mongodb/rollback/ for manual review
```

---

## 2. Steady-State Hypothesis

> **When Primary `db-1` is network-isolated from Secondaries `db-2` and `db-3` via bidirectional `iptables` drop rules, `db-1` will step down to SECONDARY within 10 seconds of losing heartbeat quorum, the majority partition (`db-2` + `db-3`) will elect a new Primary by majority vote within 6 seconds, and upon partition healing, any un-replicated writes from `db-1` will be written safely to a rollback BSON file without crashing the database or causing split-brain dual-write corruption.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Split-Brain Prevention | Never more than 1 PRIMARY in the cluster at any time |
| Minority Stepdown Speed | Isolated Primary steps down in $< 10\text{s}$ |
| Majority Election Speed | Majority partition elects new Primary in $< 6\text{s}$ |
| Write Availability | Majority partition accepts `w: "majority"` writes continuously |
| Rollback Safety | Uncommitted writes saved to `/var/lib/mongodb/rollback/` without data corruption |
| Partition Healing | Reconnected member rejoins cluster as `SECONDARY` without manual repair |
| Post-Healing Convergence | All members report identical optime within 10 seconds |

> Never use `w: 1` in production for critical data. This experiment deliberately uses `w: 1` to demonstrate the rollback mechanism.

---

## 3. Failure Mechanism Architecture

```text
               Network Partition & Rollback Architecture

┌─────────────────────────────────────────────────────────────┐
│                    NETWORK TOPOLOGY                         │
│                                                             │
│  ┌──────────────────────────────┐                           │
│  │ MINORITY PARTITION           │                           │
│  │ ┌──────────────────────────┐ │                           │
│  │ │ db-1 (WAS Primary)       │ │                           │
│  │ │ - Cannot reach db-2/db-3 │ │                           │
│  │ │ - Detects quorum loss    │ │                           │
│  │ │ - Steps down → SECONDARY │ │                           │
│  │ │ - Holds uncommitted w:1  │ │                           │
│  │ │   writes in local oplog  │ │                           │
│  │ └──────────────────────────┘ │                           │
│  └──────────────────────────────┘                           │
│            ╳ ── PARTITION ── ╳                              │
│  ┌──────────────────────────────┐                           │
│  │ MAJORITY PARTITION (2/3)     │                           │
│  │ ┌────────────┐ ┌────────────┐│                           │
│  │ │ db-2       │ │ db-3       ││                           │
│  │ │ → PRIMARY  │ │ SECONDARY  ││                           │
│  │ │ (elected!) │ │            ││                           │
│  │ │ Accepts    │ │            ││                           │
│  │ │ w:majority │ │            ││                           │
│  │ └────────────┘ └────────────┘│                           │
│  └──────────────────────────────┘                           │
│                                                             │
│  POST-HEALING:                                              │
│  db-1 reconnects → detects oplog divergence                 │
│  → rolls back local uncommitted writes to BSON file         │
│  → resyncs from db-2's oplog                                │
│  → becomes healthy SECONDARY                                │
└─────────────────────────────────────────────────────────────┘
```

### Important Consensus & Rollback Mechanics

- **Election Quorum:** MongoDB requires a strict majority ($\lfloor N/2 \rfloor + 1$). In a 3-member set, 2 members must agree.
- **`electionTimeoutMillis`:** Default 10,000ms. If a secondary doesn't receive a heartbeat from the primary for this duration, it calls an election.
- **Write Concern `w: 1`:** Acknowledges the write after it's written to the Primary's journal only. It does NOT wait for replication.
- **Rollback Limit:** MongoDB 4.0+ has no hard rollback size limit but logs all rolled-back documents to BSON files for manual inspection.
- **`w: "majority"` Guarantee:** A write acknowledged with `w: "majority"` has been replicated to $\lfloor N/2 \rfloor + 1$ members. Even if the Primary dies, the data survives on a majority of nodes.

---

# 4. Preconditions

Before running the experiment:

### Verify Replica Set health

```javascript
// Run in mongosh on Primary (db-1):
rs.status().members.map(m => ({
  name: m.name,
  stateStr: m.stateStr,
  health: m.health,
  optimeDate: m.optimeDate
}))
```
*Expected: 1 PRIMARY, 2 SECONDARY, all health=1.*

### Verify bidirectional network connectivity

```bash
# From db-1:
ping -c 3 legacy-db-2.unibotsapi.com
ping -c 3 legacy-db-3.unibotsapi.com
```

### Verify iptables is available

```bash
which iptables
sudo iptables -L -n
```

### Pre-create rollback directory verification

```bash
ls -la /var/lib/mongodb/rollback/ 2>/dev/null || echo "No rollback directory yet (will be created automatically)"
```

### Record election settings

```javascript
rs.conf().settings
```
*Note: `electionTimeoutMillis`, `heartbeatIntervalMillis`, `catchUpTimeoutMillis`.*

---

# 5. Step 1 — Record Baseline

Record baseline cluster state:

### Replica Set member states and optime

```javascript
rs.status().members.map(m => ({
  name: m.name,
  stateStr: m.stateStr,
  optimeDate: m.optimeDate
}))
```

### Current document count in test collection

```javascript
use chaos_test_db;
db.partition_test.countDocuments();
```

### Baseline connection from each member

```bash
# Verify db-1 can connect to db-2 and db-3:
mongosh "mongodb://legacy-db-2:27017" --eval "db.adminCommand('ping')"
mongosh "mongodb://legacy-db-3:27017" --eval "db.adminCommand('ping')"
```

---

# 6. Step 2 — Inject Network Partition

### 6.1 Isolate Primary (`db-1`) from Both Secondaries

On `legacy-db-1`, apply bidirectional packet drop rules:

```bash
# Block outbound traffic to db-2 and db-3
sudo iptables -A OUTPUT -d legacy-db-2.unibotsapi.com -j DROP
sudo iptables -A OUTPUT -d legacy-db-3.unibotsapi.com -j DROP

# Block inbound traffic from db-2 and db-3
sudo iptables -A INPUT -s legacy-db-2.unibotsapi.com -j DROP
sudo iptables -A INPUT -s legacy-db-3.unibotsapi.com -j DROP
```

Verify isolation:

```bash
# These should now fail:
ping -c 1 -W 2 legacy-db-2.unibotsapi.com
ping -c 1 -W 2 legacy-db-3.unibotsapi.com
```
*Expected: `100% packet loss`.*

---

### 6.2 Inject Uncommitted Write on Old Primary (`db-1`)

**IMMEDIATELY** after applying iptables (before db-1 detects quorum loss), attempt a fast local write with `w: 1`:

```javascript
// Run in mongosh directly on db-1 within first 5 seconds:
use chaos_test_db;
try {
  db.uncommitted_writes.insertOne(
    { msg: "THIS_WRITE_WILL_BE_ROLLED_BACK", injected_at: new Date(), chaos: true },
    { writeConcern: { w: 1, wtimeout: 2000 } }
  );
  print("⚠️ Write accepted with w:1 on isolated Primary — this will be rolled back!");
} catch (e) {
  print("✅ Write rejected — Primary already stepped down: " + e.message);
}
```

---

### 6.3 Wait for Minority Stepdown

Wait 10–15 seconds for `db-1` to detect quorum loss and step down:

```javascript
// Run on db-1:
rs.status().myState
// Expected: 2 (SECONDARY)
```

---

# 7. Step 3 — Verify Majority Partition Election

### Check new Primary on majority partition

On `legacy-db-2` or `legacy-db-3`:

```javascript
rs.status().members.map(m => ({
  name: m.name,
  stateStr: m.stateStr,
  optimeDate: m.optimeDate
}))
```
*Expected: Either db-2 or db-3 is now PRIMARY.*

### Inject majority-committed writes on new Primary

```javascript
// Run on the new Primary (e.g., db-2):
use chaos_test_db;
for (let i = 0; i < 100; i++) {
  db.committed_writes.insertOne(
    { msg: "DURABLE_MAJORITY_WRITE", seq: i, ts: new Date() },
    { writeConcern: { w: "majority" } }
  );
}
print("✅ 100 majority-committed writes confirmed on new Primary.");
```

---

# 8. Step 4 — Monitor Partition State

### Verify split-brain has NOT occurred

```javascript
// Check from db-2:
rs.status().members.filter(m => m.stateStr === "PRIMARY").length
```
*Expected: Exactly 1.*

### Check db-1 state (should be SECONDARY or stepping down)

```javascript
// Run on db-1:
rs.status().myState
```
*Expected: 2 (SECONDARY) or transitioning.*

---

# 9. Step 5 — Heal Partition and Observe Rollback

### Remove iptables rules on db-1

```bash
sudo iptables -F
```

### Verify network connectivity restored

```bash
ping -c 3 legacy-db-2.unibotsapi.com
ping -c 3 legacy-db-3.unibotsapi.com
```

### Watch rollback in MongoDB logs

```bash
sudo tail -f /var/log/mongodb/mongod.log | grep -i -E "rollback|reconcil|sync"
```

*Expected log entries:*

```text
[rsBackgroundSync] Starting rollback process against sync source: legacy-db-2:27017
[rsBackgroundSync] rollback 1 operations
[rsBackgroundSync] Rollback completed successfully
[rsBackgroundSync] Rolled back data written to /var/lib/mongodb/rollback/chaos_test_db.uncommitted_writes.<timestamp>.bson
```

---

# 10. Step 6 — Inspect Rolled-Back Data

### List rollback files

```bash
ls -la /var/lib/mongodb/rollback/
```

### Decode rolled-back BSON to JSON

```bash
bsondump /var/lib/mongodb/rollback/chaos_test_db.uncommitted_writes.*.bson
```

*Expected output:*

```json
{"_id":{"$oid":"..."},"msg":"THIS_WRITE_WILL_BE_ROLLED_BACK","injected_at":{"$date":"..."},"chaos":true}
```

This data was NOT committed to the majority and was correctly removed from the oplog during reconciliation. It can be manually re-inserted if business logic requires it.

---

# 11. Abort Conditions

Stop the experiment immediately if:

```text
ABORT CONDITIONS

- Two members simultaneously report stateStr: "PRIMARY" (split-brain detected!)
- Partition healing causes `mongod` to crash with fatal assertion
- Secondary enters unrecoverable `ROLLBACK` state for > 60 seconds
- Application reports data corruption (duplicate _id, missing documents)
- WiredTiger reports invariant violations in mongod logs
```

---

# 12. Emergency Stop & Partition Removal

If the experiment goes wrong, immediately restore network connectivity:

```bash
# On db-1:
sudo iptables -F

# Verify all rules cleared:
sudo iptables -L -n
```

If a member is stuck in `RECOVERING`, force it to resync:

```javascript
// Connect directly to the stuck member:
rs.syncFrom("legacy-db-2:27017")
```

---

# 13. Recovery Validation

After partition healing and rollback completion:

### Verify all members are healthy

```javascript
rs.status().members.map(m => ({
  name: m.name,
  stateStr: m.stateStr,
  health: m.health,
  optimeDate: m.optimeDate
}))
```
*Expected: 1 PRIMARY, 2 SECONDARY, all health=1, all optime within $< 2\text{s}$ of each other.*

### Verify committed writes survived

```javascript
use chaos_test_db;
db.committed_writes.countDocuments();
```
*Expected: Exactly 100.*

### Verify uncommitted writes were rolled back

```javascript
db.uncommitted_writes.countDocuments();
```
*Expected: 0 (the document was rolled back).*

### Verify no residual iptables rules

```bash
sudo iptables -L -n | grep DROP
```
*Expected: No DROP rules.*

### Cleanup test data

```javascript
use chaos_test_db;
db.uncommitted_writes.drop();
db.committed_writes.drop();
db.partition_test.drop();
```

---

# 14. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Production writes lost during partition | Application uses `w: 1` (single-node ack) | **Enforce `w: "majority"` cluster-wide** — eliminates rollbacks mathematically |
| Election takes $> 30\text{s}$ | `electionTimeoutMillis` set too high (e.g. 30000) | Reduce to `electionTimeoutMillis: 5000` in rs.conf |
| Rollback BSON file missing critical business data | No alerting on rollback events | Add log-based alert for `rollback` keyword in mongod.log |
| db-1 enters `ROLLBACK` state for minutes | Large volume of uncommitted writes to roll back | Limit uncommitted write exposure by using `w: "majority"` |
| db-1 needs full Initial Sync after partition | Partition lasted longer than oplog window | Resize oplog to 72+ hours: `db.adminCommand({replSetResizeOplog: 1, size: 102400})` |
| Application connects to old Primary during partition | DNS or connection string not using replica set URI | Always use `mongodb://db-1,db-2,db-3/?replicaSet=legacy-rs` format |

---

# 15. Production Hardening: Eliminate Rollbacks Permanently

### 1. Enforce `w: "majority"` as Cluster Default

```javascript
cfg = rs.conf();
cfg.settings.getLastErrorDefaults = { w: "majority", wtimeout: 5000 };
rs.reconfig(cfg);
```

### 2. Verify Enforcement

```javascript
rs.conf().settings.getLastErrorDefaults
```
*Expected: `{ "w" : "majority", "wtimeout" : 5000 }`.*

### 3. Application Connection URI Standard

```text
mongodb://db-1:27017,db-2:27017,db-3:27017/prod_db?replicaSet=legacy-rs&w=majority&retryWrites=true&readPreference=secondaryPreferred&maxStalenessSeconds=90
```

### 4. Rollback Alert Rule (Prometheus / Log-Based)

```yaml
- alert: MongoDBRollbackOccurred
  expr: mongodb_mongod_replset_oplog_tail_timestamp < mongodb_mongod_replset_oplog_head_timestamp * 0
  for: 0m
  labels:
    severity: critical
  annotations:
    summary: "MongoDB rollback detected on {{ $labels.instance }}! Check /var/lib/mongodb/rollback/ for affected documents."
```

---

# 16. Why `w: 1` in Production Is Unacceptable for Critical Data

```text
w: 1 (Single Node Acknowledgment)
    =
Write confirmed after PRIMARY journal commit ONLY
    =
NOT replicated to any secondary
    =
Vulnerable to rollback on Primary failover

w: "majority" (Quorum Acknowledgment)
    =
Write confirmed after replication to ⌊N/2⌋ + 1 members
    =
Survives any single-node failure
    =
ZERO rollback risk (mathematically impossible)
```

---

# 17. Experiment Results

| Metric | Baseline | Partition Active | Post-Healing | Final State |
|---|---:|---:|---:|---:|
| Primary Node | db-1 | db-2 (new) | db-2 | db-2 |
| db-1 State | PRIMARY | SECONDARY | ROLLBACK → SECONDARY | SECONDARY |
| Split-Brain Count | 0 | 0 | 0 | 0 |
| Uncommitted Writes (w:1) | 0 | 1 (on db-1) | Rolled back | 0 |
| Committed Writes (w:maj) | 0 | 100 (on db-2) | 100 | 100 |
| Rollback BSON Files | 0 | 0 | 1 generated | 1 |
| Election Duration | N/A | ~5s | N/A | N/A |

---

# 18. Final Assessment

The experiment is considered successful if:

1. At no point were two members simultaneously PRIMARY (zero split-brain).
2. The minority Primary stepped down within `electionTimeoutMillis`.
3. The majority partition elected a new Primary and accepted writes.
4. All `w: "majority"` writes survived the partition and are present post-healing.
5. All `w: 1` writes on the isolated Primary were cleanly rolled back to BSON files.
6. The rolled-back data is inspectable via `bsondump`.
7. The healed member rejoined as SECONDARY without manual intervention.
8. All members converged to identical optime within 10 seconds.

---

## Key Technical Takeaways

```text
Network Partition
    ≠
Data Loss (if w: "majority" is configured)

w: "majority"
    =
ZERO rollback risk (mathematically proven)

w: 1
    =
Vulnerable to rollback on ANY failover event

Minority Partition
    =
Steps down (correct behavior, NOT a failure)

Majority Partition
    =
Maintains write availability (2/3 quorum)

Rollback BSON Files
    =
Safety net for data recovery, NOT a normal operating state

Successful Partition Chaos
    =
Zero split-brain
    +
Majority quorum preserved
    +
Uncommitted writes safely rolled back
    +
Clean post-partition convergence
```
