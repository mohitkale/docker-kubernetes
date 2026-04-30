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
    const kubectl = String.raw`\bkubectl(?:\.exe)?\s+`;
    const docker = String.raw`\bdocker(?:\.exe)?\s+`;
    const dockerCompose = String.raw`(?:\bdocker(?:\.exe)?\s+compose|\bdocker-compose(?:\.exe)?)\s+`;
    const helm = String.raw`\bhelm(?:\.exe)?\s+`;
    const output = stderr + stdout;

    if (new RegExp(kubectl + "apply\\b", "i").test(cmd)) {
      notes.push("After `kubectl apply`: check rollout with `kubectl rollout status deploy/<name>` and recent events with `kubectl get events --sort-by=.lastTimestamp`. If a pod crashes, use `/docker-kubernetes:k8s-debug <pod>`.");
    }
    if (new RegExp(kubectl + "(create|delete|replace|patch|edit|scale|rollout)\\b", "i").test(cmd)) {
      notes.push("State-changing kubectl command detected. If a resource ends up in a bad state, `/docker-kubernetes:k8s-debug <pod>` will pull events, describe, and previous-container logs.");
    }
    if (new RegExp(docker + "(build|buildx\\s+build)\\b", "i").test(cmd)) {
      if (/error|failed/i.test(output)) {
        notes.push("Docker build appears to have failed. `/docker-kubernetes:docker-debug <container-or-image>` produces a structured diagnosis from `docker inspect`, `docker logs`, and the Dockerfile.");
      }
    }
    if (new RegExp(docker + "run\\b", "i").test(cmd) && /exited\s+with\s+code|error/i.test(output)) {
      notes.push("Container exited with an error. `/docker-kubernetes:docker-debug <container>` will pull logs, exit code, and inspect output in one pass.");
    }
    if (new RegExp(dockerCompose + "(up|build|run|start|restart)\\b", "i").test(cmd) && /error|failed|exited\s+with\s+code/i.test(output)) {
      notes.push("Docker Compose command appears to have failed. Run `docker compose ps` and `docker compose logs --tail=200 --timestamps <service>`, or use `/docker-kubernetes:docker-debug <service>` for a structured diagnosis.");
    }
    if (new RegExp(helm + "(install|upgrade)\\b", "i").test(cmd)) {
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
