// @ts-check
/**
 * Player-to-player trading — atomic escrow swap with anti-inflation tax.
 *
 * The rarity of generated Lumi creates natural supply/demand (lineages, mutations,
 * elements), so a healthy trade economy is a strong engagement & retention driver
 * (docs/05-SOCIAL.md, docs/07-ECONOMY.md). Because no Lumi grants combat power,
 * this market stays expressive rather than pay-to-win.
 *
 * Safety properties enforced here:
 *  - Atomicity: we VALIDATE everything first, then APPLY; a failure mutates nothing.
 *  - Ownership & locks: you can only trade Lumi you own and haven't locked.
 *  - Solvency: petals offered must exist; a trade tax (a petals sink) curbs inflation
 *    and bot-churn.
 */

import { EconomyError, debit } from './economy.js';

/** Trade tax: a flat base + per-Lumi fee, charged to the initiator (a petals sink). */
export const TRADE_TAX = { base: 100, perLumi: 25 };

/** @param {{offerLumi?:string[], requestLumi?:string[]}} t */
export function tradeTax(t) {
  const count = (t.offerLumi?.length || 0) + (t.requestLumi?.length || 0);
  return TRADE_TAX.base + TRADE_TAX.perLumi * count;
}

/**
 * Validate a proposed trade without applying it. Throws a typed error on any issue.
 * @param {object} from  initiator player ({collection, wallet})
 * @param {object} to    counterparty player
 * @param {{offerLumi?:string[], offerPetals?:number, requestLumi?:string[]}} t
 */
export function validateTrade(from, to, t) {
  // Type guards: a malformed offer must be a clean 4xx, never iterate a string as
  // if it were a list of Lumi ids.
  if (t.offerLumi != null && !Array.isArray(t.offerLumi)) throw new EconomyError('BAD_OFFER', 'offerLumi must be an array');
  if (t.requestLumi != null && !Array.isArray(t.requestLumi)) throw new EconomyError('BAD_OFFER', 'requestLumi must be an array');
  if (t.offerPetals != null && (!Number.isInteger(t.offerPetals) || t.offerPetals < 0)) {
    throw new EconomyError('BAD_OFFER', 'offerPetals must be a non-negative integer');
  }
  const offerLumi = t.offerLumi || [];
  const requestLumi = t.requestLumi || [];
  const offerPetals = t.offerPetals || 0;

  if (from.id === to.id) throw new EconomyError('SELF_TRADE', 'Cannot trade with yourself');
  if (offerLumi.length + requestLumi.length === 0 && offerPetals === 0) {
    throw new EconomyError('EMPTY_TRADE', 'A trade must move something');
  }

  const fromOwns = ownByUid(from.collection);
  const toOwns = ownByUid(to.collection);

  for (const uid of offerLumi) {
    const l = fromOwns.get(uid);
    if (!l) throw new EconomyError('NOT_OWNED', `Initiator does not own ${uid}`);
    if (l.locked) throw new EconomyError('LOCKED', `${l.name} is locked`);
  }
  for (const uid of requestLumi) {
    const l = toOwns.get(uid);
    if (!l) throw new EconomyError('NOT_OWNED', `Counterparty does not own ${uid}`);
    if (l.locked) throw new EconomyError('LOCKED', `${l.name} is locked`);
  }

  const tax = tradeTax(t);
  if (from.wallet.petals < offerPetals + tax) {
    throw new EconomyError('INSUFFICIENT_FUNDS', `Need ${offerPetals + tax} petals (incl. ${tax} tax)`);
  }
  return { tax, offerLumi, requestLumi, offerPetals };
}

/**
 * Execute the trade atomically (validates first). Moves Lumi between collections,
 * transfers petals, and burns the tax. Both players' ledgers are appended.
 * @returns {{tax:number, moved:{toCounterparty:string[], toInitiator:string[]}, petals:number}}
 */
export function executeTrade(from, to, t) {
  const v = validateTrade(from, to, t); // throws if invalid → nothing mutated

  // 1) Burn tax + move offered petals from initiator.
  debit(from.wallet, 'petals', v.tax, 'trade_tax', from.ledger);
  if (v.offerPetals > 0) {
    debit(from.wallet, 'petals', v.offerPetals, 'trade_petals_out', from.ledger);
    to.wallet.petals += v.offerPetals;
    to.ledger.push({ t: Date.now(), currency: 'petals', delta: v.offerPetals, reason: 'trade_petals_in', kind: 'source' });
  }

  // 2) Swap Lumi ownership.
  const offered = pluck(from.collection, v.offerLumi);
  const requested = pluck(to.collection, v.requestLumi);
  for (const l of offered) to.collection.push(l);
  for (const l of requested) from.collection.push(l);

  return {
    tax: v.tax,
    petals: v.offerPetals,
    moved: { toCounterparty: v.offerLumi, toInitiator: v.requestLumi },
  };
}

function ownByUid(collection) {
  return new Map(collection.map((l) => [l.uid, l]));
}

/** Remove and return the Lumi with the given uids from a collection (in place). */
function pluck(collection, uids) {
  const set = new Set(uids);
  const taken = [];
  for (let i = collection.length - 1; i >= 0; i--) {
    if (set.has(collection[i].uid)) taken.push(collection.splice(i, 1)[0]);
  }
  return taken;
}
