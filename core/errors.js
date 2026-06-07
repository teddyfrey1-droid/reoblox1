// @ts-check
/**
 * Typed domain error for client-fault conditions (invalid move, bad input, etc.).
 *
 * Carrying a `status` lets the HTTP layer return the correct 4xx automatically
 * instead of mislabelling a player mistake as a 500 server error (which pollutes
 * error budgets / on-call alerts). The message is preserved for the client.
 */
export class GameError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'GameError';
    this.code = code;
    this.status = status;
  }
}
