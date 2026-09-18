# Kubernetes CoreDNS Crash or DNS Resolution Timeout — Runbook

**Service:** CoreDNS / Kube-DNS Cluster Addon  
**Owner:** DevOps / SRE / Platform Team  
**Severity:** P1 (Cluster-wide service discovery or external resolution failure)  
**Applies to:** Kubernetes 1.20+ (kube-system CoreDNS / NodeLocal DNSCache)  

**Purpose:** Rapidly diagnose and resolve cluster-wide DNS resolution failures, CoreDNS crashes (`CrashLoopBackOff`, OOMKilled), intermittent 5-second query timeouts (`ndots:5` / conntrack race conditions), and upstream DNS forwarding loops.

---

## 1. Trigger & Alert Symptoms

Use this runbook when:
- Pods report `lookup <service>.<namespace>.svc.cluster.local: no such host` or `i/o timeout`.
- Application latency spikes intermittently by **~5 seconds** on network calls.
- CoreDNS pods show `CrashLoopBackOff`, `OOMKilled`, or `Error`.
- Prometheus alerts trigger: `CoreDNSDown`, `CoreDNSLatencyHigh`, `CoreDNSErrorsHigh`, or `KubeDNSDown`.
- Upstream external DNS resolution fails from within workloads (e.g., `api.github.com` or third-party APIs fail to resolve).

Common error signatures:
```text
dial tcp: lookup my-service.default.svc.cluster.local: i/o timeout
dial tcp: lookup auth0.com on 10.96.0.10:53: read: connection refused
plugin/loop: Loop (127.0.0.1:53 -> :53) detected for zone ".", see https://coredns.io/plugins/loop#troubleshooting
[FATAL] plugin/errors: 2 12345.12345.open-files-exhausted
```

---

## 2. Quick Decision Flow

```text
               DNS Resolution Issue
                        │
                        ▼
      Are CoreDNS Pods Running and Ready?
            ├── NO ──► Check CrashLoopBackOff / OOM / Loop Plugin
            │          (Section 4)
            │
            └── YES
                 │
                 ▼
      Is the Failure Intermittent (~5s delays) or Permanent?
            ├── Intermittent (~5s) ──► Conntrack Race / ndots:5 Issue
            │                         (Section 5 - NodeLocal DNSCache)
            │
            └── Permanent
                 │
                 ▼
      Does Internal or External Resolution Fail?
            ├── Internal Only ──► Check kube-dns Service & Endpoints
            │                    (Section 6)
            │
            └── External Only ──► Check Upstream DNS Forwarding / /etc/resolv.conf
                                 (Section 7)
```

---

## 3. Step 1 — Confirm & Scope the Blast Radius

### Check CoreDNS Pod Status
```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns -o wide
```

### Check CoreDNS Service & ClusterIP
```bash
kubectl get svc -n kube-system kube-dns
kubectl get endpoints kube-dns -n kube-system
```
*Expected: Service IP matches `nameserver` in pod `/etc/resolv.conf` (e.g., `10.96.0.10` or `172.20.0.10`), and endpoints list active CoreDNS pod IPs.*

### Test DNS Resolution from a Test Pod
Launch an ad-hoc debug container:
```bash
kubectl run dns-test --image=registry.k8s.io/e2e-test-images/jessie-dnsutils:1.3 -it --rm --restart=Never -- /bin/sh
```
Inside the container, run:
```bash
# 1. Test Cluster Local Resolution
nslookup kubernetes.default.svc.cluster.local

# 2. Test Direct CoreDNS Pod Query
dig @<COREDNS_POD_IP> kubernetes.default.svc.cluster.local +short

# 3. Test External Forwarding
nslookup google.com

# 4. Check query response latency
dig google.com | grep "Query time"
```

---

## 4. Remediation: CoreDNS Pod Failures (CrashLoop / OOM / Loop Plugin)

### Scenario A: `plugin/loop: Loop detected for zone "."`
**Root Cause:** Host system runs `systemd-resolved` or `dnsmasq` pointing to `127.0.0.53`. When CoreDNS inherits host `/etc/resolv.conf`, it forwards queries back to itself in an infinite loop.

**Fix:** Edit CoreDNS ConfigMap to explicitly point upstream to a valid resolver (e.g., public DNS or internal VPC DNS):
```bash
kubectl edit configmap coredns -n kube-system
```
Update the `forward` plugin:
```text
.:53 {
    errors
    health {
       lameduck 5s
    }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
       pods insecure
       fallthrough in-addr.arpa ip6.arpa
       ttl 30
    }
    prometheus :9153
    forward . 8.8.8.8 1.1.1.1 {
       max_concurrent 1000
    }
    cache 30
    loop
    reload
    loadbalance
}
```
Restart CoreDNS pods:
```bash
kubectl rollout restart deployment coredns -n kube-system
```

---

### Scenario B: CoreDNS OOMKilled / Insufficient CPU Throttling
**Root Cause:** Heavy query volume from microservices with bad caching or high replica count exhausting default 170Mi memory / 100m CPU limits.

**Check resource usage:**
```bash
kubectl top pods -n kube-system -l k8s-app=kube-dns
```

**Fix:** Scale up CoreDNS resources and replica count:
```bash
kubectl set resources deployment coredns -n kube-system \
  --limits=cpu=500m,memory=512Mi \
  --requests=cpu=200m,memory=256Mi
```

Scale replicas immediately:
```bash
kubectl scale deployment coredns -n kube-system --replicas=4
```

---

## 5. Remediation: Intermittent 5-Second DNS Delays (`ndots:5` & Conntrack Race)

### Root Cause:
1. Linux kernel Netfilter/conntrack bug races on simultaneous UDP packets (A and AAAA queries) over SNAT/DNAT.
2. Default `/etc/resolv.conf` sets `ndots:5`. An external query like `api.stripe.com` issues 4 sequential failing internal queries first:
   - `api.stripe.com.<namespace>.svc.cluster.local` (NXDOMAIN)
   - `api.stripe.com.svc.cluster.local` (NXDOMAIN)
   - `api.stripe.com.cluster.local` (NXDOMAIN)
   - `api.stripe.com` (SUCCESS)

### Solution 1: Deploy NodeLocal DNSCache (Recommended for Production)
NodeLocal DNSCache runs a DaemonSet on every node (`169.254.20.10`), using TCP for upstream CoreDNS connections and avoiding conntrack table locks:
```bash
# Verify if NodeLocal DNS is already running
kubectl get daemonset -n kube-system node-local-dns
```
If not installed, deploy standard NodeLocal DNS:
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/kubernetes/master/cluster/addons/dns/nodelocaldns/nodelocaldns.yaml
```

### Solution 2: Optimize Pod `dnsConfig` in Deployment Manifests
For high-traffic egress applications, add FQDN trailing dot (`api.stripe.com.`) or tune `ndots`:
```yaml
spec:
  template:
    spec:
      dnsConfig:
        options:
          - name: ndots
            value: "2"
          - name: single-request-reopen
```

---

## 6. Remediation: kube-dns Service & Endpoints Missing

If `kube-dns` endpoints are empty:
```bash
kubectl get endpoints kube-dns -n kube-system
```

**Check selector matching:**
```bash
kubectl get svc kube-dns -n kube-system -o yaml | grep -A 3 selector
kubectl get pods -n kube-system --show-labels | grep coredns
```
Ensure the selector `k8s-app: kube-dns` matches pod labels.

---

## 7. Verification & Post-Mortem Checks

1. **Verify DNS Queries Across All Nodes:**
```bash
for node in $(kubectl get nodes -o jsonpath='{.items[*].metadata.name}'); do
  echo "Testing on $node..."
  kubectl run "dns-check-$node" --overrides="{\"spec\":{\"nodeName\":\"$node\"}}" \
    --image=registry.k8s.io/e2e-test-images/jessie-dnsutils:1.3 --restart=Never --rm -it \
    -- nslookup kubernetes.default.svc.cluster.local > /dev/null && echo "OK" || echo "FAIL"
done
```

2. **CoreDNS Prometheus Metrics to Monitor:**
- `coredns_dns_request_duration_seconds_bucket` (Latency p99 < 15ms)
- `coredns_dns_responses_total{rcode="SERVFAIL"}` (Should be near 0)
- `coredns_forward_healthcheck_failures_total`

3. **Install Cluster Proportional Autoscaler for CoreDNS:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: coredns-autoscaler
  namespace: kube-system
spec:
  selector:
    matchLabels:
      k8s-app: coredns-autoscaler
  template:
    metadata:
      labels:
        k8s-app: coredns-autoscaler
    spec:
      containers:
      - name: autoscaler
        image: registry.k8s.io/cpa/cluster-proportional-autoscaler:v1.8.8
        command:
        - /cluster-proportional-autoscaler
        - --namespace=kube-system
        - --configmap=coredns-autoscaler
        - --target=deployment/coredns
        - --default-params={"linear":{"coresPerReplica":256,"nodesPerReplica":16,"min":2,"max":100}}
```
