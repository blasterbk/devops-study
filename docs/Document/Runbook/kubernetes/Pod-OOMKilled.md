# Kubernetes Pod OOMKilled — Runbook

**Service:** Kubernetes Cluster  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on workload impact

## 1. Trigger

Use this runbook when:

- Pod shows `OOMKilled`.
- Container repeatedly restarts due to memory usage.
- `kubectl describe pod` shows `Reason: OOMKilled`.
- Application logs show memory-related crashes.
- Pod restart count keeps increasing.

---

## 2. Quick Decision Flow

```text
Pod OOMKilled
      ↓
Check Pod Status
      ↓
Check Container Last State
      ↓
Check Memory Limit
      ↓
Check Memory Usage
      ↓
Check Application Logs
      ↓
Identify Cause
      ↓
Fix Memory / Application / Scaling
      ↓
Redeploy
      ↓
Verify Pod
```

---

## 3. Step 1 — Confirm OOMKilled

```bash
kubectl get pod <pod-name> -n <namespace>
kubectl describe pod <pod-name> -n <namespace>
```

Look for:

```text
Last State:
  Terminated:
    Reason: OOMKilled
```

Check restart count:

```bash
kubectl get pod <pod-name> -n <namespace>
```

---

## 4. Step 2 — Check Container Logs

Current logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Previous container logs:

```bash
kubectl logs <pod-name> -n <namespace> --previous
```

Look for:

```text
out of memory
heap out of memory
memory allocation failed
Killed
fatal error
```

> `--previous` is important because the container may have already restarted.

---

## 5. Step 3 — Check Memory Requests and Limits

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Check:

```text
Requests:
Limits:
```

Or:

```bash
kubectl get pod <pod-name> -n <namespace>   -o jsonpath='{range .spec.containers[*]}{.name}{" request="}{.resources.requests.memory}{" limit="}{.resources.limits.memory}{"\n"}{end}'
```

A container can be OOMKilled when it exceeds its configured memory limit.

---

## 6. Step 4 — Check Memory Usage

If Metrics Server is available:

```bash
kubectl top pod <pod-name> -n <namespace>
kubectl top pods -n <namespace> --sort-by=memory
kubectl top node
```

Look for:

```text
Pod memory close to limit
Multiple memory-heavy pods
Node memory pressure
```

---

## 7. Step 5 — Check Events

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Or:

```bash
kubectl get events -n <namespace> --sort-by=.lastTimestamp
```

Look for:

```text
OOMKilled
Evicted
MemoryPressure
Killing
Back-off restarting failed container
```

---

## 8. Step 6 — Check Node Memory Pressure

```bash
kubectl describe node <node-name>
kubectl top node <node-name>
```

Check:

```text
MemoryPressure
```

If:

```text
MemoryPressure=True
```

investigate node-wide memory usage.

Use:

```text
Node-MemoryPressure.md
```

---

## 9. Step 7 — Identify the Cause

### A. Application Memory Leak

```text
Memory usage
    ↓
Continually increases
    ↓
Container reaches limit
    ↓
OOMKilled
```

Indicators:

```text
Memory grows over time
Pod restarts periodically
Memory does not return to baseline
```

Escalate to Application Owner.

### B. Memory Limit Too Low

Compare:

```text
Normal peak usage
        VS
Configured memory limit
```

### C. Traffic Spike

```text
Traffic increases
      ↓
More concurrent requests
      ↓
Higher memory usage
      ↓
OOMKilled
```

Check traffic and HPA activity.

### D. Too Many Pods on Node

```text
Many memory-heavy pods
       ↓
Node memory pressure
       ↓
Pod instability / eviction
```

---

## 10. Step 8 — Check HPA

```bash
kubectl get hpa -n <namespace>
kubectl describe hpa <hpa-name> -n <namespace>
```

Check:

```text
Current replicas
Desired replicas
CPU
Memory
Min replicas
Max replicas
```

Do not increase `maxReplicas` blindly. Confirm cluster capacity.

---

## 11. Step 9 — Immediate Mitigation

If production is actively failing, use the safest approved mitigation.

### Scale the Deployment

```bash
kubectl scale deployment <deployment-name>   --replicas=<safe-number>   -n <namespace>
```

### Temporarily Reduce Traffic

Use the approved load-balancer, Gateway, CDN, or application procedure.

### Restart a Pod

Only when appropriate:

```bash
kubectl delete pod <pod-name> -n <namespace>
```

> Restarting the pod is only a temporary mitigation.

---

## 12. Step 10 — Fix Memory Configuration

If the application legitimately requires more memory:

```yaml
resources:
  requests:
    memory: "1Gi"
  limits:
    memory: "2Gi"
```

Choose values from actual workload measurements.

Check before increasing limits:

```text
Node capacity
Other pods
Application memory behavior
Peak workload
Number of replicas
```

---

## 13. Step 11 — Check Application Runtime Limits

Some runtimes have their own memory limits.

Examples:

```text
Node.js:
--max-old-space-size

Java:
-Xms
-Xmx

Python:
worker/process count
memory-heavy libraries
```

Make sure runtime settings fit inside the Kubernetes container memory limit.

---

## 14. Step 12 — Redeploy

After changing resources or application configuration:

```bash
kubectl rollout restart deployment/<deployment-name>   -n <namespace>
```

Monitor:

```bash
kubectl rollout status deployment/<deployment-name>   -n <namespace>
```

Then:

```bash
kubectl get pods -n <namespace>
```

---

## 15. Step 13 — Monitor Recovery

```bash
kubectl top pod <pod-name> -n <namespace>
```

Monitor:

```bash
watch -n5 'kubectl top pod <pod-name> -n <namespace>'
```

Look for:

```text
Memory stable
No rapid growth
No OOMKilled
Restart count stable
```

For longer-term analysis, use Prometheus/Grafana.

---

## 16. Step 14 — Verify Recovery

```bash
kubectl get pods -n <namespace>
kubectl describe pod <pod-name> -n <namespace>
```

Confirm:

```text
Ready=True
No new OOMKilled events
Restart count stable
```

Verify application:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

---

## 17. Do NOT Do These Things

### ❌ Don't just increase the memory limit

First determine whether there is a memory leak or traffic problem.

### ❌ Don't restart the pod repeatedly

It hides the symptom without fixing the cause.

### ❌ Don't remove memory limits blindly

One pod can consume enough memory to affect the entire node.

### ❌ Don't increase HPA replicas blindly

More replicas require more cluster capacity.

### ❌ Don't ignore node memory pressure

OOMKilled may be part of a larger node-capacity problem.

---

## 18. Quick Reference

```bash
# Pod
kubectl get pod <pod-name> -n <namespace>
kubectl describe pod <pod-name> -n <namespace>

# Logs
kubectl logs <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> --previous

# Memory
kubectl top pod <pod-name> -n <namespace>
kubectl top pods -n <namespace> --sort-by=memory
kubectl top node

# Events
kubectl get events -n <namespace> --sort-by=.lastTimestamp

# HPA
kubectl get hpa -n <namespace>
kubectl describe hpa <hpa-name> -n <namespace>

# Scale
kubectl scale deployment <deployment-name>   --replicas=<number> -n <namespace>

# Restart
kubectl rollout restart deployment/<deployment-name>   -n <namespace>

# Rollout
kubectl rollout status deployment/<deployment-name>   -n <namespace>
```

---

## 19. Recovery Criteria

- [ ] `OOMKilled` confirmed.
- [ ] Root cause identified or actively mitigated.
- [ ] Memory request/limit reviewed.
- [ ] Current memory usage checked.
- [ ] Node memory pressure checked.
- [ ] HPA/scaling checked.
- [ ] Application runtime memory settings checked where applicable.
- [ ] Deployment updated if required.
- [ ] Pod remains `Running`.
- [ ] Pod remains `Ready`.
- [ ] Restart count is stable.
- [ ] No new `OOMKilled` events.
- [ ] Memory usage is stable.
- [ ] Application health check succeeds.

---

## 20. Escalation

Escalate to **Application Owner** when:

- Memory usage continuously grows.
- A memory leak is suspected.
- Runtime heap/process configuration needs changes.
- Application workload causes unexpected memory growth.

Escalate to **Kubernetes/SRE** when:

- Multiple pods are OOMKilled.
- Node memory pressure exists.
- Cluster capacity is insufficient.
- HPA or scheduling contributes to the problem.

Escalate to **Infrastructure/SRE** when:

- Multiple nodes experience memory exhaustion.
- Cluster capacity needs expansion.

---

## Golden Rule

```text
Pod OOMKilled
      ↓
CONFIRM OOMKILLED
      ↓
Check Memory Usage
      ↓
Check Requests / Limits
      ↓
Check Node Memory
      ↓
Check HPA / Traffic
      ↓
Check Application Memory
      ↓
FIX ROOT CAUSE
      ↓
Redeploy
      ↓
Monitor Memory
      ↓
Verify Pod + Application
```

> **OOMKilled = the container exceeded its available memory boundary. Find out whether the problem is the application, workload, memory limit, scaling, or node capacity before simply increasing the limit.**
