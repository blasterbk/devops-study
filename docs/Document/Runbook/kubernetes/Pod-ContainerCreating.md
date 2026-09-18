# Kubernetes Pod Stuck in `ContainerCreating` — Runbook

**Service:** Kubernetes Workload
**Owner:** DevOps / SRE
**Severity:** P2–P3 depending on application impact
**Applies to:** Kubernetes clusters
**Purpose:** Diagnose and recover Pods that remain in `ContainerCreating` for longer than expected.

---

## 1. Trigger

Use this runbook when:

* Pod remains in `ContainerCreating` for several minutes.
* Deployment rollout is stuck.
* Application is unavailable because new Pods cannot start.
* Monitoring reports Pods stuck during startup.
* Multiple Pods on the same node are stuck in `ContainerCreating`.

> **Important:** `ContainerCreating` is a Pod status, not necessarily the root cause. Always inspect Pod events first.

---

# 2. Quick Decision Flow

```text
Pod stuck in ContainerCreating
            │
            ▼
     Check Pod events
            │
            ▼
   ┌────────┼─────────┐
   │        │         │
   ▼        ▼         ▼
Volume    Image     Network
Issue     Issue      Issue
   │        │         │
   ▼        ▼         ▼
PVC/CSI   Runtime/   CNI/DNS/
Mount     Registry   Network
   │        │         │
   └────────┼─────────┘
            ▼
       Node health
            │
            ▼
      Kubelet/runtime
            │
            ▼
       Apply fix
            │
            ▼
      Verify Pod
            │
            ▼
   Verify application
```

---

# 3. Step 1 — Identify the Pod

List Pods:

```bash
kubectl get pods -A -o wide
```

For a specific namespace:

```bash
kubectl get pods -n <namespace> -o wide
```

Example:

```bash
kubectl get pod <pod-name> -n <namespace> -o wide
```

Record:

```text
Pod:
Namespace:
Node:
IP:
Container:
Image:
Age:
```

---

# 4. Step 2 — Check Pod Events FIRST

This is the most important step.

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look at:

```text
Events:
```

Or show recent events:

```bash
kubectl get events -n <namespace> \
  --sort-by='.lastTimestamp' | tail -30
```

For Kubernetes versions supporting the newer event fields:

```bash
kubectl get events -n <namespace> \
  --sort-by='.eventTime' | tail -30
```

Look for messages such as:

```text
FailedMount
FailedAttachVolume
FailedCreatePodSandBox
Failed to pull image
ErrImagePull
FailedCreatePodContainer
NetworkPluginNotReady
CNI
MountVolume
context deadline exceeded
permission denied
no space left on device
```

### Decision

```text
FailedMount / FailedAttachVolume
        → Go to Section A

Image pull error
        → Go to Section B

FailedCreatePodSandBox / CNI
        → Go to Section C

no space left on device
        → Go to Section D

Kubelet / runtime errors
        → Go to Section E

No useful event
        → Go to Section F
```

---

# Section A — Volume / PVC Problem

## Symptoms

Events contain:

```text
FailedMount
FailedAttachVolume
MountVolume.SetUp failed
Unable to attach or mount volumes
```

### A1. Check PVC

```bash
kubectl get pvc -n <namespace>
```

Describe it:

```bash
kubectl describe pvc <pvc-name> -n <namespace>
```

Expected:

```text
Status: Bound
```

If:

```text
Pending
```

investigate the StorageClass/PV.

---

### A2. Check PV

```bash
kubectl get pv
```

```bash
kubectl describe pv <pv-name>
```

Check:

```text
Status
StorageClass
Node affinity
Access modes
Claim
```

---

### A3. Check StorageClass

```bash
kubectl get storageclass
```

```bash
kubectl describe storageclass <storage-class>
```

---

### A4. Check CSI driver

```bash
kubectl get pods -A | grep -i csi
```

Check CSI components:

```bash
kubectl get daemonset -A | grep -i csi
```

If CSI Pods are unhealthy:

```bash
kubectl describe pod <csi-pod> -n <namespace>
```

---

### A5. Verify node/storage compatibility

Check the node:

```bash
kubectl get pod <pod-name> -n <namespace> -o wide
```

Then:

```bash
kubectl describe node <node-name>
```

Look for:

```text
Taints
Conditions
DiskPressure
MemoryPressure
```

---

### Recovery

After fixing the volume issue:

```bash
kubectl delete pod <pod-name> -n <namespace>
```

If managed by a Deployment/ReplicaSet, Kubernetes will create a replacement.

Verify:

```bash
kubectl get pods -n <namespace> -w
```

---

# Section B — Container Image Problem

## Symptoms

Events contain:

```text
Failed to pull image
ErrImagePull
ImagePullBackOff
unauthorized
manifest unknown
connection refused
i/o timeout
```

Although the Pod may initially appear as `ContainerCreating`, image/runtime problems can prevent startup.

### B1. Check image

```bash
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.spec.containers[*].image}'
```

Check all containers:

```bash
kubectl get pod <pod-name> -n <namespace> -o yaml
```

---

### B2. Check imagePullSecrets

```bash
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.spec.imagePullSecrets[*].name}'
```

Check the Secret:

```bash
kubectl get secret -n <namespace>
```

---

### B3. Check registry connectivity

From the affected node, test connectivity to the registry if appropriate.

Check DNS:

```bash
nslookup <registry>
```

or:

```bash
dig <registry>
```

Check HTTPS:

```bash
curl -I https://<registry>
```

---

### B4. Check node container runtime

For containerd:

```bash
systemctl status containerd
```

```bash
journalctl -u containerd --since "30 minutes ago"
```

---

### Recovery

Fix:

* Image tag
* Registry credentials
* ImagePullSecret
* Registry connectivity
* DNS
* Container runtime

Then recreate the Pod:

```bash
kubectl delete pod <pod-name> -n <namespace>
```

---

# Section C — CNI / Network Problem

## Symptoms

Events contain:

```text
FailedCreatePodSandBox
NetworkPluginNotReady
CNI
failed to setup network
failed to create pod sandbox
```

### C1. Identify the node

```bash
kubectl get pod <pod-name> -n <namespace> -o wide
```

Example:

```text
NODE
worker-node-2
```

---

### C2. Check node health

```bash
kubectl describe node <node-name>
```

Check:

```text
Ready
NetworkUnavailable
MemoryPressure
DiskPressure
PIDPressure
```

Expected:

```text
Ready=True
NetworkUnavailable=False
```

---

### C3. Check CNI Pods

Depending on your CNI:

```bash
kubectl get pods -n kube-system -o wide
```

Look for CNI components such as:

```text
Cilium
Calico
Flannel
Canal
```

Check their status:

```bash
kubectl get pods -n kube-system -o wide
```

---

### C4. Check kubelet

On the affected node:

```bash
systemctl status kubelet
```

Logs:

```bash
journalctl -u kubelet --since "30 minutes ago"
```

Look for:

```text
CNI
network
sandbox
container runtime
timeout
```

---

### C5. Check container runtime

```bash
systemctl status containerd
```

```bash
journalctl -u containerd --since "30 minutes ago"
```

---

### Recovery

If the problem is confirmed as a node/CNI issue:

1. Follow the relevant CNI/node recovery procedure.
2. Do not restart cluster-wide networking components unnecessarily.
3. If the node is unhealthy, consider cordoning it.

```bash
kubectl cordon <node-name>
```

If appropriate:

```bash
kubectl drain <node-name> \
  --ignore-daemonsets \
  --delete-emptydir-data
```

> **WARNING:** Do not drain a production node without checking workload availability, PodDisruptionBudgets, replicas, and cluster capacity.

---

# Section D — Disk Space / Disk Pressure

## Symptoms

Events contain:

```text
no space left on device
DiskPressure
failed to create container
failed to create sandbox
```

Check:

```bash
kubectl describe node <node-name>
```

Look for:

```text
DiskPressure=True
```

On the node:

```bash
df -h
```

Check inode usage:

```bash
df -i
```

Check large directories:

```bash
du -xh /var/lib/containerd 2>/dev/null | sort -h | tail
```

Check containerd:

```bash
du -sh /var/lib/containerd
```

Check kubelet:

```bash
du -sh /var/lib/kubelet
```

### Recovery

Do not blindly delete files under:

```text
/var/lib/kubelet
/var/lib/containerd
```

First identify what is consuming disk.

Remove unused resources using the approved node-maintenance procedure.

After cleanup:

```bash
df -h
```

Then:

```bash
kubectl describe node <node-name>
```

Confirm:

```text
DiskPressure=False
```

---

# Section E — Kubelet / Container Runtime Problem

## Symptoms

Pod events are unclear or indicate:

```text
container runtime
kubelet
CRI
timeout
failed to create container
failed to create pod sandbox
```

### E1. Check kubelet

```bash
systemctl status kubelet
```

```bash
journalctl -u kubelet --since "30 minutes ago" --no-pager
```

---

### E2. Check containerd

```bash
systemctl status containerd
```

```bash
journalctl -u containerd --since "30 minutes ago" --no-pager
```

---

### E3. Check node conditions

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
```

---

### E4. Check container runtime processes

```bash
ps aux | grep -E 'containerd|kubelet'
```

Check runtime information:

```bash
kubectl get node <node-name> -o wide
```

---

### Recovery

If kubelet/containerd is confirmed unhealthy, follow the approved node-runtime recovery procedure.

A controlled restart may be required:

```bash
systemctl restart containerd
```

or:

```bash
systemctl restart kubelet
```

> **WARNING:** Restarting node services can affect running workloads. Confirm workload redundancy before restarting services on a production node.

After recovery:

```bash
kubectl get node <node-name>
```

Expected:

```text
Ready
```

Then:

```bash
kubectl get pods -n <namespace> -o wide
```

---

# Section F — No Clear Event

If the Pod remains in `ContainerCreating` but events do not clearly identify the problem:

### F1. Inspect full Pod YAML

```bash
kubectl get pod <pod-name> -n <namespace> -o yaml
```

Check:

```text
volumes
volumeMounts
initContainers
containers
securityContext
serviceAccount
imagePullSecrets
nodeName
affinity
tolerations
```

---

### F2. Check Init Containers

```bash
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.status.initContainerStatuses[*]}'
```

If an init container is failing, investigate it separately.

---

### F3. Check recent events

```bash
kubectl get events -A \
  --sort-by='.lastTimestamp' | tail -100
```

Look for events on the same node.

---

### F4. Check whether multiple Pods are affected

```bash
kubectl get pods -A -o wide | grep <node-name>
```

### Decision

```text
Only one Pod affected
        ↓
Investigate Pod specification

Multiple Pods on same node
        ↓
Investigate node/kubelet/runtime/network/storage

Pods across multiple nodes
        ↓
Investigate cluster-wide component
```

---

# 5. Check Deployment / ReplicaSet

If the Pod belongs to a Deployment:

```bash
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.metadata.ownerReferences[*].name}'
```

Check Deployment:

```bash
kubectl get deployment -n <namespace>
```

```bash
kubectl describe deployment <deployment-name> -n <namespace>
```

Check ReplicaSet:

```bash
kubectl get rs -n <namespace>
```

---

# 6. Check Whether a Recent Deployment Caused the Problem

Check rollout:

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

Check rollout history:

```bash
kubectl rollout history deployment/<deployment-name> \
  -n <namespace>
```

Check recent ReplicaSets:

```bash
kubectl get rs -n <namespace> \
  --sort-by='.metadata.creationTimestamp'
```

If the issue started immediately after a deployment, compare:

```text
Old ReplicaSet
        vs
New ReplicaSet
```

Check:

* Image
* Environment variables
* Secrets
* ConfigMaps
* Volumes
* ServiceAccount
* SecurityContext
* Resource configuration

---

# 7. Emergency Rollback

Only perform rollback when the new deployment is confirmed to be the cause and application impact requires it.

```bash
kubectl rollout undo deployment/<deployment-name> \
  -n <namespace>
```

Monitor:

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

Then:

```bash
kubectl get pods -n <namespace> -o wide
```

---

# 8. Verify Recovery

Do not close the incident merely because the Pod changes from `ContainerCreating`.

Run:

### Pod

```bash
kubectl get pod <pod-name> -n <namespace> -o wide
```

Expected:

```text
STATUS: Running
```

### Pod readiness

```bash
kubectl get pod <pod-name> -n <namespace>
```

Expected:

```text
READY: 1/1
```

or the expected number of containers.

### Pod events

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Confirm no continuing:

```text
Warning
FailedMount
FailedCreatePodSandbox
Failed
```

### Application logs

```bash
kubectl logs <pod-name> -n <namespace>
```

For multiple containers:

```bash
kubectl logs <pod-name> -n <namespace> -c <container-name>
```

### Service endpoints

```bash
kubectl get endpoints <service-name> -n <namespace>
```

or:

```bash
kubectl get endpointslices -n <namespace>
```

Confirm the healthy Pod is available to the Service.

### Deployment

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

Expected:

```text
successfully rolled out
```

### Application test

Perform the approved application health check:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

---

# 9. Recovery Criteria

The incident can be considered resolved when:

* [ ] Pod is `Running`
* [ ] Pod is `Ready`
* [ ] No new Pod startup errors
* [ ] Deployment rollout is complete
* [ ] Application health check succeeds
* [ ] Service has healthy endpoints
* [ ] Node is `Ready`
* [ ] No `DiskPressure`
* [ ] No `MemoryPressure`
* [ ] No continuing kubelet/container-runtime errors
* [ ] Application error rate has returned to normal

---

# 10. Escalation

Escalate to the Kubernetes/SRE owner when:

* Multiple nodes are affected.
* CNI is failing cluster-wide.
* CSI/storage infrastructure is failing.
* Container runtime repeatedly crashes.
* Node cannot return to `Ready`.
* Pods continue failing after node remediation.
* Production availability is affected.
* Data/storage integrity is uncertain.
* Cluster control-plane components appear unhealthy.

Escalate to the application owner when:

* The issue is isolated to one workload.
* A new application deployment introduced the failure.
* Application configuration/Secret/ConfigMap is incorrect.
* Application image is invalid.
* Application startup configuration is failing.

---

# 11. Do NOT Do These Things

### ❌ Don't immediately delete the Pod

First determine why it is stuck.

```text
describe → events → identify cause → fix → recreate
```

### ❌ Don't restart the whole node immediately

First determine whether the problem is:

```text
Pod
Volume
Network
Node
Kubelet
Container runtime
```

### ❌ Don't restart CNI across the entire cluster

A cluster-wide networking restart can turn a single-Pod incident into a cluster-wide outage.

### ❌ Don't blindly delete files from `/var/lib`

Especially:

```text
/var/lib/kubelet
/var/lib/containerd
```

### ❌ Don't drain a production node without checking capacity

Before draining:

```text
Replica count
PodDisruptionBudget
Available nodes
Critical workloads
Cluster autoscaler
```

---

# 12. Quick Reference

```bash
# Find stuck Pods
kubectl get pods -A -o wide | grep ContainerCreating

# Describe Pod
kubectl describe pod <pod> -n <namespace>

# Check events
kubectl get events -n <namespace> --sort-by='.lastTimestamp'

# Check node
kubectl describe node <node>

# Check node status
kubectl get node <node>

# Check kubelet
systemctl status kubelet

# Check kubelet logs
journalctl -u kubelet --since "30 minutes ago"

# Check containerd
systemctl status containerd

# Check containerd logs
journalctl -u containerd --since "30 minutes ago"

# Check PVC
kubectl get pvc -n <namespace>

# Check PV
kubectl get pv

# Check StorageClass
kubectl get storageclass

# Check CNI
kubectl get pods -n kube-system -o wide

# Check disk
df -h
df -i

# Check Deployment
kubectl describe deployment <deployment> -n <namespace>

# Check rollout
kubectl rollout status deployment/<deployment> -n <namespace>

# Roll back
kubectl rollout undo deployment/<deployment> -n <namespace>

# Recreate Pod
kubectl delete pod <pod> -n <namespace>
```

---

# 13. Incident Evidence to Collect

Before making destructive changes, collect:

```text
Cluster:
Namespace:
Pod:
Deployment:
ReplicaSet:
Node:
Pod age:
Container image:
Pod events:
Node conditions:
Kubelet logs:
Container runtime logs:
CNI status:
PVC/PV:
Disk usage:
Recent deployment:
Recent infrastructure change:
Application impact:
```

Useful commands:

```bash
kubectl get pod <pod> -n <namespace> -o yaml > pod.yaml

kubectl describe pod <pod> -n <namespace> > pod-describe.txt

kubectl describe node <node> > node-describe.txt

kubectl get events -A --sort-by='.lastTimestamp' > cluster-events.txt
```

---

# 14. Root Cause Classification

After recovery, classify the incident as one of:

```text
[ ] Volume / Storage
[ ] Container Image / Registry
[ ] CNI / Network
[ ] DNS
[ ] Node Disk
[ ] Node Memory
[ ] Kubelet
[ ] Container Runtime
[ ] Application Configuration
[ ] Secret / ConfigMap
[ ] ServiceAccount / RBAC
[ ] SecurityContext
[ ] Recent Deployment
[ ] Kubernetes Cluster Component
[ ] Unknown
```

---

# 15. Post-Incident Actions

* [ ] Document the root cause.
* [ ] Record the affected node and workload.
* [ ] Record the Kubernetes events.
* [ ] Record the remediation.
* [ ] Determine whether another Pod/node could be affected.
* [ ] Create monitoring/alerting if the failure was not detected automatically.
* [ ] Update this runbook if a new failure mode was discovered.
* [ ] Automate repetitive diagnostic steps where appropriate.
* [ ] Create a separate runbook if the root cause represents a recurring incident.

---

## Golden Rule

```text
ContainerCreating
       ↓
DON'T GUESS
       ↓
kubectl describe pod
       ↓
CHECK EVENTS
       ↓
IDENTIFY FAILURE DOMAIN
       ↓
Pod / Storage / Image / Network / Node
       ↓
FIX THE ROOT CAUSE
       ↓
VERIFY POD
       ↓
VERIFY SERVICE
       ↓
VERIFY APPLICATION
```

**Runbook principle:** `ContainerCreating` is the symptom. **Pod events identify the failure domain.**
