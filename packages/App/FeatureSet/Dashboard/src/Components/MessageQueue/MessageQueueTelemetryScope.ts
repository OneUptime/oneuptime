import { LockedEntityKeyDisplayMap } from "../../Utils/LockedEntityKeyChips";
import Includes from "Common/Types/BaseDatabase/Includes";
import {
  MessageQueueIdentity,
  parseMessageQueueIdentifier,
} from "Common/Types/MessageQueue/MessageQueueIdentity";
import { getMessagingSystemDisplayName } from "Common/Types/MessageQueue/MessagingSystem";
import ObjectID from "Common/Types/ObjectID";
import { keyForMessageQueue } from "Common/Utils/Telemetry/EntityKey";

/*
 * How a Queue (a MessageQueue row) is scoped onto raw telemetry.
 *
 * Ingest ties telemetry to a queue through ONE entity key: every messaging
 * span and every broker / client datapoint that resolves to the queue gets
 * `keyForMessageQueue(projectId, identity)` appended to its entityKeys
 * (App/FeatureSet/Telemetry/Services/MessagingEntityKeys.ts). The identity
 * is the queue's FAMILY identity — an ActiveMQ queue's key says "jms", so the
 * JMS spans of its Java clients and its broker's JMX Scraper metrics are one
 * queue — and the row stores it as `queueIdentifier`. So the key is built
 * from parseMessageQueueIdentifier(row.queueIdentifier), NEVER from the
 * row's `messagingSystem` column: that one keeps the specific broker
 * ("activemq") for the catalog and the docs, and a key built from it would
 * match nothing ingest stamped.
 *
 * THE RULE THAT MATTERS: an empty key set is "unscoped", never "everything".
 * An empty `Includes` drops the predicate server side, so a row whose
 * identifier does not parse (or a page with no project) would chart the
 * whole project's traffic as its own. getMessageQueueEntityKeysQueryValue
 * returns null for an empty set, the query builders send nothing then, and
 * every page checks isMessageQueueScoped before it mounts a viewer — the
 * rule DatabaseTelemetryScope applies to a database.
 *
 * Pure (no React, no API): the pages, the Overview's queries and the tests
 * share it.
 */

/** The subset of a MessageQueue row the scope depends on. */
export interface MessageQueueScopeSource {
  projectId: string | ObjectID | null | undefined;
  // `${system}|${brokerScope}|${destination}`, canonical, family-keyed.
  queueIdentifier: string | null | undefined;
  // The row's name, for the viewers' locked chip.
  name?: string | null | undefined;
  // The row's SPECIFIC system ("activemq"), for the chip's wording only.
  messagingSystem?: string | null | undefined;
}

// What the viewers' locked chip calls the key.
export const MESSAGE_QUEUE_CHIP_KEY: string = "Queue";

function projectIdText(
  projectId: MessageQueueScopeSource["projectId"],
): string {
  if (!projectId) {
    return "";
  }
  return projectId.toString().trim();
}

/**
 * The identity the queue's telemetry is keyed on: its stored identifier,
 * parsed and canonicalized. Null when there is no row or the identifier is
 * not one (a row always has one; this is the defensive case).
 */
export function getMessageQueueScopeIdentity(
  source: MessageQueueScopeSource | null | undefined,
): MessageQueueIdentity | null {
  if (!source) {
    return null;
  }
  return parseMessageQueueIdentifier(source.queueIdentifier);
}

/**
 * Every entity key that belongs to the queue — its one queue key. Empty
 * means "nothing to query": no project, or an identifier that does not
 * parse.
 */
export function getMessageQueueScopeKeys(
  source: MessageQueueScopeSource | null | undefined,
): Array<string> {
  const projectId: string = projectIdText(source?.projectId);
  const identity: MessageQueueIdentity | null =
    getMessageQueueScopeIdentity(source);
  if (!projectId || !identity) {
    return [];
  }
  return [keyForMessageQueue(projectId, identity)];
}

/** True only for a non-empty key set. */
export function isMessageQueueScoped(
  keys: ReadonlyArray<string> | null | undefined,
): boolean {
  return Array.isArray(keys) && keys.length > 0;
}

/**
 * The `entityKeys` query value for a key set, or null when the set is empty
 * — never an empty Includes, which would scope to the whole project.
 */
export function getMessageQueueEntityKeysQueryValue(
  keys: ReadonlyArray<string> | null | undefined,
): Includes | null {
  if (!isMessageQueueScoped(keys)) {
    return null;
  }
  return new Includes([...(keys as ReadonlyArray<string>)]);
}

/**
 * The name the queue's chip reads: the row's name, else its destination.
 * With the system's display name when one is known — "orders (Apache
 * Kafka)" — because "orders" alone may name a queue on every broker the
 * project uses.
 */
export function getMessageQueueChipValue(
  source: MessageQueueScopeSource | null | undefined,
): string {
  const identity: MessageQueueIdentity | null =
    getMessageQueueScopeIdentity(source);
  const name: string =
    (typeof source?.name === "string" && source.name.trim()) ||
    identity?.destination ||
    "";
  const system: string = getMessagingSystemDisplayName(
    (typeof source?.messagingSystem === "string" &&
      source.messagingSystem.trim()) ||
      identity?.system ||
      "",
  );
  if (!name) {
    return system;
  }
  return system ? `${name} (${system})` : name;
}

/**
 * How the viewers' locked chip names the key: "Queue: orders (Apache
 * Kafka)" instead of a hash nobody can read. No search syntax is attached:
 * the key is stamped on span attributes and on broker datapoints whose
 * destination sits under a different key per broker (`topic`,
 * `resource.rabbitmq.queue.name`, `metadata_entityname`, …), so no single
 * attribute search reproduces it — the chip says so instead.
 */
export function buildMessageQueueEntityKeyDisplays(
  source: MessageQueueScopeSource | null | undefined,
): LockedEntityKeyDisplayMap {
  const displays: LockedEntityKeyDisplayMap = {};
  const value: string = getMessageQueueChipValue(source);
  for (const key of getMessageQueueScopeKeys(source)) {
    displays[key] = {
      displayKey: MESSAGE_QUEUE_CHIP_KEY,
      displayValue: value,
    };
  }
  return displays;
}
