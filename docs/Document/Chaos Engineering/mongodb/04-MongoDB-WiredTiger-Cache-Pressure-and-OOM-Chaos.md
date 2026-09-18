# MongoDB Chaos Scenario 04: WiredTiger Cache Pressure & OOM Chaos

**Domain:** Storage Engine Internals, Memory Management, Dirty Page Eviction & Linux OOM Killer  
**Chaos Type:** WiredTiger Cache Starvation, Massive COLLSCAN Storm, Host RAM Stress  
**Target:** MongoDB Primary / Secondaries (`mongod` process, WiredTiger engine)  
**Tools:** `stress-ng`, `mongosh`, `mongostat`, `systemctl`, `htop`, `dmesg`

---

## 1. Experiment Overview

WiredTiger, MongoDB's default storage engine, manages its own internal memory cache for storing recently accessed B-tree pages, index entries, and dirty (modified) data pages. When unindexed queries (`COLLSCAN`) scan millions of documents, WiredTiger loads gigabytes of raw data into this cache. If dirty pages exceed the 20% eviction threshold and host RAM is simultaneously stressed by external processes, the Linux kernel OOM killer may terminate the `mongod` process.

The primary experiment tests **WiredTiger Cache Eviction Under Massive COLLSCAN Load**.

A separate optional experiment tests **Host Memory Saturation & `oom_score_adj` Daemon Protection**.

> **Important:** WiredTiger cache size should be explicitly configured in `mongod.conf` (`wiredTiger.engineConfig.cacheSizeGB`). The default formula is `50% of (Total RAM - 1GB)`, but this can be dangerously high on servers running other services, and dangerously low on servers with large datasets.

### Experiment A — WiredTiger Cache Eviction Under COLLSCAN Load

```text
Multiple unindexed queries force full-collection table scans
    ↓
WiredTiger loads multi-GB of documents into cache
    ↓
Dirty cache bytes exceed 20% threshold
    ↓
WiredTiger activates background eviction worker threads
    ↓
Eviction workers flush dirty pages to disk (I/O spike)
    ↓
If eviction cannot keep up → application threads assist (slowdown)
    ↓
Engine maintains cache stability without OOM kill!
```

### Experiment B — Host Memory Stress & OOM Kill Risk

```text
External process (stress-ng) consumes 70-80% of total host RAM
    ↓
WiredTiger cache competes for remaining physical memory
    ↓
Linux page cache starved → kswapd0 activates
    ↓
If mongod RSS exceeds cgroup limit or host free RAM → OOM kill
    ↓
mongod terminated with SIGKILL (Exit Code 137)
    ↓
With OOMScoreAdjust=-800, mongod is protected from OOM targeting
```

---

## 2. Steady-State Hypothesis

> **When massive unindexed aggregation queries (10 concurrent COLLSCAN operations) are executed simultaneously with 70% host RAM stress from `stress-ng` for 5 minutes, WiredTiger's background eviction threads will throttle query execution, maintaining dirty cache $< 20\%$ of total cache size and preventing `mongod` from being terminated by the Linux OOM killer.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Process Survival | `mongod` is NOT terminated by Linux OOM killer (no Exit Code 137) |
| Cache Dirty Ratio | `bytes currently in the cache (dirty)` stays $< 20\%$ of total cache |
| Read/Write Tickets | WiredTiger ticket queues do NOT reach 0 available for $> 10\text{s}$ |
| Query Response | Queries may slow down but do NOT timeout completely |
| Post-Chaos Recovery | Cache dirty ratio returns to $< 5\%$ within 60 seconds |
| Host Stability | Node does not enter Linux `MemoryPressure` taint |

---

## 3. Failure Mechanism Architecture

```text
               WiredTiger Cache Architecture Under Pressure

┌─────────────────────────────────────────────────────────────┐
│                 HOST PHYSICAL RAM (e.g. 16 GB)              │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ LINUX OS + PAGE CACHE (~2 GB)                         │  │
│  │ - Kernel, systemd, SSH, monitoring agents             │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ WIREDTIGER INTERNAL CACHE (cacheSizeGB: 6 GB)         │  │
│  │                                                       │  │
│  │  ┌───────────────────────────────────────────────┐    │  │
│  │  │ CLEAN PAGES (Read-only cached B-tree nodes)   │    │  │
│  │  │ - Can be evicted immediately (no disk I/O)    │    │  │
│  │  └───────────────────────────────────────────────┘    │  │
│  │                                                       │  │
│  │  ┌───────────────────────────────────────────────┐    │  │
│  │  │ DIRTY PAGES (Modified but not yet flushed)    │    │  │
│  │  │ - Must be written to disk before eviction     │    │  │
│  │  │ - Target: < 5% of cache                       │    │  │
│  │  │ - Eviction trigger: > 20% of cache            │    │  │
│  │  │ - Application-thread assist: > 80% of cache   │    │  │
│  │  └───────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ CHAOS WORKLOAD: stress-ng --vm (70% of RAM)           │  │
│  │ - Competes with WiredTiger for physical memory        │  │
│  │ - May trigger kswapd0 and page reclaim                │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ LINUX OOM KILLER                                      │  │
│  │ - Calculates oom_score for each process               │  │
│  │ - Targets highest score unless oom_score_adj shields  │  │
│  │ - mongod with OOMScoreAdjust=-800 is protected 🛡️    │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Important WiredTiger Cache Mechanics

- **Cache Size Formula:** Default is `max(256MB, 50% × (Total RAM − 1GB))`. On a 16GB host, this is ~7.5GB.
- **Eviction Thresholds:**
  - Background eviction starts when cache usage $> 80\%$ of `cacheSizeGB`
  - Application-thread-assisted eviction when cache usage $> 95\%$
  - Dirty page eviction trigger: dirty bytes $> 5\%$ (target), $> 20\%$ (aggressive)
- **Ticket System:** WiredTiger limits concurrent operations via read tickets (128) and write tickets (128). When all tickets are consumed, new operations queue.
- **`oom_score_adj`:** Linux OOM killer calculates a badness score for each process. Setting `OOMScoreAdjust=-800` reduces `mongod`'s score, making it one of the last processes killed.

---

# 4. Preconditions

Before running the experiment:

### Verify WiredTiger cache configuration

```javascript
// Run in mongosh:
db.serverStatus().wiredTiger.cache["maximum bytes configured"] / (1024*1024*1024)
```
*This shows the configured cache size in GB.*

### Verify host memory capacity

```bash
free -h
```

### Verify stress-ng and monitoring tools

```bash
stress-ng --version
htop --version
```
If missing:
```bash
sudo apt update && sudo apt install -y stress-ng htop sysstat
```

### Check mongod OOM score adjustment

```bash
cat /proc/$(pgrep mongod)/oom_score_adj
```
*Note current value (default is usually 0).*

### Verify test data exists

```javascript
use chaos_test_db;
db.big_collection.countDocuments();
```
If no large collection exists, create one:
```javascript
use chaos_test_db;
for (let b = 0; b < 100; b++) {
  let docs = [];
  for (let i = 0; i < 10000; i++) {
    docs.push({
      data: "pattern_" + Math.random().toString(36).substr(2, 15) + "_test",
      payload: "x".repeat(1024),
      ts: new Date(),
      batch: b
    });
  }
  db.big_collection.insertMany(docs);
  print(`Batch ${b}/100 inserted`);
}
print("✅ 1,000,000 documents loaded for cache pressure testing.");
```

---

# 5. Step 1 — Record Baseline

Record the baseline WiredTiger cache state before injecting chaos:

### Cache utilization

```javascript
let cache = db.serverStatus().wiredTiger.cache;
print("Cache Size (GB): " + (cache["maximum bytes configured"] / (1024**3)).toFixed(2));
print("Cache Used (GB): " + (cache["bytes currently in the cache"] / (1024**3)).toFixed(2));
print("Cache Dirty (GB): " + (cache["tracked dirty bytes in the cache"] / (1024**3)).toFixed(2));
print("Cache Dirty %: " + ((cache["tracked dirty bytes in the cache"] / cache["maximum bytes configured"]) * 100).toFixed(2));
print("Pages evicted: " + cache["pages evicted by application threads"]);
```

### WiredTiger concurrent transaction tickets

```javascript
let tickets = db.serverStatus().wiredTiger.concurrentTransactions;
printjson(tickets);
```

### Host memory baseline

```bash
free -m
vmstat 1 3
```

### Process OOM score

```bash
cat /proc/$(pgrep mongod)/oom_score
cat /proc/$(pgrep mongod)/oom_score_adj
```

Record:
- Cache size (configured)
- Cache used (bytes)
- Cache dirty (bytes and percentage)
- Read/Write tickets (available / total)
- Host available memory
- `mongod` OOM score

---

# 6. Step 2 — Progressive Cache Pressure Chaos

---

## 6.1 Stage 1: Moderate COLLSCAN Load (5 Concurrent Queries)

Open 5 terminal sessions and run concurrent unindexed scans:

```javascript
// Run in mongosh (repeat in 5 sessions):
use chaos_test_db;
let start = new Date();
let result = db.big_collection.find({ data: { $regex: "pattern_.*_test" } }).sort({ ts: -1 }).limit(100).toArray();
let elapsed = new Date() - start;
print("Query returned " + result.length + " docs in " + elapsed + "ms");
```

Monitor cache during queries:

```javascript
let cache = db.serverStatus().wiredTiger.cache;
print("Dirty %: " + ((cache["tracked dirty bytes in the cache"] / cache["maximum bytes configured"]) * 100).toFixed(2));
```

---

## 6.2 Stage 2: Heavy COLLSCAN Load (10 Concurrent Queries)

Scale to 10 concurrent sessions with larger unindexed aggregations:

```javascript
// Run in mongosh (repeat in 10 sessions):
use chaos_test_db;
db.big_collection.aggregate([
  { $match: { data: { $regex: "pattern_.*_test" } } },
  { $group: { _id: "$batch", count: { $sum: 1 }, avgSize: { $avg: { $strLenBytes: "$payload" } } } },
  { $sort: { count: -1 } }
]).toArray();
```

---

## 6.3 Stage 3: Add Host Memory Stress

While COLLSCAN queries are running, inject host memory stress:

```bash
# Consume 70% of host RAM with stress-ng for 5 minutes
sudo stress-ng --vm 2 --vm-bytes 70% --vm-populate --timeout 300s &
STRESS_PID=$!
echo "Memory stress running with PID: $STRESS_PID"
```

---

# 7. Step 3 — Monitor Cache Eviction & Host Memory

During combined chaos:

### Real-time WiredTiger cache monitoring

```bash
# Run mongostat and watch dirty% and used% columns:
mongostat -h 127.0.0.1:27017 --rowcount 30 2
```

### Check eviction worker activity

```javascript
let cache = db.serverStatus().wiredTiger.cache;
print("Application thread evictions: " + cache["pages evicted by application threads"]);
print("Internal thread evictions: " + cache["pages evicted by internal threads"]);
print("Modified pages evicted: " + cache["modified pages evicted"]);
```

### Monitor host memory pressure

```bash
watch -n 1 "free -m && echo '---' && cat /proc/pressure/memory"
```

### Check for OOM events

```bash
sudo dmesg -wT | grep -i -E "oom|killed process|out of memory"
```

### Monitor WiredTiger ticket availability

```javascript
let tickets = db.serverStatus().wiredTiger.concurrentTransactions;
print("Read tickets available: " + tickets.read.available + "/" + tickets.read.totalTickets);
print("Write tickets available: " + tickets.write.available + "/" + tickets.write.totalTickets);
```

---

# 8. Step 4 — Verify mongod Process Survival

### Check mongod is still running

```bash
systemctl status mongod --no-pager
pgrep -a mongod
```

### Check for OOM kill in dmesg

```bash
sudo dmesg | grep -i "killed process" | tail -5
```
*Expected: No lines mentioning `mongod`.*

### Verify database responds to queries

```javascript
db.adminCommand('ping')
```

---

# 9. Abort Conditions

Stop the experiment immediately if:

```text
ABORT CONDITIONS

- mongod process terminated by OOM killer (Exit Code 137 in systemctl status)
- WiredTiger reports invariant assertion failure in mongod.log
- All read AND write tickets reach 0 for > 30 seconds (full stall)
- Host system becomes completely unresponsive (SSH hangs)
- Filesystem remounts read-only
- Replica Set Primary steps down due to slow operations timeout
```

---

# 10. Emergency Stop

### Terminate stress-ng

```bash
sudo kill "$STRESS_PID" 2>/dev/null || sudo pkill -9 stress-ng
```

### Terminate long-running MongoDB operations

```javascript
// Kill all operations running > 10 seconds:
db.currentOp().inprog
  .filter(op => op.secs_running > 10)
  .forEach(op => {
    db.killOp(op.opid);
    print("Killed operation: " + op.opid);
  });
```

---

# 11. Recovery Validation

After terminating chaos workloads:

### Verify cache recovery

```javascript
// Wait 60 seconds, then check:
let cache = db.serverStatus().wiredTiger.cache;
print("Post-chaos Dirty %: " + ((cache["tracked dirty bytes in the cache"] / cache["maximum bytes configured"]) * 100).toFixed(2));
```
*Expected: Dirty $< 5\%$ within 60 seconds.*

### Verify ticket recovery

```javascript
let tickets = db.serverStatus().wiredTiger.concurrentTransactions;
print("Read tickets: " + tickets.read.available + "/" + tickets.read.totalTickets);
print("Write tickets: " + tickets.write.available + "/" + tickets.write.totalTickets);
```
*Expected: Near full availability.*

### Verify host memory recovery

```bash
free -m
pgrep -a stress-ng
```
*Expected: No stress-ng processes, memory returning to baseline.*

### Cleanup test data

```javascript
use chaos_test_db;
db.big_collection.drop();
```

---

# 12. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| `mongod` killed by OOM (Exit 137) | WiredTiger cache configured too large, leaving no RAM for OS | Explicitly set `cacheSizeGB` to `50% of (Total RAM − 2GB)` and protect with `OOMScoreAdjust=-800` |
| Dirty cache exceeds 20% and queries stall | Disk I/O too slow for eviction flush rate | Upgrade to NVMe / provisioned IOPS storage |
| All read/write tickets consumed | Too many concurrent COLLSCAN operations | Add missing indexes, limit `$regex` scans, enforce `maxTimeMS` |
| Application threads assist eviction (severe slowdown) | Cache overwhelmed by scan-heavy workload without indexes | Create targeted indexes, use `explain()` to eliminate COLLSCAN |
| OOM kills non-MongoDB process instead | mongod has high `oom_score` but other process has higher | Configure `OOMScoreAdjust=-800` for mongod via systemd |
| Cache pressure during backup | `mongodump` forces COLLSCAN of entire dataset | Use `--oplog` incremental backups or filesystem snapshots |

---

# 13. Production Hardening: Cache Sizing & OOM Protection

### 1. Explicitly Size WiredTiger Cache in `/etc/mongod.conf`

```yaml
storage:
  dbPath: /var/lib/mongodb
  journal:
    enabled: true
  wiredTiger:
    engineConfig:
      # Formula: 50% of (Total RAM - 2GB for OS, sockets, and agents)
      # On 16GB host: (16 - 2) * 0.5 = 7GB → conservative 6GB
      cacheSizeGB: 6
    collectionConfig:
      blockCompressor: snappy
```

### 2. Shield mongod from Linux OOM Killer

Create `/etc/systemd/system/mongod.service.d/override.conf`:

```ini
[Service]
OOMScoreAdjust=-800
```

Apply:

```bash
sudo systemctl daemon-reload
sudo systemctl restart mongod
```

Verify:

```bash
cat /proc/$(pgrep mongod)/oom_score_adj
```
*Expected: `-800`.*

### 3. Enforce Query Time Limits

In application code, always set `maxTimeMS` on queries:

```javascript
db.collection.find({ field: { $regex: "pattern" } }).maxTimeMS(10000)
```

### 4. Monitor Cache Metrics via Prometheus

```yaml
- alert: MongoDBWiredTigerCacheDirtyHigh
  expr: mongodb_wiredtiger_cache_dirty_bytes / mongodb_wiredtiger_cache_max_bytes * 100 > 15
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "WiredTiger dirty cache on {{ $labels.instance }} exceeds 15%"
```

---

# 14. Why Default Cache Sizing Is Not Always Safe

```text
Default WiredTiger Cache Formula:
    max(256MB, 50% × (Total RAM − 1GB))

On a 16GB host → ~7.5GB cache
    + 2GB Linux OS
    + 1GB connection buffers & sockets
    + 1GB monitoring agents
    = 11.5GB committed

Remaining: 4.5GB for page cache, file buffers, other services
    → TIGHT but usually survivable

On a 8GB host → ~3.5GB cache
    + 2GB Linux OS
    + 1GB connection buffers
    + 1GB application co-tenancy
    = 7.5GB committed

Remaining: 0.5GB → HIGH OOM RISK!

ALWAYS explicitly set cacheSizeGB rather than relying on defaults.
```

---

# 15. Experiment Results

| Metric | Baseline | 5 COLLSCAN | 10 COLLSCAN + Stress | Recovery |
|---|---:|---:|---:|---:|
| Cache Dirty % | $< 1\%$ | | | $< 5\%$ |
| Read Tickets Available | 128 | | | 128 |
| Write Tickets Available | 128 | | | 128 |
| mongod OOM Kill | No | No | No | No |
| Query Latency (p95) | | | | |
| Host Free RAM (MB) | | | | |
| Application Thread Evictions | 0 | | | |

---

# 16. Final Assessment

The experiment is considered successful if:

1. `mongod` process survives the combined COLLSCAN + memory stress without OOM kill.
2. WiredTiger dirty cache percentage never exceeds 20% for sustained periods.
3. Read/Write tickets do not reach 0 for $> 10\text{s}$ consecutively.
4. Cache dirty ratio returns to $< 5\%$ within 60 seconds post-chaos.
5. No WiredTiger invariant failures or data corruption.
6. Host memory returns to baseline after `stress-ng` termination.

---

## Key Technical Takeaways

```text
WiredTiger Cache
    ≠
Linux Page Cache (they are separate memory pools)

Default cacheSizeGB
    =
Dangerous on small hosts or co-tenant servers

Dirty Cache > 20%
    =
Eviction workers overwhelmed → query slowdown

Dirty Cache > 80%
    =
Application threads forced to assist eviction → severe stall

OOMScoreAdjust = -800
    =
Protects mongod from being targeted by Linux OOM killer

COLLSCAN (full table scan)
    =
Primary cause of cache pressure in production

Missing Index
    =
Silent cache bomb waiting to explode under load
```
