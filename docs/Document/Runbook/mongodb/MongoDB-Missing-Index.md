# MongoDB Missing Index — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P2–P3 depending on application impact  
**Applies to:** MongoDB production replica sets

**Purpose:** Identify and safely resolve performance problems caused by missing or ineffective indexes.

---

## 1. Trigger

Use this runbook when:

- MongoDB queries are unexpectedly slow.
- Monitoring reports high query latency.
- CPU usage increases because of expensive queries.
- MongoDB logs show frequent `COLLSCAN`.
- `docsExamined` is much larger than `nReturned`.
- Application performance degrades after data growth.

> ⚠️ **Do not create an index just because you see `COLLSCAN`. First confirm that the query actually needs an index.**

---

## 2. Quick Decision Flow

```text
Slow MongoDB Query
       │
       ▼
Identify Query
       │
       ▼
Check Query Plan
       │
       ▼
COLLSCAN / Poor Plan?
       │
      YES
       │
       ▼
Check Existing Indexes
       │
       ▼
Design Appropriate Index
       │
       ▼
Test with explain()
       │
       ▼
Create Index Safely
       │
       ▼
Verify Query Performance
       │
       ▼
Monitor Production
```

---

## 3. Step 1 — Identify the Slow Query

Check MongoDB logs:

```bash
grep -Ei 'slow|COLLSCAN' /var/log/mongodb/mongod.log | tail -100
```

If slow-query logging is configured, identify:

```text
namespace
query/filter
sort
docsExamined
keysExamined
nReturned
planSummary
durationMillis
```

A suspicious query may look like:

```text
planSummary: COLLSCAN
docsExamined: 780000
nReturned: 1
```

This is a strong indication that the query may benefit from an index.

---

## 4. Step 2 — Reproduce the Query

Use `mongosh` against the appropriate database.

Example:

```javascript
use quiztwiz

db.emailusermodels.find({
  email: "user@example.com"
})
```

Do not test by modifying production data.

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

Example:

```text
_id_
email_1
createdAt_-1
```

If an appropriate index already exists, do not create a duplicate index.

---

## 6. Step 4 — Run `explain()`

Test the query:

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

For a good selective index, you generally want the number of examined documents to be close to the number of returned documents.

Example:

```text
nReturned: 1
totalDocsExamined: 1
```

Compare with a problematic plan:

```text
nReturned: 1
totalDocsExamined: 780000
```

---

## 7. Step 5 — Identify the Correct Index

Design the index based on the actual query pattern.

### Example — Equality Query

Query:

```javascript
db.emailusermodels.find({
  email: "user@example.com"
})
```

Possible index:

```javascript
db.emailusermodels.createIndex({
  email: 1
})
```

---

### Example — Equality + Sort

Query:

```javascript
db.orders.find({
  customerId: "123"
}).sort({
  createdAt: -1
})
```

Possible index:

```javascript
db.orders.createIndex({
  customerId: 1,
  createdAt: -1
})
```

---

### Example — Multiple Filter Fields

Query:

```javascript
db.housing_services.find({
  listing_type: "house",
  state: "CA",
  city: "Los Angeles"
}).sort({
  createdAt: -1
})
```

Possible index:

```javascript
db.housing_services.createIndex({
  listing_type: 1,
  state: 1,
  city: 1,
  createdAt: -1
})
```

> The correct index depends on the application's real query patterns. Do not copy an example index without checking the actual query.

---

## 8. Step 6 — Check Index Size / Existing Index Count

Before creating another index:

```javascript
db.<collection>.stats()
```

Check existing indexes:

```javascript
db.<collection>.getIndexes()
```

Review:

```text
Number of indexes
Index sizes
Collection size
Write workload
Available disk space
Available memory
```

Indexes consume disk space and memory and can increase write overhead.

---

## 9. Step 7 — Create the Index Safely

Create the approved index:

```javascript
db.emailusermodels.createIndex({
  email: 1
})
```

For a compound index:

```javascript
db.housing_services.createIndex({
  listing_type: 1,
  state: 1,
  city: 1,
  createdAt: -1
})
```

MongoDB will return the created index name, for example:

```text
email_1
```

> In a production replica set, consider the collection size, workload, disk capacity, and operational impact before creating a large index.

---

## 10. Step 8 — Verify the Index

```javascript
db.emailusermodels.getIndexes()
```

Then rerun:

```javascript
db.emailusermodels.find({
  email: "user@example.com"
}).explain("executionStats")
```

Check that the winning plan uses an index.

Look for:

```text
IXSCAN
```

instead of:

```text
COLLSCAN
```

Also compare:

```text
executionTimeMillis
totalKeysExamined
totalDocsExamined
nReturned
```

---

## 11. Step 9 — Verify Application Performance

Monitor:

```text
Query latency
MongoDB CPU
Disk I/O
Memory
Application response time
Error rate
```

Check MongoDB logs:

```bash
tail -f /var/log/mongodb/mongod.log
```

Confirm the slow query is no longer causing excessive scans.

---

## 12. Step 10 — Make the Index Permanent

If the index is required by the application:

- Document the index.
- Add it to the application's database migration/index management process.
- Include it in the deployment process where appropriate.
- Record the reason for the index.

Example documentation:

```text
Collection: emailusermodels
Index: { email: 1 }
Reason: Frequent email lookup
Observed problem: COLLSCAN over 780K documents
```

> Creating an index manually in production is a remediation step. The application's database/index management should remain the source of truth.

---

## 13. Common Problems

### A. `COLLSCAN` Still Appears

Check:

```javascript
db.<collection>.find(<query>).explain("executionStats")
```

Possible causes:

- Index does not match the query.
- Query uses different fields.
- Query includes a sort that is not supported by the index.
- Index selectivity is poor.
- Query shape changed.
- MongoDB chose another plan.

---

### B. Existing Index Is Not Used

Check:

```javascript
db.<collection>.getIndexes()
```

Then:

```javascript
db.<collection>.find(<query>).explain("executionStats")
```

Do not immediately force an index with `$hint`.

First understand why MongoDB selected the winning plan.

---

### C. Too Many Indexes

Too many indexes can:

- Increase disk usage.
- Increase memory usage.
- Increase write cost.
- Increase index maintenance overhead.

Review unused/unnecessary indexes before creating additional ones.

---

## 14. Do NOT Do These Things

### ❌ Don't create an index for every `COLLSCAN`

Some collection scans are intentional and efficient.

### ❌ Don't create duplicate indexes

Check:

```javascript
db.<collection>.getIndexes()
```

first.

### ❌ Don't blindly create indexes in production

Consider:

```text
Collection size
Disk space
Memory
Write workload
Query frequency
Operational impact
```

### ❌ Don't assume `COLLSCAN` always causes OOM

Memory problems can have many causes.

### ❌ Don't remove an existing index blindly

An index may support another critical query.

### ❌ Don't make indexes only manually

Record important indexes in the application's database migration/index management process.

---

## 15. Quick Reference

```bash
# Find COLLSCAN / slow queries
grep -Ei 'slow|COLLSCAN' \
/var/log/mongodb/mongod.log | tail -100
```

```javascript
// Select database
use <database>

// Check indexes
db.<collection>.getIndexes()

// Explain query
db.<collection>.find(<query>).explain("executionStats")

// Create simple index
db.<collection>.createIndex({
  <field>: 1
})

// Create compound index
db.<collection>.createIndex({
  <field1>: 1,
  <field2>: 1,
  <sortField>: -1
})

// Check collection statistics
db.<collection>.stats()

// Check database statistics
db.stats()
```

---

## 16. Recovery Criteria

- [ ] Slow query identified.
- [ ] Query pattern confirmed.
- [ ] Existing indexes reviewed.
- [ ] Query plan analyzed with `explain("executionStats")`.
- [ ] Appropriate index designed.
- [ ] Index creation completed successfully.
- [ ] Query uses the expected index.
- [ ] `COLLSCAN` is resolved where appropriate.
- [ ] Query latency improved.
- [ ] MongoDB CPU/memory is stable.
- [ ] Application performance is healthy.
- [ ] Index documented in the application's database/index management process.

---

## 17. Escalation

Escalate to **Database/SRE** when:

- Query performance remains poor after indexing.
- Index creation has significant production impact.
- Collection/index size is very large.
- MongoDB CPU or memory remains high.
- Query plans are difficult to optimize.

Escalate to the **Application Owner** when:

- Query design is inefficient.
- Application generates unexpected queries.
- Query patterns changed after a deployment.
- An index needs to be added permanently to application migrations.

---

## Golden Rule

```text
Slow Query
    ↓
Identify Query
    ↓
Check Existing Indexes
    ↓
Run explain("executionStats")
    ↓
Understand Query Pattern
    ↓
Design Correct Index
    ↓
Create Safely
    ↓
Verify IXSCAN + Performance
    ↓
Document in Application
```

> **Missing index = don't guess. Analyze the actual query and execution plan first, then create the smallest appropriate index that solves the real workload.**
