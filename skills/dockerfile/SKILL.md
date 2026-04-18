---
name: dockerfile
description: Generate a production-grade Dockerfile for the current project. Use this when the user asks to create a Dockerfile, dockerize or containerize a project, or when a project has no Dockerfile and the user wants to deploy it. Works for Node, Python, Go, Rust, Java, Ruby, PHP, and more.
argument-hint: "[language-or-framework]"
allowed-tools: Read Write Glob
---

# Generate a production-grade Dockerfile

Create a Dockerfile for the current project that follows container best practices: multi-stage builds, pinned base images, non-root users, layer caching, and security hardening.

## Inputs

`$ARGUMENTS` is an optional hint about the language or framework.

Examples: `node`, `python fastapi`, `go`, `rails`, `next.js`.

If `$ARGUMENTS` is empty, detect the language and framework by reading the project files.

## Detection steps (run only when no argument is given)

1. Use Glob to look for these files at the project root:
   - `package.json` means Node.js. Read it to find the framework (Next.js, Express, NestJS, Nuxt).
   - `requirements.txt`, `pyproject.toml`, or `Pipfile` means Python. Read to find the framework (Django, Flask, FastAPI).
   - `go.mod` means Go.
   - `Cargo.toml` means Rust.
   - `pom.xml` or `build.gradle` means Java (Maven or Gradle).
   - `Gemfile` means Ruby, typically Rails.
   - `composer.json` means PHP, typically Laravel or Symfony.
2. If multiple are present, ask the user which target to use.
3. If none are found, ask the user to specify the language and framework.

## Required Dockerfile characteristics

1. **Multi-stage build**: separate the builder stage from the runtime stage. The runtime image should not contain build tools.
2. **Pinned base images**: never use `latest`. Use a specific version and a minimal variant (alpine, slim, or distroless) where possible.
3. **Non-root user**: the runtime stage must run as a non-root user.
4. **Layer caching**: copy dependency manifests first, install dependencies, then copy the rest of the source. Source changes must not invalidate dependency layers.
5. **EXPOSE and ports**: add an `EXPOSE` instruction that matches the application's listen port.
6. **Signal handling**: use the `exec` form of `CMD` (JSON array syntax). Consider `tini` for runtimes that do not reap zombies cleanly.
7. **Minimal copy**: avoid copying secrets, `.git`, `node_modules`, virtualenvs, or local build artifacts. Use a `.dockerignore` file.
8. **Health check**: add a `HEALTHCHECK` when the app exposes a readiness or health endpoint.

## Output steps

1. Write a file named `Dockerfile` at the project root.
2. If there is no `.dockerignore`, also write one with sensible defaults.
3. Briefly explain (3 to 5 short bullets) the stages and any non-obvious choices.
4. Show the exact commands to build and run locally. Pick the host and container ports that match the app:

```bash
docker build -t my-app .
docker run --rm -p 3000:3000 my-app
```

## Example output for Node.js / Next.js

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:20.12-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20.12-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20.12-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
```

## Example output for Python / FastAPI

```dockerfile
# syntax=docker/dockerfile:1.7

FROM python:3.12-slim AS builder
WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PATH="/opt/venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd -r -s /bin/false app
COPY --from=builder /opt/venv /opt/venv
COPY --chown=app:app . .
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Example `.dockerignore`

```
.git
.gitignore
node_modules
.next
.venv
__pycache__
.env
.env.*
.DS_Store
npm-debug.log
.vscode
.idea
coverage
.nyc_output
dist
build
Dockerfile
.dockerignore
README.md
```

## Do not

- Do not use `latest` tags for base images.
- Do not run the runtime stage as root.
- Do not copy `.env` files or secrets into the image.
- Do not leave build tools in the runtime stage.
