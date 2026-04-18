---
description: Check the local Docker and Kubernetes toolchain. Reports Docker daemon status, kubectl version, current cluster context, and any non-running pods in the default namespace. Use before debugging to confirm the environment is healthy.
allowed-tools: Bash(docker version *) Bash(docker context *) Bash(docker ps *) Bash(docker info *) Bash(kubectl version *) Bash(kubectl config *) Bash(kubectl cluster-info *) Bash(kubectl get *)
---

# Docker and Kubernetes environment check

Run a fixed diagnostic of the local container toolchain so the user knows what is and is not available before running any other skill in this plugin.

## Steps

1. Docker daemon status:

```bash
docker version --format '{{.Server.Version}}'
```

If that errors with "Cannot connect to the Docker daemon", report Docker as **not running** and suggest starting Docker Desktop (macOS, Windows) or `sudo systemctl start docker` (Linux). Skip steps 2 and 3.

2. Active Docker context and running containers:

```bash
docker context show
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | head -15
```

3. Disk and image footprint:

```bash
docker system df
```

4. kubectl installed?

```bash
kubectl version --client --output=yaml 2>&1 | head -10
```

If kubectl is not on PATH, report that Kubernetes commands will not run and skip steps 5-7.

5. Active cluster context:

```bash
kubectl config current-context
kubectl cluster-info 2>&1 | head -5
```

If `kubectl cluster-info` hangs or fails, the current context cannot reach the cluster. Note that and move on.

6. Any non-running pods in the default namespace:

```bash
kubectl get pods --field-selector=status.phase!=Running -o wide 2>&1
```

7. Cluster version:

```bash
kubectl version --output=yaml 2>&1 | head -20
```

## Output format

Print a short structured report. Example:

```
Docker and Kubernetes environment
---------------------------------
Docker daemon:    running, version 27.3.1
Docker context:   default
Containers:       3 running, 5 stopped
Disk:             images 4.2 GB, build cache 1.8 GB

kubectl:          installed, client v1.30.2, server v1.30.3
Cluster context:  docker-desktop
Cluster reach:    ok
Non-running pods: none

Next steps: environment looks healthy. Try:
- /docker-kubernetes:docker-debug <container>
- /docker-kubernetes:k8s-debug <pod>
```

If any step fails, call it out with the exact error line and a one-sentence fix hint. Do not speculate beyond what the command output shows.

## Do not

- Do not run any `delete`, `rm`, `kill`, `stop`, `prune`, or `down` command. This command is read-only.
- Do not print values from `docker inspect`, environment variables, or Kubernetes Secrets.
- Do not install missing tools. Report what is missing and how to install it; let the user run the installer.
