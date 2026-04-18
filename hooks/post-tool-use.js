#!/usr/bin/env node
let input = "";
process.stdin.on("data", c => input += c);
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    if (data.tool_name !== "Bash") return process.exit(0);
    const cmd = (data.tool_input && data.tool_input.command) || "";
    const stderr = (data.tool_response && data.tool_response.stderr) || "";
    const stdout = (data.tool_response && data.tool_response.stdout) || "";
    const notes = [];

    if (/\bkubectl\s+apply\b/.test(cmd)) {
      notes.push("After `kubectl apply`: check rollout with `kubectl rollout status deploy/<name>` and recent events with `kubectl get events --sort-by=.lastTimestamp | tail -10`. If a pod crashes, use `/docker-kubernetes:k8s-debug <pod>`.");
    }
    if (/\bkubectl\s+(create|delete|replace|patch|edit|scale|rollout)\b/.test(cmd)) {
      notes.push("State-changing kubectl command detected. If a resource ends up in a bad state, `/docker-kubernetes:k8s-debug <pod>` will pull events, describe, and previous-container logs.");
    }
    if (/\bdocker\s+build\b/.test(cmd)) {
      if (/error|failed|ERROR/i.test(stderr + stdout)) {
        notes.push("Docker build appears to have failed. `/docker-kubernetes:docker-debug <container-or-image>` produces a structured diagnosis from `docker inspect`, `docker logs`, and the Dockerfile.");
      }
    }
    if (/\bdocker\s+run\b/.test(cmd) && /exited\s+with\s+code|error|Error/i.test(stderr + stdout)) {
      notes.push("Container exited with an error. `/docker-kubernetes:docker-debug <container>` will pull logs, exit code, and inspect output in one pass.");
    }
    if (/\bhelm\s+(install|upgrade)\b/.test(cmd)) {
      notes.push("After a Helm install or upgrade: verify release with `helm status <release>` and run `/docker-kubernetes:helm-review ./charts/<name>` to audit the chart before the next release.");
    }

    if (notes.length > 0) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: notes.join("\n") }
      }));
    }
  } catch (e) {}
  process.exit(0);
});
