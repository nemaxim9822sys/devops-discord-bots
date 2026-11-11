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

### 2. Launch Services

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
