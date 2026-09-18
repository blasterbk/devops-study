# MongoDB Crash Runbook
**Service:** legacy-rs (MongoDB 8.2.4) | **Owner:** DevOps | **Applies to:** legacy-db-1/2/3.unibotsapi.com

---

## Trigger

Run this runbook when **any** of the following is true:

- `systemctl status mongod` shows `Active: failed` or `code=dumped, signal=SEGV`
- MongoDB is restarting repeatedly (crash loop)
- Apps report MongoDB connection errors
- Monitoring alert fires on `mongod` process down

---

## Step 1 — Confirm the Crash Type

```bash
systemctl status mongod | grep -E 'Active|code|signal'
```

| Output | Go to |
|---|---|
| `signal=SEGV` or `code=dumped` | Step 2 |
| `Result: exit-code` | Check logs: `tail -50 /var/log/mongodb/mongod.log` |
| `Active: active (running)` | Not crashed — check replication lag (Step 5) |

---

## Step 2 — Check Replica Set Status First

> Run this from a **healthy node** before touching anything.

```bash
mongosh --quiet --eval "rs.status().members.forEach(m => print(m.name, m.stateStr))"
```

| Crashed Node State | Meaning | Action |
|---|---|---|
| `(not shown)` / `UNKNOWN` | Node is down | Continue this runbook |
| `STARTUP2` | Already recovering (syncing) | Skip to Step 5 |
| `PRIMARY` | This was primary | Other node auto-elected — continue runbook |

> ⚠️ **Do not force a primary election manually.** MongoDB handles this automatically with a 3-node replica set.

---

## Step 3 — Identify Root Cause

Run all three checks:

```bash
# Check 1 — Hardware/kernel segfault
dmesg | grep segfault | tail -5

# Check 2 — OOM kill
dmesg | grep -E 'oom_kill|Out of memory' | tail -5

# Check 3 — Slow queries / COLLSCAN in logs
tail -100 /var/log/mongodb/mongod.log | grep -E 'COLLSCAN|Slow query|FATAL|assertion'
```

### Decision Tree

```
Is there a segfault in dmesg?
├── YES → Go to Section A (Kernel/CPU Issue)
└── NO
    ├── Is there oom_kill in dmesg? → Go to Section B (OOM / Memory)
    ├── Is there COLLSCAN in logs?  → Go to Section C (Missing Index)
    └── Is there assertion/FATAL?   → Go to Section D (Data Corruption)
```

---

## Step 4 — Execute Targeted Fix

Choose the matching section based on the Step 3 Decision Tree:

---

### Section A — Kernel / CPU Issue (SEGV)

**Symptoms:**
- `dmesg` shows: `segfault ... in mongod ... likely on CPU X`
- Node recently had a CPU plan upgrade on Linode
- Crash happens within 30-60 seconds of start

**Cause:** Linode custom kernel is incompatible with new vCPU topology (`pc-q35-7.2`).

#### Fix

**1. Verify it is a kernel issue:**
```bash
uname -r
# If output contains "linode" e.g. 7.0.5-x86_64-linode173 → proceed
lscpu | grep 'BIOS Model'
# If output shows pc-q35-X.X → vCPU model changed
```

**2. Switch kernel to GRUB (Legacy / Distro Kernel):**

*Option 1 — Via Linode CLI (Fastest):*
```bash
# List Linodes and get Linode ID & Config ID
linode-cli linodes list
linode-cli linodes configs-list <linode_id>

# Update boot config kernel to GRUB 2 and reboot
linode-cli linodes config-update <linode_id> <config_id> --kernel "linode/grub2"
linode-cli linodes reboot <linode_id>
```

*Option 2 — Via Linode Cloud Manager Dashboard:*
```
Linode Dashboard → Node → Configuration → Edit -> Boot Settings
→ Change kernel: Latest 64bit (linode173) → GRUB (Legacy)
→ Save → Reboot
```

**3. Verify after reboot:**
```bash
uname -r
# Must NOT contain "linode" — should show e.g. 6.1.0-28-amd64

systemctl status mongod
# Must show: Active: active (running)
```

**4. Go to Step 5 — Verify Recovery.**

---

### Section B — OOM / Memory Exhaustion

**Symptoms:**
- `dmesg` shows: `oom_kill_process` or `Out of memory: Kill process`
- Memory peak shown in `systemctl status` is close to total RAM
- No segfault in dmesg

#### Fix

**1. Check current memory, swap, and cache config:**
```bash
free -h
grep -A5 'wiredTiger' /etc/mongod.conf
```

> **Emergency Swap:** If `Swap: 0B`, create an emergency 2GB swap file to absorb write spikes and prevent sudden OOM-killing:
> ```bash
> fallocate -l 2G /swapfile && chmod 600 /swapfile
> mkswap /swapfile && swapon /swapfile
> ```

**2. If no `cacheSizeGB` is set — add it:**
```bash
nano /etc/mongod.conf
```

Add under `storage:`:
```yaml
storage:
  dbPath: /var/lib/mongodb
  wiredTiger:
    engineConfig:
      cacheSizeGB: 2.0        # Use ~25% to 50% of total RAM
    collectionConfig:
      blockCompressor: snappy
```

| Total RAM | cacheSizeGB | Notes |
|---|---|---|
| 2 GB | 0.5 | Minimal headroom for OS |
| 4 GB | 1.0 | Standard 25% allocation |
| 8 GB | 2.0 | Recommended for 8GB Linode VM |
| 16 GB | 4.0 | Recommended for 16GB Linode VM |

**3. Shield MongoDB from app reconnect storm (Preserving Replica Heartbeats):**
```bash
# Allow local loopback and replica set peer nodes FIRST (prevent quorum loss)
iptables -I INPUT 1 -s 127.0.0.1 -p tcp --dport 27017 -j ACCEPT
iptables -I INPUT 2 -s legacy-db-1.unibotsapi.com,legacy-db-2.unibotsapi.com,legacy-db-3.unibotsapi.com -p tcp --dport 27017 -j ACCEPT

# Block general app traffic
iptables -I INPUT 3 -p tcp --dport 27017 -m comment --comment "APP_SHIELD" -j DROP
```

**4. Start MongoDB:**
```bash
systemctl start mongod
sleep 10 && systemctl status mongod | grep Active
```

**5. Check for missing indexes (COLLSCANs drive OOM):**
```bash
tail -200 /var/log/mongodb/mongod.log | grep COLLSCAN
```
If COLLSCANs found → Go to **Section C** before unblocking apps.

**6. Unblock app traffic:**
```bash
iptables -D INPUT -p tcp --dport 27017 -m comment --comment "APP_SHIELD" -j DROP
```

**7. Go to Step 5 — Verify Recovery.**

---

### Section C — Missing Index (COLLSCAN)

**Symptoms:**
- `mongod.log` shows `"planSummary":"COLLSCAN"` with `docsExamined` > 100,000
- High memory usage growing rapidly after start
- Crash happens 30-120 seconds after apps reconnect

#### Fix

**1. Identify which collections need indexes:**
```bash
grep 'COLLSCAN' /var/log/mongodb/mongod.log | \
  grep -o '"ns":"[^"]*"' | sort | uniq -c | sort -rn | head -10
```

**2. Shield DB from apps before creating indexes (prevents crash during index build):**
```bash
# Whitelist localhost and replica set peers
iptables -I INPUT 1 -s 127.0.0.1 -p tcp --dport 27017 -j ACCEPT
iptables -I INPUT 2 -s legacy-db-1.unibotsapi.com,legacy-db-2.unibotsapi.com,legacy-db-3.unibotsapi.com -p tcp --dport 27017 -j ACCEPT

# Block app traffic
iptables -I INPUT 3 -p tcp --dport 27017 -m comment --comment "APP_SHIELD" -j DROP
```

**3. Start MongoDB:**
```bash
systemctl start mongod
```

**4. Connect and create indexes:**
```bash
mongosh -u admin -p --authenticationDatabase admin
```

```javascript
// For each collection identified in step 1
// Example — email lookup:
use quiztwiz
db.emailusermodels.createIndex({ email: 1 })

// Example — compound search with sort:
use dental-arb
db.housing_services.createIndex(
  { listing_type: 1, state: 1, city: 1, createdAt: -1 }
)

// Verify index is READY (not just building)
db.emailusermodels.getIndexes()
```

> ⏳ Index build on 780K docs takes ~2 minutes. Wait for status `READY` before proceeding.

**5. Rotate logs if query floods filled the disk:**
```bash
mongosh -u admin -p --authenticationDatabase admin --quiet --eval "db.adminCommand({ logRotate: 1 })"
```

**6. Unblock apps:**
```bash
iptables -D INPUT -p tcp --dport 27017 -m comment --comment "APP_SHIELD" -j DROP
```

**7. Go to Step 5 — Verify Recovery.**

---

### Section D — Data Corruption

**Symptoms:**
- `mongod.log` shows `FATAL`, `Invariant failure`, or `assertion` before crash
- Crash happens immediately on start (< 5 seconds)
- WiredTiger errors in log

#### Fix

**1. Check for WiredTiger errors:**
```bash
grep -E 'FATAL|assertion|WiredTiger|corruption' /var/log/mongodb/mongod.log | tail -20
```

**2. Check for stale lock file:**
```bash
ls -la /var/lib/mongodb/mongod.lock
# If file exists and mongod is NOT running:
rm /var/lib/mongodb/mongod.lock
systemctl start mongod
```

**3. If corruption confirmed — do NOT start this node blindly.**

Check if replica set has healthy nodes (run from another node):
```bash
mongosh --quiet --eval "rs.status().members.forEach(m => print(m.name, m.stateStr))"
```

Also verify the primary's oplog window has sufficient retention for initial sync:
```bash
mongosh --quiet --eval "rs.printReplicationInfo()"
```

If another node is healthy (PRIMARY/SECONDARY):
```bash
# Resync from primary — backup diagnostic logs, wipe data, and let replication rebuild
systemctl stop mongod
mkdir -p /root/mongodb-crash-backup
cp -r /var/lib/mongodb/diagnostic.data /root/mongodb-crash-backup/ 2>/dev/null || true

rm -rf /var/lib/mongodb/*
chown -R mongodb:mongodb /var/lib/mongodb
chmod 700 /var/lib/mongodb

systemctl start mongod
# MongoDB will automatically resync from primary (STARTUP2 state)
# Monitor: watch -n5 "mongosh --quiet --eval 'rs.status().members.forEach(m => print(m.name, m.stateStr))'"
```

> ⚠️ **Only wipe data if at least 1 other node is PRIMARY or SECONDARY with up-to-date optime.**

**4. Go to Step 5 — Verify Recovery.**

---

## Step 5 — Verify Recovery

Run all checks before closing the incident.

```bash
# 1. MongoDB is running
systemctl status mongod | grep Active
# Expected: Active: active (running)

# 2. Replica set is healthy (run from any node)
mongosh --quiet --eval "rs.status().members.forEach(m => print(m.name, m.stateStr))"
# Expected: all nodes show SECONDARY or PRIMARY (no UNKNOWN/DOWN)

# 3. Primary is properly elected
mongosh --quiet --eval "db.hello().primary"

# 4. No more COLLSCANs in live log
tail -f /var/log/mongodb/mongod.log | grep -E 'COLLSCAN|FATAL|ERROR'
# Expected: no output (let run for 60 seconds)

# 5. Memory is stable
watch -n5 "systemctl status mongod | grep Memory"
# Expected: memory not growing rapidly
```

### Recovery State Reference

| Node State | Meaning | Wait? |
|---|---|---|
| `PRIMARY` | Healthy, accepting writes | No |
| `SECONDARY` | Healthy, replicating | No |
| `STARTUP2` | Syncing from primary | Yes — wait until SECONDARY |
| `RECOVERING` | Catching up on oplog | Yes — wait until SECONDARY |
| `UNKNOWN` | Cannot reach node | Investigate network/firewall |
| `DOWN` | Node confirmed down | Re-run this runbook |

---

## Step 6 — Post-Incident Actions

Complete within 24 hours of resolution:

- [ ] Update this runbook if new scenario was encountered
- [ ] File postmortem if downtime > 15 minutes
- [ ] Create indexes permanently in app codebase (e.g. Mongoose/Prisma schema)
- [ ] Add slow query alert for COLLSCAN > 100ms in monitoring
- [ ] Verify all other replica set nodes use GRUB kernel (not Linode custom)
- [ ] Check `maxIncomingConnections` is set to 200 (not 6000) on all nodes
- [ ] Ensure 2GB swapfile is enabled across all nodes to prevent sudden OOM-kills

---

## Quick Reference — Key Commands

```bash
# Service
systemctl start mongod
systemctl stop mongod
systemctl restart mongod
systemctl status mongod

# Logs
tail -f /var/log/mongodb/mongod.log
tail -100 /var/log/mongodb/mongod.log | grep -E 'COLLSCAN|FATAL|ERROR|Slow'

# Crash analysis
dmesg | grep -E 'segfault|oom_kill' | tail -10
uname -r

# Replica set
mongosh --quiet --eval "rs.status().members.forEach(m => print(m.name, m.stateStr))"
mongosh --quiet --eval "db.hello().primary"
mongosh --quiet --eval "rs.printSecondaryReplicationInfo()"
mongosh --quiet --eval "rs.printReplicationInfo()"

# Indexes
mongosh --quiet --eval "db.getSiblingDB('quiztwiz').emailusermodels.getIndexes()"
mongosh --quiet --eval "db.getSiblingDB('dental-arb').housing_services.getIndexes()"

# Block/unblock app traffic safely (preserving peer heartbeats)
iptables -I INPUT 1 -s 127.0.0.1 -p tcp --dport 27017 -j ACCEPT
iptables -I INPUT 2 -s legacy-db-1.unibotsapi.com,legacy-db-2.unibotsapi.com,legacy-db-3.unibotsapi.com -p tcp --dport 27017 -j ACCEPT
iptables -I INPUT 3 -p tcp --dport 27017 -m comment --comment "APP_SHIELD" -j DROP
iptables -D INPUT -p tcp --dport 27017 -m comment --comment "APP_SHIELD" -j DROP
iptables -L INPUT -n --line-numbers | grep 27017
```

---

## Known Issues Log

| Date | Node | Symptom | Root Cause | Fix |
|---|---|---|---|---|
| Jun 10 2026 | legacy-db-1 | SEGV crash loop | Linode kernel incompatible with new CPU plan (`pc-q35-7.2`) | Switched to GRUB distro kernel (`6.1.0-28-amd64`) |
| Jun 10 2026 | legacy-db-1 | OOM / 780K COLLSCAN | Missing index on `quiztwiz.emailusermodels.email` | Shielded apps, created `{ email: 1 }` index |

---

*legacy-rs MongoDB Runbook | Somo Media DevOps | Last updated: June 2026*
