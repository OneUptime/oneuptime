enum AnalyticsTableEngine {
  MergeTree = "MergeTree",
  ReplacingMergeTree = "ReplacingMergeTree",
  /*
   * Target-table engine for materialized views that store
   * AggregateFunction states. Background merges combine partial state
   * rows into a single state per sort-key tuple; reads finalize via
   * `*Merge` functions (e.g. `stddevPopMerge(stddevState)`).
   */
  AggregatingMergeTree = "AggregatingMergeTree",
}

export default AnalyticsTableEngine;
