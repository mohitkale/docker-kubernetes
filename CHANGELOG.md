# Changelog

All notable changes to this plugin are documented here.

The format is based on Keep a Changelog, and this plugin uses semantic versioning.

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
