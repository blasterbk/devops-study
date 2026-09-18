# Ubuntu Chaos Scenario 07: File Descriptor Exhaustion Chaos

**Domain:** Linux Virtual Filesystem (VFS), File Handles, `ulimit -n` & Socket Limits  
**Chaos Type:** Rapid File Descriptor Leaking, Socket Handle Exhaustion  
**Target:** Ubuntu Linux Host / Network Microservices  
**Tools:** `python3`, `/proc/sys/fs/file-max`, `lsof`, `systemctl`, `ulimit`

---

## 1. Experiment Overview

In Linux, "everything is a file" — including regular files, network sockets, epoll instances, pipes, and event loops. If an application leaks file descriptors without closing them, it reaches the process limit (`ulimit -n` / `LimitNOFILE`) or the kernel limit (`fs.file-max`), causing `EMFILE: Too many open files`.

The primary experiment tests **Process-Level File Descriptor Exhaustion (`EMFILE`)**.

A separate optional experiment tests **System-Wide Kernel File Table Capacity (`ENFILE`)**.

> **Important:** Process-level file descriptor limits (`EMFILE`) protect the rest of the operating system from a single leaking application. System-wide limits (`ENFILE`) affect all users.

### Experiment A — Process-Level FD Exhaustion (`EMFILE`)

```text
Application opens 10,000 files/sockets without closing
    ↓
Reaches configured `LimitNOFILE` (e.g. 1024)
    ↓
Subsequent `open()` / `socket()` calls return `EMFILE`
    ↓
Process fails in isolation; host remains 100% stable
```

### Experiment B — System-Wide FD Capacity (`ENFILE`)

```text
Total system allocations approach `fs.file-max`
    ↓
Kernel VFS file table saturated
    ↓
System-wide `ENFILE` error
    ↓
Mitigated by raising `fs.file-max` to $> 2,000,000$
```

---

## 2. Steady-State Hypothesis

> **When an application process leaks open file descriptors up to its process limit (`ulimit -n`), the Linux kernel will reject subsequent socket allocations exclusively for the offending process (`EMFILE`), leaving the host system and unrelated services able to open files, establish connections, and accept SSH sessions.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Process Isolation | `EMFILE` is returned only to the leaking process |
| Host Stability | Unrelated daemons (SSH, logging, DB) continue opening files |
| System FD Margin | `/proc/sys/fs/file-nr` indicates $> 75\%$ system capacity remaining |
| Post-Termination Cleanup | Kernel immediately reclaims all file descriptors upon process exit |

---

## 3. Failure Mechanism Architecture

```text
               Process Limit (`LimitNOFILE`) vs System-Wide (`fs.file-max`)

┌─────────────────────────────────────────────────────────────┐
│                 SYSTEM-WIDE CAPACITY: `fs.file-max` = 2M    │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ DAEMON A (Database Engine: `LimitNOFILE=65536`)       │  │
│  │ - Healthy socket allocation                           │  │
│  │ - UNSTALLED & OPERATIONAL 🛡️                          │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ LEAKING CHAOS PROCESS (Capped at `LimitNOFILE=1024`)  │  │
│  │ - Opens 1,024 file descriptors                        │  │
│  │ - Reaches ceiling ──► `EMFILE: Too many open files` ❌ │  │
│  │ - FAILS SAFELY IN ISOLATION!                          │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

Before running the experiment:

### Check system-wide file allocation status

```bash
# Output format: <allocated_fds>  <unused_fds>  <max_fds>
cat /proc/sys/fs/file-nr
cat /proc/sys/fs/file-max
```

### Check process-level limits for current shell

```bash
ulimit -n
```

---

# 5. Step 1 — Record Baseline

Record baseline open file descriptor count:

```bash
sudo lsof | wc -l
```

---

# 6. Step 2 — Controlled File Descriptor Leak Chaos

Run a sandboxed Python script configured with a 1,024 file descriptor ceiling to demonstrate graceful isolation:

```python
import os, resource, time

# Set explicit process soft limit of 500 FDs
resource.setrlimit(resource.RLIMIT_NOFILE, (500, 1024))

fds = []
print("🚀 Opening file descriptors until limit...")
for i in range(1, 2000):
    try:
        fd = os.open("/dev/null", os.O_RDONLY)
        fds.append(fd)
    except OSError as e:
        print(f"✅ Process FD limit reached at {i-1} open descriptors! (Error: {e})")
        break

print(f"Holding {len(fds)} file descriptors open for 60 seconds...")
time.sleep(60)

for fd in fds: os.close(fd)
print("✅ Descriptors closed.")
```

---

# 7. Step 3 — Monitor Open Files During Chaos

### Check top processes consuming file descriptors

```bash
sudo lsof | awk '{print $1, $2}' | sort | uniq -c | sort -nr | head -10
```

### Verify SSH access remains unaffected

```bash
ssh user@ubuntu-server "uptime"
```

---

# 8. Step 4 — Abort Conditions

Stop the experiment immediately if:

```text
ABORT CONDITIONS

- System-wide `ENFILE: Too many open files in system` occurs
- SSH fails to open new pseudo-terminal sockets (`pty`)
- Monitoring agents stop reporting due to socket errors
```

---

# 9. Step 5 — Emergency Stop & Cleanup

Kill the chaos script process:

```bash
pkill -f "Opening file descriptors"
```

---

# 10. Step 6 — Recovery Validation

Verify file descriptors return to baseline:

```bash
cat /proc/sys/fs/file-nr
sudo lsof | wc -l
```

---

# 11. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Database errors on high traffic | Default systemd `LimitNOFILE` was 1024 | Set `LimitNOFILE=65536` in database systemd service |
| System-wide `ENFILE` error | Kernel `fs.file-max` limit too low | Increase `fs.file-max = 2097152` in `/etc/sysctl.conf` |
| Application sockets leak indefinitely | Missing `try/finally` or unclosed connections | Audit connection pooling and enforce socket timeouts |

---

# 12. Production Hardening: Systemd & Kernel Tuning

### 1. Configure System-Wide File Limit in `/etc/sysctl.d/99-file-max.conf`:
```ini
fs.file-max = 2097152
```
Apply:
```bash
sudo sysctl -p /etc/sysctl.d/99-file-max.conf
```

### 2. Set Default Systemd Service Limits in `/etc/systemd/system.conf`:
```ini
[Manager]
DefaultLimitNOFILE=65536
```
Apply:
```bash
sudo systemctl daemon-reexec
```

---

# 13. Experiment Results

| Metric | Baseline | Chaos (500 FDs) | Recovery |
|---|---:|---:|---:|
| Leaking Process Status | Active | Caught `EMFILE` at 500 | Terminated Cleanly |
| System Open Files | | Baseline + 500 | Baseline |
| Root SSH Success | Yes | Yes (100% Pass) | Yes |

---

# 14. Final Assessment & Key Technical Takeaways

```text
EMFILE
    =
Process-level limit reached (`ulimit -n`) -> Safe isolation

ENFILE
    =
System-wide limit reached (`fs.file-max`) -> Global risk

DefaultLimitNOFILE = 65536
    =
Mandatory baseline for all production Linux servers
```
