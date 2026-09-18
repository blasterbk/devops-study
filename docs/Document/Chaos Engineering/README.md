# Chaos Engineering & Resilience Testing Master Guide

Welcome to the **Production Chaos Engineering & GameDay Suite**. This repository contains end-to-end chaos scenarios, declarative fault injection manifests (CNCF Chaos Mesh & LitmusChaos), native Linux kernel stress drills, and operational GameDay protocols designed to proactively identify weaknesses before they cause production outages.

---

## 🎯 The 4 Core Principles of Chaos Engineering

1. **Define Steady-State Hypothesis:** Quantify normal system behavior using Business Service Level Indicators (SLIs) — e.g. *HTTP 200 Success Rate $> 99.9\%$, p95 Latency $< 150\text{ms}$*.
2. **Vary Real-World Events:** Inject realistic hardware, network, storage, and software failures that reflect real production incidents (pod crashes, packet loss, disk latency, split-brains).
3. **Run Experiments in Production or Staging:** Test under real traffic patterns with realistic scale and load generation.
4. **Automate Experiments to Run Continuously:** Integrate chaos into CI/CD pipelines to ensure architectural regressions are blocked before deployment.

---

## 🛑 Emergency Abort & Blast Radius Safety Rules

> [!CAUTION]
> Every chaos experiment MUST be governed by automated or manual emergency stop triggers.

### Automated Abort Criteria (Stop immediately if any occur):
- **SLO Breach:** HTTP 5xx error rate exceeds **$0.5\%$** for more than 30 seconds.
- **Latency Violation:** Global p99 latency exceeds **$1000\text{ms}$**.
- **Customer Impact:** Payment gateway / checkout transactions drop by $> 5\%$.
- **Database Threat:** Secondary replica lag exceeds **30 seconds** or primary election fails.

### Emergency Killswitch Commands:
```bash
# 1. Emergency Delete ALL active Chaos Mesh experiments cluster-wide
kubectl delete podchaos,networkchaos,iochaos,stresschaos,timechaos,dnschaos,httpchaos -A --all --timeout=15s

# 2. Host Level (Ubuntu): Kill all stress workers and clear network filters
sudo pkill -9 stress-ng || true
sudo tc qdisc del dev eth0 root 2>/dev/null || true
```

---

## 🐧 Ubuntu Server OS & Host Chaos Scenarios (`ubuntu/`)

| # | Scenario Document | Fault Injected | Target Subsystem | Key Hypothesis & Validation |
|---|---|---|---|---|
| **01** | [`ubuntu/01-Ubuntu-CPU-Exhaustion-and-CFS-Throttling-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/01-Ubuntu-CPU-Exhaustion-and-CFS-Throttling-Chaos.md) | 100% Multi-Core CPU Burn (`stress-ng`) | CFS Scheduler / CPU | SSH remains responsive; high-priority daemons execute without starvation. |
| **02** | [`ubuntu/02-Ubuntu-Memory-Pressure-Swap-and-OOM-Killer-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/02-Ubuntu-Memory-Pressure-Swap-and-OOM-Killer-Chaos.md) | 95% RAM Exhaustion + Swap Thrashing | Virtual Memory (VM) | OOM killer targets non-essential jobs; `oom_score_adj` shields critical daemons. |
| **03** | [`ubuntu/03-Ubuntu-Disk-Space-and-Inode-Exhaustion-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/03-Ubuntu-Disk-Space-and-Inode-Exhaustion-Chaos.md) | 100% Root Disk Full + 0 Free Inodes | Ext4/XFS Filesystem | Reserved root blocks allow root login; log rotators and cleanup scripts run. |
| **04** | [`ubuntu/04-Ubuntu-Disk-IO-Saturation-and-Fsync-Latency-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/04-Ubuntu-Disk-IO-Saturation-and-Fsync-Latency-Chaos.md) | Deep I/O Queue Saturation (`fio` / `dd`) | Block I/O Subsystem | I/O scheduler prevents D-state process hang; databases throttle writes safely. |
| **05** | [`ubuntu/05-Ubuntu-Network-Interface-Loss-and-Packet-Drop-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/05-Ubuntu-Network-Interface-Loss-and-Packet-Drop-Chaos.md) | Interface Flapping & 25% Packet Loss | Linux IP / `tc` NetEm | TCP keepalives detect broken links; routing table failover executes cleanly. |
| **06** | [`ubuntu/06-Ubuntu-Process-PID-Exhaustion-and-Fork-Bomb-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/06-Ubuntu-Process-PID-Exhaustion-and-Fork-Bomb-Chaos.md) | Fork Bomb / Max PID Saturation | Kernel Process Table | Systemd `TasksMax` cgroup limits contain fork bomb; admin shell remains open. |
| **07** | [`ubuntu/07-Ubuntu-File-Descriptor-Exhaustion-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/07-Ubuntu-File-Descriptor-Exhaustion-Chaos.md) | Open File Leaks (`ulimit -n` hit) | VFS / File Handles | Critical daemons use reserved FDs; OS limits reject excess allocations. |
| **08** | [`ubuntu/08-Ubuntu-Systemd-Service-Failure-and-Restart-Loop-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/08-Ubuntu-Systemd-Service-Failure-and-Restart-Loop-Chaos.md) | SIGSEGV / CrashLoop on Critical Daemons | Systemd Supervisor | `Restart=always` recovers service; `StartLimitIntervalSec` prevents storm. |
| **09** | [`ubuntu/09-Ubuntu-NTP-Time-Drift-and-Chrony-Desync-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/09-Ubuntu-NTP-Time-Drift-and-Chrony-Desync-Chaos.md) | Artificial $\pm 120\text{s}$ Clock Skew | Chrony / Timekeeping | TLS handshakes and cron jobs tolerate skew; Chrony slews back smoothly. |
| **10** | [`ubuntu/10-Ubuntu-Kernel-Panic-and-Hard-Hang-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/ubuntu/10-Ubuntu-Kernel-Panic-and-Hard-Hang-Chaos.md) | Kernel Panic (`sysrq-trigger`) | Linux Kernel Core | `kernel.panic = 10` automatically reboots machine; Kdump captures vmcore. |

---

## 🍃 MongoDB Chaos Engineering Suite (`mongodb/`)

| # | Scenario Document | Fault Injected | Target Component | Key Hypothesis & Validation |
|---|---|---|---|---|
| **01** | [`mongodb/01-MongoDB-Primary-Stepdown-and-Election-Storm-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/01-MongoDB-Primary-Stepdown-and-Election-Storm-Chaos.md) | `rs.stepDown()` under 1,000 writes/s | Primary Node | Failover completes in $<8\text{s}$; zero 500 errors returned to end users. |
| **02** | [`mongodb/02-MongoDB-Replication-Lag-and-Stale-Secondary-Reads-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/02-MongoDB-Replication-Lag-and-Stale-Secondary-Reads-Chaos.md) | Network throttling & disk delay on Secondary | Secondary Member | `maxStalenessSeconds` triggers fallback to Primary; prevents stale reads. |
| **03** | [`mongodb/03-MongoDB-Network-Partition-Split-Brain-and-Rollback-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/03-MongoDB-Network-Partition-Split-Brain-and-Rollback-Chaos.md) | Asymmetrical network partition | Replica Set Quorum | Minority steps down; majority maintains writes; rollback directory safely generated. |
| **04** | [`mongodb/04-MongoDB-WiredTiger-Cache-Pressure-and-OOM-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/04-MongoDB-WiredTiger-Cache-Pressure-and-OOM-Chaos.md) | Massive `COLLSCAN` + Host Memory Stress | WiredTiger Engine | Cache eviction thread throttles without crashing; Linux OOM killer avoided. |
| **05** | [`mongodb/05-MongoDB-Connection-Pool-Exhaustion-and-Leak-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/05-MongoDB-Connection-Pool-Exhaustion-and-Leak-Chaos.md) | Synthetic connection storm & leaks | Client Driver Pools | `waitQueueTimeoutMS` sheds load gracefully; prevents mongod socket exhaustion. |
| **06** | [`mongodb/06-MongoDB-Disk-Exhaustion-and-Journal-Safety-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/06-MongoDB-Disk-Exhaustion-and-Journal-Safety-Chaos.md) | 100% Disk Full on `/var/lib/mongodb` | Storage / Journal | WiredTiger clean read-only freeze; zero B-tree corruption upon disk expansion. |
| **07** | [`mongodb/07-MongoDB-Oplog-Window-Overrun-and-Initial-Sync-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/07-MongoDB-Oplog-Window-Overrun-and-Initial-Sync-Chaos.md) | Heavy write storm + Secondary pause | Oplog Buffer | Secondary falls off oplog window; triggers automated file-copy initial sync cleanly. |

---

## ☸️ Kubernetes & Infrastructure Chaos Scenarios

| # | Scenario Document | Fault Injected | Target Layer | Key Hypothesis & Validation |
|---|---|---|---|---|
| **01** | [`01-Pod-Sudden-Death-and-Restart-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/01-Pod-Sudden-Death-and-Restart-Chaos.md) | Sudden SIGKILL, CrashLoops, Pod Churn | Workload / Pod | Zero 502/503 errors during pod death; graceful connection draining. |
| **02** | [`02-Network-Latency-Jitter-and-Packet-Loss-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/02-Network-Latency-Jitter-and-Packet-Loss-Chaos.md) | 200–800ms Latency, 15% Packet Loss | Network / CNI | Circuit Breakers trip cleanly; fallback cache serves stale data; no retry storms. |
| **03** | [`03-Network-Partition-and-Split-Brain-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/03-Network-Partition-and-Split-Brain-Chaos.md) | Bi-directional Cross-AZ Isolation | Network / Multi-AZ | No dual-master split-brain; quorum preserved; automated node isolation. |
| **04** | [`04-Database-Primary-Crash-and-Failover-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/04-Database-Primary-Crash-and-Failover-Chaos.md) | MongoDB / Redis Primary Sudden Kill | Stateful Database | Secondary elected in $<12\text{s}$; connection pools retry with exponential backoff. |
| **05** | [`05-Resource-Exhaustion-CPU-and-Memory-Stress-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/05-Resource-Exhaustion-CPU-and-Memory-Stress-Chaos.md) | 100% CPU burn, Runaway Memory Leaks | Node / Cgroup | HPA scales before CPU throttling; cgroup kills pod before host node evictions. |
| **06** | [`06-DNS-Failure-and-Resolution-Timeout-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/06-DNS-Failure-and-Resolution-Timeout-Chaos.md) | CoreDNS drop, NXDOMAIN injection | DNS / kube-dns | NodeLocal DNSCache absorbs queries; app connection pools reuse existing sockets. |
| **07** | [`07-Node-Failure-Drain-and-Disk-Pressure-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/07-Node-Failure-Drain-and-Disk-Pressure-Chaos.md) | Kernel panic, Disk 100% full | Compute Node | Pods rescheduled in $<5\text{m}$; PDB respected during node evictions. |
| **08** | [`08-Storage-IO-Latency-and-Corruption-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/08-Storage-IO-Latency-and-Corruption-Chaos.md) | 500ms Disk Latency, Read/Write Errors | Storage / CSI | Database engine throttles writes safely without filesystem corruption. |
| **09** | [`09-Clock-Skew-and-Time-Drift-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/09-Clock-Skew-and-Time-Drift-Chaos.md) | $\pm 60\text{s}$ Node Time Drift | OS / Kernel | JWT auth and TLS cert validation handle clock skew; logs maintain monotonic order. |
| **10** | [`10-Security-and-Admission-Webhook-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/10-Security-and-Admission-Webhook-Chaos.md) | Webhook timeout, CA bundle corruption | API Server | `failurePolicy: Ignore` allows emergency deployments; critical webhooks fail securely. |

---

## 👥 GameDay Roles & Responsibilities

| Role | Primary Responsibility |
|---|---|
| **Chaos Commander** | Orchestrates the experiment, enforces timelines, communicates in war room, makes go/no-go abort decisions. |
| **Chaos Operator** | Applies and manages declarative YAML manifests and Linux stress commands. |
| **Safety Officer** | Dedicated monitor watching real-time SLI/SLO dashboards; has sole authority to declare an **IMMEDIATE ABORT**. |
| **Metrics & Log Scribe** | Records start/stop times, metric anomalies, alert firing delays, and logs observations for the post-GameDay report. |
