# MongoDB Chaos Engineering & Resilience Testing Suite

Welcome to the **MongoDB Production Chaos Engineering Suite**. This guide provides practical GameDay scenarios, declarative fault injection scripts, and resilience validation playbooks specifically tailored for MongoDB Replica Sets (e.g. `legacy-rs` on MongoDB 8.x / 7.x).

---

## 🎯 Objectives of MongoDB Chaos Testing

1. **Validate Zero Data Loss:** Ensure that unacknowledged or non-majority writes are eliminated and client drivers handle transitions with `retryWrites=true` and `w: "majority"`.
2. **Quantify Failover RTO (Recovery Time Objective):** Measure exact time taken for heartbeat detection, election, and application connection re-establishment ($< 10\text{s}$).
3. **Verify Read Preference Fallbacks:** Ensure applications configured with `secondaryPreferred` gracefully fall back to Primary when replication lag exceeds `maxStalenessSeconds`.
4. **Test Safe Failure Boundaries:** Confirm that catastrophic storage full, memory exhaustion, or network partitions do not lead to WiredTiger data corruption or unrecoverable split-brains.

---

## 🗺️ Master MongoDB Chaos Engineering Scenarios

| # | Scenario File | Fault Injected | Target Component | Key Hypothesis & Validation |
|---|---|---|---|---|
| **01** | [`01-MongoDB-Primary-Stepdown-and-Election-Storm-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/01-MongoDB-Primary-Stepdown-and-Election-Storm-Chaos.md) | `rs.stepDown()` under 1,000 writes/s | Primary Node | Failover completes in $<8\text{s}$; zero 500 errors returned to end users. |
| **02** | [`02-MongoDB-Replication-Lag-and-Stale-Secondary-Reads-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/02-MongoDB-Replication-Lag-and-Stale-Secondary-Reads-Chaos.md) | Network throttling & disk delay on Secondary | Secondary Member | `maxStalenessSeconds` triggers fallback to Primary; prevents stale reads. |
| **03** | [`03-MongoDB-Network-Partition-Split-Brain-and-Rollback-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/03-MongoDB-Network-Partition-Split-Brain-and-Rollback-Chaos.md) | Asymmetrical network partition | Replica Set Quorum | Minority steps down; majority maintains writes; rollback directory safely generated. |
| **04** | [`04-MongoDB-WiredTiger-Cache-Pressure-and-OOM-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/04-MongoDB-WiredTiger-Cache-Pressure-and-OOM-Chaos.md) | Massive `COLLSCAN` + Host Memory Stress | WiredTiger Engine | Cache eviction thread throttles without crashing; Linux OOM killer avoided. |
| **05** | [`05-MongoDB-Connection-Pool-Exhaustion-and-Leak-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/05-MongoDB-Connection-Pool-Exhaustion-and-Leak-Chaos.md) | Synthetic connection storm & leaks | Client Driver Pools | `waitQueueTimeoutMS` sheds load gracefully; prevents mongod socket exhaustion. |
| **06** | [`06-MongoDB-Disk-Exhaustion-and-Journal-Safety-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/06-MongoDB-Disk-Exhaustion-and-Journal-Safety-Chaos.md) | 100% Disk Full on `/var/lib/mongodb` | Storage / Journal | WiredTiger clean read-only freeze; zero B-tree corruption upon disk expansion. |
| **07** | [`07-MongoDB-Oplog-Window-Overrun-and-Initial-Sync-Chaos.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Chaos%20Engineering/mongodb/07-MongoDB-Oplog-Window-Overrun-and-Initial-Sync-Chaos.md) | Heavy write storm + Secondary pause | Oplog Buffer | Secondary falls off oplog window; triggers automated file-copy initial sync cleanly. |

---

## 🛑 Emergency Abort Protocol (MongoDB GameDays)

If any of the following occur during an experiment, **ABORT IMMEDIATELY**:
1. All voting replica set members become `DOWN` or `UNKNOWN`.
2. Application HTTP error rate exceeds **$1\%$** for more than 30 seconds.
3. Disk space on any remaining healthy member drops below **$10\%$**.
4. Database corruption / invariant assertion appears in mongod logs (`WT_PANIC` / `Invariant failure`).

### Emergency Abort Command:
```bash
# Force remove all network throttling / packet drops across all nodes:
sudo tc qdisc del dev eth0 root 2>/dev/null || true
sudo iptables -F CHAOS_DROPS 2>/dev/null || true

# Force restart mongod if frozen
sudo systemctl restart mongod
```
