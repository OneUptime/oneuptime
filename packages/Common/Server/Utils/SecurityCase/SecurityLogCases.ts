import ObjectID from "../../../Types/ObjectID";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  SecurityLogFormatDefinition,
  SecurityLogFormatGroup,
  getSecurityLogFormatDefinition,
  getSecurityLogFormatsInGroup,
} from "../../../Types/SecurityEvent/SecurityLogFormat";
import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import SecurityEntityRiskRecorder from "../SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import { riskFindingsForLogThreats } from "../SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import logger from "../Logger";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "./SecurityCaseIngest";
import {
  IMPORTED_ALERT_CLASS_UIDS,
  importedAlertEntities,
  importedAlertGroupValue,
  isAtLeastSeverity,
  readCaseMinimumSeverity,
} from "./SecurityConnectionCases";

/*
 * WHAT A SECURITY PRODUCT FOUND, IN THE LOGS, OPENS A CASE.
 *
 * "Your logs" reads security products' own records out of the project's
 * logs: a firewall's, an IDS's, a WAF's or an endpoint product's CEF or
 * LEEF, and a firewall's own syslog (Palo Alto Networks, FortiGate, Cisco
 * ASA) - the Security devices kinds. What such a product found - a threat,
 * an attack, a virus - is its own judgement, as an alert imported through
 * a connection is, so it opens cases the same way (SecurityConnectionCases):
 * every Detection Finding of those kinds at or above Your logs' "Open
 * Cases From Severity" becomes a detection, which opens a case or joins the
 * open case about the same host, user or address (SecurityCaseIngest), and
 * every one of them, at any severity, adds to the risk of who it names.
 *
 * Their sign-ins and blocked connections stay events: the product recorded
 * what happened, and the detection rules decide what it adds up to. The
 * other kinds Your logs reads (sign-ins, sudo, Windows events, cloud audit
 * records, web attacks) are a system's own records, not a security
 * product's verdict, and open no case of their own.
 *
 * Never throws: the events are stored already, and a case that could not
 * be opened must not fail the scan that stored them.
 */

// The kinds whose records are a security product's own: the Security devices group.
export const SECURITY_DEVICE_LOG_FORMATS: ReadonlyArray<SecurityLogFormat> =
  getSecurityLogFormatsInGroup(SecurityLogFormatGroup.SecurityDevices).map(
    (definition: SecurityLogFormatDefinition): SecurityLogFormat => {
      return definition.format;
    },
  );

/*
 * The most threats one scan sends to the case queue, so a backlog cannot
 * flood it: the scan hands what is left of it to each read (limit).
 */
export const LOG_THREATS_PER_SCAN_LIMIT: number = 200;

export interface SecurityLogThreatsResult {
  // Cases the threats opened; the rest joined cases already open.
  casesOpened: number;
  // Threats sent to the case queue: the ones at or above Open Cases From.
  detections: number;
}

// Whether an event is a threat a security product reported in the logs.
export function isSecurityDeviceThreat(
  event: NormalizedSecurityEvent,
): boolean {
  const format: string = String(
    event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE] || "",
  );

  return (
    (SECURITY_DEVICE_LOG_FORMATS as ReadonlyArray<string>).includes(format) &&
    IMPORTED_ALERT_CLASS_UIDS.includes(event.classUid) &&
    Boolean(event.eventUid)
  );
}

/*
 * The product a threat came from, as a person names it: "Fortinet
 * FortiGate", and "Cisco ASA" - never "Cisco Cisco ASA" - for a product
 * named after its vendor.
 */
export function getLogThreatProductName(
  event: NormalizedSecurityEvent,
): string {
  const vendor: string = (event.vendorName || "").trim();
  const product: string = (event.productName || "").trim();
  const named: string =
    vendor && product.toLowerCase().startsWith(vendor.toLowerCase())
      ? product
      : [vendor, product]
          .filter((part: string): boolean => {
            return Boolean(part);
          })
          .join(" ");

  if (named) {
    return named;
  }

  const format: string = String(
    event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE] || "",
  );

  return getSecurityLogFormatDefinition(format)?.title || "Security product";
}

export function logThreatMarkdown(
  event: NormalizedSecurityEvent,
): MarkdownText {
  const format: string = String(
    event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE] || "",
  );
  const formatTitle: string =
    getSecurityLogFormatDefinition(format)?.title || format;
  const parts: Array<MarkdownValue> = [
    mdText`A threat **${getLogThreatProductName(event)}** wrote in the project's logs (${formatTitle}), read by **Your logs**.`,
  ];

  if (event.ruleName) {
    parts.push(mdText`Rule: ${FeedMarkdown.code(event.ruleName)}`);
  }

  if (event.message) {
    parts.push(mdText`${FeedMarkdown.code(event.message)}`);
  }

  return FeedMarkdown.join(parts, "\n\n");
}

export function logThreatSignal(data: {
  projectId: ObjectID;
  event: NormalizedSecurityEvent;
}): SecurityDetectionSignal {
  const { event } = data;
  const product: string = getLogThreatProductName(event);
  const title: string = event.ruleName || event.message || `${product} threat`;
  const groupValue: string | undefined = importedAlertGroupValue(event);

  return {
    projectId: data.projectId,
    source: SecurityDetectionSource.ConnectedProduct,
    // One record is one detection, however often its window is read again.
    fingerprint: `logs:${event.eventUid}`,
    title:
      groupValue && !title.includes(groupValue)
        ? `${title} — ${groupValue}`
        : title,
    description: logThreatMarkdown(event).toString(),
    severity: event.severityName,
    eventCount: 1,
    groupValue,
    entities: importedAlertEntities(event),
    mitreTactics: event.mitreTactics,
    mitreTechniques: event.mitreTechniques,
    ruleName: event.ruleName || product,
    sampleMessage: event.message || undefined,
    eventUid: event.eventUid,
    seenAt: event.time,
  };
}

export default class SecurityLogCases {
  /*
   * Opens or joins cases for the threats among a scan's stored events at or
   * above `caseMinimumSeverity` (Your logs' Open Cases From Severity; empty
   * opens none), and adds every threat to the risk of who it names.
   */
  public static async recordThreats(data: {
    projectId: ObjectID;
    caseMinimumSeverity: string | null | undefined;
    events: Array<NormalizedSecurityEvent>;
    // The most threats sent to the case queue; LOG_THREATS_PER_SCAN_LIMIT when left out.
    limit?: number | undefined;
  }): Promise<SecurityLogThreatsResult> {
    const result: SecurityLogThreatsResult = { casesOpened: 0, detections: 0 };

    try {
      const threats: Array<NormalizedSecurityEvent> = data.events.filter(
        isSecurityDeviceThreat,
      );

      if (threats.length === 0) {
        return result;
      }

      const minimum: OcsfSeverity | null = readCaseMinimumSeverity(
        data.caseMinimumSeverity,
      );
      const limit: number = Math.max(
        0,
        data.limit === undefined ? LOG_THREATS_PER_SCAN_LIMIT : data.limit,
      );

      if (minimum && limit > 0) {
        const signals: Array<SecurityDetectionSignal> = threats
          .filter((event: NormalizedSecurityEvent): boolean => {
            return isAtLeastSeverity(event.severityName, minimum);
          })
          .slice(0, limit)
          .map((event: NormalizedSecurityEvent): SecurityDetectionSignal => {
            return logThreatSignal({ projectId: data.projectId, event });
          });

        if (signals.length > 0) {
          const ingested: { casesOpened: number } =
            await SecurityCaseIngest.recordDetections(signals);

          result.detections = signals.length;
          result.casesOpened = ingested.casesOpened;
        }
      }

      // After the cases, so a risk that reaches the threshold joins theirs.
      await SecurityEntityRiskRecorder.record(
        riskFindingsForLogThreats({
          projectId: data.projectId,
          threats,
          getProductName: getLogThreatProductName,
        }),
      );

      return result;
    } catch (error) {
      logger.error(
        `SecurityLogCases: could not open cases for the threats in project ${data.projectId.toString()}'s logs:`,
      );
      logger.error(error);
      return result;
    }
  }
}
