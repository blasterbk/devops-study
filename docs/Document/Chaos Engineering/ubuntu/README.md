# Ubuntu Server Linux Chaos Engineering & OS Resilience Guide

Welcome to the **Ubuntu Server OS & Host-Level Chaos Engineering Suite**. This guide provides practical, production-oriented GameDay experiments designed to test Linux kernel resilience, systemd process supervision, cgroup resource isolation, network subsystem limits, and storage I/O under severe physical or virtual machine failure.

---

## 🎯 Objectives of Linux OS Chaos Testing

1. **Verify Cgroup Resource Containment:** Ensure a rogue process cannot starve the OS, freeze SSH access, or crash neighbor applications.
2. **Test Kernel Panic Recovery & Watchdogs:** Verify that unresponsive or hung kernels automatically reboot within 10 seconds via `sysctl kernel.panic`.
3. **Validate Storage & Inode Resilience:** Confirm that 100% full disks or inode exhaustion do not corrupt root filesystems or prevent administrative recovery.
4. **Audit OOM Killer Prioritization:** Verify that `oom_score_adj` protects mission-critical daemons (`sshd`, `systemd`, `mongod`, `kubelet`) from being terminated during RAM exhaustion.

---

## 🗺️ Master Ubuntu Server Chaos Scenarios

| # | Scenario Document | Fault Injected | Target Subsystem | Key Hypothesis & Validation |
|---|---|---|---|---|
| **01** | [`01-Ubuntu-CPU-Exhaustion-and-CFS-Throttling-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/01-Ubuntu-CPU-Exhaustion-and-CFS-Throttling-Chaos.md) | 100% Multi-Core CPU Burn (`stress-ng`) | CFS Scheduler / CPU | SSH remains responsive; high-priority daemons execute without starvation. |
| **02** | [`02-Ubuntu-Memory-Pressure-Swap-and-OOM-Killer-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/02-Ubuntu-Memory-Pressure-Swap-and-OOM-Killer-Chaos.md) | 95% RAM Exhaustion + Swap Thrashing | Virtual Memory (VM) | OOM killer targets non-essential jobs; `oom_score_adj` shields critical daemons. |
| **03** | [`03-Ubuntu-Disk-Space-and-Inode-Exhaustion-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/03-Ubuntu-Disk-Space-and-Inode-Exhaustion-Chaos.md) | 100% Root Disk Full + 0 Free Inodes | Ext4/XFS Filesystem | Reserved root blocks allow root login; log rotators and cleanup scripts run. |
| **04** | [`04-Ubuntu-Disk-IO-Saturation-and-Fsync-Latency-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/04-Ubuntu-Disk-IO-Saturation-and-Fsync-Latency-Chaos.md) | Deep I/O Queue Saturation (`fio` / `dd`) | Block I/O Subsystem | I/O scheduler prevents D-state process hang; databases throttle writes safely. |
| **05** | [`05-Ubuntu-Network-Interface-Loss-and-Packet-Drop-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/05-Ubuntu-Network-Interface-Loss-and-Packet-Drop-Chaos.md) | Interface Flapping & 25% Packet Loss | Linux IP / `tc` NetEm | TCP keepalives detect broken links; routing table failover executes cleanly. |
| **06** | [`06-Ubuntu-Process-PID-Exhaustion-and-Fork-Bomb-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/06-Ubuntu-Process-PID-Exhaustion-and-Fork-Bomb-Chaos.md) | Fork Bomb / Max PID Saturation | Kernel Process Table | Systemd `TasksMax` cgroup limits contain fork bomb; admin shell remains open. |
| **07** | [`07-Ubuntu-File-Descriptor-Exhaustion-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/07-Ubuntu-File-Descriptor-Exhaustion-Chaos.md) | Open File Leaks (`ulimit -n` hit) | VFS / File Handles | Critical daemons use reserved FDs; OS limits reject excess allocations. |
| **08** | [`08-Ubuntu-Systemd-Service-Failure-and-Restart-Loop-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/08-Ubuntu-Systemd-Service-Failure-and-Restart-Loop-Chaos.md) | SIGSEGV / CrashLoop on Critical Daemons | Systemd Supervisor | `Restart=always` recovers service; `StartLimitIntervalSec` prevents storm. |
| **09** | [`09-Ubuntu-NTP-Time-Drift-and-Chrony-Desync-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/09-Ubuntu-NTP-Time-Drift-and-Chrony-Desync-Chaos.md) | Artificial $\pm 120\text{s}$ Clock Skew | Chrony / Timekeeping | TLS handshakes and cron jobs tolerate skew; Chrony slews back smoothly. |
| **10** | [`10-Ubuntu-Kernel-Panic-and-Hard-Hang-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/10-Ubuntu-Kernel-Panic-and-Hard-Hang-Chaos.md) | Kernel Panic (`sysrq-trigger`) | Linux Kernel Core | `kernel.panic = 10` automatically reboots machine; Kdump captures vmcore. |

---

## 🛠️ Required Tooling on Ubuntu Server

Install standard Linux chaos and observability tools:
```bash
sudo apt-get update && sudo apt-get install -y \
  stress-ng \
  fio \
  iperf3 \
  iproute2 \
  sysstat \
  htop \
  iotop \
  lsof \
  procps \
  chrony
```

---

## 🛑 Emergency Abort Protocol (Host Level)

If an experiment causes SSH unresponsiveness or dangerous server freezing:

```bash
# 1. Kill all running stress-ng chaos processes
sudo pkill -9 stress-ng || true
sudo pkill -9 fio || true

# 2. Reset Linux Traffic Control (tc) filters
sudo tc qdisc del dev eth0 root 2>/dev/null || true

# 3. Emergency Sync and Reboot if OS is unrecoverable (Magic SysRq)
# S = sync disks, U = unmount filesystems, B = reboot
echo s | sudo tee /proc/sysrq-trigger
echo u | sudo tee /proc/sysrq-trigger
echo b | sudo tee /proc/sysrq-trigger
```
