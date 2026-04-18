---
name: compose
description: Generate or update a docker-compose.yml file for a multi-service local development setup. Use when the user asks to create a docker-compose file, add a service to an existing compose setup, or stand up local dependencies like Postgres, Redis, MongoDB, or RabbitMQ.
argument-hint: "[services-description]"
allowed-tools: Read Write Edit Glob
---

# Generate or update docker-compose.yml

Create or update a `docker-compose.yml` that runs the project and its local dependencies.

## Inputs

`$ARGUMENTS` describes the services the user wants. Examples:

- `postgres and redis`
- `my Node app plus Postgres 16 and Redis 7`
- `add a MinIO service to the existing compose file`

If `$ARGUMENTS` is empty, read the project to infer what the app needs (look for Prisma, Sequelize, psycopg, Redis clients, Mongoose, etc.) and ask the user to confirm before generating.

## Detection

1. Check if a `docker-compose.yml` or `compose.yaml` already exists. If it does, plan to edit that file rather than replace it.
2. Check if a `Dockerfile` exists. If not, mention to the user that the app service will need one.
3. Use Glob and Read to detect common libraries in the project's package manifests. This helps when the user says "plus its usual dependencies."

## Required characteristics

1. **Named services**: each service must have a clear name, for example `app`, `db`, `cache`, `queue`.
2. **Pinned image tags**: use a specific version such as `postgres:16.2-alpine`. Never use `latest`.
3. **Healthchecks**: add a `healthcheck` for database and cache services. Make dependent services wait using `depends_on` with `condition: service_healthy`.
4. **Volumes**: declare named volumes for any stateful service so data survives container restarts.
5. **Networks**: use a single user-defined network so services can resolve each other by name.
6. **Environment**: read values from a `.env` file using `env_file` or `${VAR}` substitution. Never hardcode secrets.
7. **Port mapping**: only expose ports that need to be reachable from the host. Internal service-to-service traffic should use the Docker network, not host ports.
8. **Restart policy**: set `restart: unless-stopped` for long-running services.

## Output steps

1. Write or update `docker-compose.yml` at the project root.
2. If there is no `.env.example` and the compose file references env vars, write a minimal `.env.example` with the keys and placeholder values.
3. Explain in 3 to 5 bullets what services you added and any notable choices (pinned versions, healthcheck commands, named volumes).
4. Show the usage commands:

```bash
docker compose up -d
docker compose logs -f app
docker compose down
```

## Example output

```yaml
services:
  app:
    build: .
    env_file: .env
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - internal

  db:
    image: postgres:16.2-alpine
    env_file: .env
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-app}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - internal

  cache:
    image: redis:7.2-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - cache_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped
    networks:
      - internal

volumes:
  db_data:
  cache_data:

networks:
  internal:
    driver: bridge
```

## Do not

- Do not use `version: "3"` or any other top-level `version` field. Modern Compose ignores it.
- Do not expose database or cache ports to the host unless the user asks for it.
- Do not put secrets directly in the file.
