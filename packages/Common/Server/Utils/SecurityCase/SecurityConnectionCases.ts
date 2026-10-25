import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import ObjectID from "../../../Types/ObjectID";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityEntity,
  SecurityEntityType,
  entitiesFromObservables,
  mergeSecurityEntities,
} from "../../../Types/SecurityCase/SecurityEntity";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import SecurityEventConnectionService from "../../Services/SecurityEventConnectionService";
import SecurityEntityRiskRecorder from "../SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import { riskFindingsForImportedAlerts } from "../SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import logger from "../Logger";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "./SecurityCaseIngest";

// OCSF Detection Finding and Incident Finding: what a product calls an alert.
export const IMPORTED_ALERT_CLASS_UIDS: ReadonlyArray<number> = [2004, 2005];

// The most cases one poll's alerts can open or join, so a backlog cannot flood the queue.
export const IMPORTED_ALERTS_PER_POLL_LIMIT: number = 200;

/*
 * The severity a connection's "Open Cases From Severity" names, or null when
 * it is empty or names nothing (the connection opens no cases).
 */
export function readCaseMinimumSeverity(
  value: string | undefined | null,
): OcsfSeverity | null {
  if (!value || !value.trim()) {
    return null;
  }

  return normalizeOcsfSeverity(value) || null;
}

export function isAtLeastSeverity(
  severity: OcsfSeverity | string | undefined,
  minimum: OcsfSeverity,
): boolean {
  const rank: number =
    severity && severity !== OcsfSeverity.Other
      ? OcsfSeverityId[severity as OcsfSeverity] || 0
      : 0;

  return rank >= OcsfSeverityId[minimum];
}

/*
 * The entities an imported alert is about, typed by the field each came
 * from: the actor's user, host and address first, then what it acted on,
 * then the rest of its observables.
 */
export function importedAlertEntities(
  event: NormalizedSecurityEvent,
): Array<SecurityEntity> {
  const typed: Array<SecurityEntity> = [];
  const push: (type: SecurityEntityType, value: string) => void = (
    type: SecurityEntityType,
    value: string,
  ): void => {
    if (value && value.trim()) {
      typed.push({ type, value: value.trim() });
    }
  };

  push(SecurityEntityType.User, event.principalUser);
  push(SecurityEntityType.Host, event.principalHost);
  push(SecurityEntityType.IpAddress, event.principalIp);
  push(SecurityEntityType.User, event.targetUser);
  push(SecurityEntityType.Host, event.targetHost);
  push(SecurityEntityType.IpAddress, event.targetIp);

  return mergeSecurityEntities(
    typed,
    entitiesFromObservables(event.observables),
  );
}

// What the alert is about, the value cases about the same thing gather on.
export function importedAlertGroupValue(
  event: NormalizedSecurityEvent,
): string | undefined {
  return (
    event.principalHost ||
    event.targetHost ||
    event.principalUser ||
    event.targetUser ||
    event.principalIp ||
    event.targetIp ||
    undefined
  );
}

export function importedAlertMarkdown(data: {
  productName: string;
  connectionName: string;
  event: NormalizedSecurityEvent;
}): MarkdownText {
  const parts: Array<MarkdownValue> = [
    mdText`An alert imported from **${data.productName}** through the connection **${data.connectionName}**.`,
  ];

  if (data.event.ruleName) {
    parts.push(mdText`Rule: ${FeedMarkdown.code(data.event.ruleName)}`);
  }

  if (data.event.message) {
    parts.push(mdText`${FeedMarkdown.code(data.event.message)}`);
  }

  return FeedMarkdown.join(parts, "\n\n");
}

/*
 * Turns a poll's newly imported alerts into case detections: every finding
 * at or above the connection's "Open Cases From Severity" becomes a
 * detection, which opens a case or joins the open case about the same host,
 * user or address (SecurityCaseIngest). Ordinary imported events - sign-ins,
 * network flows - stay events; only the product's own alerts are signals.
 *
 * Never throws: the alerts are imported already, and a case that could not
 * be opened must not fail the poll that imported them.
 */
export default class SecurityConnectionCases {
  public static async recordImportedAlerts(data: {
    connection: SecurityEventConnection;
    // The connector's catalog entry: the product the alerts came from.
    definition: { productName: string };
    events: Array<NormalizedSecurityEvent>;
  }): Promise<number> {
    try {
      const alerts: Array<NormalizedSecurityEvent> = data.events.filter(
        (event: NormalizedSecurityEvent): boolean => {
          return IMPORTED_ALERT_CLASS_UIDS.includes(event.classUid);
        },
      );

      if (
        alerts.length === 0 ||
        !data.connection.id ||
        !data.connection.projectId
      ) {
        return 0;
      }

      const settings: SecurityEventConnection | null =
        await SecurityEventConnectionService.findOneById({
          id: data.connection.id,
          select: {
            caseMinimumSeverity: true,
          },
          props: {
            isRoot: true,
          },
        });

      const minimum: OcsfSeverity | null = readCaseMinimumSeverity(
        settings?.caseMinimumSeverity,
      );

      if (!minimum) {
        await this.recordRisk(data);
        return 0;
      }

      const projectId: ObjectID = data.connection.projectId;
      const connectionId: ObjectID = data.connection.id;

      const signals: Array<SecurityDetectionSignal> = alerts
        .filter((event: NormalizedSecurityEvent): boolean => {
          return isAtLeastSeverity(event.severityName, minimum);
        })
        .slice(0, IMPORTED_ALERTS_PER_POLL_LIMIT)
        .map((event: NormalizedSecurityEvent): SecurityDetectionSignal => {
          const title: string =
            event.ruleName ||
            event.message ||
            `${data.definition.productName} alert`;
          const groupValue: string | undefined = importedAlertGroupValue(event);

          return {
            projectId,
            source: SecurityDetectionSource.ConnectedProduct,
            // One product alert is one detection, however often it is re-read.
            fingerprint: `connection:${connectionId.toString()}:${event.eventUid}`,
            title:
              groupValue && !title.includes(groupValue)
                ? `${title} — ${groupValue}`
                : title,
            description: importedAlertMarkdown({
              productName: data.definition.productName,
              connectionName:
                data.connection.name || data.definition.productName,
              event,
            }).toString(),
            severity: event.severityName,
            eventCount: 1,
            groupValue,
            entities: importedAlertEntities(event),
            mitreTactics: event.mitreTactics,
            mitreTechniques: event.mitreTechniques,
            ruleName: event.ruleName || data.definition.productName,
            securityEventConnectionId: connectionId,
            sampleMessage: event.message || undefined,
            eventUid: event.eventUid,
            seenAt: event.time,
          };
        });

      if (signals.length === 0) {
        await this.recordRisk(data);
        return 0;
      }

      const result: { casesOpened: number } =
        await SecurityCaseIngest.recordDetections(signals);

      // After the cases, so a risk that reaches the threshold joins theirs.
      await this.recordRisk(data);

      return result.casesOpened;
    } catch (error) {
      logger.error(
        `SecurityConnectionCases: could not open cases for connection ${data.connection.id?.toString()}:`,
      );
      logger.error(error);
      return 0;
    }
  }

  /*
   * Every imported alert, at any severity, adds to the risk of the user and
   * the host it is about: the product judged it, and an alert below the
   * connection's Open Cases From still says something about who it names.
   * Never throws (SecurityEntityRiskRecorder).
   */
  private static async recordRisk(data: {
    connection: SecurityEventConnection;
    definition: { productName: string };
    events: Array<NormalizedSecurityEvent>;
  }): Promise<void> {
    await SecurityEntityRiskRecorder.record(
      riskFindingsForImportedAlerts({
        connection: data.connection,
        productName: data.definition.productName,
        events: data.events,
      }),
    );
  }
}
