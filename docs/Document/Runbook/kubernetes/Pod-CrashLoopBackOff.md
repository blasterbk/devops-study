# Kubernetes Pod `CrashLoopBackOff` — Runbook

**Service:** Kubernetes Workload
**Owner:** DevOps / SRE
**Severity:** P2–P3 depending on application impact
**Applies to:** Kubernetes clusters

**Purpose:** Quickly identify and fix Pods that repeatedly start and crash.

---

## 1. Trigger

Use this runbook when:

* Pod shows `CrashLoopBackOff`.
* Container repeatedly starts and stops.
* Deployment rollout is stuck.
* Application becomes unavailable.
* Monitoring alerts on repeated container restarts.

> **Important:** `CrashLoopBackOff` is a symptom. The application/container is crashing; Kubernetes is delaying the next restart.

---

# 2. Quick Decision Flow

```text
Pod CrashLoopBackOff
        │
        ▼
Check Pod status
        │
        ▼
Check container logs
        │
        ▼
Check previous container logs
        │
        ▼
Identify cause
        │
 ┌──────┼────────┬──────────┐
 ▼      ▼        ▼          ▼
App    Config   Resource   Dependency
Crash  /Secret  OOM        Failure
 │      │        │          │
 └──────┴────────┴──────────┘
                │
                ▼
             Fix issue
                │
                ▼
          Verify Pod Ready
                │
                ▼
        Verify application
```

---

# 3. Step 1 — Check the Pod

```bash
kubectl get pod <pod-name> -n <namespace> -o wide
```

Check:

```text
STATUS
READY
RESTARTS
AGE
NODE
```

Example:

```text
NAME        READY   STATUS             RESTARTS
api-pod     0/1     CrashLoopBackOff   8
```

---

# 4. Step 2 — Check Pod Events

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look at:

```text
Events:
```

Also check recent events:

```bash
kubectl get events -n <namespace> \
  --sort-by='.lastTimestamp' | tail -30
```

Look for:

```text
OOMKilled
Back-off restarting failed container
Failed
Unhealthy
Liveness probe failed
Readiness probe failed
FailedMount
FailedCreatePodSandbox
```

---

# 5. Step 3 — Check Current Container Logs

This is the **most important step** for CrashLoopBackOff.

```bash
kubectl logs <pod-name> -n <namespace>
```

If the Pod has multiple containers:

```bash
kubectl logs <pod-name> -n <namespace> -c <container-name>
```

Look for:

```text
Application error
Configuration error
Connection refused
Authentication failure
Database connection failure
Permission denied
Port already in use
Out of memory
```

---

# 6. Step 4 — Check Previous Container Logs

Because the container may have already crashed, use:

```bash
kubectl logs <pod-name> -n <namespace> --previous
```

For a specific container:

```bash
kubectl logs <pod-name> -n <namespace> \
  -c <container-name> --previous
```

> **Very important:** `--previous` often contains the actual error that caused the restart.

---

# 7. Step 5 — Identify the Cause

### A. Application Crash

Logs show:

```text
Exception
Fatal error
Application failed
Segmentation fault
Exit code
```

Check:

* Application logs
* Recent code deployment
* Application configuration
* Application dependencies

---

### B. Configuration / Secret Problem

Logs show:

```text
Missing environment variable
Secret not found
ConfigMap not found
Invalid configuration
Authentication failure
```

Check:

```bash
kubectl get configmap -n <namespace>
kubectl get secret -n <namespace>
```

Check Pod configuration:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

---

### C. OOM / Memory Problem

Check:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look for:

```text
Reason: OOMKilled
```

Check container resources:

```bash
kubectl get pod <pod-name> -n <namespace> -o yaml
```

Look at:

```text
resources:
  requests:
  limits:
```

Also check the node:

```bash
kubectl describe node <node-name>
```

---

### D. Liveness Probe Failure

Events may show:

```text
Liveness probe failed
```

Check:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Verify:

* Probe path
* Probe port
* Initial delay
* Timeout
* Failure threshold

If the application needs more startup time, review the `startupProbe` configuration.

> **Do not simply disable the liveness probe.** Confirm whether the application or probe configuration is actually wrong.

---

### E. Dependency Failure

Application logs may show:

```text
MongoDB connection refused
Redis connection refused
Redpanda connection refused
External API timeout
DNS resolution failure
```

Check the dependency:

```bash
kubectl get pods -n <namespace>
kubectl get svc -n <namespace>
```

Check DNS/connectivity from the Pod when possible.

---

# 8. Step 6 — Check Recent Deployment

If the problem started after a deployment:

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

Check history:

```bash
kubectl rollout history deployment/<deployment-name> \
  -n <namespace>
```

Compare the old and new versions:

```text
Image
Environment variables
Secrets
ConfigMaps
Resources
Probes
Ports
Command
Arguments
```

---

# 9. Step 7 — Roll Back if Required

Only rollback when the new deployment is confirmed as the cause and production impact requires it.

```bash
kubectl rollout undo deployment/<deployment-name> \
  -n <namespace>
```

Monitor:

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

Then:

```bash
kubectl get pods -n <namespace> -w
```

---

# 10. Step 8 — Verify Recovery

Check Pod:

```bash
kubectl get pod <pod-name> -n <namespace>
```

Expected:

```text
STATUS: Running
READY: 1/1
```

Check restarts:

```bash
kubectl get pod <pod-name> -n <namespace>
```

The restart count should stop increasing.

Check logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Check Deployment:

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

Check Service:

```bash
kubectl get endpointslices -n <namespace>
```

Finally test the application:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

---

# 11. Do NOT Do These Things

### ❌ Don't immediately delete the Pod

First check:

```text
describe
→ logs
→ logs --previous
→ identify cause
```

### ❌ Don't blindly increase memory

First confirm:

```text
OOMKilled
```

and determine why memory usage increased.

### ❌ Don't immediately rollback

First confirm that a recent deployment caused the failure.

### ❌ Don't disable health probes blindly

A failed probe may indicate a real application problem.

### ❌ Don't restart the entire node

A CrashLoopBackOff is normally an application/container-level problem unless evidence points to the node.

---

# 12. Quick Reference

```bash
# Check Pod
kubectl get pod <pod> -n <namespace> -o wide

# Describe Pod
kubectl describe pod <pod> -n <namespace>

# Current logs
kubectl logs <pod> -n <namespace>

# Previous crashed container logs
kubectl logs <pod> -n <namespace> --previous

# Specific container
kubectl logs <pod> -n <namespace> -c <container>

# Previous specific container
kubectl logs <pod> -n <namespace> -c <container> --previous

# Events
kubectl get events -n <namespace> \
  --sort-by='.lastTimestamp'

# Deployment
kubectl describe deployment <deployment> -n <namespace>

# Rollout
kubectl rollout status deployment/<deployment> -n <namespace>

# Rollback
kubectl rollout undo deployment/<deployment> -n <namespace>

# Watch Pods
kubectl get pods -n <namespace> -w
```

---

# 13. Recovery Criteria

The incident is resolved when:

* [ ] Pod is `Running`
* [ ] Pod is `Ready`
* [ ] Restart count is no longer increasing
* [ ] No new CrashLoopBackOff events
* [ ] Application logs are healthy
* [ ] Deployment rollout is complete
* [ ] Service has healthy endpoints
* [ ] Application health check succeeds
* [ ] Application error rate has returned to normal

---

# 14. Escalation

Escalate to the **Application Owner** when:

* Application code is crashing.
* Configuration is invalid.
* Recent deployment caused the problem.
* Application dependency is unavailable.

Escalate to **Kubernetes/SRE** when:

* Multiple unrelated Pods are crashing.
* Multiple nodes are affected.
* Node/runtime problems are detected.
* Cluster-level networking/storage problems are detected.

---

## Golden Rule

```text
CrashLoopBackOff
       ↓
DON'T GUESS
       ↓
kubectl describe pod
       ↓
kubectl logs
       ↓
kubectl logs --previous
       ↓
IDENTIFY ROOT CAUSE
       ↓
FIX
       ↓
VERIFY POD
       ↓
VERIFY SERVICE
       ↓
VERIFY APPLICATION
```

> **CrashLoopBackOff = the container keeps crashing. Find the reason in the container's logs and Pod events before taking action.**
