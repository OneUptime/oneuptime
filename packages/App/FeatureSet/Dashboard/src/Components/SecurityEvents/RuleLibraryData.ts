import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { SecurityEventKindsSeen } from "Common/Types/SecurityEvent/DetectionRuleDataKind";

/*
 * What security events a project sends, as the Rule Library reads it to
 * say beside each rule whether its events arrive: the classes, vendors and
 * products of the events stored in the last week, in one grouped count over
 * the generic aggregate route (the read the Security Events explorer's
 * facets make, under the same read permissions and owned-scope narrowing).
 *
 * A week: long enough that a source sending only now and then still counts,
 * short enough that a source that stopped sending does not.
 *
 * React-free, so the query and the reading of its answer are pinned in
 * plain tests.
 */

export const RULE_LIBRARY_DATA_WINDOW_IN_DAYS: number = 7;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

/*
 * The most combinations of class, vendor and product read. A project sends
 * a few dozen; the busiest first, should one ever send more.
 */
export const RULE_LIBRARY_DATA_GROUP_LIMIT: number = 500;

export function buildSecurityEventKindsAggregateBy(data: {
  projectId: ObjectID;
  now: Date;
}): AggregateBy<SecurityEvent> {
  return {
    query: { projectId: data.projectId } as Query<SecurityEvent>,
    aggregationType: AggregationType.Count,
    // Never empty (a '' default), so its count is the row count.
    aggregateColumnName: "eventUid",
    aggregationTimestampColumnName: "time",
    // One row per combination over the whole window, not per time bucket.
    aggregationInterval: AggregationInterval.Total,
    startTimestamp: new Date(
      data.now.getTime() - RULE_LIBRARY_DATA_WINDOW_IN_DAYS * DAY_IN_MS,
    ),
    endTimestamp: data.now,
    groupBy: {
      className: true,
      vendorName: true,
      productName: true,
    } as AggregateBy<SecurityEvent>["groupBy"],
    limit: RULE_LIBRARY_DATA_GROUP_LIMIT,
    skip: 0,
    // Under Total the count is aliased onto eventUid: the busiest first.
    sort: { eventUid: SortOrder.Descending },
  };
}

function readText(row: AggregatedModel, key: string): string {
  const value: unknown = (row as Record<string, unknown>)[key];

  return typeof value === "string" ? value.trim() : "";
}

function addOnce(list: Array<string>, value: string): void {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

/*
 * The aggregate's rows as what the project sends: each class, vendor and
 * product with at least one event. An empty value is a source that did not
 * say, and says nothing here either.
 */
export function readSecurityEventKindsSeen(
  rows: ReadonlyArray<AggregatedModel>,
): SecurityEventKindsSeen {
  const classNames: Array<string> = [];
  const vendorNames: Array<string> = [];
  const productNames: Array<string> = [];

  for (const row of rows) {
    const count: number = Number(row.value);

    if (!Number.isFinite(count) || count <= 0) {
      continue;
    }

    addOnce(classNames, readText(row, "className"));
    addOnce(vendorNames, readText(row, "vendorName"));
    addOnce(productNames, readText(row, "productName"));
  }

  return { classNames, vendorNames, productNames };
}
