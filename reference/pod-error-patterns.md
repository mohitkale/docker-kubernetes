# Kubernetes pod error patterns

A lookup catalogue of common pod failures, how they appear in `kubectl describe pod` and `kubectl get events`, the most likely root cause, and the concrete fix. Read this file from the `k8s-debug` skill only when you encounter one of the listed patterns and need more context before giving a diagnosis.

Keep this file flat and skimmable. No prose walls.

## CrashLoopBackOff

**Typical output**

```
State:          Waiting
  Reason:       CrashLoopBackOff
Last State:     Terminated
  Reason:       Error
  Exit Code:    1
```

**Most common causes, in order**

1. Application throws on startup (missing env var, bad config). Check `kubectl logs <pod> --previous`.
2. Liveness probe path returns non-200. Check the probe path in the manifest.
3. Port binding conflict or listener on wrong port.
4. Startup command wrong (`command` and `args` mismatch with image `ENTRYPOINT` / `CMD`).

**Fix pattern**

Run `kubectl logs <pod> --previous --tail=100`. The stack trace on the last crash tells you the cause directly. If logs are empty, check the probe path and command.

## ImagePullBackOff / ErrImagePull

**Typical output**

```
Failed to pull image "...": rpc error: code = NotFound desc = ...
```

**Causes**

1. Image tag does not exist.
2. Registry requires auth and no `imagePullSecrets` is referenced.
3. Private registry hostname typo.
4. Registry rate limit (Docker Hub unauthenticated limit is 100 pulls per 6 hours per IP).

**Fix pattern**

Run `kubectl describe pod <pod>` and read the `Events` section. It will literally say "unauthorized" or "manifest unknown". If unauthorized, create a registry secret:

```bash
kubectl create secret docker-registry regcred \
  --docker-server=<registry> \
  --docker-username=<user> \
  --docker-password=<token>
```

Then patch the deployment `spec.template.spec.imagePullSecrets`.

## OOMKilled

**Typical output**

```
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
```

**Causes**

The pod hit its `resources.limits.memory`. Either the limit is wrong, or the app genuinely leaks memory.

**Fix pattern**

1. Check the actual usage over time: `kubectl top pod <pod>` (requires metrics-server) or a Prometheus/Grafana dashboard.
2. If the spike is real work, raise the limit. Double it and observe.
3. If memory climbs monotonically, the app leaks. Do not just keep raising the limit.

## Pending (no nodes available)

**Typical output**

```
Events:
  Warning  FailedScheduling  ...  0/3 nodes are available: 3 Insufficient cpu.
```

**Causes**

1. Requests exceed any node's capacity.
2. Node selector or taints filter out all nodes.
3. PersistentVolumeClaim cannot bind (no matching storage class).

**Fix pattern**

```bash
kubectl describe pod <pod>                          # read Events
kubectl top nodes                                   # confirm capacity
kubectl get pvc -n <ns>                             # if PVC is the issue
```

Lower `resources.requests` or add nodes to the cluster. For PVCs, check the storage class name matches one that exists.

## Init:CrashLoopBackOff

An init container crashed. The pod will never start the main container until init succeeds.

**Fix pattern**

```bash
kubectl logs <pod> -c <init-container-name> --previous
```

Common init container work: DB migrations, downloading configs, waiting on a dependency. Each has its own failure mode.

## ContainerCreating (stuck)

**Typical causes**

1. PersistentVolume not attaching (check CSI driver).
2. Secret or ConfigMap referenced in volumes does not exist.
3. Security context requires Linux capability not available on the node.

**Fix pattern**

```bash
kubectl describe pod <pod>                          # Events section lists the exact volume or mount failing
```

## Terminated (exit code 143)

Exit 143 = SIGTERM. The container was killed gracefully. Usually caused by:

1. Deployment rolling update (expected).
2. Node drained for an upgrade.
3. HPA scaling down.
4. `terminationGracePeriodSeconds` too short and app did not finish in time.

Not an error by itself. Only a problem if happening during peak traffic without a replacement.

## Evicted

**Typical output**

```
Status:        Failed
Reason:        Evicted
Message:       The node was low on resource: memory.
```

**Cause**

Node under memory, disk, or PID pressure. Kubelet evicted the pod to recover.

**Fix pattern**

1. `kubectl describe node <node>` and read `Conditions`. Look for `MemoryPressure=True` or `DiskPressure=True`.
2. If disk: clean up logs or images with `crictl rmi --prune` on the node.
3. If memory: the node is over-committed. Add nodes or lower pod requests.

## Readiness probe failing but pod still Running

**Typical output**

```
Conditions:
  Ready           False
  ContainersReady False
Events:
  Warning Unhealthy  ...  Readiness probe failed: HTTP probe failed with statuscode: 503
```

**Cause**

Readiness probe path is returning 503. The pod is running, but Services will not send traffic to it.

**Fix pattern**

1. Exec in: `kubectl exec -it <pod> -- curl -i http://localhost:<port>/<probe-path>`.
2. If it works from inside, the probe path is wrong. Fix the manifest.
3. If it returns 503 from inside, the app considers itself not ready. Read app logs for the reason.

## Completed (for Jobs and CronJobs)

For batch workloads, Completed is the success state. Not an error. The pod is kept around for log inspection.

## Container Cannot Run Error 127

Exit 127 usually means "command not found" inside the container. Either the image does not contain the binary, or `command` in the manifest points at a path that does not exist inside the image.

Run `kubectl exec <pod> -- ls /path/to/binary` to confirm.

## Service has no endpoints

This is a symptom of the pod not being Ready, or the Service selector not matching.

**Fix pattern**

```bash
kubectl get endpoints <service-name>                # if empty, nothing matches
kubectl describe service <service-name>             # read Selector
kubectl get pods --selector=<selector>              # confirm pods match
```

Most common cause: a typo in the Service selector, or a label case mismatch (`app=foo` vs `App=foo`).

## NetworkPolicy denies traffic unexpectedly

If a NetworkPolicy is in place and the pod cannot reach a dependency, check:

```bash
kubectl get networkpolicies -n <ns> -o yaml
```

A NetworkPolicy with an empty `podSelector: {}` matches every pod in the namespace; a missing egress or ingress rule then blocks traffic. Add the specific rule required.

## When to escalate

If the above do not match, hand off to `pod-forensics` (agent) with the full `kubectl describe` output and 200+ lines of logs. The agent can iterate on hypotheses faster than a single pass in a chat.
