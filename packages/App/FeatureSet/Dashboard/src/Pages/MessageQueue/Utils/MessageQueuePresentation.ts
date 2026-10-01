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
  normalizeMessagingSystem,
} from "Common/Types/MessageQueue/MessagingSystem";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import { canonicalizeMessageQueueBrokerScope } from "Common/Types/MessageQueue/MessageQueueIdentity";
import {
  ManualMessageQueueCheck,
  checkManualMessageQueue,
} from "Common/Types/MessageQueue/MessageQueueManualIdentity";

/*
 * How the Queues pages describe a MessageQueue row: the options of the
 * list's facets and create form, the System / Broker / Last seen cells, the
 * create form's checks and hints, the "not found" guard of the view layout,
 * and whether the row's broker metrics can ever reach it. Pure (no React,
 * no API) so the wording is unit-tested without a renderer, and the list,
 * Archived and view pages cannot drift. This is the ONE home of what several
 * Queues pages share: the Overview and its tabs (Components/MessageQueue)
 * and the Documentation tab's guide (DocumentationMarkdown) import these
 * rather than keep copies of their own.
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

/*
 * The create form's "Other messaging system" choice: a broker the catalog
 * does not know (IBM MQ, MQTT, Solace, Sidekiq...), whose spans still create
 * queues under the messaging.system value they report — so a queue of it can
 * be added by hand too, under that same value, typed into the field this
 * choice shows (MESSAGE_QUEUE_OTHER_SYSTEM_FIELD). The choice's own value is
 * never a messaging.system: it is not well formed (it starts with "_"), so
 * the server would refuse it if it were ever sent, and onBeforeCreate
 * replaces it with the typed value first.
 */
export const MESSAGE_QUEUE_OTHER_SYSTEM_VALUE: string = "__other__";
export const MESSAGE_QUEUE_OTHER_SYSTEM_LABEL: string =
  "Other messaging system...";
// The form-only field the typed messaging.system value is held in.
export const MESSAGE_QUEUE_OTHER_SYSTEM_FIELD: string = "otherMessagingSystem";

export const MESSAGE_QUEUE_OTHER_SYSTEM_DESCRIPTION: string =
  'The messaging.system value your applications\' spans report for this broker, exactly as they report it: lowercase letters, digits, ".", "_" and "-", at most 64 characters.';

/**
 * The create form's System dropdown: every catalog system, then the "Other
 * messaging system" choice for one it does not know.
 */
export function getMessageQueueCreateSystemOptions(): Array<MessageQueueOption> {
  return [
    ...getMessagingSystemOptions(),
    {
      label: MESSAGE_QUEUE_OTHER_SYSTEM_LABEL,
      value: MESSAGE_QUEUE_OTHER_SYSTEM_VALUE,
    },
  ];
}

/**
 * The list's System facet: every catalog system, then each system outside
 * the catalog that a queue of the project has (`present`: the stored
 * messagingSystem values), by its stored value — the value the facet
 * filters on. Deduplicated, blanks and catalog systems (aliases included)
 * left out.
 */
export function getMessageQueueSystemFacetOptions(
  present: ReadonlyArray<string | null | undefined>,
): Array<MessageQueueOption> {
  const catalog: Array<MessageQueueOption> = getMessagingSystemOptions();
  const known: Set<string> = new Set<string>(
    catalog.map((option: MessageQueueOption): string => {
      return option.value;
    }),
  );
  const others: Set<string> = new Set<string>();
  for (const value of present) {
    const system: string = (value || "").toString().trim();
    if (
      !system ||
      known.has(system) ||
      known.has(normalizeMessagingSystem(system) || "")
    ) {
      continue;
    }
    others.add(system);
  }
  return [
    ...catalog,
    ...Array.from(others)
      .sort((a: string, b: string): number => {
        return a.localeCompare(b);
      })
      .map((system: string): MessageQueueOption => {
        return { label: system, value: system };
      }),
  ];
}

/**
 * The messaging system a create form's values name: the typed value when
 * "Other messaging system" is chosen, else the chosen catalog system.
 */
export function getMessageQueueFormSystem(
  values: Record<string, unknown> | null | undefined,
): string {
  const chosen: string = trimmedText(values?.["messagingSystem"]);
  if (chosen === MESSAGE_QUEUE_OTHER_SYSTEM_VALUE) {
    return trimmedText(values?.[MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]);
  }
  return chosen;
}

/** The create form's values as the manual create reads them. */
export function toMessageQueueManualInput(
  values: Record<string, unknown> | null | undefined,
): MessageQueueManualInput {
  return {
    messagingSystem: getMessageQueueFormSystem(values),
    destinationName: values?.["destinationName"],
    brokerScope: values?.["brokerScope"],
  };
}

/**
 * The typed system's check ("Other messaging system" only): null for a
 * value the server takes, otherwise its refusal, word for word. Nothing to
 * say while it is empty (the field's own "required" says that).
 */
export function validateMessageQueueOtherSystem(
  values: Record<string, unknown> | null | undefined,
): string | null {
  if (
    trimmedText(values?.["messagingSystem"]) !==
    MESSAGE_QUEUE_OTHER_SYSTEM_VALUE
  ) {
    return null;
  }
  const typed: string = getMessageQueueFormSystem(values);
  if (!typed) {
    return null;
  }
  const check: ManualMessageQueueCheck = checkManualMessageQueue({
    messagingSystem: typed,
  });
  return check.refusal?.field === "messagingSystem"
    ? check.refusal.message
    : null;
}

/**
 * The hint under the typed system when it will be stored differently: an
 * alias of a catalog system ("AmazonSQS" is Amazon SQS, aws_sqs) or a value
 * in another case ("MQTT" is stored "mqtt"). Null when stored as typed, or
 * refused (the check above says why).
 */
export function getMessageQueueOtherSystemHint(
  values: Record<string, unknown> | null | undefined,
): string | null {
  if (
    trimmedText(values?.["messagingSystem"]) !==
    MESSAGE_QUEUE_OTHER_SYSTEM_VALUE
  ) {
    return null;
  }
  const typed: string = getMessageQueueFormSystem(values);
  const system: string | null = normalizeMessagingSystem(typed);
  if (!typed || !system || system === typed) {
    return null;
  }
  const displayName: string = getMessagingSystemDisplayName(system);
  return displayName && displayName !== system
    ? `Saved as "${system}", ${displayName}.`
    : `Saved as "${system}".`;
}

/**
 * "Apache Kafka" for a known system (aliases accepted), the stored value
 * for a long-tail one ("ibmmq"), and "—" when the row has none. The list and
 * Archived System cells, the Overview, Broker health and the Documentation
 * tab (its title and its guide) all name a queue's system with it, so a
 * queue without one reads "—" on each. (The telemetry tabs' locked chip
 * leaves an unknown system out instead: "orders", not "orders (—)".)
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

/**
 * How a queue's discovery source reads — "Application traces", "Broker
 * metrics", "Added manually" — and "Unknown" for a row without one. The
 * list's "Discovered from" cell and the Overview (its chip and detail row)
 * both name the source with it, so the two never disagree.
 */
export function getMessageQueueDiscoveryLabel(
  source: string | null | undefined,
): string {
  return getMessageQueueDiscoverySourceLabel(source) || "Unknown";
}

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

// ---- broker metrics ---------------------------------------------------------

/*
 * The queue a broker-metrics question is about, as its identity names it:
 * the row, or parseMessageQueueIdentifier of its queueIdentifier. A
 * namespace-scoped system's broker metrics reach only a queue with a
 * namespace.
 */
export interface MessageQueueBrokerMetricsTarget {
  brokerScope?: string | null | undefined;
}

/**
 * Whether a system's broker metrics can ever name this queue: THE rule both
 * the Overview's Broker health section (whether it offers a setup) and the
 * queue's Documentation tab (whether its guide promises the broker's own
 * metrics) follow, so the two never disagree. Only a system with curated
 * metrics (MessageQueueMetricCatalog) has broker metrics that name a queue:
 * a collector can read NATS's and Azure Event Grid's brokers, but NATS
 * reports JetStream streams and consumers rather than subjects, and Event
 * Grid its topics and event subscriptions, so those metrics stay in the
 * Metrics explorer. And a system whose metrics name the namespace they come
 * from (the catalog's scopeAttributes: Azure Monitor's `name`) reaches only
 * a queue with a namespace: one whose spans came from the emulator or
 * through a custom domain has none, and the metrics key on the same
 * destination's queue in the namespace instead. Without a queue, only the
 * system decides — so "reaches queues, but not this one" is the rule asked
 * with and without the queue.
 */
export function canBrokerMetricsReachMessageQueue(
  system: string | null | undefined,
  queue?: MessageQueueBrokerMetricsTarget | null | undefined,
): boolean {
  const metrics: ReadonlyArray<MessageQueueMetricDescriptor> =
    getMessageQueueMetricsForSystem(system);
  if (metrics.length === 0) {
    return false;
  }
  if (!queue) {
    return true;
  }
  const namesNamespace: boolean = metrics.some(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return (descriptor.scopeAttributes || []).length > 0;
    },
  );
  return !namesNamespace || Boolean((queue.brokerScope || "").trim());
}

// ---- last seen ------------------------------------------------------------

/**
 * A row's date column as a Date: a Date as it is, text (the API's JSON)
 * parsed, and null for none or a value that is no date. The Last seen cell
 * and the Overview's liveness read lastSeenAt through this one parse.
 */
export function toMessageQueueDate(
  value: Date | string | null | undefined,
): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

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
  const date: Date | null = toMessageQueueDate(lastSeenAt);
  if (!date) {
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
 * sent and show how a pasted URL or path will be read. It IS the server's
 * check (checkManualMessageQueue, Common/Types/MessageQueue/
 * MessageQueueManualIdentity, which the server's resolveManualMessageQueue
 * applies): the system normalized, the namespace canonicalized for a
 * namespace-scoped system, the destination resolved as discovery resolves a
 * span's (a RabbitMQ queue's name taken whole), and the family-keyed
 * identifier built — so the form can never preview an identity the server
 * does not store, nor quote a refusal it would not make. The check itself
 * is tested in MessageQueueManualIdentity.test, and how the form reads it
 * in MessageQueuePresentation.test. Null wherever the server would refuse.
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
  const check: ManualMessageQueueCheck = checkManualMessageQueue({
    messagingSystem: input?.messagingSystem,
    destinationName: input?.destinationName,
    brokerScope: input?.brokerScope,
  });
  if (!check.queue) {
    return null;
  }
  return {
    system: check.queue.system,
    destination: check.queue.destination,
    brokerScope: check.queue.brokerScope,
    queueIdentifier: check.queue.queueIdentifier,
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
  /*
   * The server's refusal of the destination, word for word. A refused
   * system or namespace is its own field's to explain.
   */
  const check: ManualMessageQueueCheck = checkManualMessageQueue({
    messagingSystem: values.messagingSystem,
    destinationName: values.destinationName,
    brokerScope: values.brokerScope,
  });
  return check.refusal?.field === "destinationName"
    ? check.refusal.message
    : null;
}

/**
 * The create form's Namespace check (Service Bus / Event Hubs only): null
 * for an empty value (a queue without a namespace, as the emulator's and a
 * custom domain's spans key it), a valid namespace or namespace host, or a
 * system without namespaces; otherwise the server's refusal, word for word.
 * The shared check judges the namespace before the destination, so it
 * speaks while the destination is still empty. A refused system is its own
 * field's to explain.
 */
export function validateMessageQueueNamespace(
  values: MessageQueueManualInput,
): string | null {
  const check: ManualMessageQueueCheck = checkManualMessageQueue({
    messagingSystem: values.messagingSystem,
    destinationName: values.destinationName,
    brokerScope: values.brokerScope,
  });
  return check.refusal?.field === "brokerScope" ? check.refusal.message : null;
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
