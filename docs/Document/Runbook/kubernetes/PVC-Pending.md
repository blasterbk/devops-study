# Kubernetes PVC Pending — Runbook

**Service:** Kubernetes Cluster  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on workload impact

## 1. Trigger

Use this runbook when:

- PVC status shows `Pending`.
- Pod cannot start because its PVC is not bound.
- Storage provisioning is failing.
- A StatefulSet Pod remains stuck waiting for storage.

---

## 2. Quick Decision Flow

```text
PVC Pending
    ↓
Check PVC
    ↓
Check Events
    ↓
Check StorageClass
    ↓
Check Provisioner
    ↓
Check PV
    ↓
Check Capacity / Access Mode
    ↓
Fix Root Cause
    ↓
Verify PVC Bound
    ↓
Verify Pod
```

---

## 3. Step 1 — Confirm PVC Is Pending

```bash
kubectl get pvc -n <namespace>
```

Example:

```text
NAME        STATUS    VOLUME   CAPACITY
data-pvc    Pending
```

Get details:

```bash
kubectl describe pvc <pvc-name> -n <namespace>
```

Check:

```text
Status
StorageClass
Requested storage
Access Modes
Volume
Events
```

---

## 4. Step 2 — Check PVC Events

```bash
kubectl describe pvc <pvc-name> -n <namespace>
```

Look at the bottom:

```text
Events:
```

Common messages:

```text
no persistent volumes available
waiting for first consumer
failed to provision volume
storageclass not found
provisioner unavailable
insufficient capacity
access mode not supported
```

The event message usually identifies the next troubleshooting step.

---

## 5. Step 3 — Check StorageClass

```bash
kubectl get storageclass
```

Check the PVC:

```bash
kubectl get pvc <pvc-name>   -n <namespace>   -o yaml
```

Look for:

```yaml
spec:
  storageClassName: <storage-class>
```

Verify it exists:

```bash
kubectl get storageclass <storage-class>
```

If the StorageClass does not exist, fix the PVC or create/use the approved StorageClass.

---

## 6. Step 4 — Check the Storage Provisioner

Inspect the StorageClass:

```bash
kubectl describe storageclass <storage-class>
```

Check:

```text
Provisioner
VolumeBindingMode
Parameters
ReclaimPolicy
```

Identify the provisioner:

```bash
kubectl get storageclass <storage-class>   -o jsonpath='{.provisioner}{"
"}'
```

Check the provisioner's Pods according to your cluster/storage platform.

For example:

```bash
kubectl get pods -A | grep -Ei 'csi|provisioner|storage'
```

Look for:

```text
CrashLoopBackOff
Pending
ContainerCreating
NotReady
```

Check provisioner logs where applicable:

```bash
kubectl logs <provisioner-pod> -n <namespace>
```

---

## 7. Step 5 — Check Existing PVs

If the cluster uses pre-created PersistentVolumes:

```bash
kubectl get pv
```

Check:

```text
STATUS
CAPACITY
ACCESS MODES
STORAGECLASS
CLAIM
```

Possible states:

```text
Available
Bound
Released
Failed
```

Describe a candidate PV:

```bash
kubectl describe pv <pv-name>
```

---

## 8. Step 6 — Check PVC Requirements

```bash
kubectl get pvc <pvc-name>   -n <namespace> -o yaml
```

Review:

```yaml
resources:
  requests:
    storage: 100Gi

accessModes:
  - ReadWriteOnce
```

Check:

```text
Requested capacity
Access mode
StorageClass
Volume mode
Selector
```

A PVC can remain Pending if no compatible storage can satisfy these requirements.

---

## 9. Step 7 — Check Capacity

Check PV capacity:

```bash
kubectl get pv
```

For dynamically provisioned storage, check the underlying storage platform according to your environment.

Possible issue:

```text
PVC requests: 500Gi
Available storage: 100Gi
```

Do not reduce the PVC request blindly. Confirm the application's storage requirement first.

---

## 10. Step 8 — Check VolumeBindingMode

```bash
kubectl describe storageclass <storage-class>
```

Check:

```text
VolumeBindingMode
```

Common values:

```text
Immediate
WaitForFirstConsumer
```

With:

```text
WaitForFirstConsumer
```

the volume may not be provisioned/bound until a consuming Pod is scheduled.

If the PVC is used by a Pod, check:

```bash
kubectl get pod <pod-name> -n <namespace>
kubectl describe pod <pod-name> -n <namespace>
```

Look for:

```text
FailedScheduling
node selector
affinity
taint/toleration
topology
```

---

## 11. Step 9 — Check Pod Using the PVC

Find Pods:

```bash
kubectl get pods -n <namespace>
```

Describe the Pod:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look for:

```text
FailedMount
FailedAttachVolume
FailedScheduling
persistentvolumeclaim is not bound
```

If the Pod is Pending because of the PVC, continue with this runbook.

If the PVC is already Bound but the Pod cannot mount it, use:

```text
Volume-Mount-Failure.md
```

or:

```text
Volume-Attach-Failure.md
```

---

## 12. Step 10 — Check Namespace and Name

Verify the PVC is in the same namespace as the Pod:

```bash
kubectl get pvc -n <namespace>
kubectl get pod <pod-name> -n <namespace>
```

A PVC cannot normally be referenced by a Pod in another namespace.

Check the workload:

```bash
kubectl get deployment <deployment-name>   -n <namespace> -o yaml
```

or:

```bash
kubectl get statefulset <statefulset-name>   -n <namespace> -o yaml
```

Verify the `claimName`.

---

## 13. Step 11 — Fix the Root Cause

### StorageClass Missing

Fix:

```text
PVC storageClassName
or
approved StorageClass
```

### Provisioner Failure

Fix:

```text
CSI/provisioner Pod
Controller
Credentials
Storage backend
```

### No Compatible PV

Fix:

```text
Create/provision suitable PV
or
use dynamic provisioning
```

### Insufficient Capacity

Fix:

```text
Increase storage capacity
Use another storage pool
Use an appropriate StorageClass
```

### Access Mode Not Supported

Fix:

```text
Use an access mode supported by the storage backend
```

### WaitForFirstConsumer

Check:

```text
Pod scheduling
Node affinity
Taints/tolerations
Storage topology
```

---

## 14. Step 12 — Verify PVC Is Bound

```bash
kubectl get pvc <pvc-name> -n <namespace>
```

Expected:

```text
NAME        STATUS   VOLUME
data-pvc    Bound    pvc-xxxxxxxx
```

Check:

```bash
kubectl describe pvc <pvc-name> -n <namespace>
```

Confirm:

```text
Status: Bound
Volume: <pv-name>
```

---

## 15. Step 13 — Verify PV

```bash
kubectl get pv <pv-name>
```

Expected:

```text
STATUS   Bound
```

Check:

```bash
kubectl describe pv <pv-name>
```

Confirm it is bound to the expected claim.

---

## 16. Step 14 — Verify Pod

```bash
kubectl get pods -n <namespace>
```

Expected:

```text
Running
Ready
```

If the Pod remains Pending:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Check for:

```text
FailedScheduling
FailedMount
FailedAttachVolume
```

---

## 17. Step 15 — Verify Application

Check logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Check application health:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

Verify that the application can read/write the mounted storage where required.

---

## 18. Do NOT Do These Things

### ❌ Don't delete the PVC blindly

A PVC may contain important application data.

### ❌ Don't delete the PV blindly

You may cause permanent data loss depending on the storage and reclaim policy.

### ❌ Don't change the StorageClass blindly

This can change storage behavior or data location.

### ❌ Don't recreate a production PVC without checking the data

Confirm backups and data requirements first.

### ❌ Don't assume Pending means Kubernetes is broken

Check the PVC events first.

### ❌ Don't force-bind an incompatible PV

Capacity, access mode, StorageClass, selectors, and topology must be compatible.

---

## 19. Quick Reference

```bash
# PVC
kubectl get pvc -n <namespace>
kubectl describe pvc <pvc-name> -n <namespace>

# PVC YAML
kubectl get pvc <pvc-name> -n <namespace> -o yaml

# StorageClass
kubectl get storageclass
kubectl describe storageclass <storage-class>

# Provisioner
kubectl get pods -A | grep -Ei 'csi|provisioner|storage'

# PV
kubectl get pv
kubectl describe pv <pv-name>

# Pod
kubectl get pods -n <namespace>
kubectl describe pod <pod-name> -n <namespace>

# Events
kubectl get events -n <namespace> --sort-by=.lastTimestamp

# Deployment
kubectl get deployment <deployment-name> -n <namespace>

# StatefulSet
kubectl get statefulset <statefulset-name> -n <namespace>
```

---

## 20. Recovery Criteria

- [ ] PVC `Pending` state confirmed.
- [ ] PVC events reviewed.
- [ ] StorageClass verified.
- [ ] Storage provisioner verified.
- [ ] PV availability checked.
- [ ] Capacity requirement checked.
- [ ] Access mode checked.
- [ ] Volume binding mode checked.
- [ ] Pod scheduling checked.
- [ ] Storage topology checked where applicable.
- [ ] Root cause fixed.
- [ ] PVC is `Bound`.
- [ ] PV is `Bound`.
- [ ] Pod is `Running`.
- [ ] Pod is `Ready`.
- [ ] Volume is mounted successfully.
- [ ] Application health check succeeds.
- [ ] Data integrity verified where applicable.

---

## 21. Escalation

Escalate to **Kubernetes/SRE** when:

- PVC remains Pending after configuration is verified.
- CSI/provisioner is failing.
- Multiple PVCs are affected.
- Storage controllers are unhealthy.

Escalate to **Infrastructure/Storage Team** when:

- Storage backend is unavailable.
- Storage capacity is exhausted.
- Storage platform/API is failing.
- Volume provisioning is failing outside Kubernetes.

Escalate to **Application Owner** when:

- Storage requirements are incorrect.
- Application requires a different access mode/capacity.
- Existing data must be preserved or migrated.

---

## Golden Rule

```text
PVC Pending
    ↓
CHECK PVC EVENTS
    ↓
CHECK STORAGECLASS
    ↓
CHECK PROVISIONER
    ↓
CHECK PV / CAPACITY / ACCESS MODE
    ↓
CHECK POD SCHEDULING
    ↓
FIX ROOT CAUSE
    ↓
VERIFY PVC Bound
    ↓
VERIFY POD
    ↓
VERIFY APPLICATION
```

> **PVC Pending = start with `kubectl describe pvc` and its Events. Do not delete the PVC/PV until you understand the storage and data implications.**
