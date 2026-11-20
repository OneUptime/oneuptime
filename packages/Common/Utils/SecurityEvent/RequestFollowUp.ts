import { JSONObject } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../Types/SecurityEvent/OcsfSeverity";
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
import {
  ClientAddressReading,
  ClientAddressTrust,
  getAddressSlotText,
  readClaimedClientAddress,
  readClientAddressTrust,
} from "./ClientAddressTrust";
import {
  HiddenClientAddress,
  ScrubbedAddressPlace,
  clearClientAddressScrubbed,
  isAddressVaultToken,
  markClientAddressScrubbed,
  readHiddenClientAddress,
} from "./ScrubbedAddress";

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
 * The client the trace names is one its sender could not have written
 * (ClientAddressTrust, #10416): an address the request only claimed - the
 * span's client.address from X-Forwarded-For - is kept as a claim, never
 * the event's principalIp.
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
  const client: ClientAddressReading = assessment.client;
  const clientAddress: string = client.address;
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
    // A log rule hid the address the trace names: nothing is hidden now.
    clearClientAddressScrubbed(attributes);
    // How the trace knew it, in place of what the line could not verify.
    if (client.trust) {
      attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust] = client.trust;
    }
  }

  /*
   * The trace's span holds what a trace scrub rule left of the client's
   * verified address (#10397): an event that names no address, nor says
   * why, says that. One that already says a log rule hid it keeps saying
   * so - unless the log's rule left nothing to look up and the trace's Hash
   * rule left a token Security Events' address vault can name (#10395): the
   * token is what may still name the address, so it is the one the event
   * keeps. A token only the request claimed is never one (#10416): the
   * trace's verified address is the only one read here.
   */
  if (!event.principalIp && client.scrubbed) {
    const hidden: HiddenClientAddress | null = readHiddenClientAddress(event);

    if (
      !hidden ||
      (isAddressVaultToken(client.scrubbed) && !isAddressVaultToken(hidden))
    ) {
      clearClientAddressScrubbed(attributes);
      markClientAddressScrubbed(attributes, {
        scrubbed: client.scrubbed,
        place: ScrubbedAddressPlace.SpanAttributes,
      });

      if (client.trust) {
        attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust] =
          client.trust;
      }
    }
  }

  /*
   * What the request claimed beside it, when the event says nothing of a
   * claim: never the event's address, only said as claimed.
   */
  if (
    client.claimed &&
    !readClaimedClientAddress(event) &&
    !(client.claimed.address && client.claimed.address === event.principalIp)
  ) {
    attributes[SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress] =
      getAddressSlotText(client.claimed);

    if (client.claimedFrom) {
      attributes[SECURITY_REQUEST_ATTRIBUTES.claimedClientAddressFrom] =
        client.claimedFrom;
    }
  }

  // Nothing verified anywhere: the event says its address is only claimed.
  if (
    !event.principalIp &&
    !readHiddenClientAddress(event) &&
    !readClientAddressTrust(event) &&
    client.trust === ClientAddressTrust.Claimed
  ) {
    attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust] =
      ClientAddressTrust.Claimed;
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
