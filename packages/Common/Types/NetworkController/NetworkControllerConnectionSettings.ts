import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import {
  DEFAULT_MERAKI_REGION,
  MerakiRegion,
  isMerakiRegion,
} from "./MerakiRegion";

/*
 * What a network controller connection keeps besides its secret
 * (NetworkControllerConnection.config), and the rules every writer of it
 * is held to: the connection's service when it saves, "Test connection"
 * before a save, and the read loop when it loads one.
 *
 * Plain logic, free of React and of the server, so the dashboard's form,
 * the server and App/Tests all read the same rules.
 */

// Keys of `config`.
export const CONFIG_REGION_KEY: string = "region";
export const CONFIG_ORGANIZATION_ID_KEY: string = "organizationId";
export const CONFIG_ORGANIZATION_NAME_KEY: string = "organizationName";
export const CONFIG_READ_INTERVAL_KEY: string = "readIntervalInMinutes";

// Keys of `secrets`.
export const SECRET_API_KEY: string = "apiKey";

/*
 * How often uplink usage is read, in minutes. Five by default: each read
 * of an organization's uplinks is ONE API call however many networks it
 * has, and the chart is as fine as the reads are frequent. Applications,
 * destinations and clients are read every two hours whatever this says:
 * Meraki aggregates its traffic analytics over at least that long.
 */
export const NETWORK_CONTROLLER_READ_INTERVALS_IN_MINUTES: ReadonlyArray<number> =
  [5, 10, 15, 30, 60];

export const DEFAULT_NETWORK_CONTROLLER_READ_INTERVAL_IN_MINUTES: number = 5;

// Lengths kept: a Meraki organization's ID and name, as the dashboard shows them.
export const MAX_ORGANIZATION_ID_LENGTH: number = 64;
export const MAX_ORGANIZATION_NAME_LENGTH: number = 100;

/*
 * A Meraki dashboard API key is 40 hexadecimal characters today. The check
 * is looser on purpose - any 20 to 256 visible characters - so a key of a
 * future shape is never refused by OneUptime before Meraki has seen it.
 */
export const MIN_API_KEY_LENGTH: number = 20;
export const MAX_API_KEY_LENGTH: number = 256;

export interface NetworkControllerConfig {
  region: MerakiRegion;
  organizationId: string;
  organizationName: string;
  readIntervalInMinutes: number;
}

// The read interval a value names, or the default for anything else.
export function readNetworkControllerReadInterval(value: unknown): number {
  const minutes: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  return NETWORK_CONTROLLER_READ_INTERVALS_IN_MINUTES.includes(minutes)
    ? minutes
    : DEFAULT_NETWORK_CONTROLLER_READ_INTERVAL_IN_MINUTES;
}

/*
 * A visible character of an ID or a key: printable ASCII without the space.
 * A loop, not a pattern: the input is untrusted text of any length.
 */
function isVisibleAscii(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 0x21 || code > 0x7e) {
      return false;
    }
  }

  return true;
}

// Letters, digits, "_" and "-": every Meraki organization ID is these.
function isIdentifierText(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const isDigit: boolean = code >= 0x30 && code <= 0x39;
    const isUpper: boolean = code >= 0x41 && code <= 0x5a;
    const isLower: boolean = code >= 0x61 && code <= 0x7a;

    if (!isDigit && !isUpper && !isLower && code !== 0x5f && code !== 0x2d) {
      return false;
    }
  }

  return true;
}

/*
 * The organization ID a value names: trimmed, or "" for none. Throws for a
 * value no Meraki organization has (it reaches a URL path).
 */
export function readMerakiOrganizationId(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value !== "string" && typeof value !== "number") {
    throw new BadDataException("The Meraki organization ID must be text.");
  }

  const id: string = String(value).trim();

  if (!id || id.length > MAX_ORGANIZATION_ID_LENGTH || !isIdentifierText(id)) {
    throw new BadDataException(
      "The Meraki organization ID is not one Meraki gives: it is letters and digits, like 123456.",
    );
  }

  return id;
}

/*
 * An organization name to show: trimmed, every control character a space,
 * cut to its length. "" for anything that is not text.
 */
export function cleanOrganizationName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  let cleaned: string = "";

  for (const character of value.substring(
    0,
    MAX_ORGANIZATION_NAME_LENGTH * 4,
  )) {
    const code: number = character.charCodeAt(0);
    cleaned += code < 0x20 || code === 0x7f ? " " : character;
  }

  return cleaned.trim().substring(0, MAX_ORGANIZATION_NAME_LENGTH).trim();
}

/*
 * The API key a value is, trimmed. Throws, with what to do, for a value
 * that cannot be one.
 */
export function readMerakiApiKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadDataException(
      "Enter the Meraki dashboard API key. Make one in the Meraki dashboard under Organization > API & Webhooks.",
    );
  }

  const key: string = value.trim();

  if (
    key.length < MIN_API_KEY_LENGTH ||
    key.length > MAX_API_KEY_LENGTH ||
    !isVisibleAscii(key)
  ) {
    throw new BadDataException(
      "This is not a Meraki dashboard API key: a key is 40 letters and digits, with no spaces. Copy it again from the Meraki dashboard.",
    );
  }

  return key;
}

/*
 * A connection's settings as they are stored, read without trusting them:
 * an unknown region is the global dashboard's, an interval that is not one
 * of the choices is the default, an ID that is not one is "".
 */
export function readNetworkControllerConfig(
  value: unknown,
): NetworkControllerConfig {
  const config: JSONObject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : {};

  let organizationId: string = "";

  try {
    organizationId = readMerakiOrganizationId(
      config[CONFIG_ORGANIZATION_ID_KEY],
    );
  } catch {
    organizationId = "";
  }

  const region: unknown = config[CONFIG_REGION_KEY];

  return {
    region: isMerakiRegion(region) ? region : DEFAULT_MERAKI_REGION,
    organizationId: organizationId,
    organizationName: cleanOrganizationName(
      config[CONFIG_ORGANIZATION_NAME_KEY],
    ),
    readIntervalInMinutes: readNetworkControllerReadInterval(
      config[CONFIG_READ_INTERVAL_KEY],
    ),
  };
}

/*
 * Settings a person (or an API client) sent, checked: a region that is not
 * one of Meraki's, an interval that is not one of the choices and an ID
 * that cannot be one are refused - never quietly replaced - so what is
 * saved is what was asked for. Returns them as they are stored.
 */
export function validateNetworkControllerConfig(
  value: unknown,
  options: { requireOrganization: boolean },
): NetworkControllerConfig {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== "object" || Array.isArray(value))
  ) {
    throw new BadDataException("Settings must be an object.");
  }

  const config: JSONObject = (value as JSONObject) || {};

  for (const key of Object.keys(config)) {
    if (
      ![
        CONFIG_REGION_KEY,
        CONFIG_ORGANIZATION_ID_KEY,
        CONFIG_ORGANIZATION_NAME_KEY,
        CONFIG_READ_INTERVAL_KEY,
      ].includes(key)
    ) {
      throw new BadDataException(
        `Settings has no "${key.substring(0, 50)}": a Meraki connection takes region, organizationId, organizationName and readIntervalInMinutes.`,
      );
    }
  }

  const region: unknown = config[CONFIG_REGION_KEY];

  if (region !== undefined && region !== null && region !== "") {
    if (!isMerakiRegion(region)) {
      throw new BadDataException(
        "Region must be one of Meraki's dashboards: global, canada, china, india or us-fedramp.",
      );
    }
  }

  const interval: unknown = config[CONFIG_READ_INTERVAL_KEY];

  if (interval !== undefined && interval !== null && interval !== "") {
    const minutes: number = Number(interval);

    if (!NETWORK_CONTROLLER_READ_INTERVALS_IN_MINUTES.includes(minutes)) {
      throw new BadDataException(
        `Read every must be one of ${NETWORK_CONTROLLER_READ_INTERVALS_IN_MINUTES.join(", ")} minutes.`,
      );
    }
  }

  const organizationId: string = readMerakiOrganizationId(
    config[CONFIG_ORGANIZATION_ID_KEY],
  );

  if (options.requireOrganization && !organizationId) {
    throw new BadDataException(
      "Pick the Meraki organization to read. Test the API key to see the organizations it can read.",
    );
  }

  return {
    region: isMerakiRegion(region) ? region : DEFAULT_MERAKI_REGION,
    organizationId: organizationId,
    organizationName: cleanOrganizationName(
      config[CONFIG_ORGANIZATION_NAME_KEY],
    ),
    readIntervalInMinutes: readNetworkControllerReadInterval(interval),
  };
}

// The JSON a config is stored as.
export function toNetworkControllerConfigJson(
  config: NetworkControllerConfig,
): JSONObject {
  return {
    [CONFIG_REGION_KEY]: config.region,
    [CONFIG_ORGANIZATION_ID_KEY]: config.organizationId,
    [CONFIG_ORGANIZATION_NAME_KEY]: config.organizationName,
    [CONFIG_READ_INTERVAL_KEY]: config.readIntervalInMinutes,
  };
}
