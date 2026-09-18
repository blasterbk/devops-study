# Kubernetes Admission Webhook Blocking Deployments — Runbook

**Service:** API Server / Admission Controllers  
**Owner:** DevOps / SRE / Security Team  
**Severity:** P1 (Cluster deployments, scaling, or pod creation blocked)  
**Applies to:** ValidatingWebhookConfiguration, MutatingWebhookConfiguration (Istio, Kyverno, Gatekeeper, cert-manager)  

**Purpose:** Rapidly diagnose and recover from failing validating or mutating admission webhooks that cause `kubectl apply`, Helm upgrades, and Pod scheduling to fail cluster-wide.

---

## 1. Trigger & Alert Symptoms

Use this runbook when:
- `kubectl apply`, `helm upgrade`, or deployment rollouts fail with admission webhook errors.
- Pod creation is rejected with API server 500/InternalError:
  ```text
  Error from server (InternalError): Internal error occurred: failed calling webhook "validate.kyverno.svc": 
  failed to call webhook: Post "https://kyverno-svc.kyverno.svc:443/validate?timeout=10s": 
  context deadline exceeded
  ```
- Workloads fail to scale up or restart during CI/CD deployments.
- Prometheus alerts trigger: `APIServerAdmissionWebhookErrorsHigh` or `APIServerAdmissionWebhookLatencyHigh`.

---

## 2. Quick Decision Flow

```text
               Admission Webhook Blocking API Calls
                                │
                                ▼
            Identify Culprit Webhook Configuration
              (Validating vs Mutating Webhook)
                                │
                                ▼
         Is this an Active Production Outage Blocking CI/CD?
                  ├── YES ──► Emergency Bypass: Patch failurePolicy to "Ignore"
                  │           (Section 4 - Immediate Mitigation)
                  │
                  └── NO / Diagnostic Track
                       │
                       ▼
            Investigate Root Cause of Webhook Failure:
            ├── Webhook Backend Pod Crashed / Unready (Section 5)
            ├── TLS / CA Bundle Mismatch / Expired Cert (Section 6)
            └── NetworkPolicy / CNI Blocking API -> Webhook Pod (Section 7)
```

---

## 3. Step 1 — Fast Identification of Failing Webhooks

### List all Webhook Configurations in the Cluster
```bash
kubectl get validatingwebhookconfigurations,mutatingwebhookconfigurations
```

### Inspect the specific failing webhook
```bash
# For Validating Webhooks:
kubectl describe validatingwebhookconfiguration <webhook-config-name>

# For Mutating Webhooks:
kubectl describe mutatingwebhookconfiguration <webhook-config-name>
```

Key fields to examine:
- `failurePolicy`: `Fail` (Blocks all operations when webhook is down) vs `Ignore` (Allows operations to proceed).
- `service.namespace` & `service.name`: The backing webhook pod location.
- `rules`: Operations intercepted (`CREATE`, `UPDATE`, `DELETE`).

---

## 4. Immediate Mitigation: Emergency Bypass (`failurePolicy: Ignore`)

If an urgent production deployment or pod scaling is blocked and the webhook service is down:

### Option 1: Switch failurePolicy from `Fail` to `Ignore` (Recommended)
This allows Kubernetes API operations to bypass the broken webhook without deleting configuration metadata:
```bash
# For Validating Webhook
kubectl patch validatingwebhookconfiguration <webhook-config-name> \
  --type='json' -p='[{"op": "replace", "path": "/webhooks/0/failurePolicy", "value": "Ignore"}]'

# For Mutating Webhook
kubectl patch mutatingwebhookconfiguration <webhook-config-name> \
  --type='json' -p='[{"op": "replace", "path": "/webhooks/0/failurePolicy", "value": "Ignore"}]'
```

### Option 2: Delete Webhook Configuration (Extreme Emergency)
If patching fails and immediate unblocking is mandatory:
```bash
# Save backup manifest first!
kubectl get validatingwebhookconfiguration <webhook-name> -o yaml > /tmp/backup-webhook.yaml

# Delete configuration
kubectl delete validatingwebhookconfiguration <webhook-name>
```

---

## 5. Root Cause 1: Webhook Backend Pods Down / Unhealthy

### Check Webhook Backend Pods & Endpoints
```bash
# Locate webhook service namespace (e.g. kyverno, gatekeeper-system, istio-system, cert-manager)
kubectl get pods -n <webhook-namespace>
kubectl get endpoints -n <webhook-namespace> <webhook-service-name>
```

### Check Logs of Webhook Pods:
```bash
kubectl logs -n <webhook-namespace> -l <webhook-label> --tail=100
```

### Common Fixes:
1. **Restart crashed webhook pods:**
   ```bash
   kubectl rollout restart deployment <webhook-deployment> -n <webhook-namespace>
   ```
2. **Resource Exhaustion (OOMKilled):** If webhook pods are hitting memory limits due to high API request volume, increase requests/limits:
   ```bash
   kubectl set resources deployment <webhook-deployment> -n <webhook-namespace> \
     --limits=cpu=1,memory=1Gi --requests=cpu=250m,memory=512Mi
   ```

---

## 6. Root Cause 2: CA Bundle / TLS Certificate Mismatch

### Symptom:
`x509: certificate signed by unknown authority` or `certificate has expired`.

### Resolution:
Admission webhooks require valid TLS certificates with matching `caBundle` injected into the webhook configuration.
1. Check if CA injector pod is running:
   ```bash
   kubectl get pods -n cert-manager -l app.kubernetes.io/component=cainjector
   ```
2. Force re-generation of CA bundle:
   ```bash
   kubectl rollout restart deployment -n cert-manager cert-manager-cainjector
   ```

---

## 7. Root Cause 3: API Server Cannot Reach Webhook Pod (CNI / Firewalls)

### Symptom:
`context deadline exceeded` or `dial tcp 10.x.x.x:443: connect: connection refused`.

### Verification & Fix:
1. **Managed Kubernetes (EKS / GKE / AKS):**
   - Control plane runs outside the worker node network.
   - Webhook pods must run on ports allowed by worker security groups (e.g., 443, 8443, 9443, 10250).
   - Ensure the security group allows inbound traffic on the webhook port from the EKS/GKE control plane security group.
2. **HostNetwork Requirement:**
   - Some clusters require webhook controllers to run with `hostNetwork: true` if API server cannot reach the overlay CNI network directly.

---

## 8. Verification & Restoration

Once the webhook service is healthy:
1. **Restore `failurePolicy: Fail` (if previously patched):**
   ```bash
   kubectl patch validatingwebhookconfiguration <webhook-config-name> \
     --type='json' -p='[{"op": "replace", "path": "/webhooks/0/failurePolicy", "value": "Fail"}]'
   ```
2. **Verify Test Resource Creation:**
   ```bash
   kubectl create deployment webhook-verify-test --image=nginx:alpine --replicas=1
   kubectl delete deployment webhook-verify-test
   ```
3. **Monitor API Server Webhook Metrics:**
   - `apiserver_admission_webhook_rejection_count`
   - `apiserver_admission_webhook_admission_duration_seconds_bucket`
