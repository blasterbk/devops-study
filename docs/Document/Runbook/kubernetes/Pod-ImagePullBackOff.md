# Kubernetes Pod `ImagePullBackOff` — Runbook

**Service:** Kubernetes Workload
**Owner:** DevOps / SRE
**Severity:** P2–P3 depending on application impact
**Applies to:** Kubernetes clusters

**Purpose:** Quickly identify and fix Pods that cannot pull their container image.

---

## 1. Trigger

Use this runbook when:

* Pod shows `ImagePullBackOff`.
* Pod shows `ErrImagePull`.
* Deployment rollout is stuck because the image cannot be pulled.
* New Pods cannot start after a deployment.
* Monitoring reports image-pull failures.

> **Important:** `ImagePullBackOff` means Kubernetes cannot pull the required container image and is increasing the wait time before trying again.

---

# 2. Quick Decision Flow

```text
Pod ImagePullBackOff
        │
        ▼
Check Pod Events
        │
        ▼
Identify Error
        │
 ┌──────┼──────────┬──────────┐
 ▼      ▼          ▼          ▼
Image  Registry   Auth       Network
Tag    Problem    Problem    / DNS
 │      │          │          │
 └──────┴──────────┴──────────┘
                │
                ▼
             Fix Issue
                │
                ▼
          Recreate / Retry Pod
                │
                ▼
          Verify Pod Running
                │
                ▼
        Verify Application
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
NODE
```

Example:

```text
NAME       READY   STATUS             RESTARTS
api-pod    0/1     ImagePullBackOff   0
```

---

# 4. Step 2 — Check Pod Events FIRST

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look at:

```text
Events:
```

Also:

```bash
kubectl get events -n <namespace> \
  --sort-by='.lastTimestamp' | tail -30
```

Look for messages such as:

```text
Failed to pull image
ErrImagePull
ImagePullBackOff
pull access denied
unauthorized
manifest unknown
not found
connection refused
i/o timeout
no such host
```

---

# 5. Step 3 — Identify the Cause

| Event / Error        | Likely Cause           | Check                 |
| -------------------- | ---------------------- | --------------------- |
| `manifest unknown`   | Wrong image/tag        | Image name + tag      |
| `not found`          | Wrong repository/tag   | Registry              |
| `unauthorized`       | Authentication         | `imagePullSecret`     |
| `pull access denied` | Registry permissions   | Registry credentials  |
| `no such host`       | DNS problem            | Node DNS              |
| `i/o timeout`        | Network problem        | Registry connectivity |
| `connection refused` | Registry/network issue | Registry endpoint     |
| `x509`               | TLS/certificate issue  | Registry certificate  |
| `too many requests`  | Registry rate limit    | Registry/account      |

---

# 6. Step 4 — Check Image Name and Tag

Get the image:

```bash
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.spec.containers[*].image}'
```

Example:

```text
registry.example.com/app/api:v1.25
```

Verify:

* Registry hostname
* Repository name
* Image name
* Image tag
* Image exists in the registry

> **Common cause:** The deployment references an image tag that was never pushed.

---

# 7. Step 5 — Check `imagePullSecrets`

Check the Pod:

```bash
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.spec.imagePullSecrets[*].name}'
```

Check available Secrets:

```bash
kubectl get secrets -n <namespace>
```

Describe the Secret:

```bash
kubectl describe secret <secret-name> -n <namespace>
```

Check the Deployment:

```bash
kubectl get deployment <deployment-name> \
  -n <namespace> -o yaml
```

Verify:

```yaml
imagePullSecrets:
  - name: <secret-name>
```

> Do not print or expose registry passwords/tokens while troubleshooting.

---

# 8. Step 6 — Check Registry Connectivity

Identify the node:

```bash
kubectl get pod <pod-name> -n <namespace> -o wide
```

SSH to the affected node and test DNS:

```bash
nslookup <registry>
```

or:

```bash
dig <registry>
```

Test HTTPS:

```bash
curl -I https://<registry>
```

Check the container runtime:

```bash
systemctl status containerd
```

Logs:

```bash
journalctl -u containerd --since "30 minutes ago"
```

---

# 9. Step 7 — Check Recent Deployment

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

Check the current image:

```bash
kubectl get deployment <deployment-name> \
  -n <namespace> \
  -o jsonpath='{.spec.template.spec.containers[*].image}'
```

Compare with the previous working version.

---

# 10. Step 8 — Fix the Problem

Depending on the cause:

### Wrong image/tag

Update the Deployment with the correct image:

```bash
kubectl set image deployment/<deployment-name> \
  <container-name>=<correct-image>:<tag> \
  -n <namespace>
```

### Registry authentication

Fix/create the correct `imagePullSecret`.

### Registry/DNS/network problem

Fix the affected node's:

```text
DNS
Network
Firewall
Proxy
Registry connectivity
```

### Registry unavailable

Check the registry service and wait for it to recover if the registry itself is down.

---

# 11. Step 9 — Recreate / Retry the Pod

After fixing the root cause:

```bash
kubectl delete pod <pod-name> -n <namespace>
```

If managed by a Deployment, Kubernetes creates a replacement automatically.

Watch:

```bash
kubectl get pods -n <namespace> -w
```

---

# 12. Step 10 — Verify Recovery

Check:

```bash
kubectl get pod <pod-name> -n <namespace>
```

Expected:

```text
STATUS: Running
READY: 1/1
```

Check events:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Confirm there are no new:

```text
Failed to pull image
ErrImagePull
ImagePullBackOff
```

Check Deployment:

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

Check application:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

---

# 13. Rollback

If a new deployment introduced the incorrect image/tag:

```bash
kubectl rollout undo deployment/<deployment-name> \
  -n <namespace>
```

Monitor:

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

---

# 14. Do NOT Do These Things

### ❌ Don't immediately restart the node

First determine whether the problem is:

```text
Image
Tag
Registry
Authentication
DNS
Network
Runtime
```

### ❌ Don't repeatedly delete the Pod without fixing the cause

The new Pod will have the same image-pull problem.

### ❌ Don't expose registry credentials

Never paste passwords or access tokens into incident tickets or chat.

### ❌ Don't change registry credentials blindly

First confirm the event actually indicates an authentication problem.

### ❌ Don't rollback every ImagePullBackOff

First check whether the image/tag is actually wrong.

---

# 15. Quick Reference

```bash
# Check Pod
kubectl get pod <pod> -n <namespace> -o wide

# Describe Pod
kubectl describe pod <pod> -n <namespace>

# Check Events
kubectl get events -n <namespace> \
  --sort-by='.lastTimestamp'

# Check image
kubectl get pod <pod> -n <namespace> \
  -o jsonpath='{.spec.containers[*].image}'

# Check imagePullSecrets
kubectl get pod <pod> -n <namespace> \
  -o jsonpath='{.spec.imagePullSecrets[*].name}'

# Check Secrets
kubectl get secrets -n <namespace>

# Check Deployment image
kubectl get deployment <deployment> \
  -n <namespace> \
  -o jsonpath='{.spec.template.spec.containers[*].image}'

# Check containerd
systemctl status containerd

# Check containerd logs
journalctl -u containerd --since "30 minutes ago"

# Watch Pod
kubectl get pods -n <namespace> -w

# Rollback
kubectl rollout undo deployment/<deployment> -n <namespace>
```

---

# 16. Recovery Criteria

The incident is resolved when:

* [ ] Pod is `Running`
* [ ] Pod is `Ready`
* [ ] Image pull succeeds
* [ ] No new `ImagePullBackOff`
* [ ] No new `ErrImagePull`
* [ ] Deployment rollout is complete
* [ ] Service has healthy endpoints
* [ ] Application health check succeeds
* [ ] Application error rate has returned to normal

---

# 17. Escalation

Escalate to **DevOps/SRE** when:

* Multiple nodes cannot pull images.
* Registry connectivity is failing.
* Container runtime is failing.
* DNS/network problems affect multiple workloads.
* Registry TLS/certificate problems are suspected.

Escalate to the **Application/Development team** when:

* Image doesn't exist.
* Wrong image tag was deployed.
* Image was not pushed.
* Application deployment references an incorrect repository/tag.

Escalate to the **Registry/Security owner** when:

* Registry authentication fails.
* Registry permissions are incorrect.
* Registry is unavailable.
* Registry rate limits are affecting production.

---

## Golden Rule

```text
ImagePullBackOff
       ↓
DON'T GUESS
       ↓
kubectl describe pod
       ↓
CHECK EVENTS
       ↓
Check Image / Tag / Registry / Auth / DNS
       ↓
FIX ROOT CAUSE
       ↓
RECREATE / RETRY POD
       ↓
VERIFY RUNNING + READY
       ↓
VERIFY APPLICATION
```

> **ImagePullBackOff = Kubernetes cannot pull the required image. Check the Pod Events first to determine why.**
