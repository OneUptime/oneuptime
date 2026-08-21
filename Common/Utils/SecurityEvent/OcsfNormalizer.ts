import { JSONObject, JSONValue } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
  ocsfSeverityFromId,
} from "../../Types/SecurityEvent/OcsfSeverity";
import {
  OcsfEventClassProps,
  ocsfCategoryForClassUid,
  ocsfEventClassByUid,
} from "../../Types/SecurityEvent/OcsfEventClass";
import {
  buildObservables,
  contentHashEventUid,
  flattenPayload,
  parseEventTime,
  readNumber,
  readString,
  readValue,
} from "./NormalizerHelpers";

/*
 * Native OCSF event JSON -> NormalizedSecurityEvent.
 *
 * OCSF is already our canonical shape, so this normalizer mostly lifts
 * fields as-is, trusting the payload's class/category/severity ids but
 * re-deriving names when the payload omits them. Unknown class uids are
 * kept — the schema evolves faster than our curated subset and dropping
 * events over an unknown uid would be wrong.
 *
 * https://schema.ocsf.io/
 */
export default class OcsfNormalizer {
  public static isOcsfEvent(payload: JSONObject): boolean {
    return readNumber(payload, "class_uid") !== null;
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const classUid: number = readNumber(payload, "class_uid") ?? 0;
    const knownClass: OcsfEventClassProps | undefined =
      ocsfEventClassByUid(classUid);

    const className: string =
      readString(payload, "class_name") ||
      (knownClass ? knownClass.name : "Base Event");

    const derivedCategory: { categoryUid: number; categoryName: string } =
      ocsfCategoryForClassUid(classUid);

    const categoryUid: number =
      readNumber(payload, "category_uid") ?? derivedCategory.categoryUid;
    const categoryName: string =
      readString(payload, "category_name") || derivedCategory.categoryName;

    /*
     * severity_id is authoritative when present; the severity text is a
     * fallback for producers that only send the name.
     */
    const severityIdRaw: number | null = readNumber(payload, "severity_id");
    const severityName: OcsfSeverity =
      severityIdRaw !== null
        ? ocsfSeverityFromId(severityIdRaw)
        : normalizeOcsfSeverity(readString(payload, "severity")) ||
          OcsfSeverity.Unknown;

    const time: Date | null = parseEventTime(
      readValue(payload, "time") ??
        readValue(payload, "time_dt") ??
        readValue(payload, "metadata.logged_time"),
    );

    const mitreTactics: Array<string> = [];
    const mitreTechniques: Array<string> = [];

    const attacks: JSONValue = readValue(payload, "attacks");
    if (Array.isArray(attacks)) {
      for (const attack of attacks) {
        if (typeof attack !== "object" || attack === null) {
          continue;
        }

        const tacticId: string =
          readString(attack as JSONObject, "tactic.uid") ||
          readString(attack as JSONObject, "tactic.id");
        if (tacticId && !mitreTactics.includes(tacticId)) {
          mitreTactics.push(tacticId);
        }

        const techniqueId: string =
          readString(attack as JSONObject, "technique.uid") ||
          readString(attack as JSONObject, "technique.id");
        if (techniqueId && !mitreTechniques.includes(techniqueId)) {
          mitreTechniques.push(techniqueId);
        }
      }
    }

    const principalUser: string =
      readString(payload, "actor.user.name") ||
      readString(payload, "actor.user.email_addr");

    const principalProcess: string =
      readString(payload, "actor.process.name") ||
      readString(payload, "actor.process.cmd_line");

    const principalHost: string =
      readString(payload, "src_endpoint.hostname") ||
      readString(payload, "device.hostname");

    const principalIp: string =
      readString(payload, "src_endpoint.ip") || readString(payload, "device.ip");

    const targetUser: string = readString(payload, "user.name");
    const targetHost: string = readString(payload, "dst_endpoint.hostname");
    const targetIp: string = readString(payload, "dst_endpoint.ip");
    const targetPort: number = readNumber(payload, "dst_endpoint.port") ?? 0;

    const targetResource: string =
      readString(payload, "resources.name") ||
      readString(payload, "resources.uid") ||
      readString(payload, "api.operation") ||
      readString(payload, "http_request.url.hostname");

    /*
     * OCSF's own observables array carries pre-extracted values; merge
     * them with the entity fields so the observables column is a superset.
     */
    const extraObservables: Array<string> = [];
    const observablesArray: JSONValue = readValue(payload, "observables");
    if (Array.isArray(observablesArray)) {
      for (const observable of observablesArray) {
        if (typeof observable !== "object" || observable === null) {
          continue;
        }
        const value: string = readString(observable as JSONObject, "value");
        if (value) {
          extraObservables.push(value);
        }
      }
    }

    const message: string =
      readString(payload, "message") ||
      readString(payload, "finding_info.title") ||
      className;

    return {
      time: time || new Date(),
      eventUid:
        readString(payload, "metadata.uid") || contentHashEventUid(payload),
      categoryUid,
      categoryName,
      classUid,
      className,
      activityName: readString(payload, "activity_name"),
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName:
        readString(payload, "status") || readString(payload, "disposition"),
      message,
      vendorName: readString(payload, "metadata.product.vendor_name"),
      productName: readString(payload, "metadata.product.name"),
      ruleId:
        readString(payload, "metadata.rule.uid") ||
        readString(payload, "finding_info.uid"),
      ruleName:
        readString(payload, "metadata.rule.name") ||
        readString(payload, "finding_info.title"),
      mitreTactics,
      mitreTechniques,
      principalUser,
      principalHost,
      principalIp,
      principalProcess,
      targetUser,
      targetHost,
      targetIp,
      targetPort,
      targetResource,
      observables: buildObservables([
        principalUser,
        targetUser,
        principalHost,
        targetHost,
        principalIp,
        targetIp,
        ...extraObservables,
      ]),
      attributes: flattenPayload(payload),
    };
  }
}
