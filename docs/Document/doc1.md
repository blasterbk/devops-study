DEVOPS DOCUMENTATION — QUICK REFERENCE

==================================================
1. RUNBOOK
==================================================

Purpose:
Exact step-by-step instructions to perform a specific
operational task or fix a known problem.

Answers:
"Exactly how do I do this?"

Example:
Kubernetes Pod OOMKilled

1. Check pod status
2. Check resource limits
3. Check pod logs
4. Check node memory
5. Increase resources if required
6. Restart deployment
7. Verify pod health

Think:
RUNBOOK = HOW


==================================================
2. PLAYBOOK
==================================================

Purpose:
Overall strategy for handling a broader situation or
incident.

Answers:
"What should we do about this situation?"

Example:
Production Outage

1. Declare incident
2. Assign Incident Commander
3. Assess impact
4. Identify affected systems
5. Mitigate
6. Communicate status
7. Recover service
8. Verify
9. Start postmortem

A Playbook can reference multiple Runbooks.

Think:
PLAYBOOK = WHAT + WHY + HOW


==================================================
3. SOP — STANDARD OPERATING PROCEDURE
==================================================

Purpose:
Defines the standard way the team performs a recurring task.

Example:
Production Deployment SOP

1. Run tests
2. Run security scans
3. Build image
4. Push image
5. Deploy staging
6. Validate
7. Deploy production
8. Monitor

Think:
SOP = STANDARD WAY


==================================================
4. HLD — HIGH LEVEL DESIGN
==================================================

Purpose:
Explains the overall architecture.

Example:

Internet
   ↓
CDN
   ↓
Load Balancer
   ↓
Kubernetes
   ↓
Application
   ↓
MongoDB / Redis

Answers:
"What are we building?"

Think:
HLD = HIGH-LEVEL ARCHITECTURE


==================================================
5. LLD — LOW LEVEL DESIGN
==================================================

Purpose:
Explains the detailed technical implementation.

Example:

VPC: 10.20.0.0/16

Public Subnet:
10.20.1.0/24

Private Subnet:
10.20.10.0/24

Database Subnet:
10.20.20.0/24

Pod CIDR:
10.244.0.0/16

Service CIDR:
10.96.0.0/12

Answers:
"Exactly how are we implementing it?"

Think:
LLD = DETAILED IMPLEMENTATION


==================================================
6. ADR — ARCHITECTURE DECISION RECORD
==================================================

Purpose:
Documents WHY a technical decision was made.

Example:

ADR: Choose Cilium as Kubernetes CNI

Context:
Need network policy and eBPF observability.

Options:
- Calico
- Cilium
- Flannel

Decision:
Use Cilium.

Reasons:
- eBPF
- NetworkPolicy
- kube-proxy replacement
- Hubble

Trade-offs:
- More complex
- Requires additional knowledge

Think:
ADR = WHY


==================================================
7. TROUBLESHOOTING GUIDE
==================================================

Purpose:
Helps engineers diagnose problems and identify possible
root causes.

Example:

Problem:
Pod stuck in ContainerCreating

Possible causes:
- Image pull
- Volume mount
- CNI
- Secret
- ConfigMap
- Container runtime
- Node problem

Commands:
kubectl describe pod
kubectl get events
kubectl logs
crictl ps
journalctl -u kubelet

Think:
TROUBLESHOOTING GUIDE = DIAGNOSE


==================================================
8. DEPLOYMENT GUIDE
==================================================

Purpose:
Explains how to deploy an application or infrastructure.

Example:

1. Build image
2. Scan image
3. Push image
4. Update deployment
5. Monitor rollout
6. Verify health
7. Verify logs
8. Verify metrics

Think:
DEPLOYMENT GUIDE = DEPLOY


==================================================
9. ROLLBACK PLAN
==================================================

Purpose:
Defines how to safely revert a failed change.

Example:

Deployment failed
       ↓
Check health
       ↓
Rollback
       ↓
Verify old version
       ↓
Check traffic
       ↓
Investigate

Kubernetes example:

kubectl rollout history deployment/app
kubectl rollout undo deployment/app
kubectl rollout status deployment/app

Think:
ROLLBACK = REVERT


==================================================
10. CHECKLIST
==================================================

Purpose:
Ensures important steps are not forgotten.

Example:

Production Deployment Checklist

[ ] Tests passed
[ ] Security scan passed
[ ] Image built
[ ] Image pushed
[ ] Backup verified
[ ] Deployment completed
[ ] Pods healthy
[ ] Service healthy
[ ] Gateway healthy
[ ] Health check passed
[ ] Monitoring verified
[ ] Rollback plan available

Think:
CHECKLIST = VERIFY


==================================================
11. INCIDENT RESPONSE PLAN
==================================================

Purpose:
Defines how the team responds to incidents.

Flow:

Alert
  ↓
Acknowledge
  ↓
Assign Incident Commander
  ↓
Assess Severity
  ↓
Investigate
  ↓
Mitigate
  ↓
Communicate
  ↓
Recover
  ↓
Verify
  ↓
Postmortem

Think:
INCIDENT RESPONSE = RESPOND


==================================================
12. RCA / POSTMORTEM
==================================================

Purpose:
Documents what happened and why.

Questions:

What happened?
When did it happen?
What was the impact?
What was the root cause?
Why wasn't it detected?
How was it fixed?
How do we prevent it?
What action items are required?

Important:
Use a BLAMELESS approach.

Think:
RCA = WHY DID IT HAPPEN?


==================================================
13. DR PLAN — DISASTER RECOVERY
==================================================

Purpose:
Defines how infrastructure is recovered after a major
failure.

Example:

Primary Region Down
       ↓
Confirm Disaster
       ↓
Activate DR
       ↓
Restore Database
       ↓
Restore Kubernetes
       ↓
Restore Applications
       ↓
Restore DNS
       ↓
Verify Traffic
       ↓
Return to Normal

Important concepts:

RTO = Recovery Time Objective
RPO = Recovery Point Objective

Think:
DR = RECOVER TECHNOLOGY


==================================================
14. BCP — BUSINESS CONTINUITY PLAN
==================================================

Purpose:
Defines how the BUSINESS continues operating during
a major disruption.

Includes:

- People
- Infrastructure
- Applications
- Vendors
- Communication
- Data
- Remote operations
- Critical business processes

Think:
BCP = KEEP BUSINESS RUNNING


==================================================
15. CHANGE MANAGEMENT
==================================================

Purpose:
Controls production changes.

Example:

Change:
Upgrade MongoDB

Reason:
Security patch

Risk:
Medium

Impact:
Possible connection interruption

Pre-check:
- Backup
- Replica health
- Disk space

Execution:
...

Validation:
...

Rollback:
...

Think:
CHANGE MANAGEMENT = CONTROL CHANGE


==================================================
DEVOPS DOCUMENTATION RELATIONSHIP
==================================================

                         DEVOPS
                            |
       ┌────────────────────┼────────────────────┐
       |                    |                    |
  ARCHITECTURE          OPERATIONS           INCIDENTS
       |                    |                    |
   HLD / LLD              SOP                 Playbook
       |                    |                    |
      ADR                Runbook                |
                            |                    |
                      Checklist                 |
                                                 |
                                      Incident Response
                                                 |
                                               RCA

===================================================
                    DEVOPS DOCUMENTATION
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
     ARCHITECTURE       OPERATIONS        INCIDENTS
          │                 │                 │
      HLD / LLD            SOP            PLAYBOOK
          │                 │                 │
         ADR             RUNBOOK       INCIDENT RESPONSE
                            │                 │
                       CHECKLIST          POSTMORTEM
                            │                 │
                     DEPLOYMENT             RCA
                     ROLLBACK
                     TROUBLESHOOTING






==================================================
EASY WAY TO REMEMBER
==================================================

HLD
→ What are we building?

LLD
→ How is it technically designed?

ADR
→ Why did we choose this design?

SOP
→ What is our standard process?

RUNBOOK
→ What exact steps do I execute?

PLAYBOOK
→ How do we handle this situation?

CHECKLIST
→ What must I verify?

TROUBLESHOOTING GUIDE
→ How do I diagnose the problem?

DEPLOYMENT GUIDE
→ How do I deploy it?

ROLLBACK PLAN
→ How do I revert it?

INCIDENT RESPONSE
→ How do we respond?

RCA / POSTMORTEM
→ Why did it happen?

DR
→ How do we recover technology?

BCP
→ How does the business continue?

CHANGE MANAGEMENT
→ How do we safely change production?


==================================================
RECOMMENDED DEVOPS DOCUMENTATION STRUCTURE
==================================================

DevOps-Documentation/
│
├── Architecture/
│   ├── HLD/
│   ├── LLD/
│   └── ADR/
│
├── SOP/
│
├── Runbooks/
│   ├── Kubernetes/
│   ├── MongoDB/
│   ├── Jenkins/
│   ├── Networking/
│   ├── Security/
│   └── Infrastructure/
│
├── Playbooks/
│   ├── Production-Outage/
│   ├── Security-Incident/
│   ├── Database-Incident/
│   └── Disaster-Recovery/
│
├── Deployment/
│
├── Rollback/
│
├── Troubleshooting/
│
├── Incident-Response/
│
├── DR/
│
├── BCP/
│
├── Change-Management/
│
├── Postmortems/
│
└── Checklists/