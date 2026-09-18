# MongoDB Authentication Failure — Runbook

**Service:** MongoDB Replica Set
**Owner:** DevOps / SRE
**Severity:** P2–P3 depending on application impact
**Applies to:** MongoDB production replica sets

**Purpose:** Quickly identify and fix MongoDB authentication failures such as `Authentication failed`, invalid credentials, or incorrect authentication configuration.

---

## 1. Trigger

Use this runbook when:

* Application reports `Authentication failed`.
* `mongosh` returns `Authentication failed`.
* MongoDB clients cannot authenticate.
* Monitoring reports MongoDB authentication errors.
* Authentication worked previously but suddenly fails.

> **Important:** Do not immediately reset passwords. First determine whether the problem is credentials, authentication database, mechanism, user configuration, or connectivity.

---

## 2. Quick Decision Flow

```text
MongoDB Authentication Failure
          │
          ▼
Check exact error
          │
          ▼
Verify MongoDB connectivity
          │
          ▼
Check username + authenticationDatabase
          │
          ▼
Check authentication mechanism
          │
     ┌────┼─────────┬──────────┐
     ▼    ▼         ▼          ▼
 Password  Auth DB   User      TLS /
 incorrect incorrect missing  Config
     │       │         │          │
     └───────┴─────────┴──────────┘
                 │
                 ▼
             Fix problem
                 │
                 ▼
          Test authentication
                 │
                 ▼
          Verify application
```

---

## 3. Step 1 — Check the Exact Error

Application logs may show:

```text
Authentication failed
MongoServerError: Authentication failed
AuthenticationFailed
Unauthorized
Invalid credentials
```

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Or:

```bash
journalctl -u <application-service> --since "30 minutes ago"
```

If MongoDB logs are available:

```bash
tail -100 /var/log/mongodb/mongod.log
```

---

## 4. Step 2 — Verify MongoDB Connectivity

Before troubleshooting authentication, confirm the server is reachable.

```bash
nc -vz <mongodb-host> 27017
```

Or:

```bash
mongosh "mongodb://<mongodb-host>:27017"
```

If the connection itself fails:

```text
Connection refused
Timeout
Server selection timeout
```

stop this runbook and troubleshoot **MongoDB availability/networking** first.

---

## 5. Step 3 — Test the Credentials

Test using the same username and authentication database used by the application.

```bash
mongosh \
  --host <mongodb-host> \
  -u <username> \
  -p \
  --authenticationDatabase <auth-database>
```

Example:

```bash
mongosh \
  --host mongodb.example.com \
  -u appuser \
  -p \
  --authenticationDatabase admin
```

If authentication succeeds:

```text
Credentials are valid.
```

If it fails:

```text
Authentication failed
```

continue.

> Never put production passwords directly into shell history or incident tickets.

---

## 6. Step 4 — Verify `authenticationDatabase`

A very common problem is using the wrong authentication database.

For example, the user may exist in:

```text
admin
```

but the application attempts authentication against:

```text
mydatabase
```

Check the user's database.

If you have administrative access:

```javascript
use admin
db.getUser("<username>")
```

Or:

```javascript
db.getUsers()
```

The important field is:

```text
user
db
```

If:

```text
user: appuser
db: admin
```

the client should use:

```text
authSource=admin
```

Example:

```text
mongodb://appuser:<password>@mongodb.example.com/mydatabase?authSource=admin
```

---

## 7. Step 5 — Verify the User Exists

From an authorized MongoDB administrative session:

```javascript
use admin
db.getUser("<username>")
```

If the user is stored in another database:

```javascript
use <database>
db.getUser("<username>")
```

If the user does not exist:

```text
Do not immediately create a new user.
```

First confirm:

* Correct username
* Correct environment
* Correct MongoDB cluster
* Correct authentication database
* Whether the user was recently deleted or changed

---

## 8. Step 6 — Check User Roles

If authentication succeeds but the application returns:

```text
Unauthorized
not authorized
command denied
```

this may be a **role/authorization problem**, not an authentication problem.

Check:

```javascript
use admin
db.getUser("<username>")
```

Review:

```text
roles
db
```

Example:

```javascript
{
  user: "appuser",
  db: "admin",
  roles: [
    { role: "readWrite", db: "application_db" }
  ]
}
```

Verify the user's roles match what the application needs.

> Do not grant `root` simply to fix an authorization error.

---

## 9. Step 7 — Check Authentication Mechanism

For SCRAM authentication, verify the configured mechanism.

Common mechanisms:

```text
SCRAM-SHA-256
SCRAM-SHA-1
```

If the application explicitly specifies a mechanism, verify that it is supported and correctly configured.

Example connection option:

```text
authMechanism=SCRAM-SHA-256
```

If the application previously worked and suddenly fails, check for:

* MongoDB upgrade
* Driver upgrade
* Authentication configuration change
* User/password change

---

## 10. Step 8 — Check Password Changes

If the user exists but authentication fails:

```text
Confirm whether the password was recently changed.
```

Check:

* Secret
* Vault
* Kubernetes Secret
* Environment variable
* Application configuration
* Password rotation process

For Kubernetes:

```bash
kubectl get secret <secret-name> -n <namespace>
```

Check how the application receives the Secret:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

> Do not print Secret values into the terminal, logs, tickets, or chat.

---

## 11. Step 9 — Check Application Configuration

Check the application's MongoDB connection configuration.

Look for:

```text
MONGODB_URI
MONGO_URI
MONGODB_USER
MONGODB_PASSWORD
MONGODB_AUTH_SOURCE
MONGODB_AUTH_MECHANISM
```

For Kubernetes:

```bash
kubectl get deployment <deployment-name> \
  -n <namespace> -o yaml
```

Verify:

```text
Username
Password source
Database
authSource
Authentication mechanism
MongoDB hostname
Port
TLS configuration
```

Do not expose the actual password.

---

## 12. Step 10 — Check TLS if Authentication Is Combined With TLS

If the error contains:

```text
TLS
SSL
certificate
handshake
x509
certificate verify failed
```

authentication may not be the actual problem.

Check the MongoDB TLS configuration and client certificate/CA configuration.

Test connectivity using the application's required TLS settings.

If TLS is the cause, use the separate:

```text
MongoDB-TLS-Certificate-Failure.md
```

runbook.

---

## 13. Step 11 — Fix the Root Cause

Possible fixes:

```text
Wrong password
    → Update application Secret/configuration

Wrong authentication database
    → Correct authSource/authenticationDatabase

Wrong username
    → Correct application configuration

User missing
    → Restore/create approved user

Wrong role
    → Correct approved role

Wrong authentication mechanism
    → Correct client configuration

TLS problem
    → Use TLS runbook

Wrong MongoDB cluster
    → Correct connection string
```

After changing a Kubernetes Secret or environment configuration, restart/roll out the affected workload as required.

Example:

```bash
kubectl rollout restart deployment/<deployment-name> \
  -n <namespace>
```

Then monitor:

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

---

## 14. Step 12 — Verify Authentication

Test manually:

```bash
mongosh \
  --host <mongodb-host> \
  -u <username> \
  -p \
  --authenticationDatabase <auth-database>
```

Then test an approved database operation:

```javascript
db.runCommand({ connectionStatus: 1 })
```

Expected:

```text
ok: 1
```

---

## 15. Step 13 — Verify Application

Check application logs:

```bash
kubectl logs <pod-name> -n <namespace>
```

Confirm there are no continuing:

```text
Authentication failed
Unauthorized
MongoServerError
MongoServerSelectionError
```

Check Pod:

```bash
kubectl get pods -n <namespace>
```

Check Deployment:

```bash
kubectl rollout status deployment/<deployment-name> \
  -n <namespace>
```

Finally perform the application health check:

```bash
curl -f https://<application-domain>/health
```

Expected:

```text
HTTP 200
```

---

## 16. Do NOT Do These Things

### ❌ Don't immediately reset the password

First verify:

```text
Username
Authentication database
Secret
Connection string
```

### ❌ Don't grant `root`

An authentication problem does not require administrator privileges.

### ❌ Don't expose passwords

Never put MongoDB passwords in:

```text
Shell history
Logs
Tickets
Slack/Discord
Git
Runbook
```

### ❌ Don't confuse authentication with authorization

```text
Authentication
→ Who are you?

Authorization
→ What are you allowed to do?
```

### ❌ Don't change MongoDB authentication configuration during an incident without a rollback plan

Especially:

```text
security.authorization
authentication mechanisms
TLS
```

---

## 17. Quick Reference

```bash
# Test MongoDB authentication
mongosh \
  --host <mongodb-host> \
  -u <username> \
  -p \
  --authenticationDatabase <auth-database>

# Check user
mongosh --host <mongodb-host> \
  -u <admin-user> -p \
  --authenticationDatabase admin

use admin
db.getUser("<username>")

# Check Pod
kubectl get pod <pod> -n <namespace>

# Check application logs
kubectl logs <pod> -n <namespace>

# Check Deployment
kubectl get deployment <deployment> -n <namespace>

# Check Deployment configuration
kubectl get deployment <deployment> \
  -n <namespace> -o yaml

# Check Kubernetes Secrets
kubectl get secrets -n <namespace>

# Restart application after approved config change
kubectl rollout restart deployment/<deployment> \
  -n <namespace>

# Monitor rollout
kubectl rollout status deployment/<deployment> \
  -n <namespace>
```

---

## 18. Recovery Criteria

The incident is resolved when:

* [ ] MongoDB is reachable.
* [ ] Correct username is confirmed.
* [ ] Correct `authenticationDatabase` is confirmed.
* [ ] Credentials authenticate successfully.
* [ ] Correct authentication mechanism is confirmed.
* [ ] Required roles are confirmed.
* [ ] Application Secret/configuration is correct.
* [ ] Application connects successfully.
* [ ] No new authentication errors appear.
* [ ] Application health check succeeds.
* [ ] Application error rate has returned to normal.

---

## 19. Escalation

Escalate to **Database/SRE** when:

* User cannot authenticate despite verified credentials.
* MongoDB user configuration is uncertain.
* Multiple applications experience authentication failures.
* MongoDB authentication configuration may be damaged.
* Authentication configuration needs to be changed.

Escalate to the **Application Owner** when:

* Wrong credentials are stored in the application.
* Kubernetes/Vault Secret is incorrect.
* Connection string is incorrect.
* Application driver configuration is incorrect.

Escalate to **Security** when:

* Credentials may have been compromised.
* Unexpected password changes are detected.
* Unauthorized users or role changes are suspected.

---

## Golden Rule

```text
Authentication Failure
        ↓
DON'T RESET PASSWORD FIRST
        ↓
Check Connectivity
        ↓
Check Username
        ↓
Check authenticationDatabase
        ↓
Check Password / Secret
        ↓
Check Authentication Mechanism
        ↓
Check Roles
        ↓
Fix Root Cause
        ↓
Test mongosh
        ↓
Verify Application
```

> **Authentication = proving who the user is. Authorization = determining what the user can do. Diagnose these separately.**
