# Kubernetes Node NotReady — Runbook

**Service:** Kubernetes Cluster  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on workload and cluster capacity

## 1. Trigger

Use this runbook when:

- `kubectl get nodes` shows `NotReady`.
- Monitoring alerts that a node is unhealthy.
- Pods on the node become unavailable.
- Kubelet stops reporting node status.

---

## 2. Quick Decision Flow

```text
Node NotReady
     ↓
kubectl describe node
     ↓
Check Conditions + Events
     ↓
Check Kubelet
     ↓
Check Container Runtime
     ↓
Check Disk / Memory / PID
     ↓
Check Network
     ↓
Fix Root Cause
     ↓
Verify Node Ready
     ↓
Verify Pods
```

---

## 3. Step 1 — Confirm

```bash
kubectl get nodes
kubectl get node <node-name>
```

Expected problem:

```text
<node-name>   NotReady
```

---

## 4. Step 2 — Check Node Conditions

```bash
kubectl describe node <node-name>
```

Check:

```text
Ready
MemoryPressure
DiskPressure
PIDPressure
NetworkUnavailable
Events
```

Important conditions:

```text
Ready=False
MemoryPressure=True
DiskPressure=True
PIDPressure=True
NetworkUnavailable=True
```

The condition normally points to the next troubleshooting step.

---

## 5. Step 3 — Check Node Events

```bash
kubectl describe node <node-name> | sed -n '/Events:/,$p'
```

Look for:

```text
NodeNotReady
Kubelet stopped posting node status
DiskPressure
MemoryPressure
InvalidDiskCapacity
Container runtime failure
Network unavailable
```

---

## 6. Step 4 — SSH to the Node

```bash
ssh <node>
```

Check:

```bash
hostname
uptime
uname -r
top
```

---

## 7. Step 5 — Check Kubelet

```bash
systemctl status kubelet
```

Logs:

```bash
journalctl -u kubelet --since "30 minutes ago" --no-pager
```

Search errors:

```bash
journalctl -u kubelet --since "30 minutes ago" --no-pager | grep -Ei 'error|fail|timeout|evict|notready'
```

If kubelet is stopped:

```bash
systemctl start kubelet
```

If it is running but malfunctioning:

```bash
systemctl restart kubelet
```

Then verify:

```bash
systemctl status kubelet
```

---

## 8. Step 6 — Check Container Runtime

For containerd:

```bash
systemctl status containerd
```

Logs:

```bash
journalctl -u containerd --since "30 minutes ago" --no-pager
```

If stopped:

```bash
systemctl start containerd
```

Do not repeatedly restart kubelet if the container runtime itself is failing.

---

## 9. Step 7 — Check Disk Pressure

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

If `DiskPressure=True`, fix the underlying disk problem.

> Do not delete `/var/lib/kubelet` or `/var/lib/containerd` blindly.

If the issue is severe disk exhaustion, follow your disk-pressure/storage runbook.

---

## 10. Step 8 — Check Memory Pressure

```bash
free -h
top
```

Check OOM events:

```bash
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20
```

If:

```text
MemoryPressure=True
```

identify the process or workload consuming memory.

---

## 11. Step 9 — Check PID Pressure

```bash
ps -e --no-headers | wc -l
```

Check:

```bash
kubectl describe node <node-name> | grep -A5 PIDPressure
```

If `PIDPressure=True`, identify processes creating excessive processes/threads.

---

## 12. Step 10 — Check Network

```bash
ip addr
ip route
ip -s link
```

Check DNS:

```bash
getent hosts kubernetes.default.svc
```

Check connectivity to the Kubernetes API endpoint according to your cluster architecture.

Look for:

```text
Network unreachable
DNS failure
Packet loss
Interface errors
API-server connectivity failure
```

---

## 13. Step 11 — Check Node Time

```bash
timedatectl
```

If using chrony:

```bash
chronyc tracking
```

Correct significant time drift using the approved time-synchronization configuration.

---

## 14. Step 12 — Check Pods on the Node

```bash
kubectl get pods -A -o wide | grep <node-name>
```

Look for:

```text
CrashLoopBackOff
ContainerCreating
ImagePullBackOff
Pending
Terminating
Unknown
```

Use the appropriate pod runbook:

```text
Pod-ContainerCreating.md
Pod-CrashLoopBackOff.md
Pod-ImagePullBackOff.md
Pod-Pending.md
Pod-Terminating.md
```

---

## 15. Step 13 — Check Taints

```bash
kubectl describe node <node-name> | grep -i taint
```

Common automatic taints:

```text
node.kubernetes.io/not-ready
node.kubernetes.io/unreachable
node.kubernetes.io/disk-pressure
node.kubernetes.io/memory-pressure
node.kubernetes.io/pid-pressure
```

Do not manually remove an automatic taint before fixing the underlying node condition.

---

## 16. Step 14 — Cordon if Maintenance Is Required

If the node is unhealthy:

```bash
kubectl cordon <node-name>
```

Verify:

```bash
kubectl get nodes
```

Expected:

```text
Ready,SchedulingDisabled
```

> Cordon prevents new workloads from being scheduled. It does not move existing pods.

If workloads must be moved and the situation permits:

```bash
kubectl drain <node-name>   --ignore-daemonsets   --delete-emptydir-data
```

Check PodDisruptionBudgets before draining production nodes.

---

## 17. Step 15 — Verify Recovery

```bash
kubectl get nodes
```

Expected:

```text
<node-name>   Ready
```

Then:

```bash
kubectl describe node <node-name>
```

Confirm:

```text
Ready=True
MemoryPressure=False
DiskPressure=False
PIDPressure=False
NetworkUnavailable=False
```

---

## 18. Step 16 — Verify Pods

```bash
kubectl get pods -A -o wide | grep <node-name>
kubectl get pods -A
```

Expected workloads:

```text
Running
Completed
```

Investigate any remaining:

```text
Pending
CrashLoopBackOff
ImagePullBackOff
ContainerCreating
Terminating
Unknown
```

---

## 19. Step 17 — Uncordon

Only after the node is healthy:

```bash
kubectl uncordon <node-name>
```

Verify:

```bash
kubectl get node <node-name>
```

---

## 20. Common Causes

### Kubelet failure

```text
Kubelet stopped
   ↓
Node stops reporting
   ↓
NotReady
```

### Container runtime failure

```text
containerd failure
   ↓
Kubelet cannot manage containers
   ↓
NodeNotReady
```

### Disk pressure

```text
Disk fills
   ↓
DiskPressure=True
   ↓
Pod eviction / node instability
```

### Memory pressure

```text
High memory usage
   ↓
MemoryPressure=True
   ↓
Pod eviction / instability
```

### Network/API connectivity

```text
Node cannot reach control plane
   ↓
Heartbeat/status updates fail
   ↓
NodeNotReady
```

---

## 21. Do NOT Do These Things

### ❌ Don't reboot immediately

First identify whether kubelet, runtime, disk, memory, or network is the problem.

### ❌ Don't delete `/var/lib/kubelet`

This can cause serious node-state problems.

### ❌ Don't delete `/var/lib/containerd` blindly

You can destroy local container/image state.

### ❌ Don't remove taints blindly

Fix the underlying condition first.

### ❌ Don't drain an unhealthy node blindly

Check workload availability and PodDisruptionBudgets.

### ❌ Don't restart kubelet repeatedly

If it fails again, inspect its logs.

---

## 22. Quick Reference

```bash
# Cluster
kubectl get nodes

# Node details
kubectl describe node <node-name>

# Events
kubectl describe node <node-name> | sed -n '/Events:/,$p'

# Pods on node
kubectl get pods -A -o wide | grep <node-name>

# Kubelet
systemctl status kubelet
journalctl -u kubelet --since "30 minutes ago" --no-pager
systemctl restart kubelet

# Container runtime
systemctl status containerd
journalctl -u containerd --since "30 minutes ago" --no-pager

# Disk
df -h
df -i

# Memory
free -h
top

# OOM
dmesg | grep -Ei 'oom|out of memory|killed process' | tail -20

# Network
ip addr
ip route
ip -s link

# DNS
getent hosts kubernetes.default.svc

# Time
timedatectl

# Cordon / drain / uncordon
kubectl cordon <node-name>
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
kubectl uncordon <node-name>
```

---

## 23. Recovery Criteria

- [ ] Node is `Ready`.
- [ ] Kubelet is active and stable.
- [ ] Container runtime is active.
- [ ] `MemoryPressure=False`.
- [ ] `DiskPressure=False`.
- [ ] `PIDPressure=False`.
- [ ] Network connectivity is healthy.
- [ ] Node can communicate with the Kubernetes API.
- [ ] No continuing kubelet errors.
- [ ] No critical disk/memory issues.
- [ ] Expected pods are healthy.
- [ ] Workloads are available.
- [ ] Node is uncordoned if it was cordoned.
- [ ] Cluster has recovered normal capacity.

---

## 24. Escalation

Escalate to **Kubernetes/SRE** when:

- Kubelet repeatedly fails.
- Node repeatedly becomes `NotReady`.
- Multiple nodes are affected.
- Cluster capacity is at risk.
- Pods remain unhealthy after node recovery.

Escalate to **Infrastructure/SRE** when:

- VM/server is unreachable.
- Disk/storage errors exist.
- Kernel or hardware problems are suspected.
- Network connectivity is failing.

Escalate to the **Application Owner** when:

- Workloads remain unhealthy after node recovery.
- Application pods fail after rescheduling.
- Pod resource requests/limits contribute to node pressure.

---

## Golden Rule

```text
Node NotReady
      ↓
CHECK NODE CONDITIONS
      ↓
Check Kubelet
      ↓
Check Container Runtime
      ↓
Check Disk / Memory / PID
      ↓
Check Network
      ↓
FIX ROOT CAUSE
      ↓
Restart Kubelet if Required
      ↓
Verify Node Ready
      ↓
Verify Pods
      ↓
Uncordon if Safe
```

> **Node NotReady = don't reboot first. Check the node conditions, kubelet, container runtime, resources, and network to identify the actual cause.**
