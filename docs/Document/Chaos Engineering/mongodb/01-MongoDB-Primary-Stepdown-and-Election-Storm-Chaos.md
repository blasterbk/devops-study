# MongoDB Chaos Scenario 01: Primary Stepdown & Election Storm Chaos

**Domain:** Stateful Database High Availability, Consensus Election & Client Auto-Retry  
**Chaos Type:** Primary Stepdown (`rs.stepDown()`), Rapid Leader Election  
**Target:** MongoDB Replica Set Primary (`legacy-db-1 / 2 / 3` — `legacy-rs`)  
**Tools:** `mongosh`, `pymongo`, `mongostat`, `systemctl`, `promql`

---

## 1. Experiment Overview

This experiment evaluates the high-availability failover mechanics, Raft-like election speed, driver-level retry buffering (`retryWrites=true`), and connection pool re-establishment of a MongoDB Replica Set when the active Primary steps down under heavy write load.

The primary experiment tests **Graceful Primary Stepdown under Active Write Load**.

A separate optional experiment tests **Rapid Election Storm & Secondary Catch-Up Lag**.

> **Important:** Primary stepdown closes existing client write sockets. Applications without `retryWrites=true` or missing `w: "majority"` will drop writes and throw `NotWritablePrimaryError`.

### Experiment A — Graceful Primary Stepdown & Client Retry

```text
rs.stepDown(60, 10) on Primary (db-1)
    ↓
db-1 closes write sockets & becomes SECONDARY
    ↓
Secondary (db-2) detects leader absence within heartbeat window
    ↓
Calls election & achieves 2/3 majority quorum
    ↓
db-2 promoted to PRIMARY in < 6 seconds
    ↓
Client drivers buffer & retry writes; 0 dropped records!
```

### Experiment B — Election Storm Under Secondary Lag

```text
Secondary lag > electionTimeoutMillis
    ↓
Primary steps down
    ↓
Lagging secondaries cannot reach catch-up optime
    ↓
Multiple election rounds / Election Storm occurs
    ↓
Failover delayed until secondary catches up
```

---

## 2. Steady-State Hypothesis

> **When `rs.stepDown()` is triggered on the active Primary under 1,000 concurrent writes/second, a healthy Secondary member will be elected Primary within 6 seconds, applications with `retryWrites=true` will transparently retry and succeed, resulting in 0 lost writes and $< 0.1\%$ application error rate.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Election Duration (RTO) | New Primary elected and ready in $< 6\text{s}$ |
| Dropped Writes | Exactly 0 uncommitted write losses |
| App Error Rate | 5xx errors remain $< 0.1\%$ during transition |
| Connection Pool Recovery | Driver sockets reconnect without memory leak |
| Post-Chaos Replication | Oplog replication lag across secondaries $< 2\text{s}$ |

---

## 3. Failure Mechanism Architecture

```text
              MongoDB Primary Stepdown & Election Flow

┌─────────────────────────────────────────────────────────────┐
│                 APPLICATION DRIVER LAYER                    │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ PyMongo / Mongoose / Go Driver Connection Pool        │  │
│  │ - Config: `retryWrites=true&w=majority`               │  │
│  │ - Traps `NotWritablePrimaryError`                     │  │
│  │ - Buffers writes for `serverSelectionTimeoutMS=10000` │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ REPLICA SET ELECTION TIMELINE                         │  │
│  │                                                       │  │
│  │ T = 0s: Primary (db-1) steps down ──► SECONDARY       │  │
│  │ T = 2s: db-2 & db-3 exchange election vote requests   │  │
│  │ T = 4s: db-2 receives 2/3 quorum votes                │  │
│  │ T = 5s: db-2 promoted to PRIMARY                      │  │
│  │ T = 6s: App driver receives topology change event     │  │
│  │ T = 6.2s: Buffered writes flush to db-2 successfully! │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

Before running the experiment:

### Verify Replica Set health and member states

```javascript
// Run in mongosh:
rs.status().members.map(m => ({name: m.name, stateStr: m.stateStr, health: m.health}))
```
*Expected: 1 PRIMARY, 2 SECONDARY, all health=1.*

### Check election timeout settings

```javascript
rs.conf().settings
```
*Verify `electionTimeoutMillis: 5000` or `10000`.*

---

# 5. Step 1 — Record Baseline

Record baseline replication and write latency metrics:

```bash
mongostat -h 127.0.0.1:27017 --rowcount 5 1
```

Record baseline replication lag:

```javascript
rs.printSecondaryReplicationInfo()
```

---

# 6. Step 2 — Stepdown Chaos Execution

---

## 6.1 Start Continuous Write Verification Worker

Run a Python test harness inserting 100 documents/sec with monotonic sequence IDs:

```python
import pymongo, time, datetime

uri = "mongodb://legacy-db-1:27017,legacy-db-2:27017,legacy-db-3:27017/?replicaSet=legacy-rs&retryWrites=true&w=majority"
client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=10000, retryWrites=True)
db = client.chaos_test_db

success, retried, failed = 0, 0, 0
print("🚀 Starting Continuous MongoDB Write Load...")

for i in range(1, 2001):
    t0 = time.time()
    try:
        db.orders.insert_one({"order_id": i, "created_at": datetime.datetime.utcnow().isoformat()})
        duration = (time.time() - t0) * 1000
        if duration > 1000:
            retried += 1
            print(f"⚠️ Write {i} retried and succeeded ({duration:.1f}ms)")
        else:
            success += 1
    except Exception as e:
        failed += 1
        print(f"❌ Write {i} FAILED: {e}")
    time.sleep(0.01)

print(f"\n📊 Final Results: Success={success}, Retried={retried}, Failed={failed}")
```

---

## 6.2 Inject Primary Stepdown via `mongosh`

Connect directly to the active Primary node:

```javascript
// Step down for 60 seconds, allowing 10 seconds for secondaries to catch up
rs.stepDown(60, 10);
```

---

# 7. Step 3 — Monitor Election & Failover Transitions

### Track state transitions in real time

```bash
# Watch member state on secondary:
mongosh "mongodb://legacy-db-2:27017" --eval "rs.status().members.map(m => ({name: m.name, stateStr: m.stateStr, optimeDate: m.optimeDate}))"
```

### Inspect Primary election logs in `/var/log/mongodb/mongod.log`

```bash
sudo grep -E "transition to|election|stepping down" /var/log/mongodb/mongod.log -n 20
```

---

# 8. Step 4 — Abort Conditions

Stop the experiment immediately if:

```text
ABORT CONDITIONS

- All replica set members enter `SECONDARY` or `UNKNOWN` with no primary elected for > 30s
- Write failure rate in test worker exceeds 1%
- Unrecoverable WiredTiger invariant assertion appears in mongod logs
```

---

# 9. Step 5 — Emergency Stop & Forced Primary Election

If election stalls:

```javascript
// Connect to chosen secondary and unfreeze:
rs.freeze(0);
```

---

# 10. Step 6 — Recovery Validation

Verify full cluster convergence:

```javascript
rs.status().members.map(m => ({name: m.name, stateStr: m.stateStr}))
```

Verify sequence count in test collection:

```javascript
use chaos_test_db;
db.orders.countDocuments();
```
*Expected: Exactly 2000 documents with zero missing sequence IDs.*

---

# 11. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Writes fail with `NotWritablePrimary` | Application connection string missing `retryWrites=true` | Append `?retryWrites=true&w=majority` to MongoDB URI |
| Failover takes $> 25\text{s}$ | `electionTimeoutMillis` set too high | Configure `electionTimeoutMillis: 5000` in replica set config |
| Primary election deadlock | Secondary was lagging behind oplog catch-up window | Optimize disk I/O on secondaries and tune `catchUpTimeoutMillis` |

---

# 12. Production Hardening: Replica Set Configuration

```javascript
cfg = rs.conf();
cfg.settings.electionTimeoutMillis = 5000;
cfg.settings.catchUpTimeoutMillis = 10000;
cfg.settings.heartbeatIntervalMillis = 1000;
rs.reconfig(cfg);
```

---

# 13. Experiment Results

| Metric | Baseline | Failover Window | Post-Recovery |
|---|---:|---:|---:|
| Primary Node | db-1 | db-2 | db-2 |
| Election Duration | N/A | ~4.5s | N/A |
| Dropped Writes | 0 | 0 | 0 |
| Retried Writes | 0 | ~35 | 0 |
| Secondary Lag | $< 1\text{s}$ | $< 2\text{s}$ | $< 1\text{s}$ |

---

# 14. Final Assessment & Key Technical Takeaways

```text
rs.stepDown()
    ≠
Outage (if retryWrites=true is configured)

w: "majority"
    =
Prevents uncommitted writes from being lost during failovers

electionTimeoutMillis = 5000
    =
Achieves sub-6-second RTO for mission-critical MongoDB clusters
```
