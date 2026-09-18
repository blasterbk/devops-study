# Memory Pressure Runbooks

This topic is covered by dedicated runbooks depending on the affected layer:

- **Kubernetes Pod OOMKilled:** [`kubernetes/Pod-OOMKilled.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Pod-OOMKilled.md)
  - Covers Exit Code 137, container memory limits, and cgroup OOM kills.
- **Kubernetes Node Insufficient Memory:** [`kubernetes/Insufficient-Memory.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/kubernetes/Insufficient-Memory.md)
  - Covers node capacity planning, pod scheduling failures, and memory pressure conditions.
- **MongoDB Memory Exhaustion & OOM:** [`mongodb/MongoDB-OOM.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb/MongoDB-OOM.md)
  - Covers WiredTiger `cacheSizeGB` tuning, OS page cache, and connection memory tracking.
- **MongoDB Production Crash Incident Guide:** [`mongodb_runbook_proper.md`](file:///c:/Users/BK/Documents/Final/Repo/DevOps-Documentation/Kubernetes_Study/docs/Document/Runbook/mongodb_runbook_proper.md)
  - Covers OOM and COLLSCAN incident triage for the `legacy-rs` cluster.
