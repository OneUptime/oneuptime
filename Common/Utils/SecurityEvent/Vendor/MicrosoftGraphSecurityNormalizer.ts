import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import {
  buildObservables,
  contentHashEventUid,
  flattenPayload,
  parseEventTime,
  readNumber,
  readString,
  readStringArray,
  readValue,
} from "../NormalizerHelpers";

const DETECTION_FINDING_CLASS_UID: number = 2004;
const INCIDENT_FINDING_CLASS_UID: number = 2005;
const MAX_EXPANDED_ALERTS: number = 25;

interface ExtractedEntities {
  principalUser: string;
  principalHost: string;
  principalIp: string;
  principalProcess: string;
  targetUser: string;
  targetHost: string;
  targetIp: string;
  targetPort: number;
  targetResource: string;
  observables: Array<string>;
}

function objectValue(value: JSONValue): JSONObject | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JSONObject;
  }

  return null;
}

function objectArray(value: JSONValue): Array<JSONObject> {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: Array<JSONObject> = [];
  for (const item of value) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      result.push(item as JSONObject);
    }
  }
  return result;
}

/* Accept a direct Graph resource, a list response, or a change notification. */
function unwrapResource(payload: JSONObject): JSONObject {
  const values: Array<JSONObject> = objectArray(readValue(payload, "value"));

  if (values[0]) {
    const resourceData: JSONObject | null = objectValue(
      readValue(values[0], "resourceData"),
    );
    return resourceData || values[0];
  }

  for (const path of ["resourceData", "alert", "incident"]) {
    const resource: JSONObject | null = objectValue(readValue(payload, path));
    if (resource) {
      return resource;
    }
  }

  return payload;
}

function readAny(payload: JSONObject, paths: Array<string>): string {
  for (const path of paths) {
    const value: string = readString(payload, path);
    if (value) {
      return value;
    }
  }

  return "";
}

function readLiteralString(payload: JSONObject, key: string): string {
  const value: JSONValue = payload[key];
  return typeof value === "string" ? value : "";
}

function isIncident(resource: JSONObject): boolean {
  const odataType: string = readLiteralString(
    resource,
    "@odata.type",
  ).toLowerCase();

  return Boolean(
    odataType.endsWith(".incident") ||
      (readString(resource, "displayName") &&
        (readValue(resource, "alerts") ||
          readString(resource, "redirectIncidentId") ||
          readString(resource, "summary"))),
  );
}

function severityFor(resource: JSONObject): OcsfSeverity {
  const textSeverity: OcsfSeverity | null = normalizeOcsfSeverity(
    readString(resource, "severity"),
  );

  if (textSeverity) {
    return textSeverity;
  }

  const priorityScore: number | null = readNumber(resource, "priorityScore");

  if (priorityScore === null || priorityScore < 0 || priorityScore > 100) {
    return OcsfSeverity.Unknown;
  }

  if (priorityScore > 85) {
    return OcsfSeverity.High;
  }

  if (priorityScore >= 15) {
    return OcsfSeverity.Medium;
  }

  return OcsfSeverity.Low;
}

function isSourceEvidence(evidence: JSONObject): boolean {
  const roles: Array<string> = readStringArray(evidence, "roles").map(
    (role: string): string => {
      return role.toLowerCase();
    },
  );

  return roles.some((role: string): boolean => {
    return role === "source" || role === "attacker";
  });
}

function pushValues(target: Array<string>, values: Array<string>): void {
  target.push(
    ...values.filter((value: string): boolean => {
      return Boolean(value);
    }),
  );
}

function extractEntities(resources: Array<JSONObject>): ExtractedEntities {
  const result: ExtractedEntities = {
    principalUser: "",
    principalHost: "",
    principalIp: "",
    principalProcess: "",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 0,
    targetResource: "",
    observables: [],
  };

  for (const resource of resources) {
    for (const evidence of objectArray(readValue(resource, "evidence"))) {
      const type: string = readLiteralString(
        evidence,
        "@odata.type",
      ).toLowerCase();
      const source: boolean = isSourceEvidence(evidence);

      if (type.includes("userevidence")) {
        const user: string = readAny(evidence, [
          "userAccount.userPrincipalName",
          "userAccount.accountName",
          "userPrincipalName",
          "displayName",
        ]);
        if (source && !result.principalUser) {
          result.principalUser = user;
        } else if (!result.targetUser) {
          result.targetUser = user;
        }
        pushValues(result.observables, [user]);
      }

      if (type.includes("deviceevidence")) {
        const host: string = readAny(evidence, ["deviceDnsName", "hostName"]);
        if (source && !result.principalHost) {
          result.principalHost = host;
        } else if (!result.targetHost) {
          result.targetHost = host;
        }
        pushValues(result.observables, [
          host,
          ...readStringArray(evidence, "ipInterfaces"),
        ]);
      }

      if (type.includes("ipevidence")) {
        const ip: string = readString(evidence, "ipAddress");
        if (source && !result.principalIp) {
          result.principalIp = ip;
        } else if (!result.targetIp) {
          result.targetIp = ip;
        }
        pushValues(result.observables, [ip]);
      }

      if (type.includes("processevidence")) {
        const process: string = readAny(evidence, [
          "processCommandLine",
          "imageFile.filePath",
          "imageFile.fileName",
        ]);
        result.principalProcess ||= process;
        pushValues(result.observables, [process]);
      }

      const fileValues: Array<string> = [
        readString(evidence, "fileDetails.sha256"),
        readString(evidence, "fileDetails.sha1"),
        readString(evidence, "fileDetails.md5"),
        readString(evidence, "fileDetails.fileName"),
        readString(evidence, "fileDetails.filePath"),
      ];
      pushValues(result.observables, fileValues);

      const targetResource: string = readAny(evidence, [
        "url",
        "resourceId",
        "resourceName",
        "fileDetails.filePath",
        "fileDetails.fileName",
      ]);
      result.targetResource ||= targetResource;
      pushValues(result.observables, [targetResource]);

      const mailbox: string = readAny(evidence, [
        "mailboxPrimaryAddress",
        "mailboxAddress",
      ]);
      result.targetUser ||= mailbox;
      pushValues(result.observables, [mailbox]);
    }

    const userState: JSONObject | undefined = objectArray(
      readValue(resource, "userStates"),
    )[0];
    if (userState) {
      result.principalUser ||= readAny(userState, [
        "userPrincipalName",
        "accountName",
      ]);
      pushValues(result.observables, [result.principalUser]);
    }

    const hostState: JSONObject | undefined = objectArray(
      readValue(resource, "hostStates"),
    )[0];
    if (hostState) {
      result.targetHost ||= readAny(hostState, [
        "fqdn",
        "netBiosHostName",
        "os",
      ]);
      pushValues(result.observables, [result.targetHost]);
    }

    const connection: JSONObject | undefined = objectArray(
      readValue(resource, "networkConnections"),
    )[0];
    if (connection) {
      result.principalIp ||= readString(connection, "sourceAddress");
      result.targetIp ||= readString(connection, "destinationAddress");
      result.targetPort ||= readNumber(connection, "destinationPort") || 0;
      pushValues(result.observables, [result.principalIp, result.targetIp]);
    }

    const process: JSONObject | undefined = objectArray(
      readValue(resource, "processes"),
    )[0];
    if (process) {
      result.principalProcess ||= readAny(process, ["commandLine", "name"]);
    }
  }

  result.observables = buildObservables(result.observables);
  return result;
}

function productFor(resource: JSONObject, alerts: Array<JSONObject>): string {
  const explicit: string =
    readString(resource, "productName") ||
    (alerts[0] ? readString(alerts[0], "productName") : "");

  if (explicit) {
    return explicit;
  }

  const serviceSource: string = (
    readString(resource, "serviceSource") ||
    (alerts[0] ? readString(alerts[0], "serviceSource") : "")
  ).toLowerCase();

  if (serviceSource.includes("sentinel")) {
    return "Microsoft Sentinel";
  }

  return "Microsoft Defender XDR";
}

function collectAttackValues(
  resources: Array<JSONObject>,
  path: string,
): Array<string> {
  const values: Array<string> = [];

  for (const resource of resources) {
    values.push(...readStringArray(resource, path));
  }

  return buildObservables(values);
}

export default class MicrosoftGraphSecurityNormalizer {
  public static isMicrosoftGraphSecurityEvent(payload: JSONObject): boolean {
    const resource: JSONObject = unwrapResource(payload);
    const odataType: string = readLiteralString(
      resource,
      "@odata.type",
    ).toLowerCase();
    const context: string = readLiteralString(
      payload,
      "@odata.context",
    ).toLowerCase();

    return Boolean(
      odataType.includes("microsoft.graph.security.alert") ||
        odataType.includes("microsoft.graph.security.incident") ||
        context.includes("$metadata#security/alerts") ||
        context.includes("$metadata#security/incidents") ||
        (readString(resource, "providerAlertId") &&
          readString(resource, "serviceSource")) ||
        (readString(resource, "tenantId") &&
          readString(resource, "incidentWebUrl")),
    );
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const resource: JSONObject = unwrapResource(payload);
    const incident: boolean = isIncident(resource);
    const alerts: Array<JSONObject> = incident
      ? objectArray(readValue(resource, "alerts")).slice(0, MAX_EXPANDED_ALERTS)
      : [];
    const resources: Array<JSONObject> = [resource, ...alerts];
    const entities: ExtractedEntities = extractEntities(resources);
    const primaryAlert: JSONObject = alerts[0] || resource;
    const classUid: number = incident
      ? INCIDENT_FINDING_CLASS_UID
      : DETECTION_FINDING_CLASS_UID;
    const { categoryUid, categoryName } = ocsfCategoryForClassUid(classUid);
    const severityName: OcsfSeverity = severityFor(resource);
    const time: Date | null = parseEventTime(
      readValue(resource, "lastActivityDateTime") ??
        readValue(resource, "lastUpdateDateTime") ??
        readValue(resource, "createdDateTime") ??
        readValue(resource, "firstActivityDateTime"),
    );

    entities.principalUser ||=
      readString(resource, "actorDisplayName") ||
      readString(primaryAlert, "actorDisplayName");

    return {
      time: time || new Date(),
      eventUid: readString(resource, "id") || contentHashEventUid(payload),
      categoryUid,
      categoryName,
      classUid,
      className: incident ? "Incident Finding" : "Detection Finding",
      activityName: "Create",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: readString(resource, "status"),
      message:
        readAny(resource, ["displayName", "title", "description", "summary"]) ||
        (incident ? "Microsoft security incident" : "Microsoft security alert"),
      vendorName: "Microsoft",
      productName: productFor(resource, alerts),
      ruleId: readAny(primaryAlert, ["alertPolicyId", "detectorId"]),
      ruleName: readAny(primaryAlert, [
        "threatDisplayName",
        "detectionSource",
        "category",
      ]),
      mitreTactics: buildObservables([
        ...collectAttackValues(resources, "categories"),
        ...resources.map((item: JSONObject): string => {
          return readString(item, "category");
        }),
      ]),
      mitreTechniques: collectAttackValues(resources, "mitreTechniques"),
      principalUser: entities.principalUser,
      principalHost: entities.principalHost,
      principalIp: entities.principalIp,
      principalProcess: entities.principalProcess,
      targetUser: entities.targetUser,
      targetHost: entities.targetHost,
      targetIp: entities.targetIp,
      targetPort: entities.targetPort,
      targetResource: entities.targetResource,
      observables: buildObservables([
        entities.principalUser,
        entities.principalHost,
        entities.principalIp,
        entities.targetUser,
        entities.targetHost,
        entities.targetIp,
        entities.targetResource,
        ...entities.observables,
      ]),
      attributes: flattenPayload(payload),
    };
  }
}
