# Kubernetes ETCD Quorum Loss, High Latency & Space Alarm — Runbook

**Service:** ETCD Cluster / Kubernetes Control Plane  
**Owner:** DevOps / SRE / Platform Team  
**Severity:** P0 / P1 (Control plane down, API server 504s, or etcd out of space)  
**Applies to:** ETCD v3.4+, kubeadm, stacked or external ETCD topology  

**Purpose:** Rapidly diagnose and resolve ETCD cluster degradation, resolve `NOSPACE` alarms via compaction/defragmentation, recover leader election stability, and restore ETCD quorum during split-brain/outages.

---

## 1. Trigger & Alert Symptoms

Use this runbook when:
- `kubectl` commands return `Error from server (Timeout)` or `504 Gateway Timeout`.
- API Server logs show `etcdserver: request timed out` or `etcdserver: leader changed`.
- Prometheus alerts fire:
  - `etcdHighFsyncDurations` (disk sync latency > 10ms).
  - `etcdNoLeader` or `etcdMembersDown`.
  - `etcdDatabaseHighFragmentation` or `etcdDatabaseQuotaExceeded` (`NOSPACE`).
- ETCD pod / service logs contain:
  ```text
  raft: 12345 received a MsgVote from 67890 at term 123
  etcdserver: mvcc: database space exceeded
  etcdserver: apply request took too long (120ms)
  ```

---

## 2. Quick Decision Flow

```text
               ETCD Cluster Incident
                         │
                         ▼
        Check ETCD Alarms & Quorum Status
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  "NOSPACE" Alarm   High Disk Fsync   Quorum Lost
   (Quota Full)      Latency (>10ms)  (Majority Down)
        │                │                │
        ▼                ▼                ▼
 Compact & Defrag   Check Disk I/O &  Disaster Recovery /
 Disarm Alarm       Move to Fast NVMe Re-seed Member
 (Section 4)        (Section 5)       (Section 6)
```

---

## 3. Step 1 — Fast Triage & Health Diagnostics

Run `etcdctl` commands (from control plane node with root certificates):
```bash
export ETCDCTL_API=3
export ETCD_CERTS="--cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key"
export ENDPOINTS="https://127.0.0.1:2379"

# 1. Check Cluster Member List
etcdctl $ETCD_CERTS --endpoints=$ENDPOINTS member list -w table

# 2. Check Endpoint Health
etcdctl $ETCD_CERTS --endpoints=$ENDPOINTS endpoint health -w table

# 3. Check Database Size & Fragmentation Status
etcdctl $ETCD_CERTS --endpoints=$ENDPOINTS endpoint status -w table

# 4. Check for active Alarms (e.g. NOSPACE, CORRUPT)
etcdctl $ETCD_CERTS --endpoints=$ENDPOINTS alarm list
```

---

## 4. Remediation: Database Space Exceeded (`NOSPACE` Alarm)

When etcd reaches its quota (default 2GB, recommended 8GB), all write operations are blocked.

### Step 1: Get the current ETCD revision
```bash
REV=$(etcdctl $ETCD_CERTS --endpoints=$ENDPOINTS endpoint status --write-out="json" | jq '.[0].Status.header.revision')
echo "Current Revision: $REV"
```

### Step 2: Compact old historical revisions
```bash
etcdctl $ETCD_CERTS --endpoints=$ENDPOINTS compact $REV
```

### Step 3: Defragment the database files (Run on ALL endpoints)
Defragmentation releases freed space back to the filesystem. Defragment endpoints one-by-one:
```bash
# Defrag individual node
etcdctl $ETCD_CERTS --endpoints="https://<ETCD_NODE_IP>:2379" defrag
```

### Step 4: Disarm the Alarm to unfreeze API Server writes
```bash
etcdctl $ETCD_CERTS --endpoints=$ENDPOINTS alarm disarm
```

### Step 5: Verify writes are restored
```bash
kubectl get nodes
```

---

## 5. Remediation: High Disk `fsync` Write Latency

ETCD requires fast, synchronous disk writes ($< 10\text{ms}$). High latency causes raft leader election dropouts.

1. **Check disk I/O latency using `fio` / `iostat` on the host:**
   ```bash
   iostat -xz 1 10
   ```
   Look for `await` and `util%` on the drive hosting `/var/lib/etcd`.
2. **Short-Term Fix:**
   - Increase I/O scheduling priority for etcd via `ionice`:
     ```bash
     ionice -c2 -n0 -p $(pgrep etcd)
     ```
3. **Permanent Fix:**
   - Mount `/var/lib/etcd` on dedicated, high-IOPS NVMe SSDs.
   - Separate container runtime/log storage from ETCD data directory.

---

## 6. Remediation: Quorum Loss & Failed Member Removal

If 1 member in a 3-node cluster is dead, quorum (2/3) is maintained, but the dead member must be removed and replaced.

### 1. Remove Failed Member:
```bash
etcdctl $ETCD_CERTS --endpoints=$ENDPOINTS member remove <MEMBER_ID>
```

### 2. Add New Replacement Member:
```bash
etcdctl $ETCD_CERTS --endpoints=$ENDPOINTS member add <NEW_MEMBER_NAME> --peer-urls="https://<NEW_MEMBER_IP>:2380"
```

---

## 7. Emergency Snapshot Backup & Disaster Recovery

### Create a Manual Snapshot:
```bash
etcdctl $ETCD_CERTS --endpoints=$ENDPOINTS snapshot save /tmp/etcd-backup-$(date +%F-%T).db
etcdctl $ETCD_CERTS snapshot status /tmp/etcd-backup-*.db -w table
```

### Restore from Snapshot (When Quorum is Permanently Lost):
1. Stop API server and etcd on all master nodes:
   ```bash
   mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/
   mv /etc/kubernetes/manifests/etcd.yaml /tmp/
   ```
2. Restore snapshot to a new data directory on master node:
   ```bash
   etcdctl snapshot restore /tmp/etcd-backup-*.db \
     --data-dir=/var/lib/etcd-restored \
     --name=master-node-1 \
     --initial-cluster=master-node-1=https://<MASTER_IP>:2380 \
     --initial-cluster-token=etcd-cluster-restore \
     --initial-advertise-peer-urls=https://<MASTER_IP>:2380
   ```
3. Replace `/var/lib/etcd` with `/var/lib/etcd-restored` and move manifests back.

---

## 8. Hardening & Best Practices

1. **Configure 8GB Quota in `/etc/kubernetes/manifests/etcd.yaml`:**
   ```yaml
   spec:
     containers:
     - command:
       - etcd
       - --quota-backend-bytes=8589934592
       - --auto-compaction-retention=1
       - --auto-compaction-mode=periodic
   ```
2. **Automated Daily Snapshot Cron:**
   Ensure regular automated ETCD snapshots are shipped to remote S3/MinIO storage.
