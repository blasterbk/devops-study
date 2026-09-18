# Kubernetes Deployment Rollout Failure — Runbook

**Service:** Kubernetes Cluster  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on application impact

## 1. Trigger

Use this runbook when:

- Deployment rollout does not complete.
- `kubectl rollout status` remains stuck.
- New Pods are not becoming Ready.
- `AVAILABLE` replicas are below the desired count.
- Deployment shows `ProgressDeadlineExceeded`.
- A new application version is causing failures.

---

## 2. Quick Decision Flow

```text
Deployment Rollout Failure
          ↓
Check Deployment
          ↓
Check Rollout Status
          ↓
Check ReplicaSet
          ↓
Check New Pods
          ↓
Check Pod Events / Logs
          ↓
Identify Root Cause
          ↓
Fix or Roll Back
          ↓
Verify Rollout
          ↓
Verify Application
```

---

## 3. Step 1 — Check Deployment

```bash
kubectl get deployment <deployment-name> -n <namespace>
```

Check:

```text
READY
UP-TO-DATE
AVAILABLE
```

Example:

```text
NAME       READY   UP-TO-DATE   AVAILABLE
my-app     2/3     2            2
```

Describe:

```bash
kubectl describe deployment <deployment-name> -n <namespace>
```

Look for:

```text
ProgressDeadlineExceeded
ReplicaFailure
FailedCreate
Unavailable replicas
Events
```

---

## 4. Step 2 — Check Rollout Status

```bash
kubectl rollout status deployment/<deployment-name>   -n <namespace>
```

If it remains stuck, continue troubleshooting.

Check rollout history:

```bash
kubectl rollout history deployment/<deployment-name>   -n <namespace>
```

---

## 5. Step 3 — Check ReplicaSets

```bash
kubectl get rs -n <namespace>
```

For the Deployment:

```bash
kubectl get rs   -n <namespace>   -l app=<app-label>
```

Identify:

```text
Old ReplicaSet
New ReplicaSet
Desired replicas
Current replicas
Ready replicas
```

Describe the new ReplicaSet:

```bash
kubectl describe rs <new-rs-name> -n <namespace>
```

Look for:

```text
FailedCreate
ImagePullBackOff
Insufficient resources
Admission errors
```

---

## 6. Step 4 — Check Pods

```bash
kubectl get pods -n <namespace> -o wide
```

Identify Pods belonging to the new ReplicaSet.

Look for:

```text
Running
Pending
ContainerCreating
CrashLoopBackOff
ImagePullBackOff
ErrImagePull
OOMKilled
```

Describe a failing Pod:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Check events:

```bash
kubectl get events   -n <namespace>   --sort-by=.lastTimestamp
```

---

## 7. Step 5 — Check Pod Logs

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
Application startup failure
Configuration error
Missing environment variable
Missing Secret
Missing ConfigMap
Database connection failure
Port binding failure
CrashLoopBackOff
```

Use the relevant Pod runbook when appropriate:

```text
Pod-CrashLoopBackOff.md
Pod-ImagePullBackOff.md
Pod-Pending.md
Pod-ContainerCreating.md
Pod-OOMKilled.md
```

---

## 8. Step 6 — Check Image

Inspect the Deployment:

```bash
kubectl get deployment <deployment-name>   -n <namespace> -o yaml
```

Check:

```yaml
image:
```

Verify:

```text
Image name
Tag
Registry
ImagePullSecrets
```

If Pods show:

```text
ImagePullBackOff
ErrImagePull
```

use:

```text
Pod-ImagePullBackOff.md
```

---

## 9. Step 7 — Check Readiness

A rollout can remain incomplete because new Pods are Running but not Ready.

```bash
kubectl get pods -n <namespace>
```

Example:

```text
READY   STATUS
0/1     Running
```

Describe:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look for:

```text
Readiness probe failed
```

Test the application health endpoint from the Pod:

```bash
kubectl exec -it <pod-name> -n <namespace> -- curl -f http://127.0.0.1:<port>/health
```

Fix:

```text
Readiness probe
Application startup
Application health
Dependencies
Configuration
```

---

## 10. Step 8 — Check Resources

Check Pod requests/limits:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Check node capacity:

```bash
kubectl top nodes
```

Check scheduling:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look for:

```text
Insufficient cpu
Insufficient memory
node selector mismatch
taint/toleration problem
affinity problem
```

Use:

```text
Insufficient-CPU.md
Insufficient-Memory.md
Pod-Pending.md
```

when applicable.

---

## 11. Step 9 — Check ConfigMap and Secret

Inspect Deployment:

```bash
kubectl get deployment <deployment-name>   -n <namespace> -o yaml
```

Check:

```text
env
envFrom
configMapKeyRef
secretKeyRef
volumes
volumeMounts
```

Verify resources:

```bash
kubectl get configmap -n <namespace>
kubectl get secret -n <namespace>
```

A missing Secret or ConfigMap can prevent the new version from starting.

---

## 12. Step 10 — Check Deployment Strategy

```bash
kubectl get deployment <deployment-name>   -n <namespace> -o yaml
```

Review:

```yaml
strategy:
  type: RollingUpdate
```

For RollingUpdate, check:

```text
maxUnavailable
maxSurge
```

A restrictive rollout strategy can make deployments slow or prevent progress when cluster capacity is limited.

---

## 13. Step 11 — Check Recent Change

Identify what changed:

```text
New image
New environment variable
ConfigMap
Secret
Resource requests
Readiness probe
Service port
Application code
Deployment strategy
```

Check rollout history:

```bash
kubectl rollout history deployment/<deployment-name>   -n <namespace>
```

If the failure started immediately after a deployment, compare the previous working version.

---

## 14. Step 12 — Immediate Mitigation: Roll Back

If the new version is causing production impact and the previous version was healthy:

```bash
kubectl rollout undo deployment/<deployment-name>   -n <namespace>
```

Monitor:

```bash
kubectl rollout status deployment/<deployment-name>   -n <namespace>
```

Verify:

```bash
kubectl get pods -n <namespace>
```

> Roll back first when the application is actively failing and the previous version is known to be healthy. Investigate the failed release afterward.

---

## 15. Step 13 — Roll Back to a Specific Revision

List revisions:

```bash
kubectl rollout history deployment/<deployment-name>   -n <namespace>
```

Roll back to a selected revision:

```bash
kubectl rollout undo deployment/<deployment-name>   --to-revision=<revision>   -n <namespace>
```

Verify:

```bash
kubectl rollout status deployment/<deployment-name>   -n <namespace>
```

---

## 16. Step 14 — Verify Successful Rollout

```bash
kubectl rollout status deployment/<deployment-name>   -n <namespace>
```

Expected:

```text
deployment "<deployment-name>" successfully rolled out
```

Check:

```bash
kubectl get deployment <deployment-name> -n <namespace>
```

Expected:

```text
READY        = desired
UP-TO-DATE   = desired
AVAILABLE    = desired
```

---

## 17. Step 15 — Verify Pods

```bash
kubectl get pods -n <namespace> -o wide
```

Expected:

```text
Running
Ready
```

Check restart counts:

```bash
kubectl get pods -n <namespace>
```

Investigate continuous:

```text
CrashLoopBackOff
OOMKilled
ImagePullBackOff
Pending
```

---

## 18. Step 16 — Verify Service

Check:

```bash
kubectl get svc -n <namespace>
```

Check endpoints:

```bash
kubectl get endpoints <service-name> -n <namespace>
```

Expected:

```text
Healthy Pod IPs
```

If there are no endpoints:

```text
Service-No-Endpoints.md
```

---

## 19. Step 17 — Verify Application

Test health:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Verify the main application functionality.

---

## 20. Do NOT Do These Things

### ❌ Don't delete the Deployment immediately

You may lose rollout history and configuration.

### ❌ Don't restart all Pods blindly

Find why the new version is failing.

### ❌ Don't force a rollout repeatedly

A bad image/configuration will continue failing.

### ❌ Don't roll back without checking the previous version

Confirm the previous revision was healthy when possible.

### ❌ Don't ignore readiness failures

Running does not mean Ready.

### ❌ Don't change multiple things at once

Make the smallest controlled change needed to identify the root cause.

---

## 21. Quick Reference

```bash
# Deployment
kubectl get deployment <deployment-name> -n <namespace>
kubectl describe deployment <deployment-name> -n <namespace>

# Rollout
kubectl rollout status deployment/<deployment-name> -n <namespace>
kubectl rollout history deployment/<deployment-name> -n <namespace>

# Rollback
kubectl rollout undo deployment/<deployment-name> -n <namespace>

# ReplicaSets
kubectl get rs -n <namespace>
kubectl describe rs <rs-name> -n <namespace>

# Pods
kubectl get pods -n <namespace> -o wide
kubectl describe pod <pod-name> -n <namespace>

# Logs
kubectl logs <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> --previous

# Events
kubectl get events -n <namespace> --sort-by=.lastTimestamp

# Resources
kubectl top nodes
kubectl top pods -n <namespace>

# Service
kubectl get svc -n <namespace>
kubectl get endpoints <service-name> -n <namespace>

# Application
curl -f https://<application-domain>/health
```

---

## 22. Recovery Criteria

- [ ] Rollout failure confirmed.
- [ ] Failed ReplicaSet identified.
- [ ] Failing Pods identified.
- [ ] Pod events and logs reviewed.
- [ ] Image verified.
- [ ] Readiness probe verified.
- [ ] Resources verified.
- [ ] ConfigMaps/Secrets verified.
- [ ] Recent change identified.
- [ ] Root cause fixed or previous version restored.
- [ ] Deployment rollout completed successfully.
- [ ] Desired replicas are Ready.
- [ ] Service has healthy endpoints.
- [ ] Application health check succeeds.
- [ ] No continuing rollout errors.

---

## 23. Escalation

Escalate to **Application Owner** when:

- New application version crashes.
- Readiness probe fails.
- Application configuration is incorrect.
- Application cannot connect to dependencies.

Escalate to **Kubernetes/SRE** when:

- Pods cannot schedule.
- Cluster resources are insufficient.
- Deployment controller/ReplicaSet behavior is abnormal.
- Multiple deployments are affected.

Escalate to **Infrastructure/SRE** when:

- Registry/network infrastructure is unavailable.
- Nodes lack required capacity.
- Cluster-wide infrastructure problems exist.

---

## Golden Rule

```text
Deployment Rollout Failure
          ↓
CHECK DEPLOYMENT
          ↓
CHECK ROLLOUT STATUS
          ↓
CHECK REPLICASET
          ↓
CHECK NEW PODS
          ↓
CHECK EVENTS + LOGS
          ↓
CHECK IMAGE / CONFIG / RESOURCES / READINESS
          ↓
FIX ROOT CAUSE
          ↓
ROLL BACK IF PRODUCTION IS AT RISK
          ↓
VERIFY ROLLOUT
          ↓
VERIFY SERVICE + APPLICATION
```

> **Deployment rollout failure = identify why the new ReplicaSet cannot produce healthy Ready Pods. If production is impacted and the previous version is known to be healthy, roll back first and investigate the failed release afterward.**
