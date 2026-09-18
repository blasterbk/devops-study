# Kubernetes Chaos Scenario 09: Clock Skew & Time Drift Chaos

**Domain:** Distributed Systems Synchronization, Token Validation & Monotonic Clocks  
**Chaos Type:** `TimeChaos` (Clock Offset Drift, Time Jump Forward/Backward)  
**Target:** Application Pods (Auth Service, Payment Gateway, Event Processors)  
**Tools:** Chaos Mesh `TimeChaos` (eBPF / vDSO hook), Chrony, `kubectl`

---

## 1. Experiment Overview

In distributed cloud environments, clock drift between nodes occurs when NTP/Chrony de-synchronizes, hypervisors pause VM execution (live migration), or container time namespaces diverge. Clock drift can invalidate authentication tokens (JWT `nbf` / `exp`), break TLS certificate validity windows, disrupt distributed timestamp ordering (event sourcing, CQRS), and cause scheduled cron jobs to fire at wrong times.

The primary experiment tests **Forward/Backward Clock Skew & JWT Token Validation Leeway**.

A separate optional experiment tests **Monotonic Timer Safety & Event Ordering Under Drift**.

> **Important:** Chaos Mesh's `TimeChaos` uses eBPF to intercept the kernel's vDSO (`__vdso_clock_gettime`) at the container level. The host system clock is NOT affected — only the target container perceives a different time.

### Experiment A — Forward Time Drift & JWT Expiry

```text
TimeChaos shifts container clock +60 seconds
    ↓
Container's `CLOCK_REALTIME` reports time 60s in the future
    ↓
JWT tokens with exp claim appear closer to expiry
    ↓
JWT validators with 60s leeway still accept tokens
    ↓
JWT validators with 0s leeway reject valid tokens!
```

### Experiment B — Backward Time Drift & Certificate Validity

```text
TimeChaos shifts container clock -120 seconds
    ↓
Container's CLOCK_REALTIME reports time 120s in the past
    ↓
TLS certificates with `notBefore` in the future (from container's perspective)
    ↓
Certificate validation may reject valid certs
    ↓
Monotonic timers (CLOCK_MONOTONIC) are NOT affected
    ↓
Internal timeouts and rate limiters continue correctly
```

---

## 2. Steady-State Hypothesis

> **When a $+60\text{s}$ or $-60\text{s}$ time drift is injected into the authentication service container, JWT token validation libraries configured with a 60-second leeway will continue validating active user sessions without rejecting legitimate logins, TLS handshakes with certificates having $> 5\text{min}$ validity buffer will succeed, and monotonic timers will NOT freeze or loop.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| JWT Validation | 100% of active tokens validate with 60s leeway configured |
| TLS Handshakes | HTTPS connections succeed with standard certificates |
| Monotonic Timers | Internal timeouts, rate limiters, and intervals operate normally |
| Event Ordering | Event timestamps may show drift but logical ordering preserved |
| Auth Success Rate | $> 99.9\%$ login success rate during chaos |
| Clock Recovery | Container time aligns with host within 5s post-chaos |

---

## 3. Failure Mechanism Architecture

```text
               Clock Skew Impact on Auth & TLS Systems

┌─────────────────────────────────────────────────────────────┐
│                 AUTH SERVICE POD                             │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ CLOCK_REALTIME (Wall Clock)                           │  │
│  │ - Used by: JWT exp/nbf, TLS notBefore/notAfter,      │  │
│  │            Date.now(), time.time(), new Date()        │  │
│  │ - AFFECTED by TimeChaos! ⚠️                           │  │
│  │ - Shifted +60s forward                                │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ CLOCK_MONOTONIC (Monotonic Clock)                     │  │
│  │ - Used by: setTimeout, setInterval, rate limiters,    │  │
│  │            gRPC deadlines, HTTP timeouts              │  │
│  │ - Depending on TimeChaos clockIds config:             │  │
│  │   - May or may not be affected                        │  │
│  │ - NEVER goes backward (monotonic guarantee)           │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ JWT VALIDATION                                        │  │
│  │ now() = real_time + 60s (shifted)                     │  │
│  │                                                       │  │
│  │ Token exp: T + 3600s (1 hour)                         │  │
│  │ Shifted now: T + 60s                                  │  │
│  │ Remaining validity: 3540s (still valid with leeway!) ✅│  │
│  │                                                       │  │
│  │ Token exp: T + 30s (about to expire)                  │  │
│  │ Shifted now: T + 60s                                  │  │
│  │ → Token appears EXPIRED! ❌ (without 60s leeway)      │  │
│  │ → Token still VALID ✅ (with 60s leeway configured)   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

### Verify target pods

```bash
kubectl get pods -n production -l app=auth-service
```

### Verify Chaos Mesh TimeChaos CRD

```bash
kubectl get crd | grep timechaos
```

### Verify current time on container vs host

```bash
# Container time:
kubectl exec -it auth-service-0 -n production -- date

# Host time:
date
```

---

# 5. Step 1 — Record Baseline

### Current container time

```bash
kubectl exec -it auth-service-0 -n production -- date -u
```

### JWT validation test

```bash
curl -H "Authorization: Bearer <valid-jwt>" https://api.example.com/auth/verify
```

### TLS handshake verification

```bash
curl -v https://api.example.com 2>&1 | grep "SSL certificate"
```

### Application auth success rate

```bash
for i in $(seq 1 10); do
  STATUS=$(curl -o /dev/null -s -w "%{http_code}" -H "Authorization: Bearer <jwt>" https://api.example.com/auth/me)
  echo "Auth check $i: HTTP $STATUS"
done
```

---

# 6. Step 2 — Inject Forward Time Drift (+60s)

### Chaos Mesh `TimeChaos` Manifest

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: TimeChaos
metadata:
  name: auth-clock-forward-skew
  namespace: chaos-testing
spec:
  mode: all
  selector:
    namespaces:
      - production
    labelSelectors:
      app: auth-service
  timeOffset: "60s"
  clockIds:
    - CLOCK_REALTIME
  duration: "5m"
```

Apply:

```bash
kubectl apply -f auth-clock-skew.yaml
```

### Verify time shift inside container

```bash
kubectl exec -it auth-service-0 -n production -- date -u
```
*Expected: Container time is ~60 seconds ahead of actual UTC.*

---

# 7. Step 3 — Inject Backward Time Drift (-120s) (Optional)

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: TimeChaos
metadata:
  name: auth-clock-backward-skew
  namespace: chaos-testing
spec:
  mode: all
  selector:
    namespaces:
      - production
    labelSelectors:
      app: auth-service
  timeOffset: "-120s"
  clockIds:
    - CLOCK_REALTIME
  duration: "5m"
```

---

# 8. Step 4 — Monitor Auth & TLS Behavior

### Test JWT validation during drift

```bash
for i in $(seq 1 30); do
  STATUS=$(curl -o /dev/null -s -w "%{http_code}" -H "Authorization: Bearer <jwt>" https://api.example.com/auth/me)
  echo "[T+${i}s] Auth: HTTP $STATUS"
  sleep 2
done
```

### Test TLS handshake during drift

```bash
curl -v https://api.example.com 2>&1 | grep -i -E "expire|valid|error"
```

### Check application logs for time-related errors

```bash
kubectl logs -l app=auth-service -n production --tail=50 | grep -i -E "expired|clock|time|token|invalid"
```

### Verify monotonic timers

```bash
# Test that internal timeouts still work correctly:
kubectl exec -it auth-service-0 -n production -- sh -c "timeout 5 sleep 3 && echo 'Timer works correctly'"
```

---

# 9. Abort Conditions

```text
ABORT CONDITIONS

- 100% of authentication requests fail (complete auth outage)
- TLS connections fail cluster-wide
- Database connections rejected due to time-based auth failure
- Internal cron jobs or timers fire at wrong intervals
- Application enters crash loop due to time assertion
```

---

# 10. Emergency Stop

```bash
kubectl delete timechaos auth-clock-forward-skew -n chaos-testing
kubectl delete timechaos auth-clock-backward-skew -n chaos-testing
```

---

# 11. Recovery Validation

### Verify container time aligns with host

```bash
kubectl exec -it auth-service-0 -n production -- date -u
date -u
```

### Verify auth success rate recovered

```bash
curl -H "Authorization: Bearer <valid-jwt>" https://api.example.com/auth/verify
```

---

# 12. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| JWT tokens rejected during +60s drift | JWT validator has 0s clock tolerance | Configure `clockTolerance: 60` in JWT library |
| TLS handshakes fail during -120s drift | Certificate `notBefore` appears in the future | Use certificates with $> 5\text{min}$ validity buffer |
| Database auth fails | Time-based SCRAM nonce validation mismatch | Increase SCRAM nonce validity window |
| Event ordering corrupted | Events timestamped with wall clock | Use logical clocks (Lamport/Vector) for ordering |
| Rate limiter broken | Rate limiter uses `CLOCK_REALTIME` instead of `CLOCK_MONOTONIC` | Use monotonic clocks for all internal timing |

---

# 13. Production Hardening

### JWT Validation with Clock Tolerance

```javascript
// Node.js / jsonwebtoken:
jwt.verify(token, secret, { clockTolerance: 60 }); // 60 second leeway

// Python / PyJWT:
jwt.decode(token, secret, leeway=timedelta(seconds=60))
```

### Application Timing Best Practices

```text
Use CLOCK_REALTIME for:
    - Display timestamps to users
    - External API datetime fields
    - Certificate validity checks

Use CLOCK_MONOTONIC for:
    - Internal timeouts
    - Rate limiting
    - Performance measurement
    - Circuit breaker timers
    - Cache TTL
```

---

# 14. Experiment Results

| Metric | Baseline | +60s Drift | -120s Drift | Recovery |
|---|---:|---:|---:|---:|
| Auth Success Rate | 100% | 100% (with leeway) | 100% (with leeway) | 100% |
| TLS Handshake | Pass | Pass | Pass | Pass |
| Monotonic Timers | Normal | Normal | Normal | Normal |
| Container Clock Offset | 0s | +60s | -120s | 0s |

---

# 15. Final Assessment & Key Technical Takeaways

```text
CLOCK_REALTIME
    =
Wall clock (affected by NTP, TimeChaos, admin changes)
    =
Use for external timestamps ONLY

CLOCK_MONOTONIC
    =
Never goes backward, not affected by NTP adjustments
    =
Use for ALL internal timing logic

JWT clockTolerance: 0
    =
Production vulnerability (any clock drift breaks auth)

JWT clockTolerance: 60
    =
Safe margin for normal NTP drift and VM migration

Successful Clock Skew Chaos
    =
Auth continues with leeway
    +
TLS certificates validate
    +
Monotonic timers unaffected
    +
Clean time recovery post-chaos
```
