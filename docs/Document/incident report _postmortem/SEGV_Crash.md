# MongoDB Incident Runbook
## SEGV Crash — Linode CPU Upgrade + Missing Indexes
**Replica Set:** legacy-rs | **Prepared by:** BK | **Date:** June 2026

---

## 1. Incident Summary

| Field | Details |
|---|---|
| Incident Date | June 10, 2026 |
| Severity | P1 — Production Down |
| Service Affected | MongoDB Replica Set (legacy-rs) |
| Node Affected | legacy-db-1.unibotsapi.com |
| MongoDB Version | 8.2.4 |
| Crash Type | SEGV (Segmentation Fault) — core dump |
| Root Cause 1 | Linode custom kernel incompatible with new vCPU topology |
| Root Cause 2 | Missing indexes causing 780K doc COLLSCANs → OOM |
| Resolution Time | ~45 minutes |
| Fix Applied | Switched kernel to GRUB (Legacy) + added indexes |

---

## 2. Root Cause Analysis

### 2.1 Primary Cause — Kernel / CPU Incompatibility

After a Linode CPU plan upgrade, the node continued booting with Linode's custom kernel (`7.0.5-x86_64-linode173`). This kernel was built for the previous CPU topology and is incompatible with the new AMD EPYC 7713 virtual CPU model (`pc-q35-7.2`). MongoDB's `JournalFlusher` thread segfaulted specifically on vCPU core 7.

```
# dmesg evidence
JournalFlusher[1170]: segfault at 0 ip 00005649ca8bb616 sp 00007f55e9a26dc0
error 6 in mongod[...] likely on CPU 7 (core 7, socket 0)
```

### 2.2 Secondary Cause — Missing Indexes (OOM Pressure)

Two collections had no indexes on frequently queried fields, causing full collection scans on every query:

| Collection | Query | Docs Scanned | Data Read | Duration | Frequency |
|---|---|---|---|---|---|
| quiztwiz.emailusermodels | find by email | 780,045 | 163 MB | 446ms | Every 2-3 sec |
| dental-arb.housing_services | find by state+city+type | 157,073 | ~50 MB | 100ms | Frequent |

These COLLSCANs drove WiredTiger cache to **1.6GB peak**, accelerating the OOM condition on each restart.

### 2.3 Crash Chain

```
1. Linode CPU plan upgraded → vCPU topology changed to AMD EPYC 7713 (pc-q35-7.2)
2. Node rebooted but kept Linode custom kernel (7.0.5-x86_64-linode173)
3. MongoDB 8.2.4 starts → JournalFlusher thread assigned to vCPU core 7
4. Kernel/CPU mismatch → JournalFlusher segfaults → mongod crashes (SEGV)
5. App servers reconnect immediately, fire 780K-doc COLLSCANs
6. Memory spikes to 1.6GB within 29 seconds → crash repeats in loop
```

---

## 3. How It Was Detected

| Signal | Command | Finding |
|---|---|---|
| systemctl status | `systemctl status mongod` | Active: failed — code=dumped, signal=SEGV |
| Memory peak | `systemctl status mongod` | 1.0GB → 1.6GB peak — growing each restart |
| Slow query log | `tail /var/log/mongodb/mongod.log` | COLLSCAN on 780K docs, 163MB read per query |
| dmesg segfault | `dmesg \| grep segfault` | JournalFlusher crash on CPU 7 |
| BIOS model | `lscpu \| grep BIOS` | pc-q35-7.2 — QEMU vCPU model changed |
| Kernel version | `uname -r` | 7.0.5-x86_64-linode173 — Linode custom kernel |
| AVX support | `grep avx /proc/cpuinfo` | avx, avx2 present — not the cause |

---

## 4. Resolution Steps

> ✅ Follow in exact order

### 4.1 Fix Kernel (Primary Fix)

Via **Linode Cloud Manager** dashboard:

1. Navigate to: `Linode Dashboard → Node → Configuration → Boot Settings`
2. Change kernel from: `Latest 64 bit (7.0.5-x86_64-linode173)`
3. Change kernel to: `GRUB (Legacy)`
4. Click **Save** → **Reboot** the Linode

Verify after reboot:
```bash
uname -r                   # Should show Debian kernel e.g. 6.1.0-xx-amd64
systemctl status mongod    # Should show active (running)
```

### 4.2 Add WiredTiger Cache Limit (Preventive)

Edit `/etc/mongod.conf`:

```yaml
storage:
  dbPath: /var/lib/mongodb
  wiredTiger:
    engineConfig:
      cacheSizeGB: 2.0        # Set to ~25% of total RAM
    collectionConfig:
      blockCompressor: snappy
```

| Server RAM | cacheSizeGB |
|---|---|
| 2 GB | 0.5 |
| 4 GB | 1.0 |
| 8 GB | 2.0 |
| 16 GB | 4.0 |

### 4.3 Create Missing Indexes (Secondary Fix)

```javascript
// Fix 1 — quiztwiz email lookup (CRITICAL)
use quiztwiz
db.emailusermodels.createIndex({ email: 1 })

// Fix 2 — dental-arb housing search
use dental-arb
db.housing_services.createIndex(
  { listing_type: 1, state: 1, city: 1, createdAt: -1 }
)

// Verify
db.emailusermodels.getIndexes()
db.housing_services.getIndexes()
```

### 4.4 Verify Replica Set Recovery

```bash
mongosh --eval "rs.status().members.forEach(m => print(m.name, m.stateStr))"
```

Expected output:
```
legacy-db-1.unibotsapi.com:27017  SECONDARY
legacy-db-2.unibotsapi.com:27017  SECONDARY
legacy-db-3.unibotsapi.com:27017  PRIMARY
```

---

## 5. Impact Assessment

| Area | Impact |
|---|---|
| legacy-db-1 | Down ~45 minutes — rejoined as SECONDARY after fix |
| legacy-db-2 | Unaffected — remained SECONDARY throughout |
| legacy-db-3 | Elected PRIMARY automatically — handled all writes |
| App availability | Degraded — apps on crashed node got connection errors |
| Data loss | None — replica set maintained quorum |
| Replication lag | Minor — db-1 caught up via STARTUP2 sync after fix |

---

## 6. Prevention & Recommendations

| Priority | Action | Owner | Status |
|---|---|---|---|
| P0 | Switch all Linode MongoDB nodes to GRUB kernel before any CPU upgrade | DevOps | Pending |
| P0 | Create index on quiztwiz.emailusermodels.email | App Team | Done |
| P0 | Create compound index on dental-arb.housing_services | App Team | Done |
| P1 | Add cacheSizeGB to mongod.conf on all nodes via Ansible | DevOps | Pending |
| P1 | Set maxIncomingConnections: 200 (currently 6000) | DevOps | Pending |
| P1 | Restrict bindIp to private interface only (currently 0.0.0.0) | DevOps | Pending |
| P2 | Add slow query alerting — alert when COLLSCAN > 100ms | DevOps | Pending |
| P2 | Document CPU upgrade runbook for Linode nodes | DevOps | Pending |
| P3 | Review all collections for missing indexes monthly | App Team | Pending |

---

## 7. Diagnostic Commands Reference

### 7.1 First Response Checklist

```bash
# 1. Check service status
systemctl status mongod

# 2. Check crash type
dmesg | grep -E 'segfault|oom_kill|mongod' | tail -20

# 3. Check memory
free -h

# 4. Check slow query log
tail -100 /var/log/mongodb/mongod.log | grep -E 'COLLSCAN|Slow query'

# 5. Check replica set status (from healthy node)
mongosh --eval "rs.status().members.forEach(m => print(m.name, m.stateStr))"

# 6. Check kernel
uname -r

# 7. Check CPU / BIOS model
lscpu | grep -E 'Model name|BIOS Model'
```

### 7.2 Index Management

```javascript
// List all indexes on a collection
db.<collection>.getIndexes()

// Check index usage stats
db.<collection>.aggregate([{ $indexStats: {} }])

// Find collections with no indexes except _id
db.getCollectionNames().forEach(c => {
  const idx = db[c].getIndexes();
  if (idx.length === 1) print('No index: ' + c);
})
```

### 7.3 Replica Set Health

```bash
# Full replica set status
mongosh --eval "rs.status()"

# Check replication lag
mongosh --eval "rs.printSecondaryReplicationInfo()"

# Check who is primary
mongosh --eval "rs.isMaster().primary"
```

---

## 8. Lessons Learned

> ⚠️ **Key takeaway:** Always mention infrastructure changes when reporting issues. "It worked before X" cuts diagnosis time from hours to minutes.

- Linode CPU plan upgrades can change the underlying vCPU model. Always switch to GRUB kernel **before** upgrading CPU plans on MongoDB nodes.
- Linode custom kernels are not always compatible with new CPU plans — use distro kernel (GRUB) for production database nodes.
- MongoDB 8.x `JournalFlusher` is sensitive to vCPU topology changes in QEMU/KVM environments.
- Missing indexes on high-traffic collections cause cascading failures under load — review indexes after any schema change.
- A COLLSCAN on 780K documents reads 163MB per query. At 1 query/second that's 163MB/s of I/O — enough to saturate WiredTiger cache within seconds.
- `maxIncomingConnections: 6000` is dangerous — apps reconnect aggressively and overwhelm a recovering MongoDB instance.

---

## 9. Recommended mongod.conf

```yaml
storage:
  dbPath: /var/lib/mongodb
  wiredTiger:
    engineConfig:
      cacheSizeGB: 2.0              # ~25% of RAM
    collectionConfig:
      blockCompressor: snappy

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log

net:
  port: 27017
  bindIp: 127.0.0.1,<private-IP>   # NOT 0.0.0.0
  maxIncomingConnections: 200       # NOT 6000

replication:
  replSetName: legacy-rs

processManagement:
  timeZoneInfo: /usr/share/zoneinfo

security:
  authorization: enabled
  keyFile: /var/lib/mongodb-pki/keyfile

operationProfiling:
  mode: slowOp
  slowOpThresholdMs: 100
```

---

*Somo Media DevOps | Prepared by: BK | June 2026 | legacy-rs MongoDB Incident*