/*
 * What a network device is called when nobody gave it a name.
 *
 * The Add Device form asks for the address first and makes the name
 * optional: what someone adding one device knows is where it is, and its
 * address is a perfectly good name until they think of a better one (they
 * can rename it on its Settings page at any time). Discovery names what it
 * imports the same way when a host reports no name of its own.
 *
 * One rule, used on both sides of the wire, so a device added from the
 * dashboard and one created through the API without a name end up with the
 * same name: the name as typed, trimmed, or else the hostname, trimmed.
 */

/**
 * The name a new device is saved under: `name` trimmed, or `hostname`
 * trimmed when `name` is empty or only spaces. Empty only when both are.
 */
export function getDeviceNameForCreate(
  name: string | undefined | null,
  hostname: string | undefined | null,
): string {
  const typed: string = toTrimmedText(name);

  if (typed) {
    return typed;
  }

  return toTrimmedText(hostname);
}

// A value as trimmed text; nothing (undefined, null) is the empty string.
function toTrimmedText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

/**
 * Fills in a create payload's name from its hostname when no name was
 * given, in place. A name that was given is only trimmed; a payload with
 * neither is left alone, so the required-field check still says which one
 * is missing.
 */
export function fillDeviceNameOnCreate(data: {
  name?: string | undefined;
  hostname?: string | undefined;
}): void {
  const name: string = getDeviceNameForCreate(data.name, data.hostname);

  if (name) {
    data.name = name;
  }
}
