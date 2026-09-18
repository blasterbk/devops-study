# Kubernetes Node DiskPressure — Runbook

**Service:** Kubernetes Cluster  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on workload impact

## 1. Trigger

Use this runbook when:

- Node shows `DiskPressure=True`.
- Pods are being evicted because of disk pressure.
- Pod events show `DiskPressure` or `EvictionThresholdMet`.
- Node filesystem is nearly full.
- Kubernetes reports insufficient ephemeral storage.

---

## 2. Quick Decision Flow

```text
Node DiskPressure
       ↓
Check Node Condition
       ↓
Check Disk Space
       ↓
Check Inodes
       ↓
Check /var/lib/kubelet
       ↓
Check Container Runtime
       ↓
Check Logs / Images / Temporary Files
       ↓
Clean or Increase Capacity
       ↓
Verify DiskPressure=False
       ↓
Verify Pods
```

---

## 3. Step 1 — Confirm DiskPressure

```bash
kubectl get nodes
```

Then:

```bash
kubectl describe node <node-name>
```

Check:

```text
Conditions:
  DiskPressure
```

Problem:

```text
DiskPressure=True
```

Also check node events:

```bash
kubectl describe node <node-name> | sed -n '/Events:/,$p'
```

Look for:

```text
DiskPressure
EvictionThresholdMet
NodeHasDiskPressure
```

---

## 4. Step 2 — Check Disk Usage on the Node

SSH to the affected node:

```bash
ssh <node>
```

Check filesystem usage:

```bash
df -h
```

Check inode usage:

```bash
df -i
```

Look for:

```text
Filesystem near 100%
Inodes near 100%
```

> A node can have free disk space but still experience disk pressure when it runs out of inodes.

---

## 5. Step 3 — Identify the Full Filesystem

```bash
df -h
```

Common locations:

```text
/
/var
/var/lib
/var/lib/kubelet
/var/lib/containerd
```

Check:

```bash
du -xhd1 /var 2>/dev/null | sort -h
```

Then:

```bash
du -xhd1 /var/lib 2>/dev/null | sort -h
```

Find large files:

```bash
find /var -xdev -type f -size +1G -printf '%s %p\n' 2>/dev/null | sort -nr | head -20
```

---

## 6. Step 4 — Check Kubernetes and Container Runtime Storage

Check kubelet:

```bash
du -sh /var/lib/kubelet 2>/dev/null
```

Check container runtime:

```bash
du -sh /var/lib/containerd 2>/dev/null
```

If Docker is used:

```bash
du -sh /var/lib/docker 2>/dev/null
```

Check container images:

```bash
crictl images
```

Check containers:

```bash
crictl ps -a
```

> Use the container runtime's approved cleanup procedure. Do not manually delete runtime directories.

---

## 7. Step 5 — Check Container Logs

Large logs are a common source of disk usage.

Check:

```bash
du -sh /var/log/* 2>/dev/null | sort -h
```

Check journal usage:

```bash
journalctl --disk-usage
```

Check large log files:

```bash
find /var/log -type f -size +500M -printf '%s %p\n' 2>/dev/null | sort -nr | head -20
```

Do not delete active application logs blindly.

Use the approved log rotation/cleanup procedure.

---

## 8. Step 6 — Check Pod Ephemeral Storage

Find Pods on the affected node:

```bash
kubectl get pods -A -o wide | grep <node-name>
```

Check resource configuration:

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
Container writable layer
/tmp
emptyDir
Application logs
Temporary files
```

---

## 9. Step 7 — Check EmptyDir Usage

Inspect the affected Pod:

```bash
kubectl get pod <pod-name>   -n <namespace> -o yaml
```

Look for:

```yaml
volumes:
  - name: temp
    emptyDir: {}
```

`emptyDir` consumes node-local storage.

Large or uncontrolled `emptyDir` usage can contribute to DiskPressure.

Review the application for unnecessary temporary data.

---

## 10. Step 8 — Check Image Usage

For containerd:

```bash
crictl images
```

Check runtime storage:

```bash
du -sh /var/lib/containerd 2>/dev/null
```

If the node has many unused images, use the approved container-runtime image cleanup procedure.

Do not manually remove files from:

```text
/var/lib/containerd
```

or:

```text
/var/lib/kubelet
```

---

## 11. Step 9 — Check Inodes

```bash
df -i
```

If inode usage is near 100%, identify directories containing many files:

```bash
for d in /var/*; do
  [ -d "$d" ] && echo "$(find "$d" -xdev -type f 2>/dev/null | wc -l) $d"
done | sort -nr | head
```

Common causes:

```text
Millions of small log files
Temporary files
Application-generated files
Cache directories
Container data
```

Find the application or system process generating excessive files before deleting anything.

---

## 12. Step 10 — Check Kubernetes Evictions

```bash
kubectl get events -A   --sort-by=.lastTimestamp | grep -Ei   'diskpressure|evict|eviction'
```

Check evicted Pods:

```bash
kubectl get pods -A | grep Evicted
```

If Pods are being evicted, use:

```text
Pod-Evicted.md
```

after resolving the node storage problem.

---

## 13. Step 11 — Immediate Mitigation

If the node is actively affecting production:

### Option A — Stop Scheduling New Pods

```bash
kubectl cordon <node-name>
```

This prevents new Pods from being scheduled onto the node.

> Cordon does not remove existing Pods.

### Option B — Drain the Node

Only after confirming workload impact and following the approved maintenance procedure:

```bash
kubectl drain <node-name>   --ignore-daemonsets   --delete-emptydir-data
```

> `--delete-emptydir-data` can delete data stored in `emptyDir`. Use it only when the data is disposable and the impact is understood.

### Option C — Reduce Disk Usage

Use the approved procedures for:

```text
Log cleanup
Container image cleanup
Temporary-file cleanup
Application data cleanup
Disk expansion
```

---

## 14. Step 12 — Increase Disk Capacity

If the node repeatedly reaches disk capacity:

```text
Increase node disk
OR
Use a larger node type
OR
Move persistent data to persistent storage
OR
Reduce local ephemeral-storage usage
```

Follow your cloud provider's approved disk expansion procedure.

Do not resize production storage without confirming:

```text
Backup
Filesystem support
Maintenance requirements
Application impact
```

---

## 15. Step 13 — Verify Disk Recovery

On the node:

```bash
df -h
df -i
```

Expected:

```text
Sufficient free disk
Sufficient free inodes
```

Then:

```bash
kubectl describe node <node-name>
```

Expected:

```text
DiskPressure=False
```

Check:

```bash
kubectl get node <node-name>
```

Expected:

```text
Ready
```

---

## 16. Step 14 — Verify Pods

```bash
kubectl get pods -A -o wide
```

Check for:

```text
Pending
Evicted
ContainerCreating
CrashLoopBackOff
```

If the affected workload is managed by a Deployment:

```bash
kubectl get deployment -A
```

Verify desired and available replicas.

---

## 17. Step 15 — Verify Application

Check application logs:

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

Verify the application has returned to normal operation.

---

## 18. Do NOT Do These Things

### ❌ Don't delete `/var/lib/kubelet`

This can seriously damage the node.

### ❌ Don't manually delete `/var/lib/containerd`

Use the container runtime's supported cleanup commands.

### ❌ Don't delete application data blindly

Confirm what the data is before removing it.

### ❌ Don't delete `emptyDir` data without approval

Applications may depend on it during runtime.

### ❌ Don't immediately reboot the node

A reboot does not fix a filesystem that is genuinely full.

### ❌ Don't run `kubectl drain` blindly

Draining can disrupt workloads and may delete `emptyDir` data.

### ❌ Don't ignore inode exhaustion

Disk space can be available while the filesystem cannot create more files.

---

## 19. Quick Reference

```bash
# Node status
kubectl get nodes
kubectl describe node <node-name>

# Disk
df -h
df -i

# Large directories
du -xhd1 /var 2>/dev/null | sort -h
du -xhd1 /var/lib 2>/dev/null | sort -h

# Large files
find /var -xdev -type f -size +1G -printf '%s %p\n' 2>/dev/null | sort -nr | head -20

# Kubelet/runtime storage
du -sh /var/lib/kubelet
du -sh /var/lib/containerd

# Container images
crictl images

# Logs
du -sh /var/log/* 2>/dev/null | sort -h
journalctl --disk-usage

# Pods on node
kubectl get pods -A -o wide | grep <node-name>

# Evictions
kubectl get pods -A | grep Evicted
kubectl get events -A --sort-by=.lastTimestamp |   grep -Ei 'diskpressure|evict|eviction'

# Protect node
kubectl cordon <node-name>

# Maintenance drain
kubectl drain <node-name>   --ignore-daemonsets   --delete-emptydir-data
```

---

## 20. Recovery Criteria

- [ ] `DiskPressure=True` confirmed.
- [ ] Full filesystem identified.
- [ ] Disk usage checked.
- [ ] Inode usage checked.
- [ ] `/var/lib/kubelet` checked.
- [ ] Container runtime storage checked.
- [ ] Log usage checked.
- [ ] Ephemeral storage checked.
- [ ] `emptyDir` usage checked where applicable.
- [ ] Root cause identified.
- [ ] Disk usage reduced or capacity increased.
- [ ] Sufficient free disk available.
- [ ] Sufficient free inodes available.
- [ ] `DiskPressure=False`.
- [ ] Node is `Ready`.
- [ ] No continuing eviction events.
- [ ] Affected Pods are healthy.
- [ ] Application health check succeeds.

---

## 21. Escalation

Escalate to **Kubernetes/SRE** when:

- Multiple nodes have DiskPressure.
- Kubernetes runtime storage is unexpectedly large.
- Pods are repeatedly evicted.
- Node storage usage cannot be identified.

Escalate to **Application Owner** when:

- Application generates excessive logs.
- Application creates excessive temporary files.
- `emptyDir` usage is unexpectedly high.
- Application data is consuming node-local storage.

Escalate to **Infrastructure/Cloud Team** when:

- Node disk capacity is insufficient.
- Disk expansion is required.
- Cloud storage operations are failing.

---

## Golden Rule

```text
Node DiskPressure
       ↓
CHECK df -h
       ↓
CHECK df -i
       ↓
FIND LARGE DIRECTORIES / FILES
       ↓
CHECK KUBELET / CONTAINER RUNTIME
       ↓
CHECK LOGS / EPHEMERAL STORAGE
       ↓
CLEAN SAFELY OR INCREASE CAPACITY
       ↓
VERIFY DiskPressure=False
       ↓
VERIFY NODE + PODS
       ↓
VERIFY APPLICATION
```

> **DiskPressure = Kubernetes detected insufficient node-local storage. Identify whether the cause is disk space, inodes, logs, images, ephemeral storage, or application data before deleting anything.**
