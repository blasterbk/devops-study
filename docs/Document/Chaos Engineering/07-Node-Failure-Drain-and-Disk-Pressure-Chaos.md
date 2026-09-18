# Kubernetes Chaos Scenario 07: Node Failure, Drain & Disk Pressure Chaos

**Domain:** Infrastructure, Node Lifecycle, Kubelet Eviction & Pod Rescheduling  
**Chaos Type:** Node Crash (VM Stop), Node Drain, Node DiskPressure Taint  
**Target:** Kubernetes Worker Nodes, Kubelet Eviction Manager  
**Tools:** Chaos Mesh, `kubectl drain`, `fallocate`, cloud provider CLI

---

## 1. Experiment Overview

Worker nodes crash unexpectedly when physical host hardware fails, spot instances are reclaimed by cloud providers, host kernels panic, or host filesystems run out of space. Kubernetes must detect the failure, mark the node `NotReady`, and reschedule affected pods to healthy nodes while respecting PodDisruptionBudgets.

The primary experiment tests **Sudden Node Crash & Pod Rescheduling**.

A separate optional experiment tests **Node DiskPressure Taint & Kubelet Eviction Manager**.

> **Important:** When a node becomes `NotReady`, the default `--pod-eviction-timeout` is 5 minutes. During this 5-minute window, pods on the failed node are still "Running" in the API but completely unresponsive. Applications without proper health checks and load balancer integration will route traffic to dead pods.

### Experiment A — Sudden Node Failure

```text
Worker node VM stopped (power off / cloud instance termination)
    ↓
Kubelet stops sending heartbeats to API Server
    ↓
Node Controller marks node NotReady after 40s (node-monitor-grace-period)
    ↓
Taint: node.kubernetes.io/not-ready:NoExecute applied
    ↓
Pods with tolerationSeconds=30 evicted after 30s
    ↓
Pods without tolerations evicted after 300s (default)
    ↓
ReplicaSet/Deployment controller creates replacement pods
    ↓
Scheduler places pods on healthy nodes
    ↓
Service endpoints updated → traffic routes to new pods
```

### Experiment B — Node DiskPressure Eviction

```text
Host filesystem fills to > 90% (above kubelet eviction threshold)
    ↓
Kubelet detects DiskPressure condition
    ↓
Node tainted: node.kubernetes.io/disk-pressure:NoSchedule
    ↓
Kubelet evicts BestEffort pods first, then Burstable
    ↓
Guaranteed QoS pods are evicted last
    ↓
Evicted pods rescheduled to nodes with sufficient disk
```

---

## 2. Steady-State Hypothesis

> **When a worker node running 20% of application pods experiences a sudden VM termination, the control plane will mark the node `NotReady` within 40 seconds, affected stateless pods will be rescheduled on healthy nodes within 5 minutes, PodDisruptionBudgets will be respected (minimum 60% availability maintained), and the Ingress controller will stop routing traffic to dead pod IPs within 30 seconds.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Node Detection | Node marked `NotReady` within 40 seconds |
| Pod Rescheduling | Replacement pods `Running` on healthy nodes within 5 minutes |
| PDB Adherence | Minimum available percentage never breached |
| Service Continuity | HTTP 5xx rate $< 0.5\%$ during rescheduling |
| Ingress Update | Dead pod IPs removed from endpoints within 30s |
| StatefulSet Safety | PVCs not accidentally deleted; data preserved |

---

## 3. Failure Mechanism Architecture

```text
               Node Failure Detection & Pod Rescheduling Timeline

┌─────────────────────────────────────────────────────────────┐
│  T = 0s:   Node VM stopped / kernel panic / spot reclaimed  │
│  T = 0-40s: Kubelet stops heartbeating to API Server        │
│                         ↓                                   │
│  T = 40s:  Node Controller marks node NotReady              │
│            Taint: node.kubernetes.io/not-ready:NoExecute    │
│                         ↓                                   │
│  T = 40-70s: Pods with tolerationSeconds=30 evicted         │
│              EndpointSlice removes pod IPs                   │
│              Ingress stops routing to dead pods              │
│                         ↓                                   │
│  T = 70s-5m: Deployment/ReplicaSet creates replacement pods │
│              Scheduler finds healthy node with capacity      │
│              New pods start, pass readiness probes           │
│              EndpointSlice adds new pod IPs                  │
│                         ↓                                   │
│  T = 5m:   All replacement pods Running and Ready ✅        │
│            Service fully restored on healthy nodes          │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

### Verify node count and distribution

```bash
kubectl get nodes -o wide
kubectl get nodes -L topology.kubernetes.io/zone
```

### Verify pod distribution across nodes

```bash
kubectl get pods -n production -o wide
```

### Verify PDB configuration

```bash
kubectl get pdb -n production
```

### Verify sufficient capacity on remaining nodes

```bash
kubectl describe nodes | grep -A 5 "Allocated resources:"
```

---

# 5. Step 1 — Record Baseline

### Node status

```bash
kubectl get nodes
```

### Pod distribution

```bash
kubectl get pods -n production -o wide --sort-by='{.spec.nodeName}'
```

### Application health

```bash
curl -s https://api.example.com/health | jq .
```

### Count pods per node

```bash
kubectl get pods -n production -o json | jq -r '.items[].spec.nodeName' | sort | uniq -c | sort -rn
```

---

# 6. Step 2 — Inject Node Failure

### Option A: Cloud Provider VM Stop

```bash
# AWS:
aws ec2 stop-instances --instance-ids i-0123456789abcdef0

# Linode:
linode-cli linodes shutdown <linode-id>

# GCP:
gcloud compute instances stop <instance-name> --zone <zone>
```

### Option B: Chaos Mesh PhysicalMachineChaos

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: PhysicalMachineChaos
metadata:
  name: node-crash-simulation
  namespace: chaos-testing
spec:
  action: vm-stop
  address:
    - http://<chaosd-agent-ip>:31767
  duration: "5m"
```

### Option C: kubectl Cordon + Drain (Graceful)

```bash
kubectl cordon <node-name>
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data --force --grace-period=0
```

---

# 7. Step 3 — Monitor Node Status & Pod Rescheduling

### Watch node conditions

```bash
kubectl get nodes -w
```

### Watch pod rescheduling events

```bash
kubectl get pods -n production -o wide -w
```

### Watch events

```bash
kubectl get events -n production --sort-by='.lastTimestamp' -w
```

### Check PDB status during eviction

```bash
kubectl get pdb -n production
```
*Verify `ALLOWED DISRUPTIONS` column does not show violation.*

### Monitor application availability during rescheduling

```bash
for i in $(seq 1 60); do
  STATUS=$(curl -o /dev/null -s -w "%{http_code}" https://api.example.com/health)
  echo "[T+${i}s] HTTP Status: $STATUS"
  sleep 5
done
```

---

# 8. Step 4 — Inject DiskPressure (Optional Experiment B)

On the target worker node:

```bash
# Fill the node's root filesystem to trigger kubelet DiskPressure
FREE_MB=$(df -m / | awk 'NR==2 {print $4}')
FILL_MB=$((FREE_MB - 500))  # Leave only 500MB (below eviction threshold)
sudo fallocate -l "${FILL_MB}M" /tmp/chaos_disk_pressure.img
```

Watch for DiskPressure condition:

```bash
kubectl describe node <node-name> | grep DiskPressure
```

Watch for pod evictions:

```bash
kubectl get events -n production | grep -i evict
```

---

# 9. Abort Conditions

```text
ABORT CONDITIONS

- All application replicas terminated (0 available pods)
- PDB minimum availability breached
- StatefulSet PVC accidentally deleted during eviction
- Replacement pods stuck in Pending for > 10 minutes (insufficient cluster capacity)
- Cluster-wide control plane instability
```

---

# 10. Emergency Stop

### Restart the VM

```bash
# AWS:
aws ec2 start-instances --instance-ids i-0123456789abcdef0

# Linode:
linode-cli linodes boot <linode-id>
```

### Uncordon the node

```bash
kubectl uncordon <node-name>
```

### Remove DiskPressure filler

```bash
sudo rm -f /tmp/chaos_disk_pressure.img
```

---

# 11. Recovery Validation

### Verify node returns to Ready

```bash
kubectl get nodes
```

### Verify all pods Running and Ready

```bash
kubectl get pods -n production
```

### Verify application health

```bash
curl -s https://api.example.com/health | jq .
```

### Verify no orphaned pods or PVCs

```bash
kubectl get pods -n production --field-selector=status.phase=Failed
kubectl get pvc -n production
```

---

# 12. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| 5-minute gap before rescheduling | Default `pod-eviction-timeout` is 300s | Add `tolerations` with `tolerationSeconds: 30` to critical pods |
| All replicas on single node | No pod anti-affinity configured | Add `podAntiAffinity` with `topologyKey: kubernetes.io/hostname` |
| Replacement pods stuck in Pending | Insufficient resources on remaining nodes | Configure Cluster Autoscaler / Karpenter for node provisioning |
| StatefulSet PVC Multi-Attach error | PVC still bound to failed node | Wait for VolumeAttachment cleanup or force-detach |
| BestEffort pods evicted on DiskPressure | No resource requests/limits set | Set resource requests/limits on all pods (Guaranteed QoS) |

---

# 13. Production Hardening

### Pod Anti-Affinity

```yaml
spec:
  affinity:
    podAntiAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchExpressions:
            - key: app
              operator: In
              values:
              - order-api
          topologyKey: kubernetes.io/hostname
```

### Fast Eviction Toleration

```yaml
spec:
  tolerations:
  - key: "node.kubernetes.io/not-ready"
    operator: "Exists"
    effect: "NoExecute"
    tolerationSeconds: 30
  - key: "node.kubernetes.io/unreachable"
    operator: "Exists"
    effect: "NoExecute"
    tolerationSeconds: 30
```

### Topology Spread Constraints

```yaml
spec:
  topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: order-api
```

---

# 14. Experiment Results

| Metric | Baseline | Node Down (0-40s) | Rescheduling (40s-5m) | Recovery |
|---|---:|---:|---:|---:|
| Node Status | Ready | NotReady | NotReady | Ready |
| Running Pods | 10 | 10 (stale) → 8 | 8 → 10 | 10 |
| PDB Violations | 0 | 0 | 0 | 0 |
| HTTP 5xx Rate | 0% | $< 0.5\%$ | $< 0.1\%$ | 0% |
| Endpoint Updates | N/A | Dead IPs removed | New IPs added | Stable |

---

# 15. Final Assessment & Key Technical Takeaways

```text
Node NotReady
    ≠
Instant pod rescheduling (default 5-minute eviction timeout!)

tolerationSeconds: 30
    =
Fast eviction (30s instead of 5 minutes)

Pod Anti-Affinity
    =
Prevents all replicas on a single node

Topology Spread Constraints
    =
Ensures even distribution across nodes/zones

Cluster Autoscaler
    =
Provisions new nodes when Pending pods exist

Successful Node Failure Chaos
    =
Fast detection (< 40s)
    +
PDB-compliant eviction
    +
Clean rescheduling to healthy nodes
    +
Zero data loss for stateful workloads
```
