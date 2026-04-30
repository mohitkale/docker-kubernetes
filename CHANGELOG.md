# Changelog

All notable changes to this plugin are documented here.

The format is based on Keep a Changelog, and this plugin uses semantic versioning.

## [1.1.0] - 2026-04-30

### Added

- Command `runtime-check`: read-only local capability checker for host Docker, WSL Docker, Compose, `kubectl`, Helm, local cluster tools, and Docker alternatives such as Podman and nerdctl.
- Command `smoke-test`: explicit local smoke runner for Docker build/inspect/cleanup, Compose config, Helm lint/template, and kubectl client dry-run where tools are available.
- Bundled `bin/runtime-check.js` with fixture mode so runtime detection can be tested without Docker Desktop, WSL, `kubectl`, Helm, or a live cluster.
- Bundled `bin/smoke-test.js` with fixture mode for cross-platform Docker/Kubernetes smoke-test coverage.
- Expanded offline test suite from SessionStart-only coverage to manifest parsing, frontmatter checks, hook syntax, bin script syntax, SessionStart detection, PostToolUse Docker/Compose/Kubernetes/Helm simulations, and runtime-check fixture coverage.

### Changed

- `doctor` now reports Docker Compose availability and gives better guidance when Docker Desktop is not allowed.
- `cluster-audit` keeps static Helm review available even when no Kubernetes cluster can be reached.
- `events` no longer claims a strict one-hour filter when the command only returns retained recent events.
- `docker-debug` allows legacy `docker-compose` read-only diagnostics in addition to Compose v2.
- `helm-review` marks `helm lint` and `helm template` as unverified unless the output is actually present.
- `rbac-review` only runs namespace-scoped commands after a namespace is provided or confirmed.

### Fixed

- PostToolUse hook detection now handles Windows `.exe` invocations and Docker Compose failures.
- `smoke-test` kubectl client dry-run no longer requires a reachable cluster API or OpenAPI endpoint.
- `runtime-check` reports the actual kubectl `gitVersion` instead of the YAML section header.
- `rbac-review` no longer suggests `jq`, keeping the workflow within the plugin's allowed tools.

## [1.0.1] - 2026-04-19

### Added

- `PRIVACY.md` with data-handling disclosure for marketplace submission (Claude Code, local hooks, GitHub hosting, Anthropic product terms).

## [1.0.0] - 2026-04-18

### Added

- Initial release.
- Skill `dockerfile`: generate a production-grade Dockerfile.
- Skill `compose`: generate or update a docker-compose.yml.
- Skill `docker-debug`: diagnose Docker build and runtime failures.
- Skill `k8s-debug`: investigate failing Kubernetes pods.
- Skill `manifest`: generate Kubernetes manifests from a description.
- Skill `helm-review`: audit a Helm chart for security and best practices.
- Skill `rbac-review`: audit Kubernetes RBAC for overly broad permissions.
- Agent `container-forensics`: specialized Docker failure diagnosis.
- Agent `pod-forensics`: specialized Kubernetes pod failure diagnosis.
- Agent `manifest-author`: specialized Kubernetes YAML writer.
- Command `doctor`: real toolchain check. Reports Docker daemon status, kubectl version, current cluster context, and non-running pods.
- Hook `session-start`: Node.js detector that inspects cwd for Dockerfile, docker-compose files, Chart.yaml, and k8s, manifests, or charts directories. Injects a one-line context note via `hookSpecificOutput.additionalContext` so Claude knows which skills apply without the user asking.
- Command `events`: snapshot of recent cluster events, sorted newest-first, filtered by namespace and type (Warning by default).
- Hook `post-tool-use`: PostToolUse hook that reacts to `kubectl apply`, `docker build`, `helm install/upgrade`, and similar commands and injects a short follow-up note pointing to the right skill when something looks off.
- Tests: `tests/run.js` with fixture directories under `tests/fixtures/` that invoke the SessionStart hook against synthetic cwds and assert expected output.
- CI: `.github/workflows/validate.yml` runs required-file checks, plugin.json parse, skill/agent/command frontmatter, hook script syntax, em-dash scan, and the hook fixture tests on every push and PR.
- Reference file `reference/pod-error-patterns.md`: lookup catalog of 10+ common pod failures (CrashLoopBackOff, ImagePullBackOff, OOMKilled, Pending, Evicted, etc.) with kubectl output, root causes, and fix commands. Read by `k8s-debug` on-demand only.
- Command `cluster-audit`: opt-in workflow command that chains doctor, events, rbac-review, and helm-review into one combined report. Read-only.
