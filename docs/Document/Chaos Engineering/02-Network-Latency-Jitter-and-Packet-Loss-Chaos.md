# Kubernetes Chaos Scenario 02: Network Latency, Jitter & Packet Loss Chaos

**Domain:** Inter-Service Networking, CNI Degradation, Circuit Breaking & Timeout Resilience  
**Chaos Type:** `NetworkChaos` (Latency Delay, Jitter, Packet Loss, Packet Corruption)  
**Target:** Microservice-to-Microservice Communication (`order-service` $\to$ `payment-gateway`)  
**Tools:** CNCF Chaos Mesh (`tc` NetEm), Toxiproxy, Envoy / Istio, Resilience4j, `k6`

---

## 1. Experiment Overview

In distributed systems, networks are inherently unreliable. Cross-region traffic, cloud routing blips, noisy neighbors, and CNI congestion introduce sudden latency spikes and packet loss that can trigger cascading thread exhaustion and unconstrained retry storms across microservices.

The primary experiment tests **Inter-Service Latency Injection & Circuit Breaker Tripping**.

A separate optional experiment tests **Packet Loss, Corrupted Segments & Exponential Backoff Retry Budgets**.

> **Important:** Without client circuit breakers and tight timeout boundaries, slow downstream dependencies will exhaust upstream connection and worker thread pools, converting a localized degradation into a cluster-wide outage.

### Experiment A — Latency Delay & Circuit Breaker Tripping

```text
400ms latency injected on payment-gateway
    ↓
Requests from order-service to payment-gateway exceed 200ms timeout
    ↓
Circuit Breaker trips to `OPEN` state after 5 consecutive failures
    ↓
Subsequent requests fail fast or serve fallback cache (< 5ms)
    ↓
Upstream order-service worker threads remain 100% healthy!
```

### Experiment B — Packet Loss & Retry Storm Containment

```text
15% packet loss injected on egress traffic
    ↓
TCP retransmissions increase network queue depth
    ↓
Exponential backoff retry policy (with max 2 retries) prevents stampede
    ↓
Jitter in retry intervals avoids synchronized retry waves
    ↓
Overall system throughput degrades gracefully
```

---

## 2. Steady-State Hypothesis

> **When 400ms latency with 50ms jitter and 10% packet loss is injected between `order-service` and `payment-gateway` for 5 minutes, client circuit breakers will trip to `OPEN` state within 5 failed requests, fallbacks will serve cached/degraded responses in $< 20\text{ms}$, and upstream thread pool saturation will remain $< 70\%$ without cascading outages.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Circuit Breaker State | Transitions from `CLOSED` to `OPEN` within 5 failures |
| Thread Pool Saturation | Upstream worker threads busy $< 70\%$ |
| Fallback Success | Degraded fallback response served in $< 20\text{ms}$ |
| Upstream Availability | `order-service` maintains 100% availability for non-payment calls |
| Recovery | Circuit breaker transitions `HALF-OPEN` $\to$ `CLOSED` post-chaos |
| Error Budget Protection | Downstream degradation isolated from upstream users |

---

## 3. Failure Mechanism Architecture

```text
              Circuit Breaker State Machine Under Chaos

┌─────────────────────────────────────────────────────────────┐
│                 UPSTREAM: order-service                     │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ CIRCUIT BREAKER (Resilience4j / Envoy)                │  │
│  │                                                       │  │
│  │  [ CLOSED ] ──► (Failure rate > 50%) ──► [ OPEN ]     │  │
│  │     ▲                                       │         │  │
│  │     │                                       │ (10s)   │  │
│  │     │                                       ▼         │  │
│  │     └── (Success rate > 80%) ── [ HALF-OPEN ]         │  │
│  │                                                       │  │
│  │  In OPEN State:                                       │  │
│  │  - ZERO network calls sent to payment-gateway         │  │
│  │  - Instant fallback response (e.g. "Order queued")    │  │
│  │  - Upstream threads FREED instantly! ✅               │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ CHAOS MESH NetworkChaos (Active!)                     │  │
│  │ - 400ms Latency + 50ms Jitter + 10% Packet Loss       │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ DOWNSTREAM: payment-gateway (Degraded)                │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

Before running the experiment:

### Verify target deployments

```bash
kubectl get pods -n production -l app=order-service
kubectl get pods -n production -l app=payment-gateway
```

### Verify Chaos Mesh installation

```bash
kubectl get crd | grep networkchaos
```

### Verify baseline connectivity

```bash
ORDER_POD=$(kubectl get pods -n production -l app=order-service -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it "$ORDER_POD" -n production -- curl -s http://payment-gateway:8080/health
```

---

# 5. Step 1 — Record Baseline

### Baseline round-trip latency

```bash
kubectl exec -it "$ORDER_POD" -n production -- curl -w "\nDNS: %{time_namelookup}s | Connect: %{time_connect}s | Total: %{time_total}s\n" -o /dev/null -s http://payment-gateway:8080/health
```

### Baseline thread pool / CPU usage

```bash
kubectl top pods -n production -l app=order-service
```

---

# 6. Step 2 — Inject Network Latency & Packet Loss

### Chaos Mesh `NetworkChaos` Manifest

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: payment-latency-and-loss-drill
  namespace: chaos-testing
spec:
  action: delay
  mode: all
  selector:
    namespaces:
      - production
    labelSelectors:
      app: payment-gateway
  delay:
    latency: "400ms"
    jitter: "50ms"
    correlation: "25"
  loss:
    loss: "10"
    correlation: "50"
  direction: to
  target:
    selector:
      namespaces:
        - production
      labelSelectors:
        app: order-service
  duration: "5m"
```

Apply:

```bash
kubectl apply -f payment-latency-and-loss.yaml
```

---

# 7. Step 3 — Monitor Circuit Breaker & Thread Saturation

### Monitor Circuit Breaker state transitions in application metrics

```promql
# Resilience4j Circuit Breaker State (0=CLOSED, 1=OPEN, 2=HALF_OPEN)
resilience4j_circuitbreaker_state{name="paymentService"}
```

### Monitor order-service worker thread saturation

```bash
kubectl top pods -n production -l app=order-service
```

### Verify fallback responses served

```bash
kubectl exec -it "$ORDER_POD" -n production -- curl -v http://localhost:8080/api/checkout
```
*Expected: Fallback response served in $< 20\text{ms}$ with status `200` or `202 Accepted`.*

---

# 8. Step 4 — Abort Conditions

Stop the experiment immediately if:

```text
ABORT CONDITIONS

- order-service thread pool reaches 100% saturation for > 30s
- order-service pods crash due to unhandled timeout exceptions
- Unrelated endpoints in order-service return 500 errors
- Upstream client error rate exceeds 5%
```

---

# 9. Emergency Stop

```bash
kubectl delete networkchaos payment-latency-and-loss-drill -n chaos-testing
```

---

# 10. Recovery Validation

### Verify Circuit Breaker transitions back to `CLOSED`

```promql
resilience4j_circuitbreaker_state{name="paymentService",state="closed"} == 1
```

### Verify round-trip latency returns to baseline

```bash
kubectl exec -it "$ORDER_POD" -n production -- curl -w "\nTotal: %{time_total}s\n" -o /dev/null -s http://payment-gateway:8080/health
```
*Expected: $< 15\text{ms}$.*

---

# 11. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Upstream pods crash with OutOfMemory | Threads blocked waiting on downstream without timeout | Configure strict request timeout (e.g. `connectTimeout: 200ms`, `readTimeout: 500ms`) |
| Cascading failure takes down entire app | Missing Circuit Breaker | Implement Resilience4j or Envoy circuit breaker on all outbound clients |
| Retry storm worsens network congestion | Unconstrained retries with 0 backoff | Implement exponential backoff with full jitter and maximum 2 retry attempts |
| Circuit breaker never closes after recovery | Probe threshold too strict | Configure `permittedNumberOfCallsInHalfOpenState: 5` and `waitDurationInOpenState: 10s` |

---

# 12. Production Hardening: Circuit Breaker & Retry Configuration

### Resilience4j Configuration

```yaml
resilience4j.circuitbreaker:
  instances:
    paymentService:
      slidingWindowType: COUNT_BASED
      slidingWindowSize: 10
      minimumNumberOfCalls: 5
      failureRateThreshold: 50.0
      slowCallRateThreshold: 50.0
      slowCallDurationThreshold: 500ms
      waitDurationInOpenState: 10s
      permittedNumberOfCallsInHalfOpenState: 3
resilience4j.retry:
  instances:
    paymentService:
      maxAttempts: 2
      waitDuration: 200ms
      enableExponentialBackoff: true
      exponentialBackoffMultiplier: 2
```

### Envoy / Istio DestinationRule

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: payment-gateway-cb
  namespace: production
spec:
  host: payment-gateway
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http1MaxPendingRequests: 10
        maxRequestsPerConnection: 10
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 10s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
```

---

# 13. Experiment Results

| Metric | Baseline | Chaos Active (Pre-CB) | Circuit Breaker OPEN | Recovery |
|---|---:|---:|---:|---:|
| Latency to payment-gw | 8ms | 450ms | N/A (Fast fail) | 8ms |
| Fallback Latency | N/A | N/A | 12ms | N/A |
| order-service Threads | 15% | 68% | 20% | 15% |
| Circuit Breaker State | CLOSED | CLOSED $\to$ OPEN | OPEN | CLOSED |
| App Availability | 100% | 100% | 100% (with fallback) | 100% |

---

# 14. Final Assessment & Key Technical Takeaways

```text
Slow Downstream Dependency
    =
Worse than hard failure (holds threads open indefinitely)

Circuit Breaker
    =
Essential safety fuse that converts slow failures into fast fallbacks

Retries Without Backoff
    =
Self-inflicted Distributed Denial of Service (DDoS)

Successful Network Chaos
    =
Circuit breaker trips within 5 failures
    +
Fast fallback response served (< 20ms)
    +
Upstream thread pool protected (< 70%)
    +
Clean recovery post-chaos
```
