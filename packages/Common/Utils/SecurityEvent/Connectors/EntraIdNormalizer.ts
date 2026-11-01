import { JSONObject, JSONValue } from "../../../Types/JSON";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  flattenPayload,
  parseEventTime,
  readString,
  readValue,
} from "../NormalizerHelpers";
import { SecurityRecordReading } from "../SecurityRecordReading";
import {
  boundAttributes,
  readRemoteIpAddress,
} from "../LogParsers/SecurityLogLine";

/*
 * Microsoft Entra ID's own records -> security event readings
 * (SecurityRecordReading), wherever they were read:
 *
 *   - by the Microsoft Entra ID connection, from Microsoft Graph's
 *     /auditLogs/signIns and /auditLogs/directoryAudits
 *     (https://learn.microsoft.com/graph/api/resources/signin,
 *     .../resources/directoryaudit);
 *   - from the project's logs, where Azure's diagnostic settings export
 *     them: each record's `properties` is the same object Graph returns,
 *     under a category (SignInLogs, AuditLogs, UserRiskEvents...).
 *
 * So a sign-in reads the same, and has the same id, either way.
 *
 * Pure and isomorphic: Common/Types and Common/Utils only.
 */

export const ENTRA_ID_VENDOR_NAME: string = "Microsoft";
export const ENTRA_ID_PRODUCT_NAME: string = "Microsoft Entra ID";

// The attribute every Entra ID event carries: which of its logs it is from.
export const ENTRA_LOG_ATTRIBUTE: string = "entra.log";

export enum EntraLog {
  SignInLogs = "SignInLogs",
  NonInteractiveUserSignInLogs = "NonInteractiveUserSignInLogs",
  ServicePrincipalSignInLogs = "ServicePrincipalSignInLogs",
  AuditLogs = "AuditLogs",
  UserRiskEvents = "UserRiskEvents",
  RiskyUsers = "RiskyUsers",
}

const AUTHENTICATION: number = 3002;
const ACCOUNT_CHANGE: number = 3001;
const ENTITY_MANAGEMENT: number = 3004;
const USER_ACCESS_MANAGEMENT: number = 3005;
const GROUP_MANAGEMENT: number = 3006;
const DETECTION_FINDING: number = 2004;

/*
 * Sign-in error codes that are a step of a sign-in, not a failure of it:
 * MFA asked for, a password change or "stay signed in?" prompted, a
 * single sign-on attempt that falls back to a password. Counting them as
 * failures would make every MFA prompt look like a guessed password.
 * https://learn.microsoft.com/entra/identity-platform/reference-error-codes
 */
export const ENTRA_INTERRUPT_CODES: ReadonlyArray<number> = [
  50058, 50072, 50074, 50076, 50079, 50097, 50125, 50140, 50158, 50199, 81010,
  81012, 81014,
];

/*
 * Roles that administer the tenant itself (Microsoft's privileged roles):
 * one assigned is more than a routine change.
 */
export const PRIVILEGED_ENTRA_ROLES: ReadonlyArray<string> = [
  "global administrator",
  "privileged role administrator",
  "privileged authentication administrator",
  "security administrator",
  "application administrator",
  "cloud application administrator",
  "conditional access administrator",
  "authentication administrator",
  "authentication policy administrator",
  "hybrid identity administrator",
  "user administrator",
  "exchange administrator",
  "sharepoint administrator",
  "intune administrator",
  "domain name administrator",
  "external identity provider administrator",
  "partner tier2 support",
];

// Identity Protection's risk types, in the words its own portal uses.
export const ENTRA_RISK_EVENT_TITLES: Record<string, string> = {
  anonymizedIPAddress: "Anonymous IP address",
  unlikelyTravel: "Atypical travel",
  maliciousIPAddress: "Malicious IP address",
  unfamiliarFeatures: "Unfamiliar sign-in properties",
  malwareInfectedIPAddress: "Malware-linked IP address",
  suspiciousIPAddress: "Suspicious IP address",
  leakedCredentials: "Leaked credentials",
  investigationsThreatIntelligence: "Microsoft Entra threat intelligence",
  generic: "Additional risk detected",
  adminConfirmedUserCompromised: "Admin confirmed user compromised",
  passwordSpray: "Password spray",
  mcasImpossibleTravel: "Impossible travel",
  newCountry: "New country",
  impossibleTravel: "Impossible travel",
  mcasSuspiciousInboxManipulationRules: "Suspicious inbox manipulation rules",
  suspiciousInboxForwarding: "Suspicious inbox forwarding",
  anomalousToken: "Anomalous token",
  tokenIssuerAnomaly: "Token issuer anomaly",
  suspiciousBrowser: "Suspicious browser",
  riskyIPAddress: "Activity from a risky IP address",
  attackerinTheMiddle: "Attacker in the middle",
  suspiciousAPITraffic: "Suspicious API traffic",
};

const RISK_SEVERITIES: Record<string, OcsfSeverity> = {
  high: OcsfSeverity.High,
  medium: OcsfSeverity.Medium,
  low: OcsfSeverity.Low,
};

function text(value: JSONValue | undefined): string {
  if (value === null || value === undefined || typeof value === "object") {
    return "";
  }

  return String(value).trim();
}

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function asArray(value: unknown): Array<JSONValue> {
  return Array.isArray(value) ? (value as Array<JSONValue>) : [];
}

// A sign-in's error code as a number; 0 when it succeeded or said nothing.
export function readSignInErrorCode(signIn: JSONObject): number {
  const value: JSONValue = readValue(signIn, "status.errorCode");
  const code: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(code) ? Math.trunc(code) : 0;
}

export type EntraSignInOutcome = "Success" | "Failure" | "Interrupted";

export function readSignInOutcome(signIn: JSONObject): EntraSignInOutcome {
  const code: number = readSignInErrorCode(signIn);

  if (code === 0) {
    return "Success";
  }

  return ENTRA_INTERRUPT_CODES.includes(code) ? "Interrupted" : "Failure";
}

// The highest risk level a sign-in carries, "" when none.
function signInRisk(signIn: JSONObject): string {
  const levels: Array<string> = [
    text(signIn["riskLevelDuringSignIn"]),
    text(signIn["riskLevelAggregated"]),
  ].map((level: string): string => {
    return level.toLowerCase();
  });

  for (const level of ["high", "medium", "low"]) {
    if (levels.includes(level)) {
      return level;
    }
  }

  return "";
}

function placeOf(signIn: JSONObject): string {
  const city: string = text(readValue(signIn, "location.city"));
  const country: string = text(readValue(signIn, "location.countryOrRegion"));

  return [city, country]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(", ");
}

/*
 * A record's fields as the event's attributes, with which of Entra ID's
 * logs it is from. The applied Conditional Access policies run to dozens
 * of objects; boundAttributes keeps the first fields of a long record.
 */
function attributesOf(record: JSONObject, log: EntraLog): JSONObject {
  return {
    ...boundAttributes(flattenPayload(record)),
    [ENTRA_LOG_ATTRIBUTE]: log,
  };
}

/*
 * A sign-in. `log` says which kind: a person's interactive sign-in, one an
 * app made for them in the background, or an app's own.
 */
export function readEntraSignIn(
  signIn: JSONObject,
  log: EntraLog = EntraLog.SignInLogs,
): SecurityRecordReading {
  const outcome: EntraSignInOutcome = readSignInOutcome(signIn);
  const code: number = readSignInErrorCode(signIn);
  const reason: string = text(readValue(signIn, "status.failureReason"));
  const isServicePrincipal: boolean =
    log === EntraLog.ServicePrincipalSignInLogs;
  const user: string = isServicePrincipal
    ? text(signIn["servicePrincipalName"]) || text(signIn["appDisplayName"])
    : text(signIn["userPrincipalName"]) || text(signIn["userDisplayName"]);
  const app: string =
    text(signIn["appDisplayName"]) || text(signIn["resourceDisplayName"]);
  const ip: string = readRemoteIpAddress(text(signIn["ipAddress"]));
  const place: string = placeOf(signIn);
  const risk: string = signInRisk(signIn);

  let severity: OcsfSeverity =
    outcome === "Failure" ? OcsfSeverity.Low : OcsfSeverity.Informational;

  if (risk === "high") {
    severity = OcsfSeverity.High;
  } else if (risk === "medium") {
    severity = OcsfSeverity.Medium;
  }

  const who: string = user || "Someone";
  const where: string = `${app ? ` to ${app}` : ""}${ip ? ` from ${ip}` : ""}${place ? ` in ${place}` : ""}`;
  const because: string = reason
    ? `: ${reason}${code ? ` (${code})` : ""}`
    : code
      ? ` (${code})`
      : "";
  // "High-risk", "Medium-risk", or nothing for a sign-in at low or no risk.
  const riskWords: string =
    risk === "high" ? "High-risk" : risk === "medium" ? "Medium-risk" : "";

  let message: string = `${who} signed in${where}`;

  if (outcome === "Interrupted") {
    message = `${who}'s sign-in${where} needs another step${because}`;
  } else if (outcome === "Failure") {
    message = `${riskWords ? `${riskWords} failed` : "Failed"} sign-in for ${who}${where}${because}`;
  } else if (riskWords) {
    message = `${riskWords} sign-in: ${who} signed in${where}`;
  }

  const id: string = text(signIn["id"]);

  return {
    time: parseEventTime(signIn["createdDateTime"] ?? null),
    eventUid: id ? `entra:signin:${id}` : "",
    classUid: AUTHENTICATION,
    activityName: "Logon",
    statusName: outcome,
    severity,
    message,
    principalUser: user,
    principalIp: ip,
    principalHost: text(readValue(signIn, "deviceDetail.displayName")),
    targetResource: app,
    attributes: attributesOf(signIn, log),
  };
}

// A directory audit's targets, by type.
interface AuditTargets {
  user: string;
  other: string;
  role: string;
}

function readTargets(audit: JSONObject): AuditTargets {
  const targets: AuditTargets = { user: "", other: "", role: "" };

  for (const item of asArray(audit["targetResources"]).slice(0, 20)) {
    const target: JSONObject | null = asObject(item);

    if (!target) {
      continue;
    }

    const type: string = text(target["type"]).toLowerCase();
    const name: string =
      text(target["userPrincipalName"]) || text(target["displayName"]);

    if (type === "user" && !targets.user) {
      targets.user = name;
    } else if (type === "role" && !targets.role) {
      targets.role = text(target["displayName"]);
    } else if (!targets.other && name) {
      targets.other = name;
    }

    // "Add member to role" names the role in the user's changed properties.
    for (const property of asArray(target["modifiedProperties"]).slice(0, 30)) {
      const change: JSONObject | null = asObject(property);

      if (
        change &&
        !targets.role &&
        text(change["displayName"]) === "Role.DisplayName"
      ) {
        targets.role = text(change["newValue"]).split('"').join("").trim();
      }
    }
  }

  return targets;
}

/*
 * Which kind of change a directory audit is, by its category and, inside
 * a category, its activity.
 */
function auditClass(audit: JSONObject): number {
  const category: string = text(audit["category"]).toLowerCase();

  if (category === "usermanagement") {
    return ACCOUNT_CHANGE;
  }

  if (category === "groupmanagement") {
    return GROUP_MANAGEMENT;
  }

  if (category === "rolemanagement") {
    return USER_ACCESS_MANAGEMENT;
  }

  return ENTITY_MANAGEMENT;
}

export function readEntraDirectoryAudit(
  audit: JSONObject,
): SecurityRecordReading {
  const activity: string =
    text(audit["activityDisplayName"]) || "Directory change";
  const result: string = text(audit["result"]).toLowerCase();
  const actor: string =
    text(readValue(audit, "initiatedBy.user.userPrincipalName")) ||
    text(readValue(audit, "initiatedBy.user.displayName")) ||
    text(readValue(audit, "initiatedBy.app.displayName")) ||
    text(readValue(audit, "initiatedBy.app.servicePrincipalName"));
  const ip: string = readRemoteIpAddress(
    text(readValue(audit, "initiatedBy.user.ipAddress")),
  );
  const targets: AuditTargets = readTargets(audit);
  const isRoleAssignment: boolean = activity
    .toLowerCase()
    .includes("member to role");
  const isPrivileged: boolean =
    isRoleAssignment &&
    PRIVILEGED_ENTRA_ROLES.includes(targets.role.toLowerCase());
  const failed: boolean = result === "failure" || result === "timeout";

  let severity: OcsfSeverity = OcsfSeverity.Informational;

  if (isPrivileged) {
    severity = OcsfSeverity.Medium;
  } else if (failed) {
    severity = OcsfSeverity.Low;
  }

  const object: string = [targets.role, targets.user || targets.other]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(" → ");
  const id: string = text(audit["id"]);

  return {
    time: parseEventTime(audit["activityDateTime"] ?? null),
    eventUid: id ? `entra:audit:${id}` : "",
    classUid: auditClass(audit),
    activityName: activity,
    statusName:
      result === "success"
        ? "Success"
        : failed
          ? "Failure"
          : result
            ? `${result.charAt(0).toUpperCase()}${result.slice(1)}`
            : "",
    severity,
    message: `${actor || "Microsoft Entra ID"}: ${activity}${object ? ` (${object})` : ""}${failed && text(audit["resultReason"]) ? ` - ${text(audit["resultReason"])}` : ""}`,
    principalUser: actor,
    principalIp: ip,
    targetUser: targets.user,
    targetResource: targets.role || targets.other,
    attributes: attributesOf(audit, EntraLog.AuditLogs),
  };
}

/*
 * A risk Identity Protection detected (a riskDetection, as UserRiskEvents
 * exports it), or a user it marks as at risk (RiskyUsers).
 */
export function readEntraRisk(
  risk: JSONObject,
  log: EntraLog.UserRiskEvents | EntraLog.RiskyUsers,
): SecurityRecordReading | null {
  const level: string = text(risk["riskLevel"]).toLowerCase();
  const state: string = text(risk["riskState"]).toLowerCase();
  const user: string =
    text(risk["userPrincipalName"]) || text(risk["userDisplayName"]);

  // A risk dismissed, remediated or confirmed safe is no longer one.
  if (state && state !== "atrisk" && state !== "confirmedcompromised") {
    return null;
  }

  const type: string = text(risk["riskEventType"]) || text(risk["riskType"]);
  const title: string =
    log === EntraLog.RiskyUsers
      ? state === "confirmedcompromised"
        ? "User confirmed compromised"
        : "Risky user"
      : ENTRA_RISK_EVENT_TITLES[type] || type || "Risk detected";
  const id: string = text(risk["id"]);

  return {
    time: parseEventTime(
      risk["detectedDateTime"] ??
        risk["activityDateTime"] ??
        risk["riskLastUpdatedDateTime"] ??
        null,
    ),
    eventUid: id ? `entra:risk:${id}` : "",
    classUid: DETECTION_FINDING,
    activityName: "Create",
    statusName: state === "confirmedcompromised" ? "Confirmed" : "Detected",
    severity:
      state === "confirmedcompromised"
        ? OcsfSeverity.Critical
        : RISK_SEVERITIES[level] || OcsfSeverity.Medium,
    message: `Microsoft Entra ID Protection: ${title}${user ? ` for ${user}` : ""}${level ? ` (${level} risk)` : ""}`,
    ruleName: title,
    ruleId: type,
    principalUser: user,
    principalIp: readRemoteIpAddress(text(risk["ipAddress"])),
    attributes: attributesOf(risk, log),
  };
}

// Whether a record is a sign-in Graph's signIn shape describes.
export function isEntraSignIn(record: JSONObject): boolean {
  return (
    Boolean(readString(record, "createdDateTime")) &&
    readValue(record, "status") !== null &&
    Boolean(
      readString(record, "userPrincipalName") ||
        readString(record, "appId") ||
        readString(record, "servicePrincipalName"),
    )
  );
}

// Whether a record is a directory audit.
export function isEntraDirectoryAudit(record: JSONObject): boolean {
  return (
    Boolean(readString(record, "activityDisplayName")) &&
    Boolean(readString(record, "activityDateTime"))
  );
}
