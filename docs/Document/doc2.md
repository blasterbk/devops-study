RUNBOOK vs PLAYBOOK — DevOps

Simple Definition:

Runbook = Exact steps to execute a specific task.
Playbook = Overall strategy for handling a broader situation.

--------------------------------------------------
RUNBOOK vs PLAYBOOK
--------------------------------------------------

                    RUNBOOK              PLAYBOOK
--------------------------------------------------
Purpose             Execute a task       Handle a situation
Focus               HOW                  WHAT + WHY + HOW
Scope                Narrow               Broad
Detail               Very specific        High-level + detailed
Used by              Engineer/Operator    Incident Response Team
Decision making      Usually low          Often high
Commands             Many commands        May reference runbooks
Example              Restart Pod          Handle Production Outage
--------------------------------------------------


EXAMPLE: Kubernetes Production 502

PLAYBOOK: Production 502 Incident

1. Check whether the problem is global
2. Check Load Balancer / Gateway
3. Check Kubernetes
4. Check application
5. Determine root cause
6. Mitigate the problem
7. Verify recovery
8. Communicate incident status
9. Perform post-incident review


The Playbook can reference multiple Runbooks:

    Production 502 Incident
            |
            +---> Kubernetes Pod Troubleshooting
            |
            +---> Gateway 502 Troubleshooting
            |
            +---> Service/Endpoint Troubleshooting
            |
            +---> MongoDB Failure Runbook


--------------------------------------------------
ANOTHER EXAMPLE: MongoDB Primary Failure
--------------------------------------------------

PLAYBOOK: MongoDB Production Incident

1. Confirm the incident
2. Check replica set status
3. Determine whether automatic election is occurring
4. Assess application impact
5. Recover the service
6. Verify writes
7. Communicate status
8. Escalate if data integrity is suspected


Referenced Runbooks:

- MongoDB Replica Set Primary Recovery
- MongoDB Replication Lag
- MongoDB Disk Full
- MongoDB Backup Restore
- MongoDB Connection Failure


--------------------------------------------------
EASY WAY TO REMEMBER
--------------------------------------------------

PLAYBOOK
"What should we do about this situation?"

        ↓

RUNBOOK
"Exactly how do I perform this particular action?"


--------------------------------------------------
DEVOPS USAGE
--------------------------------------------------

PLAYBOOK
    ↓
Incident / Major Situation
    ↓
Decisions
    ↓
Multiple Actions
    ↓
RUNBOOKS
    ↓
Exact Commands / Procedures


#######
                    PLAYBOOK
                       │
              "Production outage"
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
    Runbook         Runbook        Runbook
       │               │              │
 Kubernetes          Gateway        MongoDB
 troubleshooting    recovery       recovery


Example:

Production Outage
       ↓
Production Outage Playbook
       ↓
       ├── DNS Failure Runbook
       ├── Kubernetes Runbook
       ├── Gateway Runbook
       ├── Database Runbook
       └── Network Failure Runbook


FINAL RULE:

PLAYBOOK = Strategy for handling an incident

RUNBOOK = Step-by-step procedure for performing an action