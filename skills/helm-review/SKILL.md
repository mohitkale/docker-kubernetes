---
name: helm-review
description: Review a Helm chart for security issues, correctness, and production readiness. Use when the user asks to audit a chart, review a chart before deploying, or find issues in a chart they inherited.
argument-hint: "[chart-path]"
allowed-tools: Read Glob Grep
---

# Review a Helm chart

Audit a Helm chart for security issues, missing best practices, and template correctness. This is a read-only review. You do not modify files unless the user explicitly asks.

## Inputs

`$ARGUMENTS` is the path to the chart directory. If empty, look for a `Chart.yaml` file starting from the current directory. If you find more than one, ask the user which chart to review.

## Review checklist

Go through each item and report findings. Mark each as `pass`, `warn`, or `fail`.

### Chart metadata (`Chart.yaml`)

1. `apiVersion: v2` (v1 is legacy).
2. `version` follows semver.
3. `appVersion` matches the app being shipped.
4. `dependencies` have pinned versions, not ranges.

### Values (`values.yaml`)

1. Image tag is set to a specific version, not `latest`.
2. No secrets are stored in plain text. Secrets should be referenced by name and provided separately.
3. Resource `requests` and `limits` are set and reasonable.
4. Replica count is documented. For production charts, there should be clear guidance on scaling.

### Templates (`templates/*.yaml`)

1. Every `Deployment` and `StatefulSet`:
   - Has readiness and liveness probes unless there is a clear reason not to.
   - Sets `securityContext.runAsNonRoot: true`.
   - Drops capabilities with `capabilities.drop: ["ALL"]`.
   - Sets `allowPrivilegeEscalation: false`.
   - Has `resources` set from values, not hardcoded.
2. Every `Service` uses a selector that matches the workload's labels.
3. A `ServiceAccount` is created and used by the workload. Do not default to the namespace default service account.
4. Any `Ingress` uses `networking.k8s.io/v1` and includes TLS config when the chart exposes a public endpoint.
5. A `NetworkPolicy` is present or the chart documents that the user should add one.
6. Common labels (`app.kubernetes.io/name`, `app.kubernetes.io/instance`, `app.kubernetes.io/version`) are applied via a `_helpers.tpl` helper.
7. Template functions are used correctly:
   - `include` is preferred over `template` inside other templates.
   - `toYaml` has `nindent` or `indent` applied when used for blocks.
   - `required` is used for mandatory values.

### RBAC

1. If the chart creates `Role` or `ClusterRole`, review the verbs and resources. Flag any `verbs: ["*"]` or `resources: ["*"]`.
2. Prefer `Role` over `ClusterRole` when the workload only needs access in one namespace.

### Tests and CI

1. A `templates/tests/` directory or a `helm test` target exists.
2. If `helm lint` output is present in the repo or provided by the user, review it for errors. If not, mark linting as unverified rather than claiming it passed.
3. If `helm template` output is present in the repo or provided by the user, review it for rendering errors. If not, mark template rendering as unverified rather than claiming it passed.

## Output format

Present findings as a grouped report:

```
Chart: <name> version <x.y.z>

## Critical (fix before deploy)

- [fail] <file path>:<line>. <finding>. <fix suggestion>.

## Warnings (should fix)

- [warn] <file path>:<line>. <finding>. <fix suggestion>.

## Info (consider)

- [info] <finding>.

## Summary

<1 to 3 sentences summarizing the overall state>
```

## Example finding

- [fail] `templates/deployment.yaml:34`. Container runs as root (`runAsNonRoot` not set, `runAsUser: 0` implied). Add `securityContext.runAsNonRoot: true` and `runAsUser: 1000` to the pod spec. Also set `allowPrivilegeEscalation: false` on the container.
- [warn] `values.yaml:12`. Image tag is `latest`. Pin to a specific version such as `1.4.2` for reproducible deploys.
- [info] No `NetworkPolicy` in the chart. Consider adding one or documenting that the cluster must provide namespace-level isolation.

## Do not

- Do not modify chart files unless the user asks for a specific fix.
- Do not run `helm install`, `helm upgrade`, or any cluster-modifying command.
