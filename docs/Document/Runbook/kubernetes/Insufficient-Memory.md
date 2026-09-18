# Kubernetes Insufficient Memory — Runbook

**Service:** Kubernetes Cluster  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on workload impact

## 1. Trigger

Use this runbook when:

- Pod remains `Pending`.
- Pod events show `Insufficient memory`.
- Scheduler cannot find a node with enough allocatable memory.
- HPA creates replicas but new Pods cannot be scheduled.
- Cluster memory capacity is exhausted.

---

## 2. Quick Decision Flow

```text
Insufficient Memory
        ↓
Check Pending Pod
        ↓
Check Scheduler Events
        ↓
Check Node Memory Capacity
        ↓
Check Pod Memory Requests
        ↓
Check Taints / Affinity
        ↓
Check Cluster Autoscaler
        ↓
Choose Fix
        ↓
Verify Pod Scheduling
```

---

## 3. Step 1 — Confirm the Problem

```bash
kubectl get pods -A | grep Pending
```

Check the affected Pod:

```bash
kubectl get pod <pod-name> -n <namespace>
```

Describe it:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look at:

```text
Events:
```

Typical error:

```text
0/X nodes are available:
Insufficient memory
```

---

## 4. Step 2 — Check Node Memory Capacity

```bash
kubectl get nodes
```

Check node details:

```bash
kubectl describe node <node-name>
```

Review:

```text
Capacity:
Allocatable:
Allocated resources:
```

Check actual usage:

```bash
kubectl top nodes
```

> **Important:** Kubernetes scheduling is primarily based on requested resources and node allocatable capacity, not simply current memory usage.

---

## 5. Step 3 — Check Pod Memory Request

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Check:

```text
Requests:
  memory:
Limits:
  memory:
```

Or:

```bash
kubectl get pod <pod-name>   -n <namespace> -o yaml
```

Example:

```yaml
resources:
  requests:
    memory: "1Gi"
  limits:
    memory: "2Gi"
```

If the Pod requests `1Gi`, the scheduler needs a node with enough allocatable memory for that request.

---

## 6. Step 4 — Check Current Memory Usage

```bash
kubectl top nodes
```

Check Pods:

```bash
kubectl top pods -A --sort-by=memory
```

Look for:

```text
High-memory Pods
Nodes near capacity
MemoryPressure
Multiple memory-heavy workloads
```

On a node:

```bash
free -h
```

If required:

```bash
top
```

---

## 7. Step 5 — Check Node Memory Pressure

```bash
kubectl describe node <node-name>
```

Check:

```text
MemoryPressure
```

If:

```text
MemoryPressure=True
```

investigate the node before simply scheduling more workloads.

Check:

```bash
kubectl top node <node-name>
```

If the problem is active node memory pressure, use:

```text
Node-MemoryPressure.md
```

---

## 8. Step 6 — Check All Memory Requests

Check node allocation:

```bash
kubectl describe node <node-name>
```

Review:

```text
Allocated resources
```

Identify memory-heavy workloads:

```bash
kubectl top pods -A --sort-by=memory
```

Compare:

```text
Pod memory requests
        VS
Node allocatable memory
```

A node can have apparently low current memory usage but still reject a Pod if its allocatable requested capacity is insufficient.

---

## 9. Step 7 — Check Taints and Scheduling Constraints

A node may have enough memory but still be unavailable because of scheduling rules.

Check:

```bash
kubectl describe node <node-name>
```

Look for:

```text
Taints
```

Check Pod scheduling configuration:

```bash
kubectl get pod <pod-name>   -n <namespace> -o yaml
```

Review:

```text
nodeSelector
nodeAffinity
podAffinity
podAntiAffinity
tolerations
topologySpreadConstraints
```

Common situation:

```text
Enough memory
    +
Node does not satisfy Pod constraints
    ↓
Pod remains Pending
```

---

## 10. Step 8 — Check Cluster Autoscaler

If Cluster Autoscaler is used:

```bash
kubectl get pods -A | grep -i autoscaler
```

Check its logs:

```bash
kubectl logs <cluster-autoscaler-pod>   -n <namespace>
```

Look for:

```text
Failed to scale up
Max node group size reached
Node group unavailable
No expansion options
```

Check whether the node pool has reached its configured maximum.

> If Autoscaler cannot add capacity, fix the node-pool/autoscaler limitation or scale the cluster using the approved procedure.

---

## 11. Step 9 — Check HPA

If the Pending Pod was created by HPA:

```bash
kubectl get hpa -A
```

Describe:

```bash
kubectl describe hpa <hpa-name> -n <namespace>
```

Check:

```text
Current replicas
Desired replicas
Max replicas
```

HPA may request more replicas while the cluster lacks memory capacity to schedule them.

Use:

```text
HPA-Not-Scaling.md
```

for HPA-specific issues.

---

## 12. Step 10 — Choose the Correct Fix

### Option A — Add Node Capacity

Use the approved cluster/node-pool scaling procedure.

Best when:

```text
Workload genuinely needs more memory
Cluster is consistently near capacity
```

### Option B — Reduce Incorrect Memory Requests

If a workload requests substantially more memory than it needs:

```yaml
resources:
  requests:
    memory: "512Mi"
```

Only change this after reviewing real usage.

### Option C — Fix Memory-Heavy Workloads

Investigate:

```text
Memory leaks
Excessive concurrency
Large caches
Large application heaps
Incorrect worker counts
```

### Option D — Improve Scheduling

Review:

```text
nodeSelector
affinity
anti-affinity
taints/tolerations
topology constraints
```

Remove unnecessary restrictions only after confirming the intended architecture.

### Option E — Reduce Workload

Temporarily scale down non-critical workloads when approved:

```bash
kubectl scale deployment <deployment-name>   --replicas=<number>   -n <namespace>
```

### Option F — Adjust HPA

If HPA creates more replicas than the cluster can support, review:

```text
minReplicas
maxReplicas
Memory target
Scaling behavior
```

Do not simply increase `maxReplicas`.

---

## 13. Step 11 — Verify Scheduling

Watch the Pod:

```bash
kubectl get pod <pod-name>   -n <namespace> -w
```

Expected:

```text
Pending
  ↓
ContainerCreating
  ↓
Running
```

Check:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Confirm the scheduler successfully assigned a node.

---

## 14. Step 12 — Verify Node Memory

```bash
kubectl top nodes
```

Check:

```text
Memory usage
Memory allocation
MemoryPressure
```

Make sure the fix did not create sustained node memory saturation.

---

## 15. Step 13 — Verify Application

```bash
kubectl get pods -n <namespace>
```

Expected:

```text
Running
Ready
```

Check logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Health check:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

---

## 16. Do NOT Do These Things

### ❌ Don't assume high `kubectl top` memory is the only cause

The scheduler primarily evaluates resource requests against node allocatable capacity.

### ❌ Don't reduce memory requests blindly

Requests affect scheduling and should represent realistic workload requirements.

### ❌ Don't remove node affinity blindly

Scheduling constraints may be intentional.

### ❌ Don't increase HPA max replicas blindly

More replicas require more cluster memory.

### ❌ Don't delete Pending Pods as the primary fix

A controller will usually recreate them while the underlying scheduling problem remains.

### ❌ Don't remove memory limits blindly

This can allow a workload to consume excessive node memory.

---

## 17. Quick Reference

```bash
# Pending Pods
kubectl get pods -A | grep Pending

# Pod details / scheduler events
kubectl describe pod <pod-name> -n <namespace>

# Nodes
kubectl get nodes
kubectl get nodes -o wide

# Node resources
kubectl describe node <node-name>

# Memory usage
kubectl top nodes
kubectl top pods -A --sort-by=memory

# Node memory pressure
kubectl describe node <node-name> | grep -A5 MemoryPressure

# HPA
kubectl get hpa -A
kubectl describe hpa <hpa-name> -n <namespace>

# Cluster Autoscaler
kubectl get pods -A | grep -i autoscaler
kubectl logs <cluster-autoscaler-pod> -n <namespace>

# Watch Pod
kubectl get pod <pod-name> -n <namespace> -w
```

---

## 18. Recovery Criteria

- [ ] `Insufficient memory` confirmed.
- [ ] Pending Pod identified.
- [ ] Scheduler events reviewed.
- [ ] Node allocatable memory checked.
- [ ] Pod memory request checked.
- [ ] Cluster memory allocation checked.
- [ ] Node memory pressure checked.
- [ ] Taints and scheduling constraints checked.
- [ ] Cluster Autoscaler checked where applicable.
- [ ] HPA checked where applicable.
- [ ] Root cause fixed.
- [ ] Pod successfully scheduled.
- [ ] Pod becomes `Running`.
- [ ] Pod becomes `Ready`.
- [ ] Node memory utilization is acceptable.
- [ ] No continuing `MemoryPressure`.
- [ ] Application health check succeeds.

---

## 19. Escalation

Escalate to **Kubernetes/SRE** when:

- Multiple Pods cannot schedule.
- Cluster memory capacity is consistently exhausted.
- Scheduling constraints appear incorrect.
- Cluster Autoscaler cannot add nodes.

Escalate to **Application Owner** when:

- Memory requests are significantly oversized.
- Application requires additional memory capacity.
- Application has a memory leak or abnormal memory growth.
- HPA configuration causes excessive replica creation.

Escalate to **Infrastructure/Cloud Team** when:

- Node pool cannot scale.
- Cloud provider quota/capacity limits node creation.
- Additional node capacity is required.

---

## Golden Rule

```text
Insufficient Memory
        ↓
CHECK PENDING POD EVENTS
        ↓
CHECK NODE ALLOCATABLE MEMORY
        ↓
CHECK POD MEMORY REQUEST
        ↓
CHECK MEMORY PRESSURE
        ↓
CHECK TAINTS / AFFINITY
        ↓
CHECK AUTOSCALER
        ↓
ADD CAPACITY OR FIX REQUESTS
        ↓
VERIFY POD SCHEDULED
        ↓
VERIFY APPLICATION
```

> **Insufficient Memory = the scheduler cannot find a suitable node for the Pod's memory request. Check requests, node capacity, and scheduling constraints before simply adding nodes.**
