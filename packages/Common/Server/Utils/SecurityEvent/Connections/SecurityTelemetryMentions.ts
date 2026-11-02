import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "../../../../Models/AnalyticsModels/Log";
import Span from "../../../../Models/AnalyticsModels/Span";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SECURITY_TELEMETRY_MAX_LISTED,
  SecurityConnectionKind,
  SecurityTelemetryHitsJson,
  SecurityTelemetryMentionsJson,
  SecurityTelemetrySignal,
  SecurityTelemetrySourceJson,
  SecurityTelemetryValueJson,
} from "../../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntity } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityConnectionWindow,
  SecurityLogResource,
  getEventConnectionWindow,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import {
  SecurityTelemetrySearch,
  SecurityTelemetrySearchValue,
  getTelemetryPlaces,
  getTelemetrySearchValues,
} from "../../../../Utils/SecurityCase/SecurityTelemetrySearch";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "../../../Services/AnalyticsDatabaseService";
import LogService from "../../../Services/LogService";
import SpanService from "../../../Services/SpanService";
import { Statement } from "../../AnalyticsDatabase/Statement";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import TelemetryReadAccess from "../../Telemetry/TelemetryReadAccess";
import { TelemetryServiceFilter } from "../../Telemetry/TelemetryReadScope";
import SecurityConnectedRecords, {
  getLogResourceKind,
  isRefusedRead,
} from "./SecurityConnectedRecords";
import SecurityConnections from "./SecurityConnections";
import {
  SecurityTelemetryMentionRow,
  SecurityTelemetryTable,
  buildSecurityTelemetryMentionsStatement,
  readSecurityTelemetryMentionRow,
} from "./SecurityTelemetryStatements";

/*
 * IN YOUR LOGS AND TRACES: where the values a security case, event or
 * entity names appear in the project's logs and traces themselves, over the
 * same window as its Connected Signals - an attacker's address in a web
 * server's access log, a leaked email in an application's error, a domain
 * in a span's server.address (Types/SecurityCase/SecurityConnection says
 * what names a value; Utils/SecurityCase/SecurityTelemetrySearch which
 * values are searched, and how).
 *
 * Two reads, one per signal, each one pass over its table for every value
 * (SecurityTelemetryStatements), each of the telemetry the reader's own
 * role may read (TelemetryReadAccess, as the explorers do): a signal the
 * role cannot read is said to be, and so is one whose read failed or ran
 * out of time - its counts are null, never zero. The records that sent the
 * lines and spans are named with the reader's role too, the most first.
 *
 * Read on its own request, after the records (the page shows those first),
 * and by OneUptime AI's triage of a case.
 */

interface SignalRead {
  rows: Array<SecurityTelemetryMentionRow> | null;
  unreadable: boolean;
  failed: boolean;
}

const SIGNAL_TABLES: Readonly<
  Record<
    SecurityTelemetrySignal,
    {
      table: SecurityTelemetryTable;
      modelType: { new (): AnalyticsBaseModel };
      service: AnalyticsDatabaseService<AnalyticsBaseModel>;
    }
  >
> = {
  [SecurityTelemetrySignal.Logs]: {
    table: SecurityTelemetryTable.Logs,
    modelType: Log,
    service:
      LogService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
  },
  [SecurityTelemetrySignal.Traces]: {
    table: SecurityTelemetryTable.Spans,
    modelType: Span,
    service:
      SpanService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
  },
};

// A read's answer that has none: the signal read, and nothing named.
function emptyHits(): SecurityTelemetryHitsJson {
  return {
    count: 0,
    sources: [],
    sourceCount: 0,
    places: [],
    lastSeen: null,
  };
}

/*
 * One value's hits in one signal: its count and when it was last seen, the
 * records that sent them (the reader's own, named, the most first, at most
 * SECURITY_TELEMETRY_MAX_LISTED) and where in them it was.
 */
export function toTelemetryHitsJson(
  row: SecurityTelemetryMentionRow | undefined,
  names: ReadonlyMap<string, { kind: SecurityConnectionKind; name: string }>,
): SecurityTelemetryHitsJson {
  if (!row) {
    return emptyHits();
  }

  const sources: Array<SecurityTelemetrySourceJson> = [];

  for (const source of row.sources) {
    // The kind of record a line's or a span's resource type names.
    const kind: SecurityConnectionKind | null = getLogResourceKind(source.type);
    const named: { kind: SecurityConnectionKind; name: string } | undefined =
      kind ? names.get(`${kind}:${source.id.toLowerCase()}`) : undefined;

    if (!kind || !named || sources.length >= SECURITY_TELEMETRY_MAX_LISTED) {
      continue;
    }

    sources.push({
      kind,
      id: source.id,
      name: named.name,
      count: source.count,
    });
  }

  return {
    count: row.count,
    sources,
    sourceCount: row.sourceCount,
    places: getTelemetryPlaces({
      messageCount: row.messageCount,
      attributeKeys: row.attributeKeys,
    }),
    lastSeen: row.lastSeen ? row.lastSeen.toISOString() : null,
  };
}

export default class SecurityTelemetryMentions {
  // A case's values, over its window: null when the case is not the caller's to read.
  @CaptureSpan()
  public static async forCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<SecurityTelemetryMentionsJson | null> {
    const caseWindow: {
      entities: Array<SecurityEntity>;
      window: SecurityConnectionWindow;
    } | null = await SecurityConnections.readCaseWindow(data);

    if (!caseWindow) {
      return null;
    }

    return await this.search({
      projectId: data.projectId,
      entities: caseWindow.entities,
      window: caseWindow.window,
      props: data.props,
    });
  }

  /*
   * An event's values in the hour around it, an entity's around its last
   * event - or, with no time, around now - as Connected Signals reads them.
   */
  @CaptureSpan()
  public static async forEntities(data: {
    projectId: ObjectID;
    entities: Array<SecurityEntity>;
    time?: Date | undefined;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<SecurityTelemetryMentionsJson> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    return await this.search({
      projectId: data.projectId,
      entities: data.entities,
      window: getEventConnectionWindow(
        data.time && data.time.getTime() <= now.getTime() ? data.time : now,
        now,
      ),
      props: data.props,
    });
  }

  @CaptureSpan()
  public static async search(data: {
    projectId: ObjectID;
    entities: ReadonlyArray<SecurityEntity>;
    window: SecurityConnectionWindow;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityTelemetryMentionsJson> {
    const search: SecurityTelemetrySearch = getTelemetrySearchValues(
      data.entities,
    );
    const answer: SecurityTelemetryMentionsJson = {
      windowStart: data.window.start.toISOString(),
      windowEnd: data.window.end.toISOString(),
      values: [],
      hasMoreValues: search.hasMoreValues,
      unreadableSignals: [],
      failedSignals: [],
    };

    if (search.values.length === 0) {
      return answer;
    }

    const [logs, traces]: [SignalRead, SignalRead] = await Promise.all([
      this.readSignal({
        ...data,
        signal: SecurityTelemetrySignal.Logs,
        values: search.values,
      }),
      this.readSignal({
        ...data,
        signal: SecurityTelemetrySignal.Traces,
        values: search.values,
      }),
    ]);

    for (const [signal, read] of [
      [SecurityTelemetrySignal.Logs, logs],
      [SecurityTelemetrySignal.Traces, traces],
    ] as Array<[SecurityTelemetrySignal, SignalRead]>) {
      if (read.unreadable) {
        answer.unreadableSignals.push(signal);
      }

      if (read.failed) {
        answer.failedSignals.push(signal);
      }
    }

    // The records that sent them, named once for both signals.
    const resources: Array<SecurityLogResource> = [
      ...(logs.rows || []),
      ...(traces.rows || []),
    ].flatMap(
      (row: SecurityTelemetryMentionRow): Array<SecurityLogResource> => {
        return row.sources.map(
          (source: { type: string; id: string }): SecurityLogResource => {
            return { type: source.type, id: source.id };
          },
        );
      },
    );
    const names: Map<string, { kind: SecurityConnectionKind; name: string }> =
      resources.length > 0
        ? await SecurityConnectedRecords.readNamesOfLogResources({
            projectId: data.projectId,
            resources,
            props: data.props,
          })
        : new Map();

    answer.values = search.values.map(
      (
        value: SecurityTelemetrySearchValue,
        index: number,
      ): SecurityTelemetryValueJson => {
        const rowOf: (
          rows: Array<SecurityTelemetryMentionRow>,
        ) => SecurityTelemetryMentionRow | undefined = (
          rows: Array<SecurityTelemetryMentionRow>,
        ): SecurityTelemetryMentionRow | undefined => {
          return rows.find((row: SecurityTelemetryMentionRow): boolean => {
            return row.valueIndex === index + 1;
          });
        };

        return {
          entityType: value.entity.type,
          entityValue: value.entity.value,
          logs: logs.rows ? toTelemetryHitsJson(rowOf(logs.rows), names) : null,
          traces: traces.rows
            ? toTelemetryHitsJson(rowOf(traces.rows), names)
            : null,
        };
      },
    );

    return answer;
  }

  /*
   * One signal's read, of the telemetry the reader may read: refused when
   * their role cannot read it, failed when the read does.
   */
  private static async readSignal(data: {
    projectId: ObjectID;
    signal: SecurityTelemetrySignal;
    values: Array<SecurityTelemetrySearchValue>;
    window: SecurityConnectionWindow;
    props: DatabaseCommonInteractionProps;
  }): Promise<SignalRead> {
    const target: {
      table: SecurityTelemetryTable;
      modelType: { new (): AnalyticsBaseModel };
      service: AnalyticsDatabaseService<AnalyticsBaseModel>;
    } = SIGNAL_TABLES[data.signal];

    try {
      const serviceFilter: TelemetryServiceFilter =
        await TelemetryReadAccess.getServiceFilter({
          modelType: target.modelType,
          props: data.props,
        });

      if (!target.service.database) {
        target.service.useDefaultDatabase();
      }

      const statement: Statement | null =
        buildSecurityTelemetryMentionsStatement({
          table: target.table,
          databaseName:
            target.service.database.getDatasourceOptions().database!,
          tableName: target.service.model.tableName,
          projectId: data.projectId,
          startTime: data.window.start,
          endTime: data.window.end,
          values: data.values,
          serviceFilter,
        });

      if (!statement) {
        return { rows: [], unreadable: false, failed: false };
      }

      const result: Results = await target.service.executeQuery(statement);
      const response: DbJSONResponse = await result.json<{
        data?: Array<JSONObject>;
      }>();

      return {
        rows: (response.data || [])
          .map((row: JSONObject): SecurityTelemetryMentionRow | null => {
            return readSecurityTelemetryMentionRow(row, data.values.length);
          })
          .filter(
            (
              row: SecurityTelemetryMentionRow | null,
            ): row is SecurityTelemetryMentionRow => {
              return row !== null;
            },
          ),
        unreadable: false,
        failed: false,
      };
    } catch (error) {
      if (isRefusedRead(error)) {
        return { rows: null, unreadable: true, failed: false };
      }

      logger.error(
        `Security connections: the ${data.signal.toLowerCase()} could not be searched for what the case names: ${error}`,
      );

      return { rows: null, unreadable: false, failed: true };
    }
  }
}
