# MongoDB Replica Set Member Down — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on replica-set redundancy  
**Applies to:** MongoDB production replica sets

**Purpose:** Safely diagnose and recover a MongoDB replica-set member that is unreachable, down, or no longer participating in replication.

---

## 1. Trigger

Use this runbook when:

- `rs.status()` shows a member as `DOWN` or `UNKNOWN`.
- Monitoring reports a MongoDB node down.
- `mongod` is not running.
- Applications report MongoDB availability problems.
- A replica-set member stops replicating.

> ⚠️ **Do not immediately remove the member from the replica set. First determine whether the node can be safely recovered.**

---

## 2. Quick Decision Flow

```text
Replica Set Member Down
          │
          ▼
Check Replica Set Health
          │
          ▼
Identify PRIMARY / SECONDARY
          │
          ▼
Check affected server
          │
 ┌────────┼──────────┬──────────┐
 ▼        ▼          ▼          ▼
Service  Server     Network    Disk /
Down     Down       /DNS       Memory
 │        │          │          │
 └────────┴──────────┴──────────┘
                 │
                 ▼
             Fix Cause
                 │
                 ▼
          Start / Recover Node
                 │
                 ▼
          Verify Replica Set
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
legacy-db-3   DOWN        health=0
```

Identify:

```text
PRIMARY
SECONDARY
DOWN
UNKNOWN
```

---

## 4. Step 2 — Check the Primary

```bash
mongosh --quiet --eval 'db.hello().primary'
```

Check replica-set health:

```bash
mongosh --quiet --eval 'rs.status().members'
```

### If the failed member is SECONDARY

The remaining healthy members can normally continue serving the replica set.

Continue troubleshooting the failed node.

### If the failed member is PRIMARY

Immediately confirm whether another eligible member became Primary:

```bash
mongosh --quiet --eval 'db.hello().primary'
```

Then:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'
```

> Do not manually force an election unless there is a specific approved reason.

---

## 5. Step 3 — Check the Affected Server

SSH to the affected server.

Check server availability:

```bash
uptime
```

Check MongoDB:

```bash
systemctl status mongod
```

Check whether the process exists:

```bash
pgrep -a mongod
```

If the server itself is unreachable, check:

```text
Server status
Network
SSH
Cloud provider / VM status
Recent reboot
Kernel issues
```

---

## 6. Step 4 — Check MongoDB Logs

If the server is reachable:

```bash
journalctl -u mongod --since "30 minutes ago" --no-pager
```

MongoDB log:

```bash
tail -200 /var/log/mongodb/mongod.log
```

Look for:

```text
FATAL
assertion
WiredTiger
Out of memory
No space left on device
I/O error
SEGV
TLS
authentication
connection refused
```

Identify the actual reason the member stopped.

---

## 7. Step 5 — Check Disk

```bash
df -h
```

Check inode usage:

```bash
df -i
```

Check MongoDB filesystem:

```bash
df -h /var/lib/mongodb
```

If disk is full, use:

```text
MongoDB-Disk-Full.md
```

before continuing.

---

## 8. Step 6 — Check Memory

```bash
free -h
```

Check OOM events:

```bash
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20
```

If MongoDB was OOM-killed, use:

```text
MongoDB-OOM.md
```

before continuing.

---

## 9. Step 7 — Check Network Connectivity

From another MongoDB member:

```bash
nc -vz <affected-host> 27017
```

From the affected server:

```bash
nc -vz <primary-host> 27017
```

Check DNS:

```bash
getent hosts <primary-host>
getent hosts <affected-host>
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

MongoDB replica-set members must be able to communicate with each other on the configured MongoDB port.

---

## 10. Step 8 — Check MongoDB Configuration

Check the replica-set configuration:

```bash
grep -n -A10 '^replication:' /etc/mongod.conf
```

Verify:

```text
replSetName
dbPath
bindIp
port
```

Check and validate configuration:

```bash
# Validate configuration file syntax
mongod --config /etc/mongod.conf --test

# Inspect expanded configuration
mongod --config /etc/mongod.conf --configExpand
```

Do not modify the replica-set name or authentication configuration during an incident without an approved change procedure.

---

## 11. Step 9 — Start MongoDB

If the root cause has been fixed:

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

Monitor:

```bash
tail -f /var/log/mongodb/mongod.log
```

---

## 12. Step 10 — Monitor Replica Set Recovery

From a healthy member:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

The recovered member may transition through:

```text
STARTUP2
   ↓
RECOVERING
   ↓
SECONDARY
```

Wait until it becomes:

```text
SECONDARY
```

---

## 13. Step 11 — Check Replication Lag

```bash
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

Confirm:

```text
Member is SECONDARY
Replication is progressing
Replication lag is acceptable
```

If the member enters `STARTUP2` and initial sync fails, use:

```text
MongoDB-Initial-Sync-Failure.md
```

---

## 14. Step 12 — If MongoDB Will Not Start

Check:

```bash
systemctl status mongod
```

Then:

```bash
journalctl -u mongod -n 100 --no-pager
```

And:

```bash
tail -100 /var/log/mongodb/mongod.log
```

Identify the cause.

Common cases:

```text
Disk full
   → MongoDB-Disk-Full.md

OOM
   → MongoDB-OOM.md

Initial sync failure
   → MongoDB-Initial-Sync-Failure.md

Authentication/TLS issue
   → Relevant authentication/TLS runbook

Data/storage corruption
   → Database/SRE escalation
```

---

## 15. Step 13 — Rebuild the Member Only If Required

If the member cannot be recovered and another healthy replica exists:

Confirm:

```text
[ ] Healthy PRIMARY exists
[ ] At least one healthy SECONDARY exists
[ ] Data is available on healthy members
[ ] Affected member is safe to rebuild
[ ] Application does not depend on this member
```

Then use the approved **MongoDB Initial Sync / Member Resync** procedure.

Do not immediately run:

```bash
rm -rf /var/lib/mongodb/*
```

Preserve the existing data until the rebuild procedure confirms it is safe to remove.

---

## 16. Do NOT Do These Things

### ❌ Don't immediately remove the member

A temporary server, network, disk, or MongoDB problem may be recoverable.

### ❌ Don't immediately force an election

MongoDB can normally handle Primary elections automatically.

### ❌ Don't delete `/var/lib/mongodb`

First confirm replica-set health and rebuild requirements.

### ❌ Don't restart all MongoDB members

Keep healthy members available.

### ❌ Don't ignore replication lag

A member may be running but still unhealthy from a replication perspective.

### ❌ Don't assume `DOWN` means data is lost

A replica-set member being down does not mean its data is lost.

---

## 17. Quick Reference

```bash
# Replica set health
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'

# Current Primary
mongosh --quiet --eval 'db.hello().primary'

# MongoDB status
systemctl status mongod

# MongoDB logs
tail -200 /var/log/mongodb/mongod.log

# Service logs
journalctl -u mongod --since "30 minutes ago"

# Disk
df -h
df -i

# Memory
free -h

# OOM
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20

# Network
nc -vz <host> 27017

# DNS
getent hosts <host>

# Routes
ip route

# Firewall
iptables -L -n

# Replica-set configuration
grep -n -A10 '^replication:' /etc/mongod.conf

# Start MongoDB
systemctl start mongod

# Replication lag
mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

---

## 18. Recovery Criteria

- [ ] A healthy Primary exists.
- [ ] Affected member is reachable.
- [ ] `mongod` is `active (running)`.
- [ ] Member is visible in `rs.status()`.
- [ ] Member is `SECONDARY`.
- [ ] `health = 1`.
- [ ] Replication is progressing.
- [ ] Replication lag is acceptable.
- [ ] No recurring MongoDB errors.
- [ ] Replica-set redundancy is restored.
- [ ] Application health is normal.

---

## 19. Escalation

Escalate to **Database/SRE** when:

- Multiple replica-set members are down.
- Primary and Secondary availability are degraded.
- Member cannot be recovered.
- Initial sync repeatedly fails.
- Data integrity is uncertain.
- Replica-set quorum is at risk.

Escalate to **Infrastructure/SRE** when:

- Server is unreachable.
- Disk/storage is failing.
- Memory pressure is recurring.
- Network connectivity is failing.
- VM/kernel problems are suspected.

Escalate to **Security** when:

- Authentication or TLS configuration is preventing replica-set communication.
- Unexpected credential/keyfile changes are suspected.

---

## Golden Rule

```text
Replica Set Member Down
          ↓
DON'T REMOVE MEMBER FIRST
          ↓
Check Replica Set
          ↓
Identify PRIMARY / SECONDARY
          ↓
Check Server + mongod
          ↓
Check Logs / Disk / Memory / Network
          ↓
FIX ROOT CAUSE
          ↓
Start MongoDB
          ↓
Wait for SECONDARY
          ↓
Verify Replication
          ↓
Verify Replica-Set Redundancy
```

> **Member Down = first protect replica-set availability, then recover the affected member safely.**
