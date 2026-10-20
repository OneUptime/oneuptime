import ExternalMcpServerAuthType from "./ExternalMcpServerAuthType";
import {
  MAX_EXTERNAL_MCP_HEADER_NAME_CHARS,
  MAX_EXTERNAL_MCP_HEADER_VALUE_CHARS,
  MAX_EXTERNAL_MCP_SECRET_CHARS,
  MAX_EXTERNAL_MCP_SERVER_HEADERS,
  MAX_EXTERNAL_MCP_URL_CHARS,
} from "./ExternalMcpServerLimits";

/*
 * WHAT AN EXTERNAL MCP SERVER'S SETTINGS MUST BE before they are saved:
 * the address, and the sign-in its Authentication asks for. The service
 * refuses anything else (ExternalMcpServerService), whoever writes it - the
 * Dashboard's form, the API or Terraform - and the form says the same
 * sentences before it sends anything.
 *
 * Every check reads its value character by character: an address or a
 * header is text a person typed, so nothing here runs a regular
 * expression over it.
 *
 * Shared by the server and the Dashboard, so it imports nothing but types.
 */

/*
 * Why an address cannot be an MCP server's, or null when it can: an http
 * or https URL with a host, no user name or password in it (a secret in
 * the address would be shown to everyone who can read the server - sign-in
 * goes in Authentication), and at most MAX_EXTERNAL_MCP_URL_CHARS long.
 *
 * Whether the address may be reached from OneUptime (not a private or
 * internal one, on OneUptime Cloud) is decided when OneUptime connects,
 * after resolving its name: see McpHttpTransport.
 */
export function getExternalMcpServerUrlProblem(
  value: unknown,
  label: string = "The MCP server's URL",
): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return `${label} is required.`;
  }

  const text: string = value.trim();

  if (text.length > MAX_EXTERNAL_MCP_URL_CHARS) {
    return `${label} can be at most ${MAX_EXTERNAL_MCP_URL_CHARS} characters long.`;
  }

  let url: URL;

  try {
    url = new URL(text);
  } catch {
    return `${label} is not a valid URL. Use the full address, such as https://mcp.example.com/mcp.`;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `${label} must start with https:// or http://.`;
  }

  if (!url.hostname) {
    return `${label} has no host name.`;
  }

  if (url.username || url.password) {
    return `${label} cannot hold a user name or password. Put the sign-in under Authentication instead.`;
  }

  return null;
}

/*
 * Headers OneUptime sets itself on every request to an MCP server, or that
 * only the connection itself may carry. A header of the server's own may
 * not replace one of them: the protocol would break, or a request could be
 * smuggled. Compared without regard to case.
 */
export const RESERVED_EXTERNAL_MCP_HEADER_NAMES: ReadonlyArray<string> = [
  "accept",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "expect",
  "host",
  "keep-alive",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
];

// The token characters of RFC 9110 field names, besides letters and digits.
const HEADER_NAME_SYMBOLS: string = "!#$%&'*+-.^_`|~";

function isHeaderNameCharacter(character: string): boolean {
  const code: number = character.charCodeAt(0);

  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    HEADER_NAME_SYMBOLS.includes(character)
  );
}

export function isValidExternalMcpHeaderName(name: string): boolean {
  if (!name || name.length > MAX_EXTERNAL_MCP_HEADER_NAME_CHARS) {
    return false;
  }

  for (const character of name) {
    if (!isHeaderNameCharacter(character)) {
      return false;
    }
  }

  return true;
}

/*
 * A header value may hold any visible character, spaces and tabs - never a
 * line break or another control character, which would end the header
 * early and let the rest be read as a header of its own.
 */
export function isValidExternalMcpHeaderValue(value: string): boolean {
  if (!value || value.length > MAX_EXTERNAL_MCP_HEADER_VALUE_CHARS) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if ((code < 32 && code !== 9) || code === 127) {
      return false;
    }
  }

  return true;
}

/*
 * The headers a stored or written value holds, as name -> value, each
 * value trimmed. Anything that is not an object of texts holds none.
 */
export function readExternalMcpServerHeaders(
  value: unknown,
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return headers;
  }

  for (const [name, headerValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (typeof headerValue !== "string") {
      continue;
    }

    const trimmedName: string = name.trim();
    const trimmedValue: string = headerValue.trim();

    if (trimmedName && trimmedValue) {
      headers[trimmedName] = trimmedValue;
    }
  }

  return headers;
}

/*
 * Why these headers cannot be saved, or null when they can: at least one,
 * at most MAX_EXTERNAL_MCP_SERVER_HEADERS, each a valid name with a value,
 * none of them one OneUptime sets itself, and no name twice.
 */
export function getExternalMcpServerHeadersProblem(
  value: unknown,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Add at least one header, such as X-API-Key, with its value.";
  }

  const entries: Array<[string, unknown]> = Object.entries(
    value as Record<string, unknown>,
  );

  if (entries.length === 0) {
    return "Add at least one header, such as X-API-Key, with its value.";
  }

  if (entries.length > MAX_EXTERNAL_MCP_SERVER_HEADERS) {
    return `An MCP server can have at most ${MAX_EXTERNAL_MCP_SERVER_HEADERS} headers.`;
  }

  const seen: Set<string> = new Set<string>();

  for (const [rawName, rawValue] of entries) {
    const name: string = rawName.trim();

    if (!isValidExternalMcpHeaderName(name)) {
      return `"${name.slice(0, 40)}" is not a valid header name. Use letters, digits and dashes, such as X-API-Key.`;
    }

    const lowerName: string = name.toLowerCase();

    if (RESERVED_EXTERNAL_MCP_HEADER_NAMES.includes(lowerName)) {
      return `OneUptime sets the ${name} header itself. Remove it from the headers.`;
    }

    if (seen.has(lowerName)) {
      return `The ${name} header is there twice. Keep one.`;
    }

    seen.add(lowerName);

    if (typeof rawValue !== "string" || !rawValue.trim()) {
      return `The ${name} header needs a value.`;
    }

    if (!isValidExternalMcpHeaderValue(rawValue.trim())) {
      return `The value of the ${name} header is too long, or holds a line break.`;
    }
  }

  return null;
}

/*
 * Why a secret (a token, a client secret) cannot be saved, or null when it
 * can: text with no line break, at most MAX_EXTERNAL_MCP_SECRET_CHARS long.
 */
export function getExternalMcpServerSecretProblem(
  value: unknown,
  label: string,
): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return `${label} is required.`;
  }

  const text: string = value.trim();

  if (text.length > MAX_EXTERNAL_MCP_SECRET_CHARS) {
    return `${label} can be at most ${MAX_EXTERNAL_MCP_SECRET_CHARS} characters long.`;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 32 || code === 127) {
      return `${label} cannot hold a line break or another control character.`;
    }
  }

  return null;
}

// What a write says about a server's sign-in, as stored or as sent.
export interface ExternalMcpServerSignIn {
  authType?: unknown;
  bearerToken?: unknown;
  headers?: unknown;
  oauthTokenUrl?: unknown;
  oauthClientId?: unknown;
  oauthClientSecret?: unknown;
}

/*
 * Why a server's sign-in cannot be saved, or null when it can - for each
 * Authentication, what it needs. On an edit, a secret left out keeps the
 * one stored (`isEdit`): a person never has to type a token again to
 * rename a server.
 */
export function getExternalMcpServerSignInProblem(data: {
  signIn: ExternalMcpServerSignIn;
  isEdit: boolean;
}): string | null {
  const signIn: ExternalMcpServerSignIn = data.signIn;

  switch (signIn.authType) {
    case undefined:
    case null:
    case ExternalMcpServerAuthType.None:
      return null;
    case ExternalMcpServerAuthType.BearerToken:
      if (data.isEdit && signIn.bearerToken === undefined) {
        return null;
      }
      return getExternalMcpServerSecretProblem(signIn.bearerToken, "The token");
    case ExternalMcpServerAuthType.Headers:
      if (data.isEdit && signIn.headers === undefined) {
        return null;
      }
      return getExternalMcpServerHeadersProblem(signIn.headers);
    case ExternalMcpServerAuthType.OAuthClientCredentials: {
      if (!data.isEdit || signIn.oauthTokenUrl !== undefined) {
        const urlProblem: string | null = getExternalMcpServerUrlProblem(
          signIn.oauthTokenUrl,
          "The token URL",
        );

        if (urlProblem) {
          return urlProblem;
        }
      }

      if (!data.isEdit || signIn.oauthClientId !== undefined) {
        const clientIdProblem: string | null =
          getExternalMcpServerSecretProblem(
            signIn.oauthClientId,
            "The client ID",
          );

        if (clientIdProblem) {
          return clientIdProblem;
        }
      }

      if (!data.isEdit || signIn.oauthClientSecret !== undefined) {
        return getExternalMcpServerSecretProblem(
          signIn.oauthClientSecret,
          "The client secret",
        );
      }

      return null;
    }
    default:
      return "Choose how OneUptime signs in to the MCP server: None, Bearer token, Headers or OAuth client credentials.";
  }
}
