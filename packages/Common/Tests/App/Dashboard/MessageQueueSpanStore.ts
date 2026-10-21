import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import ObjectID from "../../../Types/ObjectID";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";

/*
 * A queue's spans held in memory the way ClickHouse holds them, and the
 * aggregate API answered from them: each request's query EVALUATED against
 * the rows — the queue's key, the window, the kind, the status and every
 * attribute filter the Overview sends — then counted or given a p95, per
 * interval or over the whole window, per service when grouped. So a test
 * asserts what a query COUNTS, not how it is spelled. A query key or an
 * operator the store does not know fails the test instead of matching
 * silently. (The real-ClickHouse suite in App/Tests/Dashboard runs the same
 * queries on ClickHouse itself.)
 *
 * Not a test file itself (no .test. in the name), so jest does not run it.
 */

export interface MessageQueueSpanRow {
  projectId: string;
  // The stored SpanKind string, or null for a span stored without one.
  kind: string | null;
  statusCode: SpanStatus;
  durationMs: number;
  // primaryEntityId: the service that recorded it.
  serviceId: string;
  entityKeys: Array<string>;
  // As ClickHouse keeps them: Map(String, String), every value text.
  attributes: Record<string, string>;
  startTime: Date;
}

// A value as ClickHouse stores it in a Map(String, String): its text.
export function toStoredAttributeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value);
}

export function toStoredAttributes(
  attributes: Record<string, unknown>,
): Record<string, string> {
  const stored: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) {
      continue;
    }
    stored[key] = toStoredAttributeValue(value);
  }
  return stored;
}

interface AggregateRequestLike {
  aggregateBy: {
    query: Record<string, unknown>;
    aggregationType: AggregationType;
    aggregationInterval?: AggregationInterval | undefined;
    groupBy?: Record<string, unknown> | undefined;
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

function textOf(value: unknown): string {
  if (value instanceof ObjectID) {
    return value.toString();
  }
  return String(value);
}

function unknownOperator(where: string, value: unknown): never {
  throw new Error(
    `MessageQueueSpanStore cannot evaluate ${where}: ${JSON.stringify(value)} (${
      (value as { constructor?: { name?: string } } | null)?.constructor
        ?.name || typeof value
    })`,
  );
}

// ClickHouse's attributes['key']: the stored text, "" when the key is absent.
function attributeMatches(
  row: MessageQueueSpanRow,
  key: string,
  condition: unknown,
): boolean {
  const stored: string = row.attributes[key] ?? "";
  if (typeof condition === "string") {
    return stored === condition;
  }
  if (condition instanceof Includes) {
    return (condition.values as Array<unknown>).map(textOf).includes(stored);
  }
  if (condition instanceof IncludesNone) {
    return !(condition.values as Array<unknown>).map(textOf).includes(stored);
  }
  if (condition instanceof GreaterThan) {
    // toFloat64OrNull(attributes['key']) > value: NULL for no number.
    const number: number = stored.trim() === "" ? Number.NaN : Number(stored);
    return Number.isFinite(number) && number > Number(condition.value);
  }
  return unknownOperator(`attributes['${key}']`, condition);
}

export function spanMatchesQuery(
  row: MessageQueueSpanRow,
  query: Record<string, unknown>,
): boolean {
  for (const [key, condition] of Object.entries(query)) {
    if (condition === undefined) {
      continue;
    }
    switch (key) {
      case "projectId":
        if (textOf(condition) !== row.projectId) {
          return false;
        }
        break;
      case "startTime": {
        if (!(condition instanceof InBetween)) {
          return unknownOperator(key, condition);
        }
        const time: number = row.startTime.getTime();
        if (
          time < (condition.startValue as Date).getTime() ||
          time > (condition.endValue as Date).getTime()
        ) {
          return false;
        }
        break;
      }
      case "entityKeys": {
        if (!(condition instanceof Includes)) {
          return unknownOperator(key, condition);
        }
        const keys: Array<string> = (condition.values as Array<unknown>).map(
          textOf,
        );
        if (
          !row.entityKeys.some((entityKey: string): boolean => {
            return keys.includes(entityKey);
          })
        ) {
          return false;
        }
        break;
      }
      case "kind":
        if (typeof condition === "string") {
          if (row.kind !== condition) {
            return false;
          }
        } else if (condition instanceof Includes) {
          if (
            !(condition.values as Array<unknown>)
              .map(textOf)
              .includes(row.kind ?? "")
          ) {
            return false;
          }
        } else {
          return unknownOperator(key, condition);
        }
        break;
      case "statusCode":
        if (Number(condition) !== row.statusCode) {
          return false;
        }
        break;
      case "primaryEntityId": {
        if (!(condition instanceof Includes)) {
          return unknownOperator(key, condition);
        }
        if (
          !(condition.values as Array<unknown>)
            .map(textOf)
            .includes(row.serviceId)
        ) {
          return false;
        }
        break;
      }
      case "attributeKeys": {
        // hasAny(attributeKeys, [...]): the keys the row stores.
        if (!(condition instanceof Includes)) {
          return unknownOperator(key, condition);
        }
        const wanted: Array<string> = (condition.values as Array<unknown>).map(
          textOf,
        );
        if (
          !Object.keys(row.attributes).some((attributeKey: string): boolean => {
            return wanted.includes(attributeKey);
          })
        ) {
          return false;
        }
        break;
      }
      case "attributes": {
        if (!condition || typeof condition !== "object") {
          return unknownOperator(key, condition);
        }
        for (const [attributeKey, attributeCondition] of Object.entries(
          condition as Record<string, unknown>,
        )) {
          if (!attributeMatches(row, attributeKey, attributeCondition)) {
            return false;
          }
        }
        break;
      }
      default:
        return unknownOperator(`the query key "${key}"`, condition);
    }
  }
  return true;
}

// The nearest-rank 95th percentile.
function p95Of(values: Array<number>): number {
  const sorted: Array<number> = [...values].sort((a: number, b: number) => {
    return a - b;
  });
  const index: number = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[index]!;
}

export class MessageQueueSpanStore {
  public rows: Array<MessageQueueSpanRow> = [];
  // Every query the store answered, in order.
  public queries: Array<Record<string, unknown>> = [];

  public add(
    row: Omit<MessageQueueSpanRow, "attributes"> & {
      attributes: Record<string, unknown>;
    },
    copies: number = 1,
  ): void {
    for (let copy: number = 0; copy < copies; copy++) {
      this.rows.push({
        ...row,
        attributes: toStoredAttributes(row.attributes),
        entityKeys: [...row.entityKeys],
      });
    }
  }

  public clear(): void {
    this.rows = [];
    this.queries = [];
  }

  public matching(query: Record<string, unknown>): Array<MessageQueueSpanRow> {
    return this.rows.filter((row: MessageQueueSpanRow): boolean => {
      return spanMatchesQuery(row, query);
    });
  }

  /*
   * One aggregate request answered as the API would: Count or P95 of
   * durationUnixNano (nanoseconds), per interval (the one the API picks for
   * the window) or over the whole window (Total), per service when grouped
   * by primaryEntityId. Groups without a row are not in the answer.
   */
  public aggregate(request: AggregateRequestLike): {
    data: Array<Record<string, unknown>>;
  } {
    const by: AggregateRequestLike["aggregateBy"] = request.aggregateBy;
    this.queries.push(by.query);
    const rows: Array<MessageQueueSpanRow> = this.matching(by.query);

    if (
      by.aggregationType !== AggregationType.Count &&
      by.aggregationType !== AggregationType.P95
    ) {
      return unknownOperator("the aggregation", by.aggregationType);
    }
    const groupKeys: Array<string> = Object.keys(by.groupBy || {});
    if (
      groupKeys.some((key: string): boolean => {
        return key !== "primaryEntityId";
      })
    ) {
      return unknownOperator("the group-by", by.groupBy);
    }
    const byService: boolean = groupKeys.includes("primaryEntityId");

    const intervalMs: number | null =
      by.aggregationInterval === AggregationInterval.Total
        ? null
        : AggregationIntervalUtil.getAggregationIntervalMs(
            AggregationIntervalUtil.getAggregationIntervalForWindow({
              startDate: by.startTimestamp,
              endDate: by.endTimestamp,
              aggregationInterval: by.aggregationInterval,
            }),
          );

    const groups: Map<string, Array<MessageQueueSpanRow>> = new Map();
    for (const row of rows) {
      const bucket: number =
        intervalMs === null
          ? by.startTimestamp.getTime()
          : Math.floor(row.startTime.getTime() / intervalMs) * intervalMs;
      const groupKey: string = `${bucket}|${byService ? row.serviceId : ""}`;
      const group: Array<MessageQueueSpanRow> = groups.get(groupKey) || [];
      group.push(row);
      groups.set(groupKey, group);
    }

    const data: Array<Record<string, unknown>> = [];
    for (const [groupKey, group] of groups) {
      const [bucket, serviceId] = groupKey.split("|") as [string, string];
      const entry: Record<string, unknown> = {
        timestamp: new Date(Number(bucket)),
        value:
          by.aggregationType === AggregationType.Count
            ? group.length
            : p95Of(
                group.map((row: MessageQueueSpanRow): number => {
                  return Math.round(row.durationMs * 1_000_000);
                }),
              ),
      };
      if (byService) {
        entry["primaryEntityId"] = serviceId;
      }
      data.push(entry);
    }
    // Newest first, as the API sorts them.
    data.sort(
      (a: Record<string, unknown>, b: Record<string, unknown>): number => {
        return (
          (b["timestamp"] as Date).getTime() -
          (a["timestamp"] as Date).getTime()
        );
      },
    );
    return { data: data };
  }
}
