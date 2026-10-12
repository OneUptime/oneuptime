import {
  getToolImportSourceDefinition,
  ToolImportCredentialField,
  ToolImportSourceDefinition,
} from "./ToolImportCatalog";
import ToolImportSource from "./ToolImportSource";

/*
 * WHAT A PERSON GIVES THE PAGE TO CONNECT A TOOL.
 *
 * Always the tool's API key. Splunk On-Call also wants the key's API ID,
 * and Grafana OnCall the address of its API (Grafana Cloud's, or the
 * person's own install). ToolImportCatalog says which tool wants what.
 *
 * A run keeps them only while it reads, in its encrypted apiKey column:
 * the key on its own for a tool that needs only a key (as every run always
 * has), and these fields as JSON for a tool that needs more. Either way
 * the column is readable by nobody and cleared as soon as the read ends.
 */

export interface ToolImportCredentials {
  apiKey: string;
  // Splunk On-Call's API ID.
  apiKeyId?: string | undefined;
  // The tool's API address, as readToolImportApiUrl wrote it.
  apiUrl?: string | undefined;
}

// An address is never longer than this.
export const TOOL_IMPORT_MAX_API_URL_LENGTH: number = 500;

// An API ID is a short identifier: anything longer is not one.
export const TOOL_IMPORT_MAX_API_KEY_ID_LENGTH: number = 128;

const API_KEY_ID_SHAPE: RegExp = /^[A-Za-z0-9._-]+$/;
const BASE_PATH_SHAPE: RegExp = /^[A-Za-z0-9\-._~%/]*$/;
const TRAILING_SLASHES: RegExp = /\/+$/;
// The person pasted the address of the API itself, not its root.
const TRAILING_API_VERSION: RegExp = /\/api\/v1$/i;

export function isToolImportApiKeyId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= TOOL_IMPORT_MAX_API_KEY_ID_LENGTH &&
    API_KEY_ID_SHAPE.test(value)
  );
}

export interface ToolImportApiAddress {
  // "https://oncall.example.com:8443/oncall": what requests are built on.
  url: string;
  // "https://oncall.example.com:8443"
  origin: string;
  // "/oncall", or "" for the root.
  basePath: string;
  // "oncall.example.com": the one host a read may call.
  hostname: string;
  isHttps: boolean;
}

/*
 * A tool's API address as a person pasted it, cleaned: http or https, a
 * host, no user name or password, no query and no fragment, and a path of
 * plain path characters with no empty or ".." step. A trailing slash, and
 * the "/api/v1" the API's own endpoints add, are taken off, so the address
 * copied from the tool's settings and the address of its API both work.
 * Null for anything else.
 *
 * Whether plain http is allowed is not decided here: the caller decides
 * (OneUptime Cloud never sends a key over plain http).
 */
export function readToolImportApiUrl(
  value: unknown,
): ToolImportApiAddress | null {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (!text || text.length > TOOL_IMPORT_MAX_API_URL_LENGTH) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(text);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  if (
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }

  const basePath: string = parsed.pathname
    .replace(TRAILING_SLASHES, "")
    .replace(TRAILING_API_VERSION, "")
    .replace(TRAILING_SLASHES, "");

  if (
    !BASE_PATH_SHAPE.test(basePath) ||
    basePath.includes("//") ||
    basePath.split("/").includes("..") ||
    basePath.split("/").includes(".")
  ) {
    return null;
  }

  return {
    url: `${parsed.origin}${basePath}`,
    origin: parsed.origin,
    basePath: basePath,
    hostname: parsed.hostname.toLowerCase(),
    isHttps: parsed.protocol === "https:",
  };
}

function needsMoreThanTheKey(source: ToolImportSource): boolean {
  const definition: ToolImportSourceDefinition =
    getToolImportSourceDefinition(source);

  return definition.credentialFields.some(
    (field: ToolImportCredentialField): boolean => {
      return field !== ToolImportCredentialField.ApiKey;
    },
  );
}

// What a run stores in its encrypted apiKey column.
export function encodeToolImportCredentials(
  source: ToolImportSource,
  credentials: ToolImportCredentials,
): string {
  if (!needsMoreThanTheKey(source)) {
    return credentials.apiKey;
  }

  const stored: Record<string, string> = { apiKey: credentials.apiKey };

  if (credentials.apiKeyId) {
    stored["apiKeyId"] = credentials.apiKeyId;
  }

  if (credentials.apiUrl) {
    stored["apiUrl"] = credentials.apiUrl;
  }

  return JSON.stringify(stored);
}

/*
 * What a run stored, read back: null when there is nothing (the read ended
 * and cleared it) or it is not what this tool stores.
 */
export function decodeToolImportCredentials(
  source: ToolImportSource,
  stored: string | null | undefined,
): ToolImportCredentials | null {
  if (typeof stored !== "string" || !stored) {
    return null;
  }

  if (!needsMoreThanTheKey(source)) {
    return { apiKey: stored };
  }

  let value: unknown;

  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  if (typeof record["apiKey"] !== "string" || !record["apiKey"]) {
    return null;
  }

  const credentials: ToolImportCredentials = { apiKey: record["apiKey"] };

  if (typeof record["apiKeyId"] === "string" && record["apiKeyId"]) {
    credentials.apiKeyId = record["apiKeyId"];
  }

  if (typeof record["apiUrl"] === "string" && record["apiUrl"]) {
    credentials.apiUrl = record["apiUrl"];
  }

  return credentials;
}

/*
 * Every value a message about this read must never repeat: the key, and
 * its ID. (The address is the person's own and says nothing secret.)
 */
export function getToolImportSecrets(
  credentials: ToolImportCredentials | null,
): Array<string> {
  if (!credentials) {
    return [];
  }

  return [credentials.apiKey, credentials.apiKeyId || ""].filter(
    (secret: string): boolean => {
      return secret.length >= 4;
    },
  );
}
