import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import StatementGenerator from "../AnalyticsDatabase/StatementGenerator";
import {
  INTERACTIVE_READ_TIME_LIMIT,
  getQuerySettings,
} from "../AnalyticsDatabase/QuerySettingsHelper";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "./TelemetryReadScope";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  MessageQueueIdentity,
  parseMessageQueueIdentifier,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import {
  MessageQueueProducerServices,
  MessageQueueServiceFigures,
  MessageQueueServiceFiguresList,
  MessageQueueServiceSpanFigures,
  MessageQueueSpanPopulation,
  combineMessageQueueConsumerServices,
  combineMessageQueueProducerServices,
  emptyMessageQueueServiceSpanFigures,
  getMessageQueueSpanPopulationFilter,
  isMessageQueueSpanPopulationRead,
} from "../../../Types/MessageQueue/MessageQueueSpanPopulation";
import {
  MESSAGE_QUEUE_TOPOLOGY_MAX_RANGE_MS,
  MessageQueueTopologyFlow,
  MessageQueueTopologyQueue,
  MessageQueueTopologyResponse,
  MessageQueueTopologyService,
  MessageQueueTopologyTruncation,
} from "../../../Types/MessageQueue/MessageQueueTopology";
import { keyForMessageQueue } from "../../../Utils/Telemetry/EntityKey";

/*
 * THE QUEUES TOPOLOGY'S READ (POST /telemetry/message-queues/topology): the
 * statement, and how its rows become the map. Pure - it builds a statement
 * and reads rows, and runs nothing - so the suites hold every query and
 * every number without a database. MessageQueueTopologyService runs it.
 *
 * A queue's spans are the spans that carry its entity key: ingest stamps
 * keyForMessageQueue(project, identity) on every messaging span that
 * resolves to the queue, and the queue's Overview reads its spans by that
 * key alone (Dashboard MessageQueueTelemetryScope). The topology reads every
 * live queue's spans at once: one GROUP BY over the window's spans that
 * carry any of the project's queue keys, by (queue key, service), with the
 * key array joined out so each span is counted under the queue it names.
 *
 * What a row counts is what the queue's Producers and Consumers cards count,
 * by construction: every group of spans (publish, send, awsSend, consume,
 * receivedBatch - MessageQueueSpanPopulation) is the Overview's own filter,
 * compiled by the same query builder the Overview's aggregate requests are
 * compiled by, and the rows of each queue are combined by the cards' own
 * functions (combineMessageQueueProducerServices / ...ConsumerServices). A
 * group whose filter depends on the queue's system (SQS reads its receive
 * spans apart) is compiled once per distinct filter, each over the keys of
 * the queues whose system reads it so; a system that does not read a group
 * at all (awsSend outside SQS and SNS) adds none of its spans to it. So the
 * map's line from a service to a queue says exactly what that service's row
 * on the queue's Overview says, over the same range.
 *
 * The caller's read scope narrows the services as every telemetry read does
 * (TelemetryReadScopeUtil.appendServiceFilter): a service they may not read
 * is in no row. The queues come from Postgres, read with the caller's props.
 */

const SPAN_TABLE: string = AnalyticsTableName.Span;

/*
 * Rows past their retention are left out, as every aggregate read leaves
 * them out (AnalyticsDatabaseService.getRetentionReadFilter).
 */
const RETENTION_FILTER: string = " AND retentionDate >= now()";

const NANOSECONDS_PER_MILLISECOND: number = 1_000_000;

// The range when the request names none: the last hour.
export const MESSAGE_QUEUE_TOPOLOGY_DEFAULT_RANGE_MS: number = 60 * 60 * 1000;

// The groups a row reads beside "all", in the order its columns are named.
export const MESSAGE_QUEUE_TOPOLOGY_GROUPS: ReadonlyArray<MessageQueueSpanPopulation> =
  ["publish", "send", "awsSend", "consume", "receivedBatch"];

export interface MessageQueueTopologyWindow {
  startTime: Date;
  endTime: Date;
}

/*
 * An edge of the range from a request body: an ISO date string, or nothing
 * (undefined, null or ""). Anything else is refused, so a broken range is
 * answered with the reason rather than with a query ClickHouse cannot run.
 */
function readWindowEdge(value: unknown, name: string): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !Number.isFinite(Date.parse(value.trim()))) {
    throw new BadDataException(`${name} must be a date`);
  }

  const date: Date = OneUptimeDate.fromString(value);

  if (!Number.isFinite(date.getTime())) {
    throw new BadDataException(`${name} must be a date`);
  }

  return date;
}

/**
 * The range read: the one asked for, the hour before its end when it names
 * no start, ending now when it names no end. A start after its end, or a
 * range wider than MESSAGE_QUEUE_TOPOLOGY_MAX_RANGE_MS, is refused.
 */
export function resolveMessageQueueTopologyWindow(data: {
  startTime: unknown;
  endTime: unknown;
  now: Date;
}): MessageQueueTopologyWindow {
  const requestedStart: Date | null = readWindowEdge(
    data.startTime,
    "startTime",
  );
  const requestedEnd: Date | null = readWindowEdge(data.endTime, "endTime");

  const endTime: Date = requestedEnd || data.now;
  const startTime: Date =
    requestedStart ||
    new Date(endTime.getTime() - MESSAGE_QUEUE_TOPOLOGY_DEFAULT_RANGE_MS);

  if (startTime.getTime() > endTime.getTime()) {
    throw new BadDataException("startTime must not be after endTime");
  }

  if (
    endTime.getTime() - startTime.getTime() >
    MESSAGE_QUEUE_TOPOLOGY_MAX_RANGE_MS
  ) {
    throw new BadDataException(
      "The topology reads at most 93 days at a time. Pick a shorter time range.",
    );
  }

  return { startTime, endTime };
}

// ---- the queues ------------------------------------------------------------

/*
 * The part of a MessageQueue row the topology reads, as the service reads
 * it from Postgres.
 */
export interface MessageQueueTopologyQueueRow {
  id: string;
  name?: string | null | undefined;
  messagingSystem?: string | null | undefined;
  destinationName?: string | null | undefined;
  brokerScope?: string | null | undefined;
  brokerAddress?: string | null | undefined;
  queueIdentifier?: string | null | undefined;
  discoverySource?: string | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
  brokerMetricsLastSeenAt?: Date | string | null | undefined;
}

/*
 * Each queue's entity key - the key its Overview reads it by, built from
 * its stored identifier - and the queue each key belongs to. A row whose
 * identifier does not parse has no key (nothing is its telemetry), and a
 * key two rows build (never, while identifiers are unique) stays the
 * first row's.
 */
export interface MessageQueueTopologyKeys {
  keys: Array<string>;
  queueIdByKey: Map<string, string>;
  // The key's queue's SPECIFIC system, as its Overview is told it.
  systemByKey: Map<string, string>;
}

export function buildMessageQueueTopologyKeys(
  projectId: ObjectID | string,
  queues: ReadonlyArray<MessageQueueTopologyQueueRow>,
): MessageQueueTopologyKeys {
  const project: string = projectId.toString().trim();
  const keys: Array<string> = [];
  const queueIdByKey: Map<string, string> = new Map<string, string>();
  const systemByKey: Map<string, string> = new Map<string, string>();

  if (!project) {
    return { keys, queueIdByKey, systemByKey };
  }

  for (const queue of queues) {
    const identity: MessageQueueIdentity | null = parseMessageQueueIdentifier(
      queue.queueIdentifier,
    );
    if (!identity || !queue.id) {
      continue;
    }
    const key: string = keyForMessageQueue(project, identity);
    if (queueIdByKey.has(key)) {
      continue;
    }
    keys.push(key);
    queueIdByKey.set(key, queue.id);
    systemByKey.set(key, (queue.messagingSystem || "").toString());
  }

  return { keys, queueIdByKey, systemByKey };
}

// ---- the statement -----------------------------------------------------------

export interface MessageQueueTopologyStatementInput {
  // Compiles the Overview's filters: SpanService's own.
  generator: StatementGenerator<Span>;
  projectId: ObjectID;
  keys: MessageQueueTopologyKeys;
  window: MessageQueueTopologyWindow;
  // The services the caller may read (TelemetryReadScopeUtil.toServiceFilter).
  serviceFilter: TelemetryServiceFilter;
  // The most rows to return, busiest first.
  rowLimit: number;
}

/*
 * One compiled filter of a group, and the keys of the queues whose system
 * reads the group with exactly it.
 */
interface CompiledBranch {
  filter: Statement;
  keys: Array<string>;
}

function compileFilter(
  generator: StatementGenerator<Span>,
  filter: Record<string, unknown>,
): Statement {
  return generator.toWhereStatement(filter as Query<Span>);
}

/*
 * A group's branches: its filter compiled for each system of the project's
 * queues that reads the group, one branch per distinct compiled filter,
 * holding the keys of every queue that reads the group so.
 */
function getGroupBranches(
  input: MessageQueueTopologyStatementInput,
  population: MessageQueueSpanPopulation,
): Array<CompiledBranch> {
  const branches: Map<string, CompiledBranch> = new Map<
    string,
    CompiledBranch
  >();
  const compiledBySystem: Map<string, { id: string; filter: Statement }> =
    new Map<string, { id: string; filter: Statement }>();

  for (const key of input.keys.keys) {
    const system: string = input.keys.systemByKey.get(key) || "";
    if (!isMessageQueueSpanPopulationRead(population, system)) {
      continue;
    }
    let compiled: { id: string; filter: Statement } | undefined =
      compiledBySystem.get(system);
    if (!compiled) {
      const filter: Statement = compileFilter(
        input.generator,
        getMessageQueueSpanPopulationFilter(population, system),
      );
      compiled = {
        id: JSON.stringify([filter.query, filter.query_params]),
        filter: filter,
      };
      compiledBySystem.set(system, compiled);
    }
    let branch: CompiledBranch | undefined = branches.get(compiled.id);
    if (!branch) {
      branch = { filter: compiled.filter, keys: [] };
      branches.set(compiled.id, branch);
    }
    branch.keys.push(key);
  }

  return Array.from(branches.values());
}

/*
 * ` <condition>` that is true for a span (of the joined `queueKey`) in the
 * group: `0` when no queue reads the group, the compiled filter alone when
 * every queue reads it alike, else one branch per filter, each over its
 * queues' keys.
 */
function groupCondition(
  input: MessageQueueTopologyStatementInput,
  branches: ReadonlyArray<CompiledBranch>,
): Statement {
  if (branches.length === 0) {
    return SQL`0`;
  }

  const total: number = input.keys.keys.length;

  if (branches.length === 1 && branches[0]!.keys.length === total) {
    return SQL`(1 `.append(branches[0]!.filter).append(SQL`)`);
  }

  const condition: Statement = SQL`(`;
  branches.forEach((branch: CompiledBranch, index: number): void => {
    if (index > 0) {
      condition.append(SQL` OR `);
    }
    condition
      .append(
        SQL`(has(${{
          type: TableColumnType.ArrayText,
          value: branch.keys,
        }}, queueKey) `,
      )
      .append(branch.filter)
      .append(SQL`)`);
  });
  condition.append(SQL`)`);
  return condition;
}

/*
 * `<condition> AND statusCode = <error>`: the failed spans of a group,
 * filtered as the Overview's errorsOnly filters them.
 */
function failedCondition(
  input: MessageQueueTopologyStatementInput,
  condition: Statement,
): Statement {
  return SQL`(`
    .append(condition)
    .append(SQL` `)
    .append(compileFilter(input.generator, { statusCode: SpanStatus.Error }))
    .append(SQL`)`);
}

/**
 * The topology's one read: per (queue key, service), every span and the
 * failed ones, and for each group (MESSAGE_QUEUE_TOPOLOGY_GROUPS) its
 * spans, its failed spans and the p95 of their durations, over the window,
 * the busiest pairs first. The window, the project and the keys are the
 * Overview's own filter (compiled from it), with the key array joined out
 * to the one queue key each span carries. Refuses a read with no key: an
 * empty key list would read nothing, and it is the caller's to skip.
 */
export function buildMessageQueueTopologyStatement(
  input: MessageQueueTopologyStatementInput,
): Statement {
  if (input.keys.keys.length === 0) {
    throw new BadDataException("A topology read names the queues it reads");
  }
  if (!Number.isInteger(input.rowLimit) || input.rowLimit < 1) {
    throw new BadDataException("rowLimit must be a whole number above 0");
  }

  const statement: Statement = SQL`SELECT queueKey, primaryEntityId AS serviceId, count() AS spanCount, `;

  statement.append(
    SQL`countIf(1 `
      .append(compileFilter(input.generator, { statusCode: SpanStatus.Error }))
      .append(SQL`) AS errorCount`),
  );

  for (const population of MESSAGE_QUEUE_TOPOLOGY_GROUPS) {
    const condition: Statement = groupCondition(
      input,
      getGroupBranches(input, population),
    );
    statement
      .append(`, countIf(`)
      .append(condition)
      .append(`) AS ${population}Count, countIf(`)
      .append(failedCondition(input, condition))
      .append(`) AS ${population}Errors, quantileIf(0.95)(durationUnixNano, `)
      .append(condition)
      .append(`) AS ${population}P95`);
  }

  statement.append(
    SQL` FROM ${SPAN_TABLE} ARRAY JOIN entityKeys AS queueKey WHERE TRUE `,
  );
  statement.append(
    compileFilter(input.generator, {
      projectId: input.projectId,
      startTime: new InBetween<Date>(
        input.window.startTime,
        input.window.endTime,
      ),
      entityKeys: new Includes([...input.keys.keys]),
    }),
  );
  statement.append(
    SQL` AND queueKey IN ${{
      type: TableColumnType.Text,
      value: new Includes([...input.keys.keys]),
    }}`,
  );
  TelemetryReadScopeUtil.appendServiceFilter(statement, input.serviceFilter);
  statement.append(RETENTION_FILTER);
  statement.append(
    SQL` GROUP BY queueKey, serviceId ORDER BY spanCount DESC, queueKey ASC, serviceId ASC LIMIT ${{
      type: TableColumnType.Number,
      value: input.rowLimit,
    }}`,
  );
  statement.append(
    getQuerySettings({
      ...INTERACTIVE_READ_TIME_LIMIT,
      boundScanMemory: true,
      additionalSettings: { optimize_move_to_prewhere: 1 },
    }),
  );

  return statement;
}

// ---- the rows ------------------------------------------------------------------

// One group of one (queue, service) pair.
export interface MessageQueueTopologyGroupFigures {
  count: number;
  errors: number;
  // null when the group has no span, or the read gave no number.
  p95Ms: number | null;
}

// One row of the read: one service's spans on one queue.
export interface MessageQueueTopologyPairRow {
  queueKey: string;
  // "" for spans no service recorded.
  serviceId: string;
  spans: number;
  errors: number;
  groups: Record<string, MessageQueueTopologyGroupFigures>;
}

// A count from a row: ClickHouse writes a UInt64 as text in JSON.
function countFrom(value: unknown): number {
  const number: number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

// A p95 from a row, in milliseconds: null for none (ClickHouse's nan).
function p95From(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0
    ? number / NANOSECONDS_PER_MILLISECOND
    : null;
}

/** The read's rows, each as numbers; a row without a queue key is left out. */
export function readMessageQueueTopologyRows(
  rows: ReadonlyArray<JSONObject>,
): Array<MessageQueueTopologyPairRow> {
  const pairs: Array<MessageQueueTopologyPairRow> = [];

  for (const row of rows) {
    const queueKey: string =
      typeof row["queueKey"] === "string" ? row["queueKey"].trim() : "";
    if (!queueKey) {
      continue;
    }
    const rawService: unknown = row["serviceId"];
    const groups: Record<string, MessageQueueTopologyGroupFigures> = {};
    for (const population of MESSAGE_QUEUE_TOPOLOGY_GROUPS) {
      const count: number = countFrom(row[`${population}Count`]);
      groups[population] = {
        count: count,
        // The failed spans of a group are some of its spans.
        errors: Math.min(countFrom(row[`${population}Errors`]), count),
        p95Ms: count > 0 ? p95From(row[`${population}P95`]) : null,
      };
    }
    const spans: number = countFrom(row["spanCount"]);
    pairs.push({
      queueKey: queueKey,
      serviceId:
        rawService === null || rawService === undefined
          ? ""
          : String(rawService).trim(),
      spans: spans,
      errors: Math.min(countFrom(row["errorCount"]), spans),
      groups: groups,
    });
  }

  return pairs;
}

// ---- the map -------------------------------------------------------------------

function groupOf(
  pair: MessageQueueTopologyPairRow,
  population: MessageQueueSpanPopulation,
): MessageQueueTopologyGroupFigures {
  return pair.groups[population] || { count: 0, errors: 0, p95Ms: null };
}

/*
 * One group of one queue's pairs as the cards' per-service figures: the
 * service id → spans, failed spans and p95 maps the Overview builds from its
 * grouped aggregate rows (which leave out a row with no service).
 */
function figuresOf(
  pairs: ReadonlyArray<MessageQueueTopologyPairRow>,
  population: MessageQueueSpanPopulation,
): MessageQueueServiceSpanFigures {
  const figures: MessageQueueServiceSpanFigures =
    emptyMessageQueueServiceSpanFigures();
  for (const pair of pairs) {
    const group: MessageQueueTopologyGroupFigures = groupOf(pair, population);
    if (!pair.serviceId || group.count <= 0) {
      continue;
    }
    figures.counts.set(
      pair.serviceId,
      (figures.counts.get(pair.serviceId) || 0) + group.count,
    );
    figures.errors.set(
      pair.serviceId,
      (figures.errors.get(pair.serviceId) || 0) + group.errors,
    );
    if (group.p95Ms !== null) {
      figures.p95Ms.set(pair.serviceId, group.p95Ms);
    }
  }
  return figures;
}

function sumOf(
  pairs: ReadonlyArray<MessageQueueTopologyPairRow>,
  population: MessageQueueSpanPopulation,
): number {
  return pairs.reduce(
    (total: number, pair: MessageQueueTopologyPairRow): number => {
      return total + groupOf(pair, population).count;
    },
    0,
  );
}

function dateText(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

function toFlow(
  queueId: string,
  direction: MessageQueueTopologyFlow["direction"],
  row: MessageQueueServiceFigures,
): MessageQueueTopologyFlow {
  return {
    queueId: queueId,
    serviceId: row.serviceId,
    direction: direction,
    messages: row.calls,
    errors: row.errors,
    errorRatePercent: row.errorRatePercent,
    p95DurationMs: row.p95DurationMs,
  };
}

export interface MessageQueueTopologyAssemblyInput {
  window: MessageQueueTopologyWindow;
  queues: ReadonlyArray<MessageQueueTopologyQueueRow>;
  keys: MessageQueueTopologyKeys;
  pairs: ReadonlyArray<MessageQueueTopologyPairRow>;
  // Service id → its name, for the services the caller may read.
  serviceNames: ReadonlyMap<string, string>;
  truncation: MessageQueueTopologyTruncation;
}

/**
 * The map's answer: every queue with the figures its Overview's tiles show
 * for the range, and one flow per service on either side of it, each the
 * service's row on the queue's Producers or Consumers card (every service,
 * not the cards' busiest ten). A queue's figures are the tiles' sums over
 * all its spans - those no service recorded included, as the tiles count
 * them - and its Published adds the sends of the services counted from
 * client send spans alone, as the tile does.
 */
export function assembleMessageQueueTopology(
  input: MessageQueueTopologyAssemblyInput,
): MessageQueueTopologyResponse {
  const pairsByQueue: Map<string, Array<MessageQueueTopologyPairRow>> =
    new Map<string, Array<MessageQueueTopologyPairRow>>();
  for (const pair of input.pairs) {
    const queueId: string | undefined = input.keys.queueIdByKey.get(
      pair.queueKey,
    );
    if (!queueId) {
      continue;
    }
    const list: Array<MessageQueueTopologyPairRow> =
      pairsByQueue.get(queueId) || [];
    list.push(pair);
    pairsByQueue.set(queueId, list);
  }

  const queues: Array<MessageQueueTopologyQueue> = [];
  const flows: Array<MessageQueueTopologyFlow> = [];
  const serviceIds: Set<string> = new Set<string>();

  for (const queue of input.queues) {
    if (!queue.id) {
      continue;
    }
    const pairs: Array<MessageQueueTopologyPairRow> =
      pairsByQueue.get(queue.id) || [];

    const producers: MessageQueueProducerServices =
      combineMessageQueueProducerServices({
        producer: figuresOf(pairs, "publish"),
        sends: [figuresOf(pairs, "send"), figuresOf(pairs, "awsSend")],
        limit: Number.POSITIVE_INFINITY,
      });
    const consumers: MessageQueueServiceFiguresList =
      combineMessageQueueConsumerServices({
        consume: figuresOf(pairs, "consume"),
        receivedBatches: figuresOf(pairs, "receivedBatch"),
        limit: Number.POSITIVE_INFINITY,
      });

    const spans: number = pairs.reduce(
      (total: number, pair: MessageQueueTopologyPairRow): number => {
        return total + pair.spans;
      },
      0,
    );
    const errors: number = pairs.reduce(
      (total: number, pair: MessageQueueTopologyPairRow): number => {
        return total + pair.errors;
      },
      0,
    );

    queues.push({
      id: queue.id,
      name: text(queue.name),
      messagingSystem: text(queue.messagingSystem),
      destinationName: text(queue.destinationName),
      brokerScope: text(queue.brokerScope),
      brokerAddress: text(queue.brokerAddress),
      queueIdentifier: text(queue.queueIdentifier),
      discoverySource: text(queue.discoverySource),
      lastSeenAt: dateText(queue.lastSeenAt),
      brokerMetricsLastSeenAt: dateText(queue.brokerMetricsLastSeenAt),
      spans: spans,
      errors: Math.min(errors, spans),
      published: sumOf(pairs, "publish") + producers.clientOnlyPublished,
      consumed: sumOf(pairs, "consume") + sumOf(pairs, "receivedBatch"),
    });

    for (const row of producers.services) {
      flows.push(toFlow(queue.id, "publish", row));
      serviceIds.add(row.serviceId);
    }
    for (const row of consumers.services) {
      flows.push(toFlow(queue.id, "consume", row));
      serviceIds.add(row.serviceId);
    }
  }

  const services: Array<MessageQueueTopologyService> = Array.from(serviceIds)
    .sort()
    .map((id: string): MessageQueueTopologyService => {
      return { id: id, name: input.serviceNames.get(id) || "" };
    });

  return {
    startTime: input.window.startTime.toISOString(),
    endTime: input.window.endTime.toISOString(),
    queues: queues,
    services: services,
    flows: flows,
    truncation: { ...input.truncation },
  };
}
