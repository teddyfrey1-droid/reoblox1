# Changelog

All notable changes to the LUMORA prototype are documented here.

## [0.3.1] — Production hardening (publish-ready)

A bug-hunt + multi-angle code review pass on the public API and core logic.

### Fixed
- **Correct HTTP status codes**: domain errors now carry a `status`, so client
  mistakes (occupied/empty/out-of-range plot, not-ready harvest, unknown plant,
  malformed trade, insufficient funds) return the right **4xx** instead of being
  mislabelled **500s**. New `core/errors.js#GameError`; `EconomyError.status = 400`.
  `garden.js` distinguishes `BAD_PLOT` from `EMPTY_PLOT`.
- **Input validation / DoS**: `readJson` caps the body at 512 KB (413) and rejects
  non-object JSON (400). `/api/preview/lumi` sanitises numeric params (a NaN no
  longer forces always-Mythic) and 400s a malformed seed code.
- **No charge on a rejected action**: `garden/plant` validates the plot before
  debiting the seed cost.
- **Soft-currency faucet exploits closed**: `/visit` blocks self-visits, dedupes
  per neighbour per day, **and** caps rewarded visits to 5 distinct neighbours/day
  (breadth cap), so it can't be farmed across many player ids. `stats.visits` only
  counts rewarded visits.
- **Store parity**: under PostgreSQL, a malformed id (path or body) now returns a
  clean **404** instead of a Postgres `invalid input syntax for type uuid` 500.
- **Trade offer type guards**: `offerLumi`/`requestLumi` must be arrays of string
  ids; `offerPetals` a non-negative integer.

### Notes
- The shared world counter (Great Bloom) and the per-day visit cap are enforced in
  process memory and last-writer-wins on commit; under multi-instance concurrency
  these need atomic SQL increments / Redis (documented in docs/11). Correct for the
  single-process slice.

Tests: +`test/hardening.test.js` and PgStore UUID-parity + visit-cap cases. 61 → **70**.

## [0.3.0] — Real PostgreSQL persistence (durability proven)

### Added
- **`PgStore`** (`server/pgStore.js`): a durable, relational PostgreSQL implementation
  of the store interface, mapping `db/schema.sql` (players, wallets, daily_streaks,
  gardens, lumi, economy_ledger, constellations(+members), trades, world_state).
- **Per-request unit of work** via `AsyncLocalStorage`: entities hydrate into a
  request-scoped identity map; a successful POST commits all touched entities in one
  transaction; reads never persist; handler errors skip the commit (no partial writes).
- **DB adapter** (`server/db.js`): one `query/exec/tx/close` interface over PGlite
  (tests/CI) and `pg.Pool` (production, lazy-imported optional dependency), plus
  `applySchema`/`ensureSchema`.
- **`test/pgstore.test.js`**: runs the API end-to-end against a real Postgres engine
  (PGlite) and proves **durability** — committed state survives a brand-new store
  instance over the same database. Suite: 55 → **61 passing tests**.

### Changed
- Store interface is now async; `server/api.js` handlers `await` store calls and run
  inside `store.withRequest(...)`. The `MemoryStore` path is unchanged in behaviour
  (its `withRequest` is a no-op; it keeps live-reference semantics).
- `server/index.js` selects the store by `DATABASE_URL` (Postgres) else in-memory +
  demo world. `db/schema.sql`: added `lumi.genome` JSONB and a `UNIQUE(player_id)` on
  gardens to support clean upserts. CI now `npm install`s so the PgStore test runs.
- The player-object shape is now built by a shared `newPlayer()`/`starterLumi()`
  factory used by both stores (single source of truth).

## [0.2.0] — Quality pass: deeper systems, data-driven balance, visual proof

### Added — game systems (all unit-tested)
- **Bad-luck protection (pity)** — `core/luck.js`: guarantees a minimum rarity after
  a bounded dry streak (rare ≤18, epic ≤70), then resets. Wired into hatching via a
  new `rarityFloor` generation input.
- **Bloomdex** — `core/bloomdex.js`: collection encyclopaedia with completion across
  species/elements/forms/rarities/mutations and claimable milestone rewards.
- **Bloom Pass** — `core/pass.js`: seasonal track with free/premium lanes, XP→tier
  progression, idempotent tier claiming, premium upgrade.
- **Player-to-player trading** — `core/trade.js`: atomic escrow swap with ownership
  & lock checks, solvency checks, and an anti-inflation Petals tax.
- **Constellations (guilds)** — store + API: create/join (≤30 members), collective
  bloom score, leaderboard.

### Added — API
- New endpoints: bloomdex (+claim), pass (+claim/+upgrade), constellations
  (create/join/list/get), trades (create/accept/cancel), Lumi lock. See
  `docs/openapi.yaml` (32 operations).
- Hatching & breeding now share an `onHatch` path (pity bookkeeping, XP/unlocks,
  Bloom Pass XP, constellation contribution).
- Onboarding deepened: starter Lumi + welcome Lumen; player profile now exposes
  Bloom Pass + constellation.

### Added — quality, tooling & proof
- **Balance simulation harness** — `tools/simulate.js`: runs a synthetic population
  through the real core modules and writes `docs/BALANCE-REPORT.md` (faucet/sink
  health, rarity distribution, pity stats, progression pacing, Bloomdex curve).
- **Headless screenshots** — `tools/screenshot.js` (Puppeteer): captures the playable
  prototype; committed montage at `docs/assets/prototype.png` (rendered error-free).
- **OpenAPI spec** — `docs/openapi.yaml` (validated).
- **In-process API integration test** — `test/api.test.js` (server on an ephemeral
  port; exercises daily/quests/bloomdex/breeding/constellations/atomic trade/lock).
- New unit tests: `test/luck.test.js`, `test/bloomdex.test.js`, `test/pass.test.js`,
  `test/trade.test.js`. **Total: 55 passing tests** (was 30).
- CI now also runs the gallery generator and a balance-sim smoke.

### Changed — visual quality
- **Form-distinct procedural rendering**: render spec now carries `form` + appendage
  hints (fins, leaf, ears, wings, arms, antenna) and hover/elongate; both the canvas
  renderer (`web/lumi-render.js`) and the SVG exporter (`tools/render-svg.js`) draw
  each archetype with its own silhouette instead of "same blob, different colour".
  Gallery regenerated (`docs/assets/lumi-gallery.svg`).

### Tuning
- Documented, simulation-driven confirmation that the soft-currency economy sits in
  the healthy faucet/sink band (~1.04) once the elastic cosmetic sink is modelled.

## [0.1.0] — Initial vertical slice
- Deterministic generative Lumi (generation + breeding), two-currency economy with
  source/sink ledger, progression (levels, forgiving daily streaks, deterministic
  quests), garden loop, zero-dependency HTTP API, playable web prototype with
  procedural renderer, validated PostgreSQL schema, and the full production dossier.
