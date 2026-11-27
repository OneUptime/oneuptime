import {
  VSphereRequestTimeoutError,
  VSphereResponseTooLargeError,
} from "../VMware/VSphereHttp";
import {
  VSphereCertificateError,
  VSphereConnectTimeoutError,
} from "../VMware/VSphereTls";
import StorageArrayCollectionErrorCode from "Common/Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import { StorageArrayPresentedCertificate } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";

/*
 * Turns whatever stopped a storage array collection or test (#11004) into
 * the one code the dashboard acts on and the exact sentence a person reads:
 * which server, which port, which user - never the password. The shape of
 * VMware's (VMwareCollectionErrors), over the same transport.
 */

export interface ClassifiedStorageArrayError {
  code: StorageArrayCollectionErrorCode;
  message: string;
  presentedCertificate?: StorageArrayPresentedCertificate | undefined;
}

// Raised by a poller for what it decides itself.
export class StorageArrayCollectionError extends Error {
  public readonly code: StorageArrayCollectionErrorCode;

  public constructor(code: StorageArrayCollectionErrorCode, message: string) {
    super(message);
    this.name = "StorageArrayCollectionError";
    this.code = code;
  }
}

export interface StorageArrayErrorContext {
  host: string;
  port: number;
  username: string;
  // "Unisphere": how a sentence names the server.
  serverName: string;
}

const RESOLUTION_FAILURE_PATTERN: RegExp = /could not be (resolved|reached)/i;
const TLS_FAILURE_PATTERN: RegExp = /\b(ssl|tls)\b/i;

function readCode(error: unknown): string {
  const code: unknown = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

function messageOf(error: unknown): string {
  const message: unknown = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
}

export function classifyStorageArrayError(
  error: unknown,
  context: StorageArrayErrorContext,
): ClassifiedStorageArrayError {
  const where: string = `${context.host}:${context.port}`;
  const server: string = context.serverName;

  if (error instanceof StorageArrayCollectionError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof VSphereCertificateError) {
    return {
      code:
        error.kind === "changed"
          ? StorageArrayCollectionErrorCode.CertificateChanged
          : StorageArrayCollectionErrorCode.UntrustedCertificate,
      message: error.message.replace(/vCenter/g, server),
      presentedCertificate: error.presentedCertificate,
    };
  }

  if (error instanceof VSphereConnectTimeoutError) {
    return {
      code: StorageArrayCollectionErrorCode.ConnectionTimedOut,
      message: `The probe got no answer from ${where}. Allow the probe's machine to reach ${server} on TCP ${context.port}, or pick a probe in ${server}'s network.`,
    };
  }

  if (error instanceof VSphereRequestTimeoutError) {
    return {
      code: StorageArrayCollectionErrorCode.TimedOut,
      message: `${server} at ${where} did not answer in time (${messageOf(error).replace(/vSphere/g, server)}). It may be overloaded: read it every 10 minutes, or check its health.`,
    };
  }

  if (error instanceof VSphereResponseTooLargeError) {
    return {
      code: StorageArrayCollectionErrorCode.ApiError,
      message: `${server} at ${where} answered with more than the probe reads (${messageOf(error).replace(/vSphere/g, server)}).`,
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
        code: StorageArrayCollectionErrorCode.AddressNotFound,
        message: `The probe cannot find ${context.host} in DNS (${code}). Check the spelling, or use ${server}'s IP address.`,
      };
    case "ECONNREFUSED":
      return {
        code: StorageArrayCollectionErrorCode.ConnectionRefused,
        message: `${where} refused the connection: nothing listens on port ${context.port} there. Check the port ${server} serves its REST API on.`,
      };
    case "ETIMEDOUT":
    case "ESOCKETTIMEDOUT":
      return {
        code: StorageArrayCollectionErrorCode.ConnectionTimedOut,
        message: `The probe got no answer from ${where} (${code}). Allow the probe's machine to reach ${server} on TCP ${context.port}, or pick a probe in ${server}'s network.`,
      };
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "ECONNRESET":
    case "EPIPE":
    case "ECONNABORTED":
    case "EADDRNOTAVAIL":
      return {
        code: StorageArrayCollectionErrorCode.ConnectionFailed,
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
      code: StorageArrayCollectionErrorCode.TlsFailed,
      message: `The secure connection to ${where} failed (${code}): ${message} Check that the address points at ${server}'s HTTPS port.`,
    };
  }

  // SSRFProtection's refusals, by what they say.
  if (code === "" && message.includes("storage server address")) {
    if (RESOLUTION_FAILURE_PATTERN.test(message)) {
      return {
        code: StorageArrayCollectionErrorCode.AddressNotFound,
        message: `The probe cannot find ${context.host} in DNS. Check the spelling, or use ${server}'s IP address.`,
      };
    }
    return {
      code: StorageArrayCollectionErrorCode.AddressNotAllowed,
      message: `The probe does not connect to ${context.host}: it is, or resolves to, a loopback, link-local, cloud metadata or other reserved address. Enter the address ${server} answers on in your network.`,
    };
  }

  if (TLS_FAILURE_PATTERN.test(message)) {
    return {
      code: StorageArrayCollectionErrorCode.TlsFailed,
      message: `The secure connection to ${where} failed: ${message}`,
    };
  }

  return {
    code: StorageArrayCollectionErrorCode.Internal,
    message: `The probe hit an unexpected error: ${message}`,
  };
}
