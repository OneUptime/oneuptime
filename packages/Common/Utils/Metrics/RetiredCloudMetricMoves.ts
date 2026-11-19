import AggregationType from "../../Types/BaseDatabase/AggregationType";
import { CheckOn, FilterType } from "../../Types/Monitor/CriteriaFilter";
import MetricFormulaEvaluator from "./MetricFormulaEvaluator";

/*
 * MONITORS MOVED OFF THE METRICS THEIR CLOUDS DEPRECATE (#9739).
 *
 * Two metrics the cloud connections read are deprecated by their providers,
 * and since #9565 the connections read what replaces each; from #9739 they
 * read the old ones no more. A Metrics monitor whose query reads one moves
 * to its replacement:
 *
 *   - A Pub/Sub topic's pubsub.googleapis.com/topic/send_message_operation_count,
 *     which Google deprecates ("Apply a count aggregator on topic/message_sizes
 *     instead"). OneUptime read it as a rate a second (ALIGN_RATE, a minute
 *     at a time, a series per response_code), and reads its replacement,
 *     pubsub.googleapis.com/topic/message_sizes_count, as the messages
 *     published a minute (ALIGN_SUM): 60 of one are one of the other. A query
 *     moved reads the replacement with the aggregation it had (every one it
 *     can have is linear: an Avg, a Sum, a Max or a percentile of values 60
 *     times as large is 60 times as large); each threshold compared with it
 *     is 60 times what it was, and a formula over it reads it divided by 60,
 *     so the monitor fires when it did.
 *   - A Cosmos DB account's ServerSideLatency (azure_serversidelatency_<agg>),
 *     which Microsoft removes from Azure Monitor for ServerSideLatencyDirect
 *     (clients in direct mode) and ServerSideLatencyGateway (gateway mode:
 *     every MongoDB, Cassandra and Gremlin client, and the API for NoSQL's in
 *     gateway mode). All three are in milliseconds: a query moved reads the
 *     one the account reports, under the aggregation it was stored with, and
 *     nothing else of the monitor changes. Which one the account reports is
 *     the caller's to find out (CosmosLatencyEvidence), from what it reported
 *     lately.
 *
 * A query is left as it is - and says why (RetiredCloudMetricKeptReason) -
 * where moving it would change what its monitor judges: a Pub/Sub query of
 * one response code (the replacement counts what was published, with no
 * response code), one that counts points, a threshold entered in a unit of
 * its own, a formula that cannot be read; a Cosmos DB query of an account
 * that reported neither latency.
 *
 * Pure: it reads and writes the stored monitor steps it is handed
 * ({_type: "MonitorSteps", value: {monitorStepsInstanceArray: [...]}}, as
 * the database holds them), and says what it did. The worker's data
 * migration (MoveMonitorsOffRetiredCloudMetrics) writes and tells.
 */

export enum RetiredCloudMetric {
  PubSubPublishOperations = "PubSubPublishOperations",
  CosmosServerSideLatency = "CosmosServerSideLatency",
}

// A Pub/Sub topic's publish operations, and what replaces them.
export const PUBSUB_PUBLISH_OPERATIONS_METRIC: string =
  "pubsub.googleapis.com/topic/send_message_operation_count";
export const PUBSUB_MESSAGES_PUBLISHED_METRIC: string =
  "pubsub.googleapis.com/topic/message_sizes_count";
/*
 * The publish operations, read a second at a time, against the messages
 * published, read a minute at a time: a threshold moves by 60.
 */
export const PUBSUB_PUBLISH_OPERATIONS_SCALE: number = 60;

// The labels Google split the publish operations by, which the replacement has not.
const PUBSUB_RESPONSE_LABELS: ReadonlySet<string> = new Set<string>([
  "response_code",
  "response_class",
]);

// How a Cosmos DB account's clients connect, which says which latency it reports.
export enum CosmosConnectionMode {
  Direct = "direct",
  Gateway = "gateway",
}

// azure_serversidelatency_<aggregation>, as the azure_monitor receiver and the connection store it.
const COSMOS_SERVER_SIDE_LATENCY: RegExp =
  /^azure_serversidelatency_(average|total|maximum|minimum|count)$/;

// The filters whose value is a threshold in the metric's own unit.
const THRESHOLD_FILTER_TYPES: ReadonlySet<string> = new Set<string>([
  FilterType.GreaterThan,
  FilterType.LessThan,
  FilterType.GreaterThanOrEqualTo,
  FilterType.LessThanOrEqualTo,
  FilterType.EqualTo,
  FilterType.NotEqualTo,
  FilterType.ForecastAbove,
  FilterType.ForecastBelow,
]);

// A formula's characters, as the evaluator's tokenizer reads them.
const DIGIT_OR_POINT: RegExp = /^[0-9.]$/;
const IDENTIFIER_START: RegExp = /^[A-Za-z_]$/;
const IDENTIFIER_PART: RegExp = /^[A-Za-z0-9_]$/;

// A per-second unit a legend or a threshold of the publish operations was written in.
const PER_SECOND_UNIT: RegExp = /\/\s*s(ec(ond)?)?$/i;

export interface RetiredCloudMetricQuery {
  metric: RetiredCloudMetric;
  // The query's variable on its monitor ("a"), when it has one.
  metricVariable: string | undefined;
  // As the query names it.
  metricName: string;
  // Its attribute filter, as stored.
  attributes: unknown;
}

export enum RetiredCloudMetricKeptReason {
  // A query of one response code's publishes: the replacement counts what was published, with none.
  ResponseCode = "ResponseCode",
  // A count of points, which a rate a second and a count a minute do not share.
  PointCount = "PointCount",
  // A threshold entered in a unit of its own, which a factor of 60 may not convert.
  ThresholdUnit = "ThresholdUnit",
  // A formula over it that could not be read, to divide it by 60.
  Formula = "Formula",
  // A Cosmos DB account that reported neither latency, and whose API does not say.
  ConnectionModeUnknown = "ConnectionModeUnknown",
}

export interface RetiredCloudMetricMove {
  metric: RetiredCloudMetric;
  metricVariable: string | undefined;
  from: string;
  to: string;
  // Each threshold compared with it, before and after.
  thresholds: Array<{ from: number; to: number }>;
  // Each formula over it, before and after, by its variable.
  formulas: Array<{ alias: string | undefined; from: string; to: string }>;
  // A Cosmos DB account's: how its clients connect.
  connectionMode?: CosmosConnectionMode | undefined;
  // The other latency, when the account reported both: what this query no longer reads.
  alsoReported?: string | undefined;
}

export interface RetiredCloudMetricKept {
  metric: RetiredCloudMetric;
  metricVariable: string | undefined;
  metricName: string;
  reason: RetiredCloudMetricKeptReason;
  // What to read instead, by its stored name.
  replacements: Array<string>;
}

export interface RetiredCloudMetricOutcome {
  moved: Array<RetiredCloudMetricMove>;
  kept: Array<RetiredCloudMetricKept>;
}

/*
 * What is known of a Cosmos DB account's latencies, for the queries of it:
 * the points each replacement reported lately, and whether its API connects
 * through the gateway alone (an account of the API for MongoDB, whose kind
 * is MongoDB).
 */
export interface CosmosLatencyEvidence {
  directPoints: number;
  gatewayPoints: number;
  isGatewayOnly?: boolean | undefined;
}

export type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

export function asArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

// A query's filterData, the object its metric and aggregation live on.
export function getFilterData(query: unknown): UnknownRecord | undefined {
  return asRecord(
    asRecord(asRecord(query)?.["metricQueryData"])?.["filterData"],
  );
}

export function getMetricVariable(config: unknown): string | undefined {
  const variable: unknown = asRecord(asRecord(config)?.["metricAliasData"])?.[
    "metricVariable"
  ];

  return typeof variable === "string" && variable ? variable : undefined;
}

// What a stored metric name is, of the two deprecated: null for any other.
export function getRetiredCloudMetric(
  metricName: unknown,
): RetiredCloudMetric | null {
  if (typeof metricName !== "string") {
    return null;
  }

  const name: string = metricName.trim().toLowerCase();

  if (name === PUBSUB_PUBLISH_OPERATIONS_METRIC) {
    return RetiredCloudMetric.PubSubPublishOperations;
  }

  return COSMOS_SERVER_SIDE_LATENCY.test(name)
    ? RetiredCloudMetric.CosmosServerSideLatency
    : null;
}

/*
 * The latency that replaces a stored ServerSideLatency, by how the
 * account's clients connect: the same aggregation, as the read and the
 * receiver store them (azure_serversidelatencydirect_average).
 */
export function getCosmosLatencyReplacement(
  metricName: string,
  mode: CosmosConnectionMode,
): string | null {
  const match: RegExpExecArray | null = COSMOS_SERVER_SIDE_LATENCY.exec(
    (metricName || "").trim().toLowerCase(),
  );

  return match ? `azure_serversidelatency${mode}_${match[1]}` : null;
}

// What replaces a retired metric's query, by its stored names: one for Pub/Sub, two for Cosmos DB.
export function getRetiredCloudMetricReplacements(
  metricName: string,
): Array<string> {
  if (
    getRetiredCloudMetric(metricName) ===
    RetiredCloudMetric.PubSubPublishOperations
  ) {
    return [PUBSUB_MESSAGES_PUBLISHED_METRIC];
  }

  return [CosmosConnectionMode.Direct, CosmosConnectionMode.Gateway]
    .map((mode: CosmosConnectionMode): string | null => {
      return getCosmosLatencyReplacement(metricName, mode);
    })
    .filter((name: string | null): name is string => {
      return Boolean(name);
    });
}

/*
 * The connection mode a Cosmos DB query moves to: the latency the account
 * reported - the one with more points when it reported both, the other
 * then named - else the gateway's, for an API that connects through it
 * alone. Null when nothing says.
 */
export function chooseCosmosConnectionMode(
  evidence: CosmosLatencyEvidence | null,
): { mode: CosmosConnectionMode; alsoReported: boolean } | null {
  if (!evidence) {
    return null;
  }

  const direct: number = Math.max(0, evidence.directPoints || 0);
  const gateway: number = Math.max(0, evidence.gatewayPoints || 0);

  if (direct > 0 || gateway > 0) {
    return {
      mode:
        gateway > direct
          ? CosmosConnectionMode.Gateway
          : CosmosConnectionMode.Direct,
      alsoReported: direct > 0 && gateway > 0,
    };
  }

  return evidence.isGatewayOnly
    ? { mode: CosmosConnectionMode.Gateway, alsoReported: false }
    : null;
}

// Each Metrics step of stored monitor steps: its metricMonitor and its criteria instances.
function getStoredMetricSteps(monitorStepsJSON: unknown): Array<{
  metricMonitor: UnknownRecord;
  criteriaInstances: Array<UnknownRecord>;
}> {
  const steps: Array<{
    metricMonitor: UnknownRecord;
    criteriaInstances: Array<UnknownRecord>;
  }> = [];

  for (const step of asArray(
    asRecord(asRecord(monitorStepsJSON)?.["value"])?.[
      "monitorStepsInstanceArray"
    ],
  )) {
    const value: UnknownRecord | undefined = asRecord(
      asRecord(step)?.["value"],
    );
    const metricMonitor: UnknownRecord | undefined = asRecord(
      value?.["metricMonitor"],
    );

    if (!metricMonitor) {
      continue;
    }

    steps.push({
      metricMonitor,
      criteriaInstances: asArray(
        asRecord(asRecord(value?.["monitorCriteria"])?.["value"])?.[
          "monitorCriteriaInstanceArray"
        ],
      )
        .map((instance: unknown): UnknownRecord | undefined => {
          return asRecord(asRecord(instance)?.["value"]);
        })
        .filter((instance: UnknownRecord | undefined): boolean => {
          return Boolean(instance);
        }) as Array<UnknownRecord>,
    });
  }

  return steps;
}

function getQueryConfigs(metricMonitor: UnknownRecord): Array<UnknownRecord> {
  return asArray(
    asRecord(metricMonitor["metricViewConfig"])?.["queryConfigs"],
  ).filter((query: unknown): boolean => {
    return Boolean(getFilterData(query));
  }) as Array<UnknownRecord>;
}

function getFormulaConfigs(metricMonitor: UnknownRecord): Array<UnknownRecord> {
  return asArray(
    asRecord(metricMonitor["metricViewConfig"])?.["formulaConfigs"],
  ).filter((formula: unknown): boolean => {
    return Boolean(asRecord(formula));
  }) as Array<UnknownRecord>;
}

// Every query of stored monitor steps that reads a metric its cloud deprecates, in order.
export function findRetiredCloudMetricQueries(
  monitorStepsJSON: unknown,
): Array<RetiredCloudMetricQuery> {
  const found: Array<RetiredCloudMetricQuery> = [];

  for (const step of getStoredMetricSteps(monitorStepsJSON)) {
    for (const query of getQueryConfigs(step.metricMonitor)) {
      const filter: UnknownRecord = getFilterData(query)!;
      const metric: RetiredCloudMetric | null = getRetiredCloudMetric(
        filter["metricName"],
      );

      if (metric) {
        found.push({
          metric,
          metricVariable: getMetricVariable(query),
          metricName: String(filter["metricName"]),
          attributes: filter["attributes"],
        });
      }
    }
  }

  return found;
}

/*
 * The criteria filters that compare a query's values, of every criteria
 * instance of its step: the ones that name its variable, and - for the
 * step's first query - the ones that name none, which read it.
 */
function getComparingFilters(data: {
  criteriaInstances: Array<UnknownRecord>;
  metricVariable: string | undefined;
  isFirstQuery: boolean;
}): Array<UnknownRecord> {
  const filters: Array<UnknownRecord> = [];

  for (const instance of data.criteriaInstances) {
    for (const rawFilter of asArray(instance["filters"])) {
      const filter: UnknownRecord | undefined = asRecord(rawFilter);

      if (!filter || filter["checkOn"] !== CheckOn.MetricValue) {
        continue;
      }

      const alias: unknown = asRecord(filter["metricMonitorOptions"])?.[
        "metricAlias"
      ];
      const namesIt: boolean =
        typeof alias === "string" && alias
          ? alias === data.metricVariable
          : data.isFirstQuery;

      if (namesIt) {
        filters.push(filter);
      }
    }
  }

  return filters;
}

// A threshold's number, from what a filter stores: a number, or a numeric text.
export function readThreshold(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const number: number = Number(value);

    return Number.isFinite(number) ? number : null;
  }

  return null;
}

// A number times a factor, without the float's dust (0.1 * 60 is 6).
export function scaleThreshold(value: number, factor: number): number {
  return Number((value * factor).toPrecision(12));
}

/*
 * A formula, each variable it names ($a, or a bare a) written as `write`
 * says, everything else as it is: the variables the evaluator reads
 * (MetricFormulaEvaluator's tokenizer), a number's exponent letter never
 * one ("1e3" names no e3).
 */
function rewriteFormulaVariables(
  formula: string,
  write: (token: string, name: string) => string,
): string {
  let rewritten: string = "";
  let position: number = 0;

  while (position < formula.length) {
    const char: string = formula[position]!;

    if (DIGIT_OR_POINT.test(char)) {
      let end: number = position;

      while (end < formula.length) {
        const next: string = formula[end]!;
        const previous: string = formula[end - 1] || "";

        if (
          DIGIT_OR_POINT.test(next) ||
          ((next === "e" || next === "E") && end > position) ||
          ((next === "+" || next === "-") &&
            (previous === "e" || previous === "E"))
        ) {
          end++;
          continue;
        }

        break;
      }

      rewritten += formula.slice(position, end);
      position = end;
      continue;
    }

    if (char === "$" || IDENTIFIER_START.test(char)) {
      let end: number = position + 1;

      while (end < formula.length && IDENTIFIER_PART.test(formula[end]!)) {
        end++;
      }

      const token: string = formula.slice(position, end);

      rewritten += write(token, token.replace(/^\$/, ""));
      position = end;
      continue;
    }

    rewritten += char;
    position++;
  }

  return rewritten;
}

// The variables a formula names, without their "$".
function getFormulaVariables(formula: string): Array<string> {
  const names: Array<string> = [];

  rewriteFormulaVariables(formula, (token: string, name: string): string => {
    if (name) {
      names.push(name);
    }

    return token;
  });

  return names;
}

// Whether a formula reads as the evaluator reads one.
function isReadableFormula(formula: string): boolean {
  return (
    MetricFormulaEvaluator.validateFormula({
      formula,
      availableVariables: getFormulaVariables(formula),
    }) === null
  );
}

// Whether a formula names a variable, whatever its case, with or without its "$".
function namesVariable(formula: string, variable: string): boolean {
  return getFormulaVariables(formula).some((name: string): boolean => {
    return name.toLowerCase() === variable.toLowerCase();
  });
}

/*
 * A formula with each mention of a variable divided by a factor: "$a *
 * 100" over a rate a second, its query now a count a minute, reads "($a /
 * 60) * 100". Null when the formula does not read as the evaluator reads
 * one: a formula it could not judge before is not guessed at.
 */
export function divideFormulaVariable(data: {
  formula: string;
  variable: string;
  factor: number;
}): string | null {
  const formula: string = data.formula || "";

  if (!isReadableFormula(formula)) {
    return null;
  }

  return rewriteFormulaVariables(
    formula,
    (token: string, name: string): string => {
      return name.toLowerCase() === data.variable.toLowerCase()
        ? `(${token} / ${data.factor})`
        : token;
    },
  );
}

/*
 * ONE READ OF A DEPRECATED METRIC, WHEREVER IT IS STORED.
 *
 * A monitor's query, a dashboard chart's, a table's column and an SLO's
 * metric each hold the metric's name, its filter and the values compared
 * with it in a shape of their own. Each is read into a RetiredCloudMetricRead
 * - where its name is written, what it is split by and aggregated with,
 * its legend's unit, each threshold compared with it and each formula over
 * it - and moved by one rule (moveRetiredCloudMetricRead), so a chart moves
 * exactly as a monitor does.
 */

// Where a value is kept: an object, and its key on it.
export interface RetiredCloudMetricSlot {
  holder: UnknownRecord;
  key: string;
}

// A value compared with a read's values, in the metric's own unit.
export interface RetiredCloudMetricThreshold extends RetiredCloudMetricSlot {
  /*
   * Whether its value is a threshold of the metric's (a monitor's filter of
   * a comparing type; every threshold of a chart): only those are scaled.
   */
  isThreshold: boolean;
  // A unit it was entered in, where it can be (a monitor filter's thresholdUnit).
  unit?: RetiredCloudMetricSlot | undefined;
}

// A formula over a read's variable.
export interface RetiredCloudMetricFormula extends RetiredCloudMetricSlot {
  // The formula's own variable, when it has one.
  alias: string | undefined;
}

export interface RetiredCloudMetricRead {
  metric: RetiredCloudMetric;
  metricVariable: string | undefined;
  metricName: string;
  // Where its name is written.
  name: RetiredCloudMetricSlot;
  // Its filter, as stored.
  attributes: unknown;
  // The keys it is split by, as stored: its group-by.
  splitBy: Array<unknown>;
  // Its aggregation, as stored.
  aggregation: unknown;
  // The unit its legend or column says.
  legendUnit?: RetiredCloudMetricSlot | undefined;
  thresholds: Array<RetiredCloudMetricThreshold>;
  formulas: Array<RetiredCloudMetricFormula>;
  /*
   * Words of its filter that name what it is split or filtered by, where
   * they are not keys of `attributes` (an SLO's filter, written as text).
   */
  filterWords?: Array<string> | undefined;
}

// The read's query, as a Cosmos DB account's evidence is found by.
export function toRetiredCloudMetricQuery(
  read: RetiredCloudMetricRead,
): RetiredCloudMetricQuery {
  return {
    metric: read.metric,
    metricVariable: read.metricVariable,
    metricName: read.metricName,
    attributes: read.attributes,
  };
}

// Whether a read is split or filtered by a response code, which the replacement has not.
function readsResponseCode(read: RetiredCloudMetricRead): boolean {
  const keys: Array<unknown> = [
    ...Object.keys(asRecord(read.attributes) || {}),
    ...read.splitBy,
  ];

  if (
    keys.some((key: unknown): boolean => {
      return (
        typeof key === "string" &&
        PUBSUB_RESPONSE_LABELS.has(key.trim().toLowerCase())
      );
    })
  ) {
    return true;
  }

  return (read.filterWords || []).some((words: string): boolean => {
    return Array.from(PUBSUB_RESPONSE_LABELS).some((label: string): boolean => {
      return new RegExp(`(^|[^a-z0-9_.])${label}([^a-z0-9_]|$)`, "i").test(
        words,
      );
    });
  });
}

// Why a Pub/Sub read of the publish operations stays as it is; null when it moves.
function getPubSubKeptReason(
  read: RetiredCloudMetricRead,
): RetiredCloudMetricKeptReason | null {
  if (readsResponseCode(read)) {
    return RetiredCloudMetricKeptReason.ResponseCode;
  }

  if (read.aggregation === AggregationType.Count) {
    return RetiredCloudMetricKeptReason.PointCount;
  }

  for (const threshold of read.thresholds) {
    const unit: unknown = threshold.unit
      ? threshold.unit.holder[threshold.unit.key]
      : undefined;

    if (
      typeof unit === "string" &&
      unit.trim() &&
      !PER_SECOND_UNIT.test(unit.trim()) &&
      unit.trim() !== "1"
    ) {
      return RetiredCloudMetricKeptReason.ThresholdUnit;
    }
  }

  if (read.metricVariable) {
    for (const formula of read.formulas) {
      const text: unknown = formula.holder[formula.key];

      if (typeof text !== "string" || !text.trim()) {
        continue;
      }

      if (
        namesVariable(text, read.metricVariable) &&
        divideFormulaVariable({
          formula: text,
          variable: read.metricVariable,
          factor: PUBSUB_PUBLISH_OPERATIONS_SCALE,
        }) === null
      ) {
        return RetiredCloudMetricKeptReason.Formula;
      }
    }
  }

  return null;
}

function keepRead(
  read: RetiredCloudMetricRead,
  reason: RetiredCloudMetricKeptReason,
): RetiredCloudMetricKept {
  return {
    metric: read.metric,
    metricVariable: read.metricVariable,
    metricName: read.metricName,
    reason,
    replacements: getRetiredCloudMetricReplacements(read.metricName),
  };
}

function moveCosmosRead(
  read: RetiredCloudMetricRead,
  evidence: CosmosLatencyEvidence | null,
): { moved?: RetiredCloudMetricMove; kept?: RetiredCloudMetricKept } {
  const chosen: {
    mode: CosmosConnectionMode;
    alsoReported: boolean;
  } | null = chooseCosmosConnectionMode(evidence);
  const to: string | null = chosen
    ? getCosmosLatencyReplacement(read.metricName, chosen.mode)
    : null;

  if (!chosen || !to) {
    return {
      kept: keepRead(read, RetiredCloudMetricKeptReason.ConnectionModeUnknown),
    };
  }

  read.name.holder[read.name.key] = to;

  return {
    moved: {
      metric: read.metric,
      metricVariable: read.metricVariable,
      from: read.metricName,
      to,
      thresholds: [],
      formulas: [],
      connectionMode: chosen.mode,
      ...(chosen.alsoReported
        ? {
            alsoReported: getCosmosLatencyReplacement(
              read.metricName,
              chosen.mode === CosmosConnectionMode.Direct
                ? CosmosConnectionMode.Gateway
                : CosmosConnectionMode.Direct,
            )!,
          }
        : {}),
    },
  };
}

function movePubSubRead(read: RetiredCloudMetricRead): {
  moved?: RetiredCloudMetricMove;
  kept?: RetiredCloudMetricKept;
} {
  const reason: RetiredCloudMetricKeptReason | null = getPubSubKeptReason(read);

  if (reason) {
    return { kept: keepRead(read, reason) };
  }

  const move: RetiredCloudMetricMove = {
    metric: read.metric,
    metricVariable: read.metricVariable,
    from: read.metricName,
    to: PUBSUB_MESSAGES_PUBLISHED_METRIC,
    thresholds: [],
    formulas: [],
  };

  read.name.holder[read.name.key] = PUBSUB_MESSAGES_PUBLISHED_METRIC;

  // Its legend's per-second unit says a rate it no longer is.
  const legendUnit: unknown = read.legendUnit
    ? read.legendUnit.holder[read.legendUnit.key]
    : undefined;

  if (
    read.legendUnit &&
    typeof legendUnit === "string" &&
    PER_SECOND_UNIT.test(legendUnit.trim())
  ) {
    delete read.legendUnit.holder[read.legendUnit.key];
  }

  for (const threshold of read.thresholds) {
    const unit: unknown = threshold.unit
      ? threshold.unit.holder[threshold.unit.key]
      : undefined;

    if (threshold.unit && typeof unit === "string" && unit.trim()) {
      delete threshold.unit.holder[threshold.unit.key];
    }

    const value: unknown = threshold.holder[threshold.key];
    const number: number | null = readThreshold(value);

    if (number === null || !threshold.isThreshold) {
      continue;
    }

    const scaled: number = scaleThreshold(
      number,
      PUBSUB_PUBLISH_OPERATIONS_SCALE,
    );

    threshold.holder[threshold.key] =
      typeof value === "string" ? String(scaled) : scaled;
    move.thresholds.push({ from: number, to: scaled });
  }

  if (read.metricVariable) {
    for (const formula of read.formulas) {
      const text: unknown = formula.holder[formula.key];

      if (
        typeof text !== "string" ||
        !namesVariable(text, read.metricVariable)
      ) {
        continue;
      }

      const rewritten: string = divideFormulaVariable({
        formula: text,
        variable: read.metricVariable,
        factor: PUBSUB_PUBLISH_OPERATIONS_SCALE,
      })!;

      formula.holder[formula.key] = rewritten;
      move.formulas.push({ alias: formula.alias, from: text, to: rewritten });
    }
  }

  return { moved: move };
}

/*
 * One read of a deprecated metric, moved to what replaces it where that
 * judges what it judged (see the header) - written where the read is
 * stored - or kept, with why.
 */
export function moveRetiredCloudMetricRead(
  read: RetiredCloudMetricRead,
  evidenceOf: (query: RetiredCloudMetricQuery) => CosmosLatencyEvidence | null,
): { moved?: RetiredCloudMetricMove; kept?: RetiredCloudMetricKept } {
  if (read.metric === RetiredCloudMetric.CosmosServerSideLatency) {
    return moveCosmosRead(read, evidenceOf(toRetiredCloudMetricQuery(read)));
  }

  return movePubSubRead(read);
}

// Every read's outcome, moved or kept, in order.
export function moveRetiredCloudMetricReads(data: {
  reads: Array<RetiredCloudMetricRead>;
  evidenceOf: (query: RetiredCloudMetricQuery) => CosmosLatencyEvidence | null;
}): RetiredCloudMetricOutcome {
  const outcome: RetiredCloudMetricOutcome = { moved: [], kept: [] };

  for (const read of data.reads) {
    const result: {
      moved?: RetiredCloudMetricMove;
      kept?: RetiredCloudMetricKept;
    } = moveRetiredCloudMetricRead(read, data.evidenceOf);

    if (result.moved) {
      outcome.moved.push(result.moved);
    }

    if (result.kept) {
      outcome.kept.push(result.kept);
    }
  }

  return outcome;
}

/*
 * A stored query config's read (MetricQueryConfigData, as a monitor step,
 * a chart and a value widget store one), when it reads a deprecated metric;
 * `thresholds` and `formulas` are what compares with it where it is.
 */
export function readRetiredCloudMetricQueryConfig(data: {
  query: unknown;
  thresholds: Array<RetiredCloudMetricThreshold>;
  formulas: Array<RetiredCloudMetricFormula>;
}): RetiredCloudMetricRead | null {
  const query: UnknownRecord | undefined = asRecord(data.query);
  const filterData: UnknownRecord | undefined = getFilterData(query);
  const metric: RetiredCloudMetric | null = getRetiredCloudMetric(
    filterData?.["metricName"],
  );

  if (!query || !filterData || !metric) {
    return null;
  }

  const aliasData: UnknownRecord | undefined = asRecord(
    query["metricAliasData"],
  );

  return {
    metric,
    metricVariable: getMetricVariable(query),
    metricName: String(filterData["metricName"]),
    name: { holder: filterData, key: "metricName" },
    attributes: filterData["attributes"],
    splitBy: asArray(
      asRecord(query["metricQueryData"])?.["groupByAttributeKeys"],
    ),
    aggregation: filterData["aggegationType"],
    ...(aliasData
      ? { legendUnit: { holder: aliasData, key: "legendUnit" } }
      : {}),
    thresholds: data.thresholds,
    formulas: data.formulas,
  };
}

// A formula config's formula (MetricFormulaConfigData, as a step and a chart store one).
export function getRetiredCloudMetricFormulas(
  formulaConfigs: Array<UnknownRecord>,
): Array<RetiredCloudMetricFormula> {
  const formulas: Array<RetiredCloudMetricFormula> = [];

  for (const formula of formulaConfigs) {
    const formulaData: UnknownRecord | undefined = asRecord(
      formula["metricFormulaData"],
    );

    if (formulaData) {
      formulas.push({
        holder: formulaData,
        key: "metricFormula",
        alias: getMetricVariable(formula),
      });
    }
  }

  return formulas;
}

// Each read of a deprecated metric of stored monitor steps, with what compares with it.
function getMonitorReads(
  monitorStepsJSON: unknown,
): Array<RetiredCloudMetricRead> {
  const reads: Array<RetiredCloudMetricRead> = [];

  for (const step of getStoredMetricSteps(monitorStepsJSON)) {
    const formulas: Array<RetiredCloudMetricFormula> =
      getRetiredCloudMetricFormulas(getFormulaConfigs(step.metricMonitor));

    getQueryConfigs(step.metricMonitor).forEach(
      (query: UnknownRecord, index: number): void => {
        const read: RetiredCloudMetricRead | null =
          readRetiredCloudMetricQueryConfig({
            query,
            thresholds: getComparingFilters({
              criteriaInstances: step.criteriaInstances,
              metricVariable: getMetricVariable(query),
              isFirstQuery: index === 0,
            }).map((filter: UnknownRecord): RetiredCloudMetricThreshold => {
              const options: UnknownRecord | undefined = asRecord(
                filter["metricMonitorOptions"],
              );

              return {
                holder: filter,
                key: "value",
                isThreshold: THRESHOLD_FILTER_TYPES.has(
                  String(filter["filterType"]),
                ),
                ...(options
                  ? { unit: { holder: options, key: "thresholdUnit" } }
                  : {}),
              };
            }),
            formulas,
          });

        if (read) {
          reads.push(read);
        }
      },
    );
  }

  return reads;
}

/*
 * Every query of stored monitor steps that reads a metric its cloud
 * deprecates, moved to what replaces it where that judges what it judged
 * (see the header): written on the steps handed in. A Cosmos DB query's
 * evidence is the caller's (evidenceOf, by the query). Says what moved,
 * and what stays and why.
 */
export function moveRetiredCloudMetricQueries(data: {
  monitorStepsJSON: unknown;
  evidenceOf: (query: RetiredCloudMetricQuery) => CosmosLatencyEvidence | null;
}): RetiredCloudMetricOutcome {
  return moveRetiredCloudMetricReads({
    reads: getMonitorReads(data.monitorStepsJSON),
    evidenceOf: data.evidenceOf,
  });
}

/*
 * WHAT A PAGE SAYS OF A QUERY OF A DEPRECATED METRIC (#9739's gap, #9980).
 *
 * A query left on a deprecated metric is read for as long as something
 * reads it (RetiredCloudMetricReads), and moved once it can be
 * (MoveOffRetiredCloudMetrics): a Cosmos DB account's once it reports a
 * latency, every hour. Until then, the monitor's Metrics card and the
 * dashboard's chart say so, and what replaces it: each deprecated metric
 * the queries read, once.
 */
export interface RetiredCloudMetricNotice {
  metric: RetiredCloudMetric;
  // As the queries name it.
  metricName: string;
  // What to read instead, by its stored name.
  replacements: Array<string>;
}

export function getRetiredCloudMetricNotices(
  queryConfigs: ReadonlyArray<unknown>,
): Array<RetiredCloudMetricNotice> {
  const notices: Array<RetiredCloudMetricNotice> = [];
  const seen: Set<string> = new Set<string>();

  for (const query of queryConfigs) {
    const metricName: unknown = getFilterData(query)?.["metricName"];
    const metric: RetiredCloudMetric | null = getRetiredCloudMetric(metricName);

    if (!metric) {
      continue;
    }

    const name: string = String(metricName).trim();

    if (seen.has(name.toLowerCase())) {
      continue;
    }

    seen.add(name.toLowerCase());
    notices.push({
      metric,
      metricName: name,
      replacements: getRetiredCloudMetricReplacements(name),
    });
  }

  return notices;
}
