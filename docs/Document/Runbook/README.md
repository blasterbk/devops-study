# DevOps & SRE Incident Runbooks Master Index

Welcome to the operational runbooks repository. Use this index for rapid triage during production incidents.

---

## 🚀 Live Cluster Specific Runbook

- **[`mongodb_runbook_proper.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb_runbook_proper.md)** — Production crash incident runbook tailored for `legacy-rs` (MongoDB 8.2.4 on `legacy-db-1/2/3.unibotsapi.com`), Linode custom kernel fixes, application traffic shielding, and OOM/COLLSCAN mitigations.

---

## ☸️ Kubernetes Runbooks (`kubernetes/`)

| Category | Runbook | Trigger / Key Symptom |
|---|---|---|
| **Pod Lifecycle** | [`Pod-ContainerCreating.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Pod-ContainerCreating.md) | Pods stuck in `ContainerCreating`, volume mount timeout, CNI errors |
| | [`Pod-CrashLoopBackOff.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Pod-CrashLoopBackOff.md) | Repeated container exit, failed liveness/readiness probes |
| | [`Pod-OOMKilled.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Pod-OOMKilled.md) | Container exit code 137, cgroup memory exhaustion |
| | [`Pod-ImagePullBackOff.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Pod-ImagePullBackOff.md) | `ErrImagePull`, registry 401/403 auth failures, image tag typos |
| | [`Pod-Pending.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Pod-Pending.md) | Pod unschedulable, `0/N nodes available`, affinity/taint mismatch |
| | [`Pod-Evicted.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Pod-Evicted.md) | Node memory/disk/ephemeral-storage pressure evictions |
| | [`Pod-Terminating.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Pod-Terminating.md) | Pod hung terminating, stuck finalizers, unmount locks |
| **Node Health & Autoscaling** | [`Node-NotReady.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Node-NotReady.md) | Node `Ready=False/Unknown`, kubelet down, containerd hung |
| | [`Node-DiskPressure.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Node-DiskPressure.md) | Node `DiskPressure=True`, filesystem or inode exhaustion |
| | [`Insufficient-CPU.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Insufficient-CPU.md) | Node CPU requests capacity exceeded, CPU throttling |
| | [`Insufficient-Memory.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Insufficient-Memory.md) | Node allocatable memory exhausted, scheduling failures |
| | [`Cluster-Autoscaler-or-Karpenter-Stuck.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Cluster-Autoscaler-or-Karpenter-Stuck.md) | Nodes not provisioning despite pending pods, cloud quota limits, PDB blocks |
| **Networking, DNS & Ingress** | [`CoreDNS-Crash-or-DNS-Timeout.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/CoreDNS-Crash-or-DNS-Timeout.md) | Cluster DNS timeouts, CoreDNS OOM/CrashLoop, 5s delay (`ndots:5`/conntrack) |
| | [`CNI-IPAM-IP-Exhaustion.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/CNI-IPAM-IP-Exhaustion.md) | `no IP addresses available in range set`, orphaned Calico/Cilium IPAM allocations |
| | [`Ingress-503.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Ingress-503.md) | Ingress returning HTTP 503, backend service unavailable |
| | [`No-Healthy-Upstream.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/No-Healthy-Upstream.md) | Gateway/Envoy/Nginx 503 No Healthy Upstream errors |
| | [`Service-No-Endpoints.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Service-No-Endpoints.md) | Service endpoints missing, selector mismatch, unready pods |
| **Storage & StatefulSets** | [`PVC-Pending.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/PVC-Pending.md) | PVC stuck in `Pending`, StorageClass or CSI driver failure |
| | [`Volume-Multi-Attach-Lock-Error.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Volume-Multi-Attach-Lock-Error.md) | `Multi-Attach error for volume`, VolumeAttachment deadlocks on node crash |
| | [`Deployment-Rollout-Failure.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Deployment-Rollout-Failure.md) | Deployment rollout timed out or stuck, bad revision |
| | [`HPA-Not-Scaling.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/HPA-Not-Scaling.md) | HPA `<unknown>` metrics, metrics-server or adapter failure |
| **Control Plane & Security** | [`ETCD-Quorum-Loss-and-High-Latency.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/ETCD-Quorum-Loss-and-High-Latency.md) | ETCD leader flapping, disk `fsync` latency >10ms, `NOSPACE` alarm |
| | [`Admission-Webhook-Blocking-Deployments.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Admission-Webhook-Blocking-Deployments.md) | Webhook call timeout/failure blocking `kubectl apply` and Pod scheduling |
| | [`Cert-Manager-Expired-Certificates.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Cert-Manager-Expired-Certificates.md) | Ingress TLS expiration, ACME challenge failures, cert-manager rate limits |

---

## ⚡ Redis & In-Memory Cache Runbooks (`redis/`)

| Category | Runbook | Trigger / Key Symptom |
|---|---|---|
| **Memory & Stability** | [`Redis-OOM-Maxmemory-Reached.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/redis/Redis-OOM-Maxmemory-Reached.md) | `OOM command not allowed`, eviction policy stalls, fragmentation ratio > 1.5 |
| **Performance & CPU** | [`Redis-High-CPU-and-Slowlog.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/redis/Redis-High-CPU-and-Slowlog.md) | 100% CPU on main thread, blocking $O(N)$ operations (`KEYS *`, `HGETALL`), slow Lua scripts |
| **High Availability** | [`Redis-Master-Replica-Desync.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/redis/Redis-Master-Replica-Desync.md) | Replication buffer overflow, full sync PSYNC loops, Sentinel split-brain |
| **Connection Health** | [`Redis-Connection-Exhaustion.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/redis/Redis-Connection-Exhaustion.md) | `ERR max number of clients reached`, microservice connection pool leaks, OS ulimit exhaustion |

---

## 🍃 MongoDB Runbooks (`mongodb/`)

| Category | Runbook | Trigger / Key Symptom |
|---|---|---|
| **High Availability** | [`MongoDB-ReplicaSet-Member-Down.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-ReplicaSet-Member-Down.md) | Replica member unreachable, state `DOWN`/`UNKNOWN` |
| | [`MongoDB-Replication-Lag.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Replication-Lag.md) | Secondary falling behind primary, stale secondary reads |
| | [`MongoDB-Secondary-Not-Syncing.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Secondary-Not-Syncing.md) | Secondary stuck in `RECOVERING` or `STARTUP2` |
| | [`MongoDB-Initial-Sync-Failure.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Initial-Sync-Failure.md) | Member initial sync aborts, network break, oplog overrun |
| | [`MongoDB-Oplog-Window-Low.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Oplog-Window-Low.md) | Oplog retention window under threshold (< 24h) |
| **Stability & Engine** | [`MongoDB-Crash.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Crash.md) | `mongod` dead, SEGV, fatal assertion, crash loop |
| | [`MongoDB-OOM.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-OOM.md) | Linux OOM killer terminated `mongod`, cache pressure |
| | [`MongoDB-Disk-Full.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Disk-Full.md) | `/var/lib/mongodb` 100% full, database unresponsive |
| | [`MongoDB-Database-Corruption.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Database-Corruption.md) | WiredTiger invariant errors, corrupt data files |
| **Performance & Auth** | [`MongoDB-Slow-Query.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Slow-Query.md) | Database query latency spikes, high CPU usage |
| | [`MongoDB-Missing-Index.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Missing-Index.md) | High `COLLSCAN` volume, massive `docsExamined` |
| | [`MongoDB-Connection-Pool-Exhaustion.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Connection-Pool-Exhaustion.md) | `Too many connections`, client timeouts |
| | [`MongoDB-Authentication-Failure.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Authentication-Failure.md) | SCRAM authentication failure, keyfile permission issue |
| | [`MongoDB-TLS-Certificate-Failure.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-TLS-Certificate-Failure.md) | Expired certificates, SAN mismatch, handshake failures |
| **Disaster Recovery** | [`MongoDB-Backup-Failure.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Backup-Failure.md) | Scheduled backup job failed, snapshot error |
| | [`MongoDB-Restore.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-Restore.md) | Full database restore, point-in-time oplog replay |
