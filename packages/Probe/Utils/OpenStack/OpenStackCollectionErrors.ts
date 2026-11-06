import {
  OpenStackEndpointRefusedError,
  OpenStackRequestTimeoutError,
  OpenStackResponseTooLargeError,
} from "./OpenStackHttp";
import {
  OpenStackCertificateError,
  OpenStackConnectTimeoutError,
} from "./OpenStackTls";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import { OpenStackPresentedCertificate } from "Common/Types/OpenStack/OpenStackProbeCollection";

/*
 * Turns whatever stopped a read, a login or a collection into the one code the
 * dashboard acts on and the exact sentence a person reads: which host, which port,
 * which service. Never the secret, and never a token.
 */

export interface ClassifiedOpenStackError {
  code: OpenStackCollectionErrorCode;
  message: string;
  presentedCertificate?: OpenStackPresentedCertificate | undefined;
}

// Raised by the collector for what it decides itself.
export class OpenStackCollectionError extends Error {
  public readonly code: OpenStackCollectionErrorCode;

  public constructor(code: OpenStackCollectionErrorCode, message: string) {
    super(message);
    this.name = "OpenStackCollectionError";
    this.code = code;
  }
}

/*
 * What an API said, in the probe's terms.
 *
 *   refused     401, 403 or 409: this credential may not read this. Not a failure of
 *               the API, and no reason to ask less often.
 *   absent      404: this cloud has no such route.
 *   overloaded  429 or 503 (502, 504): it said to stop asking for a while.
 *   failing     any other error it answered with.
 *   malformed   a 200 that was not what this API sends.
 */
export type OpenStackApiErrorKind =
  | "refused"
  | "absent"
  | "overloaded"
  | "failing"
  | "malformed";

export class OpenStackApiError extends Error {
  public readonly kind: OpenStackApiErrorKind;
  public readonly status: number;
  public readonly url: string;

  public constructor(data: {
    kind: OpenStackApiErrorKind;
    status: number;
    url: string;
    message: string;
  }) {
    super(data.message);
    this.name = "OpenStackApiError";
    this.kind = data.kind;
    this.status = data.status;
    this.url = data.url;
  }
}

// The collection's time ran out before this request could be made or finished.
export class OpenStackBudgetExceededError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OpenStackBudgetExceededError";
  }
}

const RESOLUTION_FAILURE_PATTERN: RegExp = /could not be (resolved|reached)/i;
const TLS_FAILURE_PATTERN: RegExp = /\b(ssl|tls)\b/i;

export interface OpenStackErrorContext {
  host: string;
  port: number;
}

function readCode(error: unknown): string {
  const code: unknown = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

function messageOf(error: unknown): string {
  const message: unknown = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
}

export function classifyOpenStackError(
  error: unknown,
  context: OpenStackErrorContext,
): ClassifiedOpenStackError {
  const where: string = `${context.host}:${context.port}`;

  if (error instanceof OpenStackCollectionError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof OpenStackCertificateError) {
    return {
      code:
        error.kind === "changed"
          ? OpenStackCollectionErrorCode.CertificateChanged
          : OpenStackCollectionErrorCode.UntrustedCertificate,
      message: error.message,
      presentedCertificate: error.presentedCertificate,
    };
  }

  if (error instanceof OpenStackEndpointRefusedError) {
    return {
      code:
        error.kind === "forbidden"
          ? OpenStackCollectionErrorCode.AddressNotAllowed
          : error.kind === "insecure"
            ? OpenStackCollectionErrorCode.InsecureEndpoint
            : OpenStackCollectionErrorCode.InvalidAddress,
      message: error.message,
    };
  }

  if (error instanceof OpenStackApiError) {
    switch (error.kind) {
      case "refused":
        return {
          code: OpenStackCollectionErrorCode.NoPermission,
          message: error.message,
        };
      case "overloaded":
        return {
          code: OpenStackCollectionErrorCode.ServiceOverloaded,
          message: error.message,
        };
      default:
        return {
          code: OpenStackCollectionErrorCode.ApiError,
          message: error.message,
        };
    }
  }

  if (error instanceof OpenStackBudgetExceededError) {
    return {
      code: OpenStackCollectionErrorCode.TimedOut,
      message: error.message,
    };
  }

  if (error instanceof OpenStackConnectTimeoutError) {
    return {
      code: OpenStackCollectionErrorCode.ConnectionTimedOut,
      message: `The probe got no answer from ${where}: ${error.message} Allow the probe's machine to reach it on TCP ${context.port}, or pick a probe in the cloud's network.`,
    };
  }

  if (error instanceof OpenStackRequestTimeoutError) {
    return {
      code: OpenStackCollectionErrorCode.TimedOut,
      message: `${error.message} It may be overloaded. Collect less often, or check its health.`,
    };
  }

  if (error instanceof OpenStackResponseTooLargeError) {
    return {
      code: OpenStackCollectionErrorCode.ApiError,
      message: error.message,
    };
  }

  const code: string = readCode(error);
  const message: string = messageOf(error);

  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "EAI_NONAME":
    case "EAI_NODATA":
      return {
        code: OpenStackCollectionErrorCode.AddressNotFound,
        message: `The probe cannot find ${context.host} in DNS (${code}). Check the spelling, or use an IP address.`,
      };
    case "ECONNREFUSED":
      return {
        code: OpenStackCollectionErrorCode.ConnectionRefused,
        message: `${where} refused the connection: nothing listens on port ${context.port} there.`,
      };
    case "ETIMEDOUT":
    case "ESOCKETTIMEDOUT":
      return {
        code: OpenStackCollectionErrorCode.ConnectionTimedOut,
        message: `The probe got no answer from ${where} (${code}). Allow the probe's machine to reach it on TCP ${context.port}, or pick a probe in the cloud's network.`,
      };
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "ECONNRESET":
    case "EPIPE":
    case "ECONNABORTED":
    case "EADDRNOTAVAIL":
      return {
        code: OpenStackCollectionErrorCode.ConnectionFailed,
        message: `The probe could not connect to ${where} (${code}): ${message}`,
      };
    default:
      break;
  }

  if (
    code === "EPROTO" ||
    code.startsWith("ERR_SSL") ||
    code.startsWith("ERR_TLS")
  ) {
    return {
      code: OpenStackCollectionErrorCode.TlsFailed,
      message: `The secure connection to ${where} failed (${code}): ${message} Check that the address points at an HTTPS port.`,
    };
  }

  // SSRFProtection's refusals, by what they say.
  if (code === "" && message.includes("OpenStack address")) {
    if (RESOLUTION_FAILURE_PATTERN.test(message)) {
      return {
        code: OpenStackCollectionErrorCode.AddressNotFound,
        message: `The probe cannot find ${context.host} in DNS. Check the spelling, or use an IP address.`,
      };
    }

    /*
     * The guard's own sentence says "private" too, but a cloud's private address is
     * allowed, so only the forbidden tier ever reaches here.
     */
    return {
      code: OpenStackCollectionErrorCode.AddressNotAllowed,
      message: `The probe does not connect to ${context.host}: it is, or resolves to, a loopback, link-local, cloud metadata or other reserved address. Use the address the API answers on in your network.`,
    };
  }

  if (TLS_FAILURE_PATTERN.test(message)) {
    return {
      code: OpenStackCollectionErrorCode.TlsFailed,
      message: `The secure connection to ${where} failed: ${message}`,
    };
  }

  return {
    code: OpenStackCollectionErrorCode.Internal,
    message: `The probe could not read ${where}: ${message}`,
  };
}

/*
 * Whether the failure says the API was reached at all. A connection that never
 * opened is the same as the agent's scrape failing: `up` reads 0.
 */
export function isNoAnswer(error: unknown): boolean {
  if (error instanceof OpenStackApiError) {
    return false;
  }

  return true;
}

/*
 * What an error answer says, in its own words. Every OpenStack service words this
 * differently: {"error":{"message"}}, {"NeutronError":{"message"}},
 * {"forbidden":{"message"}}, {"errors":[{"detail"}]}. A proxy answers with a page of
 * HTML, which says nothing a person needs. Exported for tests.
 */
export function readErrorMessage(body: string): string | null {
  const MAX_LENGTH: number = 300;

  if (!body || body.length > 1024 * 1024) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const shorten: (text: string) => string = (text: string): string => {
    const trimmed: string = text.trim();
    return trimmed.length > MAX_LENGTH
      ? `${trimmed.substring(0, MAX_LENGTH - 1)}…`
      : trimmed;
  };

  const record: Record<string, unknown> = parsed as Record<string, unknown>;

  const errors: unknown = record["errors"];

  if (Array.isArray(errors) && errors[0] && typeof errors[0] === "object") {
    const detail: unknown = (errors[0] as Record<string, unknown>)["detail"];

    if (typeof detail === "string" && detail.trim()) {
      return shorten(detail);
    }
  }

  if (typeof record["message"] === "string" && record["message"].trim()) {
    return shorten(record["message"]);
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const message: unknown = (value as Record<string, unknown>)["message"];

      if (typeof message === "string" && message.trim()) {
        return shorten(message);
      }
    }
  }

  return null;
}
