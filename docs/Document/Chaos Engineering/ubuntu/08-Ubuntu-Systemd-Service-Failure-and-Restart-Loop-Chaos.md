# Ubuntu Chaos Scenario 08: Systemd Service Failure & CrashLoop Chaos

**Domain:** Process Supervision, Systemd Daemons, Auto-Restart & Crash Loop Rate Limiting  
**Chaos Type:** Abrupt Service Crash (`kill -11 SIGSEGV`), Rapid Restart Storm  
**Target:** Ubuntu Linux Systemd Daemons (`mongod.service`, `nginx.service`, `docker.service`)  
**Tools:** `systemctl`, `journalctl`, `kill`, `ps`

---

## 1. Experiment Overview

This experiment evaluates systemd's service supervision, automatic restart recovery (`Restart=always`), restart backoff delays, and crash loop rate limiting (`StartLimitBurst` / `StartLimitIntervalSec`).

The primary experiment tests **Automatic Daemon Restart on Abrupt Crash (SIGSEGV)**.

A separate optional experiment tests **Crash Loop Rate Limiting to Prevent CPU Exhaustion**.

> **Important:** Without `StartLimitBurst` rate limiting, a broken daemon that crashes immediately upon startup will spin in an infinite tight restart loop, burning 100% CPU and filling system logs.

### Experiment A — Automatic Crash Recovery

```text
Daemon killed with SIGSEGV (kill -11)
    ↓
Systemd detects abnormal process exit
    ↓
Waits `RestartSec=2s`
    ↓
Spawns replacement daemon with new PID
    ↓
Service restored to `active (running)`
```

### Experiment B — Crash Loop Rate Limiting

```text
Daemon crashes 6 times within 60 seconds
    ↓
Systemd counts restarts exceeding `StartLimitBurst=5`
    ↓
Systemd puts service into `failed` state
    ↓
Prevents CPU burn & triggers alert handler
```

---

## 2. Steady-State Hypothesis

> **When a critical background daemon is killed with `SIGSEGV` repeatedly, systemd will automatically restart the process within 2 seconds with `Restart=always`, rate-limit restart loops via `StartLimitBurst: 5`, and keep other system services completely stable.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Auto-Recovery Time | Service returns to `active` in $< 3\text{s}$ |
| Process State Integrity | New PID assigned without orphaned zombies |
| Loop Rate Limiting | Enforces cooldown when `StartLimitBurst` is exceeded |
| Notification Trigger | Failure notification unit executes on terminal failure |

---

## 3. Failure Mechanism Architecture

```text
               Systemd Auto-Restart & Rate Limiting Timeline

┌─────────────────────────────────────────────────────────────┐
│                 SYSTEMD SUPERVISOR (PID 1)                  │
│                                                             │
│  T = 0s: Service Crashes (SIGSEGV)                          │
│  - Evaluates: `Restart=always` + `RestartSec=2s`            │
│  - Increments: `RestartCounter`                             │
│                         ↓                                   │
│  Is `RestartCounter` < `StartLimitBurst` (5 in 60s)?        │
│  ┌─────────────────────────┐   ┌─────────────────────────┐  │
│  │ YES                     │   │ NO                      │  │
│  │ - Restarts within 2s ✅ │   │ - Enters `failed` state │  │
│  │ - Service recovered!    │   │ - Triggers alert 🚨     │  │
│  └─────────────────────────┘   └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

Before running the experiment:

### Verify systemd version

```bash
systemctl --version
```

---

# 5. Step 1 — Create a Test Resilient Systemd Service

Create `/etc/systemd/system/chaos-worker.service`:

```ini
[Unit]
Description=Chaos Resilient Test Worker
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
ExecStart=/bin/sh -c "while true; do echo 'Worker active at $(date)'; sleep 5; done"
Restart=always
RestartSec=2s
KillMode=process

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl start chaos-worker.service
sudo systemctl status chaos-worker.service --no-pager
```

---

# 6. Step 2 — Single Fatal Crash Injection (SIGSEGV)

Kill the service process with a segmentation fault:

```bash
sudo pkill -11 -f "Chaos Resilient Test Worker"
```

Verify automatic restart within 3 seconds:

```bash
sleep 3
sudo systemctl status chaos-worker.service --no-pager
```
*Expected: Service status is `active (running)` with a new PID.*

---

# 7. Step 3 — Rapid Crash Loop Injection (Exceeding Burst)

Kill the service 6 times in rapid succession:

```bash
for i in {1..6}; do
  sudo pkill -9 -f "Chaos Resilient Test Worker" || true
  sleep 1
done
```

Check final state:

```bash
sudo systemctl status chaos-worker.service --no-pager
```
*Expected: Service enters `failed` state: `Job for chaos-worker.service failed because start limit was exceeded`.*

---

# 8. Step 4 — Emergency Stop & Cleanup

```bash
sudo systemctl stop chaos-worker.service
sudo rm -f /etc/systemd/system/chaos-worker.service
sudo systemctl daemon-reload
```

---

# 9. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Daemon dies and never restarts | Default unit setting is `Restart=no` | Set `Restart=always` and `RestartSec=2s` |
| Infinite restart loop burns 100% CPU | `RestartSec=0s` or missing `StartLimitBurst` | Enforce `StartLimitIntervalSec=60` and `StartLimitBurst=5` |
| Daemon fails silently | No failure notification attached | Attach `OnFailure=alert@%n.service` in unit file |

---

# 10. Production Hardening: Systemd Failure Notifications

Add an automated failure handler in `/etc/systemd/system/systemd-notify-failure@.service`:
```ini
[Unit]
Description=Send Alert on Service Failure %i

[Service]
Type=oneshot
ExecStart=/usr/local/bin/send-alert.sh "%i failed on $(hostname)"
```

---

# 11. Experiment Results

| Metric | Baseline | Single Crash | 6x Crash (Burst) | Recovery |
|---|---:|---:|---:|---:|
| Service State | Active | Active (New PID) | Failed (Capped) | Active |
| CPU Utilization | Normal | Normal | Normal (No burn) | Normal |
| Logs Written | Normal | Restart logged | Limit exceeded logged | Normal |

---

# 12. Final Assessment & Key Technical Takeaways

```text
Restart=always
    =
Essential for self-healing Linux daemons

StartLimitBurst = 5 + StartLimitIntervalSec = 60s
    =
Essential safety brake preventing CPU spin on permanent crashes
```
