# Ubuntu Chaos Scenario 10: Kernel Panic & Hard Hang Chaos

**Domain:** Linux Kernel Core, Hardware Watchdogs, Kdump Crash Capture & Automated Reboot  
**Chaos Type:** Forced Kernel Panic, Null Pointer Dereference, SysRq Trigger, Soft Lockup  
**Target:** Ubuntu Linux Kernel (`vmlinuz`) / Host Server (VM, Bare Metal)  
**Tools:** `/proc/sysrq-trigger`, `sysctl kernel.panic`, `kdump-config`, `crash`, `dmesg`

---

## 1. Experiment Overview

When an unrecoverable hardware fault, memory bit-flip, or fatal kernel exception occurs, an unconfigured server will hang indefinitely in a frozen state, requiring manual physical or cloud console intervention. With proper kernel watchdog parameters (`kernel.panic = 10`), the Linux kernel must automatically trigger a hardware reboot within 10 seconds and capture a crash dump (`/var/crash/vmcore`) via Kdump for post-mortem Root Cause Analysis (RCA).

The primary experiment tests **Automated Hardware Reboot on Fatal Kernel Panic (`kernel.panic = 10`)**.

A separate optional experiment tests **Kdump `vmcore` Crash Dump Generation & Crash Kernel Inspection**.

> **Important:** Running with `kernel.panic = 0` (the default on many unhardened Linux distributions) leaves crashed servers permanently frozen in a hung state until an operator manually power-cycles the machine.

### Experiment A — Automated Reboot on Kernel Panic

```text
Fatal kernel exception or SysRq trigger
    ↓
Kernel catches panic event & flushes console logs
    ↓
Waits `kernel.panic = 10` seconds countdown
    ↓
Issues hardware reset command to motherboard / hypervisor
    ↓
Server reboots automatically into multi-user target
    ↓
Systemd services restart cleanly ✅
```

### Experiment B — Kdump Crash Capture

```text
Kernel panic triggers kexec secondary crash kernel
    ↓
Secondary kernel boots into reserved RAM memory window
    ↓
Writes `/var/crash/<timestamp>-vmcore` crash dump to disk
    ↓
Reboots primary OS cleanly
    ↓
SRE inspects crash dump via `crash` utility
```

---

## 2. Steady-State Hypothesis

> **When a sudden fatal Kernel Panic is triggered via SysRq (`echo c > /proc/sysrq-trigger`), the Linux kernel will capture crash logs, dump kernel state to `/var/crash` via Kdump, and automatically reboot the server within 10 seconds via `kernel.panic = 10`, restoring SSH and all operational systemd services upon reboot within 60 seconds.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Auto-Reboot Time | Server initiates reboot within 10 seconds of panic |
| Total Downtime | Server responds to ping & SSH within $< 90\text{s}$ |
| Boot Recovery | Multi-user target reached cleanly without filesystem errors |
| Crash Dump Generation | `vmcore` recorded in `/var/crash/` |
| Service Restoration | All enabled systemd services return to `active` post-boot |
| Filesystem Integrity | No dirty filesystem corruption on root partition |

---

## 3. Failure Mechanism Architecture

```text
               Kernel Panic & Kdump Crash Dump Lifecycle

┌─────────────────────────────────────────────────────────────┐
│                 PRIMARY KERNEL (Normal Execution)           │
│                                                             │
│  T = 0s: Fatal Crash / `echo c > /proc/sysrq-trigger`       │
│  - Null pointer dereference in kernel space                 │
│  - Panic handler invoked (`panic()`)                        │
│                         │                                   │
│                         ▼                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ KDUMP SECONDARY CRASH KERNEL (via kexec)              │  │
│  │ - Boots into reserved crashkernel memory (e.g. 512M)  │  │
│  │ - Does NOT touch corrupted primary kernel memory      │  │
│  │ - Dumps physical RAM state to `/var/crash/vmcore`     │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                   │
│                         ▼                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ KERNEL AUTO-REBOOT COUNTDOWN (`kernel.panic = 10`)    │  │
│  │ - Waits 10 seconds                                    │  │
│  │ - Triggers emergency hardware reset                   │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                   │
│                         ▼                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ SYSTEM REBOOT & POST-BOOT SERVICE RESTORATION         │  │
│  │ - Multi-user target reached                           │  │
│  │ - SSH and daemons active                              │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

> ⚠️ **CAUTION:** This experiment will immediately crash and reboot the machine. Only execute on a dedicated test/staging server!

Before running the experiment:

### Verify current kernel panic settings

```bash
cat /proc/sys/kernel/panic
cat /proc/sys/kernel/panic_on_oops
```
*If `0`, the server will hang forever on panic!*

### Verify Kdump status

```bash
kdump-config status
```
*Expected: `current state: ready to kdump`.*

If Kdump is missing:

```bash
sudo apt update && sudo apt install -y linux-crashdump kexec-tools
```

### Verify Magic SysRq is enabled

```bash
cat /proc/sys/kernel/sysrq
```
*If `0`, enable with `echo 1 | sudo tee /proc/sys/kernel/sysrq`.*

---

# 5. Step 1 — Record Baseline

Record baseline uptime, kernel version, and crash directory state:

```bash
uptime
uname -r
cat /proc/sys/kernel/panic
ls -la /var/crash/
```

---

# 6. Step 2 — Configure Kernel Auto-Reboot in Sysctl

Create `/etc/sysctl.d/99-panic.conf`:

```ini
# Reboot automatically 10 seconds after a kernel panic:
kernel.panic = 10

# Panic on kernel oops (driver crash):
kernel.panic_on_oops = 1

# Panic on hung task / soft lockup (e.g. infinite spinlock):
kernel.softlockup_panic = 1
kernel.hung_task_panic = 1
kernel.hung_task_timeout_secs = 120
```

Apply settings:

```bash
sudo sysctl -p /etc/sysctl.d/99-panic.conf
```

Verify:

```bash
cat /proc/sys/kernel/panic
```
*Expected: `10`.*

---

# 7. Step 3 — Trigger Intentional Kernel Panic

### From an external workstation:

Start a continuous ping monitor:

```bash
ping <UBUNTU_SERVER_IP>
```

### On the Ubuntu test server:

Trigger the instant kernel panic via Magic SysRq:

```bash
echo 1 | sudo tee /proc/sys/kernel/sysrq
echo c | sudo tee /proc/sysrq-trigger
```

---

# 8. Step 4 — Monitor Reboot & Measure Downtime

From the external workstation:

- **T+0s:** Terminal freezes, ping requests start timing out (`Request timeout`).
- **T+10s:** Kernel panic countdown completes, hardware reset initiates.
- **T+30–60s:** Server boots, ping replies resume (`Reply from...`).
- **T+60–90s:** SSH accepts logins.

---

# 9. Step 5 — Verify Crash Dump & Post-Boot State

Log back in via SSH:

### Verify new uptime (proves reboot occurred)

```bash
uptime
```

### Verify crash dump was captured

```bash
ls -la /var/crash/
```
*Expected: Look for `<timestamp>-vmcore` or `dmesg` crash log.*

### Verify systemd services restored cleanly

```bash
systemctl is-system-running
systemctl --failed
```
*Expected: `running` or `degraded` (with 0 failed critical services).*

---

# 10. Abort Conditions

```text
ABORT CONDITIONS

- Server fails to reboot within 5 minutes (requires manual cloud console power cycle)
- Root filesystem fails filesystem check (`fsck`) on boot
- Critical database or daemon fails to start post-boot
- Kdump consumes 100% of disk space in `/var/crash`
```

---

# 11. Emergency Recovery (If Server Does Not Reboot)

If the server hangs because `kernel.panic` was left at `0`:

```bash
# Cloud Console (AWS / Linode / GCP):
# Issue hardware reset / reboot instance from console
```

---

# 12. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Server hangs permanently on panic | `kernel.panic = 0` (Linux default) | Set `kernel.panic = 10` in `/etc/sysctl.d/99-panic.conf` |
| No crash dump saved after reboot | Kdump not configured or insufficient crashkernel RAM | Install `linux-crashdump` and allocate `crashkernel=512M` in GRUB |
| Soft lockups freeze CPU silently | `kernel.softlockup_panic = 0` | Set `kernel.softlockup_panic = 1` and `kernel.hung_task_panic = 1` |
| Filesystem corrupted after crash | Asynchronous mount without journaling | Use Ext4/XFS with journaling enabled (`data=ordered`) |

---

# 13. Production Hardening: GRUB & Sysctl

### 1. Configure Kdump Memory in `/etc/default/grub.d/kdump.cfg`:

```ini
GRUB_CMDLINE_LINUX_DEFAULT="$GRUB_CMDLINE_LINUX_DEFAULT crashkernel=512M"
```

Update GRUB:

```bash
sudo update-grub
```

### 2. Verify Sysctl Configuration in `/etc/sysctl.d/99-panic.conf`:

```ini
kernel.panic = 10
kernel.panic_on_oops = 1
kernel.softlockup_panic = 1
kernel.hung_task_panic = 1
kernel.hung_task_timeout_secs = 120
```

---

# 14. Final Assessment & Key Technical Takeaways

```text
kernel.panic = 0 (Linux Default)
    =
Frozen server indefinitely (requires human power cycle)

kernel.panic = 10
    =
Automatic recovery via hardware reboot in 10 seconds

Kdump (linux-crashdump)
    =
Captures vmcore memory dump for root cause analysis (RCA)

softlockup_panic = 1
    =
Prevents silent CPU lockups from hanging the server forever

Successful Kernel Panic Chaos
    =
Panic triggered cleanly
    +
Auto-reboot countdown executes (< 10s)
    +
vmcore captured in /var/crash
    +
Server returns to service < 90s
```
