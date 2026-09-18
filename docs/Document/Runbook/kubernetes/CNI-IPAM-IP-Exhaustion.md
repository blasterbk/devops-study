# Kubernetes CNI & IPAM IP Address Exhaustion — Runbook

**Service:** Kubernetes Networking / CNI  
**Owner:** DevOps / SRE / Network Engineers  
**Severity:** P1 (Pods failing to start across nodes due to IP shortage)  
**Applies to:** Calico, Cilium, AWS VPC CNI, Flannel, Linode CNI  

**Purpose:** Rapidly diagnose, mitigate, and resolve IP exhaustion in Kubernetes pod CIDRs, clear orphaned IP leases, and expand IP pools without cluster downtime.

---

## 1. Trigger & Alert Symptoms

Use this runbook when:
- Pods are stuck in `ContainerCreating` with CNI allocation errors.
- Kubelet event logs display:
  ```text
  Warning  FailedCreatePodSandBox  3m  kubelet  
  Failed to create pod sandbox: rpc error: code = Unknown desc = failed to setup network for sandbox: 
  failed to allocate for range 0: no IP addresses available in range set: 10.244.0.0-10.244.255.255
  ```
- AWS VPC CNI reports `ENI limit reached` or `failed to assign private IP to ENI`.
- Calico IPAM reports `calico/ipam/ipam.go: no free IP addresses`.
- Autoscaling or rolling deployments stall because newly scheduled pods cannot acquire an IP address.

---

## 2. Quick Decision Flow

```text
               CNI / IPAM IP Allocation Failure
                                │
                                ▼
            Identify CNI Provider in the Cluster
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
     Calico                  Cilium                 AWS VPC CNI
        │                       │                       │
        ▼                       ▼                       ▼
Check Calico IPPool     Check CiliumNode        Check Subnet / ENI
& IPAM Block Leaks      IPAM Allocation         Secondary IP Limits
(Section 4)             (Section 5)             (Section 6)
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                ▼
           Clean Leaked IPs / Add Additional IPPool CIDR
                                │
                                ▼
               Verify Pod Scheduling & IP Assignment
```

---

## 3. Step 1 — Confirm Cluster-Wide IP Exhaustion

### 1. Identify Stuck Pods
```bash
kubectl get pods -A --field-selector status.phase=Pending -o wide | grep -i "ContainerCreating\|Pending"
```

### 2. Inspect Failing Pod Network Sandbox Events
```bash
kubectl describe pod <stuck-pod-name> -n <namespace> | grep -A 10 "FailedCreatePodSandBox"
```

---

## 4. Remediation: Project Calico IPAM Exhaustion

### 1. Check Calico IPPool Status & Usage
```bash
# Using calicoctl
calicoctl ipam show --show-blocks

# Using kubectl
kubectl get ippools.crd.projectcalico.org -o wide
kubectl get blockaffinities.crd.projectcalico.org
```

### 2. Clean Leaked / Orphaned Calico IP Allocations
When pods are deleted abruptly or nodes crash, Calico IPAM blocks may retain orphaned allocations:
```bash
# Check for leaked IP allocations not bound to existing pods
calicoctl ipam check

# Release leaked IP allocations safely
calicoctl ipam release --all --dry-run
calicoctl ipam release --all
```

### 3. Add an Additional IP Pool (Zero Downtime)
If the existing CIDR (e.g. `10.244.0.0/16`) is genuinely full:
```yaml
cat <<EOF | kubectl apply -f -
apiVersion: projectcalico.org/v3
kind: IPPool
metadata:
  name: extra-ipv4-ippool
spec:
  cidr: 10.245.0.0/16
  ipipMode: Always
  natOutgoing: true
  disabled: false
  nodeSelector: all()
EOF
```

---

## 5. Remediation: Cilium IPAM Exhaustion

### 1. Check Cilium IPAM Allocations per Node
```bash
cilium status --verbose | grep -A 15 "IPAM"
kubectl get ciliumnodes -o custom-columns='NAME:.metadata.name,AVAILABLE:.status.ipam.available,USED:.status.ipam.used'
```

### 2. Force Cilium IPAM GC (Garbage Collection)
If unused IPs are not being reclaimed by Cilium:
```bash
# Trigger node-level IPAM refresh by restarting Cilium agent on affected node
kubectl delete pod -n kube-system -l k8s-app=cilium --field-selector spec.nodeName=<affected-node>
```

---

## 6. Remediation: AWS VPC CNI (EKS) IP Exhaustion

### Root Causes in AWS EKS:
- Subnet CIDR has run out of private IPv4 addresses.
- EC2 instance type max ENI limit reached (`max-pods` limit).

### 1. Check Subnet Free IPs in AWS CLI:
```bash
aws ec2 describe-subnets --subnet-ids <subnet-id> --query "Subnets[*].[SubnetId,AvailableIpAddressCount]"
```

### 2. Enable Prefix Delegation (4x IP Capacity per Node):
Prefix Delegation allows each ENI slot to allocate a `/28` IPv4 subnet (16 IPs) instead of 1 individual secondary IP:
```bash
kubectl set env daemonset aws-node -n kube-system ENABLE_PREFIX_DELEGATION=true
kubectl set env daemonset aws-node -n kube-system WARM_PREFIX_TARGET=1
```

### 3. Attach Secondary VPC CIDR:
If the entire VPC/Subnet is out of IPs, associate a secondary CIDR block (e.g. `100.64.0.0/16` CGNAT) in AWS VPC and add custom networking to EKS.

---

## 7. Verification & Health Checks

1. **Verify Sandbox Creation for Blocked Pods:**
   ```bash
   kubectl delete pod <stuck-pod-name> -n <namespace>
   kubectl get pod <stuck-pod-name> -n <namespace> -w
   ```
2. **Confirm Pod IP Assignment:**
   ```bash
   kubectl get pods -A -o custom-columns='NAME:.metadata.name,NAMESPACE:.metadata.namespace,IP:.status.podIP,NODE:.spec.nodeName'
   ```
3. **Prometheus Alert for IPAM Utilization:**
   ```yaml
   - alert: CalicoIPAMPoolUtilizationHigh
     expr: (calico_ipam_ips_allocated / calico_ipam_ips_capacity) * 100 > 85
     for: 15m
     labels:
       severity: warning
     annotations:
       summary: "Calico IPAM IP pool is {{ $value }}% full"
   ```
