# Ubuntu Chaos Scenario 09: NTP Time Drift & Chrony Desync Chaos

**Domain:** OS Timekeeping, NTP Synchronization, Monotonic Clocks & TLS Safety  
**Chaos Type:** Clock Skew Forward/Backward, NTP Network Blackhole  
**Target:** Ubuntu Linux Time Daemon (`chronyd` / `systemd-timesyncd`)  
**Tools:** `chronyc`, `timedatectl`, `date`, `iptables`, `curl`, `hwclock`

---

## 1. Experiment Overview

This experiment evaluates operating system timekeeping, monotonic clock stability (`CLOCK_MONOTONIC`), TLS certificate validity checking, database write-ahead log sequencing, and Chrony clock slewing recovery when time synchronization is degraded, blocked, or abruptly shifted.

The primary experiment tests **NTP Blackholing & Forward/Backward Time Jump**.

A separate optional experiment tests **Chrony Slew Mode Recovery without Backward Clock Corruption**.

> **Important:** Abruptly stepping the system clock backward can corrupt database indexes, scramble write-ahead logs, break distributed consensus leader lease timers, and cause distributed transaction deadlocks. Chrony should always be configured to **slew** the clock smoothly rather than step it backward during runtime.

### Experiment A — Clock Step & TLS Impact

```text
Clock stepped +120s into the future
    ↓
NTP traffic blocked (Port 123 UDP)
    ↓
TLS certificates with narrow validity windows may fail
    ↓
OAuth / JWT token expiry times misaligned
    ↓
Log timestamps desynchronized across cluster
```

### Experiment B — Chrony Smooth Slew Recovery

```text
NTP network unblocked
    ↓
Chrony detects 120s offset
    ↓
Gradually adjusts tick frequency (+/- 500ppm)
    ↓
Clocks converge smoothly to UTC without stepping backward!
```

---

## 2. Steady-State Hypothesis

> **When a $\pm 120\text{s}$ time jump is injected on the host and NTP traffic is blocked for up to 5 minutes, monotonic timers (`CLOCK_MONOTONIC`) will prevent internal loop stalls, applications with JWT validation leeway will accept active sessions, and Chrony will smoothly slew the clock back to UTC without backward timestamp corruption once unblocked.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Monotonic Clocks | Internal event loops and timeouts do NOT freeze |
| Auth Tokens | JWT validators with 60s leeway remain functional |
| Clock Convergence | Chrony tracking offset converges to $< 10\text{ms}$ post-recovery |
| Database Index Safety | No non-monotonic timestamp regressions in storage logs |
| TLS Handshakes | HTTPS connections to external APIs succeed |
| Recovery | Chrony slews clock back to UTC without backward stepping |

---

## 3. Failure Mechanism Architecture

```text
              Linux Clock Subsystems Under Time Chaos

┌─────────────────────────────────────────────────────────────┐
│                 LINUX KERNEL TIMEKEEPING                    │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ CLOCK_REALTIME (Wall Clock / gettimeofday)            │  │
│  │ - Modified by `date -s` or NTP stepped adjustments    │  │
│  │ - Can JUMP forward or BACKWARD ⚠️                     │  │
│  │ - Used by: DB commit timestamps, TLS validity, logs   │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│  ┌───────────────────────────┴───────────────────────────┐  │
│  │ CLOCK_MONOTONIC (Monotonic Clock / clock_gettime)     │  │
│  │ - Represents absolute monotonic uptime ticks          │  │
│  │ - NEVER moves backward, unaffected by NTP jumps 🛡️    │  │
│  │ - Used by: epoll timeouts, mutexes, retry timers      │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ CHRONY TIME DAEMON (`chronyd`)                        │  │
│  │ - Mode 1: Step (Instant jump) ──► Dangerous in prod!  │  │
│  │ - Mode 2: Slew (Smooth frequency adjustment) ──► SAFE │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

Before running the experiment:

### Verify Chrony installation and service status

```bash
chronyc tracking
chronyc sources -v
systemctl status chrony --no-pager
```

If Chrony is missing:

```bash
sudo apt update && sudo apt install -y chrony
```

### Verify current system time and synchronization

```bash
timedatectl status
```
*Expected: `NTP service: active`, `System clock synchronized: yes`.*

---

# 5. Step 1 — Record Baseline

Record baseline time tracking state:

```bash
chronyc tracking
timedatectl timesync-status 2>/dev/null || timedatectl status
date -u
hwclock -r
```

Record:
- Reference ID and stratum
- System time offset (typically $< 1\text{ms}$)
- Last offset and RMS offset
- Frequency and residual frequency

---

# 6. Step 2 — Progressive Time Chaos

---

## 6.1 Stage 1: Block Upstream NTP Traffic (UDP 123)

Isolate the host from NTP servers to prevent automatic resynchronization during the test:

```bash
sudo iptables -A OUTPUT -p udp --dport 123 -j DROP
sudo iptables -A INPUT -p udp --sport 123 -j DROP
```

Verify isolation:

```bash
chronyc sources
```
*Observe that reachability drops.*

---

## 6.2 Stage 2: Disable Automatic NTP & Step Clock Forward (+120s)

```bash
# Disable NTP daemon management temporarily
sudo timedatectl set-ntp false

# Advance system time by 2 minutes
sudo date -s "+2 minutes"
```

Verify shifted time:

```bash
date -u
```

---

## 6.3 Stage 3: Test Dependent Systems Under Forward Skew

### Test external TLS handshakes

```bash
curl -v https://api.github.com 2>&1 | grep "SSL certificate"
```

### Test monotonic timer stability

```bash
python3 -c "
import time
t0 = time.monotonic()
time.sleep(2)
t1 = time.monotonic()
print(f'Monotonic delta: {t1 - t0:.2f}s (Expected: ~2.00s)')
"
```
*Expected: Monotonic timer reports ~2.00s regardless of wall clock jump.*

---

# 7. Step 3 — Monitor Clock Drift & Chrony Slew Recovery

### Unblock NTP network traffic

```bash
sudo iptables -D OUTPUT -p udp --dport 123 -j DROP
sudo iptables -D INPUT -p udp --sport 123 -j DROP
```

### Re-enable Chrony and observe smooth slewing

```bash
sudo timedatectl set-ntp true
sudo systemctl restart chrony
```

### Monitor slewing convergence in real time

```bash
watch -n 1 "chronyc tracking && echo '---' && date -u"
```
*Observe `System time` offset steadily decreasing toward 0.000000 seconds.*

---

# 8. Step 4 — Abort Conditions

Stop the experiment immediately if:

```text
ABORT CONDITIONS

- Database engine crashes with non-monotonic timestamp assertion
- TLS handshakes fail cluster-wide
- Cron jobs fire repeatedly in infinite execution loops
- System clock drifts > 10 minutes without converging
- Host SSH authentication fails due to Kerberos/PAM time skew
```

---

# 9. Emergency Stop & Fast Clock Resynchronization

If immediate recovery is needed:

```bash
# Remove any remaining iptables rules
sudo iptables -D OUTPUT -p udp --dport 123 -j DROP 2>/dev/null || true
sudo iptables -D INPUT -p udp --sport 123 -j DROP 2>/dev/null || true

# Force instant step synchronization:
sudo timedatectl set-ntp true
sudo chronyc makestep
sudo systemctl restart chrony
```

---

# 10. Recovery Validation

Verify full time recovery:

```bash
chronyc tracking
timedatectl status
```
*Expected:*
- `System time` offset $< 0.010$ seconds
- `System clock synchronized: yes`
- `NTP service: active`

---

# 11. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Database crashes on backward step | Hard step backward corrupted commit timestamps | Configure Chrony to use **slew mode** (`makestep 1.0 3`) |
| TLS handshakes fail | System clock drifted past certificate `notAfter` | Maintain redundant NTP servers in `/etc/chrony/chrony.conf` |
| Token validation fails | No clock skew allowance in app JWT decoder | Configure 60s `clockTolerance` in application auth libraries |
| Virtual machine drifts after sleep | Cloud hypervisor paused VM | Configure `chrony` with `rtcsync` and fast boot stepping |

---

# 12. Production Hardening: `/etc/chrony/chrony.conf`

```ini
# Redundant Stratum-1 and Stratum-2 NTP sources
pool 0.ubuntu.pool.ntp.org iburst
pool 1.ubuntu.pool.ntp.org iburst
server time.cloudflare.com iburst
server time.google.com iburst

# Step the clock ONLY on initial boot if offset > 1.0s;
# during normal operation, ALWAYS slew smoothly:
makestep 1.0 3

# Synchronize real-time hardware clock (RTC)
rtcsync

# Max slew rate (parts per million)
maxslewrate 500
```

Apply:

```bash
sudo systemctl restart chrony
```

---

# 13. Experiment Results

| Metric | Baseline | NTP Blocked (+120s) | Slewing Phase | Post-Recovery |
|---|---:|---:|---:|---:|
| System Time Offset | $< 1\text{ms}$ | +120.000s | Slew active | $< 2\text{ms}$ |
| Stratum | 2-3 | Unsynchronized | 2-3 | 2-3 |
| Monotonic Timers | Normal | Normal (unaffected) | Normal | Normal |
| TLS Handshake | Pass | Pass (within cert window) | Pass | Pass |
| Database WAL Integrity | Clean | Clean | Clean | Clean |

---

# 14. Final Assessment & Key Technical Takeaways

```text
CLOCK_REALTIME
    =
Wall clock (subject to jumps, steps, and drift)

CLOCK_MONOTONIC
    =
Guaranteed monotonic uptime ticks (immune to NTP jumps)

Chrony Slew Mode (makestep 1.0 3)
    =
Prevents destructive backward clock jumps in production

Backward Clock Jump
    =
Database corruption & lease invalidation risk

Successful NTP Chaos
    =
Monotonic timers protected
    +
TLS remains functional with leeway
    +
Chrony converges smoothly via slewing
    +
Zero database timestamp regressions
```
