# MongoDB Slow Query — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P2–P3 depending on application impact  
**Applies to:** MongoDB production databases

**Purpose:** Identify and resolve slow MongoDB queries that cause high latency, CPU usage, disk I/O, or application performance problems.

---

## 1. Trigger

Use this runbook when:

- Application response time increases.
- MongoDB query latency is high.
- Monitoring reports slow queries.
- MongoDB CPU or disk I/O is unusually high.
- MongoDB logs show slow operations.
- Applications experience database timeouts.

> ⚠️ **Do not create or remove indexes immediately. First identify the actual slow query and analyze its execution plan.**

---

## 2. Quick Decision Flow

```text
Slow Query
    │
    ▼
Identify Query
    │
    ▼
Run explain("executionStats")
    │
    ▼
Check Query Plan
    │
 ┌──┴───────────────┐
 ▼                  ▼
IXSCAN            COLLSCAN
 │                  │
 ▼                  ▼
Check             Check
Query Shape       Missing Index
 │                  │
 └────────┬─────────┘
          ▼
Check Sort / Memory / I/O
          │
          ▼
Fix Root Cause
          │
          ▼
Retest Query
          │
          ▼
Verify Application
```

---

## 3. Step 1 — Confirm the Slow Query

Check MongoDB logs:

```bash
grep -Ei 'slow|COLLSCAN' /var/log/mongodb/mongod.log | tail -100
```

Look for:

```text
namespace
command
planSummary
keysExamined
docsExamined
nReturned
durationMillis
```

Record:

```text
Database:
Collection:
Query:
Duration:
docsExamined:
keysExamined:
nReturned:
planSummary:
```

---

## 4. Step 2 — Identify the Query Pattern

Determine:

```text
Filter fields
Sort fields
Projection fields
Pagination
Aggregation stages
Frequency
Expected result count
```

Example:

```javascript
use quiztwiz

db.emailusermodels.find({
  email: "user@example.com"
})
```

Do not change production data while reproducing the query.

---

## 5. Step 3 — Check Existing Indexes

```javascript
db.emailusermodels.getIndexes()
```

For another collection:

```javascript
db.<collection>.getIndexes()
```

Check whether an appropriate index already exists.

> Do not create a duplicate index.

---

## 6. Step 4 — Run `explain()`

```javascript
db.emailusermodels.find({
  email: "user@example.com"
}).explain("executionStats")
```

Check:

```text
winningPlan
executionTimeMillis
totalKeysExamined
totalDocsExamined
nReturned
```

Common stages:

```text
COLLSCAN
IXSCAN
FETCH
SORT
```

A problematic query may show:

```text
nReturned: 1
totalDocsExamined: 780000
```

A selective indexed query may show:

```text
nReturned: 1
totalDocsExamined: 1
```

---

## 7. Step 5 — Check for Missing Index

If the query uses:

```text
COLLSCAN
```

check whether an appropriate index exists.

Example:

```javascript
db.emailusermodels.createIndex({
  email: 1
})
```

Then rerun:

```javascript
db.emailusermodels.find({
  email: "user@example.com"
}).explain("executionStats")
```

Expected:

```text
IXSCAN
```

If the problem is specifically an index issue, use:

```text
MongoDB-Missing-Index.md
```

---

## 8. Step 6 — Check Sort Performance

Example:

```javascript
db.orders.find({
  customerId: "123"
}).sort({
  createdAt: -1
})
```

Consider whether an appropriate compound index exists:

```javascript
db.orders.createIndex({
  customerId: 1,
  createdAt: -1
})
```

Validate:

```javascript
db.orders.find({
  customerId: "123"
}).sort({
  createdAt: -1
}).explain("executionStats")
```

---

## 9. Step 7 — Check `docsExamined` vs `nReturned`

A useful diagnostic signal is:

```text
docsExamined >> nReturned
```

Example:

```text
docsExamined: 500000
nReturned:    10
```

Investigate:

```text
Missing index
Poor index
Low-selectivity index
Query design
Large result set
```

Do not treat a single ratio as proof that an index is required.

---

## 10. Step 8 — Check Query Frequency

Consider:

```text
Duration
Frequency
Total database load
CPU impact
Disk I/O
Application latency
```

A query that takes 100 ms once per hour may be less important than a query that takes 20 ms thousands of times per second.

---

## 11. Step 9 — Check CPU and Memory

```bash
top
```

```bash
free -h
```

```bash
ps aux --sort=-%mem | head -15
```

If MongoDB is under memory pressure, use:

```text
MongoDB-OOM.md
```

---

## 12. Step 10 — Check Disk I/O

```bash
iostat -xz 1 5
```

```bash
df -h
```

Look for:

```text
High await
High utilization
I/O errors
Low disk space
```

---

## 13. Step 11 — Check Current Operations

```javascript
db.currentOp({
  active: true
})
```

Look for:

```text
Long-running queries
Large aggregations
Index builds
Large sorts
Unexpected workloads
```

> Do not kill a production operation blindly. Confirm the operation, owner, and business impact first.

---

## 14. Step 12 — Check Aggregations

Example:

```javascript
db.orders.aggregate([
  { $match: { status: "pending" } },
  { $sort: { createdAt: -1 } },
  { $limit: 100 }
]).explain("executionStats")
```

Review:

```text
$match
$sort
$lookup
$group
$unwind
```

Look for unnecessary collection scans, large intermediate results, or expensive stages.

---

## 15. Step 13 — Fix the Root Cause

### Missing Index

Use:

```text
MongoDB-Missing-Index.md
```

### Poor Query

Work with the Application Owner to:

```text
Reduce unnecessary fields
Improve filters
Reduce result size
Improve pagination
Optimize aggregation
```

### High Query Volume

Investigate:

```text
Application traffic
Retry loops
Repeated queries
Connection behavior
Caching opportunities
```

### Storage Bottleneck

Investigate:

```text
Disk latency
IOPS
Storage capacity
Underlying volume
```

### Insufficient Server Capacity

Consider:

```text
CPU
RAM
Storage
Network
```

---

## 16. Step 14 — Test the Fix

Run the query again:

```javascript
db.<collection>.find(<query>).explain("executionStats")
```

Compare:

```text
executionTimeMillis
totalKeysExamined
totalDocsExamined
nReturned
winningPlan
```

Example:

```text
BEFORE
COLLSCAN
docsExamined: 780000
executionTimeMillis: 1200

AFTER
IXSCAN
docsExamined: 1
executionTimeMillis: 5
```

Use actual measurements rather than assumptions.

---

## 17. Step 15 — Monitor Production

Monitor:

```text
MongoDB CPU
MongoDB memory
Disk I/O
Query latency
Application latency
Error rate
Query frequency
```

```bash
tail -f /var/log/mongodb/mongod.log
```

Confirm the slow query no longer creates unacceptable load.

---

## 18. Step 16 — Make Database Changes Permanent

If an index was created:

- Document the index.
- Add it to the application's migration/index management process.
- Record why it is required.
- Record the query pattern it supports.

Example:

```text
Collection: emailusermodels
Index: { email: 1 }
Reason: Frequent email lookup
Problem: COLLSCAN over 780K documents
Result: Query latency reduced
```

---

## 19. Do NOT Do These Things

### ❌ Don't create an index for every slow query

Analyze the query plan first.

### ❌ Don't assume `COLLSCAN` is always bad

Some collection scans are intentional and efficient.

### ❌ Don't create duplicate indexes

Check:

```javascript
db.<collection>.getIndexes()
```

### ❌ Don't kill queries blindly

Identify the operation and business impact first.

### ❌ Don't immediately increase MongoDB resources

First identify the workload causing the problem.

### ❌ Don't optimize only one query without checking overall workload

A query may be fast but still create high load because it runs extremely frequently.

---

## 20. Quick Reference

```bash
# Find slow queries
grep -Ei 'slow|COLLSCAN' /var/log/mongodb/mongod.log | tail -100

# MongoDB logs
tail -100 /var/log/mongodb/mongod.log

# CPU
top

# Memory
free -h

# Disk
df -h

# Disk I/O
iostat -xz 1 5

# Top memory processes
ps aux --sort=-%mem | head -15
```

```javascript
// Check indexes
db.<collection>.getIndexes()

// Analyze query
db.<collection>.find(<query>).explain("executionStats")

// Analyze aggregation
db.<collection>.aggregate([
  ...
]).explain("executionStats")

// Check active operations
db.currentOp({ active: true })

// Check collection statistics
db.<collection>.stats()

// Check database statistics
db.stats()
```

---

## 21. Recovery Criteria

- [ ] Slow query identified.
- [ ] Query pattern confirmed.
- [ ] Query execution plan analyzed.
- [ ] Existing indexes reviewed.
- [ ] Root cause identified.
- [ ] Fix implemented and approved.
- [ ] `executionTimeMillis` improved.
- [ ] `docsExamined` is appropriate for the query.
- [ ] Query plan is appropriate.
- [ ] MongoDB CPU/memory is stable.
- [ ] Disk I/O is stable.
- [ ] Application latency is normal.
- [ ] No continuing slow-query alerts.
- [ ] Database/index changes documented.

---

## 22. Escalation

Escalate to **Database/SRE** when:

- Query remains slow after optimization.
- Query plans are complex or unexpected.
- MongoDB resource usage remains high.
- Large aggregations or indexes are involved.
- Multiple applications are affected.

Escalate to the **Application Owner** when:

- Query design is inefficient.
- Application generates excessive queries.
- A deployment caused the performance problem.
- Retry loops or traffic spikes are suspected.
- Application-level optimization is required.

Escalate to **Infrastructure/SRE** when:

- Storage latency is high.
- CPU/RAM capacity is insufficient.
- Network/storage infrastructure is degraded.

---

## Golden Rule

```text
Slow Query
    ↓
IDENTIFY ACTUAL QUERY
    ↓
Run explain("executionStats")
    ↓
Check Index / Query / Sort / Aggregation
    ↓
Check CPU / Memory / Disk I/O
    ↓
FIX ROOT CAUSE
    ↓
Measure Before vs After
    ↓
Monitor Production
    ↓
Verify Application
```

> **Slow query = don't guess. Identify the exact query, analyze its execution plan, measure the problem, fix the root cause, and verify the improvement in production.**
