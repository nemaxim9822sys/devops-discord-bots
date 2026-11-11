-- ============================================================
-- Database Initialization Schema for Discord Tracker Bot
-- ============================================================

CREATE TABLE IF NOT EXISTS public.activity_events (
    id BIGSERIAL PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    event_type VARCHAR(30) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.presence_sessions (
    id BIGSERIAL PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    online_at TIMESTAMPTZ NOT NULL,
    offline_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.voice_sessions (
    id BIGSERIAL PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    channel_id VARCHAR(20) NOT NULL,
    channel_name VARCHAR(100) NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    left_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_activity_events_user_time 
    ON public.activity_events (guild_id, user_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_presence_sessions_user 
    ON public.presence_sessions (guild_id, user_id, online_at);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_user 
    ON public.voice_sessions (guild_id, user_id, joined_at);
