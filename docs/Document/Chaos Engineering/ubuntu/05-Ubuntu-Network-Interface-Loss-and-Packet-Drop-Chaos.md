# Ubuntu Chaos Scenario 05: Network Interface Loss & Packet Drop Chaos

**Domain:** Linux Network Subsystem, TCP Stack, Interface Flapping & Packet Degradation  
**Chaos Type:** Network Interface Drop (`ip link set down`), 25% Packet Loss, Packet Reordering  
**Target:** Ubuntu Linux Network Interfaces (`eth0`, `ens3`, `bond0`)  
**Tools:** `iproute2`, `tc` (Traffic Control NetEm), `iperf3`, `ping`, `netstat`, `ss`

---

## 1. Experiment Overview

This experiment evaluates the resilience of the Linux TCP/IP stack, socket keepalive mechanisms, link aggregation (bonding), and application connection pools under degraded or severed network connectivity.

The primary experiment tests **Packet Loss, Latency Jitter, and Reordering (NetEm)**.

A separate optional experiment tests **Interface Flapping and Fast Link State Recovery**.

> **Important:** High packet loss triggers TCP congestion window collapses and retransmission storms if Selective Acknowledgments (SACK) or TCP Keepalives are improperly tuned.

### Experiment A — Packet Loss & Jitter Injection

```text
tc qdisc netem
    ↓
25% packet loss + 100ms jitter injected on eth0
    ↓
TCP segments dropped in transit
    ↓
TCP SACK triggers fast retransmissions
    ↓
Application throughput degrades gracefully without dropping connection
```

### Experiment B — Interface Flapping

```text
Interface brought down for 5 seconds
    ↓
TCP sockets enter unacknowledged state
    ↓
Interface restored
    ↓
TCP keepalives and retransmission timers recover socket without RST
```

---

## 2. Steady-State Hypothesis

> **When 25% packet loss and 100ms jitter are injected on the primary network interface for up to 3 minutes, Linux TCP Selective Acknowledgments (SACK) will recover lost segments, TCP keepalive timers will detect dead sockets within 60 seconds, and application request retries will maintain service availability without cascading socket exhaustion.**

### Suggested Success Criteria

| Metric | Success Condition |
|---|---|
| TCP Connection Continuity | Established long-lived TCP sessions do NOT drop |
| Retransmission Efficiency | TCP SACK recovers dropped packets without full window stalls |
| Keepalive Detection | Dead peer disconnects detected within 60 seconds |
| Throughput Recovery | Bandwidth returns to line rate immediately after `tc` filter removal |

---

## 3. Failure Mechanism Architecture

```text
              Linux Network Stack Under NetEm Chaos

┌─────────────────────────────────────────────────────────────┐
│                 APPLICATION SOCKET LAYER                    │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Application TCP Sockets (Keepalive: 300s, Probes: 5)  │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ LINUX IP & TCP STACK (TCP SACK, BBR Congestion Control)│  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ TC QUEUING DISCIPLINE (NetEm Active!)                 │  │
│  │ - Injects: `25% Packet Loss` + `100ms (+/- 30ms) Jitter`│
│  │ - Forces kernel TCP fast retransmit pipeline          │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ PHYSICAL / VIRTUAL NETWORK INTERFACE (`eth0`)         │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

# 4. Preconditions

Before running the experiment:

### Verify active network interfaces

```bash
ip addr show
ip route show
```

### Verify iproute2 and diagnostic tools

```bash
which ip tc ping iperf3
```
If missing:
```bash
sudo apt update && sudo apt install -y iproute2 iperf3 net-tools
```

---

# 5. Step 1 — Record Baseline

Record baseline network round-trip time and socket statistics:

```bash
ping -c 10 8.8.8.8
netstat -s | grep -i "segments retransmitted"
ss -s
```

---

# 6. Step 2 — Progressive Network Chaos

---

## 6.1 Experiment A: Injecting 25% Packet Loss & 100ms Jitter via `tc`

On the target server interface (`eth0`):

```bash
# Apply NetEm filter: 100ms latency, 30ms jitter, 25% random loss
sudo tc qdisc add dev eth0 root netem delay 100ms 30ms loss 25%
```

Verify active queuing discipline:

```bash
sudo tc qdisc show dev eth0
```

---

## 6.2 Experiment B: Safe Automated Interface Flap (5-Second Drop)

> ⚠️ Always run the `ip link set eth0 up` command chained with `&&` and a sleep timeout so you do not lock yourself out of remote SSH permanently!

```bash
sudo ip link set eth0 down && sleep 5 && sudo ip link set eth0 up
```

---

# 7. Step 3 — Monitor Network Retransmissions & Sockets

During packet degradation:

### Monitor ICMP packet loss and latency

```bash
ping -c 20 8.8.8.8
```

### Monitor TCP retransmitted segments

```bash
watch -n 1 "netstat -s | grep -i 'segments retransmitted'"
```

### Monitor socket state transitions

```bash
ss -tan state established
```

---

# 8. Step 4 — Abort Conditions

Stop the experiment immediately if:

```text
ABORT CONDITIONS

- SSH session terminates permanently (> 60s disconnection)
- Critical distributed consensus (etcd / MongoDB / Redis) quorum is permanently broken
- Gateway routes are dropped from kernel routing table
```

---

# 9. Step 5 — Emergency Stop & Filter Removal

Remove all traffic control rules and reset interface:

```bash
sudo tc qdisc del dev eth0 root 2>/dev/null || true
sudo ip link set eth0 up 2>/dev/null || true
```

---

# 10. Step 6 — Recovery Validation

Verify zero packet loss and normal latency:

```bash
ping -c 10 8.8.8.8
sudo tc qdisc show dev eth0
```
*Expected: `qdisc noqueue` or default `fq_codel` without netem.*

---

# 11. Failure Modes & Engineering Remediation

| Observed Defect | Possible Root Cause | Engineering Solution |
|---|---|---|
| TCP sockets hang for 2 hours after link drop | Linux default `tcp_keepalive_time` is 7200s (2h) | Tune `net.ipv4.tcp_keepalive_time = 300` in sysctl |
| Total throughput collapse on minimal loss | TCP SACK disabled in kernel | Ensure `net.ipv4.tcp_sack = 1` and `net.ipv4.tcp_dsack = 1` |
| Connection reset (`ECONNRESET`) storm | Socket listen backlog overflow | Increase `net.core.somaxconn = 4096` |

---

# 12. Production Hardening: Linux TCP Stack Tuning

Add to `/etc/sysctl.d/99-network-tuning.conf`:
```ini
# Reduce TCP Keepalive from 2 hours to 5 minutes
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 15
net.ipv4.tcp_keepalive_probes = 5

# Enable Selective Acknowledgments
net.ipv4.tcp_sack = 1
net.ipv4.tcp_dsack = 1

# Connection Backlog Protection
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_syncookies = 1
```
Apply:
```bash
sudo sysctl -p /etc/sysctl.d/99-network-tuning.conf
```

---

# 13. Experiment Results

| Metric | Baseline | 25% Loss + Jitter | Post-Recovery |
|---|---:|---:|---:|
| Ping Packet Loss (%) | 0% | ~25% | 0% |
| Avg Ping RTT (ms) | | +100ms | |
| TCP Retransmission Rate | Low | High (Recovered) | Low |
| SSH Session Survival | Yes | Yes | Yes |

---

# 14. Final Assessment & Key Technical Takeaways

```text
Packet Loss
    ≠
Instant Connection Drop

TCP SACK + BBR
    =
Recovers dropped packets without resetting TCP window

Default Keepalive (7200s)
    =
Production vulnerability (hung dead sockets for 2 hours)

tcp_keepalive_time = 300s
    =
Fast dead-socket cleanup & failover
```
