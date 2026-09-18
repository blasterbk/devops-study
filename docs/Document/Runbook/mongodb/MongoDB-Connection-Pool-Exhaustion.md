# MongoDB Connection Pool Exhaustion — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on application impact  
**Applies to:** MongoDB production applications

**Purpose:** Diagnose and recover when applications exhaust their MongoDB connection pools, causing connection timeouts, request failures, or MongoDB connection limits to be reached.

---

## 1. Trigger

Use this runbook when:

- Applications report MongoDB connection timeouts.
- Logs show `connection pool exhausted`.
- `MongoWaitQueueTimeoutError` appears.
- `MongoServerSelectionError` occurs during connection acquisition.
- MongoDB `connections.current` is unusually high.
- MongoDB approaches `connections.available = 0`.
- Application latency increases because requests wait for database connections.

Common symptoms:

```text
Connection pool exhausted
Timed out waiting for a connection
MongoWaitQueueTimeoutError
MongoServerSelectionError
Connection refused
Too many connections
```

> ⚠️ **Do not immediately increase MongoDB connection limits. First identify why the application is consuming connections.**

---

## 2. Quick Decision Flow

```text
Connection Pool Exhaustion
          │
          ▼
Check Application Errors
          │
          ▼
Check MongoDB Connections
          │
          ▼
Is MongoDB Near Connection Limit?
          │
     ┌────┴────┐
     ▼         ▼
    YES        NO
     │          │
     ▼          ▼
Check         Check
Server        App Pool
Limit         Configuration
     │          │
     └────┬─────┘
          ▼
Check Connection Leaks
          │
          ▼
Check Application Replicas
          │
          ▼
Fix Root Cause
          │
          ▼
Monitor Connections
          │
          ▼
Verify Application
```

---

## 3. Step 1 — Confirm the Problem

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace> | \
grep -Ei 'pool|connection|MongoWaitQueue|MongoServerSelection'
```

Look for:

```text
connection pool exhausted
timed out waiting for connection
MongoWaitQueueTimeoutError
MongoServerSelectionError
```

Check whether the problem affects:

```text
One application
One pod
Multiple pods
Multiple applications
Entire MongoDB cluster
```

---

## 4. Step 2 — Check MongoDB Connection Count

Connect to MongoDB:

```bash
mongosh
```

Run:

```javascript
db.serverStatus().connections
```

Important fields:

```text
current
available
totalCreated
```

Example:

```text
current: 5900
available: 100
```

If `current` is approaching the configured connection limit, investigate immediately.

---

## 5. Step 3 — Check MongoDB Connection Limit

Run:

```javascript
db.serverStatus().connections
```

Check:

```text
current
available
```

Also check MongoDB configuration:

```bash
grep -Ei 'maxIncomingConnections' /etc/mongod.conf
```

If a connection limit is configured, record it:

```text
Configured limit:
Current connections:
Available connections:
```

> Do not increase `maxIncomingConnections` blindly. The server must have sufficient CPU, memory, and workload capacity to handle more connections.

---

## 6. Step 4 — Identify Which Application Is Consuming Connections

If MongoDB logs provide client information, inspect recent connections:

```bash
grep -Ei 'connection|client' \
/var/log/mongodb/mongod.log | tail -100
```

Check application pods:

```bash
kubectl get pods -A -o wide
```

Check replicas:

```bash
kubectl get deployment -A
```

Record:

```text
Application:
Namespace:
Pod count:
MongoDB pool configuration:
Approximate connections/pod:
Total expected connections:
```

---

## 7. Step 5 — Calculate Expected Connections

For an application with multiple pods:

```text
Expected connections ≈ number of pods × maxPoolSize
```

Example:

```text
20 pods × 100 maxPoolSize
= up to 2000 connections
```

If multiple applications connect to the same MongoDB cluster:

```text
Total connections ≈
App A connections
+ App B connections
+ App C connections
+ other clients
```

> Connection pools are normally created per application process. Kubernetes scaling can therefore multiply the total number of MongoDB connections.

---

## 8. Step 6 — Check Application Pool Configuration

For Node.js MongoDB clients, check settings such as:

```text
maxPoolSize
minPoolSize
maxIdleTimeMS
waitQueueTimeoutMS
connectTimeoutMS
serverSelectionTimeoutMS
```

Example:

```javascript
MongoClient.connect(uri, {
  maxPoolSize: 100,
  minPoolSize: 10,
  maxIdleTimeMS: 60000,
  waitQueueTimeoutMS: 10000
})
```

Use the application's actual configuration rather than copying these values blindly.

---

## 9. Step 7 — Check for Connection Leaks

A common cause is creating MongoDB clients repeatedly instead of reusing a shared client/pool.

### Problematic pattern

```javascript
async function handler() {
  const client = new MongoClient(uri);
  await client.connect();

  // query

  // client.close() missing
}
```

### Preferred pattern

Create one shared MongoDB client/pool and reuse it:

```javascript
const client = new MongoClient(uri);

await client.connect();

async function handler() {
  const db = client.db("mydb");
  return db.collection("users").findOne({});
}
```

Check application code for:

```text
new MongoClient()
client.connect()
mongoose.connect()
MongoClient.connect()
```

If these are executed repeatedly per request, escalate to the Application Owner.

---

## 10. Step 8 — Check Kubernetes Scaling

Check:

```bash
kubectl get deployment <deployment> -n <namespace>
```

Check pods:

```bash
kubectl get pods -n <namespace>
```

Check HPA:

```bash
kubectl get hpa -n <namespace>
```

A sudden scale-up can multiply connection pools.

Example:

```text
Before:
5 pods × 100 connections = 500

After:
30 pods × 100 connections = 3000
```

If autoscaling caused the connection spike, review:

```text
HPA minReplicas
HPA maxReplicas
maxPoolSize
Application traffic
MongoDB capacity
```

---

## 11. Step 9 — Check MongoDB CPU and Memory

More connections are not free.

Check:

```bash
top
```

Memory:

```bash
free -h
```

MongoDB memory pressure:

```bash
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20
```

If MongoDB is under memory pressure, use:

```text
MongoDB-OOM.md
```

---

## 12. Step 10 — Check Slow Queries

Connection pools can become exhausted because connections remain busy executing slow queries.

Check:

```bash
grep -Ei 'slow|COLLSCAN' \
/var/log/mongodb/mongod.log | tail -100
```

Check active operations:

```javascript
db.currentOp({
  active: true
})
```

If slow queries are the cause, use:

```text
MongoDB-Slow-Query.md
```

or:

```text
MongoDB-Missing-Index.md
```

---

## 13. Step 11 — Check for Traffic Spike

Check application traffic and request rate.

Look for:

```text
Traffic spike
New deployment
Retry storm
Failed downstream service
HPA scale-up
Batch job
Cronjob
Unexpected client
```

A traffic spike can cause more concurrent requests and therefore more pool contention.

---

## 14. Step 12 — Immediate Mitigation

If production is actively failing:

### Option A — Reduce application replicas

If an uncontrolled scale-up caused the problem:

```bash
kubectl scale deployment <deployment> \
  --replicas=<safe-number> \
  -n <namespace>
```

Use the approved safe replica count.

### Option B — Temporarily reduce traffic

Use the approved load-balancer/API/CDN procedure.

### Option C — Restart leaking application pods

Only after identifying a connection leak or stuck process:

```bash
kubectl rollout restart deployment/<deployment> \
  -n <namespace>
```

> Restarting pods is a mitigation, not a permanent fix.

---

## 15. Step 13 — Fix the Root Cause

Typical fixes:

### Connection Pool Too Large

Reduce:

```text
maxPoolSize
minPoolSize
```

based on actual workload and MongoDB capacity.

### Too Many Application Pods

Review:

```text
HPA
Replica count
Traffic
Pool size per pod
```

### Connection Leak

Ensure:

```text
MongoClient is reused
Connections are closed when appropriate
Pools are not created per request
```

### Slow Queries

Use:

```text
MongoDB-Slow-Query.md
MongoDB-Missing-Index.md
```

### MongoDB Capacity Problem

Review:

```text
CPU
RAM
Disk I/O
Connection limit
Query workload
```

---

## 16. Step 14 — Monitor Recovery

Check MongoDB:

```javascript
db.serverStatus().connections
```

Monitor:

```text
current
available
totalCreated
```

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace> -f
```

Expected:

```text
Connection failures decrease
Pool wait time decreases
Application latency returns to normal
MongoDB available connections increase
```

---

## 17. Step 15 — Verify Application

Check:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

Check application errors:

```bash
kubectl logs <pod-name> -n <namespace> | \
grep -Ei 'MongoWaitQueue|MongoServerSelection|connection pool'
```

Expected:

```text
No continuing connection-pool errors
```

---

## 18. Do NOT Do These Things

### ❌ Don't blindly increase `maxIncomingConnections`

More connections can increase memory/CPU pressure.

### ❌ Don't blindly increase `maxPoolSize`

Every application process can create its own pool.

### ❌ Don't create MongoDB clients per request

Reuse the application's connection pool.

### ❌ Don't restart MongoDB as the first fix

The application may recreate the same connection storm.

### ❌ Don't kill MongoDB connections blindly

Identify the application and cause first.

### ❌ Don't ignore Kubernetes scaling

More pods can mean many more MongoDB connections.

---

## 19. Quick Reference

```bash
# Application logs
kubectl logs <pod-name> -n <namespace> | \
grep -Ei 'pool|connection|MongoWaitQueue|MongoServerSelection'

# Kubernetes pods
kubectl get pods -A -o wide

# Deployment
kubectl get deployment -A

# HPA
kubectl get hpa -A

# MongoDB status
systemctl status mongod

# MongoDB logs
tail -100 /var/log/mongodb/mongod.log

# CPU
top

# Memory
free -h

# OOM
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20
```

```javascript
// MongoDB connection statistics
db.serverStatus().connections

// Active operations
db.currentOp({
  active: true
})

// Server status
db.serverStatus()
```

---

## 20. Recovery Criteria

- [ ] Connection pool exhaustion confirmed.
- [ ] Affected application identified.
- [ ] MongoDB `current` and `available` connections checked.
- [ ] Application pod count checked.
- [ ] Pool configuration reviewed.
- [ ] Connection leak ruled out or fixed.
- [ ] Slow queries ruled out or fixed.
- [ ] Unexpected scaling/traffic ruled out.
- [ ] MongoDB CPU/memory stable.
- [ ] Available connections are increasing/stable.
- [ ] Application connection errors stopped.
- [ ] Application latency returned to normal.
- [ ] Permanent fix documented.

---

## 21. Escalation

Escalate to **Database/SRE** when:

- MongoDB connection capacity is consistently exhausted.
- MongoDB resource usage is high.
- Multiple applications are exhausting connections.
- Connection limits require architectural changes.

Escalate to the **Application Owner** when:

- Connection pools are incorrectly configured.
- MongoDB clients are created per request.
- Connection leaks are suspected.
- Application retries create connection storms.

Escalate to **Infrastructure/SRE** when:

- CPU/RAM/storage capacity is insufficient.
- Kubernetes scaling caused excessive connection growth.
- Network problems are contributing to connection failures.

---

## Golden Rule

```text
Connection Pool Exhaustion
          ↓
DON'T JUST INCREASE CONNECTION LIMIT
          ↓
Check MongoDB Connections
          ↓
Check Application Pods
          ↓
Calculate Pool Size
          ↓
Check Connection Leaks
          ↓
Check Slow Queries
          ↓
Check Traffic / HPA
          ↓
FIX ROOT CAUSE
          ↓
Monitor Connections
          ↓
Verify Application
```

> **Connection pool exhaustion = calculate connections across all application processes first. A pool size that looks safe for one pod can become dangerous when multiplied across many Kubernetes replicas.**
