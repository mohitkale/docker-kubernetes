---
name: rbac-review
description: Audit Kubernetes RBAC for overly broad permissions. Use when the user asks to review roles, service accounts, or role bindings for least privilege, or wants to know what a specific principal can do in the cluster.
argument-hint: "[namespace]"
allowed-tools: Bash(kubectl get *) Bash(kubectl describe *) Bash(kubectl auth can-i *) Read Grep Glob
---

# Audit Kubernetes RBAC

Review RBAC definitions and flag overly broad permissions.

## Inputs

`$ARGUMENTS` is an optional namespace. If empty, audit cluster-wide RBAC (ClusterRole, ClusterRoleBinding) and ask whether the user also wants to audit a specific namespace.

## Workflow

### Step 1: inventory

```bash
kubectl get clusterrole -o wide
kubectl get clusterrolebinding -o wide
kubectl get role -n <ns>
kubectl get rolebinding -n <ns>
kubectl get serviceaccount -n <ns>
```

### Step 2: look for broad permissions

For each ClusterRole and Role, check `rules` for any of these red flags:

- `verbs: ["*"]` on any resource.
- `resources: ["*"]` on any API group.
- `apiGroups: ["*"]`.
- `resources: ["secrets"]` with `verbs` including `get` or `list`, outside a controller that genuinely needs it.
- `resources: ["pods/exec"]` or `["pods/attach"]` outside of explicit admin roles.
- `nonResourceURLs: ["*"]`.

### Step 3: trace bindings

For each risky role, find who uses it:

```bash
kubectl get clusterrolebinding -o json | jq '.items[] | select(.roleRef.name == "<role>")'
```

If `jq` is not available, use `kubectl describe clusterrolebinding` and read the output.

Focus on:
- Service accounts bound to `cluster-admin` or other broad roles.
- Groups such as `system:authenticated` or `system:unauthenticated` bound to anything non-trivial.
- Human users bound directly to ClusterRoles when a group would be more appropriate.

### Step 4: test specific permissions

For any principal that looks risky, confirm with:

```bash
kubectl auth can-i --list --as=system:serviceaccount:<ns>:<sa>
```

## Output

Report findings grouped by severity:

```
## Critical
- <principal> has <verb> on <resource> cluster-wide via <role>. <why this is bad>. <fix>.

## High
- <...>

## Medium
- <...>

## Info
- <N> service accounts use the default service account in namespace <ns>. Consider creating dedicated accounts.
```

For each finding, include:
- The exact role or binding, with namespace.
- The problematic rule.
- A concrete replacement rule that follows least privilege.

## Example finding

**Critical**: ServiceAccount `ci-runner` in namespace `build` is bound to ClusterRole `cluster-admin` via ClusterRoleBinding `ci-runner-admin`. This gives CI full control of the cluster, including reading every Secret.

Replace with a minimal Role in the `build` namespace:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ci-runner
  namespace: build
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch", "update"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list"]
```

## Common fixes

- Replace `verbs: ["*"]` with the actual verbs the workload uses.
- Replace `resources: ["*"]` with the specific resource kinds.
- Split a ClusterRole into a Role when access is only needed in one namespace.
- Create a dedicated ServiceAccount instead of using the namespace default.

## Do not

- Do not modify RBAC resources without asking the user.
- Do not produce findings based only on role names. Always read the actual rules.
