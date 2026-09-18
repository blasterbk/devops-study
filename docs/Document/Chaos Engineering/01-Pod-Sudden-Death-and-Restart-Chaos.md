# Kubernetes Chaos Scenario 01: Pod Sudden Death & Restart Chaos

**Domain:** Application Availability, Endpoint Lifecycle, Ingress Routing & Pod Disruption  
**Chaos Type:** `PodChaos` (Abrupt Pod Termination, SIGKILL, Container Churn)  
**Target:** Stateless Web Services / Ingress Target Deployments (`order-api`, `frontend`)  
**Tools:** CNCF Chaos Mesh, LitmusChaos, `kubectl`, `k6` / `vegeta`, `curl`

---

## 1. Experiment Overview

In a Kubernetes microservices architecture, individual pods are terminated abruptly due to node reboots, spot instance preemptions, kernel OOMKills, or automated rolling deployments. This experiment evaluates whether the Ingress Controller (e.g. NGINX Ingress, Traefik, ALB Controller), CoreDNS, and Kubernetes Service Endpoints deregister terminating pods cleanly without returning `502 Bad Gateway` or `503 Service Unavailable` errors to active clients.

The primary experiment tests **Sudden SIGKILL Under High-Throughput Live Traffic (1,000 RPS)**.

A separate optional experiment tests **Continuous Pod Churn & ReplicaSet Replacement Lag**.

> **Important:** When a Pod is terminated, Kubernetes removes the Pod from EndpointSlices asynchronously while simultaneously sending `SIGTERM` to the container. Without a container `preStop` hook (e.g. `sleep 5`), iptables / IPVS endpoint removal races with container termination, causing Ingress controllers to route requests to dead pods (502 Bad Gateway).

### Experiment A — Sudden Pod SIGKILL Under Live Traffic

```text
Pod terminates abruptly via SIGKILL (kill -9)
    ↓
Kubelet detects exit & notifies API Server
    ↓
EndpointSlice controller updates endpoint list
    ↓
Ingress Controller receives watch event & updates upstream pool
    ↓
Remaining replicas absorb in-flight traffic
    ↓
Zero 502/503 Bad Gateways returned to clients!
```

### Experiment B — Continuous Pod Churn

```text
Chaos Mesh kills 1 random pod every 30 seconds for 10 minutes
    ↓
Deployment controller continuously reconciles replica count
    ↓
PodDisruptionBudget (PDB) enforces minimum availability (minAvailable: 60%)
    ↓
ReplicaSet spawns replacement pods on healthy nodes
    ↓
Readiness probes prevent unready pods from receiving traffic
```

---

## 2. Steady-State Hypothesis

> **When 30% of application pods are terminated abruptly with `SIGKILL` under 1,000 RPS live traffic, the Ingress Controller and Service Endpoints will deregister terminating pods before routing new requests, resulting in $\ge 99.99\%$ HTTP success rate (0 dropped requests or 502 Bad Gateways) and p95 latency increase $< 50\text{ms}$.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| HTTP 5xx Error Rate | $< 0.01\%$ |
| Ingress 502/503 Spikes | 0 dropped requests |
| Endpoint Convergence | EndpointSlice updated in $< 1\text{s}$ |
| ReplicaSet Replacement | Replacement pod running and ready in $< 15\text{s}$ |
| PDB Enforcement | Disruption budget never breached |
| Client Traffic Continuity | k6 / vegeta reports 0 connection resets |

---

## 3. Failure Mechanism Architecture

```text
              Kubernetes Pod Termination Race Condition

┌─────────────────────────────────────────────────────────────┐
│                    API SERVER & CONTROL PLANE               │
│                                                             │
│  T = 0s: Delete Pod Request                                 │
│      ├──► (Path A: Asynchronous Endpoint Removal)           │
│      │    API Server updates EndpointSlice                  │
│      │    → Kube-Proxy updates IPVS/iptables (takes 1-3s)   │
│      │    → Ingress Controller reloads upstreams            │
│      │                                                      │
│      └──► (Path B: Container Termination)                   │
│           Kubelet receives delete event                     │
│           → If NO preStop: sends SIGTERM → SIGKILL instantly│
│           → Container DIES while Ingress still routes to it!│
│           → 💥 502 BAD GATEWAY!                             │
│                                                             │
│  WITH preStop: sleep 5                                      │
│  Container waits 5s before shutting down socket             │
│  → Path A completes BEFORE container exits ✅                │
│  → ZERO dropped requests!                                   │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

Before running the experiment:

### Verify Deployment replica count and health

```bash
kubectl get deployment order-api -n production
kubectl get pods -n production -l app=order-api -o wide
```

### Verify PodDisruptionBudget is active

```bash
kubectl get pdb -n production
```

### Verify Chaos Mesh installation

```bash
kubectl get pods -n chaos-testing
```

### Verify load generator tools

```bash
which k6 || which vegeta || which curl
```

---

# 5. Step 1 — Record Baseline

### Record current pod list and readiness

```bash
kubectl get pods -n production -l app=order-api -o json | jq '.items[] | {name: .metadata.name, ip: .status.podIP, ready: .status.conditions[] | select(.type=="Ready").status}'
```

### Record EndpointSlice endpoints

```bash
kubectl get endpointslices -n production -l kubernetes.io/service-name=order-api
```

### Run baseline load test (1,000 RPS for 30s)

```bash
k6 run --vus 50 --duration 30s -e TARGET_URL=https://api.example.com/orders load-test.js
```

Record:
- Baseline error rate (0%)
- Baseline p95 latency (< 25ms)
- Baseline pod count (5 replicas)

---

# 6. Step 2 — Progressive Pod Chaos

---

## 6.1 Stage 1: Single Pod Kill (Manual Verification)

Kill a single pod to verify basic auto-healing:

```bash
TARGET_POD=$(kubectl get pods -n production -l app=order-api -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod "$TARGET_POD" -n production --grace-period=0 --force
```

Watch replacement creation:

```bash
kubectl get pods -n production -l app=order-api -w
```

---

## 6.2 Stage 2: Declarative 30% Pod Kill via Chaos Mesh

### Chaos Mesh `PodChaos` Manifest

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: pod-sudden-kill-experiment
  namespace: chaos-testing
spec:
  action: pod-kill
  mode: fixed-percent
  value: "30"              # Kill 30% of target pods
  duration: "5m"
  scheduler:
    cron: "@every 30s"     # Kill random pods every 30 seconds
  selector:
    namespaces:
      - production
    labelSelectors:
      app: order-api
```

Apply:

```bash
kubectl apply -f pod-sudden-kill.yaml
```

---

## 6.3 Stage 3: Start Concurrent Traffic Generator

While chaos is active, run continuous traffic generation:

```bash
k6 run --vus 100 --duration 5m -e TARGET_URL=https://api.example.com/orders load-test.js
```

---

# 7. Step 3 — Monitor Real-Time Ingress & Error Metrics

### Monitor Ingress HTTP 5xx error rate (PromQL)

```promql
sum(rate(nginx_ingress_controller_requests{status=~"5.*"}[1m])) 
/ 
sum(rate(nginx_ingress_controller_requests[1m])) * 100
```

### Monitor EndpointSlice updates

```bash
watch -n 1 'kubectl get endpointslices -n production -l kubernetes.io/service-name=order-api'
```

### Monitor Pod lifecycle events

```bash
kubectl get events -n production --sort-by='.lastTimestamp' -w
```

---

# 8. Step 4 — Abort Conditions

Stop the experiment immediately if:

```text
ABORT CONDITIONS

- HTTP 5xx error rate exceeds 1% sustained for > 15 seconds
- All pods in deployment enter CrashLoopBackOff or Error state
- PodDisruptionBudget is violated (available pods drop below minAvailable)
- Ingress Controller crashes or stops reloading configurations
- Node-level OOMKills trigger across unrelated namespaces
```

---

# 9. Emergency Stop

```bash
kubectl delete podchaos pod-sudden-kill-experiment -n chaos-testing
```

If pods fail to recover:

```bash
kubectl rollout restart deployment order-api -n production
```

---

# 10. Recovery Validation

### Verify all pods are Running and Ready

```bash
kubectl get deployment order-api -n production
kubectl get pods -n production -l app=order-api
```
*Expected: Replicas 5/5 Ready.*

### Verify EndpointSlice contains all healthy IPs

```bash
kubectl get endpointslices -n production -l kubernetes.io/service-name=order-api -o json | jq '.items[].endpoints[] | {ip: .addresses[0], ready: .conditions.ready}'
```

### Run post-chaos verification load test

```bash
k6 run --vus 50 --duration 1m -e TARGET_URL=https://api.example.com/orders load-test.js
```
*Expected: 0 errors, p95 latency returns to baseline.*

---

# 11. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| 502 Bad Gateway during pod termination | Missing `preStop` hook; container died before endpoint removal | Add `lifecycle.preStop.exec.command: ["sleep", "5"]` |
| All pods killed simultaneously | Missing PodDisruptionBudget | Apply `PodDisruptionBudget` with `minAvailable: 60%` |
| Traffic sent to unready replacement pods | Missing or improper `readinessProbe` | Configure HTTP `readinessProbe` with `initialDelaySeconds` |
| Replacement pods stuck in Pending | Insufficient node compute capacity | Configure Cluster Autoscaler / Karpenter with headroom |
| Connection reset (`ECONNRESET`) | Application closes listen socket without draining in-flight requests | Configure graceful shutdown timeout in web server (e.g. Node.js `server.close()`, Go `srv.Shutdown()`) |

---

# 12. Production Hardening: `preStop` Lifecycle, PDB & Probes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api
  namespace: production
spec:
  replicas: 5
  strategy:
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 0        # Zero-downtime rolling updates
  template:
    metadata:
      labels:
        app: order-api
    spec:
      terminationGracePeriodSeconds: 35
      containers:
      - name: app
        image: order-api:v2.4
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 5"]
        readinessProbe:
          httpGet:
            path: /healthz
            port: 8080
          initialDelaySeconds: 3
          periodSeconds: 3
        livenessProbe:
          httpGet:
            path: /healthz
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 10
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: order-api-pdb
  namespace: production
spec:
  minAvailable: 60%
  selector:
    matchLabels:
      app: order-api
```

---

# 13. Experiment Results

| Metric | Baseline | 30% Pod Kill | Continuous Churn | Recovery |
|---|---:|---:|---:|---:|
| HTTP 5xx Rate | 0% | $< 0.01\%$ | $< 0.01\%$ | 0% |
| p95 Latency (ms) | 22ms | 38ms | 35ms | 22ms |
| Available Replicas | 5/5 | 3-4/5 | 3-5/5 | 5/5 |
| Dropped Requests | 0 | 0 | 0 | 0 |
| PDB Violations | 0 | 0 | 0 | 0 |

---

# 14. Final Assessment & Key Technical Takeaways

```text
Pod Termination
    ≠
Instant Endpoint Removal (it is an asynchronous race condition!)

preStop: sleep 5
    =
Mandatory buffer allowing Ingress/iptables to drain endpoints

PodDisruptionBudget (PDB)
    =
Prevents voluntary disruptions from taking down all replicas

Readiness Probe
    =
Prevents new pods from receiving traffic before they are warm

Successful Pod Death Chaos
    =
Zero 502/503 errors under live traffic
    +
PDB enforced throughout
    +
ReplicaSet replacement < 15s
    +
Clean post-chaos recovery
```
