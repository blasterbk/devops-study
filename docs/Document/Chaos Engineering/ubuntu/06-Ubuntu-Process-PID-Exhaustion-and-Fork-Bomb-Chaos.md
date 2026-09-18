# Ubuntu Chaos Scenario 06: Process / PID Exhaustion & Fork Bomb Chaos

**Domain:** Kernel Process Table, Thread Limits, Cgroups `pids.max` & Fork Bomb  
**Chaos Type:** Rapid PID Exhaustion, Thread Starvation, Fork Bomb Simulation  
**Target:** Ubuntu Linux Host / Application Slices  
**Tools:** `bash`, `python3`, `systemd-run`, `ps`, `systemctl`

---

## 1. Experiment Overview

This experiment evaluates operating system resilience against uncontrolled thread spawning, recursive fork loops (Fork Bombs), and exhaustion of the global kernel Process ID table (`/proc/sys/kernel/pid_max`).

The primary experiment tests **Cgroup `pids.max` Process Confinement**.

A separate optional experiment tests **Global `pid_max` Saturation and Root Shell Isolation**.

> **Important:** Without cgroup `pids.max` boundaries, a single unprivileged fork bomb will consume all available PIDs on the machine, preventing administrators from running `ps`, `kill`, or opening a new SSH session.

### Experiment A — Cgroup `TasksMax` / `pids.max` Confinement

```text
Fork bomb spawned inside systemd slice (TasksMax=200)
    ↓
Process count reaches 200 ceiling
    ↓
Kernel cgroup controller blocks subsequent `fork()` syscalls
    ↓
`EAGAIN / Resource temporarily unavailable` returned to rogue process
    ↓
Host system and root administrative shells remain 100% operational
```

### Experiment B — Unconstrained PID Table Saturation

```text
Unconstrained fork loop spawns 32,768+ tasks
    ↓
Global kernel `pid_max` exhausted
    ↓
`fork()` fails globally for all users
    ↓
Host freezes; requires hardware reset or SysRq intervention
```

---

## 2. Steady-State Hypothesis

> **When a rapid fork-bomb simulation attempts to spawn 50,000 processes inside a systemd service slice, systemd's `TasksMax` cgroup ceiling will contain the process explosion, preventing global `pid_max` exhaustion and allowing root administrative shells to execute without error.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Admin Terminal Access | Root user can open new shells and execute commands |
| Systemd Slices Isolation | Fork failure is confined strictly to the offending slice |
| Global `pid_max` Margin | Global process table has $> 50\%$ available headroom |
| Post-Chaos Cleanup | All spawned orphan tasks terminate cleanly upon unit stop |

---

## 3. Failure Mechanism Architecture

```text
               Global PID Exhaustion vs Cgroup `TasksMax` Isolation

┌─────────────────────────────────────────────────────────────┐
│                 KERNEL PROCESS TABLE (`pid_max`: 32,768)    │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ SYSTEM SLICES (Root, SSH, Systemd, Daemons)           │  │
│  │ - Consumes ~200 PIDs                                  │  │
│  │ - UNSTALLED & HEALTHY 🛡️                              │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ISOLATED TEST SLICE (`test.slice` - `TasksMax=200`)   │  │
│  │ - Fork bomb attempts 50,000 tasks                     │  │
│  │ - Cgroup ceiling caps execution at 200 tasks          │  │
│  │ - Kernel returns `EAGAIN` to rogue process!           │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

Before running the experiment:

### Check system PID limits

```bash
cat /proc/sys/kernel/pid_max
ps -eLf | wc -l
```

### Verify systemd version and cgroup controller support

```bash
systemctl --version
cat /sys/fs/cgroup/cgroup.controllers 2>/dev/null || true
```
*Expected: `pids` controller listed.*

---

# 5. Step 1 — Record Baseline

Record baseline process and thread count:

```bash
ps -e -o pid,ppid,user,stat,comm | wc -l
systemctl status --no-pager
```

---

# 6. Step 2 — Controlled Cgroup Fork Bomb Chaos

To execute the experiment safely without crashing the server, run the fork bomb inside a sandboxed systemd transient unit with `TasksMax=200`:

```bash
sudo systemd-run --unit=chaos-fork-test --slice=test.slice --property=TasksMax=200 \
  python3 -c "
import os, time
pids = []
try:
    while True:
        pid = os.fork()
        if pid == 0:
            time.sleep(60)
            os._exit(0)
        pids.append(pid)
except (BlockingIOError, OSError) as e:
    print(f'✅ Fork blocked successfully by cgroup at {len(pids)} processes! Error: {e}')
    time.sleep(60)
"
```

---

# 7. Step 3 — Monitor Process Confinement & Host Responsiveness

### Verify process count inside the slice

```bash
systemctl status chaos-fork-test --no-pager
```
*Observe `Tasks: 200 (limit: 200)`.*

### Test command execution on host

```bash
# Verify new process creation succeeds for admin
ls -la /tmp
uptime
```

---

# 8. Step 4 — Abort Conditions

Stop the experiment immediately if:

```text
ABORT CONDITIONS

- Global `fork: Resource temporarily unavailable` occurs in root shell
- SSH session disconnects or refuses new logins
- Kernel logs report out-of-memory or task creation panics
```

---

# 9. Step 5 — Emergency Stop & Cleanup

Terminate the test unit and all spawned child processes:

```bash
sudo systemctl stop chaos-fork-test
```

Verify that all child processes have been reaped:

```bash
ps aux | grep chaos-fork-test
```

---

# 10. Step 6 — Recovery Validation

Verify process table returns to baseline:

```bash
ps -e -o pid,ppid,user,stat,comm | wc -l
```

---

# 11. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Fork bomb crashes entire server | `DefaultTasksMax` missing in systemd configuration | Configure `DefaultTasksMax=4096` in `/etc/systemd/system.conf` |
| Low user limit breaks legitimate apps | `ulimit -u` set too low for multi-threaded databases | Increase `nproc` limits in `/etc/security/limits.conf` |
| Kubernetes node runs out of PIDs | Kubelet PID reservation unconfigured | Set `--pod-max-pids=1024` on Kubelet |

---

# 12. Production Hardening: Systemd `TasksMax` & PAM Limits

### 1. Set Global Default `TasksMax` in `/etc/systemd/system.conf`:
```ini
[Manager]
DefaultTasksMax=4096
```
Apply:
```bash
sudo systemctl daemon-reexec
```

### 2. Set Per-User Process Limits in `/etc/security/limits.d/99-pids.conf`:
```ini
*          soft    nproc     4096
*          hard    nproc     8192
root       soft    nproc     unlimited
```

---

# 13. Experiment Results

| Metric | Baseline | Cgroup Capped (200) | Recovery |
|---|---:|---:|---:|
| Total Process Count | | Baseline + 200 | Baseline |
| Root Command Execution | Normal | Normal (100% Pass) | Normal |
| Fork Block Error (`EAGAIN`) | None | Caught inside slice | None |

---

# 14. Final Assessment & Key Technical Takeaways

```text
Unlimited PIDs per process
    =
System-wide Denial of Service risk

TasksMax = 4096
    =
Enforces hard blast-radius containment on rogue services

Systemd cgroups v2
    =
Guaranteed root administrative access even during local fork storms
```
