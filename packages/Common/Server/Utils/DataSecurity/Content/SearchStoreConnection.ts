import { JSONObject } from "../../../../Types/JSON";
import { withoutTrailingSlashes } from "../../../../Utils/TrailingRuns";
import { TargetTlsOptions } from "../../OutboundProxyAgents";
import { getConnectionSecrets } from "./DatabaseSampler";

/*
 * A SEARCH CLUSTER'S CONNECTION, AS A PERSON WRITES IT (#11140).
 *
 * Elasticsearch and OpenSearch have no connection-string format of their
 * own, so OneUptime reads two:
 *
 *  - a URL, the way a browser or curl reaches the cluster:
 *      https://reader:password@search.internal:9200
 *    with a read-only user's name and password in it, or an Elasticsearch
 *    API key instead (?api_key=<the key's encoded value, or id:key>), and
 *    ?verify_certificate=false for a cluster whose certificate no
 *    authority signed - the one Elasticsearch 8 makes at its first start;
 *  - JSON, for a cluster whose certificate a CA of its own signed:
 *      {"url": "https://search.internal:9200", "username": "reader",
 *       "password": "...", "caCertificate": "-----BEGIN CERTIFICATE-----..."}
 *    with "apiKey" in place of a user, and "verifyCertificate": false.
 *
 * A path after the host is kept (a cluster behind a proxy at /es/). The two
 * parameters are taken off the address and any other is refused, so nothing
 * a person wrote is sent along unread. Every refusal says what to write
 * instead, and never repeats a secret.
 */

export interface SearchConnection {
  // The cluster's address with no credentials, parameters or trailing slash.
  baseUrl: string;
  isHttps: boolean;
  // The Authorization header's value, or undefined for a cluster without security.
  authorization?: string | undefined;
  // How the cluster's certificate is checked: unset, as every request's is.
  tls?: TargetTlsOptions | undefined;
}

export const SEARCH_CONNECTION_EXAMPLE: string =
  "https://reader:password@search.internal:9200";

const API_KEY_PARAMETER: string = "api_key";
const VERIFY_CERTIFICATE_PARAMETER: string = "verify_certificate";

const JSON_KEYS: ReadonlySet<string> = new Set([
  "url",
  "username",
  "password",
  "apiKey",
  "caCertificate",
  "verifyCertificate",
]);

const PEM_CERTIFICATE: RegExp =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

export class SearchConnectionError extends Error {}

function refuse(sentence: string): never {
  throw new SearchConnectionError(sentence);
}

function readFlag(value: string, name: string): boolean {
  const normalized: string = value.trim().toLowerCase();

  if (normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return refuse(`Set ${name} to true or false.`);
}

/*
 * An Elasticsearch API key as its Authorization header carries it: the
 * key's encoded value as Elasticsearch hands it out, or its id and key
 * written id:key, which are encoded here.
 */
export function toApiKeyAuthorization(apiKey: string): string {
  const trimmed: string = apiKey.trim();

  if (!trimmed) {
    return refuse("The API key is empty. Paste the key's encoded value.");
  }

  const encoded: string = trimmed.includes(":")
    ? Buffer.from(trimmed, "utf8").toString("base64")
    : trimmed;

  return `ApiKey ${encoded}`;
}

function toBasicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function readAddress(value: string): { url: URL; isHttps: boolean } {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return refuse(
      `Enter the cluster's address with a read-only user, such as ${SEARCH_CONNECTION_EXAMPLE}.`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return refuse(
      `Start the cluster's address with https:// or http://, such as ${SEARCH_CONNECTION_EXAMPLE}.`,
    );
  }

  if (!url.hostname) {
    return refuse(
      `Name the cluster's host, such as ${SEARCH_CONNECTION_EXAMPLE}.`,
    );
  }

  if (url.hash) {
    return refuse("Remove the # and what follows it from the address.");
  }

  return { url, isHttps: url.protocol === "https:" };
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// The address as it is sent: no credentials, no parameters, no trailing slash.
function toBaseUrl(url: URL): string {
  const base: URL = new URL(url.toString());

  base.username = "";
  base.password = "";
  base.search = "";
  base.hash = "";

  return withoutTrailingSlashes(base.toString());
}

function readUrlConnection(value: string): SearchConnection {
  const { url, isHttps } = readAddress(value);
  let apiKey: string | undefined = undefined;
  let verifyCertificate: boolean = true;

  for (const [name, parameter] of url.searchParams.entries()) {
    if (name === API_KEY_PARAMETER) {
      apiKey = parameter;
    } else if (name === VERIFY_CERTIFICATE_PARAMETER) {
      verifyCertificate = readFlag(parameter, VERIFY_CERTIFICATE_PARAMETER);
    } else {
      refuse(
        `OneUptime reads only ${API_KEY_PARAMETER} and ${VERIFY_CERTIFICATE_PARAMETER} after the address. Remove ${name.slice(0, 64)}.`,
      );
    }
  }

  const username: string = decodePart(url.username);
  const password: string = decodePart(url.password);

  if (apiKey !== undefined && (username || password)) {
    refuse("Give a user and password, or an API key, not both.");
  }

  return {
    baseUrl: toBaseUrl(url),
    isHttps,
    authorization:
      apiKey !== undefined
        ? toApiKeyAuthorization(apiKey)
        : username || password
          ? toBasicAuthorization(username, password)
          : undefined,
    tls: !isHttps
      ? undefined
      : verifyCertificate
        ? undefined
        : { rejectUnauthorized: false },
  };
}

function readText(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return refuse(`Write ${name} as text, in quotes.`);
  }

  return value;
}

function readJsonConnection(value: string): SearchConnection {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return refuse(
      'The connection is not valid JSON. Write it as {"url": "https://search.internal:9200", "username": "reader", "password": "..."}.',
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return refuse(
      'Write the connection as one JSON object, such as {"url": "https://search.internal:9200", "username": "reader", "password": "..."}.',
    );
  }

  const object: JSONObject = parsed as JSONObject;

  for (const key of Object.keys(object)) {
    if (!JSON_KEYS.has(key)) {
      refuse(
        `OneUptime reads only url, username, password, apiKey, caCertificate and verifyCertificate. Remove ${key.slice(0, 64)}.`,
      );
    }
  }

  const address: string | undefined = readText(object["url"], "url");

  if (!address) {
    return refuse(
      'Give the cluster\'s address as "url", such as "https://search.internal:9200".',
    );
  }

  const { url, isHttps } = readAddress(address);

  if (url.username || url.password || url.search) {
    refuse(
      'Give the user, password and API key as "username", "password" and "apiKey", not in the url.',
    );
  }

  const username: string = readText(object["username"], "username") || "";
  const password: string = readText(object["password"], "password") || "";
  const apiKey: string | undefined = readText(object["apiKey"], "apiKey");
  const caCertificate: string | undefined = readText(
    object["caCertificate"],
    "caCertificate",
  );
  const verifyRaw: unknown = object["verifyCertificate"];

  if (
    verifyRaw !== undefined &&
    verifyRaw !== null &&
    typeof verifyRaw !== "boolean"
  ) {
    refuse("Set verifyCertificate to true or false, without quotes.");
  }

  const verifyCertificate: boolean = verifyRaw !== false;

  if (apiKey !== undefined && (username || password)) {
    refuse("Give a user and password, or an API key, not both.");
  }

  if (caCertificate !== undefined && !PEM_CERTIFICATE.test(caCertificate)) {
    refuse(
      "Paste the CA's certificate as PEM, from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----.",
    );
  }

  if (!isHttps && (caCertificate !== undefined || verifyRaw === false)) {
    refuse(
      "A certificate is checked only over https://. Start the url with https://, or leave caCertificate and verifyCertificate out.",
    );
  }

  return {
    baseUrl: toBaseUrl(url),
    isHttps,
    authorization:
      apiKey !== undefined
        ? toApiKeyAuthorization(apiKey)
        : username || password
          ? toBasicAuthorization(username, password)
          : undefined,
    tls: !isHttps
      ? undefined
      : !verifyCertificate
        ? { rejectUnauthorized: false }
        : caCertificate
          ? { ca: caCertificate }
          : undefined,
  };
}

/*
 * A connection string, read: the cluster's address and how to sign in to
 * it. Throws a SearchConnectionError that says what to write instead.
 */
export function readSearchConnection(
  connectionString: string,
): SearchConnection {
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    return refuse(
      `Enter the cluster's address with a read-only user, such as ${SEARCH_CONNECTION_EXAMPLE}.`,
    );
  }

  const trimmed: string = connectionString.trim();

  return trimmed.startsWith("{")
    ? readJsonConnection(trimmed)
    : readUrlConnection(trimmed);
}

// Whether the text is a search cluster's connection OneUptime can read.
export function isSearchConnectionString(value: string): boolean {
  try {
    readSearchConnection(value);
    return true;
  } catch {
    return false;
  }
}

/*
 * Every secret a connection string holds, to take out of an error message:
 * what DatabaseSampler takes out of any connection string - the whole
 * string, a URL's password and user:password, a JSON key that names a
 * credential - and an API key, as written and as sent.
 */
export function getSearchConnectionSecrets(
  connectionString: string,
): Array<string> {
  const secrets: Set<string> = new Set(getConnectionSecrets(connectionString));

  try {
    const connection: SearchConnection = readSearchConnection(connectionString);

    if (connection.authorization) {
      secrets.add(connection.authorization);
      secrets.add(connection.authorization.replace(/^(Basic|ApiKey) /, ""));
    }
  } catch {
    // Not readable: the whole string, and what the database reader found, are taken out.
  }

  try {
    const url: URL = new URL(connectionString.trim());
    const apiKey: string | null = url.searchParams.get(API_KEY_PARAMETER);

    if (apiKey) {
      secrets.add(apiKey);
      secrets.add(encodeURIComponent(apiKey));
    }
  } catch {
    // Not a URL: a JSON connection's apiKey is one of its credential keys above.
  }

  return [...secrets]
    .filter((secret: string) => {
      return secret.length >= 3;
    })
    .sort((a: string, b: string) => {
      return b.length - a.length;
    });
}
