import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_CONNECTION_ID_ATTRIBUTE } from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import CrowdSecNormalizer from "../../../../Utils/SecurityEvent/Connectors/CrowdSecNormalizer";
import InMemoryTTLCache from "../../../Infrastructure/InMemoryTTLCache";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Services/OpenTelemetryIngestService";
import SecurityEventConnectionService from "../../../Services/SecurityEventConnectionService";
import SecurityEventService from "../../../Services/SecurityEventService";
import logger from "../../Logger";
import SecurityConnectionCases from "../../SecurityCase/SecurityConnectionCases";
import RealTimeDetections from "../RealTime/RealTimeDetections";
import SecurityEventDedupe from "../SecurityEventDedupe";
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import ThreatIntelEnricher from "../ThreatIntel/ThreatIntelEnricher";

/*
 * ALERTS A PRODUCT SENDS THROUGH ITS CONNECTION (#11158).
 *
 * CrowdSec's http notification plugin posts its alerts to the ingest
 * endpoint with the project's ingestion key, which says whose they are,
 * and names the connection they belong to (?connection=<id>, or the
 * x-oneuptime-security-connection header). Such alerts are what a poll of
 * a polled product imports, and are kept as one's are:
 *
 *   - stored once: an alert sent again (a profile that notifies twice,
 *     `cscli notifications reinject`) is found by its id and dropped, as a
 *     re-read is;
 *   - attributed to the connection, so its View events opens them;
 *   - checked against the project's real-time detection rules;
 *   - and opening cases: each of the product's own detections at or above
 *     the connection's Open Cases From opens one, or joins the open case
 *     about the same host, user or address (SecurityConnectionCases) - not
 *     a person's decision, a test, or OneUptime's own ban coming back,
 *     which are no detection of the product's.
 *
 * A connection that is not enabled keeps its alerts as events, and opens
 * no case from them. Never throws past the batch: what could not be done
 * is logged, and the next alert is received as the last one was.
 */

// How long a connection a request names is remembered, so a busy sender is not a read per request.
export const PUSHED_CONNECTION_CACHE_TTL_MS: number = 60 * 1000;

// The header a sender may name the connection with, instead of ?connection=.
export const PUSHED_CONNECTION_HEADER: string =
  "x-oneuptime-security-connection";

export interface PushedAlertsResult {
  received: number;
  duplicates: number;
  stored: number;
  detections: number;
  casesOpened: number;
}

const cache: InMemoryTTLCache<SecurityEventConnection | null> =
  new InMemoryTTLCache<SecurityEventConnection | null>(10_000);

// Whether a product's alerts are sent through its connection (alertsArePushed).
function isPushedProvider(provider: string | undefined): boolean {
  return (
    getSecurityEventConnectorDefinition(provider)?.alertsArePushed === true
  );
}

// The product's own detections, of what a connection receives: what may open a case.
function isDetectionOf(
  provider: string | undefined,
  event: NormalizedSecurityEvent,
): boolean {
  if (provider === SecurityEventConnectorProvider.CrowdSec) {
    return CrowdSecNormalizer.isDetection(event);
  }

  return true;
}

export default class PushedConnectionAlerts {
  public static clearCache(): void {
    cache.clear();
  }

  /*
   * The project's connection a request names: one of a product that sends
   * its alerts. Refused, with what to do, when the id is no id, or names
   * no such connection of this project's.
   */
  public static async findConnection(data: {
    projectId: ObjectID;
    connectionId: string;
  }): Promise<SecurityEventConnection> {
    const id: string = (data.connectionId || "").trim();

    if (!ObjectID.isValidUUID(id)) {
      throw new BadDataException(
        "The connection this request names is not a connection's ID. Copy the address from the connection's Send alerts, under Security > Connections.",
      );
    }

    const key: string = `${data.projectId.toString()}:${id.toLowerCase()}`;
    let connection: SecurityEventConnection | null | undefined = cache.get(key);

    if (connection === undefined) {
      connection = await SecurityEventConnectionService.findOneBy({
        query: { _id: id, projectId: data.projectId },
        select: {
          _id: true,
          projectId: true,
          name: true,
          provider: true,
          isEnabled: true,
        },
        props: { isRoot: true },
      });

      cache.set(key, connection, PUSHED_CONNECTION_CACHE_TTL_MS);
    }

    if (!connection || !isPushedProvider(connection.provider)) {
      throw new BadDataException(
        "This project has no connection of that ID that receives alerts. Copy the address from the connection's Send alerts, under Security > Connections.",
      );
    }

    return connection;
  }

  public static async receive(data: {
    projectId: ObjectID;
    connection: SecurityEventConnection;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<PushedAlertsResult> {
    const result: PushedAlertsResult = {
      received: data.events.length,
      duplicates: 0,
      stored: 0,
      detections: 0,
      casesOpened: 0,
    };

    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(data.connection.provider);

    if (!definition || !data.connection.id || data.events.length === 0) {
      return result;
    }

    // Each alert once, however often the batch carries it.
    const byUid: Map<string, NormalizedSecurityEvent> = new Map();

    for (const event of data.events) {
      if (!byUid.has(event.eventUid)) {
        byUid.set(event.eventUid, event);
      }
    }

    const unique: Array<NormalizedSecurityEvent> = Array.from(byUid.values());

    const existing: Set<string> =
      await SecurityEventDedupe.findExistingEventUids({
        projectId: data.projectId,
        vendorName: definition.vendorName,
        productName: definition.productName,
        ids: unique.map((event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        }),
      });

    const fresh: Array<NormalizedSecurityEvent> = unique.filter(
      (event: NormalizedSecurityEvent): boolean => {
        return !existing.has(event.eventUid);
      },
    );

    result.duplicates = data.events.length - fresh.length;

    if (fresh.length === 0) {
      return result;
    }

    const serviceMetadata: TelemetryServiceMetadata =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: definition.productName,
        projectId: data.projectId,
      });

    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "securityEvents",
      serviceConfig: serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
      projectConfig: serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: serviceMetadata.projectRetentionInDays,
    });

    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: data.projectId,
      events: fresh,
    });

    const rows: Array<JSONObject> = fresh.map(
      (event: NormalizedSecurityEvent): JSONObject => {
        event.vendorName = definition.vendorName;
        event.productName = definition.productName;
        event.attributes[SECURITY_CONNECTION_ID_ATTRIBUTE] =
          data.connection.id!.toString();
        event.attributes["oneuptime.security_connection.provider"] =
          definition.provider;

        return buildSecurityEventDbRow({
          normalized: event,
          projectId: data.projectId,
          serviceMetadata,
          retentionDays,
        });
      },
    );

    // Visible before a case reads them: a detection keeps the row it matched.
    await SecurityEventService.insertJsonRows(rows, {
      clickhouseSettings: { async_insert: 0, insert_distributed_sync: 1 },
    });

    result.stored = rows.length;

    await RealTimeDetections.screen({ projectId: data.projectId, rows });

    const detections: Array<NormalizedSecurityEvent> = fresh.filter(
      (event: NormalizedSecurityEvent): boolean => {
        return isDetectionOf(data.connection.provider, event);
      },
    );

    result.detections = detections.length;

    if (detections.length > 0 && data.connection.isEnabled !== false) {
      result.casesOpened = await SecurityConnectionCases.recordImportedAlerts({
        connection: data.connection,
        definition,
        events: detections,
        rows,
      });
    }

    try {
      await SecurityEventConnectionService.updateOneById({
        id: data.connection.id,
        data: { lastEventIngestedAt: new Date() },
        props: { isRoot: true },
      });
    } catch (error) {
      logger.warn(
        `PushedConnectionAlerts: could not note when connection ${data.connection.id.toString()} last received an alert: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }
}
