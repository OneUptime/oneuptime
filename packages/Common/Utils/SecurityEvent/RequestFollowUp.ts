import IP from "../../Types/IP/IP";
import { JSONObject } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import { OcsfSeverityId } from "../../Types/SecurityEvent/OcsfSeverity";
import OcsfSeverity from "../../Types/SecurityEvent/OcsfSeverity";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  WEB_ATTACK_KIND_ATTRIBUTE,
  WEB_ATTACK_PAYLOAD_ATTRIBUTE,
  WebAttackKind,
  buildWebAttackMessage,
  isWebAttackKind,
  severityForWebAttack,
} from "./LogParsers/WebAttackLogParser";
import {
  RequestTraceAssessment,
  getMoreSeriousOutcome,
  readStatusCode,
} from "./RequestOutcome";

/*
 * What following a request adds to the security event it happened in.
 *
 * The trace knows what the log line did not: who sent the request (the
 * client address, the signed-in user), what it was (the method, the route),
 * what the app answered, how long it took, the exception it threw and the
 * query it ran. Each fact goes on the event as an attribute - under
 * OpenTelemetry's name where there is one - unless the event already says
 * it, and the typed columns the source left empty are filled from them, so
 * the rules, the searches and the entity pages read them like any other.
 *
 * A web attack is then judged again: its severity follows how far it got
 * (severityForWebAttack) and its message says what the app answered.
 *
 * Pure: the trace reader (Server/Utils/SecurityEvent/RequestTrace) hands it
 * an assessment, and it changes the event in place.
 */

// The longest value a followed fact keeps.
export const MAX_FOLLOWED_VALUE_LENGTH: number = 2000;

function cut(value: string, limit: number = MAX_FOLLOWED_VALUE_LENGTH): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function setIfAbsent(
  attributes: JSONObject,
  key: string,
  value: string | undefined,
): void {
  const text: string = (value || "").trim();

  if (!text) {
    return;
  }

  const current: unknown = attributes[key];

  if (current !== undefined && current !== null && String(current).trim()) {
    return;
  }

  attributes[key] = cut(text);
}

function readClientAddress(value: string): string {
  const candidate: string = (value || "").trim();

  return candidate && candidate.length <= 64 && IP.isIP(candidate)
    ? candidate
    : "";
}

function addObservable(event: NormalizedSecurityEvent, value: string): void {
  if (value && !event.observables.includes(value)) {
    event.observables.push(value);
  }
}

export function applyRequestAssessment(
  event: NormalizedSecurityEvent,
  assessment: RequestTraceAssessment,
): void {
  const attributes: JSONObject = event.attributes;
  const method: string = (assessment.method || "").trim().toUpperCase();
  const clientAddress: string = readClientAddress(assessment.clientAddress);
  const userId: string = cut((assessment.userId || "").trim(), 255);

  setIfAbsent(attributes, SECURITY_REQUEST_ATTRIBUTES.method, method);
  setIfAbsent(attributes, SECURITY_REQUEST_ATTRIBUTES.url, assessment.url);
  setIfAbsent(attributes, SECURITY_REQUEST_ATTRIBUTES.route, assessment.route);
  setIfAbsent(
    attributes,
    SECURITY_REQUEST_ATTRIBUTES.statusCode,
    assessment.statusCode ? String(assessment.statusCode) : "",
  );
  setIfAbsent(
    attributes,
    SECURITY_REQUEST_ATTRIBUTES.clientAddress,
    clientAddress,
  );
  setIfAbsent(
    attributes,
    SECURITY_REQUEST_ATTRIBUTES.userAgent,
    cut(assessment.userAgent || "", 1000),
  );
  setIfAbsent(attributes, SECURITY_REQUEST_ATTRIBUTES.userId, userId);

  if (assessment.durationMs > 0) {
    attributes[SECURITY_REQUEST_ATTRIBUTES.durationMs] = String(
      Math.round(assessment.durationMs),
    );
  }

  if (assessment.serverSpanId) {
    attributes[SECURITY_REQUEST_ATTRIBUTES.serverSpanId] =
      assessment.serverSpanId;
  }

  if (assessment.exception) {
    setIfAbsent(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint,
      assessment.exception.fingerprint,
    );
    setIfAbsent(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.exceptionType,
      assessment.exception.exceptionType,
    );
    setIfAbsent(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.exceptionMessage,
      cut(assessment.exception.message || "", 500),
    );
  }

  if (assessment.database) {
    setIfAbsent(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.databaseSystem,
      assessment.database.system,
    );
    setIfAbsent(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.databaseStatement,
      assessment.database.statement,
    );

    if (assessment.database.durationMs > 0) {
      attributes[SECURITY_REQUEST_ATTRIBUTES.databaseDurationMs] = String(
        Math.round(assessment.database.durationMs),
      );
    }
  }

  if (assessment.requestedDelaySeconds > 0) {
    attributes[SECURITY_REQUEST_ATTRIBUTES.requestedDelaySeconds] = String(
      assessment.requestedDelaySeconds,
    );
  }

  event.requestOutcome = getMoreSeriousOutcome(
    event.requestOutcome,
    assessment.outcome,
  );

  // The typed columns the source left empty.
  if (!event.principalIp && clientAddress) {
    event.principalIp = clientAddress;
  }

  addObservable(event, event.principalIp);

  if (!event.principalUser && userId) {
    event.principalUser = userId;
  }

  addObservable(event, event.principalUser);

  if (!event.activityName && method) {
    event.activityName = method;
  }

  const statusCode: number = readStatusCode(
    attributes[SECURITY_REQUEST_ATTRIBUTES.statusCode],
  );

  if (!event.statusName && statusCode) {
    event.statusName = statusCode >= 400 ? "Failure" : "Success";
  }

  const kind: unknown = attributes[WEB_ATTACK_KIND_ATTRIBUTE];

  if (isWebAttackKind(kind)) {
    rejudgeWebAttack(event, kind, statusCode);
  }
}

// A web attack's severity and message, from what is now known about its request.
function rejudgeWebAttack(
  event: NormalizedSecurityEvent,
  kind: WebAttackKind,
  statusCode: number,
): void {
  const severity: OcsfSeverity = severityForWebAttack(
    kind,
    event.requestOutcome,
  );

  event.severityName = severity;
  event.severityId = OcsfSeverityId[severity];
  event.message = buildWebAttackMessage({
    kind,
    method: String(event.attributes[SECURITY_REQUEST_ATTRIBUTES.method] || ""),
    // The address asked for, as the parser chose it; the target otherwise.
    target:
      String(event.attributes[SECURITY_REQUEST_ATTRIBUTES.url] || "") ||
      event.targetResource,
    statusCode,
    payload: String(event.attributes[WEB_ATTACK_PAYLOAD_ATTRIBUTE] || ""),
  });
}
