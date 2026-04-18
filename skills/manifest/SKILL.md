---
name: manifest
description: Generate Kubernetes manifests from a plain-English description of what to deploy. Use when the user asks to write a Deployment, Service, Ingress, ConfigMap, Secret, HorizontalPodAutoscaler, StatefulSet, or Job, or asks to turn a docker-compose file into Kubernetes manifests.
argument-hint: "<description of the workload>"
allowed-tools: Read Write Edit Glob
---

# Generate Kubernetes manifests

Write clean, idiomatic Kubernetes YAML for the workload described.

## Inputs

`$ARGUMENTS` is a description of what to deploy. Examples:

- `a Node app called api that talks to Postgres, 3 replicas, behind an Ingress at api.example.com`
- `a Redis statefulset with 10Gi persistent storage`
- `turn our docker-compose.yml into manifests for staging`

If `$ARGUMENTS` is vague, ask a small number of focused questions before generating anything:

- Image name and tag.
- Replica count.
- Ports the app listens on.
- Whether it needs persistent storage.
- Whether it needs to be reachable from outside the cluster.

## Required characteristics

Every manifest you produce must follow these rules:

1. **Labels and selectors**: use `app.kubernetes.io/name` and `app.kubernetes.io/instance` consistently across Deployment, Service, and related resources.
2. **Resource requests and limits**: every container must have `resources.requests` and `resources.limits`. Use reasonable defaults if the user did not specify.
3. **Probes**: include `readinessProbe` and `livenessProbe` when the app exposes an HTTP endpoint. Use `startupProbe` for slow-starting apps.
4. **Security context**: run as a non-root user (`runAsNonRoot: true`, `runAsUser: <uid>`), drop all capabilities, and set `readOnlyRootFilesystem: true` where the app allows it.
5. **Image tag**: never `latest`. Always a specific version or digest.
6. **PodDisruptionBudget**: include one for workloads with more than one replica.
7. **ConfigMap vs Secret**: non-sensitive config goes in a ConfigMap, secrets go in a Secret. Never put secrets in ConfigMaps.
8. **Namespace**: if the user specified one, use it. Otherwise omit the namespace field so manifests stay namespace-agnostic.
9. **API versions**: use the latest stable API versions: `apps/v1`, `networking.k8s.io/v1`, `autoscaling/v2`, `policy/v1`.

## Output steps

1. Decide how to split the manifests. Default: one file per kind, grouped in a `k8s/` or `manifests/` directory. If there is an existing layout, follow it.
2. Write each manifest as a separate YAML file, or a single file with `---` separators if the user prefers.
3. Show the commands to apply and verify:

```bash
kubectl apply -f k8s/
kubectl rollout status deployment/<name>
kubectl get pods -l app.kubernetes.io/name=<name>
```

## Example: simple web API

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  labels:
    app.kubernetes.io/name: api
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: api
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
        - name: api
          image: ghcr.io/example/api:1.4.2
          ports:
            - containerPort: 3000
              name: http
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 15
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
---
apiVersion: v1
kind: Service
metadata:
  name: api
  labels:
    app.kubernetes.io/name: api
spec:
  selector:
    app.kubernetes.io/name: api
  ports:
    - name: http
      port: 80
      targetPort: http
  type: ClusterIP
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: api
```

## Example: Ingress with TLS

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.example.com
      secretName: api-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  name: http
```

## Example: HorizontalPodAutoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
```

## Example: StatefulSet with persistent storage

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
spec:
  serviceName: redis
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: redis
  template:
    metadata:
      labels:
        app.kubernetes.io/name: redis
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 999
        fsGroup: 999
      containers:
        - name: redis
          image: redis:7.2-alpine
          ports:
            - containerPort: 6379
              name: redis
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          volumeMounts:
            - name: data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 10Gi
```

Pair a StatefulSet with a headless Service (`clusterIP: None`) so pods can be addressed individually by DNS.

## Example: ConfigMap and Secret

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
data:
  LOG_LEVEL: info
  FEATURE_FLAGS: "new-ui,beta-search"
---
apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
type: Opaque
stringData:
  DATABASE_URL: postgres://app:CHANGEME@db.default.svc.cluster.local:5432/app
  JWT_SECRET: CHANGEME
```

Reference them from the Deployment:

```yaml
containers:
  - name: api
    envFrom:
      - configMapRef:
          name: api-config
      - secretRef:
          name: api-secrets
```

Never commit real Secret values to git. Use Sealed Secrets, SOPS, or an external secrets operator for production.

## Example: CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-cleanup
spec:
  schedule: "0 2 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
          containers:
            - name: cleanup
              image: ghcr.io/example/cleanup:1.0.0
              resources:
                requests:
                  cpu: 50m
                  memory: 64Mi
                limits:
                  cpu: 200m
                  memory: 128Mi
```

## Do not

- Do not set resource limits lower than requests.
- Do not use `image: <name>` without a tag or digest.
- Do not default to `runAsUser: 0` or leave `runAsNonRoot` unset.
- Do not use deprecated API versions such as `extensions/v1beta1`, `apps/v1beta1`, or `networking.k8s.io/v1beta1`.
