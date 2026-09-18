# MongoDB TLS Certificate Failure — Runbook

**Service:** MongoDB Replica Set  
**Owner:** DevOps / SRE  
**Severity:** P1–P2 depending on application/replica-set impact  
**Applies to:** MongoDB production deployments using TLS

**Purpose:** Diagnose and safely recover MongoDB TLS failures caused by expired certificates, incorrect CA files, hostname/SAN mismatches, permissions, or TLS configuration problems.

---

## 1. Trigger

Use this runbook when:

- MongoDB clients report TLS/SSL errors.
- Replica-set members cannot communicate over TLS.
- Applications cannot connect after certificate changes.
- Logs show `TLS`, `SSL`, `x509`, or certificate errors.
- Certificate expiration alerts fire.
- MongoDB reports certificate validation or handshake failures.

Common errors:

```text
certificate verify failed
x509 certificate error
SSL handshake failed
TLS handshake failed
certificate has expired
Hostname mismatch
unable to get local issuer certificate
```

> ⚠️ **Do not disable TLS verification or authentication as a quick fix.**

---

## 2. Quick Decision Flow

```text
MongoDB TLS Failure
       │
       ▼
Identify Exact Error
       │
       ▼
Check Certificate Expiry
       │
       ▼
Check CA / Certificate Chain
       │
       ▼
Check Hostname / SAN
       │
       ▼
Check File Permissions
       │
       ▼
Check mongod TLS Config
       │
       ▼
Test TLS Connection
       │
       ▼
Restart / Reload Safely
       │
       ▼
Verify Replica Set
       │
       ▼
Verify Application
```

---

## 3. Step 1 — Check MongoDB Status

```bash
systemctl status mongod
```

Check service logs:

```bash
journalctl -u mongod --since "30 minutes ago" --no-pager
```

MongoDB log:

```bash
tail -200 /var/log/mongodb/mongod.log
```

Search TLS errors:

```bash
grep -Ei \
'tls|ssl|x509|certificate|handshake' \
/var/log/mongodb/mongod.log | tail -100
```

---

## 4. Step 2 — Identify the Exact TLS Error

Classify the error:

| Error | Likely Cause |
|---|---|
| `certificate has expired` | Certificate expired |
| `certificate verify failed` | CA/chain/trust problem |
| `unable to get local issuer certificate` | Missing/untrusted CA |
| `Hostname mismatch` | SAN does not contain hostname |
| `permission denied` | MongoDB cannot read certificate |
| `handshake failed` | TLS configuration/protocol/certificate issue |
| `unknown CA` | Client does not trust issuer |
| `no suitable certificate` | Certificate/key/configuration mismatch |

Continue with the matching section.

---

## 5. Step 3 — Check Certificate Expiration

Identify the certificate configured for MongoDB.

Example:

```bash
openssl x509 \
  -in /etc/mongodb/tls/server.pem \
  -noout -dates
```

Check subject and issuer:

```bash
openssl x509 \
  -in /etc/mongodb/tls/server.pem \
  -noout -subject -issuer
```

Check SAN:

```bash
openssl x509 \
  -in /etc/mongodb/tls/server.pem \
  -noout -ext subjectAltName
```

Expected:

```text
notBefore=...
notAfter=...
```

If the certificate is expired:

```text
Renew / replace certificate
        ↓
Verify certificate
        ↓
Verify permissions
        ↓
Update MongoDB configuration if required
        ↓
Restart/reload using approved procedure
```

---

## 6. Step 4 — Check Hostname / SAN

MongoDB TLS hostname verification requires the certificate identity to match the hostname used by the client.

Check:

```bash
openssl x509 \
  -in /etc/mongodb/tls/server.pem \
  -noout -ext subjectAltName
```

Example:

```text
DNS:legacy-db-1.unibotsapi.com
DNS:legacy-db-1
```

If the client connects to:

```text
legacy-db-1.unibotsapi.com
```

that hostname should be represented appropriately in the certificate SAN.

> Do not solve a hostname mismatch by disabling certificate hostname validation in production.

---

## 7. Step 5 — Check CA Certificate

Check the configured CA file:

```bash
grep -n -A15 '^net:' /etc/mongod.conf
```

Look for settings such as:

```text
tls:
  mode:
  certificateKeyFile:
  CAFile:
```

Verify the CA file exists:

```bash
ls -l /etc/mongodb/tls/
```

Inspect the CA certificate:

```bash
openssl x509 \
  -in /etc/mongodb/tls/ca.pem \
  -noout -subject -issuer -dates
```

The server certificate should chain to a CA trusted by the client.

---

## 8. Step 6 — Verify the Certificate Chain

Check the server certificate:

```bash
openssl verify \
  -CAfile /etc/mongodb/tls/ca.pem \
  /etc/mongodb/tls/server.pem
```

Expected:

```text
server.pem: OK
```

If verification fails, investigate:

```text
Wrong CA
Missing intermediate certificate
Incorrect certificate chain
Expired CA
Wrong certificate
```

---

## 9. Step 7 — Check Private Key and Certificate

If MongoDB uses a combined PEM file:

```text
certificate + private key
```

check:

```bash
openssl x509 \
  -in /etc/mongodb/tls/server.pem \
  -noout -modulus | openssl sha256
```

Check the private key:

```bash
openssl rsa \
  -in /etc/mongodb/tls/server.pem \
  -noout -modulus | openssl sha256
```

The hashes should match for an RSA certificate/key pair.

> Protect private keys. Do not paste private-key contents into tickets, chat, logs, or runbooks.

---

## 10. Step 8 — Check File Permissions

Check:

```bash
ls -l /etc/mongodb/tls/
```

The MongoDB service account must be able to read the required certificate and CA files.

Example:

```bash
namei -l /etc/mongodb/tls/server.pem
```

Check the MongoDB service user:

```bash
systemctl cat mongod | grep -E '^User=|^Group='
```

Do not make private keys world-readable.

Avoid:

```bash
chmod 777 /etc/mongodb/tls/*
```

---

## 11. Step 9 — Check MongoDB TLS Configuration

```bash
grep -n -A20 '^net:' /etc/mongod.conf
```

Verify:

```text
tls.mode
tls.certificateKeyFile
tls.CAFile
tls.allowConnectionsWithoutCertificates
tls.allowInvalidCertificates
```

For a production deployment, verify that insecure options have not been enabled unintentionally.

Check the effective configuration according to your MongoDB installation and version.

---

## 12. Step 10 — Test TLS From the Client

Test the MongoDB TLS endpoint:

```bash
openssl s_client \
  -connect <mongodb-host>:27017 \
  -servername <mongodb-host> \
  -CAfile /path/to/ca.pem
```

Look for:

```text
Verify return code: 0 (ok)
```

Review:

```text
Certificate chain
Subject
Issuer
Validity
TLS version
Verification result
```

> `openssl s_client` is a diagnostic tool. A successful TLS handshake does not by itself prove MongoDB authentication or application connectivity is working.

---

## 13. Step 11 — Test MongoDB Client Connection

Example:

```bash
mongosh \
  "mongodb://<mongodb-host>:27017/?tls=true&tlsCAFile=/path/to/ca.pem" \
  -u <username> \
  -p \
  --authenticationDatabase admin
```

If the deployment requires client certificates, include the approved client certificate/key options.

Do not put production passwords directly into shell history.

---

## 14. Step 12 — Check Replica Set TLS Communication

From a healthy member:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

Look for:

```text
PRIMARY
SECONDARY
DOWN
UNKNOWN
```

If one member cannot communicate because of TLS, inspect its MongoDB log:

```bash
grep -Ei \
'tls|ssl|x509|certificate|handshake' \
/var/log/mongodb/mongod.log | tail -100
```

Common replica-set TLS causes:

```text
Expired member certificate
Wrong SAN
Wrong CA
Different CA on one node
Incorrect certificate permissions
TLS configuration mismatch
```

---

## 15. Step 13 — Renew / Replace the Certificate

Before replacing:

```text
[ ] Correct certificate obtained
[ ] Correct CA confirmed
[ ] SANs confirmed
[ ] Certificate expiration confirmed
[ ] Private key matches certificate
[ ] Backup of current configuration exists
[ ] Change/maintenance approval exists
```

Copy the new certificate to the approved location.

Example:

```bash
cp <new-certificate> /etc/mongodb/tls/server.pem
```

Set appropriate ownership:

```bash
chown mongodb:mongodb /etc/mongodb/tls/server.pem
```

Set restrictive permissions appropriate to your deployment:

```bash
chmod 600 /etc/mongodb/tls/server.pem
```

> Use your organization's exact certificate ownership and permission policy.

---

## 16. Step 14 — Validate Configuration Before Restart

Check the MongoDB configuration:

```bash
mongod --config /etc/mongod.conf --configExpand
```

If your MongoDB version/environment supports a configuration validation command, use the approved validation procedure.

Check:

```bash
grep -n -A20 '^net:' /etc/mongod.conf
```

Confirm certificate paths are correct.

---

## 17. Step 15 — Restart MongoDB Safely

Before restarting a replica-set member:

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'
```

If the node is a Secondary and another healthy Secondary/Primary exists, it is generally safer to perform maintenance on that member first.

Restart:

```bash
systemctl restart mongod
```

Check:

```bash
systemctl status mongod
```

Monitor:

```bash
tail -f /var/log/mongodb/mongod.log
```

---

## 18. Step 16 — Verify Replica Set

```bash
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, "health=" + m.health))'
```

Expected:

```text
PRIMARY     1
SECONDARY   1
SECONDARY   1
```

If the repaired member enters:

```text
STARTUP2
```

or:

```text
RECOVERING
```

wait for recovery and verify replication.

If initial sync fails, use:

```text
MongoDB-Initial-Sync-Failure.md
```

---

## 19. Step 17 — Verify Application

Test the application's MongoDB connection.

Check logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Look for:

```text
TLS error
SSL error
x509
certificate verify failed
MongoServerSelectionError
```

Check health:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

---

## 20. Do NOT Do These Things

### ❌ Don't disable TLS

Do not switch production MongoDB from TLS to plaintext just to restore connectivity.

### ❌ Don't disable certificate validation

Avoid insecure options such as:

```text
tlsAllowInvalidCertificates=true
tlsAllowInvalidHostnames=true
```

unless explicitly approved for a controlled diagnostic situation.

### ❌ Don't make private keys world-readable

Never use:

```bash
chmod 777
```

on certificate/key directories.

### ❌ Don't replace certificates blindly

Verify:

```text
Expiration
SAN
Issuer
CA
Private key match
Permissions
```

### ❌ Don't restart all replica-set members at once

Maintain replica-set availability.

### ❌ Don't delete the old certificate immediately

Keep a controlled rollback copy according to your security/change policy.

---

## 21. Quick Reference

```bash
# MongoDB status
systemctl status mongod

# MongoDB logs
tail -200 /var/log/mongodb/mongod.log

# TLS errors
grep -Ei 'tls|ssl|x509|certificate|handshake' \
/var/log/mongodb/mongod.log | tail -100

# Certificate dates
openssl x509 \
  -in /etc/mongodb/tls/server.pem \
  -noout -dates

# Certificate subject/issuer
openssl x509 \
  -in /etc/mongodb/tls/server.pem \
  -noout -subject -issuer

# Certificate SAN
openssl x509 \
  -in /etc/mongodb/tls/server.pem \
  -noout -ext subjectAltName

# Verify certificate
openssl verify \
  -CAfile /etc/mongodb/tls/ca.pem \
  /etc/mongodb/tls/server.pem

# Check files
ls -l /etc/mongodb/tls/
namei -l /etc/mongodb/tls/server.pem

# TLS connection test
openssl s_client \
  -connect <mongodb-host>:27017 \
  -servername <mongodb-host> \
  -CAfile /path/to/ca.pem

# MongoDB TLS connection
mongosh \
  "mongodb://<mongodb-host>:27017/?tls=true&tlsCAFile=/path/to/ca.pem" \
  -u <username> \
  -p \
  --authenticationDatabase admin

# Replica set
mongosh --quiet --eval \
'rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))'

# Restart
systemctl restart mongod
```

---

## 22. Recovery Criteria

- [ ] Certificate is valid and not expired.
- [ ] Correct CA is configured.
- [ ] Certificate chain validates.
- [ ] SAN matches MongoDB hostnames used by clients/members.
- [ ] Private key matches certificate.
- [ ] MongoDB can read certificate files.
- [ ] MongoDB TLS configuration is correct.
- [ ] TLS handshake succeeds.
- [ ] MongoDB authentication succeeds.
- [ ] Replica-set members communicate successfully.
- [ ] Repaired member is healthy.
- [ ] Replication is progressing.
- [ ] Application connects successfully.
- [ ] Application health check succeeds.
- [ ] Certificate renewal/change is documented.

---

## 23. Escalation

Escalate to **Database/SRE** when:

- MongoDB cannot start after certificate changes.
- Replica-set communication is broken.
- TLS configuration is uncertain.
- Multiple MongoDB members are affected.

Escalate to **Security/PKI** when:

- Certificate chain is invalid.
- CA is incorrect or unavailable.
- Certificate issuance/renewal fails.
- Private-key compromise is suspected.

Escalate to **Infrastructure/SRE** when:

- DNS or hostname resolution is incorrect.
- Network connectivity is failing.
- Firewall/routing prevents TLS connections.

Escalate to the **Application Owner** when:

- Client trust store is incorrect.
- Application uses an outdated CA.
- Application TLS settings are incorrect.

---

## Golden Rule

```text
MongoDB TLS Failure
       ↓
DON'T DISABLE TLS
       ↓
Check Error
       ↓
Check Certificate Expiry
       ↓
Check CA + Chain
       ↓
Check SAN / Hostname
       ↓
Check Key + Permissions
       ↓
Check MongoDB TLS Config
       ↓
Test TLS
       ↓
Restart Safely
       ↓
Verify Replica Set
       ↓
Verify Application
```

> **MongoDB TLS failure = verify certificate, CA, SAN, key, permissions, and configuration before making any security-related change.**
