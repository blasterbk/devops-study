# Kubernetes HPA Not Scaling — Runbook

**Service:** Kubernetes Cluster  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on workload impact

## 1. Trigger

Use this runbook when:

- HPA is not increasing replicas when workload increases.
- HPA shows `0/N` or unexpected metrics.
- `kubectl get hpa` shows `<unknown>` metrics.
- Pods are overloaded but replica count does not increase.
- HPA is stuck at `minReplicas` or `maxReplicas`.

---

## 2. Quick Decision Flow

```text
HPA Not Scaling
      ↓
Check HPA Status
      ↓
Check Metrics
      ↓
Metrics Available?
   ┌──┴──┐
   NO    YES
   ↓      ↓
Check    Check Target
Metrics  / Current Value
Server      ↓
          Check min/max
              ↓
        Check Deployment
              ↓
        Check Cluster Capacity
              ↓
          Fix Root Cause
              ↓
          Verify Scaling
```

---

## 3. Step 1 — Check HPA

```bash
kubectl get hpa -n <namespace>
```

Example:

```text
NAME      REFERENCE          TARGETS    MINPODS   MAXPODS   REPLICAS
my-app    Deployment/my-app  85%/70%    3         10        3
```

Describe:

```bash
kubectl describe hpa <hpa-name> -n <namespace>
```

Check:

```text
Metrics
Min replicas
Max replicas
Current replicas
Desired replicas
Conditions
Events
```

---

## 4. Step 2 — Check HPA Conditions

```bash
kubectl describe hpa <hpa-name> -n <namespace>
```

Look for conditions such as:

```text
AbleToScale
ScalingActive
ScalingLimited
```

Problem examples:

```text
ScalingActive=False
ScalingLimited=True
FailedGetResourceMetric
FailedComputeMetricsReplicas
```

The condition/message usually identifies the next troubleshooting step.

---

## 5. Step 3 — Check Metrics

For CPU/memory HPA:

```bash
kubectl top pods -n <namespace>
```

If this fails:

```text
error: Metrics API not available
```

check Metrics Server:

```bash
kubectl get apiservice | grep metrics
```

```bash
kubectl get pods -A | grep -i metrics-server
```

Check logs:

```bash
kubectl logs -n kube-system   <metrics-server-pod>
```

> If the Metrics API is unavailable, HPA cannot obtain the required resource metrics.

---

## 6. Step 4 — Check HPA Target and Current Value

```bash
kubectl get hpa <hpa-name> -n <namespace>
```

Example:

```text
TARGETS
85%/70%
```

Meaning:

```text
Current: 85%
Target:  70%
```

If current usage is above target, HPA should normally calculate a higher desired replica count, subject to its configured limits and scaling behavior.

If:

```text
<unknown>/70%
```

investigate metrics collection first.

---

## 7. Step 5 — Check HPA Configuration

```bash
kubectl get hpa <hpa-name>   -n <namespace> -o yaml
```

Check:

```yaml
minReplicas:
maxReplicas:
metrics:
behavior:
scaleTargetRef:
```

For CPU utilization, verify the workload has CPU requests configured.

Example:

```yaml
resources:
  requests:
    cpu: "500m"
```

Without the required resource request, CPU utilization-based HPA may not be able to calculate the metric correctly.

---

## 8. Step 6 — Check Target Deployment

```bash
kubectl get deployment <deployment-name>   -n <namespace>
```

Check:

```text
READY
UP-TO-DATE
AVAILABLE
```

Verify the HPA points to the correct workload:

```bash
kubectl get hpa <hpa-name>   -n <namespace> -o jsonpath='{.spec.scaleTargetRef.name}{"
"}'
```

Expected:

```text
<deployment-name>
```

---

## 9. Step 7 — Check Current Pod Usage

```bash
kubectl top pods -n <namespace>
```

For all namespaces:

```bash
kubectl top pods -A --sort-by=cpu
```

Memory:

```bash
kubectl top pods -A --sort-by=memory
```

Compare:

```text
Current resource usage
        VS
HPA target
```

If actual usage is below the configured target, HPA may correctly decide not to scale.

---

## 10. Step 8 — Check minReplicas and maxReplicas

```bash
kubectl get hpa <hpa-name> -n <namespace>
```

If:

```text
Current = minReplicas
```

HPA may be waiting for the metric to exceed the target.

If:

```text
Current = maxReplicas
```

HPA cannot create more replicas.

Example:

```text
MINPODS   MAXPODS   REPLICAS
3         10        10
```

The HPA has reached its configured maximum.

> Do not increase `maxReplicas` without confirming cluster capacity and application behavior.

---

## 11. Step 9 — Check Cluster Capacity

Even if HPA requests more replicas, Pods may remain Pending if the cluster lacks capacity.

```bash
kubectl get nodes
```

Check:

```bash
kubectl top nodes
```

Look for:

```text
High CPU
High memory
NotReady nodes
```

Check Pending Pods:

```bash
kubectl get pods -n <namespace>
```

Describe one:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look for:

```text
Insufficient cpu
Insufficient memory
Taints
Affinity
Node selector
```

Use:

```text
Insufficient-CPU.md
Insufficient-Memory.md
Pod-Pending.md
```

when applicable.

---

## 12. Step 10 — Check HPA Events

```bash
kubectl describe hpa <hpa-name> -n <namespace>
```

Look at:

```text
Events
```

Common problems:

```text
FailedGetResourceMetric
FailedComputeMetricsReplicas
FailedGetExternalMetric
FailedGetObjectMetric
```

These messages help identify whether the problem is:

```text
Metrics
Configuration
External metric provider
Target workload
```

---

## 13. Step 11 — Check Scaling Behavior

If `behavior` is configured:

```bash
kubectl get hpa <hpa-name>   -n <namespace> -o yaml
```

Check:

```yaml
behavior:
  scaleUp:
  scaleDown:
```

Review:

```text
Stabilization window
Policies
SelectPolicy
Scaling limits
```

An intentionally configured scale-up policy can slow how quickly replicas increase.

---

## 14. Step 12 — Check Application Load

HPA only scales according to its configured metrics.

Check:

```text
CPU
Memory
Custom metrics
External metrics
```

For HTTP workloads, high request volume does not automatically cause CPU-based HPA scaling unless that traffic also increases the configured metric.

If the workload needs request-based scaling, verify the custom/external metric configuration.

---

## 15. Step 13 — Check Custom / External Metrics

If the HPA uses custom or external metrics:

```bash
kubectl get hpa <hpa-name>   -n <namespace> -o yaml
```

Identify:

```text
custom metrics
external metrics
metric name
```

Check the relevant metrics adapter/provider according to your environment.

Common examples:

```text
Prometheus Adapter
Cloud metrics adapter
External Metrics API
Custom Metrics API
```

If the provider is unavailable, HPA may not receive the metric.

---

## 16. Step 14 — Fix the Root Cause

### Metrics Unavailable

Fix:

```text
Metrics Server
Custom Metrics API
External Metrics provider
```

### Wrong HPA Target

Fix:

```text
scaleTargetRef
```

### CPU Request Missing

Add an appropriate CPU request:

```yaml
resources:
  requests:
    cpu: "500m"
```

### maxReplicas Too Low

Review:

```text
maxReplicas
Cluster capacity
Application capacity
```

Increase only after approval.

### Cluster Has No Capacity

Fix:

```text
Node capacity
Cluster Autoscaler
Resource requests
Scheduling constraints
```

### Scaling Behavior Too Slow

Review:

```text
behavior.scaleUp
stabilizationWindowSeconds
policies
```

---

## 17. Step 15 — Verify HPA Scaling

Watch:

```bash
kubectl get hpa <hpa-name>   -n <namespace> -w
```

Watch Pods:

```bash
kubectl get pods -n <namespace> -w
```

Check Deployment:

```bash
kubectl get deployment <deployment-name>   -n <namespace> -w
```

Expected:

```text
HPA desired replicas increases
        ↓
Deployment creates Pods
        ↓
Pods become Ready
        ↓
Available replicas increase
```

---

## 18. Step 16 — Verify Application

Check:

```bash
kubectl get pods -n <namespace>
```

Expected:

```text
Running
Ready
```

Check application:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

Verify that increased replicas are actually reducing workload pressure.

---

## 19. Do NOT Do These Things

### ❌ Don't immediately increase maxReplicas

First verify metrics, cluster capacity, and application behavior.

### ❌ Don't assume HPA is broken because replicas do not increase

The current metric may legitimately be below the target.

### ❌ Don't remove resource requests

CPU/memory utilization-based HPA depends on appropriate resource configuration.

### ❌ Don't restart HPA blindly

Fix the metric or configuration problem.

### ❌ Don't scale manually and consider the incident resolved

Manual scaling may hide an HPA configuration or capacity problem.

### ❌ Don't ignore Pending replicas

HPA may have requested more Pods, but the cluster may not have capacity to schedule them.

---

## 20. Quick Reference

```bash
# HPA
kubectl get hpa -n <namespace>
kubectl describe hpa <hpa-name> -n <namespace>

# HPA YAML
kubectl get hpa <hpa-name> -n <namespace> -o yaml

# Metrics
kubectl top pods -n <namespace>
kubectl top nodes

# Metrics API
kubectl get apiservice | grep metrics

# Metrics Server
kubectl get pods -A | grep -i metrics-server

# Deployment
kubectl get deployment <deployment-name> -n <namespace>

# Pods
kubectl get pods -n <namespace>
kubectl describe pod <pod-name> -n <namespace>

# Nodes
kubectl get nodes
kubectl top nodes

# Watch HPA
kubectl get hpa <hpa-name> -n <namespace> -w

# Watch Pods
kubectl get pods -n <namespace> -w

# Watch Deployment
kubectl get deployment <deployment-name> -n <namespace> -w
```

---

## 21. Recovery Criteria

- [ ] HPA configuration verified.
- [ ] `scaleTargetRef` verified.
- [ ] Metrics are available.
- [ ] Current metric is valid.
- [ ] Resource requests are configured correctly.
- [ ] `minReplicas` and `maxReplicas` are appropriate.
- [ ] HPA events checked.
- [ ] Scaling behavior reviewed.
- [ ] Cluster has enough capacity.
- [ ] Desired replicas increase when the configured metric exceeds the target.
- [ ] New Pods are scheduled.
- [ ] New Pods become `Ready`.
- [ ] Application health check succeeds.
- [ ] Workload pressure is reduced.
- [ ] No continuing HPA errors.

---

## 22. Escalation

Escalate to **Kubernetes/SRE** when:

- Metrics API is unavailable.
- HPA reports repeated metric errors.
- HPA configuration appears correct but scaling does not occur.
- Cluster capacity prevents new replicas from scheduling.
- Multiple HPAs are affected.

Escalate to **Application Owner** when:

- Resource requests/limits are incorrect.
- Application does not scale effectively with additional replicas.
- Application has a memory/CPU bottleneck.

Escalate to **Monitoring/Platform Team** when:

- Custom or external metrics are unavailable.
- Prometheus Adapter or external metrics provider is failing.

---

## Golden Rule

```text
HPA Not Scaling
      ↓
CHECK HPA STATUS
      ↓
CHECK METRICS
      ↓
CHECK TARGET + REQUESTS
      ↓
CHECK minReplicas / maxReplicas
      ↓
CHECK DEPLOYMENT
      ↓
CHECK CLUSTER CAPACITY
      ↓
FIX ROOT CAUSE
      ↓
WATCH HPA + PODS
      ↓
VERIFY APPLICATION
```

> **HPA Not Scaling = first verify the metric, then verify HPA configuration, workload resources, and cluster capacity. Do not increase `maxReplicas` blindly.**
