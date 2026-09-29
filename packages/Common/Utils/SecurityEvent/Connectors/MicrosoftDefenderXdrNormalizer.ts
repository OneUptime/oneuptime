import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import {
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
} from "../../../Types/SecurityEvent/DetectionFindingConstants";
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
  readStringArray,
  readValue,
} from "../NormalizerHelpers";

/*
 * Microsoft Graph security `alert` (alerts_v2) -> OCSF Detection Finding
 * (class 2004).
 *
 * Field contract:
 * https://learn.microsoft.com/en-us/graph/api/resources/security-alert
 * https://learn.microsoft.com/en-us/graph/api/resources/security-alertevidence
 *
 * The alert row itself carries rule-ish metadata (title, severity,
 * status, category, mitreTechniques); the entities live in `evidence[]`,
 * each item typed by `@odata.type` (deviceEvidence, userEvidence,
 * ipEvidence, fileEvidence, processEvidence, urlEvidence, ...). Mining
 * those into principal/target columns and the observables array is what
 * makes a Defender alert joinable to the host and user it fired on.
 *
 * Pure and isomorphic: no server imports.
 */

// Evidence items and observable values are bounded so one alert cannot bloat a row.
const MAX_EVIDENCE_ITEMS: number = 100;
const MAX_OBSERVABLES: number = 200;

/*
 * Defender's kill-chain categories are MITRE ATT&CK tactic names without
 * spaces. Only names that ARE tactics map; Defender also emits
 * categories such as Malware, Ransomware or SuspiciousActivity, which are
 * left to the attributes rather than invented into a tactic id.
 * https://attack.mitre.org/tactics/enterprise/
 */
const TACTIC_ID_BY_NAME: Record<string, string> = {
  reconnaissance: "TA0043",
  resourcedevelopment: "TA0042",
  initialaccess: "TA0001",
  execution: "TA0002",
  persistence: "TA0003",
  privilegeescalation: "TA0004",
  defenseevasion: "TA0005",
  credentialaccess: "TA0006",
  discovery: "TA0007",
  lateralmovement: "TA0008",
  collection: "TA0009",
  commandandcontrol: "TA0011",
  exfiltration: "TA0010",
  impact: "TA0040",
};

/*
 * OCSF Detection Finding status_id names for Graph alertStatus values
 * (unknown, new, inProgress, resolved).
 */
const STATUS_NAME_BY_GRAPH_STATUS: Record<string, string> = {
  unknown: "Unknown",
  new: "New",
  inprogress: "In Progress",
  resolved: "Resolved",
};

/*
 * evidenceRole values that put an entity on the actor side versus the
 * target side of the finding. Anything else (contextual, scanned,
 * loaded, ...) is only an observable.
 */
const PRINCIPAL_ROLES: Array<string> = ["source", "attacker", "compromised"];
const TARGET_ROLES: Array<string> = [
  "destination",
  "attacked",
  "created",
  "added",
  "edited",
  "scanned",
];

interface EvidenceEntity {
  value: string;
  roles: Array<string>;
}

interface EvidenceSummary {
  hosts: Array<EvidenceEntity>;
  users: Array<EvidenceEntity>;
  ips: Array<EvidenceEntity>;
  processes: Array<EvidenceEntity>;
  resources: Array<string>;
  observables: Array<string>;
}

function isObject(value: JSONValue | undefined): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * "@odata.type" contains a dot, so the dot-path helpers would look for
 * item["@odata"]["type"]; the key is read directly instead.
 */
function odataTypeOf(item: JSONObject): string {
  const raw: JSONValue = item["@odata.type"] as JSONValue;

  return typeof raw === "string" ? raw : "";
}

function evidenceType(item: JSONObject): string {
  const odataType: string = odataTypeOf(item);
  const lastDot: number = odataType.lastIndexOf(".");

  return (
    lastDot >= 0 ? odataType.slice(lastDot + 1) : odataType
  ).toLowerCase();
}

function lowerRoles(item: JSONObject): Array<string> {
  return readStringArray(item, "roles").map((role: string): string => {
    return role.toLowerCase();
  });
}

/*
 * A user account rendered the way an analyst would search for it: the
 * UPN when Entra knows it, otherwise DOMAIN\account, otherwise whatever
 * name the sensor had.
 */
function userAccountValue(account: JSONObject | null): string {
  if (!account) {
    return "";
  }

  const upn: string = readString(account, "userPrincipalName");

  if (upn) {
    return upn;
  }

  const accountName: string = readString(account, "accountName");
  const domainName: string = readString(account, "domainName");

  if (accountName && domainName) {
    return `${domainName}\\${accountName}`;
  }

  return accountName || readString(account, "displayName");
}

function fileObservables(file: JSONObject | null): Array<string> {
  if (!file) {
    return [];
  }

  return [
    readString(file, "sha256"),
    readString(file, "sha1"),
    readString(file, "fileName"),
  ];
}

function summarizeEvidence(payload: JSONObject): EvidenceSummary {
  const summary: EvidenceSummary = {
    hosts: [],
    users: [],
    ips: [],
    processes: [],
    resources: [],
    observables: [],
  };

  const evidence: JSONValue = readValue(payload, "evidence");

  if (!Array.isArray(evidence)) {
    return summary;
  }

  for (const raw of evidence.slice(0, MAX_EVIDENCE_ITEMS)) {
    if (!isObject(raw as JSONValue)) {
      continue;
    }

    const item: JSONObject = raw as JSONObject;
    const type: string = evidenceType(item);
    const roles: Array<string> = lowerRoles(item);

    switch (type) {
      case "deviceevidence": {
        const host: string =
          readString(item, "deviceDnsName") || readString(item, "hostName");

        if (host) {
          summary.hosts.push({ value: host, roles });
        }

        summary.observables.push(host, readString(item, "hostName"));

        for (const ip of readStringArray(item, "ipInterfaces")) {
          summary.observables.push(ip);
        }

        const loggedOn: JSONValue = readValue(item, "loggedOnUsers");

        if (Array.isArray(loggedOn)) {
          for (const user of loggedOn) {
            if (isObject(user as JSONValue)) {
              const value: string = userAccountValue(user as JSONObject);
              summary.observables.push(value);
              summary.users.push({ value, roles: [] });
            }
          }
        }

        break;
      }

      case "userevidence": {
        const account: JSONValue = readValue(item, "userAccount");
        const value: string = userAccountValue(
          isObject(account) ? account : null,
        );

        if (value) {
          summary.users.push({ value, roles });
          summary.observables.push(
            value,
            isObject(account) ? readString(account, "userPrincipalName") : "",
            isObject(account) ? readString(account, "accountName") : "",
          );
        }

        break;
      }

      case "ipevidence": {
        const ip: string = readString(item, "ipAddress");

        if (ip) {
          summary.ips.push({ value: ip, roles });
          summary.observables.push(ip);
        }

        break;
      }

      case "processevidence": {
        const imageFile: JSONValue = readValue(item, "imageFile");
        const image: JSONObject | null = isObject(imageFile) ? imageFile : null;
        const commandLine: string = readString(item, "processCommandLine");
        const imageName: string = image ? readString(image, "fileName") : "";
        const value: string = commandLine || imageName;

        if (value) {
          summary.processes.push({ value, roles });
        }

        summary.observables.push(imageName, ...fileObservables(image));

        const parent: JSONValue = readValue(item, "parentProcessImageFile");
        summary.observables.push(
          ...fileObservables(isObject(parent) ? parent : null),
        );

        const account: JSONValue = readValue(item, "userAccount");
        const user: string = userAccountValue(
          isObject(account) ? account : null,
        );

        if (user) {
          summary.users.push({ value: user, roles: [] });
          summary.observables.push(user);
        }

        break;
      }

      case "fileevidence": {
        const details: JSONValue = readValue(item, "fileDetails");
        summary.observables.push(
          ...fileObservables(isObject(details) ? details : null),
        );
        break;
      }

      case "urlevidence": {
        const url: string = readString(item, "url");
        summary.observables.push(url);
        if (url) {
          summary.resources.push(url);
        }
        break;
      }

      case "mailboxevidence": {
        // https://learn.microsoft.com/en-us/graph/api/resources/security-mailboxevidence
        const address: string = readString(item, "primaryAddress");
        const account: JSONValue = readValue(item, "userAccount");
        const user: string =
          userAccountValue(isObject(account) ? account : null) ||
          readString(item, "upn");
        summary.observables.push(address, readString(item, "upn"), user);
        if (address) {
          summary.resources.push(address);
        }
        if (user) {
          summary.users.push({ value: user, roles });
        }
        break;
      }

      case "azureresourceevidence": {
        const resourceId: string = readString(item, "resourceId");
        summary.observables.push(resourceId, readString(item, "resourceName"));
        if (resourceId) {
          summary.resources.push(resourceId);
        }
        break;
      }

      case "amazonresourceevidence": {
        const resourceId: string = readString(item, "amazonResourceId");
        summary.observables.push(resourceId, readString(item, "resourceName"));
        if (resourceId) {
          summary.resources.push(resourceId);
        }
        break;
      }

      case "googlecloudresourceevidence": {
        const resourceName: string = readString(item, "resourceName");
        summary.observables.push(resourceName);
        if (resourceName) {
          summary.resources.push(resourceName);
        }
        break;
      }

      case "dnsevidence": {
        summary.observables.push(readString(item, "domainName"));
        break;
      }

      case "cloudapplicationevidence": {
        summary.observables.push(readString(item, "displayName"));
        break;
      }

      case "oauthapplicationevidence":
      case "serviceprincipalevidence": {
        summary.observables.push(
          readString(item, "appId"),
          readString(item, "displayName"),
          readString(item, "servicePrincipalName"),
        );
        break;
      }

      default: {
        /*
         * Every evidence type inherits the base shape; unknown derived
         * types still contribute the identifiers most of them carry.
         */
        summary.observables.push(
          readString(item, "ipAddress"),
          readString(item, "url"),
          readString(item, "deviceDnsName"),
          readString(item, "hostName"),
          readString(item, "domainName"),
        );
        const account: JSONValue = readValue(item, "userAccount");
        summary.observables.push(
          userAccountValue(isObject(account) ? account : null),
        );
        break;
      }
    }
  }

  return summary;
}

function hasRole(entity: EvidenceEntity, roles: Array<string>): boolean {
  return entity.roles.some((role: string): boolean => {
    return roles.includes(role);
  });
}

/*
 * The actor is the first entity Defender marked as source / attacker /
 * compromised, else the first entity of that kind at all; the target is
 * the first entity with a target-side role that is not the actor.
 */
function pickPrincipal(entities: Array<EvidenceEntity>): string {
  const explicit: EvidenceEntity | undefined = entities.find(
    (entity: EvidenceEntity): boolean => {
      return hasRole(entity, PRINCIPAL_ROLES);
    },
  );

  return (explicit || entities[0])?.value || "";
}

function pickTarget(
  entities: Array<EvidenceEntity>,
  principal: string,
): string {
  const explicit: EvidenceEntity | undefined = entities.find(
    (entity: EvidenceEntity): boolean => {
      return entity.value !== principal && hasRole(entity, TARGET_ROLES);
    },
  );

  return explicit?.value || "";
}

function mapTactics(payload: JSONObject): Array<string> {
  const names: Array<string> = [
    ...readStringArray(payload, "categories"),
    readString(payload, "category"),
  ];
  const tactics: Array<string> = [];

  for (const name of names) {
    const key: string = name.toLowerCase().replace(/[^a-z]/g, "");
    const id: string | undefined = TACTIC_ID_BY_NAME[key];

    if (id && !tactics.includes(id)) {
      tactics.push(id);
    }
  }

  return tactics;
}

function mapTechniques(payload: JSONObject): Array<string> {
  const techniques: Array<string> = [];

  for (const technique of readStringArray(payload, "mitreTechniques")) {
    const trimmed: string = technique.trim().toUpperCase();

    if (trimmed && !techniques.includes(trimmed)) {
      techniques.push(trimmed);
    }
  }

  return techniques;
}

export default class MicrosoftDefenderXdrNormalizer {
  /*
   * A Graph security alert always carries a string `id` and
   * `createdDateTime`; the @odata.type is present on list responses but
   * not on every re-serialized copy, so it is accepted rather than
   * required.
   */
  public static isRecognized(payload: JSONObject): boolean {
    if (!isObject(payload)) {
      return false;
    }

    const id: string = readString(payload, "id");

    if (!id) {
      return false;
    }

    const odataType: string = odataTypeOf(payload).toLowerCase();

    if (odataType.endsWith("microsoft.graph.security.alert")) {
      return true;
    }

    return Boolean(
      readString(payload, "createdDateTime") &&
        (readString(payload, "title") ||
          readString(payload, "severity") ||
          readString(payload, "serviceSource") ||
          readString(payload, "alertWebUrl")),
    );
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      );

    const severityName: OcsfSeverity =
      normalizeOcsfSeverity(readString(payload, "severity")) ||
      OcsfSeverity.Unknown;

    const time: Date | null =
      parseEventTime(readValue(payload, "firstActivityDateTime")) ??
      parseEventTime(readValue(payload, "createdDateTime"));

    const evidence: EvidenceSummary = summarizeEvidence(payload);

    const principalHost: string = pickPrincipal(evidence.hosts);
    const principalUser: string = pickPrincipal(evidence.users);
    const principalIp: string = pickPrincipal(evidence.ips);
    const principalProcess: string = pickPrincipal(evidence.processes);

    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );

    const title: string = readString(payload, "title");
    const status: string = readString(payload, "status").toLowerCase();

    return {
      time: time || new Date(),
      eventUid: readString(payload, "id") || contentHashEventUid(payload),
      categoryUid,
      categoryName,
      classUid: DETECTION_FINDING_CLASS_UID,
      className: DETECTION_FINDING_CLASS_NAME,
      activityName: "Create",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: STATUS_NAME_BY_GRAPH_STATUS[status] || "",
      message:
        title ||
        readString(payload, "description") ||
        "Microsoft Defender XDR alert",
      vendorName: definition?.vendorName || "Microsoft",
      productName: definition?.productName || "Microsoft Defender XDR",
      ruleId:
        readString(payload, "detectorId") ||
        readString(payload, "alertPolicyId"),
      ruleName: title,
      mitreTactics: mapTactics(payload),
      mitreTechniques: mapTechniques(payload),
      principalUser,
      principalHost,
      principalIp,
      principalProcess,
      targetUser: pickTarget(evidence.users, principalUser),
      targetHost: pickTarget(evidence.hosts, principalHost),
      targetIp: pickTarget(evidence.ips, principalIp),
      targetPort: 0,
      targetResource: evidence.resources[0] || "",
      observables: buildObservables(evidence.observables).slice(
        0,
        MAX_OBSERVABLES,
      ),
      attributes: flattenPayload(payload),
    };
  }
}
