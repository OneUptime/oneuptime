import NetworkEventAttribute, {
  MAX_NETWORK_EVENT_SUBJECT_LENGTH,
  NETWORK_EVENT_DOMAIN,
} from "../../Types/NetworkEvent/NetworkEventAttribute";
import {
  NetworkEventDefinition,
  NetworkEventTypeUtil,
} from "../../Types/NetworkEvent/NetworkEventType";

/*
 * A NETWORK EVENT, AS A LOG.
 *
 * An event is a log with two attributes: `event.name` says what happened
 * and `event.domain` = "network" says it is a network event (and not one
 * an application sent under the same key).
 *
 * Three more say what a search, a monitor or a list most often asks of it:
 *
 *   - `event.kind`: problem, recovery or info;
 *   - `event.category`: interface, vpn, ha, hardware, ...;
 *   - `event.device`: which device, in words - its name in OneUptime, else
 *     the name it gives itself, else its address. Always there, so a
 *     monitor can raise one alert per device whether or not the device has
 *     been added yet.
 *
 * The built-in parsers write the name, the kind and the category. A
 * project names its own events in a log pipeline - a Category Processor
 * whose Target Attribute is `event.name` - and only writes the name;
 * markNetworkEvent adds the rest, so an event a project defines shows up,
 * searches and alerts like a built-in one. A pipeline that gives a line of
 * a vendor no parser knows a built-in name ("interface.down") gets the
 * built-in event whole.
 */

type Attributes = Record<string, unknown>;

function has(attributes: Attributes, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(attributes, key);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

// The event a log is, or null: its name, when the log is a network event.
export function getNetworkEventName(
  attributes: Attributes | null | undefined,
): string | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  if (!has(attributes, NetworkEventAttribute.Name)) {
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
 * What a built-in event is beside its name: its kind and its category. An
 * empty object for any other name - nothing here knows what a project's
 * own event means.
 */
export function getNetworkEventClassAttributes(
  name: unknown,
): Record<string, string> {
  const definition: NetworkEventDefinition | null =
    NetworkEventTypeUtil.get(name);

  if (!definition) {
    return {};
  }

  return {
    [NetworkEventAttribute.Kind]: definition.kind,
    [NetworkEventAttribute.Category]: definition.category,
  };
}

/*
 * Completes the log of a network device as a network event, when it
 * carries an event's name. Returns whether it changed anything.
 *
 *   - `event.domain` is set. Only a name of an event's shape counts
 *     ("ups.on_battery"): a pipeline that files a category such as
 *     "Payment Error" under the same key is left alone. A domain already
 *     there - another product's - is never replaced, and such a log is not
 *     touched at all.
 *   - `event.kind` and `event.category` are set to what a built-in name
 *     says they are. A project's own name keeps whatever it has.
 *   - `event.device` is set to the device given, when the log has none.
 *
 * Calling it again changes nothing: ingest calls it before a project's
 * drop filters and pipelines, so they can use these attributes, and after
 * them, for the events the pipelines named.
 */
export function markNetworkEvent(
  attributes: Attributes | null | undefined,
  options?: { device?: string | null | undefined },
): boolean {
  if (!attributes || typeof attributes !== "object") {
    return false;
  }

  if (!has(attributes, NetworkEventAttribute.Name)) {
    return false;
  }

  const name: unknown = attributes[NetworkEventAttribute.Name];

  if (!NetworkEventTypeUtil.isValidName(name)) {
    return false;
  }

  const domain: unknown = has(attributes, NetworkEventAttribute.Domain)
    ? attributes[NetworkEventAttribute.Domain]
    : undefined;

  if (!isEmpty(domain) && domain !== NETWORK_EVENT_DOMAIN) {
    return false;
  }

  let hasChanged: boolean = false;

  if (domain !== NETWORK_EVENT_DOMAIN) {
    attributes[NetworkEventAttribute.Domain] = NETWORK_EVENT_DOMAIN;
    hasChanged = true;
  }

  const classAttributes: Record<string, string> =
    getNetworkEventClassAttributes(name);

  for (const key of Object.keys(classAttributes)) {
    if (!has(attributes, key) || attributes[key] !== classAttributes[key]) {
      attributes[key] = classAttributes[key];
      hasChanged = true;
    }
  }

  const device: string =
    typeof options?.device === "string"
      ? options.device.trim().slice(0, MAX_NETWORK_EVENT_SUBJECT_LENGTH)
      : "";

  if (
    device &&
    (!has(attributes, NetworkEventAttribute.Device) ||
      isEmpty(attributes[NetworkEventAttribute.Device]))
  ) {
    attributes[NetworkEventAttribute.Device] = device;
    hasChanged = true;
  }

  return hasChanged;
}
