import { canonicalizeEntityValue } from "../../Utils/Telemetry/EntityKey";
import {
  getMessagingBrokerScope,
  getMessagingIdentitySystem,
  normalizeMessagingSystem,
} from "./MessagingSystem";

/*
 * What makes two sightings the same queue. A queue is a destination of one
 * messaging system — plus, for Azure Service Bus and Event Hubs, the
 * namespace it lives in (see MessagingBrokerScope). Everything in it is
 * canonical (trimmed, lowercased: canonicalizeEntityValue, the same rule
 * the entity key applies), so the identity ingest stamps on a span, the one
 * the discovery cron creates a row under and the one a person types in the
 * create form are byte-identical strings. Deliberately absent: the broker's
 * address (Kafka spans rarely carry one, and an Azure namespace answers on
 * many IPs), the consumer group or subscription (a topic's consumers are
 * not separate queues), partitions and dead-letter sub-queues — all display
 * only. Pure and isomorphic; nothing here throws.
 */

export interface MessageQueueIdentity {
  /*
   * The canonical `messaging.system` the identity is keyed on: the system's
   * identity family (getMessagingIdentitySystem), so an ActiveMQ queue is
   * "jms" here — its JMS clients' spans and its broker's metrics must build
   * one identity. The row's own system column keeps the specific broker.
   */
  system: string;
  /*
   * The lowercased Azure namespace for a namespace-scoped system (Service
   * Bus, Event Hubs), "" for every other system — and for an Azure entity
   * whose namespace nothing named.
   */
  brokerScope: string;
  // The destination, canonicalized (see MessagingTelemetryResolver).
  destination: string;
}

/*
 * The longest identifier a row may store. A resolved destination is at most
 * 255 characters and a scope is one DNS label, so only hand-made input can
 * get near it.
 */
export const MESSAGE_QUEUE_IDENTIFIER_MAX_LENGTH: number = 500;

// A queue's name column is ShortText.
export const MESSAGE_QUEUE_DISPLAY_NAME_MAX_LENGTH: number = 100;

/*
 * The hosts every Azure SDK connects to a Service Bus or Event Hubs
 * namespace at, `<namespace>.<suffix>` — the public cloud, then the US
 * Government, China and Germany sovereign clouds. Event Hubs shares Service
 * Bus's domain.
 */
export const AZURE_SERVICE_BUS_HOST_SUFFIXES: ReadonlyArray<string> = [
  ".servicebus.windows.net",
  ".servicebus.usgovcloudapi.net",
  ".servicebus.chinacloudapi.cn",
  ".servicebus.cloudapi.de",
];

// One DNS label: what an Azure namespace name always is.
const DNS_LABEL_PATTERN: RegExp = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The Azure namespace a Service Bus / Event Hubs host names — the first DNS
 * label of `<namespace>.servicebus.windows.net` (or a sovereign cloud's
 * suffix), lowercased — or null for any other host. Pass a bare host (a
 * trailing dot is accepted), not a URL.
 */
export function getAzureNamespaceFromHost(host: unknown): string | null {
  if (typeof host !== "string") {
    return null;
  }
  let value: string = host.trim().toLowerCase();
  if (value.endsWith(".")) {
    value = value.substring(0, value.length - 1);
  }
  for (const suffix of AZURE_SERVICE_BUS_HOST_SUFFIXES) {
    if (value.length > suffix.length && value.endsWith(suffix)) {
      const label: string = value.substring(0, value.indexOf("."));
      return DNS_LABEL_PATTERN.test(label) ? label : null;
    }
  }
  return null;
}

/**
 * A queue's canonical broker scope for `system`: "" for a system whose
 * identity carries none (whatever `scope` says — Kafka has no namespace),
 * else the lowercased namespace. A namespace host
 * (`orders-prod.servicebus.windows.net`) is reduced to its namespace.
 * Null when a namespace-scoped system is handed something that cannot be a
 * namespace ("my namespace").
 */
export function canonicalizeMessageQueueBrokerScope(
  system: unknown,
  scope: unknown,
): string | null {
  if (getMessagingBrokerScope(system) !== "azure-namespace") {
    return "";
  }
  const value: string =
    typeof scope === "string" ? scope.trim().toLowerCase() : "";
  if (!value) {
    return "";
  }
  const fromHost: string | null = getAzureNamespaceFromHost(value);
  if (fromHost) {
    return fromHost;
  }
  return DNS_LABEL_PATTERN.test(value) ? value : null;
}

/**
 * Whether a value holds a C0 control character or DEL. None belongs in a
 * queue name or an address, and Postgres rejects U+0000 in any text column:
 * a queue named with one could never be stored, while ingest kept stamping
 * its key. The resolver applies the same test to what it resolves.
 */
export function hasControlCharacter(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * The canonical identity of a queue, or null when the system or the
 * destination is empty, the destination holds a control character, the
 * system cannot be one (see normalizeMessagingSystem), or a namespace-scoped
 * system gets a scope that cannot be a namespace. The system's aliases are
 * folded ("AmazonSQS" → "aws_sqs") and it is keyed on its identity family
 * ("activemq" → "jms"); a scope is kept only for a namespace-scoped system.
 */
export function toMessageQueueIdentity(value: {
  system: string;
  brokerScope?: string | null | undefined;
  destination: string;
}): MessageQueueIdentity | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const specificSystem: string | null = normalizeMessagingSystem(value.system);
  if (!specificSystem) {
    return null;
  }
  /*
   * Scope is decided by the specific system (a family never spans a
   * namespace-scoped and an unscoped system), the identity by its family.
   */
  const system: string | null = getMessagingIdentitySystem(specificSystem);
  if (!system) {
    return null;
  }

  const destination: string =
    typeof value.destination === "string"
      ? canonicalizeEntityValue(value.destination)
      : "";
  if (!destination || hasControlCharacter(destination)) {
    return null;
  }

  const brokerScope: string | null = canonicalizeMessageQueueBrokerScope(
    specificSystem,
    value.brokerScope,
  );
  if (brokerScope === null) {
    return null;
  }

  return { system, brokerScope, destination };
}

/**
 * `${system}|${brokerScope}|${destination}` — a queue row's project-unique
 * identifier — built from the canonical identity (so any spelling of the
 * same queue builds the same string). Null when the identity is not valid
 * (see toMessageQueueIdentity) or the identifier would be longer than
 * MESSAGE_QUEUE_IDENTIFIER_MAX_LENGTH. Neither the system nor the scope can
 * contain "|", so parseMessageQueueIdentifier can always split it back.
 */
export function buildMessageQueueIdentifier(
  identity: MessageQueueIdentity,
): string | null {
  const canonical: MessageQueueIdentity | null =
    toMessageQueueIdentity(identity);
  if (!canonical) {
    return null;
  }
  const identifier: string = `${canonical.system}|${canonical.brokerScope}|${canonical.destination}`;
  return identifier.length <= MESSAGE_QUEUE_IDENTIFIER_MAX_LENGTH
    ? identifier
    : null;
}

/**
 * The identity an identifier was built from: split on its first two "|" (a
 * destination may itself contain "|"), then canonicalized like
 * toMessageQueueIdentity. Null for anything that is not an identifier.
 */
export function parseMessageQueueIdentifier(
  identifier: unknown,
): MessageQueueIdentity | null {
  if (typeof identifier !== "string") {
    return null;
  }
  const first: number = identifier.indexOf("|");
  if (first < 0) {
    return null;
  }
  const second: number = identifier.indexOf("|", first + 1);
  if (second < 0) {
    return null;
  }
  return toMessageQueueIdentity({
    system: identifier.substring(0, first),
    brokerScope: identifier.substring(first + 1, second),
    destination: identifier.substring(second + 1),
  });
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * A queue's default name: its destination as resolved (original casing),
 * trimmed and, past MESSAGE_QUEUE_DISPLAY_NAME_MAX_LENGTH characters, cut to
 * fit with a trailing "…" — never through the middle of a surrogate pair,
 * never leaving whitespace before the ellipsis (whatever trim() removes,
 * U+2028 and U+FEFF included).
 */
export function buildMessageQueueDisplayName(resolved: {
  destination: string;
}): string {
  const destination: string =
    resolved && typeof resolved.destination === "string"
      ? resolved.destination.trim()
      : "";
  if (destination.length <= MESSAGE_QUEUE_DISPLAY_NAME_MAX_LENGTH) {
    return destination;
  }

  let end: number = MESSAGE_QUEUE_DISPLAY_NAME_MAX_LENGTH - 1;
  if (isHighSurrogate(destination.charCodeAt(end - 1))) {
    end--;
  }
  return `${destination.substring(0, end).trimEnd()}…`;
}
