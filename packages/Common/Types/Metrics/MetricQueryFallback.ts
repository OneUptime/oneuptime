import type MetricQueryConfigData from "./MetricQueryConfigData";

/*
 * A query a chart draws in another query's place when that one has no data
 * in the window.
 *
 * Made for a metric that newer agents send and older ones do not: the
 * Kubernetes dashboard's restarts chart reads the restarts per interval
 * (k8s.container.restarts.increase, which kubernetes-agent sends from chart
 * 0.7.1) and falls back to the running count every agent sends
 * (k8s.container.restarts). An agent that is upgraded gets the better chart
 * without anyone editing the dashboard, and one that is not still gets a
 * chart instead of "No data".
 *
 *   - The main query's own result decides: it is drawn whenever it has a
 *     point in the window, and its fallback only when it has none
 *     (Common/Utils/Metrics/MetricQueryFallback).
 *   - When the fallback has no data either, the chart draws the main query,
 *     empty, as it would without a fallback.
 *   - The fallback is drawn in the main query's slot, under the main query's
 *     variable, so formulas over that variable read whatever is drawn.
 *   - Opt-in: a query without a fallback is fetched and drawn exactly as
 *     before, with no second request.
 *
 * Plain persisted data, like the rest of MetricQueryConfigData. The
 * Dashboard's Chart widget draws it; other readers of a query (monitors, the
 * metric explorer) ignore it.
 */
export interface MetricQueryFallbackHint {
  /*
   * What the reader should know while the fallback is drawn, in one short
   * sentence ("Older Kubernetes agents send only the running restart
   * count."). An English key: the chart looks it up, so a hint a template
   * ships reads in the reader's language, and any other text reads as
   * written.
   */
  text: string;
  // The words of the link after the text, an English key like the text.
  linkText?: string | undefined;
  // Where the link goes, such as a docs page: "/docs/...".
  linkUrl?: string | undefined;
}

export default interface MetricQueryFallback {
  /*
   * The query drawn in the main query's place. Its own legend says which of
   * the two the chart is showing.
   */
  queryConfig: MetricQueryConfigData;
  // Shown with the chart while it draws the fallback.
  hint?: MetricQueryFallbackHint | undefined;
}
