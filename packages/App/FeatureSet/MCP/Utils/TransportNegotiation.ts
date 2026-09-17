/**
 * Transport Negotiation
 *
 * Real-world MCP clients are stricter and looser than the reference
 * implementation in ways that used to break the OneUptime MCP endpoint at the
 * transport layer, before a single tool ever ran — see GitHub issue #3695.
 *
 * Two incompatibilities showed up in the wild:
 *
 * 1. Protocol version. `StreamableHTTPServerTransport` rejects any
 *    `MCP-Protocol-Version` request header whose value is not in the SDK's
 *    `SUPPORTED_PROTOCOL_VERSIONS` list with a flat 400. A client that speaks a
 *    NEWER revision of the spec than the bundled SDK knows about (Claude sent
 *    `2026-07-28`) is therefore turned away even though the two sides share
 *    several older versions. The MCP lifecycle says the opposite should happen:
 *    the peers settle on the highest version they both support. These helpers
 *    do that negotiation before the SDK sees the header.
 *
 * 2. Accept header. The SDK requires POSTs to list BOTH `application/json` and
 *    `text/event-stream`, matching them with a naive substring test — so a
 *    client that sends a wildcard Accept, sends nothing at all, or asks only for
 *    JSON gets a 406 instead of a response. The spec lets the server answer a
 *    POST with either media type, so we look at what the client actually
 *    accepts and pick the response format to match.
 *
 * The negotiation itself is pure, so the behavior can be unit-tested without
 * HTTP. Applying a negotiated value needs one more step, because the SDK
 * rebuilds the request it validates from Node's `rawHeaders` array rather than
 * from Express's parsed `headers` map — see `setRequestHeader` below.
 */

import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";

// Header names, lower-cased because Node normalizes incoming header keys.
export const MCP_PROTOCOL_VERSION_HEADER: string = "mcp-protocol-version";
export const ACCEPT_HEADER: string = "accept";

/*
 * Protocol versions are dated `YYYY-MM-DD`, so a plain lexicographic sort is
 * also a chronological one. The SDK lists newest-first; keep a copy sorted
 * oldest-first for the "highest version at or below X" search.
 */
export const KNOWN_PROTOCOL_VERSIONS: string[] = [
  ...SUPPORTED_PROTOCOL_VERSIONS,
].sort();

const PROTOCOL_VERSION_FORMAT: RegExp = /^\d{4}-\d{2}-\d{2}$/;

/** The Accept value we hand to the SDK once we have decided how to answer. */
export const NORMALIZED_ACCEPT_HEADER: string =
  "application/json, text/event-stream";

export enum ProtocolNegotiationOutcome {
  /** No `MCP-Protocol-Version` header — the SDK applies its own default. */
  NotRequested = "not-requested",
  /** The requested version is one we support; pass it through untouched. */
  Supported = "supported",
  /** The client is newer than us; we answer with the best version we share. */
  DowngradedToSupported = "downgraded-to-supported",
  /** Nothing in common (or an unparseable value) — the request must fail. */
  Unsupported = "unsupported",
}

export interface ProtocolNegotiationResult {
  outcome: ProtocolNegotiationOutcome;
  /** Exactly what the client asked for, for logs and error payloads. */
  requestedVersion: string | undefined;
  /** The version to act on; undefined when nothing was requested or agreed. */
  negotiatedVersion: string | undefined;
}

/**
 * Read a header value that Node may hand back as a string, a repeated-header
 * array, or nothing at all.
 */
export function readHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  const raw: string | undefined = Array.isArray(value) ? value[0] : value;
  const trimmed: string = (raw || "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Read a header that carries exactly one value, tolerating the two shapes a
 * repeated header can arrive in.
 *
 * Node hands most repeated headers back as a single comma-joined string
 * ("2026-07-28, 2025-06-18") rather than an array, so a client that sends the
 * header twice would otherwise produce a value that matches no known version
 * and gets rejected. Splitting is safe here precisely because a protocol
 * version can never itself contain a comma — which is why this is NOT applied
 * to Accept, where commas are the list separator.
 */
export function readSingleValueHeader(
  value: string | string[] | undefined,
): string | undefined {
  const raw: string | undefined = readHeaderValue(value);

  if (!raw) {
    return undefined;
  }

  const first: string = (raw.split(",")[0] || "").trim();

  return first.length > 0 ? first : undefined;
}

/**
 * Settle on a protocol version for this request.
 *
 * A client that asks for a version newer than anything we know about is
 * downgraded to the newest version we support, which is the same answer the
 * SDK gives during `initialize` negotiation — so the header and the handshake
 * agree instead of contradicting each other.
 *
 * A client that asks for a version OLDER than everything we support is a
 * genuine mismatch: there is no shared version to fall back to, so it is
 * reported as unsupported and the caller surfaces a precise error.
 */
export function negotiateProtocolVersion(
  requestedHeader: string | string[] | undefined,
): ProtocolNegotiationResult {
  const requestedVersion: string | undefined =
    readSingleValueHeader(requestedHeader);

  if (!requestedVersion) {
    return {
      outcome: ProtocolNegotiationOutcome.NotRequested,
      requestedVersion: undefined,
      negotiatedVersion: undefined,
    };
  }

  if (KNOWN_PROTOCOL_VERSIONS.includes(requestedVersion)) {
    return {
      outcome: ProtocolNegotiationOutcome.Supported,
      requestedVersion,
      negotiatedVersion: requestedVersion,
    };
  }

  /*
   * An unparseable value cannot be ordered against the known versions, so we
   * cannot tell whether it is newer or older. Treat it as unsupported rather
   * than guessing.
   */
  if (!PROTOCOL_VERSION_FORMAT.test(requestedVersion)) {
    return {
      outcome: ProtocolNegotiationOutcome.Unsupported,
      requestedVersion,
      negotiatedVersion: undefined,
    };
  }

  // Highest version we support that is not newer than what the client asked for.
  let bestMatch: string | undefined = undefined;
  for (const candidate of KNOWN_PROTOCOL_VERSIONS) {
    if (candidate < requestedVersion) {
      bestMatch = candidate;
    }
  }

  if (!bestMatch) {
    // The client is older than every version we speak.
    return {
      outcome: ProtocolNegotiationOutcome.Unsupported,
      requestedVersion,
      negotiatedVersion: undefined,
    };
  }

  return {
    outcome: ProtocolNegotiationOutcome.DowngradedToSupported,
    requestedVersion,
    negotiatedVersion: bestMatch,
  };
}

/** The newest protocol version this build of the server can speak. */
export function getLatestSupportedProtocolVersion(): string {
  return LATEST_PROTOCOL_VERSION;
}

export enum ResponseFormat {
  /** Stream the JSON-RPC response back as `text/event-stream`. */
  ServerSentEvents = "sse",
  /** Answer with a single `application/json` body. */
  Json = "json",
  /** The client accepts neither; the request cannot be answered. */
  Unacceptable = "unacceptable",
}

export interface AcceptNegotiationResult {
  format: ResponseFormat;
  /** Exactly what the client sent, for logs and error payloads. */
  requestedAccept: string | undefined;
}

/**
 * Decide how to answer a POST based on the client's Accept header.
 *
 * SSE is preferred when the client explicitly asks for it, because that is what
 * spec-compliant MCP clients expect and it keeps today's behavior unchanged for
 * them. Everything else that can take JSON — an explicit `application/json`, a
 * `*` / `application/*` wildcard, or no Accept header at all (which HTTP says
 * means "anything") — gets a plain JSON body, which every MCP client must be
 * able to read.
 */
export function negotiateResponseFormat(
  acceptHeader: string | string[] | undefined,
): AcceptNegotiationResult {
  const requestedAccept: string | undefined = readHeaderValue(acceptHeader);

  // No Accept header means the client accepts any media type (RFC 9110).
  if (!requestedAccept) {
    return { format: ResponseFormat.Json, requestedAccept: undefined };
  }

  const mediaTypes: string[] = requestedAccept
    .split(",")
    .map((part: string) => {
      // Drop parameters such as `;q=0.9` and normalize case.
      return (part.split(";")[0] || "").trim().toLowerCase();
    });

  /*
   * `text/*` is a media range that covers `text/event-stream`, so a client
   * sending it has said it can take the stream — treat it the same as naming
   * the type outright. (`*` alone is deliberately NOT in this list: see the
   * wildcard note below.)
   */
  const acceptsEventStream: boolean =
    mediaTypes.includes("text/event-stream") || mediaTypes.includes("text/*");

  /*
   * A wildcard means "anything", which covers JSON. Wildcards are answered with
   * JSON rather than SSE: every MCP client can read a JSON body, whereas a
   * client that sent a wildcard never said it can parse an event stream.
   */
  const acceptsJson: boolean =
    mediaTypes.includes("application/json") ||
    mediaTypes.includes("application/*") ||
    mediaTypes.includes("*/*");

  if (acceptsEventStream) {
    return { format: ResponseFormat.ServerSentEvents, requestedAccept };
  }

  if (acceptsJson) {
    return { format: ResponseFormat.Json, requestedAccept };
  }

  return { format: ResponseFormat.Unacceptable, requestedAccept };
}

/**
 * The parts of a Node/Express request these helpers rewrite.
 *
 * `headers` is the parsed, lower-cased map Express exposes. `rawHeaders` is the
 * flat `[name, value, name, value, ...]` array Node keeps alongside it — and it
 * is the one that matters here, because the MCP SDK rebuilds the request it
 * validates from `rawHeaders`, not from `headers`. Rewriting only `headers`
 * would leave the SDK looking at the original value.
 */
export interface HeaderMutableRequest {
  headers: Record<string, string | string[] | undefined>;
  rawHeaders?: string[];
}

/**
 * Drop every copy of a header from both views of the request.
 */
export function removeRequestHeader(
  req: HeaderMutableRequest,
  name: string,
): void {
  const lowerCasedName: string = name.toLowerCase();

  delete req.headers[lowerCasedName];

  const rawHeaders: string[] | undefined = req.rawHeaders;

  if (!rawHeaders) {
    return;
  }

  // Walk backwards so splicing does not shift entries we have yet to inspect.
  for (let index: number = rawHeaders.length - 2; index >= 0; index -= 2) {
    if ((rawHeaders[index] || "").toLowerCase() === lowerCasedName) {
      rawHeaders.splice(index, 2);
    }
  }
}

/**
 * Replace a header on both views of the request, collapsing any duplicates.
 */
export function setRequestHeader(
  req: HeaderMutableRequest,
  name: string,
  value: string,
): void {
  removeRequestHeader(req, name);

  req.headers[name.toLowerCase()] = value;
  req.rawHeaders?.push(name, value);
}

/**
 * Longest attacker-controlled value we will put in a single log field.
 */
const MAX_LOGGED_VALUE_LENGTH: number = 120;

/**
 * Make an attacker-controlled value safe to drop into a one-line log message.
 *
 * Everything the negotiation diagnostics report — header values, the JSON-RPC
 * method name — arrives from the network. Newlines would let a caller forge
 * extra log lines, and an unbounded value would let them flood the log, so
 * control characters are stripped and the result is capped.
 */
export function sanitizeForLog(value: string | undefined): string {
  if (!value) {
    return "";
  }

  // eslint-disable-next-line no-control-regex
  const flattened: string = value.replace(/[\u0000-\u001F\u007F]/g, " ");

  return flattened.length > MAX_LOGGED_VALUE_LENGTH
    ? `${flattened.slice(0, MAX_LOGGED_VALUE_LENGTH)}...(truncated)`
    : flattened;
}

/**
 * True when the POST body is (or contains) an `initialize` request.
 *
 * Version negotiation for `initialize` happens in the JSON-RPC body, where the
 * SDK already answers an unknown version with the newest one it supports. So an
 * unusable `MCP-Protocol-Version` header on an `initialize` request is dropped
 * rather than rejected: the handshake is exactly where the two sides are
 * supposed to agree on a version.
 */
export function isInitializeRequestBody(body: unknown): boolean {
  const messages: unknown[] = Array.isArray(body) ? body : [body];

  return messages.some((message: unknown) => {
    return (
      typeof message === "object" &&
      message !== null &&
      (message as { method?: unknown }).method === "initialize"
    );
  });
}
