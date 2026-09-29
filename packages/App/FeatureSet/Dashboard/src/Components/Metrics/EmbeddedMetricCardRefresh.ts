import React from "react";

/*
 * How many times the reader has pressed Refresh on the EmbeddedMetricCard
 * around a chart (0 outside a card).
 *
 * The card's window alone cannot tell the charts it renders to reload: a
 * Custom window, and every zoom is one, re-resolves to the very same
 * instants, so a chart that fetches on its window ignored Refresh and kept
 * an error it could otherwise have retried. A chart that fetches its own
 * data inside a card (the client-side rate charts, the network throughput
 * chart) adds this to its fetch effect's dependencies.
 */
export const EmbeddedMetricCardRefreshContext: React.Context<number> =
  React.createContext<number>(0);

export function useEmbeddedMetricCardRefreshNonce(): number {
  return React.useContext(EmbeddedMetricCardRefreshContext);
}
