import SecurityTelemetrySource from "../../../../Models/DatabaseModels/SecurityTelemetrySource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  SECURITY_LOG_SOURCE_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import {
  SecurityTelemetrySourceDefinition,
  SecurityTelemetrySourceKind,
  getSecurityTelemetrySourceDefinition,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import AzureActivityLogParser from "../../../../Utils/SecurityEvent/LogParsers/AzureActivityLogParser";
import CloudTrailLogParser from "../../../../Utils/SecurityEvent/LogParsers/CloudTrailLogParser";
import GoogleCloudAuditLogParser from "../../../../Utils/SecurityEvent/LogParsers/GoogleCloudAuditLogParser";
import { SecurityLogLine } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../Services/SecurityEventService";
import SecurityTelemetrySourceService from "../../../Services/SecurityTelemetrySourceService";
import { CloudAuditRecord } from "../../CloudConnection/CloudConnectorTypes";
import logger from "../../Logger";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import RealTimeDetections from "../RealTime/RealTimeDetections";
import SecurityEventStoreOnce, {
  SharedRecordGroup,
} from "../SecurityEventStoreOnce";
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import ThreatIntelEnricher from "../ThreatIntel/ThreatIntelEnricher";

/*
 * CLOUD AUDIT LOGS: THE AUDIT LOGS OF THE CLOUD ACCOUNTS CONNECTED UNDER
 * CLOUD, AS SECURITY EVENTS - WITH NO LOG PIPELINE TO SET UP.
 *
 * A cloud account connected under Cloud (CloudConnection) already reads its
 * audit log, for Cloud's changes: CloudTrail's management events in each
 * Region, Google Cloud's Admin Activity audit log, the Azure Activity Log
 * (CloudConnectionLanes.runChanges). While the project's "Cloud audit logs"
 * is on (SecurityTelemetrySource, kind cloud-audit), that same read hands
 * back every record it brought in, whole (CloudAuditRecord), and each is
 * read here by the parser "Your logs" reads it with from a log pipeline -
 * CloudTrailLogParser, GoogleCloudAuditLogParser, AzureActivityLogParser -
 * so it is the same security event, judged the same way (a read is no
 * event; a refused call, a sign-in, a change is), and the rule library's
 * CloudTrail, Google Cloud and Azure rules read it as written.
 *
 *   - A record read both ways - from the logs and from the account - is
 *     stored once (SecurityEventStoreOnce): its id is the cloud's own
 *     (CloudTrail's eventID, Google's insertId, Azure's eventDataId).
 *   - The event is stamped when it is stored, the record's own time kept
 *     beside it (CLOUD_AUDIT_RECORD_TIME_ATTRIBUTE), as Data Security does
 *     with the same reads (DataSecurityChangeSignals): an audit log reaches
 *     OneUptime minutes after the fact, and a scheduled rule, reading events
 *     by their time two minutes behind the clock, would have passed it.
 *   - It is attributed to the "OneUptime Cloud Audit Logs" service, names
 *     the account it is of and the connection that read it, and is
 *     screened by the real-time rules and threat intel as it lands.
 *   - What each read found goes on the source, for the Connections page.
 *
 * Only what the account's read reads: management events (CloudTrail's
 * LookupEvents, written calls), Admin Activity, the Activity Log - not data
 * events, Data Access or sign-in logs, which take a log pipeline.
 */

// The record's own time, beside the time its event was stored.
export const CLOUD_AUDIT_RECORD_TIME_ATTRIBUTE: string =
  "oneuptime.cloud.record_time";
// The AWS account, Google Cloud project or Azure subscription it is of.
export const CLOUD_AUDIT_ACCOUNT_ATTRIBUTE: string =
  "oneuptime.cloud.account_id";
// The cloud connection whose read brought it in.
export const CLOUD_AUDIT_CONNECTION_ATTRIBUTE: string =
  "oneuptime.cloud.connection_id";

// The most records one read is read for: past it, the newest are kept.
export const CLOUD_AUDIT_MAX_RECORDS_PER_READ: number = 10000;

// Each cloud's audit records, and the parser "Your logs" reads them with.
export const CLOUD_AUDIT_FORMATS: Record<CloudProvider, SecurityLogFormat> = {
  [CloudProvider.AWS]: SecurityLogFormat.AwsCloudTrail,
  [CloudProvider.GCP]: SecurityLogFormat.GoogleCloudAudit,
  [CloudProvider.Azure]: SecurityLogFormat.AzureActivity,
};

const PARSERS: Record<
  CloudProvider,
  (line: SecurityLogLine) => Array<NormalizedSecurityEvent>
> = {
  [CloudProvider.AWS]: (
    line: SecurityLogLine,
  ): Array<NormalizedSecurityEvent> => {
    return CloudTrailLogParser.parse(line);
  },
  [CloudProvider.GCP]: (
    line: SecurityLogLine,
  ): Array<NormalizedSecurityEvent> => {
    return GoogleCloudAuditLogParser.parse(line);
  },
  [CloudProvider.Azure]: (
    line: SecurityLogLine,
  ): Array<NormalizedSecurityEvent> => {
    return AzureActivityLogParser.parse(line);
  },
};

export interface CloudAuditStoreOutcome {
  // Records the read brought in.
  recordsRead: number;
  // Security events stored: the rest were none, or stored another way first.
  eventsFound: number;
  // Events stored, by SecurityLogFormat.
  byFormat: Record<string, number>;
}

export default class CloudAuditSecurityEvents {
  /*
   * The project's Cloud audit logs, when they are on - what a cloud
   * account's read asks before it keeps its records. Null when off, or
   * when it cannot be told: the read goes on without them.
   */
  public static async findEnabledSource(
    projectId: ObjectID,
  ): Promise<SecurityTelemetrySource | null> {
    try {
      const source: SecurityTelemetrySource | null =
        await SecurityTelemetrySourceService.findForProject(
          projectId,
          SecurityTelemetrySourceKind.CloudAudit,
        );

      return source?.isEnabled === true && source.id ? source : null;
    } catch (error) {
      logger.error(
        `CloudAuditSecurityEvents: could not tell whether project ${projectId.toString()} reads its cloud audit logs:`,
      );
      logger.error(error);
      return null;
    }
  }

  /*
   * A cloud's audit records as the security events "Your logs" makes of
   * them, stamped `now` with the record's time beside it. A record with no
   * id of the cloud's own cannot be stored once, and is left out.
   */
  public static parseRecords(data: {
    provider: CloudProvider;
    records: Array<CloudAuditRecord>;
    connectionId?: ObjectID | undefined;
    now: Date;
  }): Array<NormalizedSecurityEvent> {
    const parse: (line: SecurityLogLine) => Array<NormalizedSecurityEvent> =
      PARSERS[data.provider];
    const events: Array<NormalizedSecurityEvent> = [];

    if (!parse) {
      return events;
    }

    for (const record of data.records.slice(
      -CLOUD_AUDIT_MAX_RECORDS_PER_READ,
    )) {
      let body: string = "";

      try {
        body = JSON.stringify(record.record);
      } catch {
        continue;
      }

      for (const event of parse({
        body,
        attributes: {},
        time: data.now,
      })) {
        if (!event.eventUid) {
          continue;
        }

        const attributes: JSONObject = {
          ...event.attributes,
          [SECURITY_LOG_SOURCE_ATTRIBUTE]:
            SecurityTelemetrySourceKind.CloudAudit,
          [CLOUD_AUDIT_RECORD_TIME_ATTRIBUTE]: event.time.toISOString(),
          [CLOUD_AUDIT_ACCOUNT_ATTRIBUTE]: record.accountId,
        };

        if (data.connectionId) {
          attributes[CLOUD_AUDIT_CONNECTION_ATTRIBUTE] =
            data.connectionId.toString();
        }

        events.push({ ...event, time: data.now, attributes });
      }
    }

    return events;
  }

  /*
   * One read's audit records, stored as security events, and what it found
   * written on the source. Throws when they could not be stored, so the read
   * reads the same stretch again.
   */
  public static async store(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    connectionId?: ObjectID | undefined;
    source: SecurityTelemetrySource;
    records: Array<CloudAuditRecord>;
    now: Date;
  }): Promise<CloudAuditStoreOutcome> {
    const outcome: CloudAuditStoreOutcome = {
      recordsRead: data.records.length,
      eventsFound: 0,
      byFormat: {},
    };

    try {
      const events: Array<NormalizedSecurityEvent> = this.parseRecords({
        provider: data.provider,
        records: data.records,
        connectionId: data.connectionId,
        now: data.now,
      });

      if (events.length > 0) {
        const stored: Array<NormalizedSecurityEvent> = await this.storeEvents({
          projectId: data.projectId,
          events,
        });

        for (const event of stored) {
          const format: string = String(
            event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE] || "",
          );

          outcome.byFormat[format] = (outcome.byFormat[format] || 0) + 1;
        }

        outcome.eventsFound = stored.length;
      }
    } catch (error) {
      await this.recordFailure({ source: data.source, error, now: data.now });
      throw error;
    }

    await this.recordRead({ source: data.source, outcome, now: data.now });

    return outcome;
  }

  // Store a read's events, and return the ones stored: the rest another way stored first.
  public static async storeEvents(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<Array<NormalizedSecurityEvent>> {
    const definition: SecurityTelemetrySourceDefinition =
      getSecurityTelemetrySourceDefinition(
        SecurityTelemetrySourceKind.CloudAudit,
      );
    const serviceMetadata: TelemetryServiceMetadata =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: definition.serviceName,
        projectId: data.projectId,
      });

    // Threat intel stamps its matches before the rows are built, as ingest does.
    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: data.projectId,
      events: data.events,
    });

    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "securityEvents",
      serviceConfig: serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
      projectConfig: serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: serviceMetadata.projectRetentionInDays,
    });

    const toRow: (normalized: NormalizedSecurityEvent) => JSONObject = (
      normalized: NormalizedSecurityEvent,
    ): JSONObject => {
      return buildSecurityEventDbRow({
        normalized,
        projectId: data.projectId,
        serviceMetadata,
        retentionDays,
      });
    };

    const split: {
      shared: Array<SharedRecordGroup>;
      rest: Array<NormalizedSecurityEvent>;
    } = SecurityEventStoreOnce.split(data.events);
    const stored: Array<NormalizedSecurityEvent> = [];
    const rows: Array<JSONObject> = [];

    // Every cloud's records are another way's too; the rest is stored as it is.
    if (split.rest.length > 0) {
      const restRows: Array<JSONObject> = split.rest.map(toRow);

      await SecurityEventService.insertJsonRows(restRows);
      rows.push(...restRows);
      stored.push(...split.rest);
    }

    for (const group of split.shared) {
      stored.push(
        ...(await SecurityEventStoreOnce.storeNew({
          projectId: data.projectId,
          group,
          insert: async (
            events: Array<NormalizedSecurityEvent>,
          ): Promise<void> => {
            const groupRows: Array<JSONObject> = events.map(toRow);

            // Seen by the next way to look, before the lock is released.
            await SecurityEventService.insertJsonRows(groupRows, {
              clickhouseSettings: {
                async_insert: 0,
                insert_distributed_sync: 1,
              },
            });
            rows.push(...groupRows);
          },
        })),
      );
    }

    // Checked against the project's real-time detection rules as they land.
    if (rows.length > 0) {
      await RealTimeDetections.screen({ projectId: data.projectId, rows });
    }

    return stored;
  }

  // What a read found, on the source: when, how much, and that it worked.
  private static async recordRead(data: {
    source: SecurityTelemetrySource;
    outcome: CloudAuditStoreOutcome;
    now: Date;
  }): Promise<void> {
    if (!data.source.id) {
      return;
    }

    try {
      await SecurityTelemetrySourceService.updateOneById({
        id: data.source.id,
        data: {
          lastScannedAt: data.now,
          lastError: null as unknown as string,
          lastScanResult: {
            recordsRead: data.outcome.recordsRead,
            eventsFound: data.outcome.eventsFound,
            // By the kind of record, as the card counts a source's finds.
            bySignal: { ...data.outcome.byFormat },
          } as never,
          ...(data.outcome.eventsFound > 0
            ? { lastEventFoundAt: data.now }
            : {}),
        },
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        "CloudAuditSecurityEvents: could not record what a read found:",
      );
      logger.error(error);
    }
  }

  private static async recordFailure(data: {
    source: SecurityTelemetrySource;
    error: unknown;
    now: Date;
  }): Promise<void> {
    const sourceId: ObjectID | null = data.source.id || null;

    if (!sourceId) {
      return;
    }

    await ConnectorErrorMessage.recordFailure({
      label: `CloudAuditSecurityEvents: source ${sourceId.toString()}`,
      write: async (): Promise<void> => {
        await SecurityTelemetrySourceService.updateOneById({
          id: sourceId,
          data: {
            lastScannedAt: data.now,
            lastError: ConnectorErrorMessage.toMessage(data.error),
          },
          props: { isRoot: true },
        });
      },
    });
  }
}
