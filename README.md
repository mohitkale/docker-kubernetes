# Docker and Kubernetes DevKit

A Claude Code plugin that helps you write Dockerfiles, generate Kubernetes manifests, debug failing containers and pods, and audit Helm charts and RBAC.

## What it does

- Generates production-grade Dockerfiles for any common language or framework.
- Creates or updates `docker-compose.yml` for local multi-service setups.
- Explains why a Docker build or container is failing and suggests a concrete fix.
- Investigates a failing Kubernetes pod by pulling events, logs, and describe output.
- Generates Kubernetes manifests from a plain-English description.
- Reviews Helm charts for security, correctness, and production readiness.
- Audits RBAC for overly broad permissions.

## Example

```
> /docker-kubernetes:k8s-debug api-7c4d8b9f5d-xzq4p default

Pulled events, logs, and describe output for pod api-7c4d8b9f5d-xzq4p.
Root cause: the container exits with ECONNREFUSED to redis:6379. The redis
Service exists but its selector does not match any pod.
Fix: change the Service selector in manifests/redis-svc.yaml from app=cache
to app=redis, then reapply.
```

## Installation

From the Anthropic plugin marketplace:

```
/plugin install docker-kubernetes
```

To install from a local checkout for development:

```
claude --plugin-dir ./docker-kubernetes
```

If you are already inside the repository root, use:

```
claude --plugin-dir .
```

## Commands

All commands are invoked from inside Claude Code with `/docker-kubernetes:<command>`.

| Command | What it does | Example |
|---|---|---|
| `/docker-kubernetes:doctor` | Check the local Docker and Kubernetes toolchain through a fixed read-only diagnostic workflow. | `/docker-kubernetes:doctor` |
| `/docker-kubernetes:runtime-check` | Detect host and WSL Docker, Compose, Kubernetes clients, Helm, local cluster tools, and Docker alternatives. Useful when Docker Desktop is unavailable. | `/docker-kubernetes:runtime-check` |
| `/docker-kubernetes:smoke-test` | Run a local smoke test for Docker build/inspect/cleanup, Compose config, Helm lint/template, and kubectl client dry-run where tools are available. Explicit invocation only. | `/docker-kubernetes:smoke-test --target wsl --distro Ubuntu` |
| `/docker-kubernetes:events` | Snapshot recent cluster events, sorted by time, filtered by namespace and type. | `/docker-kubernetes:events production Warning` |
| `/docker-kubernetes:cluster-audit` | One-shot full audit: doctor + events + rbac-review + helm-review (chained). Opt-in only. | `/docker-kubernetes:cluster-audit production` |
| `/docker-kubernetes:dockerfile` | Generate a Dockerfile for the current project. | `/docker-kubernetes:dockerfile python fastapi` |
| `/docker-kubernetes:compose` | Generate or update a docker-compose.yml. | `/docker-kubernetes:compose postgres and redis` |
| `/docker-kubernetes:docker-debug` | Diagnose a Docker build or container failure. | `/docker-kubernetes:docker-debug my-api-container` |
| `/docker-kubernetes:k8s-debug` | Investigate a failing Kubernetes pod. | `/docker-kubernetes:k8s-debug api-7c4d8b9f5d-xzq4p` |
| `/docker-kubernetes:manifest` | Generate Kubernetes manifests from a description. | `/docker-kubernetes:manifest a Node app with 3 replicas and an Ingress` |
| `/docker-kubernetes:helm-review` | Audit a Helm chart. | `/docker-kubernetes:helm-review ./charts/api` |
| `/docker-kubernetes:rbac-review` | Audit Kubernetes RBAC for overly broad permissions. | `/docker-kubernetes:rbac-review production` |

## Agents

The plugin ships with three subagents that Claude may delegate to automatically when the work fits:

- **container-forensics**: deep Docker failure diagnosis.
- **pod-forensics**: deep Kubernetes pod failure diagnosis.
- **manifest-author**: specialized Kubernetes YAML writer.

You can also invoke an agent explicitly, for example:

```
Ask the pod-forensics agent why my api pod is in CrashLoopBackOff.
```

## Hooks

On session start, the plugin runs a small Node.js script that inspects the current working directory for container-related files. If it finds `Dockerfile`, `docker-compose.yml`, `Chart.yaml`, or a `k8s`, `manifests`, or `charts` directory, it injects a one-line context note so Claude knows which skills apply without the user having to say so. The hook is silent if nothing matches.

A second hook fires **after every Bash tool call** (`PostToolUse`). It watches for `kubectl apply`, `docker build`, `helm install`, and similar state-changing commands, and injects a short follow-up note: what to check next, which skill to run if something looks off. Unlike SessionStart, this one is reactive rather than startup-only.

Both hooks require Node.js on `PATH`. Without Node, they quietly no-op and every skill and command still works.

## Reference files

A `reference/` directory ships deeper knowledge that skills read only when they need it. Nothing is loaded at session start; the files just sit there until a skill explicitly reads one.

- `reference/pod-error-patterns.md` lists 10+ common pod failures (CrashLoopBackOff, ImagePullBackOff, OOMKilled, Pending, Evicted, etc.) with the kubectl output, root causes, and fix commands. The `k8s-debug` skill reads this when it encounters an unfamiliar status.

This is how we keep individual skills lean while giving them deeper knowledge when a specific scenario calls for it.

## Requirements

- Claude Code v2.0 or later.
- Node.js on `PATH` for SessionStart and PostToolUse hooks (any current LTS). If Node is missing, hooks no-op silently; skills and commands still work.
- For Docker commands: Docker installed and on `PATH`.
- For Compose execution: Docker Compose v2 (`docker compose`) or legacy `docker-compose` installed and on `PATH`. The plugin can still generate Compose files without it.
- For Kubernetes commands: `kubectl` installed, on `PATH`, and configured with a working context.
- For Helm review: no runtime dependencies. The review reads chart files without running Helm.

## Safety

All commands follow these rules:

1. Destructive operations (`delete`, `rmi`, `prune`, `kill`, `edit`, `patch`) always require explicit user confirmation. They are never part of the default command workflow.
2. Read-only commands (`get`, `describe`, `logs`, `inspect`, `ps`) run without prompting because they are safe.
3. The plugin never prints secret values from `.env` files or Kubernetes Secrets into the conversation.
4. File writes are announced before they happen so the user can stop them.

## Known limitations

- `helm-review` is a static review. It reads chart files and flags issues without running `helm template` or `helm lint`, so rendering errors that only surface after templating are not caught.
- `docker-debug` works from logs and `docker inspect` output. It does not introspect BuildKit cache or intermediate build layers.
- `rbac-review` reflects the current cluster state. It does not simulate API version deprecations or upgrade paths.
- The current version does not include image scanning (Trivy, Docker Scout), Kustomize support, or Helm chart generation. These may be added in later versions.
- Workflows assume Linux container images. Windows container scenarios are not specifically tuned for.

## Development

To iterate locally on the plugin itself from the repository root:

```
claude --plugin-dir .
```

Validate the plugin structure:

```
claude plugin validate .
```

Run the offline local test suite:

```
node tests/run.js
```

The offline suite does not require Docker Desktop, WSL, `kubectl`, Helm, or a live cluster. It validates the plugin manifest, Markdown frontmatter, hook syntax, SessionStart detection, and PostToolUse reactions by feeding synthetic Docker, Compose, Kubernetes, and Helm hook events into the Node hook scripts.

Check the actual local runtime capability matrix:

```
node bin/runtime-check.js
```

This is read-only. It detects host and WSL tooling and recommends whether to use host Docker, WSL Docker, a remote Docker context, Helm/static validation, or a local cluster tool such as kind, k3d, or minikube.

Run live local smoke checks where tools are available:

```
node bin/smoke-test.js --target auto
```

On Windows machines with Docker only inside WSL:

```
node bin/smoke-test.js --target wsl --distro Ubuntu
```

The smoke runner creates and removes a temporary `claude-devkit-smoke:<timestamp>` image, renders a temporary Compose file, runs Helm lint/template if Helm exists, and uses kubectl client dry-run if kubectl exists. The kubectl dry-run disables server schema validation so it remains a client check even when a cluster context is unavailable. It does not install tools, create clusters, or apply Kubernetes resources.

## Contributing

Use a feature branch for changes and open a pull request against `main` for review. If you have write access to this repository, push the branch to `origin`. If you do not have write access, fork the repository, push the branch to your fork, and open a pull request back to the upstream repository.

Before opening a pull request, run:

```
node tests/run.js
claude plugin validate .
```

For runtime-sensitive changes, also include the relevant `node bin/runtime-check.js` or `node bin/smoke-test.js --target auto` output in the pull request description.

## License

MIT. See `LICENSE`.
