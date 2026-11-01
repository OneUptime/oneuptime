import { JSONObject, JSONValue } from "../../../Types/JSON";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import { flattenPayload, parseEventTime } from "../NormalizerHelpers";
import { SecurityRecordReading } from "../SecurityRecordReading";
import {
  boundAttributes,
  readRemoteIpAddress,
} from "../LogParsers/SecurityLogLine";

/*
 * The Microsoft 365 audit log (the Office 365 Management Activity API's
 * records, learn.microsoft.com/office/office-365-management-api/office-365-
 * management-activity-api-schema) -> security event readings, for the
 * Microsoft Entra ID connection that reads it.
 *
 * The audit log records nearly everything everyone does in Exchange,
 * SharePoint, OneDrive and Teams - every mail item read, every file
 * opened. A security team acts on a few kinds of it, and only those are
 * read:
 *
 *   - Exchange: the cmdlets people run (an inbox rule, a mailbox's
 *     forwarding, a permission, a transport rule - by an administrator or
 *     by Outlook on the web; Exchange's own system runs are left out
 *     unless they forward mail), inbox rules made in Outlook, and mail
 *     sent as or on behalf of someone else;
 *   - SharePoint and OneDrive: files shared, links anyone can open, site
 *     collection administrators and sharing policies changed;
 *   - Microsoft Defender for Office 365's phish and malware verdicts on
 *     mail, and the alerts Microsoft 365 raises;
 *   - Teams: an app, a bot or a connector added to a team.
 *
 * Microsoft Entra ID's own records come from Microsoft Graph, so this
 * reads no Audit.AzureActiveDirectory content.
 *
 * Pure and isomorphic: Common/Types and Common/Utils only.
 */

// Every Microsoft 365 event carries the content type it came from.
export const MICROSOFT_365_CONTENT_TYPE_ATTRIBUTE: string =
  "microsoft365.contentType";

/*
 * Set to "true" on a rule or a mailbox setting that sends mail somewhere
 * else: what a library rule reads, whichever of Exchange's ways set it.
 */
export const MICROSOFT_365_FORWARDS_MAIL_ATTRIBUTE: string =
  "microsoft365.forwardsMail";

// Set to "true" on a share with someone outside the organization.
export const MICROSOFT_365_SHARED_OUTSIDE_ATTRIBUTE: string =
  "microsoft365.sharedOutside";

// RecordType values (the schema's AuditLogRecordType enumeration).
export const MICROSOFT_365_RECORD_TYPES: {
  exchangeAdmin: number;
  exchangeItem: number;
  exchangeItemGroup: number;
  sharePoint: number;
  sharePointSharingOperation: number;
  microsoftTeams: number;
  threatIntelligence: number;
  securityComplianceAlerts: number;
} = {
  exchangeAdmin: 1,
  exchangeItem: 2,
  exchangeItemGroup: 3,
  sharePoint: 4,
  sharePointSharingOperation: 14,
  microsoftTeams: 25,
  threatIntelligence: 28,
  securityComplianceAlerts: 40,
};

// The schema's UserType for Exchange's own system account.
const SYSTEM_USER_TYPE: number = 4;

const EXCHANGE_ITEM_OPERATIONS: ReadonlyArray<string> = [
  "UpdateInboxRules",
  "SendAs",
  "SendOnBehalf",
];

// Cmdlets that give someone access to another person's mail.
export const EXCHANGE_PERMISSION_CMDLETS: ReadonlyArray<string> = [
  "Add-MailboxPermission",
  "Add-RecipientPermission",
  "Add-MailboxFolderPermission",
  "Set-MailboxFolderPermission",
];

export const SHARING_OPERATIONS: ReadonlyArray<string> = [
  "AnonymousLinkCreated",
  "AnonymousLinkUpdated",
  "SharingInvitationCreated",
  "SharingSet",
  "CompanyLinkCreated",
  "SecureLinkCreated",
  "AddedToSecureLink",
];

// Who a share reached, when it reached outside the organization.
const OUTSIDE_SHARING_TARGETS: ReadonlyArray<string> = ["guest", "partner"];

const SHAREPOINT_ADMIN_OPERATIONS: ReadonlyArray<string> = [
  "SiteCollectionAdminAdded",
  "SiteCollectionAdminRemoved",
  "SharingPolicyChanged",
];

const TEAMS_OPERATIONS: ReadonlyArray<string> = [
  "AppInstalled",
  "BotAddedToTeam",
  "ConnectorAdded",
];

// The verdicts of Defender for Office 365 that are a finding.
const THREAT_VERDICTS: ReadonlyArray<string> = ["malware", "phish"];

/*
 * The cmdlet parameters that send mail elsewhere: an inbox rule's, a
 * mailbox's forwarding, a transport rule's redirect or hidden copy.
 */
const FORWARDING_PARAMETERS: ReadonlyArray<string> = [
  "ForwardTo",
  "ForwardAsAttachmentTo",
  "RedirectTo",
  "ForwardingSmtpAddress",
  "ForwardingAddress",
  "RedirectMessageTo",
  "BlindCopyTo",
];

// The Outlook rule actions that send mail elsewhere, lowercase.
const FORWARDING_RULE_ACTIONS: ReadonlyArray<string> = [
  "forwardtorecipientsaction",
  "forwardasattachmenttorecipientsaction",
  "redirecttorecipientsaction",
];

const API_ACTIVITY: number = 6003;
const DETECTION_FINDING: number = 2004;
const USER_ACCESS_MANAGEMENT: number = 3005;
const APPLICATION_LIFECYCLE: number = 6002;
const FILE_HOSTING_ACTIVITY: number = 6006;

const ALERT_SEVERITIES: Record<string, OcsfSeverity> = {
  high: OcsfSeverity.High,
  medium: OcsfSeverity.Medium,
  low: OcsfSeverity.Low,
  informational: OcsfSeverity.Informational,
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

/*
 * A record's name/value list (an Exchange cmdlet's Parameters, Outlook's
 * OperationProperties) as a map.
 */
export function readNamedValues(value: unknown): Record<string, string> {
  const named: Record<string, string> = {};

  if (!Array.isArray(value)) {
    return named;
  }

  for (const item of value.slice(0, 100)) {
    const entry: JSONObject | null = asObject(item);
    const name: string = entry ? text(entry["Name"]) : "";

    if (entry && name && name !== "__proto__") {
      named[name] = text(entry["Value"]);
    }
  }

  return named;
}

/*
 * The address a record names its client by: "203.0.113.7",
 * "203.0.113.7:51234", "[2001:db8::7]:443", "2001:db8::7" or
 * "::ffff:203.0.113.7".
 */
export function readClientIp(value: string): string {
  let address: string = value.trim();

  if (address.startsWith("[")) {
    const close: number = address.indexOf("]");
    address = close === -1 ? address.slice(1) : address.slice(1, close);
  } else if (
    address.indexOf(".") !== -1 &&
    address.indexOf(":") !== -1 &&
    address.indexOf(":") === address.lastIndexOf(":")
  ) {
    // IPv4 with a port: one colon, after the address.
    address = address.slice(0, address.indexOf(":"));
  }

  return readRemoteIpAddress(address);
}

// The schema's CreationTime is UTC written without a zone.
export function readCreationTime(value: string): Date | null {
  if (!value) {
    return null;
  }

  const hasZone: boolean =
    value.endsWith("Z") ||
    value.indexOf("+") > 10 ||
    value.lastIndexOf("-") > 10;

  return parseEventTime(hasZone ? value : `${value}Z`);
}

function forwardsMail(
  operation: string,
  parameters: Record<string, string>,
  properties: Record<string, string>,
): boolean {
  if (
    FORWARDING_PARAMETERS.some((name: string): boolean => {
      const value: string = (parameters[name] || "").toLowerCase();

      // Clearing a forwarding address sends it as empty or $null.
      return value.length > 0 && value !== "$null";
    })
  ) {
    return true;
  }

  if (operation !== "UpdateInboxRules") {
    return false;
  }

  const actions: string = (properties["RuleActions"] || "").toLowerCase();

  return FORWARDING_RULE_ACTIONS.some((action: string): boolean => {
    return actions.indexOf(action) !== -1;
  });
}

function statusOf(record: JSONObject): string {
  const result: string = text(record["ResultStatus"]).toLowerCase();

  if (result === "false" || result === "failed" || result === "failure") {
    return "Failure";
  }

  return "Success";
}

// What every reading of a record shares.
type Base = Pick<
  SecurityRecordReading,
  "time" | "eventUid" | "principalUser" | "principalIp" | "attributes"
>;

function exchangeReading(
  record: JSONObject,
  base: Base,
  context: {
    operation: string;
    user: string;
    objectId: string;
    status: string;
    parameters: Record<string, string>;
    properties: Record<string, string>;
  },
): SecurityRecordReading | null {
  const { operation, user, objectId, status, parameters, properties } = context;
  const forwards: boolean = forwardsMail(operation, parameters, properties);
  const who: string = user || "Someone";

  // Exchange's own housekeeping runs as SYSTEM, many times an hour.
  if (Number(record["UserType"]) === SYSTEM_USER_TYPE && !forwards) {
    return null;
  }

  if (forwards) {
    base.attributes[MICROSOFT_365_FORWARDS_MAIL_ATTRIBUTE] = "true";
  }

  if (operation === "SendAs" || operation === "SendOnBehalf") {
    const owner: string =
      text(record["SendAsUserSmtp"]) ||
      text(record["SendOnBehalfOfUserSmtp"]) ||
      text(record["MailboxOwnerUPN"]) ||
      objectId;

    return {
      ...base,
      classUid: API_ACTIVITY,
      activityName: operation,
      statusName: status,
      severity: OcsfSeverity.Low,
      message: `${who} sent mail ${operation === "SendAs" ? "as" : "on behalf of"} ${owner || "another mailbox"}`,
      targetUser: owner,
      targetResource: text(readItemSubject(record)),
    };
  }

  const target: string =
    parameters["ForwardingSmtpAddress"] ||
    parameters["ForwardingAddress"] ||
    parameters["ForwardTo"] ||
    parameters["RedirectTo"] ||
    parameters["ForwardAsAttachmentTo"] ||
    parameters["RedirectMessageTo"] ||
    parameters["BlindCopyTo"] ||
    "";
  const grantsAccess: boolean = EXCHANGE_PERMISSION_CMDLETS.includes(operation);
  const grantee: string = parameters["User"] || parameters["Trustee"] || "";

  return {
    ...base,
    classUid: grantsAccess ? USER_ACCESS_MANAGEMENT : API_ACTIVITY,
    activityName: grantsAccess ? "Assign Privileges" : operation,
    statusName: status,
    severity: forwards
      ? OcsfSeverity.Medium
      : grantsAccess || status === "Failure"
        ? OcsfSeverity.Low
        : OcsfSeverity.Informational,
    message: `${who} ran ${operation}${objectId ? ` on ${objectId}` : ""} in Exchange${forwards ? `, sending mail on${target ? ` to ${target}` : ""}` : ""}${grantsAccess && grantee ? `, for ${grantee}` : ""}${status === "Failure" ? " (failed)" : ""}`,
    targetUser: grantee,
    targetResource: objectId,
  };
}

function readItemSubject(record: JSONObject): JSONValue | undefined {
  const item: JSONObject | null = asObject(record["Item"]);

  return item ? item["Subject"] : undefined;
}

/*
 * One audit record as a reading, or null for a record that is not one of
 * the kinds read.
 */
export function readMicrosoft365Record(
  record: JSONObject,
  contentType: string,
): SecurityRecordReading | null {
  const recordType: number = Number(record["RecordType"]);
  const operation: string = text(record["Operation"]);
  const user: string = text(record["UserId"]);
  const objectId: string = text(record["ObjectId"]);
  const workload: string = text(record["Workload"]);
  const id: string = text(record["Id"]);

  if (!operation || !Number.isFinite(recordType)) {
    return null;
  }

  const parameters: Record<string, string> = readNamedValues(
    record["Parameters"],
  );
  const properties: Record<string, string> = readNamedValues(
    record["OperationProperties"],
  );
  const attributes: JSONObject = {
    ...boundAttributes(flattenPayload(record)),
    [MICROSOFT_365_CONTENT_TYPE_ATTRIBUTE]: contentType,
  };

  // A cmdlet's parameters by name, so a rule reads Parameters.ForwardTo.
  for (const name of Object.keys(parameters).slice(0, 50)) {
    attributes[`Parameters.${name}`] = parameters[name]!.slice(0, 1000);
  }

  const base: Base = {
    time: readCreationTime(text(record["CreationTime"])),
    eventUid: id ? `m365:${id}` : "",
    principalUser: user,
    principalIp: readClientIp(
      text(record["ClientIP"]) || text(record["ClientIPAddress"]),
    ),
    attributes,
  };
  const status: string = statusOf(record);
  const who: string = user || "Someone";

  if (
    recordType === MICROSOFT_365_RECORD_TYPES.exchangeAdmin ||
    ((recordType === MICROSOFT_365_RECORD_TYPES.exchangeItem ||
      recordType === MICROSOFT_365_RECORD_TYPES.exchangeItemGroup) &&
      EXCHANGE_ITEM_OPERATIONS.includes(operation))
  ) {
    return exchangeReading(record, base, {
      operation,
      user,
      objectId,
      status,
      parameters,
      properties,
    });
  }

  if (
    recordType === MICROSOFT_365_RECORD_TYPES.sharePointSharingOperation &&
    SHARING_OPERATIONS.includes(operation)
  ) {
    const file: string =
      text(record["SourceFileName"]) || objectId || text(record["SiteUrl"]);
    const withWhom: string = text(record["TargetUserOrGroupName"]);
    const anonymous: boolean = operation.startsWith("AnonymousLink");
    const outside: boolean =
      anonymous ||
      OUTSIDE_SHARING_TARGETS.includes(
        text(record["TargetUserOrGroupType"]).toLowerCase(),
      );
    const place: string = workload || "SharePoint";

    if (outside) {
      attributes[MICROSOFT_365_SHARED_OUTSIDE_ATTRIBUTE] = "true";
    }

    return {
      ...base,
      classUid: FILE_HOSTING_ACTIVITY,
      activityName: "Share",
      statusName: status,
      severity: outside ? OcsfSeverity.Low : OcsfSeverity.Informational,
      message: anonymous
        ? `${who} made a link anyone can open to ${file || "a file"} in ${place}`
        : `${who} shared ${file || "a file"} in ${place}${withWhom ? ` with ${outside ? "guest " : ""}${withWhom}` : ""}`,
      targetUser: anonymous ? "" : withWhom,
      targetResource: file,
    };
  }

  if (
    recordType === MICROSOFT_365_RECORD_TYPES.sharePoint &&
    SHAREPOINT_ADMIN_OPERATIONS.includes(operation)
  ) {
    const site: string = text(record["SiteUrl"]) || objectId;
    const added: boolean = operation === "SiteCollectionAdminAdded";
    const removed: boolean = operation === "SiteCollectionAdminRemoved";
    const admin: string =
      text(record["TargetUserOrGroupName"]) ||
      text(asObject(record["EventData"])?.["SiteCollectionAdmin"]);

    return {
      ...base,
      classUid: USER_ACCESS_MANAGEMENT,
      activityName: added
        ? "Assign Privileges"
        : removed
          ? "Revoke Privileges"
          : operation,
      statusName: status,
      severity: removed ? OcsfSeverity.Informational : OcsfSeverity.Low,
      message: added
        ? `${who} made ${admin || "someone"} a site collection administrator${site ? ` of ${site}` : ""}`
        : removed
          ? `${who} removed ${admin || "someone"} as a site collection administrator${site ? ` of ${site}` : ""}`
          : `${who} changed the sharing policy${site ? ` of ${site}` : ""}`,
      targetUser: admin,
      targetResource: site,
    };
  }

  if (recordType === MICROSOFT_365_RECORD_TYPES.threatIntelligence) {
    const verdict: string = text(record["Verdict"]);
    const lowerVerdict: string = verdict.toLowerCase();

    if (
      !THREAT_VERDICTS.some((threat: string): boolean => {
        return lowerVerdict.includes(threat);
      })
    ) {
      return null;
    }

    const sender: string = text(record["P1Sender"]) || text(record["P2Sender"]);
    const recipients: Array<string> = Array.isArray(record["Recipients"])
      ? (record["Recipients"] as Array<JSONValue>)
          .slice(0, 100)
          .map((recipient: JSONValue): string => {
            return text(recipient);
          })
          .filter((recipient: string): boolean => {
            return recipient.length > 0;
          })
      : [];
    const malware: boolean = lowerVerdict.includes("malware");

    return {
      ...base,
      classUid: DETECTION_FINDING,
      activityName: "Create",
      statusName: "Detected",
      severity: malware ? OcsfSeverity.High : OcsfSeverity.Medium,
      message: `Microsoft Defender for Office 365: ${malware ? "malware" : "phishing"} mail${sender ? ` from ${sender}` : ""}${recipients[0] ? ` to ${recipients[0]}${recipients.length > 1 ? ` and ${recipients.length - 1} more` : ""}` : ""}`,
      ruleName: `${verdict} mail`,
      principalUser: sender,
      principalIp: readRemoteIpAddress(text(record["SenderIp"])),
      targetUser: recipients[0] || "",
      targetResource: text(record["Subject"]),
    };
  }

  /*
   * An alert is recorded when it is raised, again for each entity it
   * names, and on every update: the first is the finding.
   */
  if (
    recordType === MICROSOFT_365_RECORD_TYPES.securityComplianceAlerts &&
    operation === "AlertTriggered"
  ) {
    const name: string = text(record["Name"]) || "Microsoft 365 alert";
    const severity: OcsfSeverity =
      ALERT_SEVERITIES[text(record["Severity"]).toLowerCase()] ||
      OcsfSeverity.Medium;

    return {
      ...base,
      classUid: DETECTION_FINDING,
      activityName: "Create",
      statusName: "Detected",
      severity,
      message: `Microsoft 365 alert: ${name}`,
      ruleName: name,
      ruleId: text(record["PolicyId"]),
      targetResource: text(record["Category"]),
    };
  }

  if (
    recordType === MICROSOFT_365_RECORD_TYPES.microsoftTeams &&
    TEAMS_OPERATIONS.includes(operation)
  ) {
    const added: string =
      text(record["AddOnName"]) ||
      text(record["ConnectorName"]) ||
      text(record["AzureADAppId"]);
    const team: string = text(record["TeamName"]);

    return {
      ...base,
      classUid: APPLICATION_LIFECYCLE,
      activityName: "Install",
      statusName: status,
      severity: OcsfSeverity.Low,
      message: `${who} added ${added || "an app"} to ${team ? `the ${team} team` : "Microsoft Teams"}`,
      targetResource: added,
    };
  }

  return null;
}
