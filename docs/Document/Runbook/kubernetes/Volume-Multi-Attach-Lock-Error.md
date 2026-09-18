# Kubernetes Volume Multi-Attach Error — Runbook

**Service:** Storage & Stateful Workloads  
**Owner:** DevOps / SRE / Storage Admin  
**Severity:** P1 (Stateful Pod stuck in ContainerCreating during failover/restart)  
**Applies to:** ReadWriteOnce (RWO) PVCs, Cloud CSI (AWS EBS, Linode Block Storage, GCE-PD, Ceph RBD, Longhorn)  

**Purpose:** Rapidly diagnose and clear volume attachment deadlocks when a `ReadWriteOnce` volume remains locked to an old/terminated node, preventing the rescheduled pod from starting on a new node.

---

## 1. Trigger & Alert Symptoms

Use this runbook when:
- Pod is stuck in `ContainerCreating` indefinitely during a rolling update, node failure, or pod eviction.
- Pod events display:
  ```text
  Warning  FailedAttachVolume  5m  attachdetach-controller
  Multi-Attach error for volume "pvc-xxxx" Volume is already used by pod(s) on node "node-A"
  ```
- Application pods (MongoDB, PostgreSQL, Elasticsearch, Redis) fail to come online after rescheduling.
- Prometheus alert fires: `KubePersistentVolumeFillingUp` or `VolumeAttachmentHung`.

---

## 2. Quick Decision Flow

```text
         Pod Stuck in ContainerCreating (Multi-Attach Error)
                               │
                               ▼
              Is the Old Node (node-A) Still Online?
                  ├── YES ──► Check Old Pod Status & Force Delete Old Pod
                  │           (Section 4 - Step 1)
                  │
                  └── NO / UNRESPONSIVE (Node NotReady/Crashed)
                       │
                       ▼
              Check VolumeAttachment Object in API Server
                       │
                       ▼
              Is Volume Stuck Attached in Cloud Console / CSI?
                  ├── Detach via VolumeAttachment CRD deletion
                  │   (Section 4 - Step 2)
                  └── Force Cloud Provider Volume Detachment (AWS/Linode/GCP)
                      (Section 5)
```

---

## 3. Step 1 — Confirm & Locate Conflicting Attachments

### 1. Check Pod Events for Volume and Node details
```bash
kubectl describe pod <pod-name> -n <namespace> | grep -A 10 Events:
```
*Note the PVC Name (e.g. `pvc-12345678-abcd`), the Current Node (where the pod wants to run), and the Holding Node (where the volume is currently locked).*

### 2. Identify the VolumeAttachment Object
Kubernetes manages volume-to-node bindings using `VolumeAttachment` resources:
```bash
kubectl get volumeattachments | grep <pv-name-or-volume-id>
```
Example Output:
```text
csi-12345abcdef   linode.csi.linode.com   pvc-987654   node-A   true   25m
```

### 3. Check Old Pod Status on Holding Node
```bash
kubectl get pods -A -o wide --field-selector spec.nodeName=<node-A> | grep <pvc-name>
```

---

## 4. Immediate Remediation Procedures

> ⚠️ **CRITICAL WARNING:** Before force-detaching a `ReadWriteOnce` volume, verify that the application process on the old node is **100% DEAD**. Forcing attachment while two processes write to the same block device will cause filesystem and database corruption!

### Scenario A: Old Pod is stuck in `Terminating` on node-A
If the previous pod did not exit cleanly:
```bash
# Graceful attempt first
kubectl delete pod <old-pod-name> -n <namespace> --timeout=30s

# If stuck, force kill the old pod
kubectl delete pod <old-pod-name> -n <namespace> --grace-period=0 --force
```

---

### Scenario B: Old Node crashed / NotReady and Holding Lock
If node-A is dead or unreachable, the `attachdetach-controller` will wait up to 6 minutes before forcing detach.

1. **Delete the stuck `VolumeAttachment` API object:**
   ```bash
   kubectl delete volumeattachment <volumeattachment-name> --timeout=15s
   ```
2. **If `VolumeAttachment` deletion hangs due to finalizers:**
   ```bash
   kubectl patch volumeattachment <volumeattachment-name> -p '{"metadata":{"finalizers":null}}' --type=merge
   ```

---

## 5. Cloud-Provider / Storage Backend Emergency Detach

If the storage provider CSI driver is out of sync:

### For Linode Block Storage / CSI:
```bash
# 1. Identify volume ID from Linode CLI
linode-cli volumes list --label <volume-label>

# 2. Force detach volume from Linode instance
linode-cli volumes detach <volume-id>
```

### For AWS EBS / AWS CSI Driver:
```bash
# 1. Force detach EBS volume from EC2 instance
aws ec2 detach-volume --volume-id <vol-id> --force

# 2. Wait until status is 'available'
aws ec2 describe-volumes --volume-ids <vol-id> --query "Volumes[0].State"
```

### Restart CSI Node DaemonSet on the Target Node:
```bash
# For Linode CSI:
kubectl rollout restart daemonset csi-linode-node -n kube-system

# For AWS EBS CSI:
kubectl rollout restart daemonset ebs-csi-node -n kube-system
```

---

## 6. Restart the Stuck Target Pod

Once the volume is detached:
```bash
# Delete the waiting pod to force kubelet on the new node to re-trigger attach and mount
kubectl delete pod <new-pod-name> -n <namespace>
```

Verify successful startup:
```bash
kubectl get pod <new-pod-name> -n <namespace> -w
```
*Expected: Transition from `ContainerCreating` to `Running` in under 30 seconds.*

---

## 7. Prevention & Hardening

1. **Configure CSI Driver VolumeAttachment timeouts:**
   Ensure CSI controller deployment has realistic `--timeout` parameters for detach calls.
2. **Implement Non-Graceful Node Shutdown handling (Kubernetes 1.28+):**
   If a node becomes permanently `NotReady`, mark it out-of-service to allow automated volume detachment:
   ```bash
   kubectl taint nodes <failed-node-name> node.kubernetes.io/out-of-service=nodeshutdown:NoExecute
   ```
3. **Use StatefulSet with Pod Management Policy:**
   Ensure StatefulSets have appropriate disruption budgets and readiness probes.
