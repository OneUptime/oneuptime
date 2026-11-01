import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  flattenPayload,
  parseEventTime,
  readValue,
} from "../NormalizerHelpers";
import {
  SecurityRecordReading,
  toNormalizedSecurityEvent,
} from "../SecurityRecordReading";
import {
  boundAttributes,
  readRemoteIpAddress,
} from "../LogParsers/SecurityLogLine";

/*
 * Google Workspace's audit logs (the Admin SDK Reports API's activities,
 * https://developers.google.com/admin-sdk/reports/reference/rest/v1/activities)
 * -> security events.
 *
 * An activity is one thing someone did - an actor, when, from where - and
 * holds one or more events (a sign-in's login_success, an admin's
 * ASSIGN_ROLE), each with its parameters. Every event becomes a security
 * event of its own, keeping the activity's fields and the event's
 * (event.name, event.type, parameters.<name>), so a rule reads them as
 * Google's reference names them.
 *
 * Only what a security team looks at is an event: sign-ins and what
 * Google flagged about them, administrators' changes, apps given access to
 * data, accounts' own security settings, and - when the connection reads
 * Drive - files shared outside or downloaded. A sign-out is not.
 *
 * Pure and isomorphic: Common/Types and Common/Utils only.
 */

export const GOOGLE_WORKSPACE_VENDOR_NAME: string = "Google";
export const GOOGLE_WORKSPACE_PRODUCT_NAME: string = "Google Workspace";

// The Reports API applications the connection reads, the last only when asked.
export enum GoogleWorkspaceApplication {
  Login = "login",
  Admin = "admin",
  Token = "token",
  Saml = "saml",
  UserAccounts = "user_accounts",
  Drive = "drive",
}

export const GOOGLE_WORKSPACE_DEFAULT_APPLICATIONS: ReadonlyArray<GoogleWorkspaceApplication> =
  [
    GoogleWorkspaceApplication.Login,
    GoogleWorkspaceApplication.Admin,
    GoogleWorkspaceApplication.Token,
    GoogleWorkspaceApplication.Saml,
    GoogleWorkspaceApplication.UserAccounts,
  ];

const AUTHENTICATION: number = 3002;
const ACCOUNT_CHANGE: number = 3001;
const AUTHORIZE_SESSION: number = 3003;
const ENTITY_MANAGEMENT: number = 3004;
const USER_ACCESS_MANAGEMENT: number = 3005;
const GROUP_MANAGEMENT: number = 3006;
const DETECTION_FINDING: number = 2004;
const FILE_HOSTING_ACTIVITY: number = 6006;

// What Google tells about a sign-in it judged, by event name.
export const GOOGLE_LOGIN_FINDINGS: Record<
  string,
  { title: string; severity: OcsfSeverity }
> = {
  suspicious_login: {
    title: "Suspicious sign-in",
    severity: OcsfSeverity.Medium,
  },
  suspicious_login_less_secure_app: {
    title: "Suspicious sign-in from a less secure app",
    severity: OcsfSeverity.Medium,
  },
  suspicious_programmatic_login: {
    title: "Suspicious programmatic sign-in",
    severity: OcsfSeverity.Medium,
  },
  gov_attack_warning: {
    title: "Government-backed attack warning",
    severity: OcsfSeverity.High,
  },
  account_disabled_hijacked: {
    title: "Account disabled: hijacked",
    severity: OcsfSeverity.High,
  },
  account_disabled_password_leak: {
    title: "Account disabled: password leaked",
    severity: OcsfSeverity.High,
  },
  account_disabled_spamming: {
    title: "Account disabled: spamming",
    severity: OcsfSeverity.Medium,
  },
  account_disabled_spamming_through_relay: {
    title: "Account disabled: spamming through a relay",
    severity: OcsfSeverity.Medium,
  },
  account_disabled_generic: {
    title: "Account disabled by Google",
    severity: OcsfSeverity.Medium,
  },
  risky_sensitive_action_blocked: {
    title: "Risky sensitive action blocked",
    severity: OcsfSeverity.Medium,
  },
  risky_sensitive_action_allowed: {
    title: "Risky sensitive action allowed",
    severity: OcsfSeverity.Medium,
  },
};

// Admin events that grant power, by name.
export const GOOGLE_ADMIN_GRANTS: ReadonlyArray<string> = [
  "GRANT_ADMIN_PRIVILEGE",
  "ASSIGN_ROLE",
  "GRANT_DELEGATED_ADMIN_PRIVILEGES",
  "ADD_PRIVILEGE",
  "AUTHORIZE_API_CLIENT_ACCESS",
];

const ADMIN_REVOKES: ReadonlyArray<string> = [
  "REVOKE_ADMIN_PRIVILEGE",
  "UNASSIGN_ROLE",
  "REVOKE_DELEGATED_ADMIN_PRIVILEGES",
  "REMOVE_PRIVILEGE",
  "REMOVE_API_CLIENT_ACCESS",
];

// Admin events about a user account, as OCSF's Account Change activity.
const ADMIN_ACCOUNT_ACTIVITIES: Record<string, string> = {
  CREATE_USER: "Create",
  DELETE_USER: "Delete",
  SUSPEND_USER: "Disable",
  UNSUSPEND_USER: "Enable",
  RENAME_USER: "Rename",
  CHANGE_PASSWORD: "Password Reset",
  CHANGE_RECOVERY_EMAIL: "Update",
  CHANGE_RECOVERY_PHONE: "Update",
  ARCHIVE_USER: "Disable",
  UNARCHIVE_USER: "Enable",
  TURN_OFF_2_STEP_VERIFICATION: "MFA Factor Disable",
  CHANGE_TWO_STEP_VERIFICATION_ENFORCEMENT: "Update",
};

const ADMIN_GROUP_ACTIVITIES: Record<string, string> = {
  ADD_GROUP_MEMBER: "Add User",
  REMOVE_GROUP_MEMBER: "Remove User",
  CREATE_GROUP: "Create",
  DELETE_GROUP: "Delete",
};

// Drive events read when the connection reads Drive: sharing and downloads.
export const GOOGLE_DRIVE_EVENTS: ReadonlyArray<string> = [
  "change_user_access",
  "change_document_visibility",
  "change_document_access_scope",
  "change_acl_editors",
  "download",
];

// Drive visibilities that reach beyond the organization.
const DRIVE_OUTSIDE_VISIBILITIES: ReadonlyArray<string> = [
  "people_with_link",
  "public_on_the_web",
  "shared_externally",
  "public_in_the_domain",
];

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

/*
 * An event's parameters by name, each as text: a value, an int value, a
 * bool value, or a list of them joined with commas.
 */
export function readWorkspaceParameters(
  event: JSONObject,
): Record<string, string> {
  const parameters: Record<string, string> = {};
  const list: unknown = event["parameters"];

  if (!Array.isArray(list)) {
    return parameters;
  }

  for (const item of list.slice(0, 100)) {
    const parameter: JSONObject | null = asObject(item);
    const name: string = parameter ? text(parameter["name"]) : "";

    if (!parameter || !name || name === "__proto__") {
      continue;
    }

    let value: string =
      text(parameter["value"]) ||
      text(parameter["intValue"]) ||
      text(parameter["boolValue"]);

    for (const key of ["multiValue", "multiIntValue"]) {
      const multi: unknown = parameter[key];

      if (!value && Array.isArray(multi)) {
        value = multi
          .slice(0, 50)
          .map((entry: unknown): string => {
            return text(entry as JSONValue);
          })
          .filter((entry: string): boolean => {
            return entry.length > 0;
          })
          .join(",");
      }
    }

    parameters[name] = value;
  }

  return parameters;
}

// "ASSIGN_ROLE" and "login_failure" as words: "Assign role", "Login failure".
export function prettyWorkspaceName(name: string): string {
  const words: string = name.toLowerCase().split("_").join(" ").trim();

  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "";
}

interface WorkspaceEventContext {
  application: string;
  name: string;
  type: string;
  actor: string;
  ip: string;
  parameters: Record<string, string>;
}

type Classified = Pick<
  SecurityRecordReading,
  | "classUid"
  | "className"
  | "activityName"
  | "statusName"
  | "severity"
  | "message"
  | "ruleName"
  | "principalUser"
  | "targetUser"
  | "targetResource"
>;

function signInEvent(context: WorkspaceEventContext): Classified | null {
  const { name, actor, ip, parameters } = context;
  const who: string = parameters["affected_email_address"] || actor;
  const from: string = ip ? ` from ${ip}` : "";
  const finding: { title: string; severity: OcsfSeverity } | undefined =
    GOOGLE_LOGIN_FINDINGS[name];

  if (finding) {
    return {
      classUid: DETECTION_FINDING,
      activityName: "Create",
      statusName: "Detected",
      severity: finding.severity,
      message: `Google: ${finding.title}${who ? ` for ${who}` : ""}${from}`,
      ruleName: finding.title,
      principalUser: who,
    };
  }

  if (name === "login_success" || name === "login_failure") {
    const failed: boolean = name === "login_failure";
    const reason: string = prettyWorkspaceName(
      (parameters["login_failure_type"] || "").split("login_failure_").join(""),
    ).toLowerCase();

    return {
      classUid: AUTHENTICATION,
      activityName: "Logon",
      statusName: failed ? "Failure" : "Success",
      severity:
        parameters["is_suspicious"] === "true"
          ? OcsfSeverity.Medium
          : failed
            ? OcsfSeverity.Low
            : OcsfSeverity.Informational,
      message: `${failed ? `Failed Google sign-in for ${who || "someone"}` : `${who || "Someone"} signed in to Google`}${from}${failed && reason ? `: ${reason}` : ""}`,
      principalUser: who,
    };
  }

  if (name === "login_challenge" || name === "login_verification") {
    const status: string = parameters["login_challenge_status"] || "";

    return {
      classUid: AUTHENTICATION,
      activityName: "Logon",
      statusName: status.toLowerCase().includes("fail")
        ? "Failure"
        : "Challenge",
      severity: OcsfSeverity.Informational,
      message: `Google asked ${who || "someone"} to verify a sign-in${from}${status ? `: ${status}` : ""}`,
      principalUser: who,
    };
  }

  if (name === "logout") {
    return null;
  }

  return accountSecurityEvent(context);
}

// An account's own security settings: 2-Step Verification, recovery, password.
function accountSecurityEvent(context: WorkspaceEventContext): Classified {
  const { name, actor, parameters } = context;
  const who: string = parameters["affected_email_address"] || actor;
  const lower: string = name.toLowerCase();
  const weakens: boolean =
    lower.includes("disable") || lower.includes("unenroll");

  return {
    classUid: ACCOUNT_CHANGE,
    activityName: prettyWorkspaceName(name),
    statusName: "Success",
    severity: weakens ? OcsfSeverity.Low : OcsfSeverity.Informational,
    message: `${who || "An account"}: ${prettyWorkspaceName(name).toLowerCase()}`,
    principalUser: actor,
    targetUser: who,
  };
}

function adminEvent(context: WorkspaceEventContext): Classified {
  const { name, actor, parameters } = context;
  const user: string = parameters["USER_EMAIL"] || "";
  const role: string = parameters["ROLE_NAME"] || "";
  const group: string = parameters["GROUP_EMAIL"] || "";
  const app: string =
    parameters["API_CLIENT_NAME"] || parameters["APPLICATION_NAME"] || "";
  const setting: string = parameters["SETTING_NAME"] || "";
  const what: string = prettyWorkspaceName(name);
  const object: string = [role || group || app || setting, user]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(" → ");
  const message: string = `${actor || "An administrator"}: ${what}${object ? ` (${object})` : ""}`;

  if (GOOGLE_ADMIN_GRANTS.includes(name)) {
    return {
      classUid: USER_ACCESS_MANAGEMENT,
      activityName: "Assign Privileges",
      statusName: "Success",
      severity: OcsfSeverity.Medium,
      message,
      principalUser: actor,
      targetUser: user,
      targetResource: role || app,
    };
  }

  if (ADMIN_REVOKES.includes(name)) {
    return {
      classUid: USER_ACCESS_MANAGEMENT,
      activityName: "Revoke Privileges",
      statusName: "Success",
      severity: OcsfSeverity.Informational,
      message,
      principalUser: actor,
      targetUser: user,
      targetResource: role || app,
    };
  }

  const accountActivity: string | undefined = ADMIN_ACCOUNT_ACTIVITIES[name];

  if (accountActivity) {
    return {
      classUid: ACCOUNT_CHANGE,
      activityName: accountActivity,
      statusName: "Success",
      severity:
        name === "DELETE_USER" || name === "TURN_OFF_2_STEP_VERIFICATION"
          ? OcsfSeverity.Low
          : OcsfSeverity.Informational,
      message,
      principalUser: actor,
      targetUser: user,
    };
  }

  const groupActivity: string | undefined = ADMIN_GROUP_ACTIVITIES[name];

  if (groupActivity) {
    return {
      classUid: GROUP_MANAGEMENT,
      activityName: groupActivity,
      statusName: "Success",
      severity: OcsfSeverity.Informational,
      message,
      principalUser: actor,
      targetUser: user,
      targetResource: group,
    };
  }

  return {
    classUid: ENTITY_MANAGEMENT,
    activityName: what || "Update",
    statusName: "Success",
    severity: OcsfSeverity.Informational,
    message,
    principalUser: actor,
    targetUser: user,
    targetResource: setting || app || group || role,
  };
}

function tokenEvent(context: WorkspaceEventContext): Classified {
  const { name, actor, parameters } = context;
  const app: string = parameters["app_name"] || parameters["client_id"] || "";
  const scopes: string = parameters["scope"] || "";
  const what: string =
    name === "authorize"
      ? "gave an app access"
      : name === "revoke"
        ? "took an app's access away"
        : prettyWorkspaceName(name).toLowerCase();

  return {
    classUid: AUTHORIZE_SESSION,
    activityName: prettyWorkspaceName(name) || "Authorize",
    statusName: "Success",
    severity: OcsfSeverity.Informational,
    message: `${actor || "Someone"} ${what}${app ? `: ${app}` : ""}${scopes && name === "authorize" ? ` (${scopes.split(",").length} scope${scopes.split(",").length === 1 ? "" : "s"})` : ""}`,
    principalUser: actor,
    targetResource: app,
  };
}

function samlEvent(context: WorkspaceEventContext): Classified | null {
  const { name, actor, ip, parameters } = context;

  if (name !== "login_success" && name !== "login_failure") {
    return null;
  }

  const failed: boolean = name === "login_failure";
  const app: string = parameters["application_name"] || "";

  return {
    classUid: AUTHENTICATION,
    activityName: "Logon",
    statusName: failed ? "Failure" : "Success",
    severity: failed ? OcsfSeverity.Low : OcsfSeverity.Informational,
    message: `${failed ? "Failed single sign-on" : "Single sign-on"}${actor ? ` for ${actor}` : ""}${app ? ` to ${app}` : ""}${ip ? ` from ${ip}` : ""}`,
    principalUser: actor,
    targetResource: app,
  };
}

function driveEvent(context: WorkspaceEventContext): Classified | null {
  const { name, actor, parameters } = context;

  if (!GOOGLE_DRIVE_EVENTS.includes(name)) {
    return null;
  }

  const title: string = parameters["doc_title"] || parameters["doc_id"] || "";
  const visibility: string = (parameters["visibility"] || "").toLowerCase();
  const targetUser: string = (parameters["target_user"] || "").toLowerCase();
  const ownerDomain: string = (
    (parameters["owner"] || "").split("@")[1] || ""
  ).toLowerCase();
  // Shared with a person outside the owner's domain, or opened to a link.
  const sharedOutside: boolean =
    DRIVE_OUTSIDE_VISIBILITIES.includes(visibility) ||
    (Boolean(targetUser) &&
      Boolean(ownerDomain) &&
      !targetUser.endsWith(`@${ownerDomain}`));

  if (name === "download") {
    return {
      classUid: FILE_HOSTING_ACTIVITY,
      activityName: "Download",
      statusName: "Success",
      severity: OcsfSeverity.Informational,
      message: `${actor || "Someone"} downloaded ${title || "a file"} from Google Drive`,
      principalUser: actor,
      targetResource: title,
    };
  }

  return {
    classUid: FILE_HOSTING_ACTIVITY,
    activityName: "Share",
    statusName: "Success",
    severity: sharedOutside ? OcsfSeverity.Low : OcsfSeverity.Informational,
    message: `${actor || "Someone"} changed who can open ${title || "a file"} in Google Drive${visibility ? `: ${visibility.split("_").join(" ")}` : ""}`,
    principalUser: actor,
    targetUser: parameters["target_user"] || "",
    targetResource: title,
  };
}

function classify(context: WorkspaceEventContext): Classified | null {
  switch (context.application) {
    case GoogleWorkspaceApplication.Login:
      return signInEvent(context);
    case GoogleWorkspaceApplication.Admin:
      return adminEvent(context);
    case GoogleWorkspaceApplication.Token:
      return tokenEvent(context);
    case GoogleWorkspaceApplication.Saml:
      return samlEvent(context);
    case GoogleWorkspaceApplication.UserAccounts:
      return accountSecurityEvent(context);
    case GoogleWorkspaceApplication.Drive:
      return driveEvent(context);
    default:
      return null;
  }
}

// Whether a record is a Reports API activity.
export function isGoogleWorkspaceActivity(record: JSONObject): boolean {
  return (
    Boolean(text(readValue(record, "id.applicationName"))) &&
    Array.isArray(record["events"])
  );
}

/*
 * The security events an activity holds: one per event worth reading, in
 * the activity's order, each with an id of its own.
 */
export function readGoogleWorkspaceActivity(
  activity: JSONObject,
): Array<SecurityRecordReading> {
  const application: string = text(readValue(activity, "id.applicationName"));
  const uniqueQualifier: string = text(
    readValue(activity, "id.uniqueQualifier"),
  );
  const timeText: string = text(readValue(activity, "id.time"));
  const actor: string =
    text(readValue(activity, "actor.email")) ||
    text(readValue(activity, "actor.key"));
  const ip: string = readRemoteIpAddress(text(activity["ipAddress"]));
  const events: unknown = activity["events"];

  if (!application || !Array.isArray(events)) {
    return [];
  }

  // The activity's own fields; each event adds its own below.
  const withoutEvents: JSONObject = {};

  for (const key of Object.keys(activity)) {
    if (key !== "events") {
      withoutEvents[key] = activity[key] as JSONValue;
    }
  }

  const activityAttributes: JSONObject = boundAttributes(
    flattenPayload(withoutEvents),
  );
  const readings: Array<SecurityRecordReading> = [];

  events.slice(0, 50).forEach((item: unknown, index: number): void => {
    const event: JSONObject | null = asObject(item);

    if (!event) {
      return;
    }

    const name: string = text(event["name"]);
    const type: string = text(event["type"]);
    const parameters: Record<string, string> = readWorkspaceParameters(event);
    const classified: Classified | null = classify({
      application,
      name,
      type,
      actor,
      ip,
      parameters,
    });

    if (!classified) {
      return;
    }

    const attributes: JSONObject = {
      ...activityAttributes,
      "event.name": name,
      "event.type": type,
    };

    for (const key of Object.keys(parameters)) {
      attributes[`parameters.${key}`] = parameters[key]!;
    }

    readings.push({
      time: parseEventTime(timeText || null),
      eventUid:
        uniqueQualifier && timeText
          ? `google-workspace:${application}:${uniqueQualifier}:${timeText}:${index}`
          : "",
      principalIp: ip,
      ...classified,
      attributes,
    });
  });

  return readings;
}

function definition(): SecurityEventConnectorDefinition {
  const found: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(
      SecurityEventConnectorProvider.GoogleWorkspace,
    );

  if (!found) {
    throw new Error(
      "Google Workspace is missing from SecurityEventConnectorCatalog.",
    );
  }

  return found;
}

export default class GoogleWorkspaceNormalizer {
  public static isRecognized(record: JSONObject): boolean {
    return isGoogleWorkspaceActivity(record);
  }

  public static normalize(
    activity: JSONObject,
  ): Array<NormalizedSecurityEvent> {
    const catalog: SecurityEventConnectorDefinition = definition();

    return readGoogleWorkspaceActivity(activity).map(
      (reading: SecurityRecordReading): NormalizedSecurityEvent => {
        return toNormalizedSecurityEvent({
          reading,
          vendorName: catalog.vendorName,
          productName: catalog.productName,
          raw: activity,
        });
      },
    );
  }
}
