CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (Authentication root)
CREATE TABLE USERS (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

-- Auth Sessions Table (for session tracking)
CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scenes Table (scene objects owned by a user)
CREATE TABLE scenes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    descriptions TEXT,
    is_public BOOLEAN NOT NULL DEFAULT false,
    share_token TEXT UNIQUE NULL,
    engine_version TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

-- Scene Bodies Table (physical entities belonging to a saved scene)
CREATE TABLE scene_bodies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scene_id UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    body_index INT NOT NULL,
    body_id INT NOT NULL,
    mass DOUBLE PRECISION NOT NULL,
    radius DOUBLE PRECISION NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    vx DOUBLE PRECISION NOT NULL,
    vy DOUBLE PRECISION NOT NULL,
    alive BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_scenes_user_id ON scenes(user_id);
CREATE INDEX idx_scene_bodies_scene_id ON scene_bodies(scene_id);
CREATE INDEX idx_auth_sessions_user_id ON auth_sessions(user_id);
