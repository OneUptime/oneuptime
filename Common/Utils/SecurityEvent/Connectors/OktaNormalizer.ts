import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  buildObservables,
  contentHashEventUid,
  flattenPayload,
  parseEventTime,
  readString,
  readValue,
} from "../NormalizerHelpers";
import { prettifyUdmEventType } from "../UdmNormalizer";

/*
 * Okta System Log event (the `LogEvent` object of
 * GET /api/v1/logs) -> OCSF identity events.
 *
 * The payload shape is the LogEvent schema of the Okta management
 * OpenAPI specification
 * (https://developer.okta.com/docs/api/openapi/okta-management/management/tag/SystemLog/):
 * `uuid`, `published`, `eventType`, `displayMessage`, `severity`
 * (DEBUG/INFO/WARN/ERROR), `outcome.result` (SUCCESS/FAILURE/SKIPPED/
 * ALLOW/DENY/CHALLENGE/UNKNOWN/...), `actor`, `client`, `target[]`,
 * `authenticationContext`, `securityContext`, `debugContext`.
 *
 * The System Log is one stream of very different things — sign-ins, MFA
 * challenges, account edits, group membership, policy evaluations, API
 * token lifecycle — so the OCSF class is chosen from the `eventType`
 * prefix (the attribute Okta itself uses to categorize events). Anything
 * without an OCSF equivalent keeps class 0 with a class name derived from
 * the event type, so nothing is dropped for not mapping.
 *
 * Pure and isomorphic on purpose — this file imports only from
 * Common/Types and Common/Utils so it runs unchanged in the server, in
 * tests and in the browser.
 */

export const OKTA_AUTHENTICATION_CLASS_UID: number = 3002;
export const OKTA_AUTHENTICATION_CLASS_NAME: string = "Authentication";
export const OKTA_ACCOUNT_CHANGE_CLASS_UID: number = 3001;
export const OKTA_ACCOUNT_CHANGE_CLASS_NAME: string = "Account Change";
export const OKTA_GROUP_MANAGEMENT_CLASS_UID: number = 3006;
export const OKTA_GROUP_MANAGEMENT_CLASS_NAME: string = "Group Management";
export const OKTA_DETECTION_FINDING_CLASS_UID: number = 2004;
export const OKTA_DETECTION_FINDING_CLASS_NAME: string = "Detection Finding";

/*
 * Okta's four severities onto OCSF. WARN and ERROR are graded higher than
 * the generic syslog aliases in normalizeOcsfSeverity would put them:
 * Okta reserves WARN for things like rate-limit warnings, suspicious
 * activity reports and failed policy evaluations, and ERROR for failures
 * of Okta's own processing — both worth a look, not a log line.
 */
export const OKTA_SEVERITY_MAP: Record<string, OcsfSeverity> = {
  DEBUG: OcsfSeverity.Informational,
  INFO: OcsfSeverity.Informational,
  WARN: OcsfSeverity.Medium,
  ERROR: OcsfSeverity.High,
};

/*
 * `outcome.result` values (the LogOutcome enum) as the status words the
 * rest of the product uses. Values Okta adds later fall through to a
 * prettified copy of the raw word rather than being lost.
 */
export const OKTA_OUTCOME_STATUS_MAP: Record<string, string> = {
  SUCCESS: "Success",
  FAILURE: "Failure",
  SKIPPED: "Skipped",
  ALLOW: "Allowed",
  DENY: "Denied",
  CHALLENGE: "Challenge",
  UNKNOWN: "Unknown",
  RATE_LIMIT: "Rate Limited",
  DEFERRED: "Deferred",
  SCHEDULED: "Scheduled",
  ABANDONED: "Abandoned",
  UNANSWERED: "Unanswered",
};

/*
 * Outcomes that mean the actor did NOT get what it asked for. On an
 * Authentication event these raise an INFO severity to Low: a failed
 * sign-in is routine in isolation but is the unit every brute-force and
 * password-spray detection counts, so it must not be indistinguishable
 * from a successful one at the severity column.
 */
const FAILED_OUTCOMES: Set<string> = new Set<string>(["FAILURE", "DENY"]);

/*
 * Okta stamps `alternateId: "unknown"` on targets that have no natural
 * identifier (authenticator enrollments, for example). It is not an
 * observable — every event mentioning "unknown" is not a useful query.
 */
const PLACEHOLDER_IDENTIFIER: string = "unknown";

interface OktaEventClassification {
  classUid: number;
  className: string;
  activityName: string;
  ruleName: string;
}

interface OktaTarget {
  id: string;
  type: string;
  alternateId: string;
  displayName: string;
}

function definition(): SecurityEventConnectorDefinition {
  const found: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(
      SecurityEventConnectorProvider.OktaSystemLog,
    );

  if (!found) {
    /*
     * The catalog is a static list that always carries this provider; the
     * throw only exists so a future catalog edit cannot silently attribute
     * events to an empty vendor and break the dedupe scope.
     */
    throw new Error(
      "Okta System Log is missing from SecurityEventConnectorCatalog.",
    );
  }

  return found;
}

/*
 * "user.account.update_password" -> "Update Password": the last
 * dot-separated segment, words split on underscores and capitalized.
 */
function prettifyLastSegment(eventType: string): string {
  const segments: Array<string> = eventType
    .split(".")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });
  const last: string = segments[segments.length - 1] || "";

  return prettifyUdmEventType(last.replace(/[\s.-]+/g, "_"));
}

/*
 * "system.api_token.create" -> "System Api Token Create", the same
 * treatment GenericNormalizer gives free-form type strings, so an
 * unmapped Okta event reads like an unmapped event from any other source.
 */
function prettifyEventType(eventType: string): string {
  return prettifyUdmEventType(eventType.replace(/[\s.-]+/g, "_"));
}

function readTargets(raw: JSONObject): Array<OktaTarget> {
  const value: JSONValue = readValue(raw, "target");

  if (!Array.isArray(value)) {
    return [];
  }

  const targets: Array<OktaTarget> = [];

  for (const item of value as Array<JSONValue>) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const target: JSONObject = item as JSONObject;

    targets.push({
      id: readString(target, "id"),
      type: readString(target, "type"),
      alternateId: readString(target, "alternateId"),
      displayName: readString(target, "displayName"),
    });
  }

  return targets;
}

function identifierOf(target: OktaTarget | undefined): string {
  if (!target) {
    return "";
  }

  if (
    target.alternateId &&
    target.alternateId.toLowerCase() !== PLACEHOLDER_IDENTIFIER
  ) {
    return target.alternateId;
  }

  return target.displayName;
}

export default class OktaNormalizer {
  /*
   * A record is a System Log event when it carries an `eventType` (the
   * attribute every LogEvent has and the one this normalizer keys on)
   * together with either its `uuid` or its `published` time. Okta's error
   * envelope ({ errorCode, errorSummary, ... }) has none of these and is
   * rejected rather than stored as a meaningless row.
   */
  public static isRecognized(raw: JSONObject): boolean {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return false;
    }

    const eventType: string = readString(raw, "eventType");

    if (!eventType) {
      return false;
    }

    return Boolean(readString(raw, "uuid") || readString(raw, "published"));
  }

  /*
   * Which OCSF class an event type lands in, by prefix. Documented event
   * families: https://developer.okta.com/docs/reference/api/event-types/
   */
  public static classify(
    eventType: string,
    outcomeResult: string,
  ): OktaEventClassification {
    const type: string = eventType.trim();
    const lower: string = type.toLowerCase();

    if (lower === "user.session.start") {
      return {
        classUid: OKTA_AUTHENTICATION_CLASS_UID,
        className: OKTA_AUTHENTICATION_CLASS_NAME,
        activityName: "Logon",
        ruleName: "",
      };
    }

    if (lower === "user.session.end") {
      return {
        classUid: OKTA_AUTHENTICATION_CLASS_UID,
        className: OKTA_AUTHENTICATION_CLASS_NAME,
        activityName: "Logoff",
        ruleName: "",
      };
    }

    if (lower.startsWith("user.mfa.")) {
      return {
        classUid: OKTA_AUTHENTICATION_CLASS_UID,
        className: OKTA_AUTHENTICATION_CLASS_NAME,
        activityName: "Authentication Ticket",
        ruleName: "",
      };
    }

    if (lower.startsWith("user.authentication.")) {
      return {
        classUid: OKTA_AUTHENTICATION_CLASS_UID,
        className: OKTA_AUTHENTICATION_CLASS_NAME,
        activityName: "Logon",
        ruleName: "",
      };
    }

    /*
     * Remaining session events (access_admin_app, impersonation.*, context
     * changes) are still about an authenticated session but are neither a
     * logon nor a logoff.
     */
    if (lower.startsWith("user.session.")) {
      return {
        classUid: OKTA_AUTHENTICATION_CLASS_UID,
        className: OKTA_AUTHENTICATION_CLASS_NAME,
        activityName: "Other",
        ruleName: "",
      };
    }

    if (
      lower.startsWith("user.account.") ||
      lower.startsWith("user.lifecycle.")
    ) {
      return {
        classUid: OKTA_ACCOUNT_CHANGE_CLASS_UID,
        className: OKTA_ACCOUNT_CHANGE_CLASS_NAME,
        activityName: prettifyLastSegment(type),
        ruleName: "",
      };
    }

    if (lower.startsWith("group.")) {
      return {
        classUid: OKTA_GROUP_MANAGEMENT_CLASS_UID,
        className: OKTA_GROUP_MANAGEMENT_CLASS_NAME,
        activityName: prettifyLastSegment(type),
        ruleName: "",
      };
    }

    /*
     * security.* events are Okta's own detections (threat insight,
     * suspicious activity reports, session hijacking) and a sign-on policy
     * that DENIED access is a rule firing on the actor — both are findings
     * about the event, with the event type as the rule that produced them.
     */
    if (
      lower.startsWith("security.") ||
      (lower === "policy.evaluate_sign_on" &&
        outcomeResult.toUpperCase() === "DENY")
    ) {
      return {
        classUid: OKTA_DETECTION_FINDING_CLASS_UID,
        className: OKTA_DETECTION_FINDING_CLASS_NAME,
        activityName: "Create",
        ruleName: type,
      };
    }

    return {
      classUid: 0,
      className: prettifyEventType(type) || "Okta event",
      activityName: prettifyLastSegment(type),
      ruleName: "",
    };
  }

  public static severityFor(
    severityText: string,
    classUid: number,
    outcomeResult: string,
  ): OcsfSeverity {
    const key: string = severityText.trim().toUpperCase();
    let severity: OcsfSeverity =
      OKTA_SEVERITY_MAP[key] ||
      normalizeOcsfSeverity(severityText) ||
      OcsfSeverity.Unknown;

    if (
      classUid === OKTA_AUTHENTICATION_CLASS_UID &&
      severity === OcsfSeverity.Informational &&
      FAILED_OUTCOMES.has(outcomeResult.toUpperCase())
    ) {
      severity = OcsfSeverity.Low;
    }

    return severity;
  }

  public static statusFor(outcomeResult: string): string {
    const key: string = outcomeResult.trim().toUpperCase();

    if (!key) {
      return "";
    }

    return OKTA_OUTCOME_STATUS_MAP[key] || prettifyUdmEventType(key);
  }

  public static normalize(raw: JSONObject): NormalizedSecurityEvent {
    const catalog: SecurityEventConnectorDefinition = definition();

    const eventType: string = readString(raw, "eventType");
    const outcomeResult: string = readString(raw, "outcome.result");
    const outcomeReason: string = readString(raw, "outcome.reason");
    const displayMessage: string = readString(raw, "displayMessage");

    const classification: OktaEventClassification = OktaNormalizer.classify(
      eventType,
      outcomeResult,
    );
    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      classification.classUid,
    );

    const severityName: OcsfSeverity = OktaNormalizer.severityFor(
      readString(raw, "severity"),
      classification.classUid,
      outcomeResult,
    );

    /*
     * `published` is both the poll basis and the row's time: Okta stamps
     * it when the event is written, which for the System Log is the event
     * itself. A payload without it gets "now" rather than a guess.
     */
    const time: Date | null = parseEventTime(readValue(raw, "published"));

    /*
     * `uuid` is the event's own stable identifier and the dedupe key
     * across the overlap re-read; a payload without one gets a content
     * hash so identical deliveries still collapse.
     */
    const eventUid: string =
      readString(raw, "uuid") || contentHashEventUid(raw);

    const actorAlternateId: string = readString(raw, "actor.alternateId");
    const actorDisplayName: string = readString(raw, "actor.displayName");
    const clientIp: string = readString(raw, "client.ipAddress");

    const targets: Array<OktaTarget> = readTargets(raw);
    const userTarget: OktaTarget | undefined = targets.find(
      (target: OktaTarget): boolean => {
        return target.type.toLowerCase() === "user";
      },
    );
    const applicationTarget: OktaTarget | undefined = targets.find(
      (target: OktaTarget): boolean => {
        const type: string = target.type.toLowerCase();
        return type === "appinstance" || type === "application";
      },
    );

    const message: string =
      displayMessage ||
      (outcomeReason ? `${eventType}: ${outcomeReason}` : eventType) ||
      "Okta System Log event";

    return {
      time: time || new Date(),
      eventUid,
      categoryUid,
      categoryName,
      classUid: classification.classUid,
      className: classification.className,
      activityName: classification.activityName,
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: OktaNormalizer.statusFor(outcomeResult),
      message,
      vendorName: catalog.vendorName,
      productName: catalog.productName,
      ruleId: "",
      ruleName: classification.ruleName,
      mitreTactics: [],
      mitreTechniques: [],
      principalUser: actorAlternateId || actorDisplayName,
      principalHost: "",
      principalIp: clientIp,
      principalProcess: "",
      targetUser: identifierOf(userTarget),
      targetHost: "",
      targetIp: "",
      targetPort: 0,
      targetResource: identifierOf(applicationTarget),
      observables: buildObservables([
        actorAlternateId,
        ...targets.map((target: OktaTarget): string => {
          return target.alternateId.toLowerCase() === PLACEHOLDER_IDENTIFIER
            ? ""
            : target.alternateId;
        }),
        clientIp,
      ]),
      attributes: flattenPayload(raw),
    };
  }
}
