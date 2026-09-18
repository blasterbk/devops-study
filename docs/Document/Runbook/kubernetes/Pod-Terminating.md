# Kubernetes Pod Stuck in `Terminating` — Runbook

**Service:** Kubernetes Workload
**Owner:** DevOps / SRE
**Severity:** P2–P3 depending on application impact
**Applies to:** Kubernetes clusters

**Purpose:** Quickly identify and safely remove Pods that remain in `Terminating` longer than expected.

---

## 1. Trigger

Use this runbook when:

* Pod remains in `Terminating` for several minutes.
* Deployment rollout is stuck.
* Old Pods are not being removed.
* A node is being drained but Pods will not terminate.
* Monitoring reports Pods stuck in termination.

> **Important:** Do not immediately force-delete the Pod. First find out why Kubernetes cannot complete termination.

---

# 2. Quick Decision Flow

```text
Pod Terminating
      │
      ▼
Check Pod details/events
      │
      ▼
Identify cause
      │
 ┌────┼──────────┬───────────┐
 ▼    ▼          ▼           ▼
Finalizer  Node issue   Volume      Process
          /Kubelet      unmount     won't stop
 │          │            │           │
 └──────────┴────────────┴───────────┘
                  │
                  ▼
              Fix cause
                  │
                  ▼
             Wait for deletion
                  │
                  ▼
        Force delete only if safe
                  │
                  ▼
            Verify recovery
```

---

# 3. Step 1 — Check the Pod

```bash
kubectl get pod <pod-name> -n <namespace> -o wide
```

Check:

```text
STATUS
AGE
NODE
```

Get the deletion timestamp:

```bash
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.metadata.deletionTimestamp}'
```

If it has been terminating much longer than expected, continue.

---

# 4. Step 2 — Describe the Pod

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Check:

```text
Events:
Finalizers:
Node:
Volumes:
Container states:
```

Also check recent events:

```bash
kubectl get events -n <namespace> \
  --sort-by='.lastTimestamp' | tail -30
```

Look for:

```text
FailedKillPod
FailedUnmount
FailedDetachVolume
Kubelet
container runtime
finalizer
timeout
```

---

# 5. Step 3 — Check Finalizers

A finalizer can prevent Kubernetes from completing deletion.

```bash
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.metadata.finalizers}'
```

If finalizers exist, identify **which controller added them** before removing anything.

> **Do not blindly remove finalizers.** A finalizer usually exists because Kubernetes needs to complete cleanup.

---

# 6. Step 4 — Check the Node

Find the node:

```bash
kubectl get pod <pod-name> -n <namespace> -o wide
```

Check:

```bash
kubectl get node <node-name>
```

Then:

```bash
kubectl describe node <node-name>
```

Look for:

```text
Ready
NotReady
DiskPressure
MemoryPressure
PIDPressure
```

If the node is `NotReady`, check kubelet:

```bash
systemctl status kubelet
```

Logs:

```bash
journalctl -u kubelet --since "30 minutes ago"
```

Check containerd:

```bash
systemctl status containerd
```

```bash
journalctl -u containerd --since "30 minutes ago"
```

---

# 7. Step 5 — Check Storage

If Events show:

```text
FailedUnmount
FailedDetachVolume
Unmount
Volume
```

check:

```bash
kubectl get pvc -n <namespace>
kubectl get pv
```

Describe the PVC:

```bash
kubectl describe pvc <pvc-name> -n <namespace>
```

Check CSI components:

```bash
kubectl get pods -n kube-system | grep -i csi
```

Investigate the CSI driver if it is unhealthy.

---

# 8. Step 6 — Check Container Shutdown

Check the Pod:

```bash
kubectl get pod <pod-name> -n <namespace> -o yaml
```

Look for:

```text
containerStatuses
state
lastState
terminationReason
terminationMessage
```

Check application logs if the container is still available:

```bash
kubectl logs <pod-name> -n <namespace>
```

Common causes include:

```text
Application ignores SIGTERM
Long shutdown process
Hung process
PreStop hook stuck
Graceful shutdown taking too long
```

---

# 9. Step 7 — Check Deployment / Controller

Determine the owner:

```bash
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.metadata.ownerReferences[*].name}'
```

If it belongs to a Deployment:

```bash
kubectl describe deployment <deployment-name> -n <namespace>
```

Check:

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

Make sure another healthy replica is available before deleting a production Pod.

---

# 10. Step 8 — Normal Recovery

Fix the underlying problem first.

Examples:

```text
Node problem
    → Recover kubelet/container runtime

Volume problem
    → Fix CSI/storage issue

Finalizer problem
    → Fix the responsible controller

Application shutdown problem
    → Fix shutdown/preStop behavior
```

Then watch:

```bash
kubectl get pod -n <namespace> -w
```

The Pod should disappear automatically.

---

# 11. Step 9 — Force Delete Only When Safe

Use force deletion only when:

* The Pod is confirmed stuck.
* The underlying cause is understood.
* The workload can safely tolerate deletion.
* You understand the storage/data implications.
* The Pod is not holding critical cleanup responsibilities.

Command:

```bash
kubectl delete pod <pod-name> \
  -n <namespace> \
  --grace-period=0 \
  --force
```

> **WARNING:** Force deletion removes the Pod object from the API without waiting for normal termination. The process/container may still exist on an unhealthy node. Do not use force deletion as the first troubleshooting step.

---

# 12. Do NOT Do These Things

### ❌ Don't immediately force-delete

First investigate:

```text
describe
→ events
→ finalizers
→ node
→ storage
→ container
```

### ❌ Don't blindly remove finalizers

You may leave the underlying resource or controller cleanup incomplete.

### ❌ Don't restart the node immediately

First determine whether the problem is actually node-related.

### ❌ Don't delete PVC/PV to fix a stuck Pod

A Pod deletion problem does not mean the storage resource should be deleted.

### ❌ Don't force-delete a critical database Pod blindly

Confirm replica-set/database health before taking destructive action.

---

# 13. Quick Reference

```bash
# Check Pod
kubectl get pod <pod> -n <namespace> -o wide

# Check deletion timestamp
kubectl get pod <pod> -n <namespace> \
  -o jsonpath='{.metadata.deletionTimestamp}'

# Describe Pod
kubectl describe pod <pod> -n <namespace>

# Check events
kubectl get events -n <namespace> \
  --sort-by='.lastTimestamp'

# Check finalizers
kubectl get pod <pod> -n <namespace> \
  -o jsonpath='{.metadata.finalizers}'

# Check node
kubectl get node <node>

# Check node details
kubectl describe node <node>

# Check kubelet
systemctl status kubelet

# Check kubelet logs
journalctl -u kubelet --since "30 minutes ago"

# Check containerd
systemctl status containerd

# Check storage
kubectl get pvc -n <namespace>
kubectl get pv

# Check CSI
kubectl get pods -n kube-system | grep -i csi

# Watch Pod
kubectl get pods -n <namespace> -w

# Force delete — LAST RESORT
kubectl delete pod <pod> -n <namespace> \
  --grace-period=0 --force
```

---

# 14. Recovery Criteria

The incident is resolved when:

* [ ] Stuck Pod has been safely removed.
* [ ] Replacement Pod is created if required.
* [ ] Replacement Pod is `Running`.
* [ ] Replacement Pod is `Ready`.
* [ ] No new termination errors.
* [ ] Deployment rollout is complete.
* [ ] Service has healthy endpoints.
* [ ] Application health check succeeds.
* [ ] No node/storage problems remain.

---

# 15. Escalation

Escalate to **Kubernetes/SRE** when:

* Multiple Pods are stuck terminating.
* Node is `NotReady`.
* Kubelet/containerd is unhealthy.
* CSI/storage is failing.
* Finalizer/controller cleanup is failing.
* Force deletion is required repeatedly.

Escalate to the **Application Owner** when:

* Application does not respond to SIGTERM.
* `preStop` hook is failing.
* Application shutdown takes too long.
* Deployment configuration causes repeated termination problems.

---

## Golden Rule

```text
Pod Terminating
      ↓
DON'T FORCE DELETE FIRST
      ↓
kubectl describe pod
      ↓
CHECK EVENTS
      ↓
Check Finalizer / Node / Storage / Container
      ↓
FIX ROOT CAUSE
      ↓
WAIT FOR DELETION
      ↓
FORCE DELETE ONLY IF SAFE
      ↓
VERIFY REPLACEMENT POD
      ↓
VERIFY APPLICATION
```

> **Terminating = Kubernetes is trying to delete the Pod but cleanup has not completed. Find what is blocking termination before using force deletion.**
