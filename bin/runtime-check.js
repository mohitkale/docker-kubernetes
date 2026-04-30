#!/usr/bin/env node
const { spawnSync } = require("child_process");
const fs = require("fs");

const CHECK_TIMEOUT_MS = 8000;
const HOST_TOOLS = [
  "docker",
  "docker-compose",
  "kubectl",
  "helm",
  "podman",
  "nerdctl",
  "minikube",
  "kind",
  "k3d",
  "kubeconform",
  "kubeval"
];
const WSL_TOOLS = [
  "docker",
  "docker-compose",
  "kubectl",
  "helm",
  "podman",
  "nerdctl",
  "minikube",
  "kind",
  "k3d",
  "kubeconform",
  "kubeval"
];

function loadFixture() {
  const fixtureFlag = process.argv.indexOf("--fixture");
  if (fixtureFlag !== -1 && process.argv[fixtureFlag + 1]) {
    return JSON.parse(fs.readFileSync(process.argv[fixtureFlag + 1], "utf8"));
  }
  if (process.env.DOCKER_KUBERNETES_RUNTIME_CHECK_FIXTURE) {
    return JSON.parse(fs.readFileSync(process.env.DOCKER_KUBERNETES_RUNTIME_CHECK_FIXTURE, "utf8"));
  }
  return null;
}

const fixture = loadFixture();

function clean(text) {
  return String(text || "").replace(/\u0000/g, "").trim();
}

function firstLine(text) {
  return clean(text).split(/\r?\n/).find(Boolean) || "";
}

function kubectlVersion(text) {
  const match = clean(text).match(/gitVersion:\s*([^\s]+)/);
  return match ? match[1] : firstLine(text);
}

function run(label, command, args = []) {
  if (fixture) {
    const hit = fixture.commands && fixture.commands[label];
    if (hit) {
      return {
        status: Number.isInteger(hit.status) ? hit.status : 0,
        stdout: clean(hit.stdout),
        stderr: clean(hit.stderr),
        timedOut: Boolean(hit.timedOut)
      };
    }
    return { status: 127, stdout: "", stderr: "fixture command not found: " + label, timedOut: false };
  }

  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: CHECK_TIMEOUT_MS,
    windowsHide: true
  });

  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr || (result.error && result.error.message)),
    timedOut: result.error && result.error.code === "ETIMEDOUT"
  };
}

function existsOnHost(name, platform) {
  if (platform === "win32") {
    const result = run(`host:${name}:path`, "where.exe", [name]);
    return { found: result.status === 0, path: firstLine(result.stdout) };
  }
  const result = run(`host:${name}:path`, "sh", ["-lc", `command -v ${quoteForSh(name)}`]);
  return { found: result.status === 0, path: firstLine(result.stdout) };
}

function quoteForSh(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function versionForHost(name) {
  const argsByName = {
    docker: ["--version"],
    "docker-compose": ["version"],
    kubectl: ["version", "--client", "--output=yaml"],
    helm: ["version", "--short"],
    podman: ["--version"],
    nerdctl: ["--version"],
    minikube: ["version", "--short"],
    kind: ["version"],
    k3d: ["version"],
    kubeconform: ["-v"],
    kubeval: ["--version"]
  };
  const result = run(`host:${name}:version`, name, argsByName[name] || ["--version"]);
  if (name === "kubectl") return result.status === 0 ? kubectlVersion(result.stdout) : "";
  return result.status === 0 ? firstLine(result.stdout) : "";
}

function dockerServerOnHost() {
  return run("host:docker:server", "docker", ["version", "--format", "{{.Server.Version}}"]);
}

function dockerComposeV2OnHost() {
  return run("host:docker-compose-v2:version", "docker", ["compose", "version"]);
}

function parseDefaultDistro(statusText) {
  const match = clean(statusText).match(/Default Distribution:\s*([^\r\n]+)/i);
  return match ? match[1].trim() : "";
}

function parseDistroNames(listText) {
  const names = [];
  for (const line of clean(listText).split(/\r?\n/)) {
    const cleaned = line.replace(/^\s*\*\s*/, "").trim();
    if (!cleaned || /^NAME\s+STATE\s+VERSION/i.test(cleaned)) continue;
    const parts = cleaned.split(/\s{2,}|\t+/).filter(Boolean);
    if (parts[0]) names.push(parts[0].trim());
  }
  return names;
}

function runWsl(distro, label, args) {
  return run(`wsl:${distro}:${label}`, "wsl", ["-d", distro, "--", ...args]);
}

function inspectWsl(platform) {
  if (platform !== "win32") return null;
  const wslPath = existsOnHost("wsl", platform);
  if (!wslPath.found) return null;

  const status = run("host:wsl:status", "wsl", ["--status"]);
  const list = run("host:wsl:list", "wsl", ["-l", "-v"]);
  const defaultDistro = parseDefaultDistro(status.stdout || status.stderr);
  const distros = parseDistroNames(list.stdout || list.stderr);
  const distro = defaultDistro || distros[0] || "";

  const report = {
    found: true,
    status: status.status,
    defaultDistro,
    distros,
    selectedDistro: distro,
    tools: {}
  };

  if (!distro) return report;

  for (const tool of WSL_TOOLS) {
    const pathResult = runWsl(distro, `${tool}:path`, ["which", tool]);
    report.tools[tool] = {
      found: pathResult.status === 0,
      path: firstLine(pathResult.stdout)
    };
  }

  if (report.tools.docker.found) {
    const client = runWsl(distro, "docker:version", ["docker", "--version"]);
    const server = runWsl(distro, "docker:server", ["docker", "version", "--format", "{{.Server.Version}}"]);
    const composeV2 = runWsl(distro, "docker-compose-v2:version", ["docker", "compose", "version"]);
    report.tools.docker.version = client.status === 0 ? firstLine(client.stdout) : "";
    report.tools.docker.server = server.status === 0 ? firstLine(server.stdout) : "";
    report.tools.docker.serverError = server.status === 0 ? "" : firstLine(server.stderr || server.stdout);
    report.tools.docker.composeV2 = composeV2.status === 0 ? firstLine(composeV2.stdout) : "";
  }

  if (report.tools["docker-compose"].found) {
    const composeV1 = runWsl(distro, "docker-compose:version", ["docker-compose", "version"]);
    report.tools["docker-compose"].version = composeV1.status === 0 ? firstLine(composeV1.stdout) : "";
  }

  if (report.tools.kubectl.found) {
    const kubectl = runWsl(distro, "kubectl:version", ["kubectl", "version", "--client", "--output=yaml"]);
    report.tools.kubectl.version = kubectl.status === 0 ? kubectlVersion(kubectl.stdout) : "";
  }

  if (report.tools.helm.found) {
    const helm = runWsl(distro, "helm:version", ["helm", "version", "--short"]);
    report.tools.helm.version = helm.status === 0 ? firstLine(helm.stdout) : "";
  }

  return report;
}

function inspectHost(platform) {
  const tools = {};
  for (const tool of HOST_TOOLS) {
    const path = existsOnHost(tool, platform);
    tools[tool] = { found: path.found, path: path.path };
    if (path.found) tools[tool].version = versionForHost(tool);
  }

  if (tools.docker.found) {
    const server = dockerServerOnHost();
    const composeV2 = dockerComposeV2OnHost();
    tools.docker.server = server.status === 0 ? firstLine(server.stdout) : "";
    tools.docker.serverError = server.status === 0 ? "" : firstLine(server.stderr || server.stdout);
    tools.docker.composeV2 = composeV2.status === 0 ? firstLine(composeV2.stdout) : "";
  }

  return tools;
}

function statusWord(found) {
  return found ? "found" : "missing";
}

function printTool(name, tool) {
  const suffix = tool.version ? ` (${tool.version})` : "";
  console.log(`- ${name}: ${statusWord(tool.found)}${suffix}`);
}

function printReport(report) {
  console.log("Docker and Kubernetes runtime capability check");
  console.log("==============================================");
  console.log(`Host: ${report.platform} ${report.arch}`);
  console.log(`Node: ${process.version}`);
  console.log("");

  console.log("Host tools");
  console.log("----------");
  for (const tool of HOST_TOOLS) printTool(tool, report.hostTools[tool]);
  if (report.hostTools.docker && report.hostTools.docker.found) {
    if (report.hostTools.docker.server) {
      console.log(`- docker daemon: running (${report.hostTools.docker.server})`);
    } else {
      console.log(`- docker daemon: unavailable (${report.hostTools.docker.serverError || "no response"})`);
    }
    if (report.hostTools.docker.composeV2) console.log(`- docker compose: ${report.hostTools.docker.composeV2}`);
  }

  console.log("");
  if (report.wsl) {
    console.log("WSL tools");
    console.log("---------");
    console.log(`- default distro: ${report.wsl.defaultDistro || "not reported"}`);
    if (report.wsl.selectedDistro) console.log(`- selected distro: ${report.wsl.selectedDistro}`);
    if (report.wsl.selectedDistro) {
      for (const tool of WSL_TOOLS) printTool(tool, report.wsl.tools[tool]);
      const docker = report.wsl.tools.docker;
      if (docker && docker.found) {
        if (docker.server) console.log(`- WSL docker daemon: running (${docker.server})`);
        else console.log(`- WSL docker daemon: unavailable (${docker.serverError || "no response"})`);
        if (docker.composeV2) console.log(`- WSL docker compose: ${docker.composeV2}`);
      }
      const composeV1 = report.wsl.tools["docker-compose"];
      if (composeV1 && composeV1.version) console.log(`- WSL docker-compose: ${composeV1.version}`);
    }
  } else {
    console.log("WSL tools");
    console.log("---------");
    console.log("- WSL: not available on this host");
  }

  console.log("");
  console.log("Recommended local test path");
  console.log("---------------------------");
  const hostDockerLive = Boolean(report.hostTools.docker && report.hostTools.docker.server);
  const wslDockerLive = Boolean(report.wsl && report.wsl.tools.docker && report.wsl.tools.docker.server);
  const kubectlAvailable = Boolean(
    (report.hostTools.kubectl && report.hostTools.kubectl.found) ||
    (report.wsl && report.wsl.tools.kubectl && report.wsl.tools.kubectl.found)
  );
  const localClusterTool = ["kind", "k3d", "minikube"].some(tool =>
    (report.hostTools[tool] && report.hostTools[tool].found) ||
    (report.wsl && report.wsl.tools[tool] && report.wsl.tools[tool].found)
  );
  const offlineValidator = ["helm", "kubeconform", "kubeval"].some(tool =>
    (report.hostTools[tool] && report.hostTools[tool].found) ||
    (report.wsl && report.wsl.tools[tool] && report.wsl.tools[tool].found)
  );

  if (hostDockerLive) console.log("1. Use host Docker for live Docker build/run/Compose checks.");
  else if (wslDockerLive) console.log("1. Use WSL Docker for live Docker build/run/Compose checks; invoke it through `wsl -d <distro> -- docker ...` from Windows.");
  else console.log("1. No live Docker daemon found. Use offline hook tests, static Dockerfile review, or an approved remote Docker context.");

  if (kubectlAvailable && localClusterTool) console.log("2. Kubernetes local-cluster testing is possible with the detected kubectl and local cluster tool.");
  else if (kubectlAvailable) console.log("2. kubectl is present, but no local cluster tool was found. Use a remote/dev kubeconfig or install an approved kind, k3d, or minikube path.");
  else console.log("2. kubectl is missing. Live Kubernetes checks cannot run locally until kubectl and a kubeconfig or local cluster tool are available.");

  if (offlineValidator) console.log("3. Offline Kubernetes checks are possible with the detected Helm or schema validation tools.");
  else console.log("3. No offline Kubernetes validators found. Add Helm, kubeconform, or kubeval for cluster-free manifest checks.");
}

function main() {
  const platform = fixture && fixture.platform || process.platform;
  const arch = fixture && fixture.arch || process.arch;
  const report = {
    platform,
    arch,
    hostTools: inspectHost(platform),
    wsl: inspectWsl(platform)
  };
  printReport(report);
}

main();
