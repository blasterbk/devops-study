# Kubernetes Chaos Scenario 06: DNS Failure & Resolution Timeout Chaos

**Domain:** Core Infrastructure, Service Discovery, CoreDNS & DNS Caching  
**Chaos Type:** `DNSChaos` (CoreDNS Pod Kill, NXDOMAIN Injection, Query Timeout)  
**Target:** CoreDNS Deployment, NodeLocal DNSCache, Application DNS Resolution  
**Tools:** Chaos Mesh `DNSChaos`, NodeLocal DNSCache, `dig`, `nslookup`, `kubectl`

---

## 1. Experiment Overview

DNS resolution is the backbone of all microservice communication in Kubernetes. Every Service-to-Service call, every external API request, and every database connection begins with a DNS lookup. When CoreDNS is degraded — even with a 1-second delay — connection pool establishment stalls, health checks fail, and cascading timeouts propagate across the entire service mesh.

The primary experiment tests **CoreDNS Pod Failure & NodeLocal DNSCache Absorption**.

A separate optional experiment tests **External NXDOMAIN / SERVFAIL Injection for Third-Party Dependency Isolation**.

> **Important:** Without NodeLocal DNSCache, every DNS query traverses the network to a CoreDNS pod. If CoreDNS is overloaded or partitioned, ALL new TCP connections across the cluster stall simultaneously — creating a cluster-wide outage from a seemingly minor infrastructure component.

### Experiment A — CoreDNS Pod Kill & Cache Failover

```text
50% of CoreDNS pods killed
    ↓
Remaining CoreDNS pods receive doubled query load
    ↓
NodeLocal DNSCache serves cached .cluster.local records
    ↓
Internal service discovery continues from cache
    ↓
External DNS queries (stripe.com, auth0.com) may timeout
    ↓
Applications with keepalive connections unaffected
    ↓
Applications creating new connections experience DNS delay
```

### Experiment B — External DNS Error Injection

```text
DNSChaos injects NXDOMAIN for "api.stripe.com"
    ↓
Payment gateway DNS resolution fails
    ↓
Application circuit breaker trips
    ↓
Fallback response served (cached / degraded)
    ↓
Order processing continues without payment validation
    ↓
Payment retried when DNS recovers
```

---

## 2. Steady-State Hypothesis

> **When 50% of CoreDNS pods are terminated and external DNS queries to third-party endpoints return `SERVFAIL` for 5 minutes, NodeLocal DNSCache will serve cached internal `.cluster.local` records with $> 80\%$ cache hit rate, existing HTTP keepalive connections will maintain traffic flow without new DNS lookups, and application failure rate will remain $< 0.5\%$.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| NodeLocal Cache Hit Rate | $> 80\%$ for internal `.cluster.local` queries |
| Internal Service Discovery | Cached lookups succeed for all internal services |
| Application Error Rate | $< 0.5\%$ 5xx errors during CoreDNS degradation |
| External DNS Fallback | Circuit breaker activates for failed external lookups |
| Keepalive Socket Persistence | Established connections stay open without new DNS |
| CoreDNS Recovery | Full resolution capability restored within 30s post-chaos |

---

## 3. Failure Mechanism Architecture

```text
               DNS Resolution Architecture Under CoreDNS Failure

┌─────────────────────────────────────────────────────────────┐
│                 APPLICATION POD                             │
│                                                             │
│  Application initiates connection to payment-service        │
│  → Kernel resolves payment-service.production.svc.cluster.local│
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ NODE-LOCAL DNS CACHE (DaemonSet on every node)        │  │
│  │ - Listens on 169.254.20.10:53                         │  │
│  │ - Cache TTL: 30s for cluster.local records            │  │
│  │ - CACHE HIT → Instant response (< 1ms) ✅            │  │
│  │ - CACHE MISS → Forward to CoreDNS ↓                   │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ COREDNS DEPLOYMENT (2 pods → 1 pod after chaos)       │  │
│  │ - Resolves .cluster.local from kube-apiserver watch   │  │
│  │ - Forwards external queries to upstream DNS           │  │
│  │ - POD KILLED ❌ → Remaining pod absorbs load          │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

### Verify CoreDNS deployment

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl get deployment coredns -n kube-system
```

### Verify NodeLocal DNSCache (if deployed)

```bash
kubectl get daemonset node-local-dns -n kube-system 2>/dev/null || echo "NodeLocal DNSCache not deployed"
```

### Test DNS resolution from an application pod

```bash
kubectl exec -it <app-pod> -n production -- nslookup payment-service.production.svc.cluster.local
kubectl exec -it <app-pod> -n production -- nslookup api.stripe.com
```

---

# 5. Step 1 — Record Baseline

### CoreDNS pod count and metrics

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl top pods -n kube-system -l k8s-app=kube-dns
```

### DNS resolution latency baseline

```bash
kubectl exec -it <app-pod> -n production -- sh -c "time nslookup payment-service.production.svc.cluster.local"
kubectl exec -it <app-pod> -n production -- sh -c "time nslookup api.stripe.com"
```

### Application error rate baseline

```bash
curl -w "\nStatus: %{http_code} | DNS: %{time_namelookup}s | Total: %{time_total}s\n" \
     -o /dev/null -s https://api.example.com/health
```

---

# 6. Step 2 — Kill 50% of CoreDNS Pods

### Chaos Mesh Manifest

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: coredns-pod-kill
  namespace: chaos-testing
spec:
  action: pod-kill
  mode: fixed-percent
  value: "50"
  selector:
    namespaces:
      - kube-system
    labelSelectors:
      k8s-app: kube-dns
  duration: "5m"
  scheduler:
    cron: "@every 60s"
```

### Or via kubectl

```bash
kubectl delete pod $(kubectl get pods -n kube-system -l k8s-app=kube-dns -o name | head -1) -n kube-system
```

---

# 7. Step 3 — Inject External DNS Error

### Chaos Mesh `DNSChaos` Manifest

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: DNSChaos
metadata:
  name: external-dns-failure
  namespace: chaos-testing
spec:
  action: error
  mode: all
  patterns:
    - "api.stripe.com"
    - "auth0.com"
    - "api.sendgrid.com"
  selector:
    namespaces:
      - production
    labelSelectors:
      app: payment-gateway
  duration: "5m"
```

---

# 8. Step 4 — Monitor DNS & Application Impact

### Test internal DNS resolution during chaos

```bash
kubectl exec -it <app-pod> -n production -- sh -c "for i in \$(seq 1 10); do time nslookup payment-service.production.svc.cluster.local; done"
```

### Test external DNS resolution during chaos

```bash
kubectl exec -it <app-pod> -n production -- sh -c "nslookup api.stripe.com"
```
*Expected: NXDOMAIN or SERVFAIL for injected patterns.*

### Check application health

```bash
for i in $(seq 1 20); do
  curl -w "Status: %{http_code} | DNS: %{time_namelookup}s | Total: %{time_total}s\n" \
       -o /dev/null -s https://api.example.com/orders
  sleep 1
done
```

### Verify existing keepalive connections survive

```bash
kubectl exec -it <app-pod> -n production -- ss -tan state established | grep ":443" | wc -l
```

---

# 9. Abort Conditions

```text
ABORT CONDITIONS

- All CoreDNS pods terminated (0 remaining)
- Internal .cluster.local resolution fails completely
- Application error rate exceeds 5%
- Kubernetes control plane operations (kubectl) fail
- NodeLocal DNSCache pods crash
```

---

# 10. Emergency Stop

```bash
kubectl delete podchaos coredns-pod-kill -n chaos-testing
kubectl delete dnschaos external-dns-failure -n chaos-testing
```

If CoreDNS is down:

```bash
kubectl rollout restart deployment coredns -n kube-system
```

---

# 11. Recovery Validation

### Verify CoreDNS pods restored

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

### Verify DNS resolution restored

```bash
kubectl exec -it <app-pod> -n production -- nslookup api.stripe.com
```

### Verify application health

```bash
curl -s https://api.example.com/health | jq .
```

---

# 12. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| All DNS fails when CoreDNS pods die | No NodeLocal DNSCache deployed | Deploy NodeLocal DNSCache DaemonSet on all nodes |
| New connections fail but existing work | DNS needed only for new TCP connections | Use HTTP keepalive and connection pooling |
| External DNS failure cascades to internal | Application treats all DNS failures equally | Separate internal vs external DNS error handling |
| DNS lookup takes 5+ seconds | CoreDNS overloaded, search domain expansion | Set `ndots: 2` in pod DNS config and use FQDN |
| CoreDNS auto-scales too slowly | No HPA on CoreDNS deployment | Add HPA to CoreDNS based on DNS query rate |

---

# 13. Production Hardening

### NodeLocal DNSCache (Critical)

```bash
# Deploy NodeLocal DNSCache DaemonSet
kubectl apply -f https://raw.githubusercontent.com/kubernetes/kubernetes/master/cluster/addons/dns/nodelocaldns/nodelocaldns.yaml
```

### DNS Pod Config Optimization

```yaml
spec:
  dnsConfig:
    options:
    - name: ndots
      value: "2"
    - name: timeout
      value: "2"
    - name: attempts
      value: "3"
```

### CoreDNS HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: coredns-hpa
  namespace: kube-system
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: coredns
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

---

# 14. Experiment Results

| Metric | Baseline | 50% CoreDNS Kill | External DNS Error | Recovery |
|---|---:|---:|---:|---:|
| Internal DNS Success | 100% | 100% (cached) | 100% | 100% |
| External DNS Success | 100% | ~80% | 0% (injected) | 100% |
| App Error Rate | 0% | $< 0.5\%$ | $< 1\%$ | 0% |
| DNS Latency (p50) | $< 1\text{ms}$ | $< 5\text{ms}$ | N/A | $< 1\text{ms}$ |
| CoreDNS Pods | 2 | 1 | 2 | 2 |

---

# 15. Final Assessment & Key Technical Takeaways

```text
CoreDNS
    =
Single point of failure for ALL cluster communication

NodeLocal DNSCache
    =
Critical mitigation (serves cached records when CoreDNS is down)

Keepalive Connections
    =
Immune to DNS failures (DNS only needed for NEW connections)

ndots: 5 (default)
    =
Performance problem (5 search domain expansions per query)

ndots: 2
    =
Significantly faster DNS resolution for FQDN queries

Successful DNS Chaos
    =
Internal resolution from cache
    +
External failure isolated by circuit breaker
    +
Zero impact on established connections
    +
Clean CoreDNS recovery
```
