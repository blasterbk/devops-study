# Kubernetes Chaos Scenario 10: Security & Admission Webhook Chaos

**Domain:** Control Plane Security, API Server, Admission Controllers & Policy Enforcement  
**Chaos Type:** Webhook Pod Kill, Webhook Timeout Injection, CA Bundle Corruption  
**Target:** Validating/Mutating Admission Webhooks (Kyverno, OPA Gatekeeper, cert-manager)  
**Tools:** Chaos Mesh `PodChaos` / `HTTPChaos`, `kubectl`, Kyverno, OPA Gatekeeper

---

## 1. Experiment Overview

Admission webhooks intercept ALL Kubernetes API Server operations — every `kubectl apply`, every pod scheduling event, every ConfigMap update, and every Secret creation passes through configured validating and mutating admission webhooks before being persisted to etcd. If a webhook backend pod is slow, crashed, or misconfigured, it can freeze the entire Kubernetes cluster's control plane operations.

The primary experiment tests **Webhook Backend Timeout & `failurePolicy: Ignore` Bypass Behavior**.

A separate optional experiment tests **Security-Critical Webhook `failurePolicy: Fail` Enforcement Under Degradation**.

> **Important:** `failurePolicy: Ignore` allows API operations to proceed when the webhook is unavailable, which is safe for non-security-critical webhooks (e.g., label injection, resource defaults). `failurePolicy: Fail` blocks ALL API operations when the webhook is unavailable, which is correct for security-critical enforcement (e.g., pod security policies, image allowlisting).

### Experiment A — Webhook Timeout & `failurePolicy: Ignore`

```text
Webhook backend pod killed or injected with 15s response delay
    ↓
API Server sends admission review request to webhook
    ↓
Webhook does not respond within timeoutSeconds (10s)
    ↓
API Server evaluates failurePolicy
    ↓
failurePolicy: Ignore → API operation proceeds ✅ (non-security)
    ↓
failurePolicy: Fail → API operation rejected ❌ (security enforced)
```

### Experiment B — Security Webhook Crash & Fail-Closed

```text
Security webhook (OPA Gatekeeper / Kyverno) pod killed
    ↓
API Server cannot reach webhook backend
    ↓
failurePolicy: Fail blocks ALL matching API operations
    ↓
kubectl apply, deployments, pod scheduling BLOCKED
    ↓
Alert fires → SRE team restores webhook deployment
    ↓
Normal operations resume
```

---

## 2. Steady-State Hypothesis

> **When the Kyverno validating webhook backend pod is killed or injected with a 15-second request timeout, webhooks configured with `failurePolicy: Ignore` will allow non-critical deployments to proceed within 10 seconds (after timeout), webhooks configured with `failurePolicy: Fail` will correctly block unauthorized operations, and the API Server will log webhook timeout warnings within 60 seconds for SRE alerting.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Non-Critical Deployments | `failurePolicy: Ignore` webhook allows operations after timeout |
| Security Enforcement | `failurePolicy: Fail` webhook blocks unauthorized operations |
| API Server Stability | API Server does not crash or enter failure state |
| Alert Notification | Webhook timeout alerts fire within 60 seconds |
| Recovery Speed | Webhook backend pod restarted within 30 seconds |
| Post-Recovery | All webhook validations resume normally |

---

## 3. Failure Mechanism Architecture

```text
               API Server Admission Webhook Flow

┌─────────────────────────────────────────────────────────────┐
│                 kubectl apply -f deployment.yaml            │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ KUBERNETES API SERVER                                 │  │
│  │                                                       │  │
│  │ 1. Authentication (who are you?)                      │  │
│  │ 2. Authorization (RBAC - can you do this?)            │  │
│  │ 3. Mutating Admission Webhooks (modify the request)   │  │
│  │    → Kyverno: inject labels, defaults                 │  │
│  │ 4. Schema Validation                                  │  │
│  │ 5. Validating Admission Webhooks (approve/deny)       │  │
│  │    → OPA Gatekeeper: enforce policies                 │  │
│  │    → Kyverno: validate image registry, limits         │  │
│  │                                                       │  │
│  │    ┌─────────────────────────────────────────────┐    │  │
│  │    │ WEBHOOK BACKEND POD                         │    │  │
│  │    │ - KILLED or TIMEOUT (15s delay) ❌           │    │  │
│  │    │                                             │    │  │
│  │    │ failurePolicy: Ignore                       │    │  │
│  │    │ → "Webhook unreachable; proceeding anyway"  │    │  │
│  │    │ → Operation ALLOWED ✅                      │    │  │
│  │    │                                             │    │  │
│  │    │ failurePolicy: Fail                         │    │  │
│  │    │ → "Webhook unreachable; blocking operation" │    │  │
│  │    │ → Operation DENIED ❌                       │    │  │
│  │    └─────────────────────────────────────────────┘    │  │
│  │                                                       │  │
│  │ 6. Persist to etcd (if all webhooks approve)          │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Important Webhook Configuration Fields

| Field | Purpose | Recommendation |
|---|---|---|
| `failurePolicy` | What to do when webhook is unreachable | `Ignore` for non-security, `Fail` for security |
| `timeoutSeconds` | How long API Server waits for response | Set to 5-10 seconds (default: 10) |
| `matchPolicy` | How to match API requests | `Equivalent` for version compatibility |
| `sideEffects` | Whether webhook has side effects | `None` for caching by API Server |
| `reinvocationPolicy` | Re-invoke after mutation? | `IfNeeded` for mutating webhooks |
| `namespaceSelector` | Which namespaces to intercept | Exclude `kube-system` to prevent self-lockout! |

---

# 4. Preconditions

### List all admission webhooks

```bash
kubectl get validatingwebhookconfigurations
kubectl get mutatingwebhookconfigurations
```

### Check webhook backend pod health

```bash
kubectl get pods -n kyverno -l app.kubernetes.io/name=kyverno
# or
kubectl get pods -n gatekeeper-system -l app=gatekeeper
```

### Check webhook configuration details

```bash
kubectl get validatingwebhookconfiguration kyverno-resource-validating-webhook-cfg -o yaml | grep -A 5 "failurePolicy"
```

### Verify current failurePolicy settings

```bash
kubectl get validatingwebhookconfigurations -o json | jq '.items[] | {name: .metadata.name, webhooks: [.webhooks[] | {name: .name, failurePolicy: .failurePolicy, timeoutSeconds: .timeoutSeconds}]}'
```

---

# 5. Step 1 — Record Baseline

### Test deployment creation (should pass webhook validation)

```bash
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webhook-test-baseline
  namespace: production
spec:
  replicas: 1
  selector:
    matchLabels:
      app: webhook-test
  template:
    metadata:
      labels:
        app: webhook-test
    spec:
      containers:
      - name: nginx
        image: nginx:1.25
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 200m
            memory: 256Mi
EOF
```
*Expected: Deployment created successfully.*

### Record creation time

```bash
time kubectl apply -f webhook-test.yaml
```
*Expected: $< 2\text{s}$ total time.*

### Cleanup baseline test

```bash
kubectl delete deployment webhook-test-baseline -n production
```

---

# 6. Step 2 — Kill Webhook Backend Pods

### Chaos Mesh `PodChaos` Manifest

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: kyverno-webhook-kill
  namespace: chaos-testing
spec:
  action: pod-kill
  mode: all
  selector:
    namespaces:
      - kyverno
    labelSelectors:
      app.kubernetes.io/name: kyverno
  duration: "5m"
  scheduler:
    cron: "@every 30s"
```

Apply:

```bash
kubectl apply -f kyverno-webhook-kill.yaml
```

---

# 7. Step 3 — Inject Webhook Response Latency

### Chaos Mesh `HTTPChaos` Manifest

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: HTTPChaos
metadata:
  name: webhook-latency-chaos
  namespace: chaos-testing
spec:
  mode: all
  selector:
    namespaces:
      - kyverno
    labelSelectors:
      app.kubernetes.io/name: kyverno
  target: Request
  port: 9443
  delay: "15s"
  duration: "5m"
```

---

# 8. Step 4 — Monitor API Server Behavior

### Test deployment creation during webhook outage

```bash
time kubectl apply -f webhook-test.yaml
```

For `failurePolicy: Ignore`:
*Expected: Deployment succeeds after ~10s timeout (webhook skipped).*

For `failurePolicy: Fail`:
*Expected: `Error: admission webhook "validate.kyverno.svc" denied the request: webhook call timed out`.*

### Check API Server logs for webhook errors

```bash
kubectl logs -n kube-system -l component=kube-apiserver --tail=30 | grep -i webhook
```

### Check API Server audit events

```bash
kubectl get events -n production --sort-by='.lastTimestamp' | grep -i -E "webhook|admission|denied"
```

### Verify that kube-system operations are not blocked

```bash
# Critical: verify system operations are exempt from webhook
kubectl get pods -n kube-system
kubectl get configmaps -n kube-system
```
*Expected: System operations succeed (namespaceSelector should exclude kube-system).*

---

# 9. Abort Conditions

```text
ABORT CONDITIONS

- ALL kubectl operations blocked cluster-wide (including kube-system)
- API Server enters crash loop
- Cannot create/delete pods in ANY namespace
- kube-system namespace operations blocked (self-lockout!)
- etcd operations fail
```

---

# 10. Emergency Stop

### Delete chaos experiments

```bash
kubectl delete podchaos kyverno-webhook-kill -n chaos-testing
kubectl delete httpchaos webhook-latency-chaos -n chaos-testing
```

### If cluster is locked out (cannot delete via kubectl)

```bash
# Directly edit the webhook configuration to add failurePolicy: Ignore:
kubectl edit validatingwebhookconfiguration kyverno-resource-validating-webhook-cfg
# Change failurePolicy to Ignore temporarily

# Or delete the webhook entirely:
kubectl delete validatingwebhookconfiguration kyverno-resource-validating-webhook-cfg
```

### Restore webhook deployment

```bash
kubectl rollout restart deployment kyverno -n kyverno
```

---

# 11. Recovery Validation

### Verify webhook pods are running

```bash
kubectl get pods -n kyverno
```

### Verify webhook is responding

```bash
kubectl get validatingwebhookconfigurations
```

### Test deployment creation with webhook active

```bash
time kubectl apply -f webhook-test.yaml
```
*Expected: $< 2\text{s}$, webhook validation applied.*

### Cleanup

```bash
kubectl delete deployment webhook-test -n production
```

---

# 12. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Entire cluster locked — cannot run ANY kubectl | Webhook `failurePolicy: Fail` applied to kube-system | Add `namespaceSelector` to exclude `kube-system` and `chaos-testing` |
| Webhook timeout adds 10s to every deployment | `timeoutSeconds` set too high (30s) | Set `timeoutSeconds: 5` for non-critical webhooks |
| Security policies bypassed | `failurePolicy: Ignore` on security webhook | Use `failurePolicy: Fail` for security-critical webhooks |
| Webhook pod crash loop | OOMKill or misconfigured resource limits | Set appropriate resource limits on webhook deployment |
| Webhook CA bundle expired | cert-manager certificate rotation failed | Monitor webhook CA bundle expiry and rotate proactively |

---

# 13. Production Hardening

### Webhook Configuration Best Practices

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: security-policy-webhook
webhooks:
- name: validate.security.example.com
  failurePolicy: Fail          # Security: fail-closed
  timeoutSeconds: 5            # Fast timeout
  sideEffects: None
  admissionReviewVersions: ["v1"]
  namespaceSelector:
    matchExpressions:
    - key: kubernetes.io/metadata.name
      operator: NotIn
      values:
      - kube-system            # NEVER intercept kube-system!
      - kube-public
      - chaos-testing
```

### Webhook Monitoring Alert

```yaml
- alert: AdmissionWebhookErrors
  expr: apiserver_admission_webhook_rejection_count > 10
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Admission webhook rejecting operations on {{ $labels.instance }}"

- alert: AdmissionWebhookLatency
  expr: apiserver_admission_webhook_admission_duration_seconds_bucket{le="10"} < 0.95
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Admission webhook latency exceeds 10s — risk of API Server stall"
```

### Webhook High Availability

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kyverno
  namespace: kyverno
spec:
  replicas: 3                  # HA: minimum 3 replicas
  strategy:
    rollingUpdate:
      maxUnavailable: 1        # Always keep 2 available
```

---

# 14. Experiment Results

| Metric | Baseline | Webhook Killed | 15s Latency Injected | Recovery |
|---|---:|---:|---:|---:|
| Deployment Creation Time | $< 2\text{s}$ | ~10s (timeout + proceed) | ~15s (timeout + proceed) | $< 2\text{s}$ |
| Security Policy Enforced | Yes | No (failurePolicy: Ignore) | No (timeout) | Yes |
| API Server Stability | Healthy | Healthy | Healthy | Healthy |
| kube-system Operations | Normal | Normal (excluded) | Normal (excluded) | Normal |

---

# 15. Final Assessment & Key Technical Takeaways

```text
failurePolicy: Ignore
    =
Non-critical webhooks (label injection, defaults)
    =
Operations proceed when webhook is down

failurePolicy: Fail
    =
Security-critical webhooks (image policy, pod security)
    =
Operations BLOCKED when webhook is down

namespaceSelector excluding kube-system
    =
CRITICAL to prevent self-lockout!

timeoutSeconds: 30 (too high)
    =
Every API operation delayed by up to 30s during webhook issues

timeoutSeconds: 5
    =
Fast timeout, minimal impact on API Server performance

Webhook Replicas: 3
    =
High availability — survives single pod failure

Successful Webhook Chaos
    =
failurePolicy: Ignore bypasses non-critical correctly
    +
failurePolicy: Fail blocks unauthorized operations
    +
kube-system operations unaffected
    +
Alerts fire within 60 seconds
    +
Clean recovery on webhook restart
```
