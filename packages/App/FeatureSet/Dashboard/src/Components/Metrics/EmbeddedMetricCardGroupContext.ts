import React from "react";
import { MetricResultsState } from "./Utils/MetricResultsState";

/*
 * How an EmbeddedMetricCard talks to the EmbeddedMetricCardGroup around it
 * (null outside a group): it reports what its charts have to show, leaves
 * when it unmounts, and reloads when the group checks again.
 */
export interface EmbeddedMetricCardGroupContextValue {
  // The card `memberId` now has `state` to show.
  report: (memberId: string, state: MetricResultsState) => void;
  // The card `memberId` is gone.
  remove: (memberId: string) => void;
  /*
   * How many times the group has checked again. A card adds it to its own
   * refresh count, so its queries run again past the result cache even when
   * the window has not moved.
   */
  refreshNonce: number;
}

export const EmbeddedMetricCardGroupContext: React.Context<EmbeddedMetricCardGroupContextValue | null> =
  React.createContext<EmbeddedMetricCardGroupContextValue | null>(null);

export function useEmbeddedMetricCardGroup(): EmbeddedMetricCardGroupContextValue | null {
  return React.useContext(EmbeddedMetricCardGroupContext);
}
