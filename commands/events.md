---
description: Watch Kubernetes events sorted by timestamp, with optional namespace and type filters. Use to see what the cluster is doing right now, spot warning events, and correlate a failing pod with the events around it.
argument-hint: "[namespace] [Warning|Normal]"
allowed-tools: Bash(kubectl get events *) Bash(kubectl config *)
---

# Stream recent Kubernetes events

Pull the last hour of cluster events, sorted newest-first, and filter by namespace and event type so the user can see what is happening right now.

## Inputs

`$ARGUMENTS` takes up to two tokens:

1. Namespace name (or `--all-namespaces` for cluster-wide). Defaults to the current namespace.
2. Event type: `Warning` or `Normal`. Defaults to `Warning` because Normal events are usually noise.

Examples:

- `/docker-kubernetes:events` -> warnings in current namespace
- `/docker-kubernetes:events --all-namespaces` -> warnings across the cluster
- `/docker-kubernetes:events production Warning` -> warnings in production
- `/docker-kubernetes:events kube-system Normal` -> normal events in kube-system

## Workflow

1. Confirm the active context:

```bash
kubectl config current-context
```

If it cannot reach a cluster, stop and tell the user to check their kubeconfig.

2. Pull events, sorted by last timestamp. Limit to 30 rows:

```bash
kubectl get events --sort-by=.lastTimestamp --field-selector type=Warning -n <ns> 2>&1 | tail -30
```

Swap `-n <ns>` for `--all-namespaces` if the user asked for cluster-wide. Swap `type=Warning` for `type=Normal` if they asked for normal events.

3. Parse the output. For each row, pull:
   - `LAST SEEN`
   - `TYPE`
   - `REASON`
   - `OBJECT`
   - `MESSAGE`

4. Group by `OBJECT` so repeated events on the same pod or deployment collapse into one line with a count.

## Output format

```
Warning events in <namespace> (last hour)
-----------------------------------------
x3  pod/api-7c4d8b9f5d-xzq4p       BackOff              Back-off restarting failed container
x1  deployment/redis                FailedMount          secret "redis-password" not found
x1  pod/worker-2                    Unhealthy            Readiness probe failed: HTTP 500
```

For each failing object, if there are more than 2 events or a clear crash reason, suggest:
`Use /docker-kubernetes:k8s-debug <pod-name> for a full diagnosis.`

If no warnings in the last hour, print:
`No warning events in <namespace> in the last hour. Cluster is quiet.`

## Do not

- Do not run `kubectl --watch` or any blocking command. This is a snapshot, not a stream.
- Do not follow logs or describe pods in this command. Use `k8s-debug` for that.
- Do not print secret values if a MountFailed event mentions a secret name. Name it, do not dump it.
