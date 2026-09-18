# Ubuntu Chaos Scenario 02: Memory Pressure, Swap Thrashing & OOM Killer Chaos

**Domain:** Linux Virtual Memory, Page Cache, Swap & Kernel OOM Killer  
**Chaos Type:** High RAM Saturation, Memory Pressure, Swap Thrashing, OOM Invocation  
**Target:** Ubuntu Linux Host / VM (Linode, EC2, Bare Metal)  
**Tools:** `stress-ng`, `vmstat`, `free`, `pidstat`, `systemctl`, `dmesg`, `htop`

---

## 1. Experiment Overview

This experiment intentionally exhausts physical RAM and swap space on an Ubuntu host to validate how virtual memory management, page reclaim, swap thrashing, and the Linux kernel Out-Of-Memory (OOM) Killer behave under severe memory pressure.

The primary experiment tests **Memory Pressure and Swap Thrashing**.

A separate optional experiment tests **Kernel OOM Killer Invocation and `oom_score_adj` Shielding**.

> **Important:** Memory pressure, swap thrashing, and kernel OOM kills are distinct operating system states.

### Experiment A — Memory Pressure & Swap Thrashing

```text
stress-ng --vm
    ↓
Physical RAM becomes saturated
    ↓
Kernel reclaims clean page cache
    ↓
Anonymous memory pushed to Swap partition
    ↓
Heavy disk I/O wait (kswapd0 saturation)
    ↓
System experiences Swap Thrashing / Latency spikes
```

### Experiment B — Kernel OOM Killer Invocation

```text
RAM + Swap completely exhausted (or Cgroup MemoryMax reached)
    ↓
Kernel allocation failure (out of memory)
    ↓
OOM Killer computes badness scores
    ↓
Process with highest oom_score terminated with SIGKILL (Exit Code 137)
    ↓
Memory reclaimed; host stability restored
```

---

## 2. Steady-State Hypothesis

> **When memory pressure is injected up to 95% of total RAM for up to 5 minutes, critical administrative access (SSH), monitoring, and protected services (`oom_score_adj < 0`) should remain operational within defined SLOs. If total exhaustion occurs, the kernel OOM killer should terminate the offending rogue process cleanly without freezing the kernel or killing shielded daemons.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| SSH | Remains accessible within defined latency |
| Protected Services | Daemons with negative `oom_score_adj` are NOT killed |
| Application Availability | Core business functions stay within SLO |
| OOM Killer Accuracy | Terminates the rogue memory consumer |
| Memory PSI | Observable pressure without permanent deadlock |
| Swap Recovery | Swapped pages reclaim smoothly post-chaos |
| Host Stability | No kernel panic or hung D-state lockup |
| Recovery | Free memory and system responsiveness return to baseline |

---

## 3. Failure Mechanism Architecture

```text
              Linux Virtual Memory Under Memory Saturation

┌─────────────────────────────────────────────────────────────┐
│                     PHYSICAL RAM (e.g. 16 GB)               │
│                                                             │
│  ┌─────────────────────────┐  ┌──────────────────────────┐  │
│  │     OS & Core Daemons   │  │ Application Workloads    │  │
│  │     (Shielded -1000)    │  │ (Protected -800)         │  │
│  └─────────────────────────┘  └──────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Chaos Workload (stress-ng --vm) consumes remaining 95%│  │
│  └───────────────────────────────────────────────────────┘  │
│                         ↓                                   │
│            Page Cache Reclaim & kswapd0                     │
│                         ↓                                   │
│               SWAP SPACE SATURATION                         │
│                         ↓                                   │
│        LINUX KERNEL OUT-OF-MEMORY KILLER                    │
│                         ↓                                   │
│  Calculates: `badness = (points + oom_score_adj)`           │
│  Target: Process with maximum score terminated (SIGKILL)    │
└─────────────────────────────────────────────────────────────┘
```

### Important Virtual Memory Notes

Linux memory behavior is governed by several core kernel subsystems:

- Anonymous Memory vs File-backed Page Cache
- `vm.swappiness` (controls kernel preference for page cache reclaim vs swap)
- `vm.overcommit_memory` (0 = heuristic, 1 = always overcommit, 2 = strict limit)
- `oom_score` ($0 - 1000$) calculated dynamically by kernel based on RAM usage
- `oom_score_adj` ($-1000$ to $+1000$) configured by user/systemd to adjust kill priority
- Cgroup v2 `memory.high` (throttling) vs `memory.max` (OOM kill)

Do **not** assume that having Swap enabled prevents OOM kills. Heavy swapping often causes I/O thrashing that freezes the entire system before the OOM killer can even execute.

---

# 4. Preconditions

Before running the experiment:

### Verify Memory and Swap capacity

```bash
free -h
swapon --show
```

### Verify stress-ng and sysstat

```bash
stress-ng --version
vmstat -V
```

If missing:

```bash
sudo apt update && sudo apt install -y stress-ng sysstat
```

### Verify Virtual Memory Kernel Parameters

```bash
cat /proc/sys/vm/swappiness
cat /proc/sys/vm/overcommit_memory
```

### Verify Pressure Stall Information (PSI) support

```bash
cat /proc/pressure/memory
```

Expected output format:
```text
some avg10=0.00 avg60=0.00 avg300=0.00 total=0
full avg10=0.00 avg60=0.00 avg300=0.00 total=0
```

---

# 5. Step 1 — Record Baseline

Record the baseline memory state before injecting chaos.

### Memory allocation & free buffers

```bash
free -m
vmstat 1 5
```

### Top memory-consuming processes

```bash
ps -eo pid,ppid,user,oom_score,oom_score_adj,%mem,rss,comm --sort=-rss | head -20
```

### Check OOM score adjustment on critical daemons

```bash
# Check SSH daemon
cat /proc/$(pgrep -f /usr/sbin/sshd | head -n 1)/oom_score_adj

# Check systemd / init (PID 1)
cat /proc/1/oom_score_adj
```

### Check memory pressure baseline

```bash
cat /proc/pressure/memory
```

Record:
- Available memory
- Swap usage
- Page-in / Page-out rates (`bi` / `bo`, `si` / `so` in `vmstat`)
- Baseline Memory PSI
- OOM score adjustments

---

# 6. Step 2 — Progressive Memory Chaos

Progressively scale memory pressure to identify degradation inflection points.

Recommended progression:
```text
50% RAM → 75% RAM → 90% RAM → 98% RAM (OOM Trigger)
```

---

## 6.1 Start at 50% RAM

```bash
sudo stress-ng --vm 1 --vm-bytes 50% --vm-populate --timeout 60s
```

Observe:
```bash
free -m
vmstat 1
cat /proc/pressure/memory
```

---

## 6.2 Increase to 75% RAM

```bash
sudo stress-ng --vm 2 --vm-bytes 75% --vm-populate --timeout 60s
```

Observe page swapping in `vmstat` (`si` and `so` columns).

---

## 6.3 Increase to 90% RAM (High Pressure)

```bash
sudo stress-ng --vm 2 --vm-bytes 90% --vm-populate --timeout 60s
```

Verify SSH responsiveness and application health checks.

---

## 6.4 Full Saturation & OOM Invocation (98%+)

```bash
sudo stress-ng --vm 2 --vm-bytes 98% --vm-populate --timeout 300s &
STRESS_PID=$!
echo "Stress-ng running with PID: $STRESS_PID"
```

---

# 7. Step 3 — Monitor Memory Pressure & Swap Thrashing

During peak chaos:

### Monitor memory swapping rates

```bash
vmstat 1
```
*Look for high values in `si` (swap-in) and `so` (swap-out).*

### Monitor Memory PSI in real time

```bash
watch -n 1 cat /proc/pressure/memory
```

### Check kernel log for OOM events

```bash
sudo dmesg -wT | grep -i -E "oom|killed process|out of memory"
```

### Inspect active process OOM scores

```bash
ps -eo pid,user,oom_score,oom_score_adj,%mem,comm --sort=-oom_score | head -15
```

---

# 8. Step 4 — Test SSH & Administrative Responsiveness

From an external workstation:

```bash
for i in {1..5}; do
    time ssh user@ubuntu-server "free -m"
done
```

Verify that SSH authentication does not hang and executes within administrative SLO limits.

---

# 9. Step 5 — Verify Application Behavior & Database Stability

During memory pressure:
- Check application response latency and 5xx error rate
- Verify database engine (MongoDB/PostgreSQL) buffer pool stability
- Check if container runtimes or Kubernetes kubelets trigger evictions

```bash
curl -w "\nStatus: %{http_code} | Total Time: %{time_total}s\n" \
     -o /dev/null \
     -s \
     https://example.com/api/health
```

---

# 10. Step 6 — Verify Shielded Services Protection

Ensure that critical system daemons with negative `oom_score_adj` are NOT targeted by the OOM killer.

```bash
# Verify SSHD is still running
systemctl status ssh --no-pager

# Verify Database is still running
systemctl status mongod --no-pager 2>/dev/null || true
```

---

# 11. Memory Pressure vs Swap Thrashing vs OOM Killer

| Mechanism | Trigger Condition | System Impact | Observable Metric |
|---|---|---|---|
| **Page Cache Reclaim** | Free RAM drops below low watermark | Kernel frees clean disk buffers | `cached` in `free` drops |
| **Swap Thrashing** | RAM full, anonymous pages written to disk | Disk I/O saturation, high system latency | `si`/`so` high in `vmstat`, `kswapd0` high CPU |
| **Cgroup OOM Kill** | Cgroup exceeds `memory.max` | Only container/service terminated | `dmesg` shows cgroup OOM |
| **Global Host OOM Kill** | RAM + Swap 100% full | Kernel invokes OOM killer to terminate highest badness process | `dmesg: Out of memory: Killed process` |

---

# 12. Abort Conditions

Stop the experiment immediately if any of the following occur:

```text
ABORT CONDITIONS

- SSH session drops or becomes completely unresponsive (> 5s)
- Mission-critical database engine is killed by OOM
- System enters hard D-state disk I/O deadlock
- Memory PSI "full" exceeds 70% sustained for > 30s
- Host stops responding to network ICMP pings
- Filesystem remounts read-only
```

---

# 13. Emergency Stop

Terminate the chaos worker:

```bash
sudo kill "$STRESS_PID"
```

If unresponsive:

```bash
sudo pkill -TERM stress-ng
```

Forceful kill if necessary:

```bash
sudo pkill -KILL stress-ng
```

---

# 14. Recovery Validation

After stopping chaos:

```bash
free -h
vmstat 1 5
cat /proc/pressure/memory
```

Verify:
- Available memory returns toward baseline
- Swap activity ceases (`si` / `so` = 0)
- Memory PSI drops back to 0
- Application latency normalizes
- No orphaned `stress-ng` processes remain:

```bash
pgrep -a stress-ng
```

---

# 15. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| System deadlocks before OOM killer triggers | Swap thrashing on slow spinning disk | Set `vm.swappiness = 1` or `10`, or disable swap on stateful database nodes |
| Critical daemon killed by OOM | Default `oom_score_adj = 0` allowed high score | Configure `OOMScoreAdjust = -1000` (SSH) or `-800` (DB) in systemd |
| Application killed prematurely | Cgroup memory limit set too close to working set | Increase container memory limits and add buffer for page caches |
| High memory pressure without high RSS | Unreclaimed slab/kernel buffers or memory leak | Check `slabtop` and tune `vm.vfs_cache_pressure` |
| Swapped memory never clears after chaos | Normal Linux behavior (pages remain in swap until read) | Run `sudo swapoff -a && sudo swapon -a` if flush is required |

---

# 16. Production Hardening: Systemd Shielding & Kernel Tuning

### 1. Configure Systemd OOM Shielding for SSH:
Create `/etc/systemd/system/ssh.service.d/override.conf`:
```ini
[Service]
OOMScoreAdjust=-1000
```

### 2. Configure Systemd OOM Shielding for Database:
Create `/etc/systemd/system/mongod.service.d/override.conf`:
```ini
[Service]
OOMScoreAdjust=-800
```

Apply changes:
```bash
sudo systemctl daemon-reload
sudo systemctl restart ssh
```

### 3. Configure Production Virtual Memory in `/etc/sysctl.d/99-memory-safety.conf`:
```ini
# Reduce aggressive swapping
vm.swappiness = 10

# Enable memory overcommit heuristic
vm.overcommit_memory = 1

# Do not panic on OOM; invoke OOM killer cleanly
vm.panic_on_oom = 0

# Smooth dirty page writeback to disk
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
```
Apply:
```bash
sudo sysctl -p /etc/sysctl.d/99-memory-safety.conf
```

---

# 17. Experiment Results

| Metric | Baseline | 50% | 75% | 90% | 98% (OOM) | Recovery |
|---|---:|---:|---:|---:|---:|---:|
| Available Memory (MB) | | | | | | |
| Swap Used (MB) | | | | | | |
| Memory PSI (some/full) | | | | | | |
| Swap In / Out (`si`/`so`) | | | | | | |
| SSH Latency (ms) | | | | | | |
| App Error Rate (%) | | | | | | |
| Terminated Process | None | None | None | None | | None |

---

# 18. Final Assessment & Technical Takeaways

```text
Memory saturation
    ≠
Immediate OOM kill

Swap enabled
    ≠
System immunity from crashes

High Swap I/O (Thrashing)
    =
System latency & D-state lockup risk

oom_score_adj = -1000
    =
Kernel OOM immunity for critical daemons

Successful Memory Chaos
    =
Controlled memory climb
    +
Predictable OOM termination of rogue process
    +
Zero collateral damage to shielded services
    +
Clean post-chaos memory recovery
```
