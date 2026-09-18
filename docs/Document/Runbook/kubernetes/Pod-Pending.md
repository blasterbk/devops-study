# Kubernetes Pod `Pending` — Runbook

**Service:** Kubernetes Workload
**Owner:** DevOps / SRE
**Severity:** P2–P3 depending on application impact
**Applies to:** Kubernetes clusters

**Purpose:** Quickly identify and fix Pods that remain in `Pending` because Kubernetes cannot schedule them onto a node.

---

## 1. Trigger

Use this runbook when:

* Pod remains in `Pending`.
* Deployment rollout is stuck.
* New replicas cannot be scheduled.
* Monitoring reports unscheduled Pods.

> **Important:** `Pending` usually means the Pod has not been successfully scheduled to a node.

---

# 2. Quick Decision Flow

```text
Pod Pending
    │
    ▼
Check Pod Events
    │
    ▼
Identify scheduling problem
    │
 ┌──┼──────────┬──────────┬──────────┐
 ▼  ▼          ▼          ▼          ▼
CPU/Memory  Taint      Affinity   PVC
Resources   /Toleration  Rules    /Storage
 │           │           │          │
 └───────────┴───────────┴──────────┘
                 │
                 ▼
             Fix problem
                 │
                 ▼
          Pod gets scheduled
                 │
                 ▼
          Verify Running/Ready
```

---

# 3. Step 1 — Check the Pod

```bash
kubectl get pod <pod-name> -n <namespace> -o wide
```

Check:

```text
STATUS
READY
AGE
NODE
```

Example:

```text
NAME       READY   STATUS    NODE
api-pod    0/1     Pending   <none>
```

If `NODE` shows `<none>`, the Pod has not been scheduled.

---

# 4. Step 2 — Check Pod Events FIRST

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look at:

```text
Events:
```

Also:

```bash
kubectl get events -n <namespace> \
  --sort-by='.lastTimestamp' | tail -30
```

Look for messages such as:

```text
FailedScheduling
Insufficient cpu
Insufficient memory
node(s) had untolerated taint
node(s) didn't match Pod's node affinity
node(s) didn't satisfy existing pods anti-affinity rules
persistentvolumeclaim is not bound
```

---

# 5. Step 3 — Identify the Cause

| Event / Error         | Likely Cause             | Check                  |
| --------------------- | ------------------------ | ---------------------- |
| `Insufficient cpu`    | Not enough CPU           | Node capacity/requests |
| `Insufficient memory` | Not enough memory        | Node capacity/requests |
| `untolerated taint`   | Pod cannot run on node   | Taints/Tolerations     |
| `node affinity`       | Node doesn't match rules | Affinity               |
| `pod anti-affinity`   | Placement conflict       | Anti-affinity          |
| `PVC not bound`       | Storage unavailable      | PVC/PV                 |
| `No nodes available`  | Cluster capacity/problem | Nodes                  |
| `Too many pods`       | Pod limit reached        | Node Pod capacity      |

---

# 6. Step 4 — Check Node Capacity

List nodes:

```bash
kubectl get nodes
```

Check node resources:

```bash
kubectl describe node <node-name>
```

Look at:

```text
Capacity
Allocatable
Requests
Limits
Conditions
```

Check all nodes:

```bash
kubectl describe nodes
```

For a quick overview:

```bash
kubectl top nodes
```

> `kubectl top` requires Metrics Server or another metrics provider.

---

# 7. Step 5 — Check CPU / Memory Requests

Check the Pod:

```bash
kubectl get pod <pod-name> -n <namespace> -o yaml
```

Look for:

```yaml
resources:
  requests:
    cpu:
    memory:
```

The scheduler uses **resource requests**, not current CPU/memory usage, when deciding whether a Pod fits on a node.

If the request is too large for available nodes:

```text
Pod request
     ↓
No node has enough allocatable resources
     ↓
Pod remains Pending
```

Fix by:

* Adding capacity.
* Scaling the cluster.
* Adjusting resource requests if they are incorrectly sized.

Do not reduce requests simply to force scheduling without understanding the workload requirement.

---

# 8. Step 6 — Check Taints and Tolerations

Check node taints:

```bash
kubectl describe node <node-name> | grep -i taint
```

Or:

```bash
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints
```

Check Pod tolerations:

```bash
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.spec.tolerations}'
```

If the node has:

```text
taint
```

and the Pod does not have a matching:

```text
toleration
```

the scheduler will not place the Pod there.

> Do not remove a production node taint just to make a Pod schedule. Confirm why the taint exists first.

---

# 9. Step 7 — Check Node Affinity / Anti-Affinity

Check:

```bash
kubectl get pod <pod-name> -n <namespace> -o yaml
```

Look for:

```text
nodeSelector
nodeAffinity
podAffinity
podAntiAffinity
```

A common problem:

```text
Pod requires:
zone=us-east-1a

Available nodes:
zone=us-east-1b
zone=us-east-1c
```

The Pod cannot be scheduled.

Fix the scheduling rule or provide a matching node, depending on the intended architecture.

---

# 10. Step 8 — Check PVC / Storage

If Events show:

```text
persistentvolumeclaim is not bound
```

check:

```bash
kubectl get pvc -n <namespace>
```

Expected:

```text
STATUS: Bound
```

Then:

```bash
kubectl describe pvc <pvc-name> -n <namespace>
```

Check:

```bash
kubectl get pv
kubectl get storageclass
```

Fix the storage issue before expecting the Pod to schedule.

---

# 11. Step 9 — Check Node Availability

```bash
kubectl get nodes
```

Expected:

```text
STATUS
Ready
```

Check for:

```text
NotReady
SchedulingDisabled
MemoryPressure
DiskPressure
PIDPressure
```

If all suitable nodes are unavailable, investigate the node issue separately.

---

# 12. Step 10 — Check Cluster Capacity

If many Pods are Pending:

```bash
kubectl get pods -A | grep Pending
```

If multiple workloads are affected, check:

```bash
kubectl get nodes
kubectl top nodes
kubectl get pods -A -o wide
```

If the cluster is genuinely out of capacity:

* Add/scale worker nodes.
* Verify Cluster Autoscaler.
* Review resource requests.
* Check whether workloads are unnecessarily over-requesting resources.

---

# 13. Step 11 — Verify Scheduling

After fixing the cause:

```bash
kubectl get pod <pod-name> -n <namespace> -w
```

Expected transition:

```text
Pending
   ↓
ContainerCreating
   ↓
Running
```

Then:

```bash
kubectl get pod <pod-name> -n <namespace>
```

Expected:

```text
READY   STATUS
1/1     Running
```

---

# 14. Verify Application

Check logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Check Deployment:

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

Check Service:

```bash
kubectl get endpointslices -n <namespace>
```

Finally test the application health endpoint:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

---

# 15. Do NOT Do These Things

### ❌ Don't immediately delete the Pod

A Pending Pod usually has a scheduling problem. Deleting it without fixing the cause will normally produce another Pending Pod.

### ❌ Don't remove node taints blindly

First understand why the taint exists.

### ❌ Don't reduce CPU/memory requests blindly

The request may represent a real application requirement.

### ❌ Don't immediately add nodes

First confirm that the cluster actually lacks capacity.

### ❌ Don't modify affinity rules blindly

Affinity may be part of the application's availability architecture.

---

# 16. Quick Reference

```bash
# Check Pod
kubectl get pod <pod> -n <namespace> -o wide

# Describe Pod / scheduler events
kubectl describe pod <pod> -n <namespace>

# Check events
kubectl get events -n <namespace> \
  --sort-by='.lastTimestamp'

# Check nodes
kubectl get nodes

# Check node details
kubectl describe node <node>

# Check node resource usage
kubectl top nodes

# Check node taints
kubectl get nodes \
  -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints

# Check Pod tolerations
kubectl get pod <pod> -n <namespace> \
  -o jsonpath='{.spec.tolerations}'

# Check PVC
kubectl get pvc -n <namespace>

# Check PV
kubectl get pv

# Check StorageClass
kubectl get storageclass

# Check all Pending Pods
kubectl get pods -A | grep Pending

# Watch Pod
kubectl get pod <pod> -n <namespace> -w

# Check Deployment
kubectl rollout status deployment/<deployment> -n <namespace>
```

---

# 17. Recovery Criteria

The incident is resolved when:

* [ ] Pod is scheduled to a node.
* [ ] Pod changes from `Pending`.
* [ ] Pod is `Running`.
* [ ] Pod is `Ready`.
* [ ] No new `FailedScheduling` events.
* [ ] Deployment rollout is complete.
* [ ] Service has healthy endpoints.
* [ ] Application health check succeeds.
* [ ] Application error rate has returned to normal.

---

# 18. Escalation

Escalate to **Kubernetes/SRE** when:

* Multiple Pods are Pending.
* Multiple nodes are unavailable.
* Cluster capacity is exhausted.
* Cluster Autoscaler is not scaling.
* Scheduler appears unhealthy.
* Storage infrastructure is failing.

Escalate to the **Application Owner** when:

* Resource requests are incorrectly configured.
* Affinity/anti-affinity rules are incorrect.
* Tolerations are missing.
* Application-specific scheduling requirements are wrong.

---

## Golden Rule

```text
Pod Pending
     ↓
DON'T GUESS
     ↓
kubectl describe pod
     ↓
CHECK FailedScheduling EVENTS
     ↓
Check CPU / Memory / Taints / Affinity / PVC
     ↓
FIX ROOT CAUSE
     ↓
VERIFY SCHEDULED
     ↓
VERIFY RUNNING + READY
     ↓
VERIFY APPLICATION
```

> **Pending = Kubernetes cannot currently place the Pod on a suitable node. Check `FailedScheduling` events first.**
