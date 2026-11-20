import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import DeviceManagementProvider, {
  isDeviceManagementProvider,
} from "./DeviceManagementProvider";

/*
 * What a device management connection keeps besides its secret
 * (DeviceManagementConnection.config), and the rules every writer of it is
 * held to: the connection's service when it saves, "Test connection" before
 * a save, and the read loop when it loads one.
 *
 * Plain logic, free of React and of the server, so the dashboard's form,
 * the server and the tests all read the same rules.
 *
 * Each service keeps its own settings (#9837):
 *   - Esper: its tenant, the sub-domain of its console;
 *   - Microsoft Intune: its Microsoft Entra tenant (the directory ID, or a
 *     domain of it), the application (client) ID of the app registration
 *     OneUptime signs in as, and the Microsoft cloud the tenant is in;
 *   - Workspace ONE UEM (#10086): its API server's host, how OneUptime
 *     signs in - an OAuth client (its ID, and the token service's region)
 *     or an administrator's account (its username) - and their secrets;
 *   - SOTI MobiControl (#10087): its server's host, the ID of the API
 *     client OneUptime signs in through, and the API user it signs in as.
 * `tenant` is the one the connection reads, whatever the service: a
 * project connects it once. For a service answering at the customer's own
 * server (Workspace ONE, SOTI), it is that server's host.
 */

// Keys of `config`.
export const CONFIG_TENANT_KEY: string = "tenant";
export const CONFIG_READ_INTERVAL_KEY: string = "readIntervalInMinutes";
export const CONFIG_CLIENT_ID_KEY: string = "clientId";
export const CONFIG_CLOUD_KEY: string = "cloud";
export const CONFIG_AUTH_METHOD_KEY: string = "authMethod";
export const CONFIG_REGION_KEY: string = "region";
export const CONFIG_USERNAME_KEY: string = "username";

// Keys of `secrets`.
export const SECRET_API_KEY: string = "apiKey";
export const SECRET_CLIENT_SECRET_KEY: string = "clientSecret";
export const SECRET_PASSWORD_KEY: string = "password";

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
  /*
   * Intune: the app registration's application (client) ID. Workspace ONE:
   * the OAuth client's ID. SOTI: the API client's ID.
   */
  clientId?: string | undefined;
  // Intune: the Microsoft cloud the tenant is in (IntuneCloud).
  cloud?: string | undefined;
  // Workspace ONE: how OneUptime signs in (WorkspaceOneAuthMethod).
  authMethod?: string | undefined;
  // Workspace ONE: the region of the token service an OAuth client signs in at.
  region?: string | undefined;
  /*
   * Workspace ONE: the administrator an account sign-in signs in as. SOTI:
   * the API user OneUptime signs in as.
   */
  username?: string | undefined;
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
 * MICROSOFT INTUNE (#9837)
 *
 * OneUptime reads Intune through Microsoft Graph, signed in as an app
 * registration of the tenant's own (the client credentials grant), with
 * one application permission: DeviceManagementManagedDevices.Read.All.
 * The tenant is its Microsoft Entra directory ID (a GUID) or one of its
 * domains (contoso.onmicrosoft.com), which Microsoft's sign-in takes alike.
 */

/*
 * The Microsoft clouds an Intune tenant can be in, as Microsoft Graph's
 * national cloud deployments list them, with what each signs in at and
 * where its Graph answers - the same four OneUptime's Microsoft Entra ID
 * connection reads:
 *
 *   public  the commercial cloud, worldwide;
 *   gcc     Intune for US Government GCC, in the commercial cloud;
 *   usgov   Intune for US Government GCC High;
 *   dod     Intune for the US Department of Defense.
 *
 * Intune operated by 21Vianet in China is not among them.
 */
export type IntuneCloud = "public" | "gcc" | "usgov" | "dod";

export const INTUNE_CLOUDS: ReadonlyArray<IntuneCloud> = [
  "public",
  "gcc",
  "usgov",
  "dod",
];

export const DEFAULT_INTUNE_CLOUD: IntuneCloud = "public";

export interface IntuneCloudHosts {
  // Where a token is asked for: https://login.microsoftonline.com.
  loginHost: string;
  // Where Graph answers: https://graph.microsoft.com.
  graphHost: string;
}

const INTUNE_CLOUD_HOSTS: Record<IntuneCloud, IntuneCloudHosts> = {
  public: {
    loginHost: "https://login.microsoftonline.com",
    graphHost: "https://graph.microsoft.com",
  },
  gcc: {
    loginHost: "https://login.microsoftonline.com",
    graphHost: "https://graph.microsoft.com",
  },
  usgov: {
    loginHost: "https://login.microsoftonline.us",
    graphHost: "https://graph.microsoft.us",
  },
  dod: {
    loginHost: "https://login.microsoftonline.us",
    graphHost: "https://dod-graph.microsoft.us",
  },
};

// What each cloud is called, under the form's Cloud label: product names.
export const INTUNE_CLOUD_TITLES: Record<IntuneCloud, string> = {
  public: "Microsoft Azure (worldwide)",
  gcc: "Microsoft 365 GCC",
  usgov: "Microsoft 365 GCC High",
  dod: "Microsoft 365 DoD",
};

export function isIntuneCloud(value: unknown): value is IntuneCloud {
  return (
    typeof value === "string" &&
    (INTUNE_CLOUDS as ReadonlyArray<string>).includes(value)
  );
}

export function getIntuneCloudHosts(
  cloud: string | undefined,
): IntuneCloudHosts {
  return INTUNE_CLOUD_HOSTS[
    isIntuneCloud(cloud) ? cloud : DEFAULT_INTUNE_CLOUD
  ];
}

// The longest DNS name, and a GUID's shape (8-4-4-4-12 hex digits).
const MAX_DOMAIN_LENGTH: number = 253;
const GUID_GROUP_LENGTHS: ReadonlyArray<number> = [8, 4, 4, 4, 12];

// A GUID, as Microsoft writes a directory or an application ID. A loop, not a pattern.
export function isGuid(text: string): boolean {
  const groups: Array<string> = text.split("-");

  if (groups.length !== GUID_GROUP_LENGTHS.length) {
    return false;
  }

  return groups.every((group: string, index: number): boolean => {
    if (group.length !== GUID_GROUP_LENGTHS[index]) {
      return false;
    }

    for (let at: number = 0; at < group.length; at++) {
      const code: number = group.charCodeAt(at);
      const isDigit: boolean = code >= 0x30 && code <= 0x39;
      const isHexLetter: boolean = code >= 0x61 && code <= 0x66;

      if (!isDigit && !isHexLetter) {
        return false;
      }
    }

    return true;
  });
}

// A domain of two labels or more: contoso.onmicrosoft.com.
function isDomainName(text: string): boolean {
  if (!text || text.length > MAX_DOMAIN_LENGTH) {
    return false;
  }

  const labels: Array<string> = text.split(".");

  return labels.length >= 2 && labels.every(isDnsLabel);
}

const INTUNE_TENANT_HELP: string =
  "Enter your tenant ID: the Directory (tenant) ID on the app registration's Overview in the Microsoft Entra admin center, or a domain of the tenant like contoso.onmicrosoft.com.";

/*
 * The Intune tenant a value names, lowercased: a directory ID or a domain.
 * "" for none. Throws, with what to do, for anything else - "common" and
 * "organizations" included, which name no one tenant: the tenant is a
 * segment of the sign-in address, so nothing else is ever accepted.
 */
export function readIntuneTenant(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    throw new BadDataException(INTUNE_TENANT_HELP);
  }

  let text: string = value.trim().toLowerCase();

  if (!text) {
    return "";
  }

  // A GUID copied in braces, as some tools write it.
  if (text.startsWith("{") && text.endsWith("}")) {
    text = text.substring(1, text.length - 1);
  }

  if (text.endsWith(".")) {
    text = text.substring(0, text.length - 1);
  }

  if (isGuid(text) || isDomainName(text)) {
    return text;
  }

  throw new BadDataException(INTUNE_TENANT_HELP);
}

const INTUNE_CLIENT_ID_HELP: string =
  "Enter the Application (client) ID: a GUID on the app registration's Overview in the Microsoft Entra admin center.";

// The application (client) ID a value is, lowercased. Throws for anything else.
export function readIntuneClientId(value: unknown): string {
  const text: string =
    typeof value === "string" ? value.trim().toLowerCase() : "";

  if (!isGuid(text)) {
    throw new BadDataException(INTUNE_CLIENT_ID_HELP);
  }

  return text;
}

// The cloud a value names; none is the commercial cloud. Throws for anything else.
export function readIntuneCloud(value: unknown): IntuneCloud {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_INTUNE_CLOUD;
  }

  if (!isIntuneCloud(value)) {
    throw new BadDataException(
      `Cloud must be one of ${INTUNE_CLOUDS.join(", ")}.`,
    );
  }

  return value;
}

/*
 * A client secret's value, trimmed. Microsoft's are 40 visible characters
 * today; the check is loose on purpose, like an Esper key's. A GUID is the
 * secret's ID, which the same page shows beside its value, and is said so.
 */
export function readIntuneClientSecret(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadDataException(
      "Enter the client secret's value. Make one under Certificates & secrets on the app registration.",
    );
  }

  const secret: string = value.trim();

  if (isGuid(secret.toLowerCase())) {
    throw new BadDataException(
      "This is the client secret's ID. Copy its Value instead: Microsoft shows it once, when the secret is made.",
    );
  }

  if (
    secret.length < MIN_API_KEY_LENGTH ||
    secret.length > MAX_API_KEY_LENGTH ||
    !isVisibleAscii(secret)
  ) {
    throw new BadDataException(
      "This is not a client secret: a secret's value is letters, digits and symbols, with no spaces. Copy it again from Certificates & secrets.",
    );
  }

  return secret;
}

// The address of a tenant's Microsoft Entra token endpoint.
export function getIntuneTokenUrl(data: {
  cloud: string | undefined;
  tenant: string;
}): string {
  return `${getIntuneCloudHosts(data.cloud).loginHost}/${encodeURIComponent(data.tenant)}/oauth2/v2.0/token`;
}

/*
 * A SERVER THE CUSTOMER NAMES (#10086, #10087).
 *
 * Workspace ONE UEM and SOTI MobiControl answer at the tenant's own
 * server: a host in the vendor's cloud (as1234.awmdm.com,
 * acme.mobicontrolcloud.com) or one on premises. That host is what the
 * customer types that becomes where OneUptime connects, with the
 * credentials, so it is read strictly:
 *
 *   - over HTTPS only: an address that names another scheme is refused,
 *     never quietly upgraded;
 *   - a host name (letters, digits and hyphens, in labels between dots) or
 *     an IPv4 address, with a port when it is not 443;
 *   - nothing else of an address: a user or a password in it is refused,
 *     and its path, query and fragment are dropped, since the API's path is
 *     the service's own (/API on Workspace ONE, /MobiControl/api on SOTI).
 *
 * Whether OneUptime may connect to it at all is the egress guard's to say,
 * on every request (DataSourceHttpFetch): never to a loopback, link-local
 * or cloud metadata address, and to a private one only on a self-hosted
 * OneUptime.
 */

// The longest host name DNS has.
export const MAX_SERVER_HOST_LENGTH: number = 253;

const HTTPS_SCHEME: string = "https://";
const DEFAULT_HTTPS_PORT: number = 443;

/*
 * An IPv4 address written as four decimal numbers: 10.1.2.3. A number with
 * a leading zero is not one: a URL reads "010" as octal, so 010.0.0.1
 * would connect to 8.0.0.1.
 */
function isIpv4Address(text: string): boolean {
  const parts: Array<string> = text.split(".");

  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part: string): boolean => {
    if (!part || part.length > 3 || (part.length > 1 && part[0] === "0")) {
      return false;
    }

    for (const character of part) {
      if (character < "0" || character > "9") {
        return false;
      }
    }

    return Number(part) <= 255;
  });
}

/*
 * Whether a label is a number as a URL reads one: decimal digits, or 0x
 * and hex digits.
 */
function isNumericLabel(label: string): boolean {
  const lower: string = label.toLowerCase();
  const isHex: boolean = lower.startsWith("0x");
  const digits: string = isHex ? lower.substring(2) : lower;

  if (!isHex && !digits) {
    return false;
  }

  for (const character of digits) {
    const isDecimal: boolean = character >= "0" && character <= "9";
    const isHexDigit: boolean = isHex && character >= "a" && character <= "f";

    if (!isDecimal && !isHexDigit) {
      return false;
    }
  }

  return true;
}

/*
 * A host name - one label or more - or an IPv4 address. A URL reads a host
 * whose last label is a number as an IPv4 address in any of its forms
 * (0x7f.1 is 127.0.0.1), so such a host is taken only as the plain four
 * numbers it connects to.
 */
function isServerHost(text: string): boolean {
  if (!text || text.length > MAX_SERVER_HOST_LENGTH) {
    return false;
  }

  const labels: Array<string> = text.split(".");

  if (isNumericLabel(labels[labels.length - 1] || "")) {
    return isIpv4Address(text);
  }

  return labels.every(isDnsLabel);
}

/*
 * The host (and port, when it is not 443) a server's address names,
 * lowercased: "as1234.awmdm.com", "mdm.acme.com:8443". "" for none.
 * Throws `help` - or, for an address of another scheme, that only HTTPS is
 * read - for anything else.
 */
export function readServerAddress(value: unknown, help: string): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    throw new BadDataException(help);
  }

  let text: string = value.trim();

  if (!text) {
    return "";
  }

  const schemeEnd: number = text.indexOf("://");

  if (schemeEnd >= 0) {
    if (text.substring(0, schemeEnd + 3).toLowerCase() !== HTTPS_SCHEME) {
      throw new BadDataException(
        "OneUptime connects to the server over HTTPS only. Enter its address starting with https://.",
      );
    }

    text = text.substring(schemeEnd + 3);
  }

  for (const separator of ["/", "?", "#", "\\"]) {
    const at: number = text.indexOf(separator);

    if (at >= 0) {
      text = text.substring(0, at);
    }
  }

  // Credentials are never part of a server's address.
  if (text.includes("@")) {
    throw new BadDataException(help);
  }

  let host: string = text.toLowerCase();
  let port: number | null = null;
  const colon: number = host.lastIndexOf(":");

  if (colon >= 0) {
    const portText: string = host.substring(colon + 1);

    host = host.substring(0, colon);

    let isNumber: boolean = portText.length > 0 && portText.length <= 5;

    for (const character of portText) {
      if (character < "0" || character > "9") {
        isNumber = false;
      }
    }

    const portNumber: number = Number(portText);

    if (!isNumber || portNumber < 1 || portNumber > 65535) {
      throw new BadDataException(help);
    }

    port = portNumber === DEFAULT_HTTPS_PORT ? null : portNumber;
  }

  if (host.endsWith(".")) {
    host = host.substring(0, host.length - 1);
  }

  if (!isServerHost(host)) {
    throw new BadDataException(help);
  }

  return port === null ? host : `${host}:${port}`;
}

// The HTTPS origin of a server a connection reads: https://as1234.awmdm.com.
export function getServerOrigin(tenant: string): string {
  return `${HTTPS_SCHEME}${tenant}`;
}

/*
 * A username, trimmed: an administrator's or an API user's, as the service
 * keeps it ("api-reader", "ACME\\oneuptime", "oneuptime@acme.com"). Any
 * visible text up to 256 characters. Throws `help` for anything else.
 */
export const MAX_USERNAME_LENGTH: number = 256;

export function readDeviceManagementUsername(
  value: unknown,
  help: string,
): string {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (!text || text.length > MAX_USERNAME_LENGTH) {
    throw new BadDataException(help);
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      throw new BadDataException(help);
    }
  }

  return text;
}

/*
 * A password, exactly as typed: a space at either end can be part of one.
 * Anything up to 512 characters without a control character. Throws `help`
 * for none, or for anything else.
 */
export function readDeviceManagementPassword(
  value: unknown,
  help: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadDataException(help);
  }

  if (value.length > MAX_API_KEY_LENGTH) {
    throw new BadDataException(help);
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      throw new BadDataException(help);
    }
  }

  return value;
}

/*
 * A credential the service generated (a client ID, a client secret, an
 * API key), trimmed: visible characters, no spaces, loose on purpose like
 * an Esper key, so a credential of a future shape is never refused before
 * the service has seen it. Throws `help` for anything else.
 */
function readGeneratedCredential(
  value: unknown,
  help: string,
  minLength: number = MIN_API_KEY_LENGTH,
): string {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (
    text.length < minLength ||
    text.length > MAX_API_KEY_LENGTH ||
    !isVisibleAscii(text)
  ) {
    throw new BadDataException(help);
  }

  return text;
}

/*
 * WORKSPACE ONE UEM (#10086)
 *
 * OneUptime reads Workspace ONE UEM through its REST API, at the tenant's
 * API server (Groups & Settings > All Settings > System > Advanced > API >
 * REST API shows it: https://as1234.awmdm.com for a SaaS tenant, the
 * tenant's own host on premises), in one of two ways:
 *
 *   oauth  an OAuth client (Groups & Settings > Configurations > OAuth
 *          Client Management), made at the organization group to read and
 *          given a read-only role, signs in at the Workspace ONE token
 *          service of the tenant's region (the client credentials grant).
 *          Omnissa's recommended way; the token service is Omnissa's
 *          cloud's, so this is for a SaaS tenant.
 *   basic  an administrator's account, with the tenant's REST API key (the
 *          aw-tenant-code), for a server without the token service: on
 *          premises.
 *
 * Either way the role is read-only: a custom admin role whose only
 * permissions are API > REST > Devices and Apps, Read.
 */
export type WorkspaceOneAuthMethod = "oauth" | "basic";

export const WORKSPACE_ONE_AUTH_METHODS: ReadonlyArray<WorkspaceOneAuthMethod> =
  ["oauth", "basic"];

export const DEFAULT_WORKSPACE_ONE_AUTH_METHOD: WorkspaceOneAuthMethod =
  "oauth";

/*
 * The regions of the Workspace ONE token service, as Omnissa's
 * "Datacenter and Token URLs for OAuth 2.0 Support" names them:
 *
 *   na    the United States and Canada;
 *   emea  the United Kingdom and Germany;
 *   apac  Australia, Hong Kong, India, Japan and Singapore;
 *   uat   every UAT (test) environment.
 *
 * Each signs in at https://<region>.uemauth.workspaceone.com/connect/token.
 * The older *.uemauth.vmwservices.com hosts are legacy, and not offered.
 */
export type WorkspaceOneRegion = "na" | "emea" | "apac" | "uat";

export const WORKSPACE_ONE_REGIONS: ReadonlyArray<WorkspaceOneRegion> = [
  "na",
  "emea",
  "apac",
  "uat",
];

export const DEFAULT_WORKSPACE_ONE_REGION: WorkspaceOneRegion = "na";

// The domain every Workspace ONE token service host is under.
export const WORKSPACE_ONE_TOKEN_DOMAIN: string = "uemauth.workspaceone.com";

// The domain of a SaaS tenant's console and API hosts.
export const WORKSPACE_ONE_SAAS_DOMAIN: string = "awmdm.com";

export function isWorkspaceOneAuthMethod(
  value: unknown,
): value is WorkspaceOneAuthMethod {
  return (
    typeof value === "string" &&
    (WORKSPACE_ONE_AUTH_METHODS as ReadonlyArray<string>).includes(value)
  );
}

export function isWorkspaceOneRegion(
  value: unknown,
): value is WorkspaceOneRegion {
  return (
    typeof value === "string" &&
    (WORKSPACE_ONE_REGIONS as ReadonlyArray<string>).includes(value)
  );
}

// The token service's host of a region: na.uemauth.workspaceone.com.
export function getWorkspaceOneTokenHost(region: string | undefined): string {
  return `${isWorkspaceOneRegion(region) ? region : DEFAULT_WORKSPACE_ONE_REGION}.${WORKSPACE_ONE_TOKEN_DOMAIN}`;
}

// Where an OAuth client signs in: https://na.uemauth.workspaceone.com/connect/token.
export function getWorkspaceOneTokenUrl(region: string | undefined): string {
  return `${HTTPS_SCHEME}${getWorkspaceOneTokenHost(region)}/connect/token`;
}

// The API's base address on a server: https://as1234.awmdm.com/api.
export function getWorkspaceOneApiBaseUrl(tenant: string): string {
  return `${getServerOrigin(tenant)}/api`;
}

export const WORKSPACE_ONE_SERVER_HELP: string =
  "Enter your Workspace ONE REST API URL, like https://as1234.awmdm.com. Find it under Groups & Settings > All Settings > System > Advanced > API > REST API.";

/*
 * A SaaS tenant's console is at cnNNNN.awmdm.com and its API at
 * asNNNN.awmdm.com: people copy the console's address from the browser, so
 * a console host is read as its API's.
 */
function toWorkspaceOneApiHost(host: string): string {
  const suffix: string = `.${WORKSPACE_ONE_SAAS_DOMAIN}`;

  if (!host.startsWith("cn") || !host.endsWith(suffix)) {
    return host;
  }

  const number: string = host.substring(2, host.length - suffix.length);

  if (!number) {
    return host;
  }

  for (const character of number) {
    if (character < "0" || character > "9") {
      return host;
    }
  }

  return `as${number}${suffix}`;
}

/*
 * The API server a value names: its host (and port), lowercased. The REST
 * API URL as the console shows it (https://as1234.awmdm.com/API), the
 * console's own address (cn1234.awmdm.com, read as as1234.awmdm.com) and a
 * bare host all name it. "" for none; throws, with what to do, for
 * anything else.
 */
export function readWorkspaceOneServer(value: unknown): string {
  const address: string = readServerAddress(value, WORKSPACE_ONE_SERVER_HELP);

  if (!address) {
    return "";
  }

  const colon: number = address.indexOf(":");

  return colon >= 0
    ? `${toWorkspaceOneApiHost(address.substring(0, colon))}${address.substring(colon)}`
    : toWorkspaceOneApiHost(address);
}

// How a value says OneUptime signs in; none is an OAuth client. Throws for anything else.
export function readWorkspaceOneAuthMethod(
  value: unknown,
): WorkspaceOneAuthMethod {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_WORKSPACE_ONE_AUTH_METHOD;
  }

  if (!isWorkspaceOneAuthMethod(value)) {
    throw new BadDataException(
      `Sign in with must be one of ${WORKSPACE_ONE_AUTH_METHODS.join(", ")}.`,
    );
  }

  return value;
}

// The token service region a value names; none is na. Throws for anything else.
export function readWorkspaceOneRegion(value: unknown): WorkspaceOneRegion {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_WORKSPACE_ONE_REGION;
  }

  if (!isWorkspaceOneRegion(value)) {
    throw new BadDataException(
      `Region must be one of ${WORKSPACE_ONE_REGIONS.join(", ")}.`,
    );
  }

  return value;
}

const WORKSPACE_ONE_CLIENT_ID_HELP: string =
  "Enter the OAuth client's Client ID. Workspace ONE shows it under Groups & Settings > Configurations > OAuth Client Management.";

// An OAuth client's ID, trimmed. Throws for anything that cannot be one.
export function readWorkspaceOneClientId(value: unknown): string {
  return readGeneratedCredential(value, WORKSPACE_ONE_CLIENT_ID_HELP, 4);
}

/*
 * An OAuth client's secret, trimmed. Workspace ONE shows it once, when the
 * client is made.
 */
export function readWorkspaceOneClientSecret(value: unknown): string {
  return readGeneratedCredential(
    value,
    "Enter the OAuth client's Client Secret. Workspace ONE shows it once, when the OAuth client is made: if it is lost, regenerate it on the client.",
  );
}

const WORKSPACE_ONE_USERNAME_HELP: string =
  "Enter the username of the administrator OneUptime signs in as.";

export function readWorkspaceOneUsername(value: unknown): string {
  return readDeviceManagementUsername(value, WORKSPACE_ONE_USERNAME_HELP);
}

export function readWorkspaceOnePassword(value: unknown): string {
  return readDeviceManagementPassword(
    value,
    "Enter the password of the administrator OneUptime signs in as.",
  );
}

/*
 * The tenant's REST API key, the aw-tenant-code, trimmed: Groups & Settings
 * > All Settings > System > Advanced > API > REST API shows it.
 */
export function readWorkspaceOneApiKey(value: unknown): string {
  return readGeneratedCredential(
    value,
    "Enter the REST API key. Find it under Groups & Settings > All Settings > System > Advanced > API > REST API.",
  );
}

/*
 * SOTI MOBICONTROL (#10087)
 *
 * OneUptime reads SOTI MobiControl through its REST API, at the server's
 * own address (https://acme.mobicontrolcloud.com for SOTI's cloud, the
 * server's host on premises), under /MobiControl/api. It signs in at the
 * server's token endpoint (POST /MobiControl/api/token) with the resource
 * owner password grant: an API client's ID and secret (made under Global
 * Settings > Services > API Client in the web console, or with MCAdmin
 * APIClientAdd on the server), and the username and password of a
 * MobiControl user whose permissions are read-only: Web Console Access and
 * View Installed Applications among the general permissions, and View
 * Groups on the device groups to read.
 */

// The API's base address on a server: https://acme.mobicontrolcloud.com/MobiControl/api.
export function getSotiApiBaseUrl(tenant: string): string {
  return `${getServerOrigin(tenant)}/MobiControl/api`;
}

export const SOTI_SERVER_HELP: string =
  "Enter your MobiControl server's address, like https://acme.mobicontrolcloud.com: the address of its web console, without /MobiControl.";

/*
 * The server a value names: its host (and port), lowercased. The web
 * console's address (https://acme.mobicontrolcloud.com/MobiControl/WebConsole)
 * and a bare host both name it. "" for none; throws, with what to do, for
 * anything else.
 */
export function readSotiServer(value: unknown): string {
  return readServerAddress(value, SOTI_SERVER_HELP);
}

const SOTI_CLIENT_ID_HELP: string =
  "Enter the API client's Client ID. Make one in the MobiControl web console under Global Settings > Services > API Client.";

export function readSotiClientId(value: unknown): string {
  return readGeneratedCredential(value, SOTI_CLIENT_ID_HELP, 4);
}

export function readSotiClientSecret(value: unknown): string {
  return readGeneratedCredential(
    value,
    "Enter the API client's Client Secret. MobiControl shows it once, when the API client is made.",
  );
}

const SOTI_USERNAME_HELP: string =
  "Enter the username of the MobiControl user OneUptime signs in as.";

export function readSotiUsername(value: unknown): string {
  return readDeviceManagementUsername(value, SOTI_USERNAME_HELP);
}

export function readSotiPassword(value: unknown): string {
  return readDeviceManagementPassword(
    value,
    "Enter the password of the MobiControl user OneUptime signs in as.",
  );
}

/*
 * What a connection reads, in a line: the Esper console's host
 * (acme.esper.cloud), the Intune tenant, with its cloud when it is not the
 * commercial one, or the server a Workspace ONE or SOTI connection reads
 * (as1234.awmdm.com, acme.mobicontrolcloud.com). Product words, the same
 * in every language.
 */
export function getDeviceManagementConnectionAddress(data: {
  provider: DeviceManagementProvider | string | undefined;
  config: DeviceManagementConfig;
}): string {
  if (
    data.provider === DeviceManagementProvider.WorkspaceOne ||
    data.provider === DeviceManagementProvider.Soti
  ) {
    return data.config.tenant;
  }

  if (data.provider === DeviceManagementProvider.Intune) {
    const cloud: IntuneCloud = isIntuneCloud(data.config.cloud)
      ? data.config.cloud
      : DEFAULT_INTUNE_CLOUD;

    return cloud === DEFAULT_INTUNE_CLOUD
      ? data.config.tenant
      : `${data.config.tenant} (${INTUNE_CLOUD_TITLES[cloud]})`;
  }

  return data.config.tenant ? getEsperConsoleHost(data.config.tenant) : "";
}

// The settings each service takes, besides how often to read.
const CONFIG_KEYS: Record<DeviceManagementProvider, ReadonlyArray<string>> = {
  [DeviceManagementProvider.Esper]: [
    CONFIG_TENANT_KEY,
    CONFIG_READ_INTERVAL_KEY,
  ],
  [DeviceManagementProvider.Intune]: [
    CONFIG_TENANT_KEY,
    CONFIG_CLIENT_ID_KEY,
    CONFIG_CLOUD_KEY,
    CONFIG_READ_INTERVAL_KEY,
  ],
  [DeviceManagementProvider.WorkspaceOne]: [
    CONFIG_TENANT_KEY,
    CONFIG_AUTH_METHOD_KEY,
    CONFIG_REGION_KEY,
    CONFIG_CLIENT_ID_KEY,
    CONFIG_USERNAME_KEY,
    CONFIG_READ_INTERVAL_KEY,
  ],
  [DeviceManagementProvider.Soti]: [
    CONFIG_TENANT_KEY,
    CONFIG_CLIENT_ID_KEY,
    CONFIG_USERNAME_KEY,
    CONFIG_READ_INTERVAL_KEY,
  ],
};

// What a refused key says a connection of the service takes.
const CONFIG_KEYS_SENTENCE: Record<DeviceManagementProvider, string> = {
  [DeviceManagementProvider.Esper]:
    "an Esper connection takes tenant and readIntervalInMinutes.",
  [DeviceManagementProvider.Intune]:
    "an Intune connection takes tenant, clientId, cloud and readIntervalInMinutes.",
  [DeviceManagementProvider.WorkspaceOne]:
    "a Workspace ONE connection takes tenant, authMethod, region, clientId, username and readIntervalInMinutes.",
  [DeviceManagementProvider.Soti]:
    "a SOTI connection takes tenant, clientId, username and readIntervalInMinutes.",
};

// A value that is set: not undefined, null or "".
function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function readConfigObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

// A value read by `read`, or `fallback` when it throws: a stored value is never trusted.
function readQuietly<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/*
 * A connection's settings as they are stored, read without trusting them:
 * an interval that is not one of the choices is the default, a tenant or an
 * ID that is not one is "". Read as its service's: Esper's when none is
 * given, as a connection made before there was a choice is.
 */
export function readDeviceManagementConfig(
  value: unknown,
  provider?: DeviceManagementProvider | string | undefined,
): DeviceManagementConfig {
  const config: JSONObject = readConfigObject(value);
  const readIntervalInMinutes: number = readDeviceManagementReadInterval(
    config[CONFIG_READ_INTERVAL_KEY],
  );

  if (provider === DeviceManagementProvider.Intune) {
    return {
      tenant: readQuietly((): string => {
        return readIntuneTenant(config[CONFIG_TENANT_KEY]);
      }, ""),
      readIntervalInMinutes,
      clientId: readQuietly((): string => {
        return readIntuneClientId(config[CONFIG_CLIENT_ID_KEY]);
      }, ""),
      cloud: readQuietly((): IntuneCloud => {
        return readIntuneCloud(config[CONFIG_CLOUD_KEY]);
      }, DEFAULT_INTUNE_CLOUD),
    };
  }

  if (provider === DeviceManagementProvider.WorkspaceOne) {
    const authMethod: WorkspaceOneAuthMethod = readQuietly(
      (): WorkspaceOneAuthMethod => {
        return readWorkspaceOneAuthMethod(config[CONFIG_AUTH_METHOD_KEY]);
      },
      DEFAULT_WORKSPACE_ONE_AUTH_METHOD,
    );

    return {
      tenant: readQuietly((): string => {
        return readWorkspaceOneServer(config[CONFIG_TENANT_KEY]);
      }, ""),
      readIntervalInMinutes,
      authMethod,
      ...(authMethod === "basic"
        ? {
            username: readQuietly((): string => {
              return readWorkspaceOneUsername(config[CONFIG_USERNAME_KEY]);
            }, ""),
          }
        : {
            region: readQuietly((): WorkspaceOneRegion => {
              return readWorkspaceOneRegion(config[CONFIG_REGION_KEY]);
            }, DEFAULT_WORKSPACE_ONE_REGION),
            clientId: readQuietly((): string => {
              return readWorkspaceOneClientId(config[CONFIG_CLIENT_ID_KEY]);
            }, ""),
          }),
    };
  }

  if (provider === DeviceManagementProvider.Soti) {
    return {
      tenant: readQuietly((): string => {
        return readSotiServer(config[CONFIG_TENANT_KEY]);
      }, ""),
      readIntervalInMinutes,
      clientId: readQuietly((): string => {
        return readSotiClientId(config[CONFIG_CLIENT_ID_KEY]);
      }, ""),
      username: readQuietly((): string => {
        return readSotiUsername(config[CONFIG_USERNAME_KEY]);
      }, ""),
    };
  }

  return {
    tenant: readQuietly((): string => {
      return readEsperTenant(config[CONFIG_TENANT_KEY]);
    }, ""),
    readIntervalInMinutes,
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
  options: {
    requireTenant: boolean;
    // The connection's service; Esper when absent.
    provider?: DeviceManagementProvider | string | undefined;
  },
): DeviceManagementConfig {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== "object" || Array.isArray(value))
  ) {
    throw new BadDataException("Settings must be an object.");
  }

  const config: JSONObject = (value as JSONObject) || {};
  const provider: DeviceManagementProvider = isDeviceManagementProvider(
    options.provider,
  )
    ? options.provider
    : DeviceManagementProvider.Esper;
  const isIntune: boolean = provider === DeviceManagementProvider.Intune;
  const keys: ReadonlyArray<string> = CONFIG_KEYS[provider];

  for (const key of Object.keys(config)) {
    if (!keys.includes(key)) {
      throw new BadDataException(
        `Settings has no "${key.substring(0, 50)}": ${CONFIG_KEYS_SENTENCE[provider]}`,
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

  if (isIntune) {
    const tenant: string = readIntuneTenant(config[CONFIG_TENANT_KEY]);

    if (options.requireTenant && !tenant) {
      throw new BadDataException(INTUNE_TENANT_HELP);
    }

    return {
      tenant: tenant,
      readIntervalInMinutes: readDeviceManagementReadInterval(interval),
      // Required with the tenant: the two sign in together.
      clientId:
        options.requireTenant ||
        (config[CONFIG_CLIENT_ID_KEY] !== undefined &&
          config[CONFIG_CLIENT_ID_KEY] !== null &&
          config[CONFIG_CLIENT_ID_KEY] !== "")
          ? readIntuneClientId(config[CONFIG_CLIENT_ID_KEY])
          : "",
      cloud: readIntuneCloud(config[CONFIG_CLOUD_KEY]),
    };
  }

  if (provider === DeviceManagementProvider.WorkspaceOne) {
    const tenant: string = readWorkspaceOneServer(config[CONFIG_TENANT_KEY]);

    if (options.requireTenant && !tenant) {
      throw new BadDataException(WORKSPACE_ONE_SERVER_HELP);
    }

    const authMethod: WorkspaceOneAuthMethod = readWorkspaceOneAuthMethod(
      config[CONFIG_AUTH_METHOD_KEY],
    );

    // Required with the server: the two sign in together.
    if (authMethod === "basic") {
      return {
        tenant: tenant,
        readIntervalInMinutes: readDeviceManagementReadInterval(interval),
        authMethod,
        username:
          options.requireTenant || isSet(config[CONFIG_USERNAME_KEY])
            ? readWorkspaceOneUsername(config[CONFIG_USERNAME_KEY])
            : "",
      };
    }

    return {
      tenant: tenant,
      readIntervalInMinutes: readDeviceManagementReadInterval(interval),
      authMethod,
      region: readWorkspaceOneRegion(config[CONFIG_REGION_KEY]),
      clientId:
        options.requireTenant || isSet(config[CONFIG_CLIENT_ID_KEY])
          ? readWorkspaceOneClientId(config[CONFIG_CLIENT_ID_KEY])
          : "",
    };
  }

  if (provider === DeviceManagementProvider.Soti) {
    const tenant: string = readSotiServer(config[CONFIG_TENANT_KEY]);

    if (options.requireTenant && !tenant) {
      throw new BadDataException(SOTI_SERVER_HELP);
    }

    return {
      tenant: tenant,
      readIntervalInMinutes: readDeviceManagementReadInterval(interval),
      // Required with the server: the three sign in together.
      clientId:
        options.requireTenant || isSet(config[CONFIG_CLIENT_ID_KEY])
          ? readSotiClientId(config[CONFIG_CLIENT_ID_KEY])
          : "",
      username:
        options.requireTenant || isSet(config[CONFIG_USERNAME_KEY])
          ? readSotiUsername(config[CONFIG_USERNAME_KEY])
          : "",
    };
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

// The JSON a config is stored as: only the settings its service takes.
export function toDeviceManagementConfigJson(
  config: DeviceManagementConfig,
): JSONObject {
  const json: JSONObject = {
    [CONFIG_TENANT_KEY]: config.tenant,
    [CONFIG_READ_INTERVAL_KEY]: config.readIntervalInMinutes,
  };

  if (config.clientId !== undefined) {
    json[CONFIG_CLIENT_ID_KEY] = config.clientId;
  }

  if (config.cloud !== undefined) {
    json[CONFIG_CLOUD_KEY] = config.cloud;
  }

  if (config.authMethod !== undefined) {
    json[CONFIG_AUTH_METHOD_KEY] = config.authMethod;
  }

  if (config.region !== undefined) {
    json[CONFIG_REGION_KEY] = config.region;
  }

  if (config.username !== undefined) {
    json[CONFIG_USERNAME_KEY] = config.username;
  }

  return json;
}
