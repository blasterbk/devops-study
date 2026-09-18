# Kubernetes Chaos Scenario 08: Storage I/O Latency & Corruption Chaos

**Domain:** Storage, CSI Drivers, Filesystem Resilience & Database Journal Safety  
**Chaos Type:** `IOChaos` (Disk Latency, Injected I/O Errors `EIO`/`ENOSPC`, IOPS Throttling)  
**Target:** Persistent Volumes, CSI Block Storage, Database Data Directories  
**Tools:** Chaos Mesh `IOChaos`, FUSE intercepts, `iostat`, `kubectl`

---

## 1. Experiment Overview

Cloud block storage devices (AWS EBS, GCE PD, Linode Block Storage, Ceph RBD) frequently suffer from I/O latency spikes when cloud storage multi-tenant noisy neighbors throttle throughput, burst credits are exhausted (AWS GP2/GP3), or underlying storage controller maintenance occurs. These latency spikes cause database `fsync()` calls to hang, write-ahead log commits to stall, and B-tree checkpoint operations to timeout.

The primary experiment tests **Disk Write Latency Injection & Database Engine Throttling**.

A separate optional experiment tests **POSIX I/O Error Injection (`EIO`) and Journal Integrity Validation**.

> **Important:** `IOChaos` in Chaos Mesh uses a FUSE filesystem intercept layer to inject latency and errors into specific file paths. This works at the POSIX level — the application sees the delays as if the actual storage device is slow. The underlying storage is not actually damaged.

### Experiment A — Write Latency Injection

```text
IOChaos injects 500ms delay on all writes to /data/db/
    ↓
WiredTiger journal commit takes 500ms instead of 1ms
    ↓
Write operation queue depth increases
    ↓
Application experiences elevated p99 write latency
    ↓
Database engine throttles write acceptance rate
    ↓
Application connection timeout triggers retry/backoff
```

### Experiment B — I/O Error Injection (`EIO`)

```text
IOChaos injects 5% EIO errors on read operations
    ↓
Database engine receives unexpected read failure
    ↓
Engine retries read from journal/WAL
    ↓
If retry succeeds → transparent recovery
    ↓
If retry fails → engine logs error and may transition to read-only mode
```

---

## 2. Steady-State Hypothesis

> **When 500ms disk write latency and a 5% `EIO` read error rate are injected into the MongoDB data directory (`/data/db/`) for 5 minutes, the WiredTiger storage engine will throttle write admission, journal commits will complete successfully (with elevated latency), no data or journal corruption will occur, and the database will recover to normal performance within 30 seconds of chaos removal.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Engine Stability | No `mongod` crash, assertion failure, or unhandled `EIO` panic |
| Journal Integrity | Zero journal corruption; all checkpoints valid post-chaos |
| Data File Integrity | `db.collection.validate()` reports 0 errors |
| Write Queue Recovery | Write operation queue clears within 30 seconds post-chaos |
| Read Availability | Read queries from cache continue uninterrupted |
| Application Impact | p99 latency increases but no connection pool exhaustion |

---

## 3. Failure Mechanism Architecture

```text
               Storage I/O Path Under Chaos Mesh FUSE Intercept

┌─────────────────────────────────────────────────────────────┐
│                 DATABASE POD                                │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ WiredTiger Storage Engine                             │  │
│  │ - Journal commit: write() + fsync() to /data/db/     │  │
│  │ - Checkpoint: flush dirty pages to data files         │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ CHAOS MESH FUSE INTERCEPT LAYER                       │  │
│  │ - Intercepts POSIX file operations on /data/db/       │  │
│  │ - Injects: 500ms write delay + 5% EIO on reads       │  │
│  │ - Transparent to application (looks like slow disk)   │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ PERSISTENT VOLUME (CSI / EBS / Block Storage)         │  │
│  │ - Actual hardware: normal performance                 │  │
│  │ - FUSE layer masks actual performance                 │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

### Verify target pod and PV/PVC

```bash
kubectl get pods -n database -o wide
kubectl get pvc -n database
kubectl describe pvc mongodb-data-mongodb-0 -n database
```

### Verify Chaos Mesh supports IOChaos

```bash
kubectl get crd | grep iochaos
```

### Verify storage class

```bash
kubectl get storageclass
```

---

# 5. Step 1 — Record Baseline

### Baseline write latency

```javascript
// In mongosh:
let t0 = new Date();
db.io_test.insertOne({baseline: true, ts: new Date()}, {writeConcern: {w: "majority"}});
print("Write latency: " + (new Date() - t0) + "ms");
```

### Baseline I/O from inside pod

```bash
kubectl exec -it mongodb-0 -n database -- iostat -xz 1 3
```

---

# 6. Step 2 — Inject Storage Latency

### Chaos Mesh `IOChaos` Manifest — Write Latency

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: IOChaos
metadata:
  name: mongodb-storage-latency
  namespace: chaos-testing
spec:
  action: latency
  mode: one
  selector:
    namespaces:
      - database
    labelSelectors:
      app: mongodb
  volumePath: /data/db
  path: "/data/db/**/*"
  delay: "500ms"
  percent: 100
  duration: "5m"
  attr:
    perm: 0644
```

### Chaos Mesh `IOChaos` Manifest — Read Error Injection

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: IOChaos
metadata:
  name: mongodb-storage-eio
  namespace: chaos-testing
spec:
  action: fault
  mode: one
  selector:
    namespaces:
      - database
    labelSelectors:
      app: mongodb
  volumePath: /data/db
  path: "/data/db/**/*.wt"
  errno: 5              # EIO (Input/output error)
  percent: 5
  duration: "5m"
```

Apply:

```bash
kubectl apply -f mongodb-storage-latency.yaml
kubectl apply -f mongodb-storage-eio.yaml
```

---

# 7. Step 3 — Monitor Database Performance During Chaos

### Measure elevated write latency

```javascript
for (let i = 0; i < 20; i++) {
  let t0 = new Date();
  try {
    db.io_test.insertOne({seq: i, ts: new Date()});
    print("Write " + i + ": " + (new Date() - t0) + "ms");
  } catch (e) {
    print("Write " + i + " FAILED: " + e.message);
  }
}
```

### Check WiredTiger cache and checkpoint

```javascript
let cache = db.serverStatus().wiredTiger.cache;
print("Dirty %: " + ((cache["tracked dirty bytes in the cache"] / cache["maximum bytes configured"]) * 100).toFixed(2));
```

### Check mongod logs for I/O errors

```bash
kubectl logs mongodb-0 -n database --tail=50 | grep -i -E "error|EIO|slow|journal"
```

---

# 8. Abort Conditions

```text
ABORT CONDITIONS

- mongod crashes with fatal assertion or panic
- WiredTiger invariant violation in logs
- Journal corruption detected
- Read queries return incorrect data
- Pod enters CrashLoopBackOff
- Storage controller reports actual hardware errors (not FUSE-injected)
```

---

# 9. Emergency Stop

```bash
kubectl delete iochaos mongodb-storage-latency -n chaos-testing
kubectl delete iochaos mongodb-storage-eio -n chaos-testing
```

---

# 10. Recovery Validation

### Verify write latency returns to baseline

```javascript
let t0 = new Date();
db.io_test.insertOne({recovery: true, ts: new Date()});
print("Post-chaos write latency: " + (new Date() - t0) + "ms");
```
*Expected: $< 10\text{ms}$.*

### Validate data integrity

```javascript
let result = db.io_test.validate({full: true});
print("Valid: " + result.valid);
print("Errors: " + result.errors.length);
```

### Verify journal checkpoint

```bash
kubectl logs mongodb-0 -n database --tail=20 | grep checkpoint
```

### Cleanup

```javascript
db.io_test.drop();
```

---

# 11. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Write latency spikes to $> 5\text{s}$ | Cloud burst credits exhausted (GP2) | Upgrade to GP3 with provisioned IOPS |
| EIO errors cause engine crash | Old MongoDB version with poor I/O error handling | Upgrade to MongoDB 5.0+ with improved error resilience |
| Checkpoint stalls for minutes | Journal write latency exceeds checkpoint interval | Tune `storage.journal.commitIntervalMs` and improve storage perf |
| Data corruption after power loss | No journal enabled or fsync disabled | Always use `journal: true` and `fsync: true` |

---

# 12. Production Hardening

### Storage Class with Provisioned IOPS

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: high-iops-ssd
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  iops: "5000"
  throughput: "250"
volumeBindingMode: WaitForFirstConsumer
```

### MongoDB Storage Configuration

```yaml
storage:
  dbPath: /data/db
  journal:
    enabled: true
    commitIntervalMs: 100
  wiredTiger:
    engineConfig:
      journalCompressor: snappy
      cacheSizeGB: 6
```

---

# 13. Experiment Results

| Metric | Baseline | 500ms Latency | 5% EIO | Recovery |
|---|---:|---:|---:|---:|
| Write Latency (p50) | $< 5\text{ms}$ | ~500ms | $< 5\text{ms}$ | $< 5\text{ms}$ |
| Cache Dirty % | $< 5\%$ | | | $< 5\%$ |
| Engine Crashes | 0 | 0 | 0 | 0 |
| Data Validation | Valid | Valid | Valid | Valid |

---

# 14. Final Assessment & Key Technical Takeaways

```text
Cloud Storage Latency Spikes
    =
Normal (noisy neighbor, burst exhaustion)

IOChaos FUSE Intercept
    =
Realistic latency simulation without actual hardware damage

500ms Write Latency
    ≠
Data Corruption (journal ensures consistency)

EIO Errors
    =
Storage hardware degradation simulation

Provisioned IOPS (GP3)
    =
Eliminates burst credit exhaustion risk

Successful Storage Chaos
    =
Engine throttles gracefully
    +
Zero data corruption
    +
Clean recovery within 30s
    +
Journal integrity preserved
```
