/*
 * The public pay-as-you-go rates, as advertised on
 * https://oneuptime.com/pricing.
 *
 * These live in Types (and not next to the metered plans, which are
 * server-only) because two very different places need the same numbers: the
 * server meters and bills against them, and the dashboard has to tell a Free
 * plan user what they are about to be charged before they commit to it. A
 * price quoted in the product that disagrees with the price on the invoice is
 * worse than quoting no price at all, so there is exactly one copy.
 */

// Telemetry ingest - logs, traces, metrics and profiles.
export const TELEMETRY_PRICE_IN_USD_PER_GB: number = 0.1;

/*
 * Session replay recordings travel on the same ingestion key as the rest of
 * telemetry but are priced well above it, on purpose - see
 * SessionReplayDataIngestMeteredPlan. Anything that quotes "what this key
 * costs" has to say both numbers, or it is quoting a rate 20x below what a
 * replay-heavy project will actually be invoiced.
 */
export const SESSION_REPLAY_PRICE_IN_USD_PER_GB: number = 2;

// The retention the per-GB telemetry prices above are quoted for.
export const TELEMETRY_PRICE_RETENTION_IN_DAYS: number = 15;

/*
 * Active monitoring. Every monitor except a Manual one is an active monitor -
 * see MonitorTypeHelper.isBilledAsActiveMonitor.
 */
export const ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH: number = 1;

export const PRICING_PAGE_URL: string = "https://oneuptime.com/pricing";

/**
 * Money as the pricing page writes it: `$1` rather than `$1.00`, but `$0.10`
 * rather than `$0.1`. In-app copy that quotes a rate should read exactly like
 * the page the user will check it against.
 */
export function formatPriceInUSD(amountInUSD: number): string {
  if (Number.isInteger(amountInUSD)) {
    return `$${amountInUSD}`;
  }

  return `$${amountInUSD.toFixed(2)}`;
}
