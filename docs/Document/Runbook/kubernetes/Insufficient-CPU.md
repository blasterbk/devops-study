# Kubernetes Insufficient CPU — Runbook

**Service:** Kubernetes Cluster  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on workload impact

## 1. Trigger

Use this runbook when:

- Pod remains `Pending`.
- Pod events show `Insufficient cpu`.
- Scheduler cannot find a node with enough allocatable CPU.
- HPA creates replicas but new Pods cannot be scheduled.
- Cluster CPU capacity is exhausted.

---

## 2. Quick Decision Flow

```text
Insufficient CPU
       ↓
Check Pending Pod
       ↓
Check Scheduler Events
       ↓
Check Node CPU Capacity
       ↓
Check Pod CPU Requests
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
Insufficient cpu
```

---

## 4. Step 2 — Check Node CPU Capacity

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

> **Important:** Kubernetes scheduling is primarily based on requested resources and node allocatable capacity, not simply current CPU usage.

---

## 5. Step 3 — Check Pod CPU Request

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Check:

```text
Requests:
  cpu:
Limits:
  cpu:
```

Or:

```bash
kubectl get pod <pod-name>   -n <namespace> -o yaml
```

Example:

```yaml
resources:
  requests:
    cpu: "1000m"
  limits:
    cpu: "2000m"
```

If the Pod requests `1000m`, the scheduler needs a node with enough allocatable CPU for that request.

---

## 6. Step 4 — Check All CPU Requests

Find high CPU-request workloads:

```bash
kubectl describe node <node-name>
```

Look at:

```text
Allocated resources
```

For more detail:

```bash
kubectl get pods -A -o json | jq -r '
.items[] |
(.metadata.namespace + "/" + .metadata.name) as $pod |
.items[]? |
select(.resources.requests.cpu != null) |
[$pod, .resources.requests.cpu] |
@tsv
'
```

If `jq` is unavailable, use:

```bash
kubectl get pods -A -o yaml
```

and inspect resource requests.

---

## 7. Step 5 — Check Whether the Cluster Has Enough Nodes

```bash
kubectl get nodes -o wide
```

Check:

```bash
kubectl top nodes
```

Look for:

```text
All nodes heavily allocated
NotReady nodes
SchedulingDisabled nodes
Small node pool
```

Check node allocatable CPU:

```bash
kubectl get nodes   -o custom-columns=NAME:.metadata.name,CPU:.status.allocatable.cpu
```

---

## 8. Step 6 — Check Taints and Scheduling Constraints

A node may have enough CPU but still be unavailable because of scheduling rules.

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

Common issue:

```text
Enough CPU
   +
Node does not satisfy Pod constraints
   ↓
Pod remains Pending
```

---

## 9. Step 7 — Check Cluster Autoscaler

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

## 10. Step 8 — Check HPA

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

HPA may successfully request more replicas while the cluster lacks CPU capacity to schedule them.

Use:

```text
HPA-Not-Scaling.md
```

for HPA-specific issues.

---

## 11. Step 9 — Choose the Correct Fix

### Option A — Add Node Capacity

Use the approved cluster/node-pool scaling procedure.

Best when:

```text
Workload genuinely needs more CPU
Cluster is consistently near capacity
```

### Option B — Reduce Incorrect CPU Requests

If a workload requests more CPU than it actually needs:

```yaml
resources:
  requests:
    cpu: "250m"
```

Only change this after reviewing real usage.

### Option C — Improve Scheduling

Review:

```text
nodeSelector
affinity
anti-affinity
taints/tolerations
topology constraints
```

Remove unnecessary restrictions only after confirming the intended architecture.

### Option D — Reduce Workload

Temporarily scale down non-critical workloads when approved:

```bash
kubectl scale deployment <deployment-name>   --replicas=<number>   -n <namespace>
```

### Option E — Adjust HPA

If HPA is creating more replicas than the cluster can support, review:

```text
minReplicas
maxReplicas
CPU target
Scaling behavior
```

Do not simply increase `maxReplicas`.

---

## 12. Step 10 — Verify Scheduling

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

## 13. Step 11 — Verify Node Utilization

```bash
kubectl top nodes
```

Check:

```text
CPU usage
CPU allocation
Node health
```

Make sure the fix did not create sustained node saturation.

---

## 14. Step 12 — Verify Application

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

## 15. Do NOT Do These Things

### ❌ Don't assume high `kubectl top` CPU is the only cause

The scheduler primarily evaluates resource requests against node allocatable capacity.

### ❌ Don't reduce CPU requests blindly

Requests affect scheduling and should represent realistic workload requirements.

### ❌ Don't remove node affinity blindly

Scheduling constraints may be intentional.

### ❌ Don't increase HPA max replicas blindly

More replicas require more cluster capacity.

### ❌ Don't delete Pending Pods as the primary fix

A controller will usually recreate them while the underlying scheduling problem remains.

### ❌ Don't overcommit production nodes without understanding the workload

CPU overcommit can create performance problems even when scheduling succeeds.

---

## 16. Quick Reference

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

# CPU usage
kubectl top nodes
kubectl top pods -A --sort-by=cpu

# Node allocatable CPU
kubectl get nodes   -o custom-columns=NAME:.metadata.name,CPU:.status.allocatable.cpu

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

## 17. Recovery Criteria

- [ ] `Insufficient cpu` confirmed.
- [ ] Pending Pod identified.
- [ ] Scheduler events reviewed.
- [ ] Node allocatable CPU checked.
- [ ] Pod CPU request checked.
- [ ] Cluster CPU allocation checked.
- [ ] Taints and scheduling constraints checked.
- [ ] Cluster Autoscaler checked where applicable.
- [ ] HPA checked where applicable.
- [ ] Root cause fixed.
- [ ] Pod successfully scheduled.
- [ ] Pod becomes `Running`.
- [ ] Pod becomes `Ready`.
- [ ] Node CPU utilization is acceptable.
- [ ] Application health check succeeds.

---

## 18. Escalation

Escalate to **Kubernetes/SRE** when:

- Multiple Pods cannot schedule.
- Cluster CPU capacity is consistently exhausted.
- Scheduling constraints appear incorrect.
- Cluster Autoscaler cannot add nodes.

Escalate to **Application Owner** when:

- CPU requests are significantly oversized.
- Application requires additional CPU capacity.
- HPA configuration causes excessive replica creation.

Escalate to **Infrastructure/Cloud Team** when:

- Node pool cannot scale.
- Cloud provider capacity/quota is limiting node creation.
- Additional node capacity is required.

---

## Golden Rule

```text
Insufficient CPU
       ↓
CHECK PENDING POD EVENTS
       ↓
CHECK NODE ALLOCATABLE CPU
       ↓
CHECK POD CPU REQUEST
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

> **Insufficient CPU = the scheduler cannot find a suitable node for the Pod's CPU request. Check requests and scheduling constraints before simply adding nodes.**
