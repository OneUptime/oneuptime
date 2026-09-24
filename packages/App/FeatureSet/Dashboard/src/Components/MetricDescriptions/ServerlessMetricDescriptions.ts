/*
 * What each number on the Serverless function overview means, in plain
 * words. Shown in the (i) tooltip beside a tile or chart title.
 *
 * Each text describes what the page actually computes, not what the title
 * suggests:
 *   - "Invocations" counts every span whose resource carries this
 *     function's faas.name, child and outgoing-call spans included, so it is
 *     an upper bound on the invocation count;
 *   - "p95 duration" on the tile is the average of the per-interval p95s;
 *   - "Instances" is the list the cleanup job keeps, not a count bounded by
 *     the time picker: the job only prunes while the function is connected,
 *     dropping an environment once it is 15 minutes behind the function's
 *     own lastSeenAt (Workers/Jobs/Serverless/CleanupStaleResources.ts).
 * Change the fetch, change the words.
 */

export type ServerlessMetric =
  | "invocations"
  | "errorRate"
  | "p95Duration"
  | "instances"
  | "invocationsChart"
  | "p95DurationChart";

export const SERVERLESS_METRIC_DESCRIPTIONS: Record<ServerlessMetric, string> =
  {
    invocations:
      "Spans recorded for this function (matched by its faas.name attribute) in the selected range. An invocation usually produces one span, plus more for the database and service calls it makes, so this can be higher than the true invocation count.",
    errorRate:
      "The share of this function's spans in the selected range whose status was set to Error; the line below is how many errored. The bar turns amber at 1% and red at 5%.",
    p95Duration:
      "p95 means the 95th percentile: 95% of this function's spans (not only whole invocations) finished faster than this and the slowest 5% took longer. Worked out per interval, then averaged over the selected range.",
    instances:
      "Warm copies of this function's runtime (faas.instance) on record, whatever the selected range. One that stops reporting is dropped about 15 minutes later by default while the function keeps reporting; an idle function keeps its last list.",
    invocationsChart:
      "Spans recorded for this function in each interval, with the ones whose status was Error as a second line. One invocation can produce several spans.",
    p95DurationChart:
      "The 95th percentile span duration in each interval: 95% of this function's spans in that interval finished faster than the line. A spike means some invocations were much slower than usual.",
  };
