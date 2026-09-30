import OneUptimeDate from "Common/Types/Date";
import {
  MESSAGE_QUEUE_DISCOVERY_SOURCES,
  MessageQueueDiscoverySource,
  getMessageQueueDiscoverySourceLabel,
} from "Common/Models/DatabaseModels/MessageQueue";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
  getMessagingBrokerScope,
  getMessagingSystemDisplayName,
  isExcludedMessagingSystem,
  normalizeMessagingSystem,
} from "Common/Types/MessageQueue/MessagingSystem";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  canonicalizeMessageQueueBrokerScope,
  toMessageQueueIdentity,
} from "Common/Types/MessageQueue/MessageQueueIdentity";
import {
  MESSAGING_SYSTEM_ATTRIBUTE,
  ResolvedMessagingDestination,
  resolveMessagingSpan,
} from "Common/Types/MessageQueue/MessagingTelemetryResolver";

/*
 * How the Queues pages describe a MessageQueue row: the options of the
 * list's facets and create form, the System / Broker / Last seen cells, the
 * create form's checks and hints, and the "not found" guard of the view
 * layout. Pure (no React, no API) so the wording is unit-tested without a
 * renderer, and the list, Archived and view pages cannot drift.
 *
 * Everything about messaging systems comes from the one catalog
 * (Common/Types/MessageQueue/MessagingSystem): the pages never spell a
 * broker's name, alias or namespace rule themselves.
 */

export interface MessageQueueOption {
  label: string;
  value: string;
}

// ---- messaging system ---------------------------------------------------

/**
 * Every messaging system the catalog knows, for the create form's System
 * dropdown and the list's System facet, alphabetical by display name. The
 * label carries the canonical `messaging.system` value because that string
 * is what users find in their spans; the value is that canonical system,
 * which is what MessageQueueService's manual create normalizes to anyway.
 */
export function getMessagingSystemOptions(): Array<MessageQueueOption> {
  return MESSAGING_SYSTEMS.map(
    (descriptor: MessagingSystemDescriptor): MessageQueueOption => {
      return {
        label: `${descriptor.displayName} (${descriptor.system})`,
        value: descriptor.system,
      };
    },
  ).sort((a: MessageQueueOption, b: MessageQueueOption): number => {
    return a.label.localeCompare(b.label);
  });
}

/**
 * "Apache Kafka" for a known system (aliases accepted), the stored value
 * for a long-tail one ("ibmmq"), and "—" when the row has none.
 */
export function getMessageQueueSystemLabel(
  system: string | null | undefined,
): string {
  return getMessagingSystemDisplayName(system) || "—";
}

/*
 * Whether a queue of this system lives in an Azure namespace that is part
 * of its identity (Service Bus, Event Hubs): the create form asks for the
 * namespace only then, and the server ignores one sent for any other
 * system (canonicalizeMessageQueueBrokerScope returns "" for them).
 */
export function isNamespaceScopedMessagingSystem(system: unknown): boolean {
  return getMessagingBrokerScope(system) === "azure-namespace";
}

// ---- discovery source ---------------------------------------------------

/** Every discovery source, in the order the facet offers them. */
export function getMessageQueueDiscoverySourceOptions(): Array<MessageQueueOption> {
  return MESSAGE_QUEUE_DISCOVERY_SOURCES.map(
    (source: MessageQueueDiscoverySource): MessageQueueOption => {
      return {
        label: getMessageQueueDiscoverySourceLabel(source),
        value: source,
      };
    },
  );
}

// ---- broker ---------------------------------------------------------------

export interface MessageQueueBrokerSource {
  brokerScope?: string | null | undefined;
  brokerAddress?: string | null | undefined;
}

export interface MessageQueueBrokerLabel {
  // What the Broker cell shows: the namespace, else the address, else "".
  text: string;
  // The hover text saying which of the two it is.
  title: string;
}

/**
 * The Broker cell. An Azure namespace is part of the queue's identity and
 * names the broker exactly, so it wins; otherwise the broker address the
 * queue's telemetry last reported (display only — a Kafka topic is reached
 * at many brokers, so it is never identity). Empty when neither is known.
 */
export function getMessageQueueBrokerLabel(
  source: MessageQueueBrokerSource | null | undefined,
): MessageQueueBrokerLabel {
  const namespace: string = (source?.brokerScope || "").toString().trim();
  if (namespace) {
    return { text: namespace, title: `Azure namespace ${namespace}` };
  }
  const address: string = (source?.brokerAddress || "").toString().trim();
  if (address) {
    return { text: address, title: `Broker address ${address}` };
  }
  return { text: "", title: "" };
}

// ---- last seen ------------------------------------------------------------

/**
 * The Last seen cell: relative ("5 minutes ago"), with the full local date
 * and time on hover. "Never" for a queue nothing has seen yet — a queue
 * added by hand before its first span or broker metric.
 */
export function getMessageQueueLastSeenText(
  lastSeenAt: Date | string | null | undefined,
): { text: string; title: string } {
  if (!lastSeenAt) {
    return { text: "Never", title: "" };
  }
  const date: Date =
    lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  if (Number.isNaN(date.getTime())) {
    return { text: "—", title: "" };
  }
  return {
    text: OneUptimeDate.fromNow(date),
    title: OneUptimeDate.getDateAsLocalFormattedString(date),
  };
}

// ---- lookup ---------------------------------------------------------------

/*
 * Whether a queue lookup found a row. The API answers a deleted or unknown
 * id with `{}`, which ModelAPI.getItem turns into an EMPTY model, not null.
 * Every row has a queueIdentifier (the column is NOT NULL, and the view's
 * telemetry is scoped by the entity key built from it), so a row without
 * one is no row at all.
 */
export function isMessageQueueFound(
  item: { queueIdentifier?: string | null | undefined } | null | undefined,
): boolean {
  return Boolean(
    item &&
      typeof item.queueIdentifier === "string" &&
      item.queueIdentifier.trim(),
  );
}

export const MESSAGE_QUEUE_NOT_FOUND_MESSAGE: string = "Queue not found.";

// ---- copy -------------------------------------------------------------------

/*
 * The name is not the identity: discovery keys a queue by its system,
 * destination and (for Service Bus / Event Hubs) namespace, sets `name`
 * only when it creates the row, and never writes it again. So a discovered
 * "orders.created" can be renamed "Order events" for good — and label and
 * owner rules, which match on name and description, see the new one.
 */
export const MESSAGE_QUEUE_NAME_HELP: string =
  "Shown everywhere this queue appears. Renaming is safe: queues are matched by their messaging system and destination, never by name, and label and owner rules match the new name.";

/*
 * Deleting a DISCOVERED queue does not make it go away: the next span or
 * broker metric that names it creates it again, with a new id, named after
 * its destination, and without the name, description, labels and owners
 * people gave it (label and owner rules run again on the new row). Its
 * history is not lost: the Traces and Metrics tabs and the Overview read
 * telemetry by the key of the queue's identity (keyForMessageQueue), which
 * the new row shares. Archiving is what dismisses it — an archived queue
 * keeps its identity, so what names it attaches to the archived row instead
 * of creating a new one.
 */
export const MESSAGE_QUEUE_DELETE_WARNING: string =
  "A queue discovered from application traces or broker metrics comes back the next time its spans or metrics name it, with a new id and without the name, description, labels and owners people gave it; its traces and metrics are still there. To hide a queue you no longer care about, archive it instead (Settings → Archive).";

export const MESSAGE_QUEUE_DESTINATION_DESCRIPTION: string =
  "The queue, topic or subscription name as your applications and the broker name it. An SQS queue URL, an SNS topic ARN or a Pub/Sub resource path is reduced to its name, the way discovery reads it.";

/*
 * An empty namespace is a real queue: the one spans from the emulator or
 * through a custom domain key on (they name no namespace host). Azure
 * Monitor names the namespace of every metric, so its metrics never reach
 * that queue — which is why the field says when to leave it empty.
 */
export const MESSAGE_QUEUE_NAMESPACE_DESCRIPTION: string =
  "The Azure namespace the queue lives in: the first part of <namespace>.servicebus.windows.net, or that whole host name. It is part of the queue's identity, because two namespaces can each hold a queue of the same name. Leave it empty only for a queue your applications reach through the emulator or a custom domain: their spans name no namespace, and Azure Monitor's metrics never reach such a queue.";

// ---- manual create ----------------------------------------------------------

/*
 * What MessageQueueService.onBeforeCreate will store for a manual create,
 * computed in the browser so the form can explain a refusal before it is
 * sent and show how a pasted URL or path will be read. It chains the SAME
 * catalog calls, in the same order, as the server's
 * resolveManualMessageQueue (Common/Server/Services/MessageQueueService.ts),
 * which the browser cannot import: the system normalized, the namespace
 * canonicalized for a namespace-scoped system, the destination resolved
 * exactly as discovery resolves a span's (resolveMessagingSpan: URL / ARN /
 * path reduction, temporary and generated names refused, UUIDs templated),
 * and the family-keyed identifier built. MessageQueuePresentation.test pins
 * it to the server function over a large input table, so the two cannot
 * drift. Null wherever the server would refuse.
 */
export interface MessageQueueManualPreview {
  // The specific canonical system ("activemq").
  system: string;
  // The destination as it will be stored, original casing.
  destination: string;
  // The canonical Azure namespace, "" for none.
  brokerScope: string;
  queueIdentifier: string;
}

export interface MessageQueueManualInput {
  messagingSystem?: unknown;
  destinationName?: unknown;
  brokerScope?: unknown;
}

function trimmedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function previewManualMessageQueue(
  input: MessageQueueManualInput | null | undefined,
): MessageQueueManualPreview | null {
  const rawSystem: string = trimmedText(input?.messagingSystem);
  if (!rawSystem || isExcludedMessagingSystem(rawSystem)) {
    return null;
  }

  const system: string | null = normalizeMessagingSystem(rawSystem);
  if (!system) {
    return null;
  }

  const rawDestination: string = trimmedText(input?.destinationName);
  if (!rawDestination) {
    return null;
  }

  const brokerScope: string | null = canonicalizeMessageQueueBrokerScope(
    system,
    input?.brokerScope,
  );
  if (brokerScope === null) {
    return null;
  }

  const resolved: ResolvedMessagingDestination | null = resolveMessagingSpan({
    getAttribute: (key: string): unknown => {
      if (key === MESSAGING_SYSTEM_ATTRIBUTE) {
        return system;
      }
      if (key === "messaging.destination.name") {
        return rawDestination;
      }
      return undefined;
    },
    kind: null,
  });
  if (!resolved) {
    return null;
  }

  const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
    system: resolved.system,
    brokerScope: brokerScope,
    destination: resolved.destination,
  });
  const queueIdentifier: string | null = identity
    ? buildMessageQueueIdentifier(identity)
    : null;
  if (!identity || !queueIdentifier) {
    return null;
  }

  return {
    system: resolved.system,
    destination: resolved.destination,
    brokerScope: identity.brokerScope,
    queueIdentifier: queueIdentifier,
  };
}

/**
 * The create form's Destination check: null when the server would accept
 * the destination for the chosen system, otherwise why not — in the words
 * the server uses. Nothing to say until both a system and a destination
 * are filled in (the fields' own "required" says that), nor for a
 * namespace-scoped system whose namespace is not valid yet (the Namespace
 * field explains that one).
 */
export function validateMessageQueueDestination(
  values: MessageQueueManualInput,
): string | null {
  const system: string = trimmedText(values.messagingSystem);
  const destination: string = trimmedText(values.destinationName);
  if (!system || !destination) {
    return null;
  }
  if (
    canonicalizeMessageQueueBrokerScope(system, values.brokerScope) === null
  ) {
    return null;
  }
  if (previewManualMessageQueue(values)) {
    return null;
  }
  return `"${destination}" cannot be a queue: OneUptime never keeps a queue for a temporary, generated or placeholder destination (a reply queue, an inbox, a bare UUID), a list of names, a name with control characters or a name longer than 255 characters.`;
}

/**
 * The create form's Namespace check (Service Bus / Event Hubs only): null
 * for an empty value (a queue without a namespace, as the emulator's and a
 * custom domain's spans key it) or a valid namespace or namespace host,
 * otherwise the server's explanation.
 */
export function validateMessageQueueNamespace(
  values: MessageQueueManualInput,
): string | null {
  const scope: string = trimmedText(values.brokerScope);
  if (!scope || !isNamespaceScopedMessagingSystem(values.messagingSystem)) {
    return null;
  }
  if (
    canonicalizeMessageQueueBrokerScope(values.messagingSystem, scope) !== null
  ) {
    return null;
  }
  return `"${scope}" is not an Azure namespace name. Enter the namespace - the first part of <namespace>.servicebus.windows.net - or that whole host name.`;
}

/**
 * The hint under the Destination field when the stored name will differ
 * from what was typed — an SQS queue URL, an SNS topic ARN, a Pub/Sub
 * resource path, a Pulsar short name, a UUID — so nobody is surprised to
 * find "orders" in the list after pasting a URL. Null when it is stored as
 * typed, or cannot be stored at all (the check above explains that).
 */
export function getMessageQueueDestinationHint(
  values: MessageQueueManualInput,
): string | null {
  const preview: MessageQueueManualPreview | null =
    previewManualMessageQueue(values);
  if (!preview) {
    return null;
  }
  if (preview.destination === trimmedText(values.destinationName)) {
    return null;
  }
  return `Saved as "${preview.destination}", the name OneUptime reads from this value in your telemetry.`;
}

/**
 * The hint under the Namespace field when a namespace host is reduced to
 * its namespace ("orders-prod.servicebus.windows.net" → "orders-prod").
 */
export function getMessageQueueNamespaceHint(
  values: MessageQueueManualInput,
): string | null {
  const scope: string = trimmedText(values.brokerScope);
  if (!scope || !isNamespaceScopedMessagingSystem(values.messagingSystem)) {
    return null;
  }
  const canonical: string | null = canonicalizeMessageQueueBrokerScope(
    values.messagingSystem,
    scope,
  );
  if (!canonical || canonical === scope) {
    return null;
  }
  return `Saved as "${canonical}".`;
}
