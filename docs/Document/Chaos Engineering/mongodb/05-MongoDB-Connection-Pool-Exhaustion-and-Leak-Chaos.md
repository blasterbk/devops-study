# MongoDB Chaos Scenario 05: Connection Pool Exhaustion & Socket Leak Chaos

**Domain:** Application Connection Management, Socket Resource Limits & Load Shedding  
**Chaos Type:** Rapid Client Socket Exhaustion, Connection Leak Simulation, Pool Saturation  
**Target:** MongoDB Primary / Microservice Driver Connection Pools  
**Tools:** `python3`, `mongosh`, `mongostat`, `ulimit`, `lsof`, `ss`

---

## 1. Experiment Overview

When microservices scale up during autoscaling events, each new pod opens a connection pool to MongoDB. If pod replicas multiply from 10 to 100 during a traffic spike, and each pod maintains `maxPoolSize=100`, the total connection demand jumps from 1,000 to 10,000 sockets. MongoDB's default `net.maxIncomingConnections` is 65,536, but the real bottleneck is often file descriptor limits (`ulimit -n`), available memory per connection (~1MB RSS), and application-side pool misconfiguration.

The primary experiment tests **Client-Side Connection Pool Saturation & Load Shedding (`waitQueueTimeoutMS`)**.

A separate optional experiment tests **Server-Side `net.maxIncomingConnections` Hard Ceiling Enforcement**.

> **Important:** Client-side pool configuration (`maxPoolSize`, `waitQueueTimeoutMS`, `maxIdleTimeMS`) is the first and most critical line of defense against database server connection collapse. Server-side limits are the last resort.

### Experiment A — Client Pool Saturation & Graceful Rejection

```text
Traffic spike scales microservice pods from 10 to 100
    ↓
Each pod opens connection pool with maxPoolSize=50
    ↓
Total demand: 5,000 connections to MongoDB
    ↓
Server approaches connection capacity
    ↓
Client pools fully checked out → excess requests queue
    ↓
waitQueueTimeoutMS=2500ms expires → fast fail with MongoWaitQueueFullError
    ↓
Application returns HTTP 503 to excess clients → load shed cleanly!
```

### Experiment B — Uncapped Connection Leak

```text
Application bug opens connections without returning to pool
    ↓
File descriptors consumed without release
    ↓
mongod hits ulimit -n or net.maxIncomingConnections ceiling
    ↓
New connection attempts rejected with "connection refused"
    ↓
ALL clients (including admin mongosh) blocked!
```

---

## 2. Steady-State Hypothesis

> **When 1,500 concurrent client connections are rapidly opened and held idle (simulating a connection leak), client-side pool limits (`maxPoolSize: 50`) will cap socket creation per client, `waitQueueTimeoutMS: 2500` will reject excess queued requests within 2.5 seconds, and MongoDB server memory overhead per connection (~1MB) will not exceed available host RAM, preventing OOM termination.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Active Server Connections | Does not exceed `net.maxIncomingConnections` |
| Load Shedding | Excess client queries fail fast ($< 3\text{s}$) without hanging indefinitely |
| Server Memory | Connection overhead stays within host RAM budget |
| Admin Access | `mongosh` administrative connections remain available |
| Post-Chaos Reclamation | Connections return to baseline within 30s of client termination |
| No Connection Leak | `db.serverStatus().connections.available` recovers fully |

---

## 3. Failure Mechanism Architecture

```text
               Connection Pool Architecture Under Saturation

┌─────────────────────────────────────────────────────────────┐
│                 APPLICATION PODS (100 replicas)             │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ HEALTHY POOL CONFIGURATION (per pod):                 │  │
│  │ - maxPoolSize: 50                                     │  │
│  │ - minPoolSize: 10                                     │  │
│  │ - maxIdleTimeMS: 60000                                │  │
│  │ - waitQueueTimeoutMS: 2500                            │  │
│  │ - Total demand: 100 pods × 50 = 5,000 connections     │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ MONGODB SERVER CONNECTION TABLE                       │  │
│  │                                                       │  │
│  │ net.maxIncomingConnections: 65,536 (default)          │  │
│  │ File Descriptor Limit (ulimit -n): 64,000             │  │
│  │ Memory overhead: ~1MB per connection                  │  │
│  │                                                       │  │
│  │ At 5,000 connections:                                 │  │
│  │ - Memory overhead: ~5GB (significant!)                │  │
│  │ - File descriptors: 5,000 of 64,000 used             │  │
│  │ - Status: OPERATIONAL ✅                              │  │
│  │                                                       │  │
│  │ At 50,000 connections (leak scenario):                │  │
│  │ - Memory overhead: ~50GB (EXCEEDS RAM!)               │  │
│  │ - File descriptors: 50,000 of 64,000 used            │  │
│  │ - Status: OOM RISK / FD EXHAUSTION ❌                 │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Important Connection Pool Mechanics

- **`maxPoolSize`:** Maximum number of connections the driver creates to a single mongod/mongos. Default is 100 in most drivers. Each connection is a persistent TCP socket.
- **`waitQueueTimeoutMS`:** How long a thread waits for a free connection from the pool. If exceeded, throws `MongoWaitQueueFullError`. Default varies by driver (some drivers have no timeout — dangerous!).
- **`maxIdleTimeMS`:** Closes idle connections after this duration. Helps reclaim resources during traffic troughs.
- **Server-Side `net.maxIncomingConnections`:** Hard ceiling on total inbound connections. Set to 65,536 by default.
- **Memory Per Connection:** Each MongoDB connection consumes approximately 1MB of RAM for socket buffers, authentication state, and operation context.

---

# 4. Preconditions

Before running the experiment:

### Check current connection state

```javascript
// Run in mongosh:
db.serverStatus().connections
```
*Record: `current`, `available`, `totalCreated`.*

### Check server-side connection limit

```javascript
db.adminCommand({ getParameter: 1, maxIncomingConnections: 1 })
```

### Check file descriptor limits for mongod

```bash
cat /proc/$(pgrep mongod)/limits | grep "Max open files"
```

### Verify host memory

```bash
free -m
```

---

# 5. Step 1 — Record Baseline

```javascript
let conn = db.serverStatus().connections;
print("Current Connections: " + conn.current);
print("Available Connections: " + conn.available);
print("Total Created: " + conn.totalCreated);
```

```bash
# Count current mongod file descriptors:
ls /proc/$(pgrep mongod)/fd | wc -l
```

```bash
# Check current socket connections to MongoDB port:
ss -tan state established | grep ":27017" | wc -l
```

---

# 6. Step 2 — Progressive Connection Exhaustion

---

## 6.1 Stage 1: Moderate Load (500 Connections)

```python
import pymongo, time, threading

uri = "mongodb://legacy-db-1:27017/?replicaSet=legacy-rs"
clients = []
errors = []

def create_connection():
    try:
        c = pymongo.MongoClient(uri, maxPoolSize=1, socketTimeoutMS=5000)
        c.admin.command('ping')
        clients.append(c)
    except Exception as e:
        errors.append(str(e))

threads = [threading.Thread(target=create_connection) for _ in range(500)]
for t in threads: t.start()
for t in threads: t.join()

print(f"✅ Opened {len(clients)} connections, {len(errors)} errors")
```

Check server state:

```javascript
db.serverStatus().connections
```

---

## 6.2 Stage 2: Heavy Load (1,500 Connections)

```python
# Continue from previous script, add 1,000 more:
threads = [threading.Thread(target=create_connection) for _ in range(1000)]
for t in threads: t.start()
for t in threads: t.join()

print(f"🔥 Total: {len(clients)} connections, {len(errors)} errors")
time.sleep(120)  # Hold connections open for 2 minutes
```

---

## 6.3 Stage 3: Test Load Shedding with Pooled Client

While 1,500 raw connections are held open, test whether a properly configured pooled client can still operate:

```python
import pymongo, time

pooled_uri = "mongodb://legacy-db-1:27017,legacy-db-2:27017,legacy-db-3:27017/?replicaSet=legacy-rs&maxPoolSize=50&waitQueueTimeoutMS=2500"
pooled_client = pymongo.MongoClient(pooled_uri)

success, failed = 0, 0
for i in range(100):
    try:
        pooled_client.admin.command('ping')
        success += 1
    except Exception as e:
        failed += 1
        print(f"❌ Pooled query {i} failed: {e}")
    time.sleep(0.05)

print(f"\n📊 Pooled Client: {success} success, {failed} failed")
```

---

# 7. Step 3 — Monitor Connection Table & File Descriptors

During saturation:

### Real-time connection monitoring

```bash
watch -n 2 'mongosh --quiet --eval "printjson(db.serverStatus().connections)"'
```

### File descriptor consumption

```bash
watch -n 2 'ls /proc/$(pgrep mongod)/fd | wc -l'
```

### Socket state distribution

```bash
ss -tan state established | grep ":27017" | wc -l
```

### Check mongod memory

```bash
ps -p $(pgrep mongod) -o pid,rss,vsz,pcpu --no-headers
```

---

# 8. Step 4 — Verify Admin Access Under Saturation

### Can admin mongosh still connect?

```bash
time mongosh "mongodb://legacy-db-1:27017/?replicaSet=legacy-rs" --eval "db.adminCommand('ping')"
```
*Expected: Admin connection succeeds (MongoDB reserves some connections for admin access).*

---

# 9. Abort Conditions

```text
ABORT CONDITIONS

- mongosh admin connections are refused ("connection refused" or timeout)
- mongod process crashes or OOM killed
- Server available connections reaches 0
- File descriptor limit reached (EMFILE in mongod.log)
- Host becomes unresponsive
```

---

# 10. Emergency Stop & Connection Cleanup

### Kill all chaos client connections

```bash
# If running Python script:
pkill -f "create_connection"
```

### Force close current operations

```javascript
// Kill all idle cursors and operations:
db.currentOp().inprog
  .filter(op => op.client && op.secs_running > 30)
  .forEach(op => db.killOp(op.opid));
```

---

# 11. Recovery Validation

After terminating chaos clients:

### Verify connection count recovery

```javascript
// Wait 30 seconds for TCP FIN/CLOSE_WAIT to clear:
db.serverStatus().connections
```
*Expected: `current` drops back to baseline, `available` recovers to near-maximum.*

### Verify file descriptor recovery

```bash
ls /proc/$(pgrep mongod)/fd | wc -l
```

### Verify no connection leak (CLOSE_WAIT sockets)

```bash
ss -tan state close-wait | grep ":27017" | wc -l
```
*Expected: 0 or near 0 within 2 minutes.*

---

# 12. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| All connections exhausted, admin locked out | No per-service `maxPoolSize` limit | Enforce `maxPoolSize=50` in all application connection URIs |
| Client threads hang indefinitely | `waitQueueTimeoutMS` not configured (infinite wait) | Set `waitQueueTimeoutMS=2500` in all drivers |
| Idle connections consume memory | `maxIdleTimeMS` not set, connections never close | Set `maxIdleTimeMS=60000` to reclaim idle sockets |
| Autoscaling spike creates 10,000 connections | Each pod has `maxPoolSize=100` | Reduce `maxPoolSize=20-50` per pod, scale connections proportionally |
| mongod OOM from connection memory overhead | 50,000 connections × 1MB = 50GB | Set `net.maxIncomingConnections: 10000` to cap memory impact |
| CLOSE_WAIT socket leak | Application closes client but TCP connection hangs | Tune `net.ipv4.tcp_keepalive_time=300` and connection pool `socketTimeoutMS` |

---

# 13. Production Hardening: Mandatory Client & Server Configuration

### Standard Production Connection URI

```text
mongodb://db-1:27017,db-2:27017,db-3:27017/app_db?replicaSet=legacy-rs&maxPoolSize=50&minPoolSize=10&maxIdleTimeMS=60000&waitQueueTimeoutMS=2500&w=majority&retryWrites=true&serverSelectionTimeoutMS=15000&socketTimeoutMS=30000
```

### Connection Budget Calculator

```text
Total Budget = net.maxIncomingConnections (or ulimit -n - reserved)

Per-Pod Allocation = maxPoolSize per microservice

Maximum Pods = Total Budget / Per-Pod Allocation

Example:
  Server limit: 10,000 connections
  Per-pod pool: 50 connections
  Maximum pods: 10,000 / 50 = 200 pods
  
  If autoscaler scales beyond 200 pods → CONNECTION EXHAUSTION!
  Solution: Reduce maxPoolSize or increase server capacity.
```

### Server-Side Configuration in `/etc/mongod.conf`

```yaml
net:
  port: 27017
  bindIp: 0.0.0.0
  maxIncomingConnections: 10000  # Explicit cap to prevent memory exhaustion
```

---

# 14. Experiment Results

| Metric | Baseline | 500 Connections | 1,500 Connections | Post-Cleanup |
|---|---:|---:|---:|---:|
| Current Connections | ~50 | ~550 | ~1,550 | ~50 |
| Available Connections | ~64,986 | ~64,486 | ~63,486 | ~64,986 |
| mongod RSS (MB) | | | | |
| File Descriptors | | | | |
| Admin Access | Yes | Yes | Yes | Yes |
| Pooled Client Success Rate | 100% | 100% | | 100% |

---

# 15. Final Assessment

The experiment is considered successful if:

1. MongoDB server does not crash or OOM under 1,500 concurrent connections.
2. Administrative `mongosh` access remains available throughout.
3. Properly configured pooled clients with `waitQueueTimeoutMS` fail fast when saturated.
4. Connections are fully reclaimed within 30 seconds of client termination.
5. No lingering `CLOSE_WAIT` sockets after cleanup.
6. Server memory impact is predictable and within budget.

---

## Key Technical Takeaways

```text
maxPoolSize = 100 (default in many drivers)
    ×
100 pods
    =
10,000 connections (potentially dangerous!)

waitQueueTimeoutMS = undefined (no timeout)
    =
Client threads hang FOREVER waiting for pool slot

maxIdleTimeMS = undefined
    =
Idle connections NEVER close (memory leak)

maxPoolSize = 50 + waitQueueTimeoutMS = 2500
    =
Fast load shedding under saturation

Connection Budget
    =
net.maxIncomingConnections / maxPoolSize per pod
    =
Maximum safe pod count for autoscaler

Successful Connection Chaos
    =
Controlled pool saturation
    +
Fast client-side load shedding
    +
Admin access preserved
    +
Clean post-chaos connection reclamation
```
