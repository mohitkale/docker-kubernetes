---
description: Run a live local smoke test for the plugin's Docker, Compose, Helm, and kubectl workflows. Use only when the user explicitly asks to verify local runtime behavior; it creates and removes a temporary Docker image and temporary files, and uses kubectl dry-run only.
argument-hint: "[--target auto|host|wsl] [--distro Ubuntu]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

# Runtime smoke test

Run the bundled smoke-test runner. Pass `$ARGUMENTS` through unchanged.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/smoke-test.js" $ARGUMENTS
```

## What it verifies

1. Docker daemon reachability.
2. A no-network `FROM scratch` Docker build, image inspect, and cleanup.
3. Docker Compose v2 or legacy `docker-compose` config rendering.
4. Helm `lint` and `template` on a generated temporary chart when Helm is available.
5. `kubectl version --client` and `kubectl create --dry-run=client --validate=false` on a generated temporary manifest when `kubectl` is available.
6. Kubernetes cluster reachability with `kubectl cluster-info` when `kubectl` is available.

## Safety

- The Docker image is tagged `claude-devkit-smoke:<timestamp>` and removed before exit.
- Helm and kubectl checks use temporary files.
- No Kubernetes resource is applied; kubectl uses client dry-run only.
- The command does not install tools or create a local Kubernetes cluster.
