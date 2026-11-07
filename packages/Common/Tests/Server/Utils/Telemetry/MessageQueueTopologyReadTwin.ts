import {
  MESSAGE_QUEUE_TOPOLOGY_GROUPS,
  MessageQueueTopologyGroupFigures,
  MessageQueueTopologyKeys,
  MessageQueueTopologyPairRow,
  MessageQueueTopologyWindow,
} from "../../../../Server/Utils/Telemetry/MessageQueueTopology";
import { TelemetryServiceFilter } from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import { SpanStatus } from "../../../../Models/AnalyticsModels/Span";
import ObjectID from "../../../../Types/ObjectID";
import {
  getMessageQueueSpanPopulationFilter,
  isMessageQueueSpanPopulationRead,
} from "../../../../Types/MessageQueue/MessageQueueSpanPopulation";
import {
  MessageQueueSpanRow,
  spanMatchesQuery,
} from "../../../App/Dashboard/MessageQueueSpanStore";

/*
 * The Queues topology's read (buildMessageQueueTopologyStatement) in
 * TypeScript, with its semantics: the window, the project and the keys as
 * the Overview's base filter reads them, the key array joined out (a span
 * is counted once under each of the project's queue keys it carries), the
 * read scope's services, and per (queue key, service) every span, the
 * failed ones, and each group's spans, failed spans and p95 - a group
 * matched with the Overview's own filter for the queue's system, and only
 * where that system reads the group at all.
 *
 * Two suites hold it, as MessageQueueSpanQueryTwin is held: the unit suite
 * holds the topology built from it to the Overview's cards and tiles, read
 * through the in-memory span store (MessageQueueTopologyOverviewParity),
 * and the real-ClickHouse suite holds the statement to it
 * (App/Tests/Dashboard/MessageQueueTopologyClickhouse).
 *
 * A p95 is the nearest-rank percentile of the durations in whole
 * nanoseconds (durationUnixNano), read back in milliseconds, as the span
 * store answers the Overview's P95 requests.
 *
 * Not a test file itself (no .test. in the name), so jest does not run it.
 */

function p95Of(values: ReadonlyArray<number>): number {
  const sorted: Array<number> = [...values].sort((a: number, b: number) => {
    return a - b;
  });
  return sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)]!;
}

function idText(value: ObjectID | string): string {
  return value.toString().toLowerCase();
}

function inScope(row: MessageQueueSpanRow, filter: TelemetryServiceFilter): boolean {
  const service: string = row.serviceId.toLowerCase();
  if (
    filter.serviceIds &&
    filter.serviceIds.length > 0 &&
    !filter.serviceIds.map(idText).includes(service)
  ) {
    return false;
  }
  if (
    filter.excludedServiceIds &&
    filter.excludedServiceIds.map(idText).includes(service)
  ) {
    return false;
  }
  return true;
}

interface PairState {
  queueKey: string;
  serviceId: string;
  spans: number;
  errors: number;
  groups: Map<string, { count: number; errors: number; durations: Array<number> }>;
}

export function readMessageQueueTopologyTwin(data: {
  rows: ReadonlyArray<MessageQueueSpanRow>;
  projectId: string;
  keys: MessageQueueTopologyKeys;
  window: MessageQueueTopologyWindow;
  serviceFilter?: TelemetryServiceFilter | undefined;
}): Array<MessageQueueTopologyPairRow> {
  const keySet: Set<string> = new Set<string>(data.keys.keys);
  const pairs: Map<string, PairState> = new Map<string, PairState>();

  for (const row of data.rows) {
    if (row.projectId !== data.projectId) {
      continue;
    }
    const time: number = row.startTime.getTime();
    if (
      time < data.window.startTime.getTime() ||
      time > data.window.endTime.getTime()
    ) {
      continue;
    }
    if (data.serviceFilter && !inScope(row, data.serviceFilter)) {
      continue;
    }
    for (const queueKey of row.entityKeys) {
      if (!keySet.has(queueKey)) {
        continue;
      }
      const system: string = data.keys.systemByKey.get(queueKey) || "";
      const id: string = `${queueKey}|${row.serviceId}`;
      let pair: PairState | undefined = pairs.get(id);
      if (!pair) {
        pair = {
          queueKey: queueKey,
          serviceId: row.serviceId,
          spans: 0,
          errors: 0,
          groups: new Map(),
        };
        pairs.set(id, pair);
      }
      const failed: boolean = row.statusCode === SpanStatus.Error;
      pair.spans += 1;
      pair.errors += failed ? 1 : 0;
      for (const population of MESSAGE_QUEUE_TOPOLOGY_GROUPS) {
        if (
          !isMessageQueueSpanPopulationRead(population, system) ||
          !spanMatchesQuery(
            row,
            getMessageQueueSpanPopulationFilter(population, system),
          )
        ) {
          continue;
        }
        const group: { count: number; errors: number; durations: Array<number> } =
          pair.groups.get(population) || { count: 0, errors: 0, durations: [] };
        group.count += 1;
        group.errors += failed ? 1 : 0;
        group.durations.push(Math.round(row.durationMs * 1_000_000));
        pair.groups.set(population, group);
      }
    }
  }

  return Array.from(pairs.values())
    .sort((a: PairState, b: PairState): number => {
      return (
        b.spans - a.spans ||
        a.queueKey.localeCompare(b.queueKey) ||
        a.serviceId.localeCompare(b.serviceId)
      );
    })
    .map((pair: PairState): MessageQueueTopologyPairRow => {
      const groups: Record<string, MessageQueueTopologyGroupFigures> = {};
      for (const population of MESSAGE_QUEUE_TOPOLOGY_GROUPS) {
        const group:
          | { count: number; errors: number; durations: Array<number> }
          | undefined = pair.groups.get(population);
        groups[population] = group
          ? {
              count: group.count,
              errors: group.errors,
              p95Ms: p95Of(group.durations) / 1_000_000,
            }
          : { count: 0, errors: 0, p95Ms: null };
      }
      return {
        queueKey: pair.queueKey,
        serviceId: pair.serviceId,
        spans: pair.spans,
        errors: pair.errors,
        groups: groups,
      };
    });
}
