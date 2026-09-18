# MongoDB Crash — Runbook

**Service:** MongoDB Replica Set
**Owner:** DevOps / SRE
**Severity:** P1–P2 depending on application impact
**Applies to:** MongoDB production replica sets

**Purpose:** Quickly identify why `mongod` crashed and safely recover the affected replica-set member.

---

## 1. Trigger

Use this runbook when:

* `mongod` service is `failed`.
* MongoDB process has crashed.
* Applications report MongoDB connection errors.
* Monitoring reports `mongod` down.
* MongoDB repeatedly crashes after startup.

> **Important:** Do not immediately delete MongoDB data files. First check replica-set health and determine the crash cause.

---

## 2. Quick Decision Flow

```text
MongoDB Crash
      │
      ▼
Check mongod status
      │
      ▼
Check replica-set health
      │
      ▼
Check MongoDB + system logs
      │
 ┌────┼─────────┬──────────┬──────────┐
 ▼    ▼         ▼          ▼          ▼
SEGV  OOM     Storage    Assertion   Unknown
 │     │         │          │           │
 ▼     ▼         ▼          ▼           ▼
Kernel Memory   Disk/      Data       Deeper
       /RAM     I/O        issue      analysis
 │     │         │          │
 └─────┴─────────┴──────────┘
              │
              ▼
        Apply safe fix
              │
              ▼
        Start MongoDB
              │
              ▼
      Verify replica set
              │
              ▼
       Verify application
```

---

## 3. Step 1 — Check MongoDB Status

```bash
systemctl status mongod
```

Check:

```text
Active: failed
code=dumped
signal=SEGV
Result: exit-code
```

Also check:

```bash
journalctl -u mongod --since "30 minutes ago" --no-pager
```

---

## 4. Step 2 — Check Replica Set FIRST

If another member is healthy, run from that member:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

Check the Primary:

```bash
mongosh --quiet --eval 'db.hello().primary'
```

Check replication:

```javascript
rs.printSecondaryReplicationInfo()
```

### Expected

```text
PRIMARY
SECONDARY
SECONDARY
```

If another member is already Primary:

```text
Do not manually force an election.
Continue investigating the failed member.
```

---

## 5. Step 3 — Check MongoDB Logs

```bash
tail -100 /var/log/mongodb/mongod.log
```

Look for:

```text
FATAL
assertion
WiredTiger
corruption
SEGV
out of memory
I/O error
No space left on device
TLS
authentication
```

System/kernel logs:

```bash
dmesg | grep -Ei \
'segfault|oom|out of memory|I/O error|filesystem' | tail -20
```

Also check:

```bash
journalctl -k --since "30 minutes ago" --no-pager
```

---

## 6. Step 4 — Identify the Cause

| Evidence                  | Likely Cause                  | Action                         |
| ------------------------- | ----------------------------- | ------------------------------ |
| `SEGV` / `signal=SEGV`    | Process/kernel/hardware issue | Check kernel/system            |
| `OOM` / `oom_kill`        | Memory exhaustion             | Check RAM/processes            |
| `No space left on device` | Disk full                     | Free/expand disk               |
| `I/O error`               | Storage problem               | Investigate disk/filesystem    |
| WiredTiger corruption     | Data/storage issue            | Preserve node; consider resync |
| `FATAL` / assertion       | MongoDB failure               | Review logs before restart     |
| TLS errors                | Certificate/configuration     | Check TLS configuration        |
| Authentication errors     | Auth configuration            | Check users/credentials        |
| No clear cause            | Unknown                       | Escalate/deeper investigation  |

---

## 7. Section A — SEGV / Kernel Issue

Check:

```bash
uname -r
```

Check CPU information:

```bash
lscpu
```

Check kernel messages:

```bash
dmesg | grep -Ei 'segfault|mongod' | tail -20
```

If the crash follows a recent infrastructure change, compare:

```text
Kernel
CPU/vCPU configuration
Recent OS changes
Recent MongoDB changes
```

> **Environment-specific note:** If this matches the previously observed Linode CPU-plan/kernel incident, follow the approved infrastructure boot/kernel recovery procedure. Do not assume every MongoDB SEGV is a kernel problem.

After the infrastructure fix:

```bash
systemctl start mongod
```

---

## 8. Section B — OOM / Memory

Check memory:

```bash
free -h
```

Check OOM events:

```bash
dmesg | grep -Ei 'oom|out of memory' | tail -20
```

Check MongoDB configuration:

```bash
grep -A10 'wiredTiger' /etc/mongod.conf
```

Check processes:

```bash
ps aux --sort=-%mem | head
```

Do not blindly change `cacheSizeGB`.

First determine whether the memory pressure came from:

```text
MongoDB
Index build
Application
Other system process
Node/container workload
```

After addressing the cause:

```bash
systemctl start mongod
```

---

## 9. Section C — Disk / Storage Problem

Check disk:

```bash
df -h
```

Check inode usage:

```bash
df -i
```

Check MongoDB directory:

```bash
du -sh /var/lib/mongodb
```

Look for:

```text
No space left on device
I/O error
Filesystem error
```

If disk is full:

1. Identify what is consuming space.
2. Use the approved disk-cleanup procedure.
3. Do not delete MongoDB database files.
4. Verify free space.
5. Start MongoDB.

```bash
systemctl start mongod
```

---

## 10. Section D — Possible Data Corruption

If logs show:

```text
WiredTiger
corruption
FATAL
assertion
Invariant failure
```

**Do not immediately delete or repair the database files.**

First check the replica set from another healthy member:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

Confirm:

```text
[ ] Another member is PRIMARY
[ ] At least one healthy SECONDARY exists
[ ] Replica-set health is acceptable
[ ] Data is available on healthy members
```

If the failed member cannot safely recover, use the approved **MongoDB Initial Sync / Member Resync Runbook**.

> Do not perform destructive resync operations until replica-set health and data availability have been confirmed.

---

## 11. Step 5 — Start MongoDB

Only after addressing the identified cause:

```bash
systemctl start mongod
```

Check:

```bash
systemctl status mongod
```

Expected:

```text
Active: active (running)
```

Check logs:

```bash
journalctl -u mongod --since "5 minutes ago" --no-pager
```

---

## 12. Step 6 — Verify Replica Set Recovery

From a healthy member:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

Expected:

```text
PRIMARY     1
SECONDARY   1
SECONDARY   1
```

If the recovered member shows:

```text
STARTUP2
```

it may be performing initial synchronization.

If:

```text
RECOVERING
```

allow it to recover before considering the incident complete.

Eventually expect:

```text
SECONDARY
```

Check replication lag:

```javascript
rs.printSecondaryReplicationInfo()
```

---

## 13. Step 7 — Verify Application

Check MongoDB connectivity:

```bash
mongosh --quiet --eval 'db.hello()'
```

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Look for continuing:

```text
MongoServerSelectionError
connection refused
timeout
authentication failure
```

Finally perform the application's health check.

---

## 14. Do NOT Do These Things

### ❌ Don't immediately delete `/var/lib/mongodb`

Never do:

```bash
rm -rf /var/lib/mongodb/*
```

until the replica-set/data-safety conditions for resync have been verified.

### ❌ Don't manually delete `mongod.lock`

Do not use removal of `mongod.lock` as a standard crash-recovery step.

### ❌ Don't force an election unnecessarily

If the remaining replica-set members can elect a Primary normally, let MongoDB handle the election.

### ❌ Don't immediately run `mongod --repair`

Repair is not the default solution for a replica-set member that can be safely rebuilt from another healthy member.

### ❌ Don't restart all MongoDB members

Recover the affected member while keeping the healthy replica-set members available.

---

## 15. Quick Reference

```bash
# MongoDB status
systemctl status mongod

# MongoDB service logs
journalctl -u mongod --since "30 minutes ago"

# MongoDB log
tail -100 /var/log/mongodb/mongod.log

# Kernel errors
dmesg | grep -Ei 'segfault|oom|I/O error' | tail -20

# Memory
free -h

# Disk
df -h
df -i

# MongoDB data directory
du -sh /var/lib/mongodb

# Kernel
uname -r

# Replica set
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'

# Current Primary
mongosh --quiet --eval 'db.hello().primary'

# Replication lag
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'

# Start MongoDB
systemctl start mongod

# Stop MongoDB
systemctl stop mongod

# Status
systemctl status mongod
```

---

## 16. Recovery Criteria

The incident is resolved when:

* [ ] `mongod` is `active (running)`.
* [ ] No continuing crash/SEGV.
* [ ] No active OOM condition.
* [ ] Disk has sufficient free space.
* [ ] Replica set has a healthy Primary.
* [ ] Recovered member is `SECONDARY` or otherwise healthy.
* [ ] Replication lag is acceptable.
* [ ] No continuing WiredTiger/storage errors.
* [ ] Applications can connect to MongoDB.
* [ ] Application error rate has returned to normal.

---

## 17. Escalation

Escalate to **Database/SRE** when:

* MongoDB repeatedly crashes after restart.
* Replica-set health is degraded.
* Multiple members are affected.
* Data corruption is suspected.
* Initial sync/resync fails.
* Replication cannot recover.

Escalate to **Infrastructure/SRE** when:

* Kernel/CPU problems are suspected.
* Disk or filesystem errors are detected.
* OOM is caused by node-level resource exhaustion.

Escalate to the **Application Owner** when:

* A deployment caused abnormal MongoDB load.
* Application connection pools are exhausting MongoDB connections.
* Application queries are causing excessive resource consumption.

---

## Golden Rule

```text
MongoDB Crash
      ↓
DON'T DELETE DATA
      ↓
Check Replica Set
      ↓
Check mongod + system logs
      ↓
Identify Root Cause
      ↓
Fix Cause
      ↓
Start MongoDB
      ↓
Verify Replica Set
      ↓
Verify Replication
      ↓
Verify Application
```

> **MongoDB crash = first protect the replica set, then diagnose the failed member, then recover it safely.**
