import AggregatedModel from "./AggregatedModel";

export default interface AggregatedResult {
  data: Array<AggregatedModel>;
  /**
   * Total number of distinct groups matching the query window, counted
   * in the Top-K ranking phase. Only present for grouped aggregations
   * executed with `AggregateBy.topK`; compare against `topK.count` to
   * know how many series were left out.
   */
  totalGroups?: number | undefined;
  /**
   * True when the result is known (or heuristically likely) to be
   * incomplete: the row count hit the applied LIMIT, or Top-K dropped
   * groups (`totalGroups > topK.count`). Additive — absent/false means
   * the window was fully served.
   */
  truncated?: boolean | undefined;
  /**
   * Human-readable reason this result carries no data — e.g. a metric
   * formula that failed structural validation (bad syntax, unknown
   * variable, disjoint groups). Only set by client-side evaluation
   * layers; never returned by the server. Chart layers should render it
   * in place of the empty chart instead of showing a silent "no data".
   */
  errorMessage?: string | undefined;
}
