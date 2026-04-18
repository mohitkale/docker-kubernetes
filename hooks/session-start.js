#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();

function has(rel) {
  try { return fs.existsSync(path.join(cwd, rel)); } catch { return false; }
}
function isDir(rel) {
  try { return fs.statSync(path.join(cwd, rel)).isDirectory(); } catch { return false; }
}

const findings = [];

if (has("Dockerfile") || has("Containerfile")) {
  findings.push("- Dockerfile detected. Use `/docker-kubernetes:docker-debug <container>` to diagnose build or runtime failures, or `/docker-kubernetes:dockerfile` to regenerate.");
}
if (has("docker-compose.yml") || has("docker-compose.yaml") || has("compose.yml") || has("compose.yaml")) {
  findings.push("- docker-compose file detected. Use `/docker-kubernetes:compose` to review, extend, or add services.");
}
if (isDir("k8s") || isDir("kubernetes") || isDir("manifests") || isDir("deploy")) {
  findings.push("- Kubernetes manifest directory detected. Use `/docker-kubernetes:manifest` to add resources or `/docker-kubernetes:k8s-debug <pod>` to diagnose pods.");
}
if (has("Chart.yaml") || has("chart.yaml")) {
  findings.push("- Helm chart detected. Use `/docker-kubernetes:helm-review ./` to audit the chart for security and best practices.");
}
if (isDir("charts")) {
  findings.push("- charts directory detected. Use `/docker-kubernetes:helm-review ./charts/<name>` to audit a Helm chart.");
}
if (has("skaffold.yaml") || has("tilt.yaml") || has("Tiltfile")) {
  findings.push("- Local Kubernetes dev tool detected (Skaffold or Tilt). Container and k8s skills will work alongside your dev loop.");
}

if (findings.length > 0) {
  const text = [
    "Docker and Kubernetes DevKit plugin is active. Detected in " + cwd + ":",
    findings.join("\n"),
    "Run `/docker-kubernetes:doctor` to check the local toolchain."
  ].join("\n\n");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text
    }
  }));
}
process.exit(0);
