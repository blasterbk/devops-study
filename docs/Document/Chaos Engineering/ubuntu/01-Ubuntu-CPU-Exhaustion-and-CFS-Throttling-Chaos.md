# Ubuntu Chaos Scenario 01: CPU Saturation & CFS Scheduler Chaos

**Domain:** Linux Kernel CPU Scheduling, CFS, cgroups v2, CPU Pressure  
**Chaos Type:** Multi-Core CPU Saturation, Scheduler Contention  
**Target:** Ubuntu Linux Host / VM (Linode, EC2, Bare Metal)  
**Tools:** `stress-ng`, `mpstat`, `vmstat`, `pidstat`, `taskset`, `systemctl`, `htop`

---

## 1. Experiment Overview

This experiment intentionally saturates the CPU of an Ubuntu host to validate how applications, administrative access, monitoring agents, and system services behave under severe CPU contention.

The primary experiment tests **CPU saturation and scheduler contention**.

A separate optional experiment tests **cgroup CPU quota throttling**.

> **Important:** CPU saturation and CPU throttling are related but are not the same mechanism.

### Experiment A — CPU Saturation

```text
stress-ng
    ↓
CPU cores become saturated
    ↓
Scheduler contention
    ↓
Runnable tasks wait for CPU
    ↓
Application / SSH / monitoring performance may degrade
```

### Experiment B — Cgroup CPU Throttling

```text
CPUQuota / cgroup CPU limit
    ↓
Workload reaches allocated CPU quota
    ↓
CFS bandwidth control throttles workload
    ↓
nr_throttled and throttled_usec increase
```

---

## 2. Steady-State Hypothesis

> **When CPU saturation is injected for up to 5 minutes, critical administrative access, monitoring, and application services should remain available within their defined SLOs. CPU-constrained workloads may experience contention, but the host should remain stable and recover automatically after the chaos workload is terminated.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| SSH | Remains accessible |
| Application availability | No critical outage |
| Application latency | Remains within defined SLO |
| Error rate | Remains within defined SLO |
| Monitoring | Metrics continue to arrive |
| CPU PSI | No sustained unacceptable CPU pressure |
| Cgroup throttling | Only expected workloads are throttled |
| Host stability | No kernel/system instability |
| Recovery | Metrics return toward baseline after chaos |

> Do not use a universal `Load Average > 50` threshold. Load average depends heavily on CPU count and also includes tasks in uninterruptible sleep. Define thresholds based on the specific host and service SLOs.

---

## 3. Failure Mechanism Architecture

```text
              Linux CPU Scheduler Under CPU Saturation

┌─────────────────────────────────────────────────────────────┐
│                     CPU CORES                               │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                Runnable Tasks                         │  │
│  │                                                       │  │
│  │  Application workloads                                │  │
│  │  Background workers                                   │  │
│  │  Monitoring agents                                    │  │
│  │  SSH / administrative processes                       │  │
│  │  Chaos workload (stress-ng)                           │  │
│  └───────────────────────────────────────────────────────┘  │
│                         ↓                                   │
│                 Linux Scheduler                             │
│                         ↓                                   │
│              CPU contention / waiting                       │
│                         ↓                                   │
│        Latency / throughput degradation                      │
└─────────────────────────────────────────────────────────────┘
```

### Important Scheduling Notes

Linux scheduling behavior is affected by several mechanisms:

- CFS scheduling
- Process `nice` values
- cgroup CPU weights
- cgroup CPU quotas
- CPU affinity
- Real-time scheduling classes
- Kernel scheduling behavior
- Number of runnable tasks

Do **not** assume that `sshd`, `systemd`, or other critical services automatically receive unlimited CPU priority.

`nice -20` also does not guarantee that a service will remain responsive.

---

# 4. Preconditions

Before running the experiment:

### Verify CPU count

```bash
nproc
lscpu
```

### Verify CPU topology

```bash
lscpu | grep -E 'CPU\(s\)|Core|Socket|Thread'
```

### Verify stress-ng

```bash
stress-ng --version
```

If not installed:

```bash
sudo apt update
sudo apt install -y stress-ng
```

### Verify monitoring tools

```bash
mpstat --version
vmstat --version
pidstat --version
```

On Ubuntu, these are generally provided by `sysstat`:

```bash
sudo apt install -y sysstat
```

### Verify cgroup version

```bash
stat -fc %T /sys/fs/cgroup
```

For cgroups v2, expected output is:

```text
cgroup2fs
```

---

# 5. Step 1 — Record Baseline

Record the system state before injecting chaos.

### CPU and load

```bash
uptime
mpstat 1 5
```

### Per-CPU utilization

```bash
mpstat -P ALL 1 5
```

### Memory and process information

```bash
vmstat 1 5
```

### Top CPU-consuming processes

```bash
ps -eo pid,ppid,ni,pri,cls,pcpu,comm --sort=-pcpu | head -20
```

### CPU pressure

```bash
cat /proc/pressure/cpu
```

### Optional interactive view

```bash
htop
```

Record:

- CPU utilization
- Load average
- CPU PSI
- Top CPU-consuming processes
- Context switching
- Application latency
- SSH latency
- Monitoring status

---

# 6. Step 2 — Progressive CPU Chaos

Do not immediately start with maximum CPU consumption on a production host.

Recommended progression:

```text
25% → 50% → 75% → 100%
```

At each stage, verify the defined SLOs.

---

## 6.1 Start at 25%

```bash
CORES=$(nproc)

sudo stress-ng \
  --cpu "$CORES" \
  --cpu-method matrixprod \
  --cpu-load 25 \
  --timeout 60s
```

Observe:

```bash
uptime
mpstat -P ALL 1
cat /proc/pressure/cpu
```

---

## 6.2 Increase to 50%

```bash
sudo stress-ng \
  --cpu "$CORES" \
  --cpu-method matrixprod \
  --cpu-load 50 \
  --timeout 60s
```

Check application and SSH behavior.

---

## 6.3 Increase to 75%

```bash
sudo stress-ng \
  --cpu "$CORES" \
  --cpu-method matrixprod \
  --cpu-load 75 \
  --timeout 60s
```

Continue observing:

```bash
mpstat -P ALL 1
vmstat 1
cat /proc/pressure/cpu
```

---

## 6.4 Full CPU Saturation

For the final stage:

```bash
sudo stress-ng \
  --cpu "$CORES" \
  --cpu-method matrixprod \
  --cpu-load 100 \
  --timeout 300s &
```

Save the process ID:

```bash
STRESS_PID=$!
echo "$STRESS_PID"
```

This creates a maximum CPU contention scenario for up to 5 minutes.

---

# 7. Step 3 — Monitor CPU Saturation

During the experiment, monitor the following.

### CPU utilization

```bash
mpstat -P ALL 1
```

### Load average

```bash
uptime
```

### CPU pressure

```bash
watch -n 1 cat /proc/pressure/cpu
```

### Context switching

```bash
vmstat 1
```

### Process-level CPU usage

```bash
pidstat -u -w 1
```

### Top processes

```bash
top
```

or:

```bash
htop
```

---

# 8. Step 4 — Test SSH Responsiveness

From an external workstation:

```bash
time ssh user@ubuntu-server "uptime"
```

Run several times during the experiment.

Example:

```bash
for i in {1..10}; do
    time ssh user@ubuntu-server "uptime"
done
```

### Expected Result

SSH should remain accessible within the defined administrative SLO.

Do not use `<200ms` as a universal requirement. Define the threshold based on the normal latency of the environment.

For example:

```text
Baseline SSH latency: 50 ms
Maximum acceptable latency during chaos: 500 ms
```

---

# 9. Step 5 — Verify Application Behavior

During CPU saturation, monitor:

- API response latency
- HTTP 5xx errors
- Request throughput
- Queue depth
- Worker utilization
- Application health checks
- Container CPU usage
- Kubernetes pod CPU throttling, if applicable

Example:

```bash
curl -w "\nTime: %{time_total}s\n" \
     -o /dev/null \
     -s \
     https://example.com/health
```

Repeat this during the experiment.

---

# 10. Step 6 — Verify Monitoring

Monitoring agents should continue reporting metrics.

For example:

```bash
systemctl status node-exporter
```

Check the process:

```bash
ps aux | grep node_exporter
```

If Prometheus is used, verify that the target remains healthy.

The objective is not necessarily zero CPU impact on monitoring. The objective is that monitoring remains sufficiently available to observe the incident.

---

# 11. Step 7 — Verify Cgroup CPU Throttling

## Important

Host CPU saturation does **not automatically mean CPU throttling**.

CPU throttling generally occurs when a cgroup has a CPU quota or limit and reaches that allocation.

First identify the cgroup used by the service.

For a systemd-managed service:

```bash
systemctl show docker -p ControlGroup
```

Example output:

```text
ControlGroup=/system.slice/docker.service
```

Then:

```bash
CGROUP=$(systemctl show docker -p ControlGroup --value)

cat "/sys/fs/cgroup${CGROUP}/cpu.stat"
```

Typical cgroup v2 fields include:

```text
usage_usec
user_usec
system_usec
nr_periods
nr_throttled
throttled_usec
```

### Important Metrics

| Metric | Meaning |
|---|---|
| `usage_usec` | CPU time consumed |
| `nr_periods` | Number of CPU quota periods |
| `nr_throttled` | Number of throttling events |
| `throttled_usec` | Time spent throttled |

If `nr_throttled` and `throttled_usec` increase significantly, the workload is experiencing cgroup CPU throttling.

---

# 12. CPU Saturation vs CPU Throttling

These mechanisms should be treated separately.

### CPU Saturation

```text
CPU cores
   ↓
100% utilization
   ↓
Runnable tasks compete for CPU
   ↓
Scheduler contention
   ↓
Latency / throughput degradation
```

### CPU Quota Throttling

```text
Cgroup
   ↓
CPUQuota / CPU limit
   ↓
Quota reached
   ↓
CFS bandwidth control
   ↓
Tasks throttled
   ↓
nr_throttled increases
```

A system can have CPU saturation without cgroup throttling.

A cgroup can also experience throttling even when the entire host is not at 100% CPU, depending on the configured quota and available CPU capacity.

---

# 13. Abort Conditions

Stop the experiment immediately if any critical condition occurs.

```text
ABORT CONDITIONS

- SSH becomes inaccessible
- Critical application becomes unavailable
- API error rate exceeds the defined threshold
- Application latency exceeds the defined SLO
- Monitoring becomes unavailable
- Health checks fail
- Host becomes unresponsive
- Kernel/system instability is observed
- Critical production workloads stop responding
```

---

# 14. Emergency Stop

If `stress-ng` was started in the background and the PID is available:

```bash
sudo kill "$STRESS_PID"
```

If necessary:

```bash
sudo pkill -TERM stress-ng
```

If the process does not terminate:

```bash
sudo pkill -KILL stress-ng
```

Use `KILL` only when normal termination fails.

---

# 15. Recovery Validation

After terminating the chaos workload:

```bash
uptime
```

```bash
mpstat -P ALL 1 5
```

```bash
cat /proc/pressure/cpu
```

Verify:

- CPU utilization returns toward baseline
- Load average decreases
- CPU PSI returns toward baseline
- Application latency recovers
- Error rates recover
- Monitoring resumes normal behavior
- SSH latency returns toward baseline
- No unexpected processes remain
- No service remains degraded

Check the chaos process:

```bash
pgrep -a stress-ng
```

Expected:

```text
No stress-ng process
```

---

# 16. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| SSH becomes slow | Scheduler contention | Reserve appropriate CPU capacity and review systemd/cgroup resource configuration |
| SSH becomes unavailable | Severe CPU starvation or broader host overload | Protect administrative access through resource isolation and capacity planning |
| Application latency increases | CPU contention | CPU limits/requests, worker tuning, horizontal scaling |
| Application error rate increases | CPU starvation | Capacity planning, autoscaling, workload isolation |
| Monitoring drops metrics | Monitoring agent CPU starvation | Allocate appropriate CPU resources and isolate critical monitoring workloads |
| High context switching | Excess runnable tasks / excessive threads | Tune thread pools and worker concurrency |
| High CPU PSI | Tasks waiting for CPU | Increase capacity, reduce workload, or isolate critical workloads |
| Cgroup `nr_throttled` increases | CPU quota reached | Review `CPUQuota`, CPU limits, and workload sizing |
| Host becomes unresponsive | Excessive CPU contention or secondary resource exhaustion | Reduce blast radius and introduce stronger chaos abort conditions |

---

# 17. Production Hardening

Do not use real-time scheduling as the default solution for SSH responsiveness.

In particular, avoid treating:

```ini
CPUSchedulingPolicy=rr
```

as a normal CPU-protection mechanism.

Real-time scheduling can introduce additional failure modes and should only be used when there is a specific, tested requirement.

Instead, prefer:

- CPU resource isolation
- systemd slices
- cgroup CPU weights
- appropriate CPU quotas
- workload limits
- CPU requests/limits in Kubernetes
- horizontal scaling
- dedicated infrastructure for critical workloads
- capacity planning
- monitoring and alerting

---

# 18. Example Systemd CPU Protection

For an appropriate systemd-managed service, a drop-in can be used:

```ini
[Service]
CPUWeight=1000
```

Create the override:

```bash
sudo systemctl edit <service-name>
```

Then add:

```ini
[Service]
CPUWeight=1000
```

Apply:

```bash
sudo systemctl daemon-reload
sudo systemctl restart <service-name>
```

Verify:

```bash
systemctl show <service-name> -p CPUWeight
```

> `CPUWeight` is a relative CPU allocation mechanism. It does not guarantee that the service will always receive CPU time, particularly when the host is completely saturated or experiencing other resource failures.

---

# 19. Why `Nice=-15` Is Not a Complete Solution

Changing a service to:

```ini
Nice=-15
```

can influence scheduling priority, but it does not provide guaranteed CPU capacity.

Similarly:

```text
nice -20 ≠ guaranteed CPU
```

CPU behavior can also be affected by:

- cgroup hierarchy
- CPUWeight
- CPUQuota
- CPU affinity
- scheduling class
- number of runnable tasks
- host CPU capacity
- virtualization limits

Therefore, resource isolation is generally preferable to relying solely on process priority.

---

# 20. Experiment Results

Record the results after the experiment.

| Metric | Baseline | 25% | 50% | 75% | 100% | Recovery |
|---|---:|---:|---:|---:|---:|---:|
| CPU utilization | | | | | | |
| Load average | | | | | | |
| CPU PSI | | | | | | |
| SSH latency | | | | | | |
| Application latency | | | | | | |
| Error rate | | | | | | |
| Context switches | | | | | | |
| `nr_throttled` | | | | | | |
| `throttled_usec` | | | | | | |
| Monitoring availability | | | | | | |

---

# 21. Final Assessment

The experiment is considered successful if:

1. The host remains stable during CPU saturation.
2. Critical services remain available within their defined SLOs.
3. Monitoring remains sufficiently functional.
4. CPU pressure and contention are observable.
5. Expected cgroup throttling occurs only where configured.
6. No unexpected workload starvation occurs.
7. The host and applications recover after chaos termination.
8. All observed degradation is documented for remediation.

---

## Key Technical Takeaways

```text
CPU saturation
    ≠
CPU throttling

Load average
    ≠
CPU utilization

nice priority
    ≠
Guaranteed CPU

CPUWeight
    ≠
Guaranteed CPU

100% CPU utilization
    ≠
Host failure

Successful chaos experiment
    =
Controlled failure injection
    +
Observable impact
    +
Defined SLO
    +
Abort criteria
    +
Successful recovery
```

This scenario should therefore be classified primarily as:

> **Linux CPU Saturation & Scheduler Contention Chaos**

with:

> **Cgroup CPU Quota/Throttling Chaos**

as a separate, optional experiment.
