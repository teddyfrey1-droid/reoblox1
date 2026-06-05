-- ============================================================================
--  LUMORA — Production database schema (PostgreSQL 15+)
-- ============================================================================
--  Design notes
--  ------------
--  * This is the SOURCE OF TRUTH (durable state). Hot, high-churn data (live garden
--    timers, presence, world-bloom counter, leaderboards) lives in Redis and is
--    periodically flushed here. The in-memory MemoryStore in /server implements the
--    same logical model for the MVP slice.
--  * Currencies, Lumi genomes and economy events are append-friendly: we keep a
--    ledger so every Petal/Lumen movement is auditable (fraud, refunds, live-ops).
--  * A Lumi is stored as its 32-bit seed + the context it was born in. The full
--    genome is DERIVED on read by the shared /core/genome.js generator, so we never
--    store (or risk desyncing) hundreds of bytes of redundant render data. This is
--    the storage pay-off of the deterministic design: ~16 bytes per creature.
--  * UUID primary keys (v4) to allow client-side optimistic ids and easy sharding.
--  * Money/counters use BIGINT; never floats for currency.
-- ============================================================================

-- gen_random_uuid() is built into PostgreSQL core since v13 (no pgcrypto needed).
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- fuzzy handle search
CREATE EXTENSION IF NOT EXISTS "citext";      -- case-insensitive handles / names

-- ---------------------------------------------------------------------------
-- Players & authentication
-- ---------------------------------------------------------------------------
CREATE TABLE players (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle          CITEXT UNIQUE NOT NULL CHECK (char_length(handle) BETWEEN 3 AND 20),
    display_name    TEXT,
    -- Auth is provider-agnostic (Apple/Google/device). Credentials live in auth_identities.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    country         TEXT,                         -- for live-ops / store pricing
    xp              BIGINT NOT NULL DEFAULT 0,
    keeper_level    INT NOT NULL DEFAULT 1,
    -- Soft-ban / moderation flags
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','shadow','banned')),
    flags           JSONB NOT NULL DEFAULT '{}'   -- feature unlocks, A/B buckets, settings
);
CREATE INDEX players_last_seen_idx ON players (last_seen_at);
CREATE INDEX players_handle_trgm_idx ON players USING gin (handle gin_trgm_ops);

CREATE TABLE auth_identities (
    player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,                    -- 'apple','google','device','email'
    subject     TEXT NOT NULL,                    -- provider-specific user id
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

-- ---------------------------------------------------------------------------
-- Wallets & the economy ledger (every movement is recorded)
-- ---------------------------------------------------------------------------
CREATE TABLE wallets (
    player_id   UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    petals      BIGINT NOT NULL DEFAULT 0 CHECK (petals >= 0),   -- soft currency
    lumen       BIGINT NOT NULL DEFAULT 0 CHECK (lumen  >= 0),   -- premium currency
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only ledger. Partition by month in production (PARTITION BY RANGE (created_at)).
CREATE TABLE economy_ledger (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    currency    TEXT NOT NULL CHECK (currency IN ('petals','lumen')),
    delta       BIGINT NOT NULL,                  -- signed; + source, - sink
    reason      TEXT NOT NULL,                    -- 'daily_reward','shop:plant:dewbud','breed_ritual'...
    kind        TEXT NOT NULL CHECK (kind IN ('source','sink')),
    ref         JSONB,                            -- optional: order id, item id, etc.
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_player_idx ON economy_ledger (player_id, created_at);
CREATE INDEX ledger_reason_idx ON economy_ledger (reason, created_at);

-- ---------------------------------------------------------------------------
-- Lumi (creatures) — stored as seed + birth context, genome derived on read
-- ---------------------------------------------------------------------------
CREATE TABLE lumi (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    seed          BIGINT NOT NULL,                -- uint32 genome seed
    -- Birth context needed to reproduce the exact genome (biome/season/bloom/care):
    context       JSONB NOT NULL,
    -- Denormalised, indexable summary fields (kept in sync by the app from the genome)
    -- so we can query/sort/trade without regenerating every row:
    rarity        TEXT NOT NULL,
    element       TEXT NOT NULL,
    form          TEXT NOT NULL,
    power         INT  NOT NULL,
    name          TEXT NOT NULL,
    mutations     TEXT[] NOT NULL DEFAULT '{}',
    parents       UUID[] NOT NULL DEFAULT '{}',   -- lineage (0 or 2)
    nickname      TEXT,                            -- player-given
    favorite      BOOLEAN NOT NULL DEFAULT false,
    locked        BOOLEAN NOT NULL DEFAULT false,  -- protect from accidental trade/release
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lumi_owner_idx     ON lumi (owner_id, created_at DESC);
CREATE INDEX lumi_owner_power   ON lumi (owner_id, power DESC);
CREATE INDEX lumi_rarity_idx    ON lumi (rarity);
CREATE INDEX lumi_mutations_idx ON lumi USING gin (mutations);

-- ---------------------------------------------------------------------------
-- Gardens, plots & live plantings
-- ---------------------------------------------------------------------------
CREATE TABLE gardens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    biome       TEXT NOT NULL DEFAULT 'meadow',
    bloom       REAL NOT NULL DEFAULT 0 CHECK (bloom BETWEEN 0 AND 100),
    care_streak INT  NOT NULL DEFAULT 0,
    decor       JSONB NOT NULL DEFAULT '[]',
    layout      JSONB NOT NULL DEFAULT '{}',      -- decor positions, theme
    UNIQUE (player_id, id)
);
CREATE INDEX gardens_player_idx ON gardens (player_id);

CREATE TABLE plots (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    garden_id   UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    idx         INT  NOT NULL,
    -- Live planting (NULL when empty). Kept here for durability; the countdown is
    -- served from Redis for low latency and flushed back on change.
    plant_id    TEXT,
    planted_at  TIMESTAMPTZ,
    ready_at    TIMESTAMPTZ,
    watered     INT NOT NULL DEFAULT 0,
    lumi_seed   BIGINT,                            -- locked at plant time
    UNIQUE (garden_id, idx)
);
CREATE INDEX plots_ready_idx ON plots (ready_at) WHERE ready_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Retention: daily streaks, quests, battle pass
-- ---------------------------------------------------------------------------
CREATE TABLE daily_streaks (
    player_id       UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    streak          INT NOT NULL DEFAULT 0,
    last_claim_day  INT,                           -- integer UTC day index
    best_streak     INT NOT NULL DEFAULT 0
);

CREATE TABLE quests (
    player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    day_index   INT  NOT NULL,
    quest_id    TEXT NOT NULL,
    target      INT  NOT NULL,
    progress    INT  NOT NULL DEFAULT 0,
    done        BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (player_id, day_index, quest_id)
);

CREATE TABLE pass_progress (
    player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    season      TEXT NOT NULL,
    pass_xp     INT  NOT NULL DEFAULT 0,
    tier        INT  NOT NULL DEFAULT 0,
    premium     BOOLEAN NOT NULL DEFAULT false,    -- owns the paid track
    claimed     INT[] NOT NULL DEFAULT '{}',       -- tiers already claimed
    PRIMARY KEY (player_id, season)
);

-- ---------------------------------------------------------------------------
-- Social: Constellations (guilds), friendships, trades
-- ---------------------------------------------------------------------------
CREATE TABLE constellations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        CITEXT UNIQUE NOT NULL,
    tag         TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    bloom_score BIGINT NOT NULL DEFAULT 0,         -- collective contribution
    perks       JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE constellation_members (
    constellation_id UUID NOT NULL REFERENCES constellations(id) ON DELETE CASCADE,
    player_id        UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    role             TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('founder','elder','member')),
    joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    contributed      BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id)                          -- one constellation per player
);

CREATE TABLE friendships (
    a_id        UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    b_id        UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','blocked')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (a_id, b_id),
    CHECK (a_id <> b_id)
);

-- Player-to-player Lumi trades (escrow model; both sides confirm).
CREATE TABLE trades (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_id     UUID NOT NULL REFERENCES players(id),
    to_id       UUID NOT NULL REFERENCES players(id),
    offer_lumi  UUID[] NOT NULL DEFAULT '{}',
    offer_petals BIGINT NOT NULL DEFAULT 0,
    request_lumi UUID[] NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','cancelled','expired')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX trades_to_idx ON trades (to_id, status);

-- ---------------------------------------------------------------------------
-- Monetisation: store products & IAP receipts (server-validated)
-- ---------------------------------------------------------------------------
CREATE TABLE iap_receipts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id     UUID NOT NULL REFERENCES players(id),
    platform      TEXT NOT NULL CHECK (platform IN ('apple','google','stripe')),
    product_id    TEXT NOT NULL,
    transaction_id TEXT UNIQUE NOT NULL,           -- dedupe: never grant twice
    price_usd_cents INT,
    granted_lumen BIGINT,
    status        TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('pending','verified','refunded','fraud')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX iap_player_idx ON iap_receipts (player_id, created_at);

-- ---------------------------------------------------------------------------
-- Shared world meta — the "Great Bloom". Single logical row; mirrored in Redis.
-- ---------------------------------------------------------------------------
CREATE TABLE world_state (
    id                INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    season            TEXT NOT NULL DEFAULT 'spring',
    bloom_level       DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_lumi_hatched BIGINT NOT NULL DEFAULT 0,
    event             JSONB,                        -- active community event payload
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO world_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Analytics events (thin; real pipeline streams to a warehouse e.g. BigQuery).
-- Kept here as a durable fallback / debugging aid.
-- ---------------------------------------------------------------------------
CREATE TABLE analytics_events (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_id   UUID,
    name        TEXT NOT NULL,
    props       JSONB,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analytics_name_ts_idx ON analytics_events (name, ts);

-- ============================================================================
--  To apply locally:  psql "$DATABASE_URL" -f db/schema.sql
--  CI should apply this against a scratch Postgres to catch drift before deploy.
-- ============================================================================
