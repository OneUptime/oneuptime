import { ResponseJSON } from "@clickhouse/client";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
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
  buildOccurrenceMatcher,
  buildTelemetryOccurrenceStatement,
  getOccurrencePrefilter,
  getOccurrenceReadLimit,
  OccurrencePlan,
  planOccurrenceRead,
  SERVICE_VERSION_ATTRIBUTE_KEY,
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
 *     the data came from.
 *
 * Read as the system, every read pinned to its project and held to a time
 * limit it stops at with an error: a check that could not read is checked
 * again next time, never decided on half a picture. Nothing read leaves
 * this module but counts and versions: never a value.
 */

// How long a count of a store's records may run, in seconds.
export const LEAK_RECORD_COUNT_SECONDS: number = 30;

// The stores whose records a code fix can be proven on: a service's logs, spans, AI calls and exceptions.
export const PROVABLE_LEAK_STORE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.TelemetryLogs,
  DataStoreKind.TelemetryTraces,
  DataStoreKind.TelemetryAiConversations,
  DataStoreKind.TelemetryExceptions,
];

// The source a store's records are read from, when they can be.
const SOURCE_OF_KIND: Partial<Record<DataStoreKind, TelemetrySampleSource>> = {
  [DataStoreKind.TelemetryLogs]: TelemetrySampleSource.Logs,
  [DataStoreKind.TelemetryTraces]: TelemetrySampleSource.Traces,
  [DataStoreKind.TelemetryAiConversations]:
    TelemetrySampleSource.AiConversations,
  [DataStoreKind.TelemetryExceptions]: TelemetrySampleSource.Exceptions,
};

// What a store's records are called in a verdict's summary.
const NOUN_OF_KIND: Partial<Record<DataStoreKind, string>> = {
  [DataStoreKind.TelemetryLogs]: "logs",
  [DataStoreKind.TelemetryTraces]: "spans",
  [DataStoreKind.TelemetryAiConversations]: "AI calls",
  [DataStoreKind.TelemetryExceptions]: "exceptions",
};

export function isProvableLeakStoreKind(kind: string | undefined): boolean {
  return PROVABLE_LEAK_STORE_KINDS.includes(kind as DataStoreKind);
}

export function getLeakStoreNoun(kind: string | undefined): string {
  return NOUN_OF_KIND[kind as DataStoreKind] || "records";
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

  // How many of a store's records the service sent in the window - in one version when asked.
  public static buildRecordCountStatement(data: {
    projectId: ObjectID;
    kind: string;
    serviceId: string;
    since: Date;
    until: Date;
    version?: string | undefined;
  }): { source: SourceDefinition; statement: Statement } | null {
    const sourceName: TelemetrySampleSource | undefined =
      SOURCE_OF_KIND[data.kind as DataStoreKind];

    if (!sourceName) {
      return null;
    }

    const source: SourceDefinition = getTelemetrySource(sourceName);
    const statement: Statement = SQL`SELECT count() AS records FROM `;

    statement.append(tableOf(source.table));
    appendWhere(statement, source, {
      projectId: data.projectId,
      since: data.since,
      until: data.until,
    });
    appendOwnersIn(statement, source, [data.serviceId]);

    if (data.version && VERSIONED_OCCURRENCE_SOURCES.has(sourceName)) {
      statement.append(" AND attributes[");
      statement.append(
        SQL`${{ type: TableColumnType.Text, value: SERVICE_VERSION_ATTRIBUTE_KEY }}] = ${{
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
   * asked - and how many still hold the data, with their versions. A place
   * whose records cannot be read (a metric's, a replay's) reads nothing.
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
      const statement: Statement = buildTelemetryOccurrenceStatement({
        projectId: data.projectId,
        since: data.since,
        until: data.until,
        plan,
        ownerId: data.serviceId,
        limit: getOccurrenceReadLimit(plan),
        caps,
        prefilter: getOccurrencePrefilter({
          dataTypeId: place.dataTypeId,
          location: place.location,
          options: data.options,
        }),
        serviceVersion: data.version,
        readsServiceVersion: true,
      });
      const holdsTheData: (value: string) => string | null =
        buildOccurrenceMatcher({
          dataTypeId: place.dataTypeId,
          location: place.location,
          options: data.options,
        });

      for (const row of await read({ source, statement })) {
        const values: Array<TelemetryRecordValue> =
          readTelemetryRecordValues(plan.source, row, caps) || [];

        found.recordsRead++;

        if (
          values.some((value: TelemetryRecordValue): boolean => {
            return (
              value.location === place.location &&
              Boolean(holdsTheData(value.value))
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
