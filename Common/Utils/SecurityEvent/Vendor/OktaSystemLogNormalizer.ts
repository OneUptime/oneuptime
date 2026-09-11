import { JSONObject } from "../../../Types/JSON";
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
  readValue,
} from "../NormalizerHelpers";
import {
  prettifyToken,
  readAllStrings,
  readFirstString,
  readObjects,
} from "./VendorNormalizerHelpers";

interface OktaClassMapping {
  classUid: number;
  activityName: string;
}

function classMappingForEventType(eventType: string): OktaClassMapping {
  const normalized: string = eventType.toLowerCase();

  if (
    normalized.includes("authentication") ||
    normalized.startsWith("user.session.") ||
    normalized.startsWith("security.request.blocked")
  ) {
    return {
      classUid: 3002,
      activityName: normalized.endsWith(".end") ? "Logoff" : "Logon",
    };
  }

  if (normalized.startsWith("user.lifecycle.")) {
    const action: string = normalized.split(".").pop() || "update";
    return { classUid: 3001, activityName: prettifyToken(action) };
  }

  if (
    normalized.startsWith("group.lifecycle.") ||
    normalized.startsWith("group.user_membership.")
  ) {
    const action: string = normalized.split(".").pop() || "update";
    return { classUid: 3006, activityName: prettifyToken(action) };
  }

  if (
    normalized.startsWith("application.lifecycle.") ||
    normalized.startsWith("app.lifecycle.")
  ) {
    const action: string = normalized.split(".").pop() || "update";
    return { classUid: 3004, activityName: prettifyToken(action) };
  }

  if (normalized.includes("policy.evaluate")) {
    return { classUid: 3003, activityName: "Authorize" };
  }

  return { classUid: 6003, activityName: prettifyToken(eventType) };
}

function normalizeOutcome(value: string): string {
  const outcomes: Record<string, string> = {
    SUCCESS: "Success",
    FAILURE: "Failure",
    SKIPPED: "Skipped",
    ALLOW: "Allowed",
    DENY: "Denied",
    CHALLENGE: "Challenge",
    UNKNOWN: "Unknown",
  };

  return outcomes[value.toUpperCase()] || prettifyToken(value);
}

interface OktaTargetSummary {
  targetUser: string;
  targetHost: string;
  targetResource: string;
  observables: Array<string>;
}

function summarizeTargets(payload: JSONObject): OktaTargetSummary {
  const targets: Array<JSONObject> = readObjects(payload, "target");
  let targetUser: string = "";
  let targetHost: string = "";
  let targetResource: string = "";
  const values: Array<string> = [];

  for (const target of targets) {
    const type: string = readFirstString(target, ["type"]).toLowerCase();
    const id: string = readFirstString(target, [
      "alternateId",
      "alternate_id",
      "displayName",
      "display_name",
      "id",
    ]);

    values.push(
      ...readAllStrings(target, "id"),
      ...readAllStrings(target, "alternateId"),
      ...readAllStrings(target, "alternate_id"),
      ...readAllStrings(target, "displayName"),
      ...readAllStrings(target, "display_name"),
    );

    if (!targetUser && type.includes("user")) {
      targetUser = id;
    }

    if (
      !targetHost &&
      (type.includes("device") ||
        type.includes("client") ||
        type.includes("host"))
    ) {
      targetHost = id;
    }

    if (!targetResource) {
      targetResource = id;
    }
  }

  return { targetUser, targetHost, targetResource, observables: values };
}

export default class OktaSystemLogNormalizer {
  public static isOktaSystemLogEvent(payload: JSONObject): boolean {
    const eventType: string = readFirstString(payload, [
      "eventType",
      "event_type",
    ]);

    return Boolean(
      eventType &&
        (readFirstString(payload, ["uuid", "published", "displayMessage"]) ||
          readValue(payload, "actor") ||
          readValue(payload, "outcome")),
    );
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const eventType: string = readFirstString(payload, [
      "eventType",
      "event_type",
      "legacyEventType",
      "legacy_event_type",
    ]);
    const mapping: OktaClassMapping = classMappingForEventType(eventType);
    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      mapping.classUid,
    );
    const severityName: OcsfSeverity =
      normalizeOcsfSeverity(readFirstString(payload, ["severity"])) ||
      OcsfSeverity.Unknown;
    const time: Date | null = parseEventTime(
      readValue(payload, "published") ??
        readValue(payload, "eventTime") ??
        readValue(payload, "event_time"),
    );
    const principalUser: string = readFirstString(payload, [
      "actor.alternateId",
      "actor.alternate_id",
      "actor.displayName",
      "actor.display_name",
      "actor.id",
    ]);
    const principalHost: string = readFirstString(payload, [
      "client.device",
      "device.displayName",
      "device.display_name",
      "device.name",
    ]);
    const principalIp: string = readFirstString(payload, [
      "client.ipAddress",
      "client.ip_address",
      "request.ipChain.ip",
      "request.ip_chain.ip",
    ]);
    const targets: OktaTargetSummary = summarizeTargets(payload);
    const targetResource: string =
      readFirstString(payload, [
        "debugContext.debugData.requestUri",
        "debugContext.debug_data.request_uri",
        "request.uri",
      ]) || targets.targetResource;

    const observables: Array<string> = [
      principalUser,
      principalHost,
      principalIp,
      targets.targetUser,
      targets.targetHost,
      ...targets.observables,
    ];

    for (const path of ["request.ipChain", "request.ip_chain"]) {
      for (const entry of readObjects(payload, path)) {
        observables.push(readFirstString(entry, ["ip"]));
      }
    }

    return {
      time: time || new Date(),
      eventUid:
        readFirstString(payload, ["uuid", "eventId", "event_id"]) ||
        contentHashEventUid(payload),
      categoryUid,
      categoryName,
      classUid: mapping.classUid,
      className:
        mapping.classUid === 3002
          ? "Authentication"
          : mapping.classUid === 3001
            ? "Account Change"
            : mapping.classUid === 3006
              ? "Group Management"
              : mapping.classUid === 3004
                ? "Entity Management"
                : mapping.classUid === 3003
                  ? "Authorize Session"
                  : "API Activity",
      activityName: mapping.activityName,
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: normalizeOutcome(
        readFirstString(payload, ["outcome.result", "outcome.status"]),
      ),
      message:
        readFirstString(payload, [
          "displayMessage",
          "display_message",
          "outcome.reason",
        ]) ||
        prettifyToken(eventType) ||
        "Okta System Log event",
      vendorName: "Okta",
      productName: "System Log",
      ruleId: eventType,
      ruleName: prettifyToken(eventType),
      mitreTactics: [],
      mitreTechniques: [],
      principalUser,
      principalHost,
      principalIp,
      principalProcess: "",
      targetUser: targets.targetUser,
      targetHost: targets.targetHost,
      targetIp: "",
      targetPort: 0,
      targetResource,
      observables: buildObservables(observables),
      attributes: flattenPayload(payload),
    };
  }
}
