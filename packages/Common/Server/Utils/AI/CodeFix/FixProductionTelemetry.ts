import { TelemetryFixSignal } from "../../../../Types/AI/FixProductionBaseline";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DbJSONResponse,
  Results,
} from "../../../Services/AnalyticsDatabaseService";
import LogService from "../../../Services/LogService";
import SpanService from "../../../Services/SpanService";
import TraceAggregationService, {
  TraceAnalyticsTableRow,
} from "../../../Services/TraceAggregationService";
import { appendAttributeFilters } from "../../AnalyticsDatabase/AttributeFilterStatement";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import TelemetryReadScopeUtil from "../../Telemetry/TelemetryReadScope";
import { PerformanceMeasure } from "./PerformanceFixVerdict";
import {
  TelemetryArrival,
  TelemetryArrivalKind,
  TelemetrySignalCounts,
} from "./TelemetryFixVerdict";

/*
 * What the production checks read of a service's spans and logs
 * (PerformanceFixWatch, TelemetryFixWatch): how many it sent, the p99 of an
 * operation, which of a fix's texts it carried - over a window, and in one
 * version when asked.
 *
 * Read as the system, every read pinned to its project and held to a time
 * limit it stops at with an error (never 'break', whose answer is partial
 * and looks whole): a check that could not read is checked again next
 * time, never decided on half a picture.
 */

// The resource attribute a service's telemetry names its version in.
export const SERVICE_VERSION_ATTRIBUTE: string = "resource.service.version";

// How long one read may run, in seconds.
export const FIX_TELEMETRY_READ_SECONDS: number = 30;

// The most texts one read answers with.
const MAX_TEXTS_READ: number = 500;

// One stretch of a service's (or, without one, a project's) telemetry.
export interface FixTelemetryWindow {
  projectId: ObjectID;
  // None reads the whole project.
  serviceId?: ObjectID | undefined;
  from: Date;
  to: Date;
  // Only telemetry that names this version (SERVICE_VERSION_ATTRIBUTE).
  version?: string | undefined;
}

interface TelemetryTable {
  name: string;
  timeColumn: string;
}

const SPAN_TABLE: TelemetryTable = {
  name: AnalyticsTableName.Span,
  timeColumn: "startTime",
};

const LOG_TABLE: TelemetryTable = {
  name: AnalyticsTableName.Log,
  timeColumn: "time",
};

// Where each kind of arrival is looked for, by what the fix improves.
export const ARRIVAL_KINDS_BY_SIGNAL: Record<
  TelemetryFixSignal,
  Array<TelemetryArrivalKind>
> = {
  [TelemetryFixSignal.Spans]: [
    TelemetryArrivalKind.SpanName,
    TelemetryArrivalKind.SpanAttribute,
  ],
  [TelemetryFixSignal.Logs]: [
    TelemetryArrivalKind.LogAttribute,
    TelemetryArrivalKind.LogBody,
  ],
};

export default class FixProductionTelemetry {
  /*
   * Whether the service's spans or logs name this version in the window -
   * what a deploy's version must pass before telemetry is read by it. A
   * deploy can name a version the service never reports (a pipeline's
   * "2.3.2" beside an SDK's "v2.3.2", or none), and read by it, the
   * deployed fix would look silent.
   */
  @CaptureSpan()
  public static async reportsVersion(
    window: FixTelemetryWindow & { serviceId: ObjectID; version: string },
  ): Promise<boolean> {
    for (const table of [SPAN_TABLE, LOG_TABLE]) {
      if (
        (await FixProductionTelemetry.readCount(
          FixProductionTelemetry.buildExistsStatement(table, window),
          table,
        )) > 0
      ) {
        return true;
      }
    }

    return false;
  }

  // The spans and logs sent in the window: only the signals asked for.
  @CaptureSpan()
  public static async countSignals(
    window: FixTelemetryWindow,
    signals: Array<TelemetryFixSignal>,
  ): Promise<TelemetrySignalCounts> {
    const [spans, logs]: [number, number] = await Promise.all([
      signals.includes(TelemetryFixSignal.Spans)
        ? FixProductionTelemetry.readCount(
            FixProductionTelemetry.buildCountStatement(SPAN_TABLE, window),
            SPAN_TABLE,
          )
        : Promise.resolve(0),
      signals.includes(TelemetryFixSignal.Logs)
        ? FixProductionTelemetry.readCount(
            FixProductionTelemetry.buildCountStatement(LOG_TABLE, window),
            LOG_TABLE,
          )
        : Promise.resolve(0),
    ]);

    return { spans, logs };
  }

  /*
   * An operation's spans in the window and their p99 - every span of the
   * service when no operation is named.
   */
  @CaptureSpan()
  public static async measureLatency(
    window: FixTelemetryWindow & {
      serviceId: ObjectID;
      spanName?: string | undefined;
    },
  ): Promise<PerformanceMeasure> {
    const minutes: number = Math.max(
      1,
      Math.ceil((window.to.getTime() - window.from.getTime()) / (60 * 1000)),
    );

    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable({
        projectId: window.projectId,
        startTime: window.from,
        endTime: window.to,
        bucketSizeInMinutes: minutes,
        chartType: "table",
        metric: "p99Duration",
        groupBy: ["primaryEntityId"],
        serviceIds: [window.serviceId],
        ...(window.spanName ? { spanNames: [window.spanName] } : {}),
        ...(window.version
          ? { attributes: { [SERVICE_VERSION_ATTRIBUTE]: window.version } }
          : {}),
        limit: 1,
      });

    return {
      spanCount: rows[0]?.count || 0,
      p99Ms: rows[0]?.p99DurationMs || 0,
    };
  }

  /*
   * Which of the texts the window's telemetry carried, and as what: a span's
   * name, a span's attribute key, a log's attribute key, a log's whole body.
   * A text found as more than one is listed once, as the first.
   */
  @CaptureSpan()
  public static async findTexts(
    window: FixTelemetryWindow,
    kinds: Array<TelemetryArrivalKind>,
    texts: Array<string>,
  ): Promise<Array<TelemetryArrival>> {
    if (texts.length === 0 || kinds.length === 0) {
      return [];
    }

    const found: Array<Array<string>> = await Promise.all(
      kinds.map((kind: TelemetryArrivalKind): Promise<Array<string>> => {
        return FixProductionTelemetry.readTexts(
          FixProductionTelemetry.buildTextsStatement(kind, window, texts),
          FixProductionTelemetry.tableOf(kind),
        );
      }),
    );

    const arrivals: Array<TelemetryArrival> = [];
    const seen: Set<string> = new Set<string>();

    // In the fix's own order, so the summary names what it added first.
    for (const text of texts) {
      for (const [index, kind] of kinds.entries()) {
        if (!seen.has(text) && found[index]!.includes(text)) {
          seen.add(text);
          arrivals.push({ text, kind });
        }
      }
    }

    return arrivals;
  }

  public static buildCountStatement(
    table: TelemetryTable,
    window: FixTelemetryWindow,
  ): Statement {
    const statement: Statement = SQL`SELECT count() AS cnt FROM ${table.name}`;

    FixProductionTelemetry.appendWindow(statement, table, window);
    statement.append(FixProductionTelemetry.settings());

    return statement;
  }

  // One row is enough to know the version is reported.
  public static buildExistsStatement(
    table: TelemetryTable,
    window: FixTelemetryWindow,
  ): Statement {
    const statement: Statement = SQL`SELECT count() AS cnt FROM (SELECT 1 FROM ${table.name}`;

    FixProductionTelemetry.appendWindow(statement, table, window);
    statement.append(" LIMIT 1)");
    statement.append(FixProductionTelemetry.settings());

    return statement;
  }

  public static buildTextsStatement(
    kind: TelemetryArrivalKind,
    window: FixTelemetryWindow,
    texts: Array<string>,
  ): Statement {
    const table: TelemetryTable = FixProductionTelemetry.tableOf(kind);
    let statement: Statement;

    if (
      kind === TelemetryArrivalKind.SpanAttribute ||
      kind === TelemetryArrivalKind.LogAttribute
    ) {
      // attributeKeys is what idx_attribute_keys answers: granules without one are skipped.
      statement = SQL`SELECT arrayJoin(arrayIntersect(attributeKeys, ${{
        type: TableColumnType.ArrayText,
        value: texts,
      }})) AS text FROM ${table.name}`;
      FixProductionTelemetry.appendWindow(statement, table, window);
      statement.append(
        SQL` AND hasAny(attributeKeys, ${{
          type: TableColumnType.ArrayText,
          value: texts,
        }})`,
      );
    } else {
      const column: string =
        kind === TelemetryArrivalKind.SpanName ? "name" : "body";

      statement = SQL`SELECT ${column} AS text FROM ${table.name}`;
      FixProductionTelemetry.appendWindow(statement, table, window);
      statement.append(` AND ${column} IN (`);
      statement.append(
        SQL`${{
          type: TableColumnType.Text,
          value: new Includes(texts),
        }})`,
      );
    }

    statement.append(
      SQL` GROUP BY text LIMIT ${{
        type: TableColumnType.Number,
        value: MAX_TEXTS_READ,
      }}`,
    );
    statement.append(FixProductionTelemetry.settings());

    return statement;
  }

  private static tableOf(kind: TelemetryArrivalKind): TelemetryTable {
    return kind === TelemetryArrivalKind.SpanName ||
      kind === TelemetryArrivalKind.SpanAttribute
      ? SPAN_TABLE
      : LOG_TABLE;
  }

  // The project, the window, the service and the version.
  private static appendWindow(
    statement: Statement,
    table: TelemetryTable,
    window: FixTelemetryWindow,
  ): void {
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: window.projectId,
      }}`,
    );
    statement.append(` AND ${table.timeColumn} >= `);
    statement.append(
      SQL`${{
        type: TableColumnType.Date,
        value: window.from,
      }}`,
    );
    statement.append(` AND ${table.timeColumn} <= `);
    statement.append(
      SQL`${{
        type: TableColumnType.Date,
        value: window.to,
      }}`,
    );
    statement.append(" AND retentionDate >= now()");

    if (window.serviceId) {
      TelemetryReadScopeUtil.appendServiceFilter(statement, {
        serviceIds: [window.serviceId],
      });
    }

    if (window.version) {
      appendAttributeFilters({
        statement,
        attributes: { [SERVICE_VERSION_ATTRIBUTE]: window.version },
        // The key is this module's own.
        validateKey: (): void => {
          return undefined;
        },
      });
    }
  }

  private static settings(): string {
    return getQuerySettings({
      maxExecutionTimeInSeconds: FIX_TELEMETRY_READ_SECONDS,
      timeoutOverflowMode: "throw",
      boundScanMemory: true,
    });
  }

  private static async readCount(
    statement: Statement,
    table: TelemetryTable,
  ): Promise<number> {
    const rows: Array<JSONObject> = await FixProductionTelemetry.read(
      statement,
      table,
    );

    return Number(rows[0]?.["cnt"] || 0);
  }

  private static async readTexts(
    statement: Statement,
    table: TelemetryTable,
  ): Promise<Array<string>> {
    const rows: Array<JSONObject> = await FixProductionTelemetry.read(
      statement,
      table,
    );

    return rows
      .map((row: JSONObject): string => {
        return typeof row["text"] === "string" ? row["text"] : "";
      })
      .filter(Boolean);
  }

  private static async read(
    statement: Statement,
    table: TelemetryTable,
  ): Promise<Array<JSONObject>> {
    const result: Results = await (
      table === SPAN_TABLE ? SpanService : LogService
    ).executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return response.data || [];
  }
}
