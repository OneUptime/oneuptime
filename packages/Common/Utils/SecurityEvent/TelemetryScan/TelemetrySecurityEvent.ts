import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "../../../Types/SecurityCase/SecurityConnection";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  ocsfCategoryForClassUid,
  ocsfEventClassByUid,
} from "../../../Types/SecurityEvent/OcsfEventClass";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SECURITY_LOG_SOURCE_ATTRIBUTE } from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySignal,
  SecurityTelemetrySourceDefinition,
  SecurityTelemetrySourceKind,
  getSecurityTelemetrySourceDefinition,
} from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import { buildObservables } from "../NormalizerHelpers";

/*
 * One finding of a telemetry source, as the security event it is stored
 * as - the counterpart of buildLogSecurityEvent for "Your logs".
 *
 * The vendor is OneUptime and the product the source's own
 * (SecurityTelemetrySource), the class and category OCSF's, and every
 * event carries where it came from: the source (oneuptime.source, the key
 * "Your logs" uses, with the source's kind as its value), what it found
 * (oneuptime.signal) and, when the data was sent under a OneUptime record
 * (a Service, a Host ...), that record - so the event's Connected tab names
 * it exactly, as it does a log's.
 */

// The longest message a telemetry event keeps, as a log event's.
export const MAX_TELEMETRY_EVENT_MESSAGE_LENGTH: number = 1000;

// The longest value of any one attribute a telemetry event keeps.
export const MAX_TELEMETRY_ATTRIBUTE_LENGTH: number = 2000;

export function cutTelemetryText(text: string, limit: number): string {
  const value: string = text || "";

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1)}…`;
}

/*
 * The MITRE ATT&CK tactics and techniques each signal stands for, in the
 * version Types/SecurityEvent/MitreAttack.ts carries. A prompt injection is
 * read as what ATT&CK can say of it - an exploit of a public-facing app
 * (T1190) - since ATT&CK does not cover attacks on models (MITRE ATLAS
 * does). Deleting an API key is housekeeping, and stands for nothing.
 */
export const SECURITY_TELEMETRY_SIGNAL_ATTACK: Record<
  SecurityTelemetrySignal,
  { tactics: Array<string>; techniques: Array<string> }
> = {
  [SecurityTelemetrySignal.WebAttack]: {
    tactics: ["TA0001"],
    techniques: ["T1190"],
  },
  [SecurityTelemetrySignal.ServerSideRequestForgery]: {
    tactics: ["TA0001", "TA0006"],
    techniques: ["T1190", "T1552"],
  },
  [SecurityTelemetrySignal.PromptInjection]: {
    tactics: ["TA0001"],
    techniques: ["T1190"],
  },
  [SecurityTelemetrySignal.PortScan]: {
    tactics: ["TA0007"],
    techniques: ["T1046"],
  },
  [SecurityTelemetrySignal.NetworkSweep]: {
    tactics: ["TA0007"],
    techniques: ["T1018"],
  },
  [SecurityTelemetrySignal.ThreatIntelTraffic]: {
    tactics: ["TA0011"],
    techniques: ["T1071"],
  },
  [SecurityTelemetrySignal.LargeOutboundTransfer]: {
    tactics: ["TA0010"],
    techniques: ["T1048"],
  },
  [SecurityTelemetrySignal.ApiKeyCreated]: {
    tactics: ["TA0003"],
    techniques: ["T1098"],
  },
  [SecurityTelemetrySignal.ApiKeyDeleted]: { tactics: [], techniques: [] },
  [SecurityTelemetrySignal.RoleChanged]: {
    tactics: ["TA0004"],
    techniques: ["T1098"],
  },
  [SecurityTelemetrySignal.TeamChanged]: {
    tactics: ["TA0003"],
    techniques: ["T1098"],
  },
  [SecurityTelemetrySignal.McpClientAuthorized]: {
    tactics: ["TA0003"],
    techniques: ["T1098"],
  },
  [SecurityTelemetrySignal.PacketCaptureDownloaded]: {
    tactics: ["TA0009"],
    techniques: ["T1040"],
  },
  [SecurityTelemetrySignal.SecurityControlChanged]: {
    tactics: ["TA0112"],
    techniques: ["T1685"],
  },
  [SecurityTelemetrySignal.MassDelete]: {
    tactics: ["TA0040"],
    techniques: ["T1485"],
  },
  [SecurityTelemetrySignal.UserInTwoCountries]: {
    tactics: ["TA0001"],
    techniques: ["T1078"],
  },
};

export interface TelemetrySecurityEventInput {
  kind: SecurityTelemetrySourceKind;
  signal: SecurityTelemetrySignal;
  time: Date;
  /*
   * The event's identity: derived from what it is about (a span's id, an
   * audit record's, a window and the addresses in it), so the same finding
   * read twice is stored once.
   */
  eventUid: string;
  classUid: number;
  activityName: string;
  statusName: string;
  severity: OcsfSeverity;
  message: string;
  principalUser?: string | undefined;
  principalHost?: string | undefined;
  principalIp?: string | undefined;
  targetUser?: string | undefined;
  targetHost?: string | undefined;
  targetIp?: string | undefined;
  targetPort?: number | undefined;
  targetResource?: string | undefined;
  // What the source read, already flat.
  attributes: JSONObject;
  // Values worth correlating on beyond the typed ones (an indicator, a user key).
  extraObservables?: Array<string> | undefined;
  traceId?: string | undefined;
  spanId?: string | undefined;
  sessionId?: string | undefined;
  requestOutcome?: SecurityEventRequestOutcome | undefined;
  // The OneUptime record the data was sent under, when it names one.
  resourceId?: string | undefined;
  resourceType?: string | undefined;
}

export function buildTelemetrySecurityEvent(
  input: TelemetrySecurityEventInput,
): NormalizedSecurityEvent {
  const definition: SecurityTelemetrySourceDefinition =
    getSecurityTelemetrySourceDefinition(input.kind);
  const category: { categoryUid: number; categoryName: string } =
    ocsfCategoryForClassUid(input.classUid);
  const className: string =
    ocsfEventClassByUid(input.classUid)?.name || "Base Event";
  const attack: { tactics: Array<string>; techniques: Array<string> } =
    SECURITY_TELEMETRY_SIGNAL_ATTACK[input.signal];

  const principalUser: string = (input.principalUser || "").trim();
  const principalHost: string = (input.principalHost || "").trim();
  const principalIp: string = (input.principalIp || "").trim();
  const targetUser: string = (input.targetUser || "").trim();
  const targetHost: string = (input.targetHost || "").trim();
  const targetIp: string = (input.targetIp || "").trim();

  const attributes: JSONObject = {};

  for (const [key, value] of Object.entries(input.attributes)) {
    if (value === null || value === undefined) {
      continue;
    }

    const text: string = typeof value === "string" ? value : String(value);

    if (text) {
      attributes[key] = cutTelemetryText(text, MAX_TELEMETRY_ATTRIBUTE_LENGTH);
    }
  }

  attributes[SECURITY_LOG_SOURCE_ATTRIBUTE] = input.kind;
  attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE] = input.signal;

  const resourceId: string = (input.resourceId || "").trim();
  const resourceType: string = (input.resourceType || "").trim();

  if (resourceType && ObjectID.isValidUUID(resourceId)) {
    attributes[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE] = resourceId;
    attributes[SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE] = resourceType;
  }

  const event: NormalizedSecurityEvent = {
    time: input.time,
    eventUid: input.eventUid,
    categoryUid: category.categoryUid,
    categoryName: category.categoryName,
    classUid: input.classUid,
    className,
    activityName: input.activityName,
    severityId: OcsfSeverityId[input.severity],
    severityName: input.severity,
    statusName: input.statusName,
    message: cutTelemetryText(
      input.message,
      MAX_TELEMETRY_EVENT_MESSAGE_LENGTH,
    ),
    vendorName: definition.vendorName,
    productName: definition.productName,
    ruleId: "",
    ruleName: "",
    mitreTactics: [...attack.tactics],
    mitreTechniques: [...attack.techniques],
    principalUser,
    principalHost,
    principalIp,
    principalProcess: "",
    processName: "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser,
    targetHost,
    targetIp,
    targetPort: input.targetPort || 0,
    targetResource: cutTelemetryText(
      (input.targetResource || "").trim(),
      MAX_TELEMETRY_ATTRIBUTE_LENGTH,
    ),
    observables: buildObservables([
      principalUser,
      targetUser,
      principalHost,
      targetHost,
      principalIp,
      targetIp,
      ...(input.extraObservables || []),
    ]),
    attributes,
    traceId: (input.traceId || "").trim(),
    spanId: (input.spanId || "").trim(),
    sessionId: (input.sessionId || "").trim(),
  };

  if (input.requestOutcome) {
    event.requestOutcome = input.requestOutcome;
  }

  return event;
}
