# Redis Client Connection Exhaustion — Runbook

**Service:** Redis Cache / In-Memory Store  
**Owner:** DevOps / SRE / Application Engineers  
**Severity:** P1 (Applications unable to connect, connection pool rejection)  
**Applies to:** Redis standalone, Redis Sentinel, Redis Cluster (v6.x, v7.x)  

**Purpose:** Diagnose and resolve Redis client connection exhaustion (`ERR max number of clients reached`), trace connection leaks from microservice instances, configure connection timeouts, and safely adjust OS file descriptor limits.

---

## 1. Trigger & Alert Symptoms

Use this runbook when:
- Microservices fail to acquire Redis connections and log:
  ```text
  redis.clients.jedis.exceptions.JedisConnectionException: Could not get a resource from the pool
  ERR max number of clients reached
  Error: connect ECONNREFUSED 10.0.1.4:6379
  ```
- Prometheus alerts fire: `RedisConnectedClientsHigh` ($> 90\%$ of `maxclients`).
- New client connections are dropped or rejected immediately upon TCP handshake.

---

## 2. Quick Decision Flow

```text
               Redis Connection Limit Exceeded
                            │
                            ▼
              Check `INFO clients` & `maxclients`
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
 Idle / Abandoned      Maxclients Limit      Host File Descriptor
  Connections          Too Low (< 10000)      Limit (ulimit -n)
 (Connection Leak)          │                   │
        │                   ▼                   ▼
        ▼              Increase Limit        Tune Host Limits
 Terminate Idle        Dynamically           in /etc/security/limits.conf
 & Set Timeout         (Section 5)           (Section 6)
 (Section 4)
```

---

## 3. Step 1 — Diagnostic Commands

Connect to Redis (use administrative socket or reserved buffer if available):
```bash
redis-cli -h <REDIS_HOST> -p <REDIS_PORT> -a <REDIS_PASSWORD>
```

### 1. Inspect Client Statistics
```text
127.0.0.1:6379> INFO clients
```
Example Output:
```text
connected_clients: 9980
cluster_connections: 0
maxclients: 10000                 # At 99.8% capacity!
blocked_clients: 12
tracking_clients: 0
clients_in_timeout_table: 0
```

### 2. Inspect Client List & Group by IP Address
```bash
# Check top client IPs consuming connections:
redis-cli -h <REDIS_HOST> -a <REDIS_PASSWORD> CLIENT LIST | awk '{print $2}' | awk -F: '{print $1}' | sort | uniq -c | sort -nr | head -n 20
```

### 3. Check Longest Idle Connections
```bash
# Sort clients by idle time (seconds):
redis-cli -h <REDIS_HOST> -a <REDIS_PASSWORD> CLIENT LIST | tr ' ' '\n' | grep '^idle=' | sort -t= -k2 -nr | head -n 10
```

---

## 4. Immediate Remediation: Clearing Leaked / Idle Connections

If microservice pods are creating connections without closing them or without pooling:

### 1. Enable Automatic Idle Connection Timeout:
By default, Redis sets `timeout 0` (idle connections never close). Set an emergency timeout of 300 seconds (5 minutes):
```text
127.0.0.1:6379> CONFIG SET timeout 300
```
*Any client connection idle for $> 300\text{s}$ will be automatically closed by Redis.*

### 2. Force Kill Connections from a Specific Rogue IP:
```text
127.0.0.1:6379> CLIENT KILL TYPE normal ADDR 10.0.3.45:54321
# Or kill all connections from a specific client IP:
127.0.0.1:6379> CLIENT KILL IP 10.0.3.45
```

---

## 5. Remediation: Increasing `maxclients` Dynamically

If the cluster is legitimately scaling up and needs higher concurrency:

```text
127.0.0.1:6379> CONFIG SET maxclients 20000
```
Verify the change:
```text
127.0.0.1:6379> CONFIG GET maxclients
```

---

## 6. Fixing Linux OS File Descriptor Limits (`ulimit -n`)

Redis cannot set `maxclients` higher than the OS open file descriptor limit. Redis reserves 32 file descriptors for internal operations, so:
$$\text{Max Open Files} \ge \text{maxclients} + 32$$

### Check current process limits:
```bash
cat /proc/$(pgrep redis-server)/limits | grep "Max open files"
```

### Update systemd service limits:
In `/etc/systemd/system/redis.service` (or `/lib/systemd/system/redis-server.service`):
```ini
[Service]
LimitNOFILE=65536
```
Reload and restart:
```bash
systemctl daemon-reload
systemctl restart redis
```

### In Kubernetes Pod Manifests:
Ensure container security context supports high file descriptors:
```yaml
spec:
  containers:
  - name: redis
    securityContext:
      capabilities:
        add: ["SYS_RESOURCE"]
```

---

## 7. Application-Level Connection Pooling Best Practices

To prevent connection storms:
1. **Enable Connection Pooling:** Ensure applications use pooled connection managers (e.g. `GenericObjectPool` in Jedis, `ioredis` built-in connection pool, or Go `go-redis` pool).
2. **Cap Max Pool Size per Pod:**
   $$\text{Max Pool Size} = \frac{\text{Redis maxclients} \times 0.70}{\text{Max Application Pod Replicas}}$$
3. **Configure TCP Keepalive:**
   ```text
   CONFIG SET tcp-keepalive 300
   ```

---

## 8. Prometheus Alert Rules

```yaml
- alert: RedisClientConnectionsApproachingLimit
  expr: (redis_connected_clients / redis_config_maxclients) * 100 > 85
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Redis {{ $labels.instance }} connection usage is at {{ $value }}%"
```
