# Kubernetes Chaos Scenario 04: Database Primary Crash & Failover Chaos

**Domain:** Stateful Workloads, High Availability, Consensus Failover & Client Retry  
**Chaos Type:** Stateful Primary Pod Kill (`SIGKILL`), Instant Leader Failover  
**Target:** MongoDB / Redis StatefulSet Pods on Kubernetes  
**Tools:** Chaos Mesh `PodChaos`, `mongosh`, `redis-cli`, `kubectl`, `pymongo`

---

## 1. Experiment Overview

Stateful database primary pods can crash abruptly due to kernel OOMKills (Exit Code 137), spot instance preemption, node hardware failure, or storage driver panics. Unlike stateless pods, a database primary crash affects all active write connections and triggers a consensus election to promote a new leader.

The primary experiment tests **Sudden Stateful Primary Pod Kill Under Active Write Load**.

A separate optional experiment tests **Client Driver Reconnection & Exponential Backoff Behavior**.

> **Important:** Without `retryWrites=true`, application writes in-flight during the Primary crash will fail with `NotWritablePrimaryError` and be permanently lost. With `retryWrites=true` and `w: "majority"`, the driver buffers and retries the write against the new Primary.

### Experiment A — MongoDB Primary Pod Kill

```text
kubectl delete pod mongodb-0 --grace-period=0 --force
    ↓
Pod terminated with SIGKILL (no preStop hook executed)
    ↓
StatefulSet controller detects missing pod
    ↓
Remaining secondaries detect heartbeat timeout
    ↓
Election called → new Primary in < 10s
    ↓
StatefulSet creates replacement pod (mongodb-0)
    ↓
Replacement pod starts, replays journal, joins as Secondary
    ↓
Application driver retries buffered writes against new Primary
    ↓
Zero lost writes with retryWrites=true!
```

### Experiment B — Redis Master Pod Kill

```text
kubectl delete pod redis-master-0 --grace-period=0 --force
    ↓
Redis Sentinel detects master down (30s timeout by default)
    ↓
Sentinel promotes redis-replica-1 to Master
    ↓
Application connection pool discovers new master via Sentinel
    ↓
Write operations resume against new master
```

---

## 2. Steady-State Hypothesis

> **When the active MongoDB Primary StatefulSet pod is killed with `SIGKILL --grace-period=0` under 500 concurrent writes/second, a healthy Secondary will be elected as new Primary within 10 seconds, the StatefulSet controller will recreate the replacement pod within 30 seconds, and applications with `retryWrites=true` will transparently retry all in-flight writes resulting in zero data loss and $< 0.1\%$ application error rate.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Election Duration (RTO) | New Primary elected and accepting writes in $< 10\text{s}$ |
| Pod Replacement | StatefulSet creates new pod in $< 30\text{s}$ |
| Dropped Writes | Exactly 0 committed write losses |
| Application Error Rate | 5xx errors $< 0.1\%$ during failover window |
| Connection Pool Recovery | Drivers reconnect to new Primary without memory leak |
| Data Consistency | Document count matches across all members post-recovery |
| PVC Reattachment | Persistent Volume reattaches to replacement pod cleanly |

---

## 3. Failure Mechanism Architecture

```text
               StatefulSet Primary Crash & Failover Timeline

┌─────────────────────────────────────────────────────────────┐
│                 KUBERNETES STATEFULSET                      │
│                                                             │
│  T = 0s: mongodb-0 (PRIMARY) killed with SIGKILL           │
│  - All write connections receive RST                        │
│  - Drivers detect NotWritablePrimaryError                   │
│  - retryWrites=true buffers pending writes                  │
│                         ↓                                   │
│  T = 2s: mongodb-1 and mongodb-2 miss heartbeat from       │
│          mongodb-0 (heartbeatIntervalMillis: 1000ms)        │
│                         ↓                                   │
│  T = 5s: electionTimeoutMillis (5000ms) expires             │
│  - mongodb-1 calls election, receives 2/3 vote             │
│                         ↓                                   │
│  T = 6s: mongodb-1 promoted to PRIMARY ✅                   │
│  - Drivers receive topology change event                    │
│  - Buffered writes flush to mongodb-1 successfully!         │
│                         ↓                                   │
│  T = 10s: StatefulSet controller detects missing pod        │
│  - Creates replacement pod mongodb-0                        │
│                         ↓                                   │
│  T = 30s: mongodb-0 (new) starts, replays journal           │
│  - Attaches existing PVC (data preserved!)                  │
│  - Joins replica set as SECONDARY                           │
│  - Catches up from oplog                                    │
│                         ↓                                   │
│  T = 45s: Full cluster healthy: 1 PRIMARY, 2 SECONDARY ✅  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

### Verify StatefulSet health

```bash
kubectl get statefulsets -n database
kubectl get pods -n database -o wide
```

### Verify PVC attachments

```bash
kubectl get pvc -n database
```

### Verify database cluster state

```javascript
// MongoDB:
rs.status().members.map(m => ({name: m.name, stateStr: m.stateStr, health: m.health}))
```

---

# 5. Step 1 — Record Baseline

### Pod state and PVC bindings

```bash
kubectl get pods -n database -o wide
kubectl get pvc -n database
```

### Database replication state

```javascript
rs.printSecondaryReplicationInfo()
```

### Start continuous write verification worker

```python
import pymongo, time, datetime

uri = "mongodb://mongodb-0.mongodb-headless:27017,mongodb-1.mongodb-headless:27017,mongodb-2.mongodb-headless:27017/?replicaSet=rs0&retryWrites=true&w=majority"
client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=15000, retryWrites=True)
db = client.chaos_test_db

success, retried, failed = 0, 0, 0
for i in range(1, 3001):
    t0 = time.time()
    try:
        db.orders.insert_one({"order_id": i, "ts": datetime.datetime.utcnow().isoformat()})
        duration = (time.time() - t0) * 1000
        if duration > 2000:
            retried += 1
            print(f"⚠️ Write {i} retried ({duration:.0f}ms)")
        else:
            success += 1
    except Exception as e:
        failed += 1
        print(f"❌ Write {i} FAILED: {e}")
    time.sleep(0.01)

print(f"\n📊 Results: Success={success}, Retried={retried}, Failed={failed}")
```

---

# 6. Step 2 — Kill Primary Pod

### Chaos Mesh Manifest

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: mongodb-primary-kill
  namespace: chaos-testing
spec:
  action: pod-kill
  mode: one
  selector:
    namespaces:
      - database
    labelSelectors:
      app: mongodb
      role: primary
  gracePeriod: 0
```

### Or via kubectl

```bash
kubectl delete pod mongodb-0 -n database --grace-period=0 --force
```

---

# 7. Step 3 — Monitor Election & Pod Replacement

### Watch pod recreation

```bash
kubectl get pods -n database -w
```

### Watch MongoDB election

```javascript
// Connect to surviving secondary:
rs.status().members.map(m => ({name: m.name, stateStr: m.stateStr, optimeDate: m.optimeDate}))
```

### Watch StatefulSet events

```bash
kubectl describe statefulset mongodb -n database | tail -20
```

---

# 8. Abort Conditions

```text
ABORT CONDITIONS

- All replica set members enter SECONDARY/UNKNOWN (no Primary for > 30s)
- Write failure rate in verification worker exceeds 1%
- StatefulSet fails to recreate pod within 60 seconds
- PVC fails to reattach (Multi-Attach error)
- WiredTiger invariant assertion in mongod logs
```

---

# 9. Emergency Stop

```bash
kubectl delete podchaos mongodb-primary-kill -n chaos-testing
```

If election stalls:

```javascript
// On surviving secondary, force unfreeze:
rs.freeze(0)
```

---

# 10. Recovery Validation

### Verify full cluster health

```javascript
rs.status().members.map(m => ({name: m.name, stateStr: m.stateStr, health: m.health}))
```
*Expected: 1 PRIMARY, 2 SECONDARY, all health=1.*

### Verify write verification results

```javascript
use chaos_test_db;
db.orders.countDocuments()
```
*Expected: Exactly 3000 (zero missing sequence IDs).*

### Verify PVC attachment

```bash
kubectl get pvc -n database
kubectl describe pod mongodb-0 -n database | grep -A 5 "Volumes:"
```

### Cleanup

```javascript
use chaos_test_db;
db.orders.drop();
```

---

# 11. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Writes lost during failover | Missing `retryWrites=true` | Add `retryWrites=true&w=majority` to all connection URIs |
| Election takes $> 25\text{s}$ | `electionTimeoutMillis` too high | Set `electionTimeoutMillis: 5000` |
| PVC fails to reattach | Multi-Attach not supported by CSI driver | Use `ReadWriteOnce` access mode with zone affinity |
| Pod stuck in Pending | Node resources exhausted | Configure PDB and resource requests appropriately |
| Application connection pool leak | Driver does not handle topology change | Upgrade driver to latest version with SDAM support |

---

# 12. Production Hardening

### PodDisruptionBudget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: mongodb-pdb
  namespace: database
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: mongodb
```

### Connection URI Standard

```text
mongodb://mongodb-0:27017,mongodb-1:27017,mongodb-2:27017/app_db?replicaSet=rs0&retryWrites=true&w=majority&serverSelectionTimeoutMS=15000
```

---

# 13. Experiment Results

| Metric | Baseline | Failover Window | Post-Recovery |
|---|---:|---:|---:|
| Primary Node | mongodb-0 | mongodb-1 | mongodb-1 |
| Election Duration | N/A | ~5s | N/A |
| Dropped Writes | 0 | 0 | 0 |
| Retried Writes | 0 | ~20-40 | 0 |
| Pod Replacement Time | N/A | ~25s | N/A |
| Secondary Lag | $< 1\text{s}$ | $< 3\text{s}$ | $< 1\text{s}$ |

---

# 14. Final Assessment & Key Technical Takeaways

```text
StatefulSet Pod Kill
    ≠
Data Loss (if retryWrites=true + w:majority)

PVC Persistence
    =
Data survives pod replacement (journal replay on restart)

electionTimeoutMillis = 5000
    =
Sub-10-second RTO for database failover

retryWrites=true
    =
Driver buffers writes during election window (zero drops)

Successful Database Failover Chaos
    =
Sub-10s election
    +
Zero dropped committed writes
    +
Clean pod replacement with PVC reattach
    +
Full cluster convergence < 60s
```
