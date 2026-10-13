import NetworkEventAttribute, {
  NETWORK_EVENT_DOMAIN,
} from "../../Types/NetworkEvent/NetworkEventAttribute";
import { NetworkEventTypeUtil } from "../../Types/NetworkEvent/NetworkEventType";

/*
 * A NETWORK EVENT, AS A LOG.
 *
 * An event is a log with two attributes: `event.name` says what happened
 * and `event.domain` = "network" says it is a network event (and not one
 * an application sent under the same key).
 *
 * The built-in parsers write both. A project names its own events in a log
 * pipeline - a Category Processor whose Target Attribute is `event.name` -
 * and only writes the name; markNetworkEvent adds the domain to it, so an
 * event a project defines shows up, searches and alerts like a built-in
 * one.
 */

type Attributes = Record<string, unknown>;

// The event a log is, or null: its name, when the log is a network event.
export function getNetworkEventName(
  attributes: Attributes | null | undefined,
): string | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      attributes,
      NetworkEventAttribute.Name,
    )
  ) {
    return null;
  }

  const name: unknown = attributes[NetworkEventAttribute.Name];

  if (
    typeof name !== "string" ||
    attributes[NetworkEventAttribute.Domain] !== NETWORK_EVENT_DOMAIN
  ) {
    return null;
  }

  return name;
}

/*
 * Marks the log of a network device as a network event when it carries an
 * event's name: sets `event.domain`. Returns whether it changed anything.
 *
 * Only a name of an event's shape counts ("ups.on_battery"): a pipeline
 * that files a category such as "Payment Error" under the same key is left
 * alone. A domain already there - another product's - is never replaced.
 */
export function markNetworkEvent(
  attributes: Attributes | null | undefined,
): boolean {
  if (!attributes || typeof attributes !== "object") {
    return false;
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      attributes,
      NetworkEventAttribute.Name,
    )
  ) {
    return false;
  }

  if (
    !NetworkEventTypeUtil.isValidName(attributes[NetworkEventAttribute.Name])
  ) {
    return false;
  }

  const domain: unknown = attributes[NetworkEventAttribute.Domain];

  if (domain !== undefined && domain !== null && domain !== "") {
    return false;
  }

  attributes[NetworkEventAttribute.Domain] = NETWORK_EVENT_DOMAIN;

  return true;
}
