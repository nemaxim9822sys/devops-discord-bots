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
