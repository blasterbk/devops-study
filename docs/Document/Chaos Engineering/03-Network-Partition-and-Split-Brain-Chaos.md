# Kubernetes Chaos Scenario 03: Network Partition & Split-Brain Chaos

**Domain:** Multi-Zone Topology, CNI Routing, Distributed Consensus & Quorum Safety  
**Chaos Type:** `NetworkChaos` (Cross-Zone Bidirectional Partition)  
**Target:** Multi-AZ Kubernetes Cluster, Stateful Consensus Systems (etcd, MongoDB, Redis)  
**Tools:** CNCF Chaos Mesh, Calico NetworkPolicy, `etcdctl`, `mongosh`, `kubectl`

---

## 1. Experiment Overview

Network partitions occur during cloud availability zone disconnections, transit gateway route table corruptions, VPC peering misconfigurations, or CNI plugin crashes. In distributed systems with consensus protocols, a network partition must never lead to a "split-brain" where two nodes simultaneously believe they are the write master.

The primary experiment tests **Cross-AZ Network Partition & Quorum Preservation for Stateful Services**.

A separate optional experiment tests **Kubernetes Control Plane Resilience When API Server Loses etcd Quorum**.

> **Important:** With odd-numbered voting members (3 or 5 nodes), the majority partition ($\lfloor N/2 \rfloor + 1$) maintains write availability while the minority partition steps down safely. This is a mathematical guarantee of the Raft / Paxos consensus protocols.

### Experiment A — Cross-AZ Partition & Majority Quorum

```text
Zone-A completely isolated from Zone-B and Zone-C
    ↓
Bidirectional packet drop between Zone-A ↔ (Zone-B + Zone-C)
    ↓
Stateful services in Zone-A lose quorum (1/3 minority)
    ↓
Zone-A primaries step down to read-only / follower state
    ↓
Zone-B + Zone-C maintain majority quorum (2/3)
    ↓
New leader elected in majority partition
    ↓
Write availability preserved for majority partition!
```

### Experiment B — API Server + etcd Quorum Loss

```text
etcd member in Zone-A loses connectivity to Zone-B/C peers
    ↓
etcd member becomes learner / non-voting
    ↓
API Server in Zone-A cannot commit writes to etcd
    ↓
kubectl operations routed through Zone-A API Server fail
    ↓
kubectl operations routed through Zone-B/C API Servers succeed
    ↓
Load balancer health check removes Zone-A API Server endpoint
```

---

## 2. Steady-State Hypothesis

> **When Zone-A is completely isolated from Zone-B and Zone-C (bidirectional partition), the minority partition (Zone-A) will step down all primary/leader roles within 10 seconds, the majority partition (Zone-B + Zone-C, 2/3 quorum) will maintain full write availability, zero data inconsistency or dual-master split-brain will occur, and upon partition healing, Zone-A members will rejoin as followers without data loss.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| Split-Brain Prevention | Never more than 1 active write leader in any consensus cluster |
| Majority Write Availability | Zone-B + Zone-C continues accepting writes throughout partition |
| Minority Safe State | Zone-A leaders step down to follower/secondary within 10s |
| Post-Partition Healing | Zone-A members rejoin cluster as followers without data loss |
| Kubernetes API Availability | API Server in majority partition serves all control plane operations |
| Application Continuity | Stateless pods in majority partition continue serving traffic |

---

## 3. Failure Mechanism Architecture

```text
               Cross-AZ Network Partition Architecture

┌─────────────────────────────────────────────────────────────┐
│                    KUBERNETES CLUSTER                       │
│                                                             │
│  ┌──────────────────────────────┐                           │
│  │ ZONE-A (MINORITY — 1/3)     │                           │
│  │                              │                           │
│  │ ┌──────────────────────────┐ │                           │
│  │ │ etcd-1 (was Leader)      │ │                           │
│  │ │ → Steps down to Follower │ │                           │
│  │ │ mongodb-1 (was Primary)  │ │                           │
│  │ │ → Steps down to Secondary│ │                           │
│  │ │ API Server-1             │ │                           │
│  │ │ → Cannot write to etcd   │ │                           │
│  │ │ → Read-only / degraded   │ │                           │
│  │ │ App Pods (stateless)     │ │                           │
│  │ │ → Serve traffic but      │ │                           │
│  │ │   cannot update state    │ │                           │
│  │ └──────────────────────────┘ │                           │
│  └──────────────────────────────┘                           │
│                                                             │
│            ╳ ── NETWORK PARTITION ── ╳                      │
│                                                             │
│  ┌──────────────────────────────┐                           │
│  │ ZONE-B + ZONE-C             │                           │
│  │ (MAJORITY — 2/3 Quorum ✅)  │                           │
│  │                              │                           │
│  │ ┌────────────┐ ┌────────────┐│                           │
│  │ │ etcd-2     │ │ etcd-3     ││                           │
│  │ │ → LEADER   │ │ FOLLOWER   ││                           │
│  │ │ (elected!) │ │            ││                           │
│  │ ├────────────┤ ├────────────┤│                           │
│  │ │ mongodb-2  │ │ mongodb-3  ││                           │
│  │ │ → PRIMARY  │ │ SECONDARY  ││                           │
│  │ │ (elected!) │ │            ││                           │
│  │ ├────────────┤ ├────────────┤│                           │
│  │ │ API-2 ✅   │ │ API-3 ✅   ││                           │
│  │ │ Full R/W   │ │ Full R/W   ││                           │
│  │ └────────────┘ └────────────┘│                           │
│  └──────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

### Important Consensus Partition Mechanics

- **Raft Protocol (etcd):** Requires $\lfloor N/2 \rfloor + 1$ members for quorum. In a 3-member cluster, 2 members needed.
- **MongoDB Replica Set:** Uses a Raft-like election protocol. Primary steps down when it cannot reach a majority.
- **Redis Sentinel:** Requires majority of Sentinels for failover. Minority Sentinels cannot initiate failover.
- **Kubernetes API Server:** Writes go through etcd. If API Server's etcd peer is in minority partition, writes fail.
- **Stateless Pods:** Continue serving traffic but cannot update any persistent state stored in partitioned databases.

---

# 4. Preconditions

Before running the experiment:

### Verify node distribution across zones

```bash
kubectl get nodes -L topology.kubernetes.io/zone
```

### Verify etcd cluster health

```bash
etcdctl endpoint health --cluster
etcdctl member list
```

### Verify stateful service topology

```bash
kubectl get pods -n database -o wide
```

### Verify Chaos Mesh is installed

```bash
kubectl get pods -n chaos-testing
```

---

# 5. Step 1 — Record Baseline

### etcd cluster status

```bash
etcdctl endpoint status --cluster -w table
```

### Stateful service leader/primary status

```javascript
// MongoDB:
rs.status().members.map(m => ({name: m.name, stateStr: m.stateStr}))
```

### Kubernetes API Server health

```bash
kubectl get --raw='/healthz'
kubectl get --raw='/readyz'
```

### Application health

```bash
curl -s https://api.example.com/health | jq .
```

---

# 6. Step 2 — Inject Cross-AZ Network Partition

### Chaos Mesh `NetworkChaos` Manifest

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: zone-a-network-partition
  namespace: chaos-testing
spec:
  action: partition
  mode: all
  selector:
    namespaces:
      - production
      - database
      - kube-system
    nodeSelectors:
      topology.kubernetes.io/zone: us-east-1a
  direction: both
  target:
    selector:
      namespaces:
        - production
        - database
        - kube-system
      nodeSelectors:
        topology.kubernetes.io/zone: us-east-1b
  duration: "5m"
```

Apply:

```bash
kubectl apply -f zone-a-partition.yaml
```

> For Zone-A ↔ Zone-C isolation, create a second manifest targeting `us-east-1c`.

---

# 7. Step 3 — Verify Quorum Preservation

### Check etcd leader election

```bash
etcdctl endpoint status --cluster -w table
```
*Expected: New leader elected in Zone-B or Zone-C.*

### Check MongoDB election

```javascript
// Connect to Zone-B/C member:
rs.status().members.map(m => ({name: m.name, stateStr: m.stateStr}))
```
*Expected: Zone-B or Zone-C member elected PRIMARY.*

### Check API Server availability

```bash
# Through Zone-B/C load balancer:
kubectl get pods --all-namespaces | head -5
```
*Expected: Succeeds.*

### Verify no split-brain

```bash
# There should be exactly ONE etcd leader:
etcdctl endpoint status --cluster -w table | grep "true" | wc -l
```
*Expected: Exactly 1.*

---

# 8. Step 4 — Test Application Traffic During Partition

### Verify stateless pods in majority partition serve traffic

```bash
curl -w "\nStatus: %{http_code} | Time: %{time_total}s\n" \
     -o /dev/null -s \
     https://api.example.com/orders
```

### Verify write operations succeed

```bash
curl -X POST https://api.example.com/orders \
     -H "Content-Type: application/json" \
     -d '{"item": "partition-test", "qty": 1}'
```

---

# 9. Abort Conditions

```text
ABORT CONDITIONS

- Two etcd members simultaneously report Leader status (split-brain!)
- Two MongoDB members simultaneously report PRIMARY status
- API Server becomes completely unavailable in ALL zones
- Data corruption detected in any stateful service
- Partition healing causes cascading crash loops
```

---

# 10. Emergency Stop

```bash
kubectl delete -f zone-a-partition.yaml
```

Or delete all chaos experiments:

```bash
kubectl delete networkchaos --all -n chaos-testing
```

---

# 11. Recovery Validation

After chaos duration expires or manifest is deleted:

### Verify etcd cluster convergence

```bash
etcdctl endpoint health --cluster
etcdctl endpoint status --cluster -w table
```

### Verify MongoDB convergence

```javascript
rs.status().members.map(m => ({name: m.name, stateStr: m.stateStr, health: m.health}))
```

### Verify all nodes are Ready

```bash
kubectl get nodes
```

### Verify no data inconsistency

```bash
# Compare document counts across MongoDB members:
mongosh "mongodb://db-1:27017" --eval "db.orders.countDocuments()"
mongosh "mongodb://db-2:27017" --eval "db.orders.countDocuments()"
mongosh "mongodb://db-3:27017" --eval "db.orders.countDocuments()"
```

---

# 12. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| Split-brain detected | Even number of consensus members (2 or 4) | Always use odd-numbered voting members (3, 5, 7) |
| Minority partition accepts writes | `w: 1` without majority requirement | Enforce `w: "majority"` for MongoDB, quorum writes for etcd |
| API Server fails in all zones | All etcd members in single zone | Distribute etcd members across 3 zones minimum |
| Application timeout in minority zone | No circuit breaker on database connections | Implement circuit breakers with fast-fail on connection timeout |
| Zone-A pods continue serving stale data | Pods cache data locally without freshness check | Implement cache invalidation or TTL-based refresh |

---

# 13. Production Hardening: Multi-Zone Topology

### Pod Anti-Affinity Across Zones

```yaml
spec:
  affinity:
    podAntiAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchExpressions:
          - key: app
            operator: In
            values:
            - mongodb
        topologyKey: topology.kubernetes.io/zone
```

### Topology Spread Constraints

```yaml
spec:
  topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: order-api
```

---

# 14. Experiment Results

| Metric | Baseline | Partition Active | Post-Healing |
|---|---:|---:|---:|
| etcd Leaders | 1 | 1 (in majority) | 1 |
| MongoDB Primaries | 1 | 1 (in majority) | 1 |
| API Server Available | 3/3 zones | 2/3 zones | 3/3 zones |
| Write Success (majority) | Yes | Yes | Yes |
| Split-Brain Count | 0 | 0 | 0 |

---

# 15. Final Assessment & Key Technical Takeaways

```text
Network Partition
    ≠
Total Outage (majority partition maintains availability)

Odd-Numbered Voting Members (3, 5, 7)
    =
Mathematical guarantee against split-brain

Minority Partition Steps Down
    =
Correct behavior (safety over availability)

w: "majority" + 3 Zones
    =
Survives any single-zone failure without data loss

Successful Partition Chaos
    =
Zero split-brain
    +
Majority quorum preserved
    +
Writes available in majority partition
    +
Clean post-healing convergence
```
