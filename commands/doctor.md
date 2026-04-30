---
description: Check the local Docker and Kubernetes toolchain. Reports Docker daemon status, Compose availability, kubectl version, current cluster context, and any non-running pods in the default namespace. Use before debugging to confirm the environment is healthy.
allowed-tools: Bash(docker version *) Bash(docker context *) Bash(docker ps *) Bash(docker info *) Bash(docker system df *) Bash(docker compose *) Bash(docker-compose *) Bash(kubectl version *) Bash(kubectl config *) Bash(kubectl cluster-info *) Bash(kubectl get *)
---

# Docker and Kubernetes environment check

Run a fixed diagnostic of the local container toolchain so the user knows what is and is not available before running any other skill in this plugin.

## Steps

1. Docker daemon status:

```bash
docker version --format '{{.Server.Version}}'
```

If that errors with "Cannot connect to the Docker daemon", report Docker as **not running** and suggest starting Docker Desktop (macOS, Windows) or `sudo systemctl start docker` (Linux). Skip steps 2 and 3.

If Docker Desktop is not allowed on the machine, suggest using an approved remote Docker context, a company-managed build runner, or another approved container runtime instead of trying to start Docker Desktop.

2. Active Docker context and running containers:

```bash
docker context show
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```

Summarize at most the first 15 containers in the report.

3. Disk and image footprint:

```bash
docker system df
```

4. Docker Compose available?

Try Compose v2 first, then legacy Compose v1:

```bash
docker compose version 2>&1
docker-compose version 2>&1
```

If neither command exists, report that Compose files can still be generated but local Compose execution will not work until Compose is installed or enabled.

5. kubectl installed?

```bash
kubectl version --client --output=yaml 2>&1
```

If kubectl is not on PATH, report that Kubernetes commands will not run and skip steps 6-8.

6. Active cluster context:

```bash
kubectl config current-context
kubectl cluster-info 2>&1
```

If `kubectl cluster-info` hangs or fails, the current context cannot reach the cluster. Note that and move on.

7. Any non-running pods in the default namespace:

```bash
kubectl get pods --field-selector=status.phase!=Running -o wide 2>&1
```

8. Cluster version:

```bash
kubectl version --output=yaml 2>&1
```

## Output format

Print a short structured report. Example:

```
Docker and Kubernetes environment
---------------------------------
Docker daemon:    running, version 27.3.1
Docker context:   default
Compose:          available, v2.29.7
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
