# Changelog

All notable changes to the LUMORA prototype are documented here.

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
