# Ubuntu Chaos Scenario 03: Disk Space & Inode Exhaustion Chaos

**Domain:** Storage Filesystems, Ext4/XFS Superblocks, Inode Tables & Space Pressure  
**Chaos Type:** 100% Filesystem Space Fill, Inode Table Saturation  
**Target:** Ubuntu Linux Host Filesystems (`/`, `/var/log`, `/tmp`)  
**Tools:** `fallocate`, `df`, `tune2fs`, `lsof`, `find`, `systemctl`

---

## 1. Experiment Overview

This experiment intentionally exhausts filesystem storage blocks and inode metadata tables to evaluate operating system resilience, root administrative access protection, log management, and application failure handling.

The primary experiment tests **Filesystem Block Exhaustion (0 Bytes Free)**.

A separate optional experiment tests **Inode Metadata Table Exhaustion (0 Free Inodes)**.

> **Important:** Disk space exhaustion (full blocks) and inode exhaustion (full metadata slots) are two entirely different failure modes that produce the exact same user error: `No space left on device`.

### Experiment A — Disk Space Exhaustion

```text
fallocate fills partition
    ↓
Available non-root disk blocks reach 0
    ↓
Standard user write calls return ENOSPC
    ↓
Ext4 5% reserved blocks allow root login & recovery
```

### Experiment B — Inode Metadata Exhaustion

```text
Millions of 0-byte or 1-byte files created
    ↓
Inode table slots reach capacity
    ↓
`df -h` shows gigabytes of free disk space
    ↓
`df -i` shows 100% inode saturation
    ↓
All `touch` / `mkdir` / `creat()` calls fail with ENOSPC
```

---

## 2. Steady-State Hypothesis

> **When the primary filesystem is filled to 100% capacity (0 bytes available) or 100% inode capacity for up to 5 minutes, root administrative SSH login must remain operational via Ext4 superuser reserved blocks (5%), system loggers will not trigger kernel panics, and administrative cleanup commands will succeed without requiring hard server power cycles.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Root SSH Access | Root login succeeds via reserved blocks |
| Admin Shell Commands | Core utilities (`rm`, `find`, `lsof`, `df`) execute cleanly |
| Read Operations | Existing file reads remain 100% available |
| Systemd Journal | Drops or rotates logs gracefully without crashing |
| Database Engine | Throttles or rejects writes safely without B-tree corruption |
| Recovery Speed | System resumes normal write operations immediately upon space reclamation |

---

## 3. Failure Mechanism Architecture

```text
              Ext4 Filesystem Under Block & Inode Saturation

┌─────────────────────────────────────────────────────────────┐
│                 FILESYSTEM PARTITION (e.g. 50 GB)           │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ INODE TABLE (Metadata pointers to disk blocks)        │  │
│  │ 1 Inode allocated per file/directory                  │  │
│  │ If Inode table reaches 100% ──► ENOSPC! 💥            │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────┐          │
│  │ STANDARD USER DATA BLOCKS (95% Allocation)    │          │
│  │ Completely filled by chaos workload (0B Free) │          │
│  ├───────────────────────────────────────────────┤          │
│  │ ROOT RESERVED BLOCKS (5% Superuser Reserve)   │ ──► ROOT │
│  │ Preserved exclusively for UID 0 (root admin)! │     AUTH │
│  └───────────────────────────────────────────────┘     PASS │
└─────────────────────────────────────────────────────────────┘
```

### Important Storage & Inode Mechanics

- **Ext4 Reserved Blocks:** By default, Ext4 reserves 5% of filesystem blocks for the `root` user (`tune2fs -m 5`). This prevents non-privileged processes from locking out administrators.
- **Unlinked Open Files (`lsof +L1`):** Deleting a large file with `rm` does NOT free disk space if an active process still holds the file descriptor open.
- **Inode Multipliers:** A directory containing 1,000,000 empty files consumes almost zero disk bytes but completely depletes the inode allocation table.

---

# 4. Preconditions

Before running the experiment:

### Verify filesystem layout and mount points

```bash
df -h
df -i
```

### Check reserved blocks on root partition

```bash
ROOT_DEV=$(df / | awk 'NR==2 {print $1}')
sudo tune2fs -l "$ROOT_DEV" | grep -i "reserved block"
```

### Verify core diagnostic tools

```bash
which fallocate lsof find
```

---

# 5. Step 1 — Record Baseline

Record baseline disk and inode allocations:

```bash
df -h / /var/log /tmp
df -i / /var/log /tmp
```

Check top space-consuming directories:

```bash
sudo du -xh / | sort -rh | head -10
```

Check current unlinked open file count:

```bash
sudo lsof +L1 2>/dev/null | wc -l
```

---

# 6. Step 2 — Progressive Space Exhaustion Chaos

---

## 6.1 Experiment A: Injecting 100% Disk Space Full

Calculate remaining space on test partition and allocate a dummy file leaving exactly 0 MB for standard users:

```bash
FREE_MB=$(df -m /tmp | awk 'NR==2 {print $4}')
echo "Allocating ${FREE_MB}MB on /tmp to simulate 100% disk full..."

sudo fallocate -l "${FREE_MB}M" /tmp/chaos_space_hog.img
```

Verify standard user write failure:

```bash
touch /tmp/user_test_file
```
*Expected output: `touch: cannot touch '/tmp/user_test_file': No space left on device`.*

Verify root superuser write capability:

```bash
sudo touch /root/admin_test_file
```
*Expected: Root succeeds via reserved blocks.*

---

## 6.2 Experiment B: Injecting Inode Exhaustion (Metadata Saturation)

Create a dedicated test directory and generate 200,000 small files to exhaust the inode table:

```bash
mkdir -p /tmp/inode_chaos_test

python3 -c "
import os
for i in range(300000):
    try:
        with open(f'/tmp/inode_chaos_test/f_{i}.tmp', 'w') as f:
            f.write('x')
    except OSError as e:
        print(f'✅ Inode capacity reached at {i} files! Error: {e}')
        break
"
```

Check inode exhaustion status:

```bash
df -i /tmp
```

---

# 7. Step 3 — Monitor Filesystem & Systemd Behavior

During space and inode exhaustion:

### Check systemd journal response

```bash
sudo journalctl -u systemd-journald -n 20
```

### Inspect processes with open unlinked file handles

```bash
sudo lsof +L1
```

### Test SSH authentication latency for root and non-root users

```bash
time ssh root@ubuntu-server "uptime"
```

---

# 8. Step 4 — Abort Conditions

Stop the experiment immediately if:

```text
ABORT CONDITIONS

- Root administrative login fails
- Filesystem corrupts or remounts in Read-Only mode (`ro`)
- Core databases (MongoDB/Postgres) terminate with fatal assertion
- Host panics or becomes unreachable over the network
```

---

# 9. Step 5 — Emergency Cleanup & Space Reclamation

### Reclaim Disk Space:

```bash
sudo rm -f /tmp/chaos_space_hog.img
sudo rm -f /root/admin_test_file
```

### Reclaim Inode Slots (High Speed):

```bash
# Avoid `rm *` which errors on argument list length; use find:
find /tmp/inode_chaos_test -type f -delete
rm -rf /tmp/inode_chaos_test
```

### Free unlinked open file descriptors:

```bash
# Identify and restart processes holding deleted open files:
sudo lsof +L1 | awk 'NR>1 {print $2}' | sort -u | xargs -r sudo kill -HUP
```

---

# 10. Step 6 — Recovery Validation

Verify full recovery:

```bash
df -h / /tmp
df -i / /tmp
```

Verify that standard users can create files:

```bash
touch /tmp/recovery_test && rm /tmp/recovery_test
```

---

# 11. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Root user locked out on disk full | Reserved block percentage set to 0% | Configure `sudo tune2fs -m 5 <partition>` on all root filesystems |
| `df -h` shows 100% full after `rm -rf` | Processes holding deleted file open | Identify with `lsof +L1` and restart culprit process or service |
| Inodes full despite empty disk | Millions of session/cache/temp files | Deploy automated cron/systemd-tmpfiles cleaners |
| `/var/log` fills entire root disk | Missing separate partition for logging | Create dedicated mount for `/var/log` and configure `logrotate` |

---

# 12. Production Hardening: Systemd-Tmpfiles & Ext4 Sizing

### 1. Configure Automatic Temporary File Cleanup in `/etc/tmpfiles.d/cleanup.conf`:
```ini
# Clean /tmp files older than 2 days automatically
d /tmp 1777 root root 2d
d /var/tmp 1777 root root 7d
```

### 2. Verify and Enforce 5% Reserved Blocks on Root:
```bash
sudo tune2fs -m 5 $(df / | awk 'NR==2 {print $1}')
```

---

# 13. Experiment Results

| Metric | Baseline | Space Full (0B) | Inodes Full (0 Inodes) | Recovery |
|---|---:|---:|---:|---:|
| Disk Space Free (%) | | 0% | Normal | |
| Inodes Free (%) | | Normal | 0% | |
| Root SSH Success | Yes | | | Yes |
| User Write Success | Yes | No (ENOSPC) | No (ENOSPC) | Yes |
| Unlinked File Count | | | | |

---

# 14. Final Assessment & Key Technical Takeaways

```text
0 Bytes Free (Blocks)
    ≠
0 Inodes Free (Metadata)

Both trigger:
`ENOSPC: No space left on device`

`rm file`
    ≠
Instant free space (if process holds open FD)

Ext4 tune2fs -m 5
    =
Guaranteed administrative rescue buffer for root

Successful Storage Chaos
    =
Clean write error rejection
    +
Protected root SSH rescue access
    +
Zero filesystem corruption
    +
Instant post-cleanup space recovery
```
