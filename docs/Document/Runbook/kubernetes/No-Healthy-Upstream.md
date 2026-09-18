# Kubernetes No Healthy Upstream — Runbook

**Service:** Kubernetes / Ingress / Gateway  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on application impact  
**Applies to:** Kubernetes Services behind Ingress, Gateway API, load balancers, or reverse proxies

**Purpose:** Diagnose and recover `503 No Healthy Upstream` errors when a proxy or load balancer cannot find a healthy backend endpoint.

---

## 1. Trigger

Use this runbook when:

- Browser/API returns `503 No Healthy Upstream`.
- Ingress or Gateway reports no healthy backend.
- Load balancer cannot reach the application.
- Service has no usable endpoints.
- Pods exist but are failing readiness checks.

> ⚠️ **Do not restart the whole cluster or delete the Service first. Check the traffic path from Gateway/Ingress → Service → Endpoints → Pods.**

---

## 2. Quick Decision Flow

```text
No Healthy Upstream
        │
        ▼
Check Ingress / Gateway
        │
        ▼
Check Service
        │
        ▼
Check Endpoints
        │
   ┌────┴─────┐
   ▼          ▼
Endpoints    No Endpoints
   │              │
   ▼              ▼
Check Pods      Check
   │            Selector
   ▼              │
Check Ready       ▼
   │           Fix Service
   ▼           / Deployment
Check Port
   │
   ▼
Check Readiness
   │
   ▼
Test Service
   │
   ▼
Verify External Access
```

---

## 3. Step 1 — Confirm the Error

Test the application:

```bash
curl -I https://<domain>
```

Or:

```bash
curl -v https://<domain>
```

Expected problem:

```text
HTTP/1.1 503
No healthy upstream
```

Identify the traffic path:

```text
Client
  ↓
DNS
  ↓
Load Balancer / CDN
  ↓
Ingress / Gateway
  ↓
HTTPRoute / Ingress Rule
  ↓
Service
  ↓
Endpoints / EndpointSlices
  ↓
Pods
```

---

## 4. Step 2 — Check Ingress / Gateway

For Ingress:

```bash
kubectl get ingress -A
```

```bash
kubectl describe ingress <ingress-name> -n <namespace>
```

For Gateway API:

```bash
kubectl get gateway -A
```

```bash
kubectl describe gateway <gateway-name> -n <namespace>
```

Check HTTPRoutes:

```bash
kubectl get httproute -A
```

```bash
kubectl describe httproute <route-name> -n <namespace>
```

Look for:

```text
Accepted=True
ResolvedRefs=True
Programmed=True
BackendRef errors
No matching backend
```

---

## 5. Step 3 — Check the Kubernetes Service

```bash
kubectl get svc <service-name> -n <namespace>
```

Then:

```bash
kubectl describe svc <service-name> -n <namespace>
```

Check:

```text
Selector
Port
TargetPort
Endpoints
```

Example:

```text
Port:       80
TargetPort: 3000
```

Verify the application actually listens on the target port.

---

## 6. Step 4 — Check Endpoints

Run:

```bash
kubectl get endpoints <service-name> -n <namespace>
```

Also check EndpointSlices:

```bash
kubectl get endpointslice -n <namespace> \
  -l kubernetes.io/service-name=<service-name>
```

### Case A — No endpoints

Example:

```text
ENDPOINTS: <none>
```

This usually means:

```text
Service selector does not match pods
OR
Pods are not Ready
OR
Pods do not belong to the Service
```

Continue to Step 5.

### Case B — Endpoints exist

Continue to Step 6.

---

## 7. Step 5 — Check Service Selector and Pod Labels

Get Service selector:

```bash
kubectl get svc <service-name> \
  -n <namespace> \
  -o yaml
```

Look for:

```yaml
spec:
  selector:
    app: my-app
```

Check pod labels:

```bash
kubectl get pods -n <namespace> --show-labels
```

Verify the labels match.

You can also test:

```bash
kubectl get pods -n <namespace> \
  -l app=my-app
```

If no pods are returned, the Service selector is wrong or the expected pods do not exist.

---

## 8. Step 6 — Check Pod Status

```bash
kubectl get pods -n <namespace> -o wide
```

Look for:

```text
Running
Ready
CrashLoopBackOff
ContainerCreating
Pending
ImagePullBackOff
Terminating
```

For a specific pod:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Check:

```text
Conditions
Readiness
Events
Container ports
Restart count
Readiness probe
Liveness probe
```

If pods are not Ready, they may not become healthy Service endpoints.

Use the appropriate pod runbook:

```text
Pod-ContainerCreating.md
Pod-CrashLoopBackOff.md
Pod-ImagePullBackOff.md
Pod-Pending.md
Pod-Terminating.md
```

---

## 9. Step 7 — Check Readiness Probe

Inspect the Deployment:

```bash
kubectl get deployment <deployment-name> \
  -n <namespace> -o yaml
```

Look for:

```yaml
readinessProbe:
```

Check pod conditions:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

A failing readiness probe can cause:

```text
Pod Running
     ↓
Pod NotReady
     ↓
Removed from Service endpoints
     ↓
No healthy upstream
```

Test the health endpoint from inside the pod:

```bash
kubectl exec -it <pod-name> -n <namespace> -- \
curl -f http://127.0.0.1:<port>/health
```

If `curl` is unavailable, use an appropriate diagnostic method for the container.

---

## 10. Step 8 — Check Service Port and TargetPort

Check:

```bash
kubectl get svc <service-name> \
  -n <namespace> -o yaml
```

Example:

```yaml
ports:
  - port: 80
    targetPort: 3000
```

Verify the application listens on port `3000`.

Inside the pod:

```bash
kubectl exec -it <pod-name> -n <namespace> -- \
  sh -c 'ss -lntp || netstat -lntp'
```

If the application listens on a different port, fix the Service or application configuration.

---

## 11. Step 9 — Test the Service Directly

Create a temporary diagnostic pod if needed:

```bash
kubectl run net-debug \
  --rm -it \
  --image=curlimages/curl \
  -n <namespace> \
  -- sh
```

From the debug pod:

```bash
curl -v http://<service-name>:<port>/health
```

Or:

```bash
curl -v http://<service-name>.<namespace>.svc.cluster.local:<port>/health
```

Interpretation:

```text
Service works
    ↓
Problem likely Ingress/Gateway/LB

Service fails
    ↓
Problem likely Service/Pod/application
```

---

## 12. Step 10 — Test Pod Directly

Get the Pod IP:

```bash
kubectl get pod <pod-name> \
  -n <namespace> \
  -o wide
```

From a diagnostic pod:

```bash
curl -v http://<pod-ip>:<container-port>/health
```

If Pod IP works but Service does not:

```text
Check Service selector
Check Service port
Check targetPort
Check EndpointSlice
Check kube-proxy/CNI/networking
```

If Pod IP itself fails:

```text
Check application
Check container port
Check readiness
Check network policy
```

---

## 13. Step 11 — Check NetworkPolicy

```bash
kubectl get networkpolicy -n <namespace>
```

Inspect:

```bash
kubectl describe networkpolicy <policy-name> -n <namespace>
```

A NetworkPolicy can block traffic:

```text
Ingress/Gateway
     ↓
Service
     ↓
Pod
     X
NetworkPolicy
```

Verify that required traffic is allowed.

---

## 14. Step 12 — Check Gateway / Ingress Backend Configuration

For HTTPRoute:

```bash
kubectl describe httproute <route-name> -n <namespace>
```

Verify:

```text
backendRefs
Service name
Service port
Route status
```

For Ingress:

```bash
kubectl describe ingress <ingress-name> -n <namespace>
```

Verify:

```text
Backend
Service
Port
Rules
TLS
```

Common mistakes:

```text
Wrong Service name
Wrong namespace
Wrong port
Missing backend
Invalid reference
Route not accepted
```

---

## 15. Step 13 — Check Load Balancer / Gateway Health

If the Kubernetes Service and Pods are healthy but external traffic still returns:

```text
503 No Healthy Upstream
```

check the external layer:

```text
Cloud Load Balancer
Gateway
Ingress Controller
CDN
HAProxy
Reverse Proxy
```

Check controller logs where applicable:

```bash
kubectl logs -n <ingress-namespace> \
  <ingress-controller-pod>
```

Look for:

```text
upstream unavailable
backend unhealthy
connection refused
timeout
no endpoints
```

---

## 16. Step 14 — Fix the Root Cause

### No Endpoints

Fix:

```text
Service selector
Pod labels
Pod readiness
```

### Pods Not Ready

Fix:

```text
Readiness probe
Application startup
Application health endpoint
Configuration
Secrets
Dependencies
```

### Wrong Port

Fix:

```text
Service port
targetPort
containerPort
Application listening port
```

### Route/Gateway Problem

Fix:

```text
HTTPRoute
Ingress
Gateway
BackendRef
TLS
```

### NetworkPolicy

Allow the required traffic according to the approved network policy.

### External Load Balancer

Check:

```text
Backend health
Health checks
Listener
Target port
Firewall
Network
```

---

## 17. Step 15 — Verify Recovery

Test externally:

```bash
curl -I https://<domain>
```

Expected:

```text
HTTP/2 200
```

Check Service:

```bash
kubectl get svc <service-name> -n <namespace>
```

Check endpoints:

```bash
kubectl get endpoints <service-name> -n <namespace>
```

Check pods:

```bash
kubectl get pods -n <namespace>
```

Expected:

```text
Running
Ready
```

Check route:

```bash
kubectl get httproute -n <namespace>
```

or:

```bash
kubectl get ingress -n <namespace>
```

---

## 18. Do NOT Do These Things

### ❌ Don't restart all pods immediately

First determine whether the problem is Service, readiness, port, or Gateway related.

### ❌ Don't delete the Service blindly

You may remove a working configuration.

### ❌ Don't set readiness probes to always succeed

That hides the real application problem.

### ❌ Don't expose the application directly as a workaround

Maintain the intended network/security architecture.

### ❌ Don't change Gateway/Ingress configuration without checking backend endpoints

The problem may be the Pods or Service.

### ❌ Don't assume `Pod Running` means healthy

A pod can be:

```text
Running
Ready=False
```

and therefore unavailable as a Service backend.

---

## 19. Quick Reference

```bash
# Nodes
kubectl get nodes

# Pods
kubectl get pods -n <namespace> -o wide

# Service
kubectl get svc <service-name> -n <namespace>
kubectl describe svc <service-name> -n <namespace>

# Endpoints
kubectl get endpoints <service-name> -n <namespace>

# EndpointSlices
kubectl get endpointslice -n <namespace> \
  -l kubernetes.io/service-name=<service-name>

# Pod details
kubectl describe pod <pod-name> -n <namespace>

# Ingress
kubectl get ingress -A
kubectl describe ingress <ingress-name> -n <namespace>

# Gateway
kubectl get gateway -A
kubectl describe gateway <gateway-name> -n <namespace>

# HTTPRoute
kubectl get httproute -A
kubectl describe httproute <route-name> -n <namespace>

# NetworkPolicy
kubectl get networkpolicy -n <namespace>

# Service test
kubectl run net-debug \
  --rm -it \
  --image=curlimages/curl \
  -n <namespace> \
  -- sh

# External test
curl -v https://<domain>
```

---

## 20. Recovery Criteria

- [ ] External `503 No Healthy Upstream` is resolved.
- [ ] Service exists and is correct.
- [ ] Service selector matches intended pods.
- [ ] Endpoints/EndpointSlices contain healthy addresses.
- [ ] Pods are `Running`.
- [ ] Pods are `Ready`.
- [ ] Readiness probes pass.
- [ ] Service `port` and `targetPort` are correct.
- [ ] Application is listening on the expected port.
- [ ] NetworkPolicy allows required traffic.
- [ ] Ingress/Gateway route is accepted and configured correctly.
- [ ] Load balancer/backend health is normal.
- [ ] Direct Service test succeeds.
- [ ] External application test succeeds.
- [ ] No continuing 503 errors.

---

## 21. Escalation

Escalate to **Kubernetes/SRE** when:

- Service has no healthy endpoints.
- Pods repeatedly fail readiness.
- Gateway/Ingress configuration is incorrect.
- Multiple services are affected.

Escalate to **Application Owner** when:

- Application health endpoint fails.
- Pods are Running but not Ready.
- Application listens on the wrong port.
- Application dependency/configuration is failing.

Escalate to **Infrastructure/Network** when:

- Load balancer health checks fail.
- NetworkPolicy/network connectivity is suspected.
- Gateway, firewall, routing, or external LB problems exist.

---

## Golden Rule

```text
No Healthy Upstream
        ↓
CHECK GATEWAY / INGRESS
        ↓
CHECK SERVICE
        ↓
CHECK ENDPOINTS
        ↓
CHECK POD READY STATUS
        ↓
CHECK READINESS PROBE
        ↓
CHECK PORT / targetPort
        ↓
TEST SERVICE DIRECTLY
        ↓
CHECK NETWORK POLICY
        ↓
FIX ROOT CAUSE
        ↓
VERIFY EXTERNAL ACCESS
```

> **No Healthy Upstream = follow the traffic path from Gateway/Ingress → Service → Endpoints → Pods. Find the first broken layer instead of restarting everything.**
