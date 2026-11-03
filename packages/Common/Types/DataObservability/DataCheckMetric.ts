/*
 * THE METRIC EVERY DATA CHECK WRITES.
 *
 * One row per check per run - one per segment for a segmented check - in
 * the same metric table as table health, with the check, its table and its
 * segment as attributes. A Metrics monitor filtered on the check's id and
 * grouped by segment alerts once per segment, with a learned baseline or a
 * threshold, like any other.
 */
export const DATA_CHECK_METRIC_NAME: string = "oneuptime.data.check.value";

export const DataCheckAttribute: {
  readonly CheckId: string;
  readonly CheckName: string;
  readonly CheckType: string;
  readonly Segment: string;
} = {
  CheckId: "oneuptime.data.check.id",
  CheckName: "oneuptime.data.check.name",
  CheckType: "oneuptime.data.check.type",
  // The segment column's value, for a segmented check; absent otherwise.
  Segment: "oneuptime.data.check.segment",
};

// The longest segment value kept: a tenant id or a region, not a document.
export const MAX_SEGMENT_VALUE_LENGTH: number = 200;
