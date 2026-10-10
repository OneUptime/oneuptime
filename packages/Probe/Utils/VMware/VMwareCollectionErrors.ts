import {
  VSphereRequestTimeoutError,
  VSphereResponseTooLargeError,
} from "./VSphereHttp";
import { VSphereFault, VSphereNotVSphereError } from "./VSphereSoapClient";
import {
  VSphereCertificateError,
  VSphereConnectTimeoutError,
} from "./VSphereTls";
import { XmlParseError } from "./VSphereXml";
import VMwareCollectionErrorCode from "Common/Types/VMware/VMwareCollectionError";
import { VMwarePresentedCertificate } from "Common/Types/VMware/VMwareProbeCollection";

/*
 * Turns whatever stopped a collection or a test into the one code the
 * dashboard acts on and the exact sentence a person reads: which host, which
 * port, which user - never the password.
 */

export interface ClassifiedVMwareError {
  code: VMwareCollectionErrorCode;
  message: string;
  presentedCertificate?: VMwarePresentedCertificate | undefined;
}

// Raised by the collector for what it decides itself.
export class VMwareCollectionError extends Error {
  public readonly code: VMwareCollectionErrorCode;

  public constructor(code: VMwareCollectionErrorCode, message: string) {
    super(message);
    this.name = "VMwareCollectionError";
    this.code = code;
  }
}

const RESOLUTION_FAILURE_PATTERN: RegExp = /could not be (resolved|reached)/i;
const TLS_FAILURE_PATTERN: RegExp = /\b(ssl|tls)\b/i;

export interface ErrorContext {
  host: string;
  port: number;
  username: string;
}

function readCode(error: unknown): string {
  const code: unknown = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

function messageOf(error: unknown): string {
  const message: unknown = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
}

export function classifyVMwareError(
  error: unknown,
  context: ErrorContext,
): ClassifiedVMwareError {
  const where: string = `${context.host}:${context.port}`;

  if (error instanceof VMwareCollectionError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof VSphereCertificateError) {
    return {
      code:
        error.kind === "changed"
          ? VMwareCollectionErrorCode.CertificateChanged
          : VMwareCollectionErrorCode.UntrustedCertificate,
      message: error.message,
      presentedCertificate: error.presentedCertificate,
    };
  }

  if (error instanceof VSphereFault) {
    switch (error.faultType) {
      case "InvalidLogin":
        return {
          code: VMwareCollectionErrorCode.InvalidLogin,
          message: `vCenter at ${where} refused the login for ${context.username}: the user name or password is wrong, or the account is locked. Use the full user name with its domain, such as oneuptime@vsphere.local.`,
        };
      case "NotAuthenticated":
        return {
          code: VMwareCollectionErrorCode.InvalidLogin,
          message: `vCenter at ${where} ended the session of ${context.username} and did not accept the login again.`,
        };
      case "NoPermission":
        return {
          code: VMwareCollectionErrorCode.NoPermission,
          message: `${context.username} may not read part of vCenter's inventory (NoPermission). Give it the Read-Only role on the top-level vCenter object, with Propagate to children ticked.`,
        };
      default:
        return {
          code: VMwareCollectionErrorCode.ApiError,
          message: `vCenter at ${where} answered with an error: ${error.message}`,
        };
    }
  }

  if (
    error instanceof VSphereNotVSphereError ||
    error instanceof XmlParseError
  ) {
    return {
      code: VMwareCollectionErrorCode.NotVSphere,
      message: `${where} is not a vSphere API: ${messageOf(error)} Enter the address of vCenter Server or a standalone ESXi host.`,
    };
  }

  if (error instanceof VSphereConnectTimeoutError) {
    return {
      code: VMwareCollectionErrorCode.ConnectionTimedOut,
      message: `The probe got no answer from ${where}: ${error.message} Allow the probe's machine to reach vCenter on TCP ${context.port}, or pick a probe in vCenter's network.`,
    };
  }

  if (error instanceof VSphereRequestTimeoutError) {
    return {
      code: VMwareCollectionErrorCode.TimedOut,
      message: `${error.message} vCenter at ${where} may be overloaded; collect less often, or check its health.`,
    };
  }

  if (error instanceof VSphereResponseTooLargeError) {
    return {
      code: VMwareCollectionErrorCode.ApiError,
      message: `vCenter at ${where} answered with more than the probe reads: ${error.message}`,
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
        code: VMwareCollectionErrorCode.AddressNotFound,
        message: `The probe cannot find ${context.host} in DNS (${code}). Check the spelling, or use vCenter's IP address.`,
      };
    case "ECONNREFUSED":
      return {
        code: VMwareCollectionErrorCode.ConnectionRefused,
        message: `${where} refused the connection: nothing listens on port ${context.port} there. vCenter serves its API on HTTPS port 443 unless it was changed.`,
      };
    case "ETIMEDOUT":
    case "ESOCKETTIMEDOUT":
      return {
        code: VMwareCollectionErrorCode.ConnectionTimedOut,
        message: `The probe got no answer from ${where} (${code}). Allow the probe's machine to reach vCenter on TCP ${context.port}, or pick a probe in vCenter's network.`,
      };
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "ECONNRESET":
    case "EPIPE":
    case "ECONNABORTED":
    case "EADDRNOTAVAIL":
      return {
        code: VMwareCollectionErrorCode.ConnectionFailed,
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
      code: VMwareCollectionErrorCode.TlsFailed,
      message: `The secure connection to ${where} failed (${code}): ${message} Check that the address points at vCenter's HTTPS port.`,
    };
  }

  // SSRFProtection's refusals, by what they say.
  if (code === "" && message.includes("vCenter address")) {
    if (RESOLUTION_FAILURE_PATTERN.test(message)) {
      return {
        code: VMwareCollectionErrorCode.AddressNotFound,
        message: `The probe cannot find ${context.host} in DNS. Check the spelling, or use vCenter's IP address.`,
      };
    }

    /*
     * The guard's own sentence says "private" too, but a vCenter's private
     * address is allowed: only the forbidden tier ever reaches here.
     */
    return {
      code: VMwareCollectionErrorCode.AddressNotAllowed,
      message: `The probe does not connect to ${context.host}: it is, or resolves to, a loopback, link-local, cloud metadata or other reserved address. Enter the address vCenter answers on in your network.`,
    };
  }

  if (TLS_FAILURE_PATTERN.test(message)) {
    return {
      code: VMwareCollectionErrorCode.TlsFailed,
      message: `The secure connection to ${where} failed: ${message}`,
    };
  }

  return {
    code: VMwareCollectionErrorCode.Internal,
    message: `The probe could not collect ${where}: ${message}`,
  };
}
