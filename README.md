# Discord Automation & Tracking Bots

A production-ready suite of Discord bots designed for activity telemetry, work presence tracking, automated Google Sheets reporting, and AI-powered voice meeting transcription with OpenAI Whisper and GPT-4o.

---

## 📦 Project Architecture

1. **`discord-bot` (Tracker & Analytics)**
   - Monitors user presence (online/idle/dnd/offline) and voice channel transitions.
   - Saves time intervals into PostgreSQL (`activity_events`, `presence_sessions`, `voice_sessions`).
   - Exports daily/monthly analytics into Google Sheets via Google Sheets API v4.
   - Supports "Free Time Zone" channels where tracking is paused.

2. **`discord-transcriber` (Voice Meeting Assistant)**
   - Automatically joins voice rooms or responds to slash commands (`/record`, `/stop`).
   - Records multi-user audio streams with dedicated recorder bots.
   - Converts and transcribes audio segments using **OpenAI Whisper**.
   - Generates structured meeting summaries and action items with **OpenAI GPT-4o**.
   - Archives minutes directly to designated Discord forum/text channels and sends DM summaries to participants.

3. **`database/init.sql`**
   - DDL initialization schema for PostgreSQL.
   - Creates required tables and optimized btree indexes.

---

## 🚀 Quick Start (Docker Compose)

### 1. Configure Environment Variables

Copy the example configuration files and fill in your credentials:

```bash
# Tracker Bot
cp discord-bot/.env.example discord-bot/.env
cp discord-bot/google-service-account.example.json discord-bot/google-service-account.json

# Transcriber Bot
cp discord-transcriber/.env.example discord-transcriber/.env
cp discord-transcriber/.env.recorders.example discord-transcriber/.env.recorders
```

### 2. Configure PostgreSQL Password

Before starting Docker Compose, create a root `.env` file with `DB_PASSWORD`:

```bash
printf "DB_PASSWORD=%s\n" "$(openssl rand -hex 24)" > .env
```

Keep this file private. It is ignored by Git.


### 3. Launch Services

```bash
# Start PostgreSQL database, tracker bot, and transcriber bot
docker compose up -d --build
```

To run only the database for local development:
```bash
docker compose up -d postgres
```

---

## 🛠️ Local Development

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- FFmpeg (for transcriber)

### Tracker Bot Setup
```bash
cd discord-bot
npm install
npm start
```

### Transcriber Bot Setup
```bash
cd discord-transcriber
npm install
npm start
```

---

## 🔒 Security Best Practices
- Keep `.env` and `google-service-account.json` in `.gitignore`.
- Rotate API keys and bot tokens regularly.
- Ensure bots have appropriate Discord Gateway Intents enabled (`GuildPresences`, `GuildVoiceStates`, `MessageContent`).

---

## DevOps Improvements

This repository includes the following infrastructure improvements:

### Containerization
- Docker Compose configuration for PostgreSQL 17 and two Node.js services.
- Persistent PostgreSQL storage using a Docker volume.
- PostgreSQL health check.
- Database port bound to localhost.

### Docker Image Optimization
The transcriber image was optimized using a multi-stage Dockerfile.

| Metric | Original | Optimized |
|--------|----------|-----------|
| Image size | 1.7 GB | 1.15 GB |

**Result:** approximately 550 MB (32.4%) smaller image.

Build tools are installed in the builder stage, while the runtime stage
contains Node.js, FFmpeg, application code, and production dependencies.

The optimized image was smoke-tested for:
- Node.js availability.
- FFmpeg availability.
- Installed Node.js dependencies.
- Native GNU module library dependencies.

Full application testing requires valid Discord and API credentials.

### Continuous Integration
GitHub Actions workflow: `.github/workflows/docker-build.yml`

- Builds both Docker images on push and pull request.
- Uses Docker Buildx.
- Uses GitHub Actions layer caching.
- Does not publish images.
- Workflow configuration validated with actionlint.

### Local Verification
- PostgreSQL container started successfully and passed its health check.
- PostgreSQL version verified: 17.11.
- Both application Docker images built successfully.

## Infrastructure Verification

The following checks were completed on Ubuntu 24.04:

| Component | Verified result |
|---|---|
| Docker Compose | Configuration validation passed |
| PostgreSQL 17 | Container running, healthcheck healthy |
| Database networking | Bound to 127.0.0.1:5432 |
| Tracker image | Built successfully; Node.js 20.20.2 |
| Transcriber image | Built successfully; Node.js 20.20.2 |
| FFmpeg | Version 5.1.9 available in transcriber |
| Image optimization | Reduced from 1.7 GB to 1.15 GB (~32.4%) |

### Verification Scope

Docker image builds and runtime dependency checks passed.
End-to-end Discord integration has not yet been tested because
test credentials for Discord, Google and OpenAI are not configured.

The GitHub Actions workflow was validated with actionlint;
a successful GitHub-hosted workflow run has not yet been verified.

---

## Kubernetes Deployment (k3s + Helm)

The project includes a Helm chart in `helm/discord-bots/`.

Tested environment:
- Ubuntu 24.04
- Single-node k3s cluster
- Helm 3
- PostgreSQL 17

The Helm chart deploys PostgreSQL with persistent storage
and defines Deployments for both Discord bots.

In the demonstration environment, PostgreSQL is running
and the database schema has been verified.

Both bots are intentionally configured with `replicas: 0`
because real API credentials are not provided.

Full application integration testing requires valid credentials.

## Monitoring and Centralized Logging

The Kubernetes observability stack includes:

- Prometheus: collects Kubernetes and Linux node metrics.
- Grafana: provides infrastructure dashboards.
- kube-state-metrics: exposes Kubernetes resource metrics.
- node-exporter: exposes Linux host metrics.
- Grafana Alloy: collects Kubernetes pod logs.
- Loki: stores and queries collected logs.

Configuration files:
- `monitoring/values.yaml` - Prometheus and Grafana.
- `monitoring/loki-values.yaml` - Loki.
- `monitoring/alloy-values.yaml` - Alloy.

Verified results:
- Prometheus, Grafana, Loki and Alloy pods are running.
- Kubernetes and Linux node metrics are visible in Grafana.
- PostgreSQL logs are available through Grafana Explore.
- Persistent volumes are bound.

Example LogQL query: `{namespace="discord-bots"}`

Both application bots remain scaled to zero until valid
credentials are supplied and integration tests are completed.

---

## Kubernetes Deployment Guide

This project was tested on Ubuntu 24.04 using a single-node k3s cluster and Helm 3.

### Architecture

- Docker builds the application images.
- Kubernetes (k3s) orchestrates the containers.
- Helm manages application deployments.
- PostgreSQL 17 runs as a StatefulSet with persistent storage.
- Prometheus collects infrastructure metrics.
- Grafana visualizes metrics and logs.
- Grafana Alloy collects Kubernetes pod logs.
- Loki stores and queries logs.

### Prerequisites

Install and configure:

- Docker Engine
- k3s
- kubectl
- Helm 3
- Git

Clone the repository and navigate to the project directory.

### Build Application Images

```bash
docker compose build
```

The Helm chart uses these local image names:

- `1109-tracker-bot:latest`
- `1109-transcriber-bot:latest`

Import both images into k3s containerd:

```bash
docker save 1109-tracker-bot:latest | sudo k3s ctr images import -
docker save 1109-transcriber-bot:latest | sudo k3s ctr images import -
```

### Create Kubernetes Namespace

```bash
kubectl create namespace discord-bots
```

If the namespace already exists, this command can be skipped.

### Configure PostgreSQL Secret

The PostgreSQL chart expects a Secret named `discord-postgres-secret`.

Generate a password locally and create the Secret:

```bash
DB_PASSWORD="$(openssl rand -hex 24)"

kubectl create secret generic discord-postgres-secret \
  --namespace discord-bots \
  --from-literal=POSTGRES_PASSWORD="$DB_PASSWORD"

unset DB_PASSWORD
```

Never commit passwords, tokens or Kubernetes Secret manifests containing real credentials.

### Deploy PostgreSQL and Application Resources

Install the Helm chart:

```bash
helm upgrade --install discord ./helm/discord-bots \
  --namespace discord-bots \
  --set trackerBot.replicas=0 \
  --set transcriberBot.replicas=0
```

The bots are intentionally disabled in this demonstration because valid Discord, Google and OpenAI credentials are not included.

PostgreSQL remains enabled.

Verify the deployment:

```bash
kubectl get pods -n discord-bots
kubectl get pvc -n discord-bots
helm list -n discord-bots
```

Expected result: PostgreSQL is running, its persistent volume is bound, and the bot Deployments have zero replicas.

### Install Prometheus and Grafana

Add the Helm repository:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
```

Create the monitoring namespace:

```bash
kubectl create namespace monitoring
```

Install the monitoring stack:

```bash
helm upgrade --install monitoring \
  prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  -f monitoring/values.yaml
```

### Install Loki and Grafana Alloy

Add the Grafana Helm repository:

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
```

Install Loki:

```bash
helm upgrade --install loki grafana/loki \
  --namespace monitoring \
  -f monitoring/loki-values.yaml
```

Install Alloy:

```bash
helm upgrade --install alloy grafana/alloy \
  --namespace monitoring \
  -f monitoring/alloy-values.yaml
```

### Verify Monitoring

```bash
kubectl get pods -n monitoring
kubectl get pvc -n monitoring
helm list -A
```

All monitoring components should reach the Running state.

### Access Grafana

Forward the Grafana service to localhost:

```bash
kubectl port-forward -n monitoring \
  svc/monitoring-grafana 3000:80
```

Open:

http://localhost:3000

If Kubernetes runs on a remote VM, use an SSH tunnel to access this port securely.

Grafana administrator credentials are stored in the Kubernetes Secret created by the monitoring Helm chart.

### Configure Loki Data Source

In Grafana, add a Loki data source with this URL:

```text
http://loki.monitoring.svc.cluster.local:3100
```

Use Save & test to verify the connection.

Open Grafana Explore and run:

```logql
{namespace="monitoring"}
```

To view PostgreSQL logs:

```logql
{namespace="discord-bots"}
```

Select an appropriate time range, such as Last 24 hours, if no recent logs are visible.

### Verification Results

The following functionality was verified in the local demonstration environment:

- k3s node reached Ready state.
- Helm deployment completed successfully.
- PostgreSQL StatefulSet reached Running state.
- PostgreSQL database tables and indexes were verified.
- Kubernetes persistent volumes were bound.
- Prometheus collected Kubernetes and Linux node metrics.
- Grafana displayed infrastructure dashboards.
- Alloy collected Kubernetes pod logs.
- Loki returned logs through Grafana Explore.
- Gitleaks found no secrets in the checked Helm and monitoring configuration files.

### Known Limitations

- Discord bots were not tested end-to-end with real API credentials.
- Application Docker images were built and imported locally rather than pulled from a container registry.
- GitHub Actions workflows were validated locally with actionlint, but successful GitHub-hosted runs have not yet been verified.
- The deployment was tested on a single-node k3s cluster, not a multi-node production environment.
