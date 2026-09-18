# Kubernetes Cluster Autoscaler & Karpenter Scaling Failure — Runbook

**Service:** Cluster Autoscaling (Cluster Autoscaler / Karpenter)  
**Owner:** DevOps / SRE / Platform Team  
**Severity:** P1–P2 (Workloads pending due to inability to provision worker nodes)  
**Applies to:** Kubernetes Cluster Autoscaler, Karpenter (AWS, Linode, GCP, Azure)  

**Purpose:** Rapidly diagnose and resolve node autoscaling failures when pending pods cannot trigger node scale-up, or when nodes cannot scale down due to unevictable pods or PodDisruptionBudgets.

---

## 1. Trigger & Alert Symptoms

Use this runbook when:
- Pods remain in `Pending` with `0/N nodes available: Insufficient cpu/memory` for $> 5$ minutes.
- Cluster Autoscaler status reports `ScaleUpFailed` or `NotTriggeredScaleUp`.
- Karpenter events report `NodeClaimFailed` or `InsufficientInstanceCapacity`.
- Prometheus alerts trigger: `ClusterAutoscalerScaleUpFailed` or `KarpenterNodePoolDisrupted`.
- Nodes fail to scale down despite low cluster utilization.

---

## 2. Quick Decision Flow

```text
               Autoscaling Failure
                        │
                        ▼
      Is the Issue Scale-Up or Scale-Down?
            ├── SCALE-UP (Pods Pending)
            │      │
            │      ▼
            │   Check Cluster Autoscaler / Karpenter Logs
            │      ├── Cloud Quota / Capacity Exceeded ──► (Section 4)
            │      ├── ASG / NodePool Max Size Reached ──► (Section 5)
            │      └── Unschedulable Tolerations/Taints ──► (Section 6)
            │
            └── SCALE-DOWN (Nodes Stuck / Cost High)
                   │
                   ▼
                Check Blocking Pods (PDB / No-Evict)
                (Section 7)
```

---

## 3. Step 1 — Inspect Autoscaler Status & Logs

### For Standard Cluster Autoscaler:
```bash
# 1. Check Status ConfigMap in kube-system
kubectl describe configmap cluster-autoscaler-status -n kube-system

# 2. Check Autoscaler Controller Logs
kubectl logs -n kube-system -l app=cluster-autoscaler --tail=100 | grep -i "scale_up\|failed\|error"
```

### For Karpenter:
```bash
# 1. Check Karpenter NodePools and NodeClaims
kubectl get nodepools,nodeclaims
kubectl describe nodepool <nodepool-name>

# 2. Check Karpenter Logs
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter --tail=100 | grep -i "error\|failed"
```

---

## 4. Root Cause 1: Cloud Provider Quota & Capacity Exhaustion

### Symptoms:
- AWS: `VcpuLimitExceeded` or `InsufficientInstanceCapacity`.
- GCP: `QUOTA_EXCEEDED (CPUS_ALL_REGIONS)`.
- Linode: `ResourceLimitExceeded` for Linode type.

### Remediation:
1. **Diversify Spot & On-Demand Instance Types (Karpenter NodePool):**
   Avoid locking the autoscaler into a single unavailable instance type (e.g. `t3.medium`). Allow flexible instance families:
   ```yaml
   apiVersion: karpenter.sh/v1beta1
   kind: NodePool
   metadata:
     name: general-compute
   spec:
     template:
       spec:
         requirements:
           - key: "karpenter.k8s.aws/instance-category"
             operator: In
             values: ["c", "m", "r"]
           - key: "karpenter.k8s.aws/instance-generation"
             operator: Gt
             values: ["5"]
           - key: "karpenter.sh/capacity-type"
             operator: In
             values: ["spot", "on-demand"]
   ```
2. **Request Emergency Quota Increase:** In AWS Service Quotas / Linode Support for `Running On-Demand Standard instances`.

---

## 5. Root Cause 2: Autoscaling Group (ASG) Max Size Reached

### Symptom:
`Scale-up: max cluster size reached (max: 20)`.

### Remediation:
1. Identify the matching Auto Scaling Group / Linode NodePool.
2. Edit the node group definition or ASG max count in cloud console/Terraform:
   ```bash
   # In AWS CLI:
   aws autoscaling update-auto-scaling-group --auto-scaling-group-name <asg-name> --max-size 40
   ```

---

## 6. Root Cause 3: Affinity, Taint, or NodeSelector Mismatches

### Symptom:
Autoscaler reports: `pod did not match node selector/taints of any node group`.

### Verification:
Inspect the pending pod's constraints:
```bash
kubectl get pod <pending-pod> -n <namespace> -o yaml | grep -A 10 -E "nodeSelector|tolerations|affinity"
```
Ensure that at least one autoscaling node group provides matching labels and tolerations.

---

## 7. Remediation: Nodes Blocked from Scale-Down

If idle nodes are costing money and refuse to scale down:

### 1. Identify Pods Preventing Node Drainage:
Common blockers for node termination:
- Pods without a controller (bare Pods).
- Pods with local storage (`emptyDir` or `hostPath`).
- Pods protected by `PodDisruptionBudget` (PDB) with `minAvailable` violation.
- Annotations: `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"`.

### 2. Audit PodDisruptionBudgets (PDB):
```bash
kubectl get pdb -A
```
If `ALLOWED DISRUPTIONS` is `0`, the autoscaler is forbidden from evicting pods to terminate the node.

### 3. Allow Safe Eviction for Stateless Pods with Local Storage:
Add the annotation to workloads that use temporary `emptyDir`:
```yaml
metadata:
  annotations:
    cluster-autoscaler.kubernetes.io/safe-to-evict: "true"
```

---

## 8. Post-Incident Hardening

1. **Deploy Overprovisioning / Pause Pods:**
   Run low-priority placeholder pods with `-1` priority to maintain a buffer of warm nodes for instant scheduling:
   ```yaml
   apiVersion: scheduling.k8s.io/v1
   kind: PriorityClass
   metadata:
     name: overprovisioning
   value: -1
   globalDefault: false
   ```
2. **Prometheus Alert for Pending Unschedulable Pods:**
   ```yaml
   - alert: PodsPendingScaleUpStuck
     expr: sum(kube_pod_status_phase{phase="Pending"}) by (namespace) > 5
     for: 10m
     labels:
       severity: warning
     annotations:
       summary: "Namespace {{ $labels.namespace }} has pending pods stuck for >10m"
   ```
