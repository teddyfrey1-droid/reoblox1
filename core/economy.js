// @ts-check
/**
 * Economy engine: wallets, validated transactions, and the source/sink ledger.
 *
 * Principles baked into this code (see docs/07-ECONOMY.md):
 *  - Two currencies: Petals (soft, earned) and Lumen (premium). Functions here are
 *    currency-agnostic so the same rules apply to both.
 *  - Every mutation goes through `credit`/`debit` which (a) clamp to caps, (b) refuse
 *    to overspend, and (c) emit a ledger entry tagged with a reason. That ledger is
 *    the raw material for live-ops dashboards (faucet/sink ratio, where money goes).
 *  - No silent failures: an invalid purchase throws a typed error the API maps to 4xx.
 */

import { CURRENCIES, byId } from './content.js';

export class EconomyError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'EconomyError';
    this.code = code;
    this.status = 400; // economy faults are always client errors (4xx), never 500
  }
}

/** Create an empty wallet with both currencies at zero. */
export function createWallet() {
  return { petals: 0, lumen: 0 };
}

/**
 * @typedef {Object} LedgerEntry
 * @property {number} t        epoch ms
 * @property {string} currency
 * @property {number} delta    signed amount actually applied
 * @property {string} reason   e.g. 'daily_reward', 'shop:plant:dewbud', 'sink:plot'
 * @property {('source'|'sink')} kind
 */

/**
 * Credit currency into a wallet, clamped to the currency hard cap.
 * @param {{petals:number, lumen:number}} wallet
 * @param {'petals'|'lumen'} currency
 * @param {number} amount  must be >= 0
 * @param {string} reason
 * @param {LedgerEntry[]} [ledger]
 * @returns {number} amount actually credited (may be < amount if capped)
 */
export function credit(wallet, currency, amount, reason, ledger) {
  if (amount < 0) throw new EconomyError('NEGATIVE_CREDIT', 'Cannot credit a negative amount');
  const cap = CURRENCIES[currency].hardCap;
  const before = wallet[currency];
  const after = Math.min(cap, before + amount);
  wallet[currency] = after;
  const applied = after - before;
  if (ledger) ledger.push({ t: Date.now(), currency, delta: applied, reason, kind: 'source' });
  return applied;
}

/**
 * Debit currency, refusing to go negative.
 * @param {{petals:number, lumen:number}} wallet
 * @param {'petals'|'lumen'} currency
 * @param {number} amount  must be >= 0
 * @param {string} reason
 * @param {LedgerEntry[]} [ledger]
 */
export function debit(wallet, currency, amount, reason, ledger) {
  if (amount < 0) throw new EconomyError('NEGATIVE_DEBIT', 'Cannot debit a negative amount');
  if (wallet[currency] < amount) {
    throw new EconomyError('INSUFFICIENT_FUNDS', `Need ${amount} ${currency}, have ${wallet[currency]}`);
  }
  wallet[currency] -= amount;
  if (ledger) ledger.push({ t: Date.now(), currency, delta: -amount, reason, kind: 'sink' });
  return amount;
}

/**
 * Apply a cost object like {petals: 120} or {lumen: 18}, atomically.
 * @param {{petals:number, lumen:number}} wallet
 * @param {{petals?:number, lumen?:number}} cost
 * @param {string} reason
 * @param {LedgerEntry[]} [ledger]
 */
export function pay(wallet, cost, reason, ledger) {
  // Pre-check both currencies so we never half-charge.
  for (const cur of /** @type {const} */ (['petals', 'lumen'])) {
    const need = cost[cur] || 0;
    if (need > 0 && wallet[cur] < need) {
      throw new EconomyError('INSUFFICIENT_FUNDS', `Need ${need} ${cur}, have ${wallet[cur]}`);
    }
  }
  for (const cur of /** @type {const} */ (['petals', 'lumen'])) {
    const need = cost[cur] || 0;
    if (need > 0) debit(wallet, cur, need, reason, ledger);
  }
}

/**
 * Reward grant helper used by daily rewards, quests, pass tiers, etc.
 * @param {{petals:number, lumen:number}} wallet
 * @param {{petals?:number, lumen?:number}} reward
 * @param {string} reason
 * @param {LedgerEntry[]} [ledger]
 */
export function grant(wallet, reward, reason, ledger) {
  const applied = { petals: 0, lumen: 0 };
  if (reward.petals) applied.petals = credit(wallet, 'petals', reward.petals, reason, ledger);
  if (reward.lumen) applied.lumen = credit(wallet, 'lumen', reward.lumen, reason, ledger);
  return applied;
}

/**
 * Purchase a catalog item by kind+id. Returns the item definition on success.
 * Centralising purchases here means the shop, the API and tests all share one
 * validated path (single source of truth for pricing & affordability).
 * @param {{petals:number, lumen:number}} wallet
 * @param {'plant'|'decor'|'biome'} kind
 * @param {string} id
 * @param {LedgerEntry[]} [ledger]
 */
export function purchase(wallet, kind, id, ledger) {
  const def = kind === 'biome' ? byId.biome(id) : kind === 'plant' ? byId.plant(id) : byId.decor(id);
  if (!def) throw new EconomyError('UNKNOWN_ITEM', `No ${kind} with id "${id}"`);
  const cost = kind === 'biome' ? def.unlock : def.cost;
  pay(wallet, cost, `shop:${kind}:${id}`, ledger);
  return def;
}

/**
 * Analyse a ledger into a faucet/sink report. This is exactly the metric live-ops
 * watches to detect inflation: if sources >> sinks over time, soft currency loses
 * value and we must add sinks (new decor, expansions) or trim faucets.
 * @param {LedgerEntry[]} ledger
 */
export function faucetSinkReport(ledger) {
  const report = {
    petals: { source: 0, sink: 0 },
    lumen: { source: 0, sink: 0 },
    byReason: /** @type {Record<string, number>} */ ({}),
  };
  for (const e of ledger) {
    const bucket = report[e.currency];
    if (e.kind === 'source') bucket.source += e.delta;
    else bucket.sink += -e.delta;
    report.byReason[e.reason] = (report.byReason[e.reason] || 0) + e.delta;
  }
  // Health ratio > 1 means we are minting more than we burn (watch for inflation).
  report.petalsFaucetSinkRatio = report.petals.sink === 0
    ? Infinity
    : +(report.petals.source / report.petals.sink).toFixed(3);
  return report;
}
