# MongoDB Initial Sync Failure — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P2–P1 depending on replica-set redundancy  
**Applies to:** MongoDB production replica sets

**Purpose:** Diagnose and safely recover a replica-set member that is stuck in `STARTUP2`, repeatedly fails initial sync, or cannot become `SECONDARY`.

---

## 1. Trigger

Use this runbook when:

- A new/restarted MongoDB member remains in `STARTUP2`.
- Initial sync repeatedly fails.
- A Secondary never becomes `SECONDARY`.
- MongoDB logs show initial sync errors.
- Replica-set redundancy is reduced because a member cannot sync.

> ⚠️ **Do not delete `/var/lib/mongodb` until you have confirmed another healthy replica contains the required data.**

---

## 2. Quick Decision Flow

```text
Initial Sync Failure
        │
        ▼
Check Replica Set Health
        │
        ▼
Check Syncing Member
        │
        ▼
Check MongoDB Logs
        │
 ┌──────┼──────────┬──────────┐
 ▼      ▼          ▼          ▼
Network Disk     Source     Config
/DNS    Space    Member     /Auth
 │       │          │          │
 └───────┴──────────┴──────────┘
                 │
                 ▼
             Fix Cause
                 │
                 ▼
          Retry Initial Sync
                 │
                 ▼
             STARTUP2
                 │
                 ▼
            SECONDARY
                 │
                 ▼
        Verify Replication
```

---

## 3. Step 1 — Check Replica Set Status

Run from a healthy MongoDB member:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

Example:

```text
legacy-db-1   PRIMARY     health=1
legacy-db-2   SECONDARY   health=1
legacy-db-3   STARTUP2    health=1
```

Identify:

```text
PRIMARY
SECONDARY
STARTUP2
RECOVERING
UNKNOWN
DOWN
```

---

## 4. Step 2 — Check the Syncing Member

SSH to the affected MongoDB server.

```bash
systemctl status mongod
```

Check replica state:

```bash
mongosh --quiet --eval 'rs.status().myState'
```

Useful states:

```text
1 = PRIMARY
2 = SECONDARY
5 = STARTUP2
6 = UNKNOWN
3 = RECOVERING
```

Check:

```bash
mongosh --quiet --eval 'rs.status().members'
```

---

## 5. Step 3 — Check MongoDB Logs

This is the most important step.

```bash
tail -200 /var/log/mongodb/mongod.log
```

Search for initial-sync errors:

```bash
grep -Ei \
'initial sync|initialsync|sync source|rollback|oplog|WiredTiger|error|failed' \
/var/log/mongodb/mongod.log | tail -100
```

Common errors include:

```text
initial sync failed
failed to connect to sync source
no sync source available
oplog is too stale
not enough disk space
authentication failed
TLS error
network timeout
WiredTiger error
```

---

## 6. Step 4 — Check Disk Space

Initial sync requires sufficient storage.

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

Check filesystem:

```bash
df -h /var/lib/mongodb
```

> The syncing member needs enough space for the database files and indexes.

If disk is full, use:

```text
MongoDB-Disk-Full.md
```

before continuing.

---

## 7. Step 5 — Check Network Connectivity

The syncing member must communicate with the source member.

Check DNS:

```bash
getent hosts <primary-host>
```

Test MongoDB port:

```bash
nc -vz <primary-host> 27017
```

Test from the syncing node to each potential sync source:

```bash
nc -vz <sync-source-host> 27017
```

Check routes:

```bash
ip route
```

Check firewall:

```bash
iptables -L -n
```

If using UFW:

```bash
ufw status
```

---

## 8. Step 6 — Check MongoDB Authentication

If logs show:

```text
authentication failed
Unauthorized
SCRAM
```

verify the MongoDB authentication configuration.

Check:

```bash
grep -n "security:" -A10 /etc/mongod.conf
```

If using keyfile authentication:

```bash
grep -n "keyFile" /etc/mongod.conf
```

Check keyfile permissions:

```bash
ls -l <keyfile-path>
```

Do not expose the key contents.

If the problem is authentication-related, resolve it before retrying the sync.

---

## 9. Step 7 — Check TLS

If MongoDB uses TLS and logs show:

```text
TLS
SSL
certificate
x509
handshake
certificate verify failed
```

check:

```bash
grep -n "tls:" -A15 /etc/mongod.conf
```

Verify:

```text
CA certificate
Server certificate
Certificate expiration
Hostname/SAN
File permissions
```

Do not disable TLS simply to make initial sync work.

---

## 10. Step 8 — Check Sync Source

From a healthy Primary:

```javascript
rs.status().members
```

Check:

```text
PRIMARY
SECONDARY
health
stateStr
optime
optimeDate
```

Check whether healthy members are available as sync sources.

From the affected member:

```javascript
rs.status().members
```

If the source member is unhealthy or unreachable, fix that member first.

> Do not force a sync source unless there is a specific reason. MongoDB normally selects a suitable sync source automatically.

---

## 11. Step 9 — Check Oplog Availability

A member may fail to catch up if the required oplog history is no longer available.

From a healthy member:

```javascript
rs.printReplicationInfo()
```

Check:

```text
log length
oplog first event time
oplog last event time
```

Check the affected member's progress:

```javascript
rs.printSecondaryReplicationInfo()
```

If the required oplog history is no longer available, the member may require a new initial sync.

---

## 12. Step 10 — Check for Resource Pressure

Check memory:

```bash
free -h
```

Check CPU:

```bash
top
```

Check disk:

```bash
df -h
```

Check I/O:

```bash
iostat -xz 1 5
```

If the system is under heavy resource pressure, resolve the infrastructure problem before retrying initial sync.

---

## 13. Step 11 — Restart MongoDB After Fixing the Cause

Only restart after the identified problem has been corrected.

```bash
systemctl restart mongod
```

Check:

```bash
systemctl status mongod
```

Monitor logs:

```bash
tail -f /var/log/mongodb/mongod.log
```

Monitor replica state:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

Expected progression:

```text
STARTUP2
   ↓
RECOVERING
   ↓
SECONDARY
```

---

## 14. Step 12 — If Initial Sync Continues to Fail

If the member repeatedly returns to `STARTUP2` or initial sync fails again:

**Do not repeatedly restart MongoDB without investigating the cause.**

Check:

```text
1. MongoDB logs
2. Disk space
3. Network connectivity
4. Authentication
5. TLS
6. Sync source health
7. Oplog availability
8. CPU/memory/I/O
```

If the node cannot recover and another healthy replica exists, use the approved **MongoDB Replica Set Member Resync** procedure.

---

## 15. Section A — Safe Member Resync

Use this only after confirming:

```text
[ ] Another healthy PRIMARY exists
[ ] At least one healthy SECONDARY exists
[ ] Required data exists on healthy members
[ ] The affected member can be rebuilt
[ ] Application traffic does not depend on this member
```

Stop MongoDB:

```bash
systemctl stop mongod
```

**Before deleting any database files, confirm the approved resync procedure for your environment.**

A typical rebuild may involve moving the existing database directory rather than immediately deleting it:

```bash
mv /var/lib/mongodb /var/lib/mongodb.old
mkdir /var/lib/mongodb
chown -R mongodb:mongodb /var/lib/mongodb
```

Then start MongoDB:

```bash
systemctl start mongod
```

MongoDB should begin synchronization from a healthy replica-set member.

> ⚠️ **Do not run `rm -rf /var/lib/mongodb/*` as a first step. Preserve the old directory until the new member has successfully synchronized and your recovery procedure allows cleanup.**

---

## 16. Step 13 — Monitor Initial Sync

Watch MongoDB logs:

```bash
tail -f /var/log/mongodb/mongod.log
```

Check state:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

The expected final state is:

```text
SECONDARY
```

Check replication:

```javascript
rs.printSecondaryReplicationInfo()
```

---

## 17. Step 14 — Verify Replica Set

Run:

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

Check replication lag:

```javascript
rs.printSecondaryReplicationInfo()
```

Confirm:

```text
[ ] Member is SECONDARY
[ ] health = 1
[ ] Replication is progressing
[ ] Replication lag is acceptable
[ ] No recurring initial-sync errors
```

---

## 18. Step 15 — Verify Application

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Look for continuing:

```text
MongoServerSelectionError
connection refused
timeout
MongoNetworkError
```

Check application health:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

---

## 19. Do NOT Do These Things

### ❌ Don't immediately delete `/var/lib/mongodb`

First confirm healthy replica-set members and data availability.

### ❌ Don't repeatedly restart MongoDB

Repeated restarts do not fix an underlying network, disk, authentication, TLS, or oplog problem.

### ❌ Don't force a sync source blindly

MongoDB normally selects an appropriate source.

### ❌ Don't disable TLS

Fix the certificate/configuration problem instead.

### ❌ Don't disable authentication

Fix credentials/keyfile/configuration instead.

### ❌ Don't run `mongod --repair` as an initial-sync solution

Initial sync failure is not automatically data corruption.

### ❌ Don't remove a healthy replica

Maintain replica-set redundancy while repairing the affected member.

---

## 20. Quick Reference

```bash
# Replica set status
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'

# MongoDB status
systemctl status mongod

# MongoDB logs
tail -200 /var/log/mongodb/mongod.log

# Initial sync errors
grep -Ei \
'initial sync|initialsync|sync source|rollback|oplog|WiredTiger|error|failed' \
/var/log/mongodb/mongod.log | tail -100

# Disk
df -h
df -i
du -sh /var/lib/mongodb

# Network
getent hosts <primary-host>
nc -vz <primary-host> 27017
ip route

# Firewall
iptables -L -n
ufw status

# Memory
free -h

# CPU
top

# I/O
iostat -xz 1 5

# Oplog information
mongosh --quiet --eval 'rs.printReplicationInfo()'

# Secondary replication information
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'

# Restart MongoDB
systemctl restart mongod

# Monitor logs
tail -f /var/log/mongodb/mongod.log
```

---

## 21. Recovery Criteria

- [ ] MongoDB service is `active (running)`.
- [ ] A healthy Primary exists.
- [ ] Affected member is `SECONDARY`.
- [ ] `health = 1`.
- [ ] Initial sync has completed.
- [ ] Replication is progressing.
- [ ] Replication lag is acceptable.
- [ ] No recurring initial-sync errors.
- [ ] No disk/network/TLS/authentication errors.
- [ ] Application can connect to MongoDB.
- [ ] Application health check succeeds.
- [ ] Replica-set redundancy has been restored.

---

## 22. Escalation

Escalate to **Database/SRE** when:

- Initial sync repeatedly fails.
- Oplog history is insufficient.
- Multiple replica-set members are affected.
- Data integrity is uncertain.
- Resync/rebuild is required.

Escalate to **Infrastructure/SRE** when:

- Network connectivity is failing.
- Disk/storage is insufficient.
- CPU/memory/I/O pressure is preventing sync.

Escalate to **Security** when:

- Authentication/keyfile problems are suspected.
- TLS/certificate problems are suspected.

---

## Golden Rule

```text
Initial Sync Failure
        ↓
DON'T DELETE DATA FIRST
        ↓
Check Replica Set
        ↓
Check Logs
        ↓
Check Disk / Network / Auth / TLS / Oplog
        ↓
FIX ROOT CAUSE
        ↓
Retry Initial Sync
        ↓
STARTUP2
        ↓
SECONDARY
        ↓
Verify Replication
        ↓
Verify Application
```

> **Initial sync failure = protect replica-set redundancy first, identify the actual sync failure, then rebuild the member only when it is safe to do so.**
