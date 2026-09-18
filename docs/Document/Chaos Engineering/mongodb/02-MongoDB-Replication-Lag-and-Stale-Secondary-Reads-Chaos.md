# MongoDB Chaos Scenario 02: Replication Lag & Stale Secondary Reads Chaos

**Domain:** Data Freshness, Read Preference, Secondary Synchronization & Oplog Lag  
**Chaos Type:** Network Bandwidth Throttling on Secondary, Artificial Replication Delay  
**Target:** MongoDB Secondary Member (`legacy-db-2` or `legacy-db-3`)  
**Tools:** `tc` (Traffic Control), `mongosh`, `pymongo`, `mongostat`, `iostat`

---

## 1. Experiment Overview

When microservices route queries to Secondary nodes (`readPreference=secondaryPreferred`), network delays or slow disk writes on a secondary induce replication lag. If client drivers lack `maxStalenessSeconds`, users will read severely outdated data — inventory counts may show stale stock, payment statuses may reflect old state, and distributed cache invalidation may break.

The primary experiment tests **Secondary Replication Lag & Driver Read Fallback (`maxStalenessSeconds`)**.

A separate optional experiment tests **Oplog Buffer Window Consumption & Secondary Catch-Up Dynamics**.

> **Important:** `readPreference=secondaryPreferred` without `maxStalenessSeconds` allows clients to read arbitrarily old data from a lagging or frozen secondary. This is a silent data correctness bug, not just a latency issue.

### Experiment A — Secondary Throttling & Automatic Driver Fallback

```text
Secondary network bandwidth throttled via tc (100 kbps)
    ↓
Oplog entries from Primary queue faster than Secondary can apply
    ↓
Secondary replication lag exceeds maxStalenessSeconds threshold (e.g. 90s)
    ↓
Client driver topology scanner detects stale secondary
    ↓
Driver marks lagging secondary as unselectable for reads
    ↓
Queries automatically fall back to Primary or healthy Secondary
    ↓
Data freshness preserved within 10s!
```

### Experiment B — Oplog Buffer Consumption Under Sustained Lag

```text
Secondary paused via SIGSTOP for 2 minutes
    ↓
Primary continues accepting high-volume writes
    ↓
Oplog buffer on Primary accumulates unapplied entries
    ↓
Secondary resumed via SIGCONT
    ↓
Secondary applies backlog at maximum I/O throughput
    ↓
Catch-up rate measured (MB/s) until optime converges
```

---

## 2. Steady-State Hypothesis

> **When 60 seconds of artificial replication lag is injected into Secondary `legacy-db-2` via network bandwidth throttling, client queries configured with `maxStalenessSeconds=90` will detect the lag within one topology scan interval, stop routing queries to the lagging secondary, and transparently redirect reads to the Primary or healthy Secondary, maintaining $< 10\text{s}$ data freshness for all application queries.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Read Data Freshness | Zero application queries return data older than `maxStalenessSeconds` |
| Read Latency | Remains within defined application SLO during fallback routing |
| Fallback Transition | Driver switches read target without throwing connection pool errors |
| Secondary Catch-Up Speed | Secondary catches up at $> 5\text{MB/s}$ once throttling is removed |
| Oplog Window Safety | Oplog window never shrinks below 6 hours during chaos |
| Post-Recovery State | All three members report `SECONDARY` / `PRIMARY` with $< 1\text{s}$ lag |

> Do not assume that `readPreference=secondaryPreferred` provides automatic data freshness guarantees. Without `maxStalenessSeconds`, the driver will happily send queries to a secondary that is hours behind the Primary.

---

## 3. Failure Mechanism Architecture

```text
               Replication Lag & Read Preference Fallback Architecture

┌─────────────────────────────────────────────────────────────┐
│                 APPLICATION DRIVER LAYER                    │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ PyMongo / Mongoose / Go Driver Connection Pool        │  │
│  │ - readPreference: `secondaryPreferred`                │  │
│  │ - maxStalenessSeconds: 90                             │  │
│  │ - heartbeatFrequencyMS: 10000 (topology scan)         │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│         TOPOLOGY SCANNER (Runs every heartbeatFrequencyMS)  │
│         Compares each secondary's `lastWriteDate` against   │
│         Primary's `lastWriteDate`                           │
│                              │                              │
│    ┌─────────────────────────┼─────────────────────────┐    │
│    ▼                         ▼                         ▼    │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ PRIMARY      │  │ SECONDARY (db-2) │  │ SECONDARY    │  │
│  │ (db-1)       │  │ THROTTLED!       │  │ (db-3)       │  │
│  │ Lag: 0s      │  │ Lag: 95s ❌      │  │ Lag: 0.5s ✅ │  │
│  │ Fallback ✅  │  │ BLOCKED BY       │  │ RECEIVES     │  │
│  │              │  │ DRIVER!          │  │ READS ✅     │  │
│  └──────────────┘  └──────────────────┘  └──────────────┘  │
│                              ▲                              │
│                              │  CHAOS INJECTION             │
│                    ┌─────────┴─────────┐                    │
│                    │ Linux `tc` Throttle│                    │
│                    │ Bandwidth: 100kbps │                    │
│                    └───────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

### Important Replication Lag Mechanics

- **Oplog vs Change Stream:** The oplog is a capped collection (`local.oplog.rs`). Secondaries tail the oplog continuously using a long-poll cursor.
- **Staleness Calculation:** The driver computes staleness as: `Primary.lastWriteDate - Secondary.lastWriteDate`. If this exceeds `maxStalenessSeconds`, the secondary is removed from the eligible server list.
- **`heartbeatFrequencyMS`:** The topology scanner runs every 10 seconds by default. This means staleness detection has up to 10 seconds of latency.
- **Catch-Up:** When throttling is removed, the secondary replays buffered oplog entries. Catch-up speed depends on disk I/O and WiredTiger journal write throughput.

---

# 4. Preconditions

Before running the experiment:

### Verify Replica Set health and replication lag

```javascript
// Run in mongosh on Primary:
rs.status().members.map(m => ({
  name: m.name,
  stateStr: m.stateStr,
  optimeDate: m.optimeDate,
  lastHeartbeat: m.lastHeartbeat
}))
```

### Check current oplog window size

```javascript
rs.printReplicationInfo()
```
*Expected: `configured oplog size` and `log length start to end` showing hours of retention.*

### Verify network tools on target secondary

```bash
# On legacy-db-2:
which tc
tc -Version
```
If missing:
```bash
sudo apt update && sudo apt install -y iproute2
```

### Record current secondary replication info

```javascript
rs.printSecondaryReplicationInfo()
```

---

# 5. Step 1 — Record Baseline

Record baseline replication state and query routing behavior:

### Replication lag across all secondaries

```javascript
// Run in mongosh on Primary:
rs.printSecondaryReplicationInfo()
```
*Expected: All secondaries show `0 secs (0 hrs) behind the primary`.*

### Baseline mongostat for operation throughput

```bash
mongostat -h 127.0.0.1:27017 --rowcount 5 1
```

### Baseline read routing verification

```python
import pymongo

uri = "mongodb://legacy-db-1:27017,legacy-db-2:27017,legacy-db-3:27017/?replicaSet=legacy-rs&readPreference=secondaryPreferred&maxStalenessSeconds=90"
client = pymongo.MongoClient(uri)
db = client.chaos_test_db

# Verify which server handles the read
for i in range(5):
    doc = db.baseline_test.find_one()
    print(f"Read served by: {client.address}")
```

Record:
- Replication lag (seconds behind Primary for each secondary)
- Oplog window size (hours of retention)
- Read query routing target (which secondary serves reads)
- Write throughput on Primary (ops/sec)

---

# 6. Step 2 — Progressive Replication Lag Chaos

Do not inject maximum lag immediately. Progress through controlled stages.

Recommended progression:
```text
30s lag → 60s lag → 120s lag (exceeds maxStalenessSeconds threshold)
```

---

## 6.1 Stage 1: Inject Moderate Bandwidth Throttle (500 kbps)

On `legacy-db-2`:

```bash
# Apply bandwidth throttle to MongoDB port traffic
sudo tc qdisc add dev eth0 root handle 1: htb default 11
sudo tc class add dev eth0 parent 1: classid 1:1 htb rate 500kbit ceil 500kbit
sudo tc filter add dev eth0 protocol ip parent 1:0 prio 1 u32 \
  match ip dport 27017 0xffff flowid 1:1
```

Simultaneously flood Primary with moderate writes:

```javascript
// Run in mongosh on Primary:
use chaos_test_db;
for (let i = 0; i < 5000; i++) {
  db.lag_test.insertOne({ seq: i, payload: "x".repeat(2048), ts: new Date() });
}
```

Observe lag:

```javascript
rs.printSecondaryReplicationInfo()
```
*Expected: db-2 shows ~30s behind.*

---

## 6.2 Stage 2: Increase Throttle Severity (100 kbps)

On `legacy-db-2`:

```bash
# Remove existing rule and apply stricter throttle
sudo tc qdisc del dev eth0 root
sudo tc qdisc add dev eth0 root handle 1: htb default 11
sudo tc class add dev eth0 parent 1: classid 1:1 htb rate 100kbit ceil 100kbit
sudo tc filter add dev eth0 protocol ip parent 1:0 prio 1 u32 \
  match ip dport 27017 0xffff flowid 1:1
```

Continue write flood on Primary:

```javascript
use chaos_test_db;
for (let i = 5000; i < 20000; i++) {
  db.lag_test.insertOne({ seq: i, payload: "x".repeat(10240), ts: new Date() });
}
```

---

## 6.3 Stage 3: Push Lag Beyond `maxStalenessSeconds` (> 90s)

Continue heavy writes on Primary until Secondary lag exceeds 90 seconds:

```javascript
use chaos_test_db;
for (let b = 0; b < 50; b++) {
  let docs = [];
  for (let i = 0; i < 1000; i++) {
    docs.push({ batch: b, payload: "z".repeat(10240), ts: new Date() });
  }
  db.lag_test.insertMany(docs);
}
```

Check lag:

```javascript
rs.printSecondaryReplicationInfo()
```
*Expected: db-2 shows $> 90\text{s}$ behind Primary.*

---

# 7. Step 3 — Monitor Driver Read Routing Behavior

This is the critical validation step. Verify that the application driver stops sending reads to the lagging secondary.

### Run read routing test harness

```python
import pymongo, time

uri = "mongodb://legacy-db-1:27017,legacy-db-2:27017,legacy-db-3:27017/?replicaSet=legacy-rs&readPreference=secondaryPreferred&maxStalenessSeconds=90"
client = pymongo.MongoClient(uri)
db = client.chaos_test_db

print("🚀 Monitoring read routing during replication lag chaos...")
for i in range(60):
    try:
        doc = db.lag_test.find_one(sort=[("seq", -1)])
        # Check which server handled the read
        server_info = client.topology_description
        latest_seq = doc['seq'] if doc else 'None'
        print(f"[T+{i}s] Latest Record seq={latest_seq}")
    except Exception as e:
        print(f"[T+{i}s] ❌ Read Error: {e}")
    time.sleep(1)
```

### Expected Behavior

1. Initially, reads may hit `legacy-db-2` (the throttled secondary).
2. After topology scanner detects lag $> 90\text{s}$, reads redirect to `legacy-db-3` or Primary.
3. Data freshness (latest `seq` value) should always be within 10 seconds of the Primary's latest write.

---

# 8. Step 4 — Verify Oplog Window Safety

During sustained lag, verify that the Primary's oplog window has not shrunk dangerously:

```javascript
// Run in mongosh on Primary:
rs.printReplicationInfo()
```

If `log length start to end` drops below 6 hours, this indicates the oplog is cycling too fast for the lagging secondary to ever catch up, risking an **Initial Sync** requirement.

---

# 9. Step 5 — Verify Application & Database Health

### Check application response latency during chaos

```bash
curl -w "\nStatus: %{http_code} | Total Time: %{time_total}s\n" \
     -o /dev/null \
     -s \
     https://api.example.com/health
```

### Check MongoDB current operations

```javascript
db.currentOp().inprog.filter(op => op.secs_running > 5)
```

### Check WiredTiger ticket availability

```javascript
db.serverStatus().wiredTiger.concurrentTransactions
```

---

# 10. Abort Conditions

Stop the experiment immediately if any of the following occur:

```text
ABORT CONDITIONS

- Primary's oplog window shrinks below 2 hours (risk of Initial Sync requirement)
- Application 5xx error rate exceeds 1% sustained
- Secondary transitions to `RECOVERING` or `STARTUP2` state
- MongoDB connection pool errors (`MongoServerSelectionError`) cascade
- WiredTiger read/write ticket queues hit 0 available
```

---

# 11. Emergency Stop & Filter Removal

Remove all traffic control rules on the throttled secondary:

```bash
# On legacy-db-2:
sudo tc qdisc del dev eth0 root 2>/dev/null || true
```

Verify filter removal:

```bash
sudo tc qdisc show dev eth0
```
*Expected: Default `fq_codel` or `noqueue` without htb.*

---

# 12. Recovery Validation

After removing the throttle, monitor secondary catch-up:

### Watch replication lag converge in real time

```bash
watch -n 2 'mongosh --quiet --eval "rs.printSecondaryReplicationInfo()"'
```

### Measure catch-up throughput

```bash
# Monitor disk I/O on secondary during catch-up:
iostat -xz 1 10
```

### Verify final convergence

```javascript
rs.status().members.map(m => ({
  name: m.name,
  stateStr: m.stateStr,
  optimeDate: m.optimeDate
}))
```
*Expected: All members within $< 1\text{s}$ of each other.*

### Verify read routing returns to normal

Run the read routing test harness again and confirm reads are distributed across both secondaries.

### Cleanup test data

```javascript
use chaos_test_db;
db.lag_test.drop();
db.baseline_test.drop();
```

---

# 13. Replication Lag vs Oplog Overrun vs Initial Sync

These are distinct failure escalation stages:

| Stage | Condition | System Impact | Observable Metric |
|---|---|---|---|
| **Healthy Replication** | Lag $< 2\text{s}$ | Normal read distribution | `rs.printSecondaryReplicationInfo()` shows $< 2\text{s}$ |
| **Moderate Lag** | Lag $2\text{s} - 60\text{s}$ | Secondary serves slightly stale reads | `maxStalenessSeconds` may still allow reads |
| **Staleness Threshold Exceeded** | Lag $> \text{maxStalenessSeconds}$ | Driver stops routing reads to lagging secondary | Driver logs show server removed from selection |
| **Oplog Overrun** | Secondary's last optime no longer in Primary oplog | Secondary cannot resume normal replication | Secondary transitions to `RECOVERING` / `STARTUP2` |
| **Initial Sync Required** | Oplog gap is unrecoverable | Full data copy from Primary to Secondary | `rs.status()` shows `initialSyncStatus` progress |

---

# 14. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Application reads stale data for minutes | `maxStalenessSeconds` not configured in connection URI | Add `&maxStalenessSeconds=90` to all production MongoDB connection strings |
| Driver never switches away from stale secondary | `heartbeatFrequencyMS` set too high (e.g. 60s) | Reduce `heartbeatFrequencyMS=10000` (10 seconds) for faster detection |
| Secondary enters `RECOVERING` after long lag | Oplog window cycled past secondary's optime | Resize oplog to 72+ hours: `db.adminCommand({replSetResizeOplog: 1, size: 102400})` |
| Catch-up takes hours after throttle removal | Secondary disk I/O too slow for oplog replay | Upgrade secondary storage to NVMe / provisioned IOPS |
| All reads route to Primary during chaos | Only 2 secondaries and both lagging | Add a third secondary or use `readPreference=nearest` with `maxStalenessSeconds` |
| Connection pool errors during failover | `serverSelectionTimeoutMS` too short | Increase `serverSelectionTimeoutMS=15000` |

---

# 15. Production Hardening: Mandatory Driver Configuration

### Standard Production Connection URI

```text
mongodb://db-1:27017,db-2:27017,db-3:27017/prod_db?replicaSet=legacy-rs&readPreference=secondaryPreferred&maxStalenessSeconds=90&w=majority&retryWrites=true&retryReads=true&serverSelectionTimeoutMS=15000&heartbeatFrequencyMS=10000
```

### Why Each Parameter Matters

| Parameter | Value | Purpose |
|---|---|---|
| `readPreference` | `secondaryPreferred` | Distribute reads to reduce Primary load |
| `maxStalenessSeconds` | `90` | Reject reads from secondaries $> 90\text{s}$ behind |
| `w` | `majority` | Guarantee write durability across quorum |
| `retryWrites` | `true` | Auto-retry transient write failures |
| `retryReads` | `true` | Auto-retry transient read failures |
| `serverSelectionTimeoutMS` | `15000` | Allow 15s for driver to find eligible server |
| `heartbeatFrequencyMS` | `10000` | Scan topology every 10s for staleness detection |

### Oplog Sizing for Production

```javascript
// Resize oplog to 100GB (72+ hours retention at typical write volume):
db.adminCommand({ replSetResizeOplog: 1, size: 102400 });
```

---

# 16. Why `readPreference=secondary` Without `maxStalenessSeconds` Is Not Safe

```text
readPreference=secondaryPreferred
    +
maxStalenessSeconds=90
    =
Automatic stale-read protection

readPreference=secondaryPreferred
    -
maxStalenessSeconds (MISSING!)
    =
Silent data correctness bug: reads may return hours-old data

The driver CANNOT know data is stale without maxStalenessSeconds.
It only checks if the server is alive, not if the data is fresh.
```

---

# 17. Experiment Results

Record the results after the experiment:

| Metric | Baseline | 500kbps (~30s lag) | 100kbps (~90s lag) | Lag > 90s (Threshold) | Recovery |
|---|---:|---:|---:|---:|---:|
| Secondary Lag (s) | $< 1$ | ~30 | ~90 | $> 90$ (exceeded) | $< 1$ |
| Reads to db-2 | Yes | Yes | Yes | **No (Blocked)** | Yes |
| Reads to db-3 | Yes | Yes | Yes | **Yes (Fallback)** | Yes |
| Data Freshness (s) | $< 1$ | $< 1$ | $< 1$ | $< 1$ (routed away) | $< 1$ |
| App Error Rate | 0% | 0% | 0% | 0% | 0% |
| Catch-Up Speed (MB/s) | N/A | N/A | N/A | N/A | |

---

# 18. Final Assessment

The experiment is considered successful if:

1. The driver correctly detects secondary staleness within one `heartbeatFrequencyMS` cycle.
2. All application reads maintain data freshness within `maxStalenessSeconds`.
3. Zero application errors occur during read routing transitions.
4. The lagging secondary catches up to Primary within 5 minutes of throttle removal.
5. Oplog window remains safely above 6 hours throughout the experiment.
6. Post-recovery, all members report synchronized optime.

---

## Key Technical Takeaways

```text
readPreference=secondaryPreferred
    ≠
Automatic data freshness guarantee

maxStalenessSeconds
    =
REQUIRED for stale-read protection (not optional)

Secondary Replication Lag
    ≠
Secondary Failure (member is healthy but delayed)

Oplog Window Exhaustion
    =
Escalation from "lag" to "full initial sync required"

Successful Replication Lag Chaos
    =
Controlled bandwidth degradation
    +
Driver detects and bypasses stale secondary
    +
Zero stale reads returned to application
    +
Clean secondary catch-up post-chaos
```
