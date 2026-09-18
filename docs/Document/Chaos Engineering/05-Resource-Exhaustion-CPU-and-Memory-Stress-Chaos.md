# Kubernetes Chaos Scenario 05: Resource Exhaustion (CPU & Memory Stress) Chaos

**Domain:** Node Compute, Cgroups v2, CFS Throttling, OOMKill Isolation & HPA Autoscaling  
**Chaos Type:** `StressChaos` (CPU Core Saturation, Memory Leak / OOMKill Trigger)  
**Target:** Application Pods, Cgroup Memory Limits, Horizontal Pod Autoscaler  
**Tools:** Chaos Mesh `StressChaos`, `stress-ng`, `kubectl`, HPA, VPA

---

## 1. Experiment Overview

Resource exhaustion is one of the most common causes of cascading failure in Kubernetes. A single unconstrained microservice with a memory leak or CPU-intensive infinite loop can starve co-located pods on the same node, trigger node-level `MemoryPressure` taints, or cause unpredictable kernel OOMKills that terminate unrelated healthy pods.

The primary experiment tests **Cgroup Memory Limit Enforcement & OOMKill Blast Radius Isolation**.

A separate optional experiment tests **CPU CFS Throttling & HPA Autoscaling Response**.

> **Important:** Without explicit `resources.limits.memory` on every container, a single leaking pod can consume all node RAM and trigger node-level eviction of ALL pods on that node — not just the leaking one.

### Experiment A — Memory Leak & Cgroup OOMKill Isolation

```text
Pod with resources.limits.memory: 512Mi starts leaking memory
    ↓
Container RSS reaches 512Mi cgroup ceiling
    ↓
Linux cgroup OOM killer terminates ONLY that container (SIGKILL)
    ↓
Container exits with Exit Code 137 (OOMKilled)
    ↓
Kubelet restarts container (restartPolicy: Always)
    ↓
Node remains healthy — zero impact on co-located pods!
```

### Experiment B — CPU Saturation & HPA Scale-Up

```text
Pod consumes 100% CPU across all allocated cores
    ↓
CFS bandwidth controller throttles pod (nr_throttled increases)
    ↓
HPA detects CPU utilization > 70% target
    ↓
HPA scales replicas from 3 → 6
    ↓
New pods scheduled and receive traffic
    ↓
Per-pod CPU utilization drops below threshold
```

---

## 2. Steady-State Hypothesis

> **When a microservice pod experiences a runaway memory leak reaching 100% of its cgroup memory limit (512Mi), the Linux cgroup OOM killer will terminate only the offending container (`Exit Code 137`), the host node will maintain `MemoryPressure: False`, co-located neighbor pods will suffer zero performance degradation or restarts, and the HPA will respond to CPU stress by adding replicas within 2 minutes.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| OOMKill Containment | OOMKill restricted to the offending container only |
| Node Stability | Node conditions remain `Ready`, `MemoryPressure: False` |
| Neighbor Pod Impact | Co-located pods experience 0 restarts and $< 5\%$ latency increase |
| HPA Scaling Response | Replicas increase within 2 minutes of CPU threshold breach |
| Container Recovery | OOMKilled container restarts successfully via `restartPolicy: Always` |
| Node Eviction | No node-level pod eviction triggered |

---

## 3. Failure Mechanism Architecture

```text
               Cgroup Memory Enforcement & OOMKill Isolation

┌─────────────────────────────────────────────────────────────┐
│                 WORKER NODE (8 GB RAM)                      │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ KUBELET EVICTION THRESHOLDS                           │  │
│  │ - memory.available < 100Mi → Eviction!                │  │
│  │ - nodefs.available < 10% → Eviction!                  │  │
│  │ - Status: MemoryPressure: False ✅                    │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────┐  ┌───────────────────────┐  │
│  │ POD A (Chaos Target)      │  │ POD B (Healthy)       │  │
│  │ limits.memory: 512Mi      │  │ limits.memory: 1Gi    │  │
│  │                           │  │                       │  │
│  │ Memory leak fills cgroup  │  │ Normal operation      │  │
│  │ RSS → 512Mi ceiling       │  │ RSS: 300Mi            │  │
│  │ → Cgroup OOMKill! ❌      │  │ → ZERO IMPACT ✅      │  │
│  │ → Exit Code 137           │  │                       │  │
│  │ → Kubelet restarts        │  │                       │  │
│  └───────────────────────────┘  └───────────────────────┘  │
│                                                             │
│  Node Available Memory: 6.2 GB → HEALTHY                   │
└─────────────────────────────────────────────────────────────┘
```

### Important Resource Isolation Mechanics

- **Cgroup v2 Memory Controller:** Each pod's containers have isolated memory limits. OOMKills are scoped to the cgroup, not the node.
- **QoS Classes:** Pods are classified as `Guaranteed` (requests=limits), `Burstable` (requests < limits), or `BestEffort` (no requests/limits). BestEffort pods are evicted FIRST.
- **CPU CFS Throttling:** When a container exceeds its CPU limit, the kernel throttles it (pauses execution until next period). This does NOT kill the container.
- **HPA Controller:** Checks metrics every 15 seconds (default). Scale-up delay is ~1 minute, scale-down delay is ~5 minutes (stabilization window).

---

# 4. Preconditions

### Verify target pod resource limits

```bash
kubectl describe pod analytics-worker-0 -n production | grep -A 5 "Limits:"
```

### Verify HPA configuration

```bash
kubectl get hpa -n production
kubectl describe hpa analytics-worker-hpa -n production
```

### Verify node conditions

```bash
kubectl describe node <node-name> | grep -A 10 "Conditions:"
```

---

# 5. Step 1 — Record Baseline

### Pod resource usage

```bash
kubectl top pods -n production
```

### Node resource usage

```bash
kubectl top nodes
```

### HPA current state

```bash
kubectl get hpa -n production
```

### Node conditions

```bash
kubectl get nodes -o json | jq '.items[].status.conditions[] | select(.type=="MemoryPressure")'
```

---

# 6. Step 2 — Inject Memory Stress (OOMKill Trigger)

### Chaos Mesh `StressChaos` Manifest — Memory

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: StressChaos
metadata:
  name: pod-memory-exhaustion
  namespace: chaos-testing
spec:
  mode: one
  selector:
    namespaces:
      - production
    labelSelectors:
      app: analytics-worker
  stressors:
    memory:
      workers: 1
      size: "600MB"       # Exceeds 512Mi limit → triggers OOMKill
  duration: "5m"
```

Apply:

```bash
kubectl apply -f memory-stress.yaml
```

---

# 7. Step 3 — Inject CPU Stress (HPA Trigger)

### Chaos Mesh `StressChaos` Manifest — CPU

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: StressChaos
metadata:
  name: pod-cpu-saturation
  namespace: chaos-testing
spec:
  mode: all
  selector:
    namespaces:
      - production
    labelSelectors:
      app: analytics-worker
  stressors:
    cpu:
      workers: 4
      load: 100              # 100% CPU burn across all cores
  duration: "5m"
```

---

# 8. Step 4 — Monitor OOMKill & HPA Response

### Watch for OOMKill events

```bash
kubectl get events -n production --sort-by='.lastTimestamp' | grep -i oom
```

### Check pod restart count

```bash
kubectl get pods -n production -o wide
```
*Look for `RESTARTS` column incrementing.*

### Check container exit reason

```bash
kubectl describe pod analytics-worker-0 -n production | grep -A 5 "Last State:"
```
*Expected: `Reason: OOMKilled`, `Exit Code: 137`.*

### Watch HPA scaling

```bash
kubectl get hpa -n production -w
```

### Verify neighbor pod health

```bash
kubectl top pods -n production
kubectl get pods -n production | grep -v analytics-worker
```

### Check node conditions

```bash
kubectl describe node <node-name> | grep MemoryPressure
```
*Expected: `MemoryPressure: False`.*

---

# 9. Abort Conditions

```text
ABORT CONDITIONS

- Node enters MemoryPressure or DiskPressure condition
- Neighbor (non-target) pods are OOMKilled or evicted
- HPA scales to maximum and CPU still > 90%
- Node becomes NotReady
- Multiple pods enter CrashLoopBackOff simultaneously
```

---

# 10. Emergency Stop

```bash
kubectl delete stresschaos pod-memory-exhaustion -n chaos-testing
kubectl delete stresschaos pod-cpu-saturation -n chaos-testing
```

---

# 11. Recovery Validation

### Verify pod restarts and current state

```bash
kubectl get pods -n production
```

### Verify HPA scales back down

```bash
kubectl get hpa -n production
```
*Expected: After 5-minute stabilization, replicas decrease toward target.*

### Verify node conditions remain healthy

```bash
kubectl get nodes
```

---

# 12. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Neighbor pods evicted | Target pod has no memory limit (BestEffort) | Set `resources.limits.memory` on ALL containers |
| Node enters MemoryPressure | Multiple burstable pods exceed node capacity | Use `Guaranteed` QoS (requests=limits) for critical pods |
| OOMKill loops without HPA scaling | HPA only monitors CPU, not memory | Add memory-based HPA metrics or use VPA |
| HPA scales too slowly | Default `--horizontal-pod-autoscaler-sync-period` is 15s | Consider custom metrics and KEDA for faster scaling |
| CPU throttled but not OOMKilled | CPU limits cause CFS throttling, not termination | Distinguish CPU throttling (performance) from memory OOMKill (crash) |

---

# 13. Production Hardening

### Resource Limits Standard

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
  limits:
    cpu: "1000m"
    memory: "512Mi"
```

### HPA with CPU Target

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: analytics-worker-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: analytics-worker
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
      - type: Percent
        value: 100
        periodSeconds: 60
```

---

# 14. Experiment Results

| Metric | Baseline | Memory Stress | CPU Stress | Recovery |
|---|---:|---:|---:|---:|
| Target Pod Status | Running | OOMKilled (137) → Restarted | Throttled | Running |
| Node MemoryPressure | False | False | False | False |
| Neighbor Pod Restarts | 0 | 0 | 0 | 0 |
| HPA Replicas | 3 | 3 | 6 (scaled up) | 3 (scaled down) |
| CPU Utilization | 25% | 25% | 100% (throttled) | 25% |

---

# 15. Final Assessment & Key Technical Takeaways

```text
Cgroup OOMKill
    =
Container-scoped termination (NOT node-wide)

resources.limits.memory: 512Mi
    =
Guaranteed blast radius containment

No limits (BestEffort QoS)
    =
Node-wide eviction risk on ANY memory pressure

CPU Limit Exceeded
    =
CFS Throttling (process paused, NOT killed)

Memory Limit Exceeded
    =
OOMKill (process terminated with SIGKILL / Exit 137)

Successful Resource Chaos
    =
OOMKill confined to target container
    +
Zero neighbor pod impact
    +
HPA auto-scales on CPU pressure
    +
Node remains healthy throughout
```
