import { ResponseJSON } from "@clickhouse/client";
import { TelemetryLeakFixPlace } from "../../../../Types/AI/FixProductionBaseline";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import MetricPipelineRuleType from "../../../../Types/Metrics/MetricPipelineRuleType";
import { METRIC_REDACT_REPLACEMENT } from "../../DataSecurity/Telemetry/TelemetryScrubCoverage";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import ScrubRuleValueCountService, {
  ScrubRuleValueCountRow,
} from "../../../Services/ScrubRuleValueCountService";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { ContentScanOptions } from "../../DataSecurity/DataSecurityScanTypes";
import { ModelRereads } from "../../DataSecurity/Model/ModelRereads";
import { RecognizerAvailability } from "../../DataSecurity/Model/NameAddressRecognizer";
import {
  appendOwnersIn,
  appendWhere,
  capsOf,
  getTelemetrySource,
  readTelemetryRecordValues,
  SourceDefinition,
  tableOf,
  TelemetryRecordValue,
  TelemetrySampleCaps,
} from "../../DataSecurity/Telemetry/TelemetryDataScanner";
// Read while this module loads, which can be in the middle of the scanner's: see its module.
import { TelemetrySampleSource } from "../../DataSecurity/Telemetry/TelemetrySampleSource";
import {
  appendRecordVersion,
  buildOccurrenceMatcher,
  buildTelemetryOccurrenceStatement,
  getOccurrencePrefilter,
  getOccurrenceReadLimit,
  OccurrencePlan,
  planOccurrenceRead,
  readValuesAtLocation,
  VERSIONED_OCCURRENCE_SOURCES,
} from "../../DataSecurity/Telemetry/TelemetryFindingOccurrences";

/*
 * WHAT A CODE FIX OF A TELEMETRY LEAK IS PROVEN ON (#10368): the reads
 * TelemetryLeakFixWatch and the regression watch after it make.
 *
 *   - The values the scrub rules that contain the leak changed, by the
 *     service's version, from #10366's hourly counter (ScrubRuleValueCount).
 *   - How many of the store's records the service sent in a window - in
 *     one version when asked: the traffic a silence is weighed against.
 *   - The newest records at each place no rule covers, of the deployed
 *     version, read with the scanner's own matchers - narrowed in the
 *     database by the data type's own patterns, as Show the records it was
 *     seen in narrows them - and the version each record that still holds
 *     the data came from. A place the names-and-addresses model found its
 *     data at is read with the model (Model/ModelRereads.ts, #10926), not
 *     narrowed by patterns that cannot find it; a record the model had no
 *     time for is not counted, and where the model cannot run the read
 *     stops with an error, as any read that cannot be made does.
 *
 * Every store's records name the version that wrote them (#10832): a
 * service's logs, spans, AI calls, exceptions and metric data points under
 * resource.service.version, and a RUM application's logs and spans there
 * too (the browser SDK's service.version, the release its source maps are
 * uploaded for), its sessions in their appVersion. A session replay store
 * holds three kinds of record: each place is read from its own
 * (planOccurrenceRead), and its traffic is counted in the kind most of its
 * places are in.
 *
 * A metric pipeline rule counts nothing, so a metric place a rule hides is
 * proven on the records too, where it can be: a Redact Attribute rule
 * leaves its replacement under the key, so a data point of the new version
 * that still carries it is a value the rule changed - the code still
 * writes it. A rule that removes the attribute or drops the points leaves
 * nothing to read, and such a place cannot be told.
 *
 * Read as the system, every read pinned to its project and held to a time
 * limit it stops at with an error: a check that could not read is checked
 * again next time, never decided on half a picture. Nothing read leaves
 * this module but counts and versions: never a value.
 */

// How long a count of a store's records may run, in seconds.
export const LEAK_RECORD_COUNT_SECONDS: number = 30;

/*
 * The stores whose records a code fix can be proven on: every telemetry
 * store - a service's logs, spans, AI calls, exceptions and metrics, and a
 * RUM application's session replays (#10832).
 */
export const PROVABLE_LEAK_STORE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.TelemetryLogs,
  DataStoreKind.TelemetryTraces,
  DataStoreKind.TelemetryAiConversations,
  DataStoreKind.TelemetryExceptions,
  DataStoreKind.TelemetryMetrics,
  DataStoreKind.TelemetrySessionReplays,
];

// The source a store's records are read from, for a store of one kind of record.
const SOURCE_OF_KIND: Partial<Record<DataStoreKind, TelemetrySampleSource>> = {
  [DataStoreKind.TelemetryLogs]: TelemetrySampleSource.Logs,
  [DataStoreKind.TelemetryTraces]: TelemetrySampleSource.Traces,
  [DataStoreKind.TelemetryAiConversations]:
    TelemetrySampleSource.AiConversations,
  [DataStoreKind.TelemetryExceptions]: TelemetrySampleSource.Exceptions,
  [DataStoreKind.TelemetryMetrics]: TelemetrySampleSource.Metrics,
};

// A session replay store's kinds of record, in the order a tie between them is broken.
const SESSION_REPLAY_SOURCES: ReadonlyArray<TelemetrySampleSource> = [
  TelemetrySampleSource.RumLogs,
  TelemetrySampleSource.RumSpans,
  TelemetrySampleSource.RumSessions,
];

// What a store's records are called in a verdict's summary.
const NOUN_OF_SOURCE: Readonly<Record<TelemetrySampleSource, string>> = {
  [TelemetrySampleSource.Logs]: "logs",
  [TelemetrySampleSource.Traces]: "spans",
  [TelemetrySampleSource.AiConversations]: "AI calls",
  [TelemetrySampleSource.Exceptions]: "exceptions",
  [TelemetrySampleSource.Metrics]: "data points",
  [TelemetrySampleSource.RumLogs]: "browser logs",
  [TelemetrySampleSource.RumSpans]: "browser spans",
  [TelemetrySampleSource.RumSessions]: "sessions",
};

export function isProvableLeakStoreKind(kind: string | undefined): boolean {
  return PROVABLE_LEAK_STORE_KINDS.includes(kind as DataStoreKind);
}

/*
 * The kind of record a store's traffic is counted in: its one kind, or -
 * for a session replay store - the kind most of the places are read from
 * (logs, then spans, then sessions on a tie). Null when none can be.
 */
export function getLeakTrafficSource(
  kind: string | undefined,
  locations: ReadonlyArray<string> = [],
): TelemetrySampleSource | null {
  const one: TelemetrySampleSource | undefined =
    SOURCE_OF_KIND[kind as DataStoreKind];

  if (one) {
    return one;
  }

  if (kind !== DataStoreKind.TelemetrySessionReplays) {
    return null;
  }

  const counts: Map<TelemetrySampleSource, number> = new Map();

  for (const location of locations) {
    const plan: OccurrencePlan | null = planOccurrenceRead(kind, location);

    if (plan) {
      counts.set(plan.source, (counts.get(plan.source) || 0) + 1);
    }
  }

  let best: TelemetrySampleSource | null = null;

  for (const source of SESSION_REPLAY_SOURCES) {
    if ((counts.get(source) || 0) > (best ? counts.get(best) || 0 : 0)) {
      best = source;
    }
  }

  return best;
}

export function getLeakSourceNoun(source: TelemetrySampleSource): string {
  return NOUN_OF_SOURCE[source] || "records";
}

export function getLeakStoreNoun(
  kind: string | undefined,
  locations: ReadonlyArray<string> = [],
): string {
  const source: TelemetrySampleSource | null = getLeakTrafficSource(
    kind,
    locations,
  );

  return source ? getLeakSourceNoun(source) : "records";
}

// The kind of record a place is read from, or null for a place no record has.
export function getLeakPlaceSource(
  kind: string | undefined,
  location: string,
): TelemetrySampleSource | null {
  const plan: OccurrencePlan | null = planOccurrenceRead(kind, location);

  return plan && VERSIONED_OCCURRENCE_SOURCES.has(plan.source)
    ? plan.source
    : null;
}

/*
 * Whether the new version's records can tell about a place: one a record
 * has, which no metric pipeline rule removes or drops before it is stored
 * (#10832) - a Redact Attribute rule leaves its replacement to read.
 */
export function isReadableLeakPlace(
  kind: string | undefined,
  place: Pick<TelemetryLeakFixPlace, "location" | "metricRule">,
): boolean {
  if (
    !isProvableLeakStoreKind(kind) ||
    !getLeakPlaceSource(kind, place.location)
  ) {
    return false;
  }

  return (
    !place.metricRule ||
    place.metricRule.ruleType === MetricPipelineRuleType.RedactAttribute
  );
}

/*
 * A place as it is read: its data type and location, a Redact Attribute
 * rule's replacement (#10832), and whether the names-and-addresses model
 * found it, so its records are read again with the model (#10926).
 */
export function toLeakPlaceToRead(
  place: Pick<
    TelemetryLeakFixPlace,
    "dataTypeId" | "location" | "metricRule" | "isFoundByModel"
  >,
): LeakPlaceToRead {
  const replacement: string =
    place.metricRule?.ruleType === MetricPipelineRuleType.RedactAttribute
      ? place.metricRule.replacement || METRIC_REDACT_REPLACEMENT
      : "";

  return {
    dataTypeId: place.dataTypeId,
    location: place.location,
    ...(replacement ? { redactedAs: replacement } : {}),
    ...(place.isFoundByModel === true ? { isFoundByModel: true } : {}),
  };
}

// The values a set of rules changed in one service, and the versions they were changed in.
export interface LeakValuesChanged {
  valuesChanged: number;
  // The versions values were changed in, the most changed first.
  versions: Array<string>;
}

// What a read of the records at the places no rule covers found.
export interface LeakDataFound {
  recordsRead: number;
  recordsWithData: number;
  // The versions of the records that still held the data, the newest first.
  versions: Array<string>;
}

// One place to read: a finding's data type at its location.
export interface LeakPlaceToRead {
  dataTypeId: string;
  location: string;
  /*
   * What a metric pipeline Redact Attribute rule leaves in the value's
   * place (#10832): a record that still carries it under the key holds a
   * value the rule changed.
   */
  redactedAs?: string | undefined;
  // The names-and-addresses model found it there.
  isFoundByModel?: boolean | undefined;
}

/*
 * The rows a read takes, through one function a test can stand in for:
 * the source's own runner.
 */
export type LeakRowReader = (data: {
  source: SourceDefinition;
  statement: Statement;
}) => Promise<Array<JSONObject>>;

export const readLeakRowsWithRunner: LeakRowReader = async (data: {
  source: SourceDefinition;
  statement: Statement;
}): Promise<Array<JSONObject>> => {
  const result: Results = await data.source.runner.executeQuery(data.statement);
  const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

  return (response.data || []) as Array<JSONObject>;
};

/*
 * The counter's rows of the rules for one service, in the window: those of
 * one version when asked, else every version - and from a time inside an
 * hour, the rows of that hour only when the rule changed a value after it
 * (the row's last change), since the counter keeps an hour whole.
 */
export function pickValueCountRows(data: {
  rows: ReadonlyArray<ScrubRuleValueCountRow>;
  serviceId: string;
  since: Date;
  version?: string | undefined;
}): Array<ScrubRuleValueCountRow> {
  const serviceId: string = data.serviceId.toLowerCase();

  return data.rows.filter((row: ScrubRuleValueCountRow): boolean => {
    if (row.serviceId.toLowerCase() !== serviceId || row.valueCount <= 0) {
      return false;
    }

    if (data.version !== undefined && row.serviceVersion !== data.version) {
      return false;
    }

    // The hour the window starts in counts only for what it changed after the start.
    if (row.hour && row.hour.getTime() < data.since.getTime()) {
      return Boolean(
        row.lastChangedAt &&
          row.lastChangedAt.getTime() >= data.since.getTime(),
      );
    }

    return true;
  });
}

// The rows' values and versions, the most changed version first.
export function sumValueCountRows(
  rows: ReadonlyArray<ScrubRuleValueCountRow>,
): LeakValuesChanged {
  const byVersion: Map<string, number> = new Map<string, number>();
  let valuesChanged: number = 0;

  for (const row of rows) {
    valuesChanged += row.valueCount;
    byVersion.set(
      row.serviceVersion,
      (byVersion.get(row.serviceVersion) || 0) + row.valueCount,
    );
  }

  return {
    valuesChanged,
    versions: Array.from(byVersion.entries())
      .sort((a: [string, number], b: [string, number]): number => {
        return b[1] - a[1];
      })
      .map((entry: [string, number]): string => {
        return entry[0];
      })
      .filter(Boolean),
  };
}

export default class TelemetryLeakFixReads {
  /*
   * The values the rules changed in the service since a time (until a
   * time, when given), in one version when asked.
   */
  @CaptureSpan()
  public static async readValuesChanged(data: {
    projectId: ObjectID;
    serviceId: string;
    scrubRuleIds: ReadonlyArray<string>;
    since: Date;
    until?: Date | undefined;
    version?: string | undefined;
  }): Promise<LeakValuesChanged> {
    if (data.scrubRuleIds.length === 0) {
      return { valuesChanged: 0, versions: [] };
    }

    const hourStart: Date = new Date(
      Math.floor(data.since.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000,
    );
    const rows: Array<ScrubRuleValueCountRow> =
      await ScrubRuleValueCountService.readValueCounts({
        projectId: data.projectId,
        scrubRuleIds: data.scrubRuleIds,
        since: hourStart,
        until: data.until,
        byHour: true,
      });

    return sumValueCountRows(
      pickValueCountRows({
        rows,
        serviceId: data.serviceId,
        since: data.since,
        version: data.version,
      }),
    );
  }

  /*
   * How many of a store's records the owner sent in the window - in one
   * version when asked - in its one kind of record, or the kind given (a
   * session replay store's: getLeakTrafficSource). A session is counted
   * once however many times the table keeps it.
   */
  public static buildRecordCountStatement(data: {
    projectId: ObjectID;
    kind: string;
    source?: TelemetrySampleSource | null | undefined;
    serviceId: string;
    since: Date;
    until: Date;
    version?: string | undefined;
  }): { source: SourceDefinition; statement: Statement } | null {
    const sourceName: TelemetrySampleSource | null =
      data.source || getLeakTrafficSource(data.kind);

    if (!sourceName) {
      return null;
    }

    const source: SourceDefinition = getTelemetrySource(sourceName);
    const statement: Statement = SQL`SELECT `;

    statement.append(source.countExpression);
    statement.append(" AS records FROM ");
    statement.append(tableOf(source.table));
    appendWhere(statement, source, {
      projectId: data.projectId,
      since: data.since,
      until: data.until,
    });
    appendOwnersIn(statement, source, [data.serviceId]);

    if (data.version && VERSIONED_OCCURRENCE_SOURCES.has(sourceName)) {
      statement.append(" AND ");
      appendRecordVersion(statement, sourceName);
      statement.append(
        SQL` = ${{
          type: TableColumnType.Text,
          value: data.version,
        }}`,
      );
    }

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: LEAK_RECORD_COUNT_SECONDS,
        timeoutOverflowMode: "throw",
        boundScanMemory: true,
      }),
    );

    return { source, statement };
  }

  @CaptureSpan()
  public static async countRecords(data: {
    projectId: ObjectID;
    kind: string;
    // A session replay store's kind of record to count; any other store's is its own.
    source?: TelemetrySampleSource | null | undefined;
    serviceId: string;
    since: Date;
    until: Date;
    version?: string | undefined;
    readRows?: LeakRowReader | undefined;
  }): Promise<number> {
    if (data.until.getTime() <= data.since.getTime()) {
      return 0;
    }

    const built: { source: SourceDefinition; statement: Statement } | null =
      TelemetryLeakFixReads.buildRecordCountStatement(data);

    if (!built) {
      return 0;
    }

    const rows: Array<JSONObject> = await (
      data.readRows || readLeakRowsWithRunner
    )(built);
    const count: number = Number(rows[0]?.["records"] || 0);

    return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
  }

  /*
   * The newest records at each place in the window - in one version when
   * asked - and how many still hold the data, with their versions: the
   * data itself, or the replacement a metric Redact Attribute rule left
   * under the key. Each place is read from its own kind of record (a
   * session replay store's place from its logs, spans or sessions); a
   * place no record has reads nothing.
   */
  @CaptureSpan()
  public static async findDataAtPlaces(data: {
    projectId: ObjectID;
    kind: string;
    serviceId: string;
    places: ReadonlyArray<LeakPlaceToRead>;
    since: Date;
    until: Date;
    version?: string | undefined;
    options: ContentScanOptions;
    readRows?: LeakRowReader | undefined;
    // Stands in for the process's model in a test.
    getRecognizer?: (() => Promise<RecognizerAvailability>) | undefined;
  }): Promise<LeakDataFound> {
    const found: LeakDataFound = {
      recordsRead: 0,
      recordsWithData: 0,
      versions: [],
    };

    if (
      !isProvableLeakStoreKind(data.kind) ||
      data.until.getTime() <= data.since.getTime()
    ) {
      return found;
    }

    const read: LeakRowReader = data.readRows || readLeakRowsWithRunner;
    const versions: Array<string> = [];

    for (const place of data.places) {
      const plan: OccurrencePlan | null = planOccurrenceRead(
        data.kind,
        place.location,
      );

      if (!plan || !VERSIONED_OCCURRENCE_SOURCES.has(plan.source)) {
        continue;
      }

      const source: SourceDefinition = getTelemetrySource(plan.source);
      const caps: TelemetrySampleCaps = capsOf(source, data.options);
      const redactedAs: string = place.redactedAs || "";
      const model: ModelRereads | null = await ModelRereads.forFinding({
        isFoundByModel: place.isFoundByModel,
        getRecognizer: data.getRecognizer,
      });

      // Only the model tells its data: a read it cannot make is made again next time.
      if (model && !model.isAvailable) {
        throw new Error(
          `The names-and-addresses model cannot read the records at ${place.location}: ${model.unavailableReason}.`,
        );
      }

      const statement: Statement = buildTelemetryOccurrenceStatement({
        projectId: data.projectId,
        since: data.since,
        until: data.until,
        plan,
        ownerId: data.serviceId,
        limit: getOccurrenceReadLimit(plan),
        caps,
        /*
         * What the model finds no pattern does, and a redacted value is no
         * longer the data type's shape: neither place is narrowed by a
         * pattern - every record with the key is read, and each value is
         * looked at here.
         */
        prefilter:
          model || redactedAs
            ? null
            : getOccurrencePrefilter({
                dataTypeId: place.dataTypeId,
                location: place.location,
                options: data.options,
              }),
        serviceVersion: data.version,
        readsServiceVersion: true,
      });
      const matches: (value: string) => string | null = buildOccurrenceMatcher({
        dataTypeId: place.dataTypeId,
        location: place.location,
        options: data.options,
        model,
      });
      const holdsTheData: (value: string) => boolean = (
        value: string,
      ): boolean => {
        return (
          (redactedAs.length > 0 && value === redactedAs) ||
          Boolean(matches(value))
        );
      };
      const rows: Array<JSONObject> = await read({ source, statement });

      if (model) {
        await model.read(
          readValuesAtLocation({
            source: plan.source,
            rows,
            location: place.location,
            caps,
          }),
        );
      }

      for (const row of rows) {
        const values: Array<TelemetryRecordValue> =
          readTelemetryRecordValues(plan.source, row, caps) || [];

        // A record whose value there the model had no time for is not counted.
        if (
          model &&
          values.some((value: TelemetryRecordValue): boolean => {
            return (
              value.location === place.location &&
              value.value.trim().length > 0 &&
              !model.isRead(value.value)
            );
          })
        ) {
          continue;
        }

        found.recordsRead++;

        if (
          values.some((value: TelemetryRecordValue): boolean => {
            return (
              value.location === place.location && holdsTheData(value.value)
            );
          })
        ) {
          found.recordsWithData++;

          const version: string =
            typeof row["readServiceVersion"] === "string"
              ? row["readServiceVersion"]
              : "";

          if (version && !versions.includes(version)) {
            versions.push(version);
          }
        }
      }
    }

    found.versions = versions;

    return found;
  }
}
