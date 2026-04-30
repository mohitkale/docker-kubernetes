---
name: docker-debug
description: Diagnose why a Docker build is failing or why a container will not start or is crashing. Use when the user says a Docker build is broken, a container exits immediately, a container is in a restart loop, or they cannot understand error output from Docker.
argument-hint: "[container-id-or-error-context]"
allowed-tools: Bash(docker ps *) Bash(docker ps) Bash(docker logs *) Bash(docker inspect *) Bash(docker events *) Bash(docker version *) Bash(docker info *) Bash(docker image *) Bash(docker history *) Bash(docker compose ps *) Bash(docker compose ps) Bash(docker compose logs *) Bash(docker compose config *) Bash(docker compose config) Bash(docker compose top *) Bash(docker-compose ps *) Bash(docker-compose logs *) Bash(docker-compose config *) Bash(docker-compose top *) Read Grep
---

# Diagnose Docker failures

Find the root cause of a Docker build or runtime failure and suggest a concrete fix.

## Inputs

`$ARGUMENTS` is optional context: a container name or ID, an error message, or a file path to build output. If empty, ask the user which build or container is failing.

## Investigation workflow

### Build failure

1. Ask for or locate the build output. Identify the last successful step and the first failing step.
2. Read the `Dockerfile` to understand the build stages.
3. Common build failures and what to check:
   - **Base image not found**: verify the image name and tag spelling. Check network and registry auth.
   - **Dependency install fails**: check the lockfile, the base image variant (alpine is often missing native build tools), and network access inside the build.
   - **COPY fails with "no such file"**: check the build context. If using `.dockerignore`, confirm the file is not excluded.
   - **Permission denied**: usually a non-root user trying to write outside their HOME or outside the WORKDIR.
   - **"exec format error" at runtime**: image architecture mismatch (for example arm64 image on amd64 host). Use `docker buildx` with `--platform`.

### Runtime failure

1. Run `docker ps -a` to find the container and its status.
2. Run `docker logs <container> --tail 200 --timestamps` and read the last lines.
3. Run `docker inspect <container>` and look at:
   - `.State.ExitCode` and `.State.Error`
   - `.State.OOMKilled` (true means out of memory)
   - `.Config.Cmd`, `.Config.Entrypoint`, `.Config.Env`
   - `.HostConfig.Mounts` and `.NetworkSettings.Ports`
4. Common runtime failures and what to check:
   - **Exit code 137**: killed by OOM. Raise memory limit or reduce memory usage.
   - **Exit code 139**: segfault. Check the image architecture.
   - **Exit code 126 or 127**: command not found or not executable. Check `CMD` and `ENTRYPOINT` syntax and the file permissions.
   - **Restart loop with immediate exit**: the process exits on startup. Read logs for the actual error.
   - **"port already allocated"**: another process is using the host port. Change the mapping or stop the other process.
   - **"no such file or directory" for a mounted volume**: path typo or Windows path style mismatch.
   - **App reachable inside container but not from host**: the app is binding to `127.0.0.1` inside the container. It must bind to `0.0.0.0`.

### Docker Compose failure

1. Run `docker compose ps` to see the status of every service in the stack.
2. Run `docker compose logs --tail=200 --timestamps <service>` for the failing service. Omit the service name to see logs from all services interleaved.
3. Run `docker compose config` to see the fully resolved configuration after env var substitution and profile merging. This catches most "wrong value" surprises.
4. Common Compose-specific failures:
   - **Service stuck in "waiting" because `depends_on` target is unhealthy**: the other service has a failing healthcheck. Inspect it with `docker compose logs <dep>` and `docker inspect <container>`.
   - **Env var not substituted**: the `.env` file is missing, in the wrong directory, or the variable name does not match. `docker compose config` shows the resolved values.
   - **Volume mount shows empty**: host path typo, an unshared host path, or a path translation mismatch between the host OS and the container runtime.
   - **Service cannot reach another by DNS name**: the two services are on different networks. Check the `networks` block and make sure both are attached to the same one.
   - **"port is already allocated"**: another compose project or host process is using that port. Run `docker compose ps -a` across projects or change the host-side port mapping.

## Output

1. State the single most likely root cause in one short sentence.
2. Show the exact output (3 to 10 lines) that supports the diagnosis.
3. Give a concrete fix. If it needs a Dockerfile change, show the before and after lines.
4. If the issue is ambiguous, list the two or three most likely causes with the one command that would confirm each.

## Example diagnosis

**Root cause**: the container exits with code 127 because `CMD` points to a binary that does not exist in the runtime image.

**Evidence**:
```
$ docker logs my-api
/bin/sh: 1: node: not found
$ docker inspect my-api --format '{{.State.ExitCode}}'
127
```

**Fix**: the runtime stage uses `python:3.12-slim` but the `CMD` runs `node server.js`. Change the runtime base image to `node:20-alpine`, or change the `CMD` to the correct entrypoint for Python.

**Next step**:
```bash
docker run --rm my-api which node || echo "node not in image"
```

## Do not

- Do not run destructive commands (`docker rm`, `docker rmi`, `docker system prune`, `docker kill`) without asking the user first.
- Do not guess blindly. If logs are not enough, ask for the specific output you need.
