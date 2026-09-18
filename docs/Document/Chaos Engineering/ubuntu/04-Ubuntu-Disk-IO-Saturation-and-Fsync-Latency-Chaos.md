# Ubuntu Chaos Scenario 04: Disk I/O Saturation & Fsync Latency Chaos

**Domain:** Linux Block Layer, I/O Schedulers, Page Writeback & D-State Process Hangs  
**Chaos Type:** Deep Disk I/O Queue Saturation, Synchronous `fsync()` Latency Injection  
**Target:** Ubuntu Linux Storage Block Devices (`/dev/sda`, `/dev/nvme0n1`)  
**Tools:** `fio`, `iostat`, `iotop`, `sysstat`, `ionice`, `dd`

---

## 1. Experiment Overview

This experiment intentionally floods the Linux block I/O request queues to evaluate how multi-queue I/O schedulers (`mq-deadline`, `bfq`, `none`), storage drivers, and the kernel page writeback mechanism behave under severe disk saturation.

The primary experiment tests **Synchronous Disk I/O Saturation and Latency Spikes**.

A separate optional experiment tests **I/O Priority Scheduling (`ionice`) and D-State Process Confinement**.

> **Important:** High disk utilization (`%util` 100%) is not necessarily a failure; what determines failure is runaway **I/O await time** and processes getting stuck in uninterruptible sleep (`D` state).

### Experiment A — Random Direct I/O Saturation

```text
fio (8-16 parallel workers with direct=1)
    ↓
Block device request queue fills to capacity
    ↓
I/O await latency spikes (> 500ms)
    ↓
Synchronous write/fsync calls block
    ↓
Applications experience high p99 response times
```

### Experiment B — I/O Prioritization with `ionice`

```text
Heavy background I/O (ionice class 3: Idle)
    ↓
High-priority database I/O (ionice class 1: Real-Time / Class 2: Priority 0)
    ↓
Kernel block layer prioritizes database requests
    ↓
Database maintains acceptable transaction latency
```

---

## 2. Steady-State Hypothesis

> **When 100% disk I/O saturation (16 concurrent direct write streams) is injected for up to 3 minutes, processes using multi-queue schedulers (`mq-deadline`) will maintain `fsync()` commit latencies within acceptable bounds ($< 250\text{ms}$), interactive shell commands will not freeze in D-state, and high-priority database services will remain available within defined SLOs.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| SSH Responsiveness | Commands return without unhandled terminal freeze |
| Database Transaction Commit | `fsync()` latency stays within acceptable limits |
| D-State Processes | No permanent process hang in uninterruptible sleep |
| I/O Scheduler Fairness | Background chaos does not completely starve foreground tasks |
| Recovery Speed | Disk await time returns to baseline ($< 5\text{ms}$) immediately post-chaos |

---

## 3. Failure Mechanism Architecture

```text
              Linux Block Layer Under I/O Saturation

┌─────────────────────────────────────────────────────────────┐
│                 APPLICATION PROCESSES                       │
│                                                             │
│  ┌─────────────────────────┐   ┌─────────────────────────┐  │
│  │ Standard Workloads      │   │ High-Priority DB        │  │
│  │ (Async page cache write)│   │ (Sync `fsync()` commit) │  │
│  └────────────┬────────────┘   └────────────┬────────────┘  │
│               │                             │               │
│               ▼                             ▼               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ CHAOS WORKLOAD: fio (16 Direct I/O Random Workers)    │  │
│  └────────────────────────────┬──────────────────────────┘  │
│                               │                             │
│                               ▼                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ LINUX BLOCK REQUEST QUEUE (Queue Depth: 128)          │  │
│  │ - Queue saturated! Await time jumps from 1ms ──► 850ms│  │
│  │ - Scheduler: `mq-deadline` enforces starvation limits │  │
│  └────────────────────────────┬──────────────────────────┘  │
│                               │                             │
│                               ▼                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ HARDWARE STORAGE CONTROLLER (SATA / NVMe / Cloud EBS) │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

Before running the experiment:

### Verify storage devices and active I/O scheduler

```bash
lsblk
cat /sys/block/sda/queue/scheduler 2>/dev/null || cat /sys/block/nvme0n1/queue/scheduler 2>/dev/null
```

### Verify diagnostic tools

```bash
fio --version
iostat -V
```
If missing:
```bash
sudo apt update && sudo apt install -y fio sysstat iotop
```

---

# 5. Step 1 — Record Baseline

Record baseline disk I/O metrics:

```bash
# Monitor disk latency and queue depth for 5 seconds
iostat -xz 1 5
```
Record:
- `r_await` (read latency)
- `w_await` (write latency)
- `aqu-sz` (average queue size)
- `%util` (disk utilization percentage)

Measure baseline synchronous write time:
```bash
time dd if=/dev/zero of=/tmp/baseline_sync.tmp bs=4k count=10 conv=fsync
rm -f /tmp/baseline_sync.tmp
```

---

# 6. Step 2 — Progressive Disk I/O Chaos

---

## 6.1 Moderate I/O Load (4 Workers)

```bash
sudo fio --name=io-moderate \
  --filename=/tmp/fio_chaos.tmp \
  --size=1G \
  --readwrite=randwrite \
  --bs=4k \
  --direct=1 \
  --numjobs=4 \
  --time_based \
  --runtime=60 \
  --group_reporting &
FIO_PID=$!
```

---

## 6.2 Maximum I/O Saturation (16 Workers)

```bash
sudo fio --name=io-maximum \
  --filename=/tmp/fio_chaos.tmp \
  --size=4G \
  --readwrite=randwrite \
  --bs=4k \
  --direct=1 \
  --numjobs=16 \
  --time_based \
  --runtime=180 \
  --group_reporting &
FIO_PID=$!
echo "FIO running with PID: $FIO_PID"
```

---

# 7. Step 3 — Monitor Real-Time I/O Latency & Process States

During maximum I/O chaos:

### Monitor block latency and queue depth

```bash
iostat -xz 1
```

### Check processes stuck in Uninterruptible Sleep (`D` State)

```bash
ps aux | awk '{if ($8 ~ "D") print $0}'
```

### Inspect top I/O consumers in real time

```bash
sudo iotop -o -b -n 3
```

---

# 8. Step 4 — Abort Conditions

Stop the experiment immediately if:

```text
ABORT CONDITIONS

- Primary database engine crashes or experiences connection dropouts
- Host system commands (ls, ps, top) hang indefinitely in D-state
- Storage controller drops off the bus / I/O errors (EIO) appear in dmesg
- Root filesystem remounts read-only
```

---

# 9. Step 5 — Emergency Stop & Cleanup

Terminate the chaos workload:

```bash
sudo kill "$FIO_PID" 2>/dev/null || sudo pkill -9 fio
sudo rm -f /tmp/fio_chaos.tmp
```

---

# 10. Step 6 — Recovery Validation

Verify immediate recovery of disk await latency:

```bash
iostat -xz 1 5
```

Verify that synchronous write latency returns to baseline:

```bash
time dd if=/dev/zero of=/tmp/post_chaos_sync.tmp bs=4k count=10 conv=fsync
rm -f /tmp/post_chaos_sync.tmp
```

---

# 11. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Entire server freezes on heavy writes | Single-queue `none` or `cfq` scheduler active | Switch block scheduler to `mq-deadline` or `bfq` |
| Background jobs starve database | Equal I/O prioritization | Run background jobs with `ionice -c3` (Idle class) |
| Memory stalls on dirty writeback | `vm.dirty_ratio` set too high (e.g. 30%) | Lower `vm.dirty_background_ratio = 5` and `vm.dirty_ratio = 10` |
| Cloud storage I/O credit exhaustion | Burstable cloud disk (AWS GP2/Linode) hit burst limit | Upgrade to provisioned IOPS (GP3/NVMe) with guaranteed throughput |

---

# 12. Production Hardening: I/O Schedulers & `sysctl`

### 1. Set Multi-Queue I/O Scheduler in `/etc/udev/rules.d/60-io-schedulers.rules`:
```udev
# Set mq-deadline for NVMe and SSD drives
ACTION=="add|change", KERNEL=="sd[a-z]|nvme[0-9]*", ATTR{queue/scheduler}="mq-deadline"
```

### 2. Smooth Dirty Page Flushes in `/etc/sysctl.d/99-io-tuning.conf`:
```ini
vm.dirty_background_ratio = 5
vm.dirty_ratio = 10
vm.dirty_expire_centisecs = 3000
```
Apply:
```bash
sudo sysctl -p /etc/sysctl.d/99-io-tuning.conf
```

---

# 13. Experiment Results

| Metric | Baseline | 4 Jobs | 16 Jobs | Recovery |
|---|---:|---:|---:|---:|
| Write Await (`w_await` ms) | | | | |
| Disk %Util | | | 100% | |
| D-State Process Count | 0 | | | 0 |
| `fsync()` Commit Time (ms) | | | | |
| SSH Command Responsiveness | Fast | Fast | | Fast |

---

# 14. Final Assessment & Key Technical Takeaways

```text
100% Disk %Util
    ≠
Failure (means drive is working at capacity)

High w_await (> 500ms) + D-State processes
    =
Actual System Contention / Failure

mq-deadline
    =
Guaranteed read/write expiration to prevent task starvation

ionice class 3
    =
Isolates noisy background cron jobs from production databases
```
