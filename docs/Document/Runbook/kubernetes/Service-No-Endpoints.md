# Kubernetes Service No Endpoints — Runbook

**Service:** Kubernetes Cluster  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on application impact

## 1. Trigger

Use this runbook when:

- `kubectl get endpoints` shows `<none>`.
- A Service has no backend endpoints.
- Ingress/Gateway returns `503 No Healthy Upstream`.
- Applications cannot reach a Kubernetes Service.
- Service discovery works, but there are no backend Pods.

---

## 2. Quick Decision Flow

```text
Service Has No Endpoints
          ↓
Check Service
          ↓
Check Selector
          ↓
Check Pod Labels
          ↓
Check Pod Ready Status
          ↓
Check EndpointSlices
          ↓
Check Ports
          ↓
Fix Root Cause
          ↓
Verify Endpoints
          ↓
Test Service
          ↓
Verify Application
```

---

## 3. Step 1 — Confirm No Endpoints

```bash
kubectl get svc <service-name> -n <namespace>
```

Then:

```bash
kubectl get endpoints <service-name> -n <namespace>
```

Problem example:

```text
NAME          ENDPOINTS
my-service    <none>
```

Also check EndpointSlices:

```bash
kubectl get endpointslice -n <namespace>   -l kubernetes.io/service-name=<service-name>
```

---

## 4. Step 2 — Describe the Service

```bash
kubectl describe svc <service-name> -n <namespace>
```

Check:

```text
Selector
Type
IP
Port
TargetPort
Endpoints
```

Example:

```text
Selector: app=my-app
Port: 80
TargetPort: 3000
Endpoints: <none>
```

The Service selector is the first thing to verify.

---

## 5. Step 3 — Check Service Selector

Get the Service YAML:

```bash
kubectl get svc <service-name>   -n <namespace> -o yaml
```

Look for:

```yaml
spec:
  selector:
    app: my-app
```

Now find matching Pods:

```bash
kubectl get pods -n <namespace>   -l app=my-app
```

If no Pods are returned, the Service selector does not match the available Pods.

---

## 6. Step 4 — Compare Pod Labels

Check Pod labels:

```bash
kubectl get pods -n <namespace> --show-labels
```

Or:

```bash
kubectl get pod <pod-name>   -n <namespace> -o jsonpath='{.metadata.labels}'
```

Compare:

```text
Service selector
        VS
Pod labels
```

Example:

```text
Service:
app=my-app

Pod:
app=myapp
```

These do not match.

Fix the Service selector or Pod labels through the owning Deployment/StatefulSet configuration.

> Do not manually modify a controller-managed Pod label as a permanent fix.

---

## 7. Step 5 — Check Pod Status

```bash
kubectl get pods -n <namespace> -o wide
```

Look for:

```text
Running
Pending
CrashLoopBackOff
ContainerCreating
ImagePullBackOff
Terminating
```

Describe the Pod:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Check:

```text
Conditions
Ready
Readiness probe
Events
Container status
```

A Pod can be:

```text
Running
Ready=False
```

and therefore not appear as a usable Service endpoint.

---

## 8. Step 6 — Check Readiness

Check Pod readiness:

```bash
kubectl get pods -n <namespace>
```

Example:

```text
READY   STATUS
0/1     Running
```

Check the readiness probe:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look for:

```text
Readiness probe failed
```

If readiness is failing, test the application health endpoint:

```bash
kubectl exec -it <pod-name> -n <namespace> -- curl -f http://127.0.0.1:<port>/health
```

If the container does not include `curl`, use an approved diagnostic method.

If the Pod is not Ready, use the appropriate runbook:

```text
Pod-NotReady.md
```

---

## 9. Step 7 — Check EndpointSlices

```bash
kubectl get endpointslice -n <namespace>   -l kubernetes.io/service-name=<service-name> -o yaml
```

Check:

```text
addresses
conditions.ready
conditions.serving
conditions.terminating
ports
```

Healthy endpoints should have usable addresses and appropriate readiness/serving conditions.

---

## 10. Step 8 — Check Service Port and TargetPort

```bash
kubectl get svc <service-name>   -n <namespace> -o yaml
```

Example:

```yaml
ports:
  - port: 80
    targetPort: 3000
```

Verify the application actually listens on `3000`.

Inside the Pod:

```bash
kubectl exec -it <pod-name> -n <namespace> --   sh -c 'ss -lntp || netstat -lntp'
```

If the application listens on a different port, fix the Service or application configuration.

> A wrong port commonly causes connection failures after endpoints exist; it is still important to verify it before declaring the Service recovered.

---

## 11. Step 9 — Check Deployment

```bash
kubectl get deployment <deployment-name>   -n <namespace>
```

Check:

```text
READY
UP-TO-DATE
AVAILABLE
```

Describe:

```bash
kubectl describe deployment <deployment-name>   -n <namespace>
```

Look for:

```text
ReplicaFailure
ProgressDeadlineExceeded
FailedCreate
Unavailable replicas
```

If the Deployment is not producing healthy Pods, use:

```text
Deployment-Rollout-Failure.md
```

---

## 12. Step 10 — Check StatefulSet if Applicable

For StatefulSet workloads:

```bash
kubectl get statefulset -n <namespace>
```

Then:

```bash
kubectl describe statefulset <statefulset-name>   -n <namespace>
```

Check whether the expected Pods exist and are Ready.

---

## 13. Step 11 — Check NetworkPolicy

```bash
kubectl get networkpolicy -n <namespace>
```

Inspect relevant policies:

```bash
kubectl describe networkpolicy <policy-name>   -n <namespace>
```

A NetworkPolicy usually does not remove a Pod from EndpointSlices simply because traffic is blocked, but it can make an otherwise healthy endpoint unreachable.

If endpoints exist but connections fail, investigate NetworkPolicy/networking.

---

## 14. Step 12 — Check Manual / Headless Service Cases

Check Service type:

```bash
kubectl get svc <service-name> -n <namespace>
```

For a headless Service:

```yaml
clusterIP: None
```

Endpoint behavior differs from a normal ClusterIP Service.

Also verify whether the Service intentionally has:

```yaml
selector: {}
```

or no selector.

Services without selectors may use manually managed EndpointSlices or external endpoints.

> Do not add a selector to a deliberately selector-less Service without confirming its design.

---

## 15. Step 13 — Fix the Root Cause

### Wrong Selector

Fix:

```text
Service selector
or
Deployment/Pod labels
```

### Pods Not Ready

Fix:

```text
Readiness probe
Application startup
Application health
Configuration
Dependencies
```

### No Pods

Fix:

```text
Deployment
StatefulSet
Job
Scaling
Scheduling
```

### Wrong Port

Fix:

```text
Service port
targetPort
Application listening port
```

### EndpointSlice Problem

Investigate:

```text
EndpointSlice controller
Service configuration
Pod readiness
Cluster state
```

---

## 16. Step 14 — Verify Endpoints

```bash
kubectl get endpoints <service-name> -n <namespace>
```

Expected:

```text
10.0.1.20:3000,10.0.1.21:3000
```

Also:

```bash
kubectl get endpointslice -n <namespace>   -l kubernetes.io/service-name=<service-name>
```

Confirm healthy backend addresses exist.

---

## 17. Step 15 — Test Service Internally

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

Expected:

```text
HTTP 200
```

---

## 18. Step 16 — Verify External Access

If the Service is behind Ingress/Gateway:

```bash
curl -v https://<domain>/health
```

Expected:

```text
HTTP 200
```

If the external layer still reports:

```text
503 No Healthy Upstream
```

use:

```text
No-Healthy-Upstream.md
```

---

## 19. Do NOT Do These Things

### ❌ Don't manually create Endpoint objects

Fix the Service selector/Pods unless the Service is intentionally selector-less.

### ❌ Don't change Pod labels manually

For Deployment/StatefulSet workloads, fix labels in the controller specification.

### ❌ Don't delete and recreate the Service blindly

You can break IPs, routes, and dependent resources.

### ❌ Don't assume Running means Ready

A Running Pod with `Ready=False` may not be a usable endpoint.

### ❌ Don't add a Service selector to a selector-less Service blindly

It may intentionally use manually managed endpoints.

### ❌ Don't restart all Pods immediately

Find why endpoints are missing first.

---

## 20. Quick Reference

```bash
# Service
kubectl get svc <service-name> -n <namespace>
kubectl describe svc <service-name> -n <namespace>

# Endpoints
kubectl get endpoints <service-name> -n <namespace>

# EndpointSlices
kubectl get endpointslice -n <namespace>   -l kubernetes.io/service-name=<service-name>

# Service YAML
kubectl get svc <service-name> -n <namespace> -o yaml

# Pods
kubectl get pods -n <namespace> -o wide
kubectl get pods -n <namespace> --show-labels

# Pod details
kubectl describe pod <pod-name> -n <namespace>

# Deployment
kubectl get deployment <deployment-name> -n <namespace>
kubectl describe deployment <deployment-name> -n <namespace>

# NetworkPolicy
kubectl get networkpolicy -n <namespace>

# Internal Service test
kubectl run net-debug --rm -it   --image=curlimages/curl   -n <namespace> -- sh

# External test
curl -v https://<domain>/health
```

---

## 21. Recovery Criteria

- [ ] Service exists and is correct.
- [ ] Service selector matches intended Pods.
- [ ] Expected Pods exist.
- [ ] Pods are `Running`.
- [ ] Pods are `Ready`.
- [ ] Readiness probes pass.
- [ ] EndpointSlices contain healthy addresses.
- [ ] Service port and `targetPort` are correct.
- [ ] Application listens on the expected port.
- [ ] Internal Service test succeeds.
- [ ] Ingress/Gateway test succeeds where applicable.
- [ ] Application health check succeeds.
- [ ] No continuing `503 No Healthy Upstream` errors.

---

## 22. Escalation

Escalate to **Kubernetes/SRE** when:

- Service has no endpoints despite healthy matching Pods.
- EndpointSlices are not updating correctly.
- Multiple Services lose endpoints.
- Controller or cluster behavior appears abnormal.

Escalate to **Application Owner** when:

- Pods are not Ready.
- Readiness probes fail.
- Application is not listening on the expected port.
- Application startup/configuration is failing.

Escalate to **Network/Infrastructure** when:

- Endpoints exist but traffic cannot reach Pods.
- NetworkPolicy or CNI/networking problems are suspected.
- Ingress/Gateway/load-balancer connectivity fails.

---

## Golden Rule

```text
Service Has No Endpoints
          ↓
CHECK SERVICE SELECTOR
          ↓
CHECK POD LABELS
          ↓
CHECK POD READY STATUS
          ↓
CHECK ENDPOINTS / ENDPOINTSLICES
          ↓
CHECK PORT / targetPort
          ↓
FIX ROOT CAUSE
          ↓
TEST SERVICE
          ↓
VERIFY APPLICATION
```

> **No endpoints = start with the Service selector and Pod labels, then check Pod readiness. Do not restart everything before identifying why Kubernetes has no healthy backend endpoints.**
