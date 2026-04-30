---
name: k8s-debug
description: Investigate a failing Kubernetes pod or workload by pulling events, logs, and describe output. Use when the user reports a CrashLoopBackOff, ImagePullBackOff, OOMKilled, Pending pod, Init container failure, or any pod that is not Running and Ready.
argument-hint: "<pod-name> [namespace]"
allowed-tools: Bash(kubectl get *) Bash(kubectl describe *) Bash(kubectl logs *) Bash(kubectl events *) Bash(kubectl top *) Bash(kubectl rollout status *) Bash(kubectl rollout history *) Read Grep
---

# Debug a failing pod

Explain why a pod is not Running and Ready, and suggest a concrete fix.

## Inputs

`$ARGUMENTS` should be the pod name followed by an optional namespace. Examples:

- `api-7c4d8b9f5d-xzq4p`
- `my-pod default`
- `worker-0 production`

If the user does not give a pod name, ask for it. If no namespace is given, default to `default`.

## Workflow

Run the commands in this order. Stop early if you find a clear root cause.

### Step 1: status and events

```bash
kubectl get pod <pod> -n <ns> -o wide
kubectl describe pod <pod> -n <ns>
```

Focus on:
- `Status` and `Reason` at the top of describe output.
- `Conditions` block (PodScheduled, Initialized, ContainersReady, Ready).
- `Events` section at the bottom. Recent events are almost always where the answer is.
- `Containers` section, specifically `State` and `Last State` with their `Reason` and `Exit Code`.

### Step 2: logs

```bash
kubectl logs <pod> -n <ns> --tail=200 --timestamps
kubectl logs <pod> -n <ns> --previous --tail=200 --timestamps
```

The `--previous` flag shows logs from the last crashed instance, which is usually what you need in a CrashLoopBackOff.

For pods with multiple containers, add `-c <container-name>`.

### Step 3: cluster-level events (if pod events are not enough)

```bash
kubectl get events -n <ns> --sort-by=.lastTimestamp | tail -30
```

On Windows shells without `tail`, run the same `kubectl get events ...` command without the pipe and summarize only the latest 30 rows from the returned output.

### Step 4: rollout status (for Deployment and StatefulSet)

If the issue is a Deployment that is stuck mid-rollout:

```bash
kubectl rollout status deployment/<name> -n <ns> --timeout=60s
kubectl rollout history deployment/<name> -n <ns>
```

This shows whether new pods are coming up and what the previous revisions looked like.

### Step 5: Service endpoints (pod is Ready but callers cannot reach it)

When the pod is Running and Ready but requests from other pods or from an Ingress fail, check that the Service has endpoints:

```bash
kubectl get endpoints <service> -n <ns>
kubectl describe service <service> -n <ns>
```

If the endpoints list is empty, the Service `spec.selector` does not match any pod labels. Compare them side by side.

### Step 6: NetworkPolicy (network calls blocked)

If DNS resolves but connections time out or are refused, check for a NetworkPolicy that blocks the traffic:

```bash
kubectl get networkpolicy -n <ns>
kubectl describe networkpolicy -n <ns>
```

A namespace with a default-deny policy needs an explicit allow rule for the traffic you expect.

## Common failures and fixes

- **ImagePullBackOff or ErrImagePull**: image name or tag wrong, or missing registry credentials. Check the image reference and any `imagePullSecrets`.
- **CrashLoopBackOff**: the container keeps exiting on startup. Read `--previous` logs for the real error. Usually a missing env var, failed migration, or bad config.
- **OOMKilled (Exit code 137)**: the container ran out of memory. Raise `resources.limits.memory` or fix a memory leak.
- **Init:Error**: an init container failed. Use `kubectl logs <pod> -c <init-container-name>` to read its output.
- **Pending with "0/N nodes are available"**: the scheduler could not place the pod. Common causes: insufficient CPU or memory on any node, node selector or affinity rules, taints without tolerations, PVC not bound.
- **Pending with volume attach error**: a PersistentVolumeClaim is stuck. Check `kubectl get pvc -n <ns>` and the storage class.
- **Liveness probe failing**: the app is reachable but the probe config is wrong. Check the probe path, port, and initial delay.
- **Readiness probe failing**: the pod starts but is not Ready. The app often takes longer to start than the probe allows. Raise `initialDelaySeconds` or fix the readiness endpoint.
- **Deployment stuck mid-rollout**: new ReplicaSet pods fail readiness and the old ReplicaSet is still serving. Use `kubectl rollout status` and read the new pod's logs. Consider `kubectl rollout undo` after the user approves.
- **Service has no endpoints**: `spec.selector` on the Service does not match the pod labels. Fix one or the other so they agree.
- **NetworkPolicy blocks traffic**: a deny-by-default policy is in force without an allow rule for the traffic. Add a policy that allows ingress from the expected source pods or namespaces.

## Output

1. State the root cause in one short sentence.
2. Quote the 3 to 10 lines of output that support it.
3. Give a concrete fix. If it needs a manifest change, show the before and after YAML block.
4. If the diagnosis needs more data, say which command to run next and why.

## Example diagnosis

**Root cause**: pod `api-7c4d8b9f5d-xzq4p` is in CrashLoopBackOff because it cannot reach Postgres at startup. The `DATABASE_URL` env var points to `localhost:5432` instead of the in-cluster service.

**Evidence**:
```
$ kubectl logs api-7c4d8b9f5d-xzq4p -n default --previous --tail 5
2026-04-17T09:21:05Z error: connect ECONNREFUSED 127.0.0.1:5432
2026-04-17T09:21:05Z error: DatabaseConnectionError at startup
Exit code: 1
```

**Fix** in the Deployment:
```yaml
env:
  - name: DATABASE_URL
    value: postgres://app:app@postgres.default.svc.cluster.local:5432/app  # was: postgres://app:app@localhost:5432/app
```

**Next step**:
```bash
kubectl rollout restart deployment/api -n default
kubectl rollout status deployment/api -n default
```

## Reference

If you encounter a pod status or event you do not immediately recognise, read `reference/pod-error-patterns.md` from the plugin root. It documents 10+ common patterns (CrashLoopBackOff, ImagePullBackOff, OOMKilled, Pending, Evicted, etc.) with the exact kubectl output, root causes, and fix commands. Do not read by default; only when a pattern is unfamiliar.

## Do not

- Do not run `kubectl delete`, `kubectl edit`, `kubectl patch`, or `kubectl apply` without asking the user first.
- Do not guess. If logs and events are empty, explain that and suggest how to enable more verbose logging.
