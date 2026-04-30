#!/usr/bin/env node
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SESSION_HOOK = path.join(ROOT, "hooks", "session-start.js");
const POST_HOOK = path.join(ROOT, "hooks", "post-tool-use.js");
const RUNTIME_CHECK = path.join(ROOT, "bin", "runtime-check.js");
const SMOKE_TEST = path.join(ROOT, "bin", "smoke-test.js");
const HOOKS_JSON = path.join(ROOT, "hooks", "hooks.json");
const PLUGIN_JSON = path.join(ROOT, ".claude-plugin", "plugin.json");
const FIXTURES = path.join(__dirname, "fixtures");

let pass = 0;
let fail = 0;

function recordPass(testName, detail) {
  console.log(`PASS ${testName}${detail ? ` (${detail})` : ""}`);
  pass++;
}

function recordFail(testName, message) {
  console.log(`FAIL ${testName}: ${message}`);
  fail++;
}

function runTest(testName, testBody) {
  try {
    const detail = testBody();
    recordPass(testName, detail);
  } catch (error) {
    recordFail(testName, error.message);
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function walkFiles(startDir, predicate) {
  const files = [];
  for (const entry of fs.readdirSync(startDir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const entryPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath, predicate));
    } else if (!predicate || predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

function parseAdditionalContext(output) {
  const trimmed = output.trim();
  if (!trimmed) return "";
  const parsed = JSON.parse(trimmed);
  return parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext || "";
}

function runSessionHook(cwd) {
  return execFileSync(process.execPath, [SESSION_HOOK], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runPostToolHook(payload) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const result = spawnSync(process.execPath, [POST_HOOK], {
    input,
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`hook exited ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function bashPayload(command, stdout = "", stderr = "") {
  return {
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { stdout, stderr }
  };
}

function withTempProject(testName, setup, assertion) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `docker-kubernetes-${testName}-`));
  try {
    setup(tempRoot);
    assertion(runSessionHook(tempRoot));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeFile(projectRoot, relativePath, content = "") {
  const filePath = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function expectIncludes(actual, expected) {
  if (!actual.includes(expected)) {
    throw new Error(`expected output to include "${expected}", got: ${actual.slice(0, 160)}`);
  }
}

function expectSilent(output) {
  if (output.trim() !== "") {
    throw new Error(`expected silent output, got: ${output.trim().slice(0, 160)}`);
  }
}

function assertFrontmatter(files, label) {
  for (const filePath of files) {
    const content = readText(filePath);
    if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
      throw new Error(`${label} missing YAML frontmatter: ${path.relative(ROOT, filePath)}`);
    }
  }
}

function runFixtureSessionTests() {
  const fixtureNames = fs.readdirSync(FIXTURES).filter(fixtureName =>
    fs.statSync(path.join(FIXTURES, fixtureName)).isDirectory()
  );

  for (const fixtureName of fixtureNames) {
    runTest(`session fixture ${fixtureName}`, () => {
      const cwd = path.join(FIXTURES, fixtureName);
      const expectedPath = path.join(cwd, ".expected-context");
      const expected = fs.existsSync(expectedPath) ? readText(expectedPath).trim() : null;
      const output = runSessionHook(cwd);

      if (expected === "none") {
        expectSilent(output);
        return "silent";
      }

      const context = parseAdditionalContext(output);
      if (!context) throw new Error("missing additionalContext");
      if (expected) expectIncludes(context, expected);
      return "context";
    });
  }
}

runTest("plugin.json parses", () => {
  const manifest = JSON.parse(readText(PLUGIN_JSON));
  for (const fieldName of ["name", "version", "description"]) {
    if (!manifest[fieldName]) throw new Error(`missing ${fieldName}`);
  }
  return `${manifest.name} ${manifest.version}`;
});

runTest("hooks.json parses", () => {
  JSON.parse(readText(HOOKS_JSON));
});

runTest("hook scripts compile", () => {
  for (const hookFile of walkFiles(path.join(ROOT, "hooks"), filePath => filePath.endsWith(".js"))) {
    execFileSync(process.execPath, ["--check", hookFile], { stdio: "pipe" });
  }
});

runTest("bin scripts compile", () => {
  for (const binFile of walkFiles(path.join(ROOT, "bin"), filePath => filePath.endsWith(".js"))) {
    execFileSync(process.execPath, ["--check", binFile], { stdio: "pipe" });
  }
});

runTest("smoke-test kubectl dry-run is offline", () => {
  expectIncludes(readText(SMOKE_TEST), '"create", "--dry-run=client", "--validate=false"');
});

runTest("skills have frontmatter", () => {
  const skillFiles = walkFiles(path.join(ROOT, "skills"), filePath => path.basename(filePath) === "SKILL.md");
  assertFrontmatter(skillFiles, "skill");
  return `${skillFiles.length} skills`;
});

runTest("agents have frontmatter", () => {
  const agentFiles = walkFiles(path.join(ROOT, "agents"), filePath => filePath.endsWith(".md"));
  assertFrontmatter(agentFiles, "agent");
  return `${agentFiles.length} agents`;
});

runTest("commands have frontmatter", () => {
  const commandFiles = walkFiles(path.join(ROOT, "commands"), filePath => filePath.endsWith(".md"));
  assertFrontmatter(commandFiles, "command");
  return `${commandFiles.length} commands`;
});

runTest("markdown has no unicode dashes", () => {
  const markdownFiles = walkFiles(ROOT, filePath => filePath.endsWith(".md"));
  const badFiles = markdownFiles.filter(filePath => /[\u2013\u2014]/u.test(readText(filePath)));
  if (badFiles.length > 0) {
    throw new Error(badFiles.map(filePath => path.relative(ROOT, filePath)).join(", "));
  }
});

runFixtureSessionTests();

const sessionCases = [
  ["dockerfile", projectRoot => writeFile(projectRoot, "Dockerfile", "FROM scratch\n"), "Dockerfile detected"],
  ["compose", projectRoot => writeFile(projectRoot, "compose.yaml", "services: {}\n"), "docker-compose file detected"],
  ["k8s-dir", projectRoot => fs.mkdirSync(path.join(projectRoot, "k8s")), "Kubernetes manifest directory detected"],
  ["helm-chart", projectRoot => writeFile(projectRoot, "Chart.yaml", "apiVersion: v2\nname: demo\nversion: 0.1.0\n"), "Helm chart detected"],
  ["charts-dir", projectRoot => fs.mkdirSync(path.join(projectRoot, "charts")), "charts directory detected"],
  ["skaffold", projectRoot => writeFile(projectRoot, "skaffold.yaml", "apiVersion: skaffold/v4beta11\n"), "Local Kubernetes dev tool detected"]
];

for (const [testName, setup, expected] of sessionCases) {
  runTest(`session detects ${testName}`, () => {
    withTempProject(testName, setup, output => {
      expectIncludes(parseAdditionalContext(output), expected);
    });
  });
}

const postToolCases = [
  ["kubectl apply", bashPayload("kubectl apply -f k8s/"), "After `kubectl apply`"],
  ["kubectl.exe delete", bashPayload("kubectl.exe delete pod api-1"), "State-changing kubectl command detected"],
  ["docker build failure", bashPayload("docker build -t api .", "", "ERROR: failed to solve"), "Docker build appears to have failed"],
  ["docker.exe run failure", bashPayload("docker.exe run api", "exited with code 1", ""), "Container exited with an error"],
  ["docker compose failure", bashPayload("docker compose up", "service api exited with code 1", ""), "Docker Compose command appears to have failed"],
  ["docker-compose failure", bashPayload("docker-compose up", "", "failed to create service"), "Docker Compose command appears to have failed"],
  ["helm.exe upgrade", bashPayload("helm.exe upgrade api ./charts/api", "", ""), "After a Helm install or upgrade"]
];

for (const [testName, payload, expected] of postToolCases) {
  runTest(`post-tool-use detects ${testName}`, () => {
    expectIncludes(parseAdditionalContext(runPostToolHook(payload)), expected);
  });
}

runTest("post-tool-use ignores successful docker build", () => {
  expectSilent(runPostToolHook(bashPayload("docker build -t api .", "Successfully built abc123", "")));
});

runTest("post-tool-use ignores non-Bash tools", () => {
  expectSilent(runPostToolHook({ tool_name: "Read", tool_input: {}, tool_response: {} }));
});

runTest("post-tool-use tolerates invalid JSON", () => {
  expectSilent(runPostToolHook("not json"));
});

runTest("runtime-check fixture reports WSL path", () => {
  const fixturePath = path.join(os.tmpdir(), `runtime-check-${process.pid}.json`);
  const fixture = {
    platform: "win32",
    arch: "x64",
    commands: {
      "host:docker:path": { status: 0, stdout: "C:\\Tools\\docker.exe\n" },
      "host:docker:version": { status: 0, stdout: "Docker version 28.3.3, build test\n" },
      "host:docker:server": { status: 1, stderr: "Cannot connect to the Docker daemon" },
      "host:docker-compose-v2:version": { status: 1, stderr: "unknown command: docker compose" },
      "host:docker-compose:path": { status: 1 },
      "host:kubectl:path": { status: 1 },
      "host:helm:path": { status: 1 },
      "host:podman:path": { status: 1 },
      "host:nerdctl:path": { status: 1 },
      "host:minikube:path": { status: 1 },
      "host:kind:path": { status: 1 },
      "host:k3d:path": { status: 1 },
      "host:wsl:path": { status: 0, stdout: "C:\\Windows\\System32\\wsl.exe\n" },
      "host:wsl:status": { status: 0, stdout: "Default Distribution: Ubuntu\nDefault Version: 2\n" },
      "host:wsl:list": { status: 0, stdout: "  NAME      STATE           VERSION\n* Ubuntu    Running         2\n" },
      "wsl:Ubuntu:docker:path": { status: 0, stdout: "/usr/bin/docker\n" },
      "wsl:Ubuntu:docker:version": { status: 0, stdout: "Docker version 28.0.1, build test\n" },
      "wsl:Ubuntu:docker:server": { status: 0, stdout: "28.0.1\n" },
      "wsl:Ubuntu:docker-compose-v2:version": { status: 0, stdout: "Docker Compose version v2.33.1\n" },
      "wsl:Ubuntu:docker-compose:path": { status: 0, stdout: "/usr/bin/docker-compose\n" },
      "wsl:Ubuntu:docker-compose:version": { status: 0, stdout: "docker-compose version 1.29.2\n" },
      "wsl:Ubuntu:kubectl:path": { status: 1 },
      "wsl:Ubuntu:helm:path": { status: 0, stdout: "/usr/sbin/helm\n" },
      "wsl:Ubuntu:helm:version": { status: 0, stdout: "v3.17.1+g980d8ac\n" },
      "wsl:Ubuntu:podman:path": { status: 1 },
      "wsl:Ubuntu:nerdctl:path": { status: 1 },
      "wsl:Ubuntu:minikube:path": { status: 1 },
      "wsl:Ubuntu:kind:path": { status: 1 },
      "wsl:Ubuntu:k3d:path": { status: 1 },
      "wsl:Ubuntu:kubeconform:path": { status: 1 },
      "wsl:Ubuntu:kubeval:path": { status: 1 }
    }
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  try {
    const output = execFileSync(process.execPath, [RUNTIME_CHECK, "--fixture", fixturePath], { encoding: "utf8" });
    expectIncludes(output, "WSL docker daemon: running (28.0.1)");
    expectIncludes(output, "kubectl is missing");
    expectIncludes(output, "Offline Kubernetes checks are possible");
  } finally {
    fs.rmSync(fixturePath, { force: true });
  }
});

runTest("runtime-check fixture reports host validators", () => {
  const fixturePath = path.join(os.tmpdir(), `runtime-host-check-${process.pid}.json`);
  const fixture = {
    platform: "linux",
    arch: "x64",
    commands: {
      "host:docker:path": { status: 0, stdout: "/usr/bin/docker\n" },
      "host:docker:version": { status: 0, stdout: "Docker version 28.0.0\n" },
      "host:docker:server": { status: 0, stdout: "28.0.0\n" },
      "host:docker-compose-v2:version": { status: 0, stdout: "Docker Compose version v2.33.1\n" },
      "host:docker-compose:path": { status: 1 },
      "host:kubectl:path": { status: 0, stdout: "/usr/bin/kubectl\n" },
      "host:kubectl:version": { status: 0, stdout: "clientVersion:\n  gitVersion: v1.30.0\n" },
      "host:helm:path": { status: 1 },
      "host:podman:path": { status: 1 },
      "host:nerdctl:path": { status: 1 },
      "host:minikube:path": { status: 1 },
      "host:kind:path": { status: 1 },
      "host:k3d:path": { status: 1 },
      "host:kubeconform:path": { status: 0, stdout: "/usr/bin/kubeconform\n" },
      "host:kubeconform:version": { status: 0, stdout: "v0.6.7\n" },
      "host:kubeval:path": { status: 1 }
    }
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  try {
    const output = execFileSync(process.execPath, [RUNTIME_CHECK, "--fixture", fixturePath], { encoding: "utf8" });
    expectIncludes(output, "Host: linux x64");
    expectIncludes(output, "kubectl: found (v1.30.0)");
    expectIncludes(output, "kubeconform: found");
    expectIncludes(output, "Offline Kubernetes checks are possible");
  } finally {
    fs.rmSync(fixturePath, { force: true });
  }
});

runTest("smoke-test fixture reports passes and skips", () => {
  const fixturePath = path.join(os.tmpdir(), `smoke-test-${process.pid}.json`);
  const fixture = {
    distro: "Ubuntu",
    commands: {
      "host:docker:path": { status: 1 },
      "wsl:Ubuntu:docker:path": { status: 0, stdout: "/usr/bin/docker\n" },
      "wsl:Ubuntu:docker:server": { status: 0, stdout: "28.0.1\n" },
      "wsl:Ubuntu:docker:build": { status: 0, stdout: "sha256:test\n" },
      "wsl:Ubuntu:docker:inspect": { status: 0, stdout: "sha256:test\n" },
      "wsl:Ubuntu:docker:rm": { status: 0, stdout: "deleted\n" },
      "wsl:Ubuntu:docker:compose-version": { status: 0, stdout: "Docker Compose version v2.33.1\n" },
      "wsl:Ubuntu:docker:compose-config": { status: 0, stdout: "services:\n  smoke:\n    image: scratch:local\n" },
      "wsl:Ubuntu:helm:path": { status: 0, stdout: "/usr/sbin/helm\n" },
      "wsl:Ubuntu:helm:lint": { status: 0, stdout: "1 chart(s) linted, 0 chart(s) failed\n" },
      "wsl:Ubuntu:helm:template": { status: 0, stdout: "apiVersion: apps/v1\n" },
      "wsl:Ubuntu:kubectl:path": { status: 1 }
    }
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  try {
    const output = execFileSync(process.execPath, [SMOKE_TEST, "--target", "wsl", "--distro", "Ubuntu", "--fixture", fixturePath], { encoding: "utf8" });
    expectIncludes(output, "PASS Docker daemon");
    expectIncludes(output, "PASS Docker build");
    expectIncludes(output, "PASS Helm template");
    expectIncludes(output, "SKIP kubectl client and dry-run");
    expectIncludes(output, "Summary: 6 passed, 2 skipped, 0 failed");
  } finally {
    fs.rmSync(fixturePath, { force: true });
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
