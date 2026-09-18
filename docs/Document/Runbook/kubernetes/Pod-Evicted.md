# Kubernetes Pod Evicted — Runbook

**Service:** Kubernetes Cluster  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on workload impact

## 1. Trigger

Use this runbook when:

- Pod status shows `Evicted`.
- Node reports `DiskPressure` or `MemoryPressure`.
- Kubernetes evicts pods to protect node stability.
- Multiple pods are unexpectedly evicted.

---

## 2. Quick Decision Flow

```text
Pod Evicted
    ↓
Check Pod Reason
    ↓
Check Node Conditions
    ↓
MemoryPressure?
DiskPressure?
PIDPressure?
    ↓
Find Root Cause
    ↓
Fix Node / Workload
    ↓
Verify Replacement Pod
    ↓
Verify Application
```

---

## 3. Step 1 — Confirm Eviction

```bash
kubectl get pod <pod-name> -n <namespace>
```

Expected:

```text
STATUS
Evicted
```

Get details:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look for:

```text
Status: Failed
Reason: Evicted
Message:
```

The eviction message usually identifies the resource under pressure.

---

## 4. Step 2 — Check Node Conditions

Find the node:

```bash
kubectl get pod <pod-name>   -n <namespace>   -o wide
```

Then:

```bash
kubectl describe node <node-name>
```

Check:

```text
MemoryPressure
DiskPressure
PIDPressure
Ready
```

Common causes:

```text
MemoryPressure=True
DiskPressure=True
PIDPressure=True
```

---

## 5. Step 3 — Check Node Memory

```bash
kubectl top node <node-name>
```

On the node:

```bash
free -h
top
```

Check OOM events:

```bash
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20
```

If memory pressure is confirmed, identify high-memory workloads:

```bash
kubectl top pods -A --sort-by=memory
```

---

## 6. Step 4 — Check Node Disk

```bash
df -h
df -i
```

Check Kubernetes storage:

```bash
df -h /var/lib/kubelet
df -h /var/lib/containerd
```

Find large directories:

```bash
du -xhd1 /var/lib 2>/dev/null | sort -h
```

Look for:

```text
Disk nearly full
Inodes exhausted
Container logs
Unused images
Large temporary files
Application-generated files
```

> Do not delete `/var/lib/kubelet` or `/var/lib/containerd` blindly.

---

## 7. Step 5 — Check Node Events

```bash
kubectl describe node <node-name> | sed -n '/Events:/,$p'
```

Look for:

```text
MemoryPressure
DiskPressure
PIDPressure
EvictionThresholdMet
NodeHasMemoryPressure
NodeHasDiskPressure
```

---

## 8. Step 6 — Check Pod Requests and Limits

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Review:

```text
Requests:
Limits:
```

Pods with appropriate resource requests are considered differently during resource-pressure eviction.

Check the Deployment:

```bash
kubectl get deployment <deployment-name>   -n <namespace> -o yaml
```

Look for:

```yaml
resources:
  requests:
    cpu: ...
    memory: ...
  limits:
    cpu: ...
    memory: ...
```

Missing or poorly sized requests/limits can contribute to unstable scheduling and resource pressure.

---

## 9. Step 7 — Check All Pods on the Node

```bash
kubectl get pods -A -o wide | grep <node-name>
```

Check memory usage:

```bash
kubectl top pods -A --sort-by=memory
```

Identify:

```text
Memory-heavy pods
High restart counts
Pods without resource requests
Pods consuming unexpected disk
```

---

## 10. Step 8 — Check Ephemeral Storage

Pods can be evicted because of local ephemeral-storage pressure.

Check:

```bash
kubectl describe node <node-name>
```

Look for:

```text
ephemeral-storage
DiskPressure
```

Check pod configuration:

```bash
kubectl get pod <pod-name>   -n <namespace> -o yaml
```

Look for:

```yaml
resources:
  requests:
    ephemeral-storage: ...
  limits:
    ephemeral-storage: ...
```

Common sources:

```text
Container logs
/tmp files
Application temporary files
Container writable layers
EmptyDir volumes
```

---

## 11. Step 9 — Check Container Logs

If the evicted pod's logs are still available:

```bash
kubectl logs <pod-name> -n <namespace>
```

Check the application for:

```text
Large log output
Temporary-file growth
Memory spikes
Application crashes
```

If the pod has already been removed, inspect the Deployment/Job and replacement pod.

---

## 12. Step 10 — Fix the Root Cause

### Memory Pressure

Consider:

```text
Reduce memory usage
Fix memory leak
Increase appropriate pod memory requests/limits
Scale workload
Add node capacity
```

### Disk Pressure

Consider:

```text
Clean approved temporary data
Reduce excessive logs
Configure log rotation
Remove unused container images using the approved runtime procedure
Increase disk capacity
```

### Ephemeral Storage

Consider:

```text
Set ephemeral-storage requests/limits
Clean temporary files
Reduce log growth
Use persistent storage for persistent data
```

### Too Many Workloads

Consider:

```text
Scale cluster
Review resource requests
Review scheduling
Review HPA
Review node capacity
```

---

## 13. Step 11 — Check Deployment / Controller

A Deployment normally creates a replacement pod after eviction.

Check:

```bash
kubectl get deployment <deployment-name> -n <namespace>
```

Check ReplicaSet:

```bash
kubectl get rs -n <namespace>
```

Check pods:

```bash
kubectl get pods -n <namespace>
```

Expected:

```text
Desired replicas = Available replicas
```

If the replacement pod is not created or is unhealthy, use the relevant runbook:

```text
Pod-Pending.md
Pod-ContainerCreating.md
Pod-CrashLoopBackOff.md
Pod-ImagePullBackOff.md
```

---

## 14. Step 12 — Verify Node Recovery

```bash
kubectl describe node <node-name>
```

Confirm:

```text
MemoryPressure=False
DiskPressure=False
PIDPressure=False
Ready=True
```

Also:

```bash
kubectl get node <node-name>
```

Expected:

```text
Ready
```

---

## 15. Step 13 — Verify Replacement Pod

```bash
kubectl get pods -n <namespace> -o wide
```

Expected:

```text
READY   STATUS
1/1     Running
```

Check:

```bash
kubectl describe pod <new-pod-name> -n <namespace>
```

Confirm:

```text
Ready=True
No eviction events
No continuous restarts
```

---

## 16. Step 14 — Verify Application

Check application logs:

```bash
kubectl logs <new-pod-name> -n <namespace>
```

Health check:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

Verify important application functionality.

---

## 17. Do NOT Do These Things

### ❌ Don't just delete the evicted pod

An evicted pod is already terminated. Fix the node/resource problem.

### ❌ Don't immediately reboot the node

Find the pressure source first.

### ❌ Don't delete Kubernetes directories blindly

Avoid destructive cleanup of:

```text
/var/lib/kubelet
/var/lib/containerd
```

### ❌ Don't remove all resource limits

This can make node pressure worse.

### ❌ Don't ignore ephemeral storage

Disk pressure is not always caused by the root filesystem alone.

### ❌ Don't manually recreate controller-managed pods

Let the Deployment/StatefulSet/Job recreate them unless there is a specific operational reason.

---

## 18. Quick Reference

```bash
# Pod
kubectl get pod <pod-name> -n <namespace>
kubectl describe pod <pod-name> -n <namespace>

# Find node
kubectl get pod <pod-name> -n <namespace> -o wide

# Node
kubectl get nodes
kubectl describe node <node-name>

# Node events
kubectl describe node <node-name> | sed -n '/Events:/,$p'

# Memory
kubectl top node <node-name>
kubectl top pods -A --sort-by=memory
free -h
top

# Disk
df -h
df -i
df -h /var/lib/kubelet
df -h /var/lib/containerd

# OOM
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20

# Workloads on node
kubectl get pods -A -o wide | grep <node-name>

# Deployment
kubectl get deployment <deployment-name> -n <namespace>
kubectl get rs -n <namespace>

# Application
kubectl logs <new-pod-name> -n <namespace>
```

---

## 19. Recovery Criteria

- [ ] Pod eviction confirmed.
- [ ] Eviction reason identified.
- [ ] Node identified.
- [ ] Memory pressure checked.
- [ ] Disk pressure checked.
- [ ] PID pressure checked.
- [ ] Ephemeral storage checked.
- [ ] Root cause fixed or mitigated.
- [ ] Node is `Ready`.
- [ ] Node pressure conditions are cleared.
- [ ] Replacement pod is created.
- [ ] Replacement pod is `Running`.
- [ ] Replacement pod is `Ready`.
- [ ] No continuing eviction events.
- [ ] Application health check succeeds.
- [ ] Resource requests/limits reviewed.

---

## 20. Escalation

Escalate to **Kubernetes/SRE** when:

- Multiple pods are being evicted.
- Multiple nodes have resource pressure.
- Cluster capacity is insufficient.
- Evictions continue after remediation.

Escalate to **Application Owner** when:

- Application memory usage is abnormal.
- Application generates excessive logs/temp files.
- Resource requests/limits are incorrect.

Escalate to **Infrastructure/SRE** when:

- Node disk capacity is insufficient.
- Storage performance/capacity is the underlying problem.
- Additional node capacity is required.

---

## Golden Rule

```text
Pod Evicted
     ↓
CHECK EVICTION REASON
     ↓
Check Node
     ↓
Check Memory / Disk / PID
     ↓
Check Ephemeral Storage
     ↓
Fix Root Cause
     ↓
Verify Node
     ↓
Verify Replacement Pod
     ↓
Verify Application
```

> **Pod Evicted = Kubernetes protected the node by terminating the pod. Find and fix the resource pressure before simply recreating or restarting workloads.**
