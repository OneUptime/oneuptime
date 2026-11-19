import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";

/*
 * What a device management connection keeps besides its secret
 * (DeviceManagementConnection.config), and the rules every writer of it is
 * held to: the connection's service when it saves, "Test connection" before
 * a save, and the read loop when it loads one.
 *
 * Plain logic, free of React and of the server, so the dashboard's form,
 * the server and the tests all read the same rules.
 */

// Keys of `config`.
export const CONFIG_TENANT_KEY: string = "tenant";
export const CONFIG_READ_INTERVAL_KEY: string = "readIntervalInMinutes";

// Keys of `secrets`.
export const SECRET_API_KEY: string = "apiKey";

/*
 * How often the device list, the groups and the check-ins are read, in
 * minutes. Fifteen by default: a read of the device list is one request per
 * thousand devices, and Esper itself counts a device online when it checked
 * in within the last 30 minutes, so a device that goes quiet shows as
 * offline within about one interval of that. Installed apps are read on a
 * slower clock of their own (one request per device): see
 * MANAGED_DEVICE_APPS_READ_INTERVAL_IN_HOURS.
 */
export const DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES: ReadonlyArray<number> =
  [5, 10, 15, 30, 60];

export const DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES: number = 15;

// A device's installed apps are read again this long after the last time.
export const MANAGED_DEVICE_APPS_READ_INTERVAL_IN_HOURS: number = 6;

/*
 * An Esper tenant is the sub-domain of its console and of its API: "acme"
 * for acme.esper.cloud, whose API is https://acme-api.esper.cloud/api. A DNS
 * label: letters, digits and hyphens, 63 at most.
 */
export const MAX_ESPER_TENANT_LENGTH: number = 63;

// The domain every Esper console and API host is under.
export const ESPER_CLOUD_DOMAIN: string = "esper.cloud";

/*
 * Esper's API keys are random text of a few dozen characters. The check is
 * loose on purpose - any 10 to 512 visible characters - so a key of a
 * future shape is never refused by OneUptime before Esper has seen it.
 */
export const MIN_API_KEY_LENGTH: number = 10;
export const MAX_API_KEY_LENGTH: number = 512;

export interface DeviceManagementConfig {
  tenant: string;
  readIntervalInMinutes: number;
}

// The read interval a value names, or the default for anything else.
export function readDeviceManagementReadInterval(value: unknown): number {
  const minutes: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  return DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES.includes(minutes)
    ? minutes
    : DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES;
}

/*
 * A visible character of a key: printable ASCII without the space. A loop,
 * not a pattern: the input is untrusted text of any length.
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

// A DNS label: letters, digits and inner hyphens.
function isDnsLabel(text: string): boolean {
  if (!text || text.length > MAX_ESPER_TENANT_LENGTH) {
    return false;
  }

  if (text.startsWith("-") || text.endsWith("-")) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const isDigit: boolean = code >= 0x30 && code <= 0x39;
    const isLower: boolean = code >= 0x61 && code <= 0x7a;

    if (!isDigit && !isLower && code !== 0x2d) {
      return false;
    }
  }

  return true;
}

const TENANT_HELP: string =
  "Enter your Esper tenant: the name before .esper.cloud in your Esper console's address, like acme for acme.esper.cloud.";

/*
 * The tenant a value names, lowercased, or "" for none. People copy what
 * they see, so the console's address ("https://acme.esper.cloud/devices"),
 * the API's ("acme-api.esper.cloud/api") and the bare name ("acme") all
 * name the tenant "acme". Throws, with what to do, for anything else: the
 * tenant becomes the API's host name, so nothing that is not one label
 * under esper.cloud is ever accepted.
 */
export function readEsperTenant(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    throw new BadDataException(TENANT_HELP);
  }

  let text: string = value.trim().toLowerCase();

  if (!text) {
    return "";
  }

  // An address: its host only.
  const schemeEnd: number = text.indexOf("://");

  if (schemeEnd >= 0) {
    text = text.substring(schemeEnd + 3);
  }

  for (const separator of ["/", "?", "#"]) {
    const at: number = text.indexOf(separator);

    if (at >= 0) {
      text = text.substring(0, at);
    }
  }

  // A port or credentials are never part of a tenant's address.
  if (text.includes("@") || text.includes(":")) {
    throw new BadDataException(TENANT_HELP);
  }

  if (text.endsWith(".")) {
    text = text.substring(0, text.length - 1);
  }

  let tenant: string = text;

  if (text.includes(".")) {
    const suffix: string = `.${ESPER_CLOUD_DOMAIN}`;

    if (!text.endsWith(suffix)) {
      throw new BadDataException(TENANT_HELP);
    }

    tenant = text.substring(0, text.length - suffix.length);

    // The API's host names the tenant too: acme-api.esper.cloud.
    if (tenant.endsWith("-api")) {
      tenant = tenant.substring(0, tenant.length - "-api".length);
    }
  }

  if (!isDnsLabel(tenant)) {
    throw new BadDataException(TENANT_HELP);
  }

  return tenant;
}

/*
 * The API key a value is, trimmed. Throws, with what to do, for a value
 * that cannot be one.
 */
export function readEsperApiKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadDataException(
      "Enter the Esper API key. Make one in the Esper console under API Key Management.",
    );
  }

  let key: string = value.trim();

  // A key copied with the header's word in front of it.
  if (key.toLowerCase().startsWith("bearer ")) {
    key = key.substring("bearer ".length).trim();
  }

  if (
    key.length < MIN_API_KEY_LENGTH ||
    key.length > MAX_API_KEY_LENGTH ||
    !isVisibleAscii(key)
  ) {
    throw new BadDataException(
      "This is not an Esper API key: a key is letters and digits, with no spaces. Copy it again from the Esper console.",
    );
  }

  return key;
}

// The API's base address for a tenant: https://acme-api.esper.cloud/api.
export function getEsperApiBaseUrl(tenant: string): string {
  return `https://${tenant}-api.${ESPER_CLOUD_DOMAIN}/api`;
}

// The API's host for a tenant: acme-api.esper.cloud.
export function getEsperApiHost(tenant: string): string {
  return `${tenant}-api.${ESPER_CLOUD_DOMAIN}`;
}

// The console's host for a tenant: acme.esper.cloud.
export function getEsperConsoleHost(tenant: string): string {
  return `${tenant}.${ESPER_CLOUD_DOMAIN}`;
}

// The console's address for a tenant: https://acme.esper.cloud.
export function getEsperConsoleUrl(tenant: string): string {
  return `https://${getEsperConsoleHost(tenant)}`;
}

/*
 * A connection's settings as they are stored, read without trusting them:
 * an interval that is not one of the choices is the default, a tenant that
 * is not one is "".
 */
export function readDeviceManagementConfig(
  value: unknown,
): DeviceManagementConfig {
  const config: JSONObject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : {};

  let tenant: string = "";

  try {
    tenant = readEsperTenant(config[CONFIG_TENANT_KEY]);
  } catch {
    tenant = "";
  }

  return {
    tenant: tenant,
    readIntervalInMinutes: readDeviceManagementReadInterval(
      config[CONFIG_READ_INTERVAL_KEY],
    ),
  };
}

/*
 * Settings a person (or an API client) sent, checked: an interval that is
 * not one of the choices and a tenant that cannot be one are refused - never
 * quietly replaced - so what is saved is what was asked for. Returns them as
 * they are stored.
 */
export function validateDeviceManagementConfig(
  value: unknown,
  options: { requireTenant: boolean },
): DeviceManagementConfig {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== "object" || Array.isArray(value))
  ) {
    throw new BadDataException("Settings must be an object.");
  }

  const config: JSONObject = (value as JSONObject) || {};

  for (const key of Object.keys(config)) {
    if (![CONFIG_TENANT_KEY, CONFIG_READ_INTERVAL_KEY].includes(key)) {
      throw new BadDataException(
        `Settings has no "${key.substring(0, 50)}": an Esper connection takes tenant and readIntervalInMinutes.`,
      );
    }
  }

  const interval: unknown = config[CONFIG_READ_INTERVAL_KEY];

  if (interval !== undefined && interval !== null && interval !== "") {
    const minutes: number = Number(interval);

    if (!DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES.includes(minutes)) {
      throw new BadDataException(
        `Read every takes a number of minutes: one of ${DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES.join(", ")}.`,
      );
    }
  }

  const tenant: string = readEsperTenant(config[CONFIG_TENANT_KEY]);

  if (options.requireTenant && !tenant) {
    throw new BadDataException(TENANT_HELP);
  }

  return {
    tenant: tenant,
    readIntervalInMinutes: readDeviceManagementReadInterval(interval),
  };
}

// The JSON a config is stored as.
export function toDeviceManagementConfigJson(
  config: DeviceManagementConfig,
): JSONObject {
  return {
    [CONFIG_TENANT_KEY]: config.tenant,
    [CONFIG_READ_INTERVAL_KEY]: config.readIntervalInMinutes,
  };
}
