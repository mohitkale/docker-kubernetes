#!/usr/bin/env node
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TIMEOUT_MS = 120000;
const IMAGE_TAG_PREFIX = "claude-devkit-smoke";

function parseArgs(argv) {
  const options = { target: "auto", distro: "", fixture: "" };
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--target" && argv[index + 1]) options.target = argv[++index];
    else if (arg === "--distro" && argv[index + 1]) options.distro = argv[++index];
    else if (arg === "--fixture" && argv[index + 1]) options.fixture = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
  }
  return options;
}

function printHelp() {
  console.log("Usage: node bin/smoke-test.js [--target auto|host|wsl] [--distro <name>] [--fixture file]");
  console.log("");
  console.log("Runs a temporary Docker build/inspect/remove, Compose config render, Helm lint/template,");
  console.log("and kubectl client dry-run when the required tools are available.");
}

function loadFixture(filePath) {
  if (!filePath) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function clean(text) {
  return String(text || "").replace(/\u0000/g, "").trim();
}

function firstLine(text) {
  return clean(text).split(/\r?\n/).find(Boolean) || "";
}

function run(label, command, args, fixture) {
  if (fixture) {
    const hit = fixture.commands && fixture.commands[label];
    if (hit) {
      return {
        status: Number.isInteger(hit.status) ? hit.status : 0,
        stdout: clean(hit.stdout),
        stderr: clean(hit.stderr)
      };
    }
    return { status: 127, stdout: "", stderr: "fixture command not found: " + label };
  }

  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    windowsHide: true
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr || (result.error && result.error.message))
  };
}

function quoteForSh(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function commandExists(name, target, fixture, distro) {
  const label = target === "wsl" ? `wsl:${distro}:${name}:path` : `host:${name}:path`;
  if (target === "wsl") {
    return run(label, "wsl", ["-d", distro, "--", "which", name], fixture).status === 0;
  }
  if (process.platform === "win32") {
    return run(label, "where.exe", [name], fixture).status === 0;
  }
  return run(label, "sh", ["-lc", `command -v ${quoteForSh(name)}`], fixture).status === 0;
}

function runTarget(target, distro, tool, args, labelSuffix, fixture) {
  if (target === "wsl") {
    return run(`wsl:${distro}:${tool}:${labelSuffix}`, "wsl", ["-d", distro, "--", tool, ...args], fixture);
  }
  return run(`host:${tool}:${labelSuffix}`, tool, args, fixture);
}

function selectedDistro(options, fixture) {
  if (options.distro) return options.distro;
  if (fixture && fixture.distro) return fixture.distro;
  const status = run("host:wsl:status", "wsl", ["--status"], fixture);
  const match = (status.stdout || status.stderr || "").match(/Default Distribution:\s*([^\r\n]+)/i);
  if (match) return match[1].trim();
  return "Ubuntu";
}

function targetAvailable(target, distro, fixture) {
  if (target === "host") {
    const docker = commandExists("docker", "host", fixture, distro);
    if (!docker) return false;
    return runTarget("host", distro, "docker", ["version", "--format", "{{.Server.Version}}"], "server", fixture).status === 0;
  }
  if (process.platform !== "win32" && !fixture) return false;
  const docker = commandExists("docker", "wsl", fixture, distro);
  if (!docker) return false;
  return runTarget("wsl", distro, "docker", ["version", "--format", "{{.Server.Version}}"], "server", fixture).status === 0;
}

function pickTarget(options, fixture) {
  const distro = selectedDistro(options, fixture);
  if (options.target === "host" || options.target === "wsl") return { target: options.target, distro };
  if (targetAvailable("host", distro, fixture)) return { target: "host", distro };
  if (targetAvailable("wsl", distro, fixture)) return { target: "wsl", distro };
  return { target: process.platform === "win32" ? "wsl" : "host", distro };
}

function toTargetPath(hostPath, target, distro, fixture) {
  if (target !== "wsl") return hostPath;
  if (fixture) return hostPath.replace(/\\/g, "/");
  const converted = run("wsl:path:convert", "wsl", ["-d", distro, "--", "wslpath", "-a", hostPath], fixture);
  if (converted.status === 0 && firstLine(converted.stdout)) return firstLine(converted.stdout);
  return hostPath.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
}

function createDockerContext(root) {
  const dir = path.join(root, "docker-context");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "smoke.txt"), "smoke-test\n");
  fs.writeFileSync(path.join(dir, "Dockerfile"), [
    "FROM scratch",
    "LABEL org.opencontainers.image.title=claude-devkit-smoke",
    "COPY smoke.txt /smoke.txt",
    ""
  ].join("\n"));
  return dir;
}

function createComposeFile(root) {
  const filePath = path.join(root, "compose.yaml");
  fs.writeFileSync(filePath, [
    "services:",
    "  smoke:",
    "    image: scratch:local",
    "    command: [\"/smoke\"]",
    ""
  ].join("\n"));
  return filePath;
}

function createHelmChart(root) {
  const chart = path.join(root, "smoke-chart");
  fs.mkdirSync(path.join(chart, "templates"), { recursive: true });
  fs.writeFileSync(path.join(chart, "Chart.yaml"), [
    "apiVersion: v2",
    "name: smoke-chart",
    "description: Offline smoke chart",
    "type: application",
    "version: 0.1.0",
    "appVersion: 1.0.0",
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(chart, "values.yaml"), [
    "replicaCount: 1",
    "image:",
    "  repository: example/smoke",
    "  tag: '1.0.0'",
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(chart, "templates", "deployment.yaml"), [
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    "  name: {{ .Chart.Name }}",
    "spec:",
    "  replicas: {{ .Values.replicaCount }}",
    "  selector:",
    "    matchLabels:",
    "      app.kubernetes.io/name: {{ .Chart.Name }}",
    "  template:",
    "    metadata:",
    "      labels:",
    "        app.kubernetes.io/name: {{ .Chart.Name }}",
    "    spec:",
    "      containers:",
    "        - name: smoke",
    "          image: {{ .Values.image.repository }}:{{ .Values.image.tag }}",
    "          resources:",
    "            requests:",
    "              cpu: 10m",
    "              memory: 16Mi",
    "            limits:",
    "              cpu: 50m",
    "              memory: 64Mi",
    ""
  ].join("\n"));
  return chart;
}

function createManifest(root) {
  const filePath = path.join(root, "deployment.yaml");
  fs.writeFileSync(filePath, [
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    "  name: smoke",
    "spec:",
    "  replicas: 1",
    "  selector:",
    "    matchLabels:",
    "      app.kubernetes.io/name: smoke",
    "  template:",
    "    metadata:",
    "      labels:",
    "        app.kubernetes.io/name: smoke",
    "    spec:",
    "      containers:",
    "        - name: smoke",
    "          image: example/smoke:1.0.0",
    "          resources:",
    "            requests:",
    "              cpu: 10m",
    "              memory: 16Mi",
    "            limits:",
    "              cpu: 50m",
    "              memory: 64Mi",
    ""
  ].join("\n"));
  return filePath;
}

function resultLine(results, status, name, detail) {
  results.push({ status, name, detail });
  console.log(`${status} ${name}${detail ? ` - ${detail}` : ""}`);
}

function runSmoke(options) {
  const fixture = loadFixture(options.fixture);
  const selected = pickTarget(options, fixture);
  const results = [];
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-devkit-smoke-"));
  const imageTag = `${IMAGE_TAG_PREFIX}:${Date.now()}`;

  console.log("Docker and Kubernetes smoke test");
  console.log("================================");
  console.log(`Target: ${selected.target}${selected.target === "wsl" ? ` (${selected.distro})` : ""}`);
  console.log("");

  try {
    const dockerServer = runTarget(selected.target, selected.distro, "docker", ["version", "--format", "{{.Server.Version}}"], "server", fixture);
    if (dockerServer.status !== 0) {
      resultLine(results, "FAIL", "Docker daemon", firstLine(dockerServer.stderr || dockerServer.stdout) || "not reachable");
    } else {
      resultLine(results, "PASS", "Docker daemon", firstLine(dockerServer.stdout));
      const dockerContext = toTargetPath(createDockerContext(workRoot), selected.target, selected.distro, fixture);
      const build = runTarget(selected.target, selected.distro, "docker", ["build", "-q", "-t", imageTag, dockerContext], "build", fixture);
      if (build.status === 0) {
        resultLine(results, "PASS", "Docker build", firstLine(build.stdout) || imageTag);
        const inspect = runTarget(selected.target, selected.distro, "docker", ["image", "inspect", imageTag, "--format", "{{.Id}}"], "inspect", fixture);
        resultLine(results, inspect.status === 0 ? "PASS" : "FAIL", "Docker image inspect", inspect.status === 0 ? firstLine(inspect.stdout) : firstLine(inspect.stderr || inspect.stdout));
      } else {
        resultLine(results, "FAIL", "Docker build", firstLine(build.stderr || build.stdout));
      }
      const remove = runTarget(selected.target, selected.distro, "docker", ["image", "rm", imageTag], "rm", fixture);
      if (remove.status !== 0 && build.status === 0) resultLine(results, "FAIL", "Docker cleanup", firstLine(remove.stderr || remove.stdout));

      const composeFile = toTargetPath(createComposeFile(workRoot), selected.target, selected.distro, fixture);
      const composeV2 = runTarget(selected.target, selected.distro, "docker", ["compose", "version"], "compose-version", fixture);
      if (composeV2.status === 0) {
        const config = runTarget(selected.target, selected.distro, "docker", ["compose", "-f", composeFile, "config"], "compose-config", fixture);
        resultLine(results, config.status === 0 ? "PASS" : "FAIL", "Docker Compose v2 config", config.status === 0 ? firstLine(composeV2.stdout) : firstLine(config.stderr || config.stdout));
      } else if (commandExists("docker-compose", selected.target, fixture, selected.distro)) {
        const config = runTarget(selected.target, selected.distro, "docker-compose", ["-f", composeFile, "config"], "config", fixture);
        resultLine(results, config.status === 0 ? "PASS" : "FAIL", "docker-compose config", config.status === 0 ? "legacy compose" : firstLine(config.stderr || config.stdout));
      } else {
        resultLine(results, "SKIP", "Compose config", "Compose not found");
      }
    }

    if (commandExists("helm", selected.target, fixture, selected.distro)) {
      const chart = toTargetPath(createHelmChart(workRoot), selected.target, selected.distro, fixture);
      const lint = runTarget(selected.target, selected.distro, "helm", ["lint", chart], "lint", fixture);
      resultLine(results, lint.status === 0 ? "PASS" : "FAIL", "Helm lint", lint.status === 0 ? "chart linted" : firstLine(lint.stderr || lint.stdout));
      const template = runTarget(selected.target, selected.distro, "helm", ["template", "smoke", chart], "template", fixture);
      resultLine(results, template.status === 0 ? "PASS" : "FAIL", "Helm template", template.status === 0 ? "chart rendered" : firstLine(template.stderr || template.stdout));
    } else {
      resultLine(results, "SKIP", "Helm lint/template", "Helm not found");
    }

    if (commandExists("kubectl", selected.target, fixture, selected.distro)) {
      const client = runTarget(selected.target, selected.distro, "kubectl", ["version", "--client", "--output=yaml"], "client", fixture);
      resultLine(results, client.status === 0 ? "PASS" : "FAIL", "kubectl client", client.status === 0 ? "client available" : firstLine(client.stderr || client.stdout));
      const manifest = toTargetPath(createManifest(workRoot), selected.target, selected.distro, fixture);
      const dryRun = runTarget(selected.target, selected.distro, "kubectl", ["create", "--dry-run=client", "--validate=false", "-f", manifest], "dry-run", fixture);
      resultLine(results, dryRun.status === 0 ? "PASS" : "FAIL", "kubectl client dry-run", dryRun.status === 0 ? "manifest accepted" : firstLine(dryRun.stderr || dryRun.stdout));
      const cluster = runTarget(selected.target, selected.distro, "kubectl", ["cluster-info"], "cluster-info", fixture);
      resultLine(results, cluster.status === 0 ? "PASS" : "SKIP", "Kubernetes cluster reachability", cluster.status === 0 ? "cluster reachable" : "no reachable cluster/context");
    } else {
      resultLine(results, "SKIP", "kubectl client and dry-run", "kubectl not found");
      resultLine(results, "SKIP", "Kubernetes cluster reachability", "kubectl not found");
    }
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }

  const failed = results.filter(result => result.status === "FAIL");
  const skipped = results.filter(result => result.status === "SKIP");
  console.log("");
  console.log(`Summary: ${results.length - failed.length - skipped.length} passed, ${skipped.length} skipped, ${failed.length} failed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

const options = parseArgs(process.argv);
if (options.help) {
  printHelp();
  process.exit(0);
}
runSmoke(options);
