# Cert-Manager TLS Certificate Expiration & Renewal Failure — Runbook

**Service:** Security / Ingress / Cert-Manager  
**Owner:** DevOps / SRE / Security Team  
**Severity:** P1 (Production Ingress TLS expired or failing renewal)  
**Applies to:** cert-manager 1.x (Let's Encrypt, ACME, Vault, Internal CA)  

**Purpose:** Rapidly diagnose and remediate expired or failing TLS/SSL certificates managed by `cert-manager`, resolve ACME challenge blocks, and execute emergency manual certificate reissuance.

---

## 1. Trigger & Alert Symptoms

Use this runbook when:
- Browsers/Clients display `NET::ERR_CERT_DATE_INVALID` or `SSL: CERTIFICATE_VERIFY_FAILED`.
- Prometheus alert fires: `CertManagerCertExpiringSoon` or `CertManagerCertNotReady`.
- `kubectl get certificate -A` shows `Ready=False`.
- `cert-manager` logs show ACME challenge validation errors (HTTP-01 or DNS-01 timeouts).
- Rate limits reached on ACME provider (e.g. `too many certificates already issued for exact set of domains`).

Common error signatures:
```text
Certificate renewal failed: 403 urn:ietf:params:acme:error:unauthorized
Error waiting for challenge to solve: dial tcp <IP>:80: i/o timeout
webhook.cert-manager.io: connection refused
429 urn:ietf:params:acme:error:rateLimited: too many failed authorizations
```

---

## 2. Quick Decision Flow

```text
               Certificate Expired or Renewal Failed
                                │
                                ▼
            Inspect Certificate CRD & Status Conditions
                                │
                                ▼
                    Where is the pipeline stuck?
      ┌─────────────────┬───────────────────┬──────────────────┐
      ▼                 ▼                   ▼                  ▼
CertificateRequest    Order               Challenge          Webhook
 (Denied/Failed)   (Errored/Stuck)      (Solving/Pending)  (Timeout/Refused)
      │                 │                   │                  │
      ▼                 ▼                   ▼                  ▼
Check Issuer /      Check ACME          Check Ingress /     Restart cert-manager
RBAC Permissions    Rate Limits         DNS-01 API Keys     webhook pod
(Section 4)         (Section 5)         (Section 6)         (Section 7)
```

---

## 3. Step 1 — Fast Triage & Diagnostic Commands

### 1. Identify Failing Certificates across all namespaces
```bash
kubectl get certificate -A -o custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[?(@.type=="Ready")].status,REASON:.status.conditions[?(@.type=="Ready")].reason,EXPIRATION:.status.notAfter'
```

### 2. Inspect the specific failing Certificate object
```bash
kubectl describe certificate <cert-name> -n <namespace>
```
Look at the bottom **Events** section. It will point directly to the latest `CertificateRequest` or `Order`.

### 3. Trace the Cert-Manager Hierarchy:
Cert-manager operates in a strict 4-tier chain:
$$\text{Certificate} \longrightarrow \text{CertificateRequest} \longrightarrow \text{Order} \longrightarrow \text{Challenge}$$

```bash
# Check CertificateRequest
kubectl get certificaterequest -n <namespace>
kubectl describe certificaterequest <request-name> -n <namespace>

# Check ACME Order
kubectl get order -n <namespace>
kubectl describe order <order-name> -n <namespace>

# Check ACME Challenge
kubectl get challenge -n <namespace>
kubectl describe challenge <challenge-name> -n <namespace>
```

---

## 4. Remediation: Issuer Configuration & Secret Permission Errors

### Check Issuer / ClusterIssuer Status:
```bash
kubectl get clusterissuer,issuer -A
kubectl describe clusterissuer <issuer-name>
```

If the issuer shows `Ready=False`:
- **For ACME (Let's Encrypt):** Check if the account private key secret is missing or corrupted:
  ```bash
  kubectl get secret -n cert-manager <acme-private-key-name>
  ```
- **Re-register ACME Account:** If private key is lost, edit ClusterIssuer with a new secret name to force re-registration:
  ```yaml
  spec:
    acme:
      server: https://acme-v02.api.letsencrypt.org/directory
      email: devops-alerts@unibotsapi.com
      privateKeySecretRef:
        name: letsencrypt-prod-account-key-v2
  ```

---

## 5. Remediation: HTTP-01 & DNS-01 Challenge Failures

### Scenario A: HTTP-01 Challenge Failing (Routing & Ingress Blocks)
**Symptom:** Challenge is stuck in `pending` or fails with `403 Unauthorized` / `Connection Timeout`.

1. **Verify Ingress Routing for ACME solver:**
   ```bash
   kubectl get ingress -n <namespace> -l acme.cert-manager.io/http01-solver=true
   kubectl get pods -n <namespace> -l acme.cert-manager.io/http01-solver=true
   ```
2. **Common Causes:**
   - External Cloudflare / Cloud CDN is enforcing HTTPS redirection or Geo-blocking `/.well-known/acme-challenge/`.
   - Ingress controller (Nginx/Traefik) does not have ingressClass specified.
3. **Fix in Ingress Template:** Ensure the ClusterIssuer has the exact `ingressClassName` configured:
   ```yaml
   spec:
     acme:
       solvers:
       - http01:
           ingress:
             ingressClassName: nginx
   ```

---

### Scenario B: DNS-01 Challenge Failing (Cloudflare / AWS Route53 / Linode)
**Symptom:** `error presenting challenge: API credentials invalid` or DNS propagation timeout.

1. **Check Cloudflare API Token Secret:**
   ```bash
   kubectl get secret -n cert-manager cloudflare-api-token-secret -o yaml
   ```
2. Verify token has `Zone:DNS:Edit` and `Zone:Read` permissions.
3. **Test DNS Propagation manually:**
   ```bash
   dig TXT _acme-challenge.example.com @8.8.8.8
   ```

---

## 6. Emergency Recovery: Force Certificate Renewal & Manual Bypass

### Option 1: Force Renew via `cmctl` / `kubectl cert-manager`
```bash
# Using cmctl CLI
cmctl renew <cert-name> -n <namespace>

# Alternatively, trigger renewal by touching annotations
kubectl annotate certificate <cert-name> -n <namespace> cert-manager.io/renew-at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --overwrite
```

### Option 2: Clean slate rebuild of stuck Orders & Challenges
If orders are stuck in invalid/failed states:
```bash
# Delete existing stuck challenges and orders (cert-manager will recreate them)
kubectl delete challenge -n <namespace> --all
kubectl delete order -n <namespace> --all
kubectl delete certificaterequest -n <namespace> --all
```

### Option 3: Emergency Temporary Self-Signed or Wildcard Patch
If customer traffic is actively blocked due to browser warnings:
```bash
# Create an emergency self-signed issuer
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: emergency-selfsigned
spec:
  selfSigned: {}
EOF

# Temporarily point the certificate to emergency issuer
kubectl patch certificate <cert-name> -n <namespace> --type='json' -p='[{"op": "replace", "path": "/spec/issuerRef/name", "value": "emergency-selfsigned"}]'
```

---

## 7. Fixing Cert-Manager Webhook Timeouts

If creating/updating certificates gives `Internal error occurred: failed calling webhook`:
```bash
kubectl get pods -n cert-manager -l app=webhook
kubectl logs -n cert-manager -l app=webhook --tail=100
```
- **Fix:** Cert-manager webhook CA bundle might have expired or lost synchronization:
```bash
kubectl rollout restart deployment cert-manager-webhook -n cert-manager
kubectl rollout restart deployment cert-manager-cainjector -n cert-manager
```

---

## 8. Post-Incident Hardening & Alerting

1. **Prometheus Alert Rule for 15-day Expiration Warning:**
```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: cert-manager-alerts
  namespace: monitoring
spec:
  groups:
  - name: cert-manager
    rules:
    - alert: CertManagerCertExpiringSoon
      expr: certmanager_certificate_expiration_timestamp_seconds - time() < (86400 * 15)
      for: 1h
      labels:
        severity: warning
      annotations:
        summary: "TLS Certificate {{ $labels.name }} in namespace {{ $labels.namespace }} expires in less than 15 days"
```
