# Kubernetes Ingress 503 — Runbook

**Service:** Kubernetes Ingress / Application  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on application impact

## 1. Trigger

Use this runbook when:

- Ingress returns HTTP `503 Service Unavailable`.
- Application is reachable through the Service but not through Ingress.
- Load balancer reports backend unavailable.
- Ingress controller cannot reach a healthy backend.

---

## 2. Quick Decision Flow

```text
Ingress 503
    ↓
Check Ingress
    ↓
Check Ingress Controller
    ↓
Check Service
    ↓
Check Endpoints
    ↓
Check Pods Ready
    ↓
Check Service Port
    ↓
Test Service Directly
    ↓
Check TLS / Load Balancer
    ↓
Fix Root Cause
    ↓
Verify External Access
```

---

## 3. Step 1 — Confirm 503

```bash
curl -v https://<domain>
```

Check:

```text
HTTP/1.1 503
```

Identify the traffic path:

```text
Client
  ↓
DNS
  ↓
Load Balancer
  ↓
Ingress
  ↓
Service
  ↓
Endpoints
  ↓
Pods
```

---

## 4. Step 2 — Check Ingress

```bash
kubectl get ingress -A
```

Check the specific Ingress:

```bash
kubectl describe ingress <ingress-name> -n <namespace>
```

Verify:

```text
Host
Rules
Backend
Service
Port
TLS
Events
```

Check YAML:

```bash
kubectl get ingress <ingress-name>   -n <namespace> -o yaml
```

Look for:

```text
Wrong Service name
Wrong Service port
Wrong namespace
Invalid backend
TLS configuration problem
```

---

## 5. Step 3 — Check Ingress Controller

Find the controller:

```bash
kubectl get pods -A | grep -i ingress
```

Check status:

```bash
kubectl get pods -n <ingress-namespace>
```

Look for:

```text
Running
Ready
CrashLoopBackOff
Pending
```

Check logs:

```bash
kubectl logs <ingress-controller-pod>   -n <ingress-namespace>
```

Search for:

```bash
kubectl logs <ingress-controller-pod>   -n <ingress-namespace> |   grep -Ei 'error|503|upstream|backend|timeout|connection refused'
```

---

## 6. Step 4 — Check Service

```bash
kubectl get svc <service-name> -n <namespace>
```

Describe:

```bash
kubectl describe svc <service-name> -n <namespace>
```

Verify:

```text
Port
TargetPort
Selector
Endpoints
```

Example:

```text
Port:       80
TargetPort: 3000
```

Make sure the application listens on the target port.

---

## 7. Step 5 — Check Endpoints

```bash
kubectl get endpoints <service-name> -n <namespace>
```

Also:

```bash
kubectl get endpointslice -n <namespace>   -l kubernetes.io/service-name=<service-name>
```

### If endpoints are empty

```text
Service selector mismatch
OR
Pods are not Ready
OR
Expected Pods do not exist
```

Use:

```text
Service-No-Endpoints.md
```

### If endpoints exist

Continue to Step 6.

---

## 8. Step 6 — Check Pods

```bash
kubectl get pods -n <namespace> -o wide
```

Check:

```text
Running
Ready
Restart count
```

Describe a backend Pod:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look for:

```text
Readiness probe failed
CrashLoopBackOff
OOMKilled
ContainerCreating
ImagePullBackOff
```

Use the relevant Pod runbook if required.

---

## 9. Step 7 — Check Readiness

A Pod can be:

```text
Running
Ready=False
```

and therefore unavailable to Ingress.

Check:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look for:

```text
Readiness probe failed
```

Test health from inside the Pod:

```bash
kubectl exec -it <pod-name> -n <namespace> -- curl -f http://127.0.0.1:<port>/health
```

If the health check fails, fix the application/readiness probe first.

---

## 10. Step 8 — Check Service Port

```bash
kubectl get svc <service-name>   -n <namespace> -o yaml
```

Example:

```yaml
ports:
  - port: 80
    targetPort: 3000
```

Verify the application listens on:

```text
3000
```

Inside the Pod:

```bash
kubectl exec -it <pod-name> -n <namespace> --   sh -c 'ss -lntp || netstat -lntp'
```

A wrong `targetPort` can cause:

```text
Ingress
  ↓
Service
  ↓
Wrong port
  ↓
Connection refused
  ↓
503
```

---

## 11. Step 9 — Test Service Directly

Create a temporary diagnostic Pod:

```bash
kubectl run net-debug   --rm -it   --image=curlimages/curl   -n <namespace>   -- sh
```

Test:

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
Investigate Ingress / Load Balancer

Service fails
    ↓
Investigate Service / Pods / Application
```

---

## 12. Step 10 — Check Ingress Backend Configuration

Verify that the Ingress points to the correct Service:

```bash
kubectl get ingress <ingress-name>   -n <namespace> -o yaml
```

Check:

```text
service.name
service.port
host
path
pathType
```

Common mistakes:

```text
Wrong Service
Wrong port
Wrong path
Wrong host
Wrong namespace
```

---

## 13. Step 11 — Check TLS

If HTTPS is failing:

```bash
kubectl describe ingress <ingress-name> -n <namespace>
```

Check TLS secret:

```bash
kubectl get secret <tls-secret> -n <namespace>
```

Verify:

```text
Secret exists
Secret is in the correct namespace
Certificate is valid
Certificate matches the domain
```

If the problem is specifically certificate-related, use:

```text
Ingress-TLS-Failure.md
```

---

## 14. Step 12 — Check Load Balancer

If:

```text
Service works
AND
Ingress configuration looks correct
BUT
External request still returns 503
```

check:

```text
Load Balancer
Health checks
Backend service
Firewall
Network connectivity
Ingress controller Service
```

Check controller Service:

```bash
kubectl get svc -n <ingress-namespace>
```

Describe:

```bash
kubectl describe svc <ingress-controller-service>   -n <ingress-namespace>
```

---

## 15. Step 13 — Check NetworkPolicy

```bash
kubectl get networkpolicy -n <namespace>
```

Inspect relevant policies:

```bash
kubectl describe networkpolicy <policy-name>   -n <namespace>
```

Verify that required traffic from the Ingress controller to the application Pods is allowed.

---

## 16. Step 14 — Fix the Root Cause

### No Endpoints

Fix:

```text
Service selector
Pod labels
Pod readiness
```

Use:

```text
Service-No-Endpoints.md
```

### Pod Not Ready

Fix:

```text
Readiness probe
Application health
Application startup
Dependencies
```

### Wrong Port

Fix:

```text
Ingress backend port
Service port
Service targetPort
Application listening port
```

### Ingress Controller Failure

Fix:

```text
Controller Pod
Controller configuration
Controller Service
```

### Load Balancer Failure

Fix:

```text
Backend health
Health checks
Firewall
Routing
Load Balancer configuration
```

---

## 17. Step 15 — Verify Recovery

External test:

```bash
curl -v https://<domain>/health
```

Expected:

```text
HTTP 200
```

Check Ingress:

```bash
kubectl get ingress -n <namespace>
```

Check Service:

```bash
kubectl get svc <service-name> -n <namespace>
```

Check endpoints:

```bash
kubectl get endpoints <service-name> -n <namespace>
```

Check Pods:

```bash
kubectl get pods -n <namespace>
```

Expected:

```text
Running
Ready
```

Check controller:

```bash
kubectl get pods -n <ingress-namespace>
```

---

## 18. Do NOT Do These Things

### ❌ Don't restart all application Pods immediately

First identify whether the failure is Ingress, Service, endpoints, or Pods.

### ❌ Don't delete the Ingress blindly

You may lose routing configuration.

### ❌ Don't expose the application directly as a workaround

Maintain the intended architecture and security controls.

### ❌ Don't assume a Running Pod is healthy

Verify `Ready=True`.

### ❌ Don't change multiple networking components at once

Make one controlled change and verify the result.

### ❌ Don't ignore an empty endpoint list

A Service with no healthy endpoints is a common cause of 503 responses.

---

## 19. Quick Reference

```bash
# External test
curl -v https://<domain>

# Ingress
kubectl get ingress -A
kubectl describe ingress <ingress-name> -n <namespace>

# Ingress controller
kubectl get pods -A | grep -i ingress
kubectl logs <ingress-controller-pod> -n <ingress-namespace>

# Service
kubectl get svc <service-name> -n <namespace>
kubectl describe svc <service-name> -n <namespace>

# Endpoints
kubectl get endpoints <service-name> -n <namespace>

# EndpointSlices
kubectl get endpointslice -n <namespace>   -l kubernetes.io/service-name=<service-name>

# Pods
kubectl get pods -n <namespace> -o wide
kubectl describe pod <pod-name> -n <namespace>

# NetworkPolicy
kubectl get networkpolicy -n <namespace>

# TLS
kubectl get secret <tls-secret> -n <namespace>
```

---

## 20. Recovery Criteria

- [ ] HTTP 503 confirmed.
- [ ] Ingress configuration verified.
- [ ] Ingress controller is healthy.
- [ ] Service exists.
- [ ] Service selector is correct.
- [ ] Service has healthy endpoints.
- [ ] Backend Pods are `Running`.
- [ ] Backend Pods are `Ready`.
- [ ] Readiness probes pass.
- [ ] Service port and `targetPort` are correct.
- [ ] Direct Service request succeeds.
- [ ] TLS configuration verified where applicable.
- [ ] Load Balancer health is normal where applicable.
- [ ] NetworkPolicy allows required traffic.
- [ ] External request returns expected HTTP status.
- [ ] Application health check succeeds.

---

## 21. Escalation

Escalate to **Kubernetes/SRE** when:

- Ingress controller is unhealthy.
- Multiple Ingress resources return 503.
- Service/endpoints are abnormal.
- Gateway/Ingress configuration is failing.

Escalate to **Application Owner** when:

- Backend Pods are not Ready.
- Application health checks fail.
- Application is listening on the wrong port.
- Application startup/dependencies are failing.

Escalate to **Network/Infrastructure** when:

- Load Balancer health checks fail.
- External routing/firewall problems exist.
- Network connectivity between load balancer and cluster is failing.

---

## Golden Rule

```text
Ingress 503
    ↓
CHECK INGRESS
    ↓
CHECK INGRESS CONTROLLER
    ↓
CHECK SERVICE
    ↓
CHECK ENDPOINTS
    ↓
CHECK POD READY
    ↓
CHECK SERVICE PORT
    ↓
TEST SERVICE DIRECTLY
    ↓
CHECK TLS / LOAD BALANCER
    ↓
FIX ROOT CAUSE
    ↓
VERIFY EXTERNAL ACCESS
```

> **Ingress 503 = trace the request path from Ingress → Service → Endpoints → Pods. Find the first broken layer instead of restarting everything.**
