---
description: Run the full Docker and Kubernetes audit pass in one command. Chains doctor, events, rbac-review, and helm-review (if Helm charts are detected) into a single report. Use as a pre-release or pre-handoff check to surface everything the plugin can find in one pass.
argument-hint: "[namespace]"
allowed-tools: Bash(docker version *) Bash(docker context *) Bash(docker ps *) Bash(docker info *) Bash(docker system df *) Bash(docker compose *) Bash(docker-compose *) Bash(kubectl version *) Bash(kubectl config *) Bash(kubectl cluster-info *) Bash(kubectl get *) Bash(kubectl describe *) Bash(kubectl auth *) Read Glob Grep
---

# Full Docker and Kubernetes audit

Execute the plugin's audit skills in sequence and produce one combined report. This is the "do everything" command. It runs four existing skills back-to-back, collates the output, and tells the user which findings are most important.

Do not invoke this command automatically. Only run when the user explicitly asks for a full audit.

## Inputs

`$ARGUMENTS` takes an optional namespace. Defaults to the current namespace. Use `--all-namespaces` to audit cluster-wide.

## Workflow

Run each step. If a step fails (no cluster reachable, no Helm chart in cwd, etc.), note the failure and continue. Do not halt on first failure.

### Step 1: Environment check (from `doctor`)

Run the same flow as `/docker-kubernetes:doctor`. Report Docker daemon, Compose availability, kubectl version, cluster context, and non-running pods. If no cluster is reachable, skip the event and RBAC steps that need the cluster, but still run the static Helm chart review if charts are present.

### Step 2: Recent events (from `events`)

Run the same flow as `/docker-kubernetes:events <namespace> Warning`. Limit the report to the latest 30 retained events. Collapse by object.

### Step 3: RBAC review (from `rbac-review`)

Run the same flow as `/docker-kubernetes:rbac-review <namespace>`. Report overly broad ClusterRoles, ClusterRoleBindings, wildcards, and service accounts with cluster-admin equivalents.

### Step 4: Helm chart review (from `helm-review`), only if Helm charts present

If `./charts/` exists or a `Chart.yaml` is in cwd, run the same flow as `/docker-kubernetes:helm-review ./charts/<name>` (or `./`). Skip silently if no chart.

## Output format

Produce a single combined report. Group findings by severity.

```
Docker and Kubernetes full audit
================================
Namespace: production        Context: aks-prod-eastus

Environment
-----------
Docker:          running (27.3.1)
kubectl:         v1.30.2 (client), v1.30.3 (server)
Cluster reach:   ok
Non-running pods: 2 (see below)

Findings
========
Critical (2):
- pod/api-7c4d8b9f5d-xzq4p CrashLoopBackOff in production (3 restarts in last 10 min)
- ClusterRoleBinding cluster-admin-for-deployer grants system:masters to serviceaccount/deployer

High (4):
- 12 recent warning events on deploy/redis (FailedMount, Unhealthy)
- Role "full-access" has "*" in resources and verbs in production namespace
- Helm chart web-api has resources.limits.memory "4Gi" but requests 200Mi (10x over-provision risk)
- Helm chart web-api does not set a PodDisruptionBudget

Medium (3):
- 3 service accounts in kube-system do not automount tokens
- Helm chart uses hardcoded image tag "latest" in values.yaml
- Helm chart does not pin Kubernetes API version in Chart.yaml

Suggested next steps
--------------------
1. `/docker-kubernetes:k8s-debug api-7c4d8b9f5d-xzq4p production` to diagnose the CrashLoopBackOff
2. Review ClusterRoleBinding cluster-admin-for-deployer (kubectl describe)
3. Tighten the "full-access" Role with specific resources and verbs
```

If nothing of concern is found, report:

```
Docker and Kubernetes full audit
================================
Nothing of concern found. Toolchain healthy, no broad RBAC, no recent warning events, Helm charts (if any) follow standard conventions.
```

## Do not

- Do not run state-changing commands under any step. This is a read-only audit. Destructive operations require explicit per-command invocation.
- Do not include the full output of each skill. Summarize to the findings. Keep the combined report under 80 lines.
- Do not run in a loop or on a schedule. One invocation = one audit.
