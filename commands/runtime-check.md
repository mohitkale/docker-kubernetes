---
description: Check which local Docker, Compose, Kubernetes, Helm, WSL, and alternative container runtimes are available. Use this before doctor when Docker Desktop is not allowed, when the OS-specific runtime path is unclear, or when the user needs to know whether WSL Docker, Podman, nerdctl, kind, k3d, or minikube can be used for testing.
allowed-tools: Bash(node *)
---

# Runtime capability check

Run the bundled runtime checker and summarize the result for the user.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/runtime-check.js"
```

## What to report

1. Whether host Docker is installed and whether its daemon responds.
2. On Windows, whether WSL is available, which distro is selected, and whether Docker/Compose work inside WSL.
3. Whether `kubectl`, Helm, kind, k3d, minikube, Podman, nerdctl, kubeconform, or kubeval are present on the usable host or WSL path.
4. The best local test path:
   - Host Docker on Linux, macOS, or Windows when a local daemon is available.
   - WSL Docker on Windows when Docker Desktop or the host daemon is unavailable.
   - Helm, kubeconform, or kubeval for offline Kubernetes manifest checks on any OS.
   - kind, k3d, or minikube plus `kubectl` for live local Kubernetes checks.
   - A remote Docker context or remote/dev kubeconfig when local runtimes are blocked.

## Do not

- Do not install tools.
- Do not create containers, clusters, images, or Kubernetes resources.
- Do not run `docker build`, `docker run`, `kubectl apply`, `helm install`, or any state-changing command.
