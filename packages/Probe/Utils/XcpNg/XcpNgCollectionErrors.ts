import {
  VSphereRequestTimeoutError,
  VSphereResponseTooLargeError,
} from "../VMware/VSphereHttp";
import {
  VSphereCertificateError,
  VSphereConnectTimeoutError,
} from "../VMware/VSphereTls";
import XcpNgCollectionErrorCode from "Common/Types/XcpNg/XcpNgCollectionError";
import { XcpNgPresentedCertificate } from "Common/Types/XcpNg/XcpNgProbeCollection";
import VMwareCertificateFingerprint from "Common/Utils/VMware/VMwareCertificateFingerprint";

/*
 * Turns whatever stopped a read or a test of an XCP-ng connection into the
 * one code the dashboard acts on and the exact sentence a person reads:
 * which address, which port, which account - never a secret.
 *
 * The TLS socket and the HTTP transport are the vCenter collection's
 * (VSphereTls, VSphereHttp): one certificate check for every probe
 * collection. Their own sentences speak of vCenter, so the ones that reach
 * here are written again in the words of what was connected.
 */

export interface ClassifiedXcpNgError {
  code: XcpNgCollectionErrorCode;
  message: string;
  presentedCertificate?: XcpNgPresentedCertificate | undefined;
}

// Raised by the collectors for what they decide themselves.
export class XcpNgCollectionError extends Error {
  public readonly code: XcpNgCollectionErrorCode;
  public readonly presentedCertificate: XcpNgPresentedCertificate | undefined;

  public constructor(
    code: XcpNgCollectionErrorCode,
    message: string,
    presentedCertificate?: XcpNgPresentedCertificate | undefined,
  ) {
    super(message);
    this.name = "XcpNgCollectionError";
    this.code = code;
    this.presentedCertificate = presentedCertificate;
  }
}

export interface XcpNgErrorContext {
  host: string;
  port: number;
  // "Xen Orchestra" or "the pool master": what the address is.
  what: string;
  // The SSRF guard's label for the address, which its refusals start with.
  addressLabel: string;
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

// The certificate sentence, in the words of what was connected.
export function describeCertificateRefusal(data: {
  kind: "untrusted" | "changed";
  presented: XcpNgPresentedCertificate;
  where: string;
  what: string;
  trustedFingerprint?: string | null | undefined;
}): string {
  if (data.kind === "changed") {
    const trusted: string | null = VMwareCertificateFingerprint.normalize(
      data.trustedFingerprint,
    );

    return `${data.where} presented a different certificate from the one trusted for it (SHA-256 ${data.presented.fingerprint256}${
      trusted ? `, trusted ${trusted}` : ""
    }). Nothing was sent. If ${data.what}'s certificate was renewed, check the new fingerprint and trust it.`;
  }

  return `${data.where}'s certificate is not trusted by the probe (${
    data.presented.verificationError || "verification failed"
  }). Issued to ${data.presented.subject || "an unnamed subject"} by ${
    data.presented.issuer || "an unnamed issuer"
  }, SHA-256 ${data.presented.fingerprint256}. Nothing was sent. Check this fingerprint against ${data.what}'s certificate and trust it.`;
}

export function classifyXcpNgError(
  error: unknown,
  context: XcpNgErrorContext,
  trustedFingerprint?: string | null | undefined,
): ClassifiedXcpNgError {
  const where: string = `${context.host}:${context.port}`;

  if (error instanceof XcpNgCollectionError) {
    return {
      code: error.code,
      message: error.message,
      presentedCertificate: error.presentedCertificate,
    };
  }

  if (error instanceof VSphereCertificateError) {
    return {
      code:
        error.kind === "changed"
          ? XcpNgCollectionErrorCode.CertificateChanged
          : XcpNgCollectionErrorCode.UntrustedCertificate,
      message: describeCertificateRefusal({
        kind: error.kind,
        presented: error.presentedCertificate,
        where: where,
        what: context.what,
        trustedFingerprint: trustedFingerprint,
      }),
      presentedCertificate: error.presentedCertificate,
    };
  }

  if (error instanceof VSphereConnectTimeoutError) {
    return {
      code: XcpNgCollectionErrorCode.ConnectionTimedOut,
      message: `The probe got no answer from ${where}: it did not complete a TLS connection in time. Allow the probe's machine to reach ${context.what} on TCP ${context.port}, or pick a probe in its network.`,
    };
  }

  if (error instanceof VSphereRequestTimeoutError) {
    return {
      code: XcpNgCollectionErrorCode.TimedOut,
      message: `${context.what} at ${where} did not answer in time. It may be overloaded; collect less often, or check its health.`,
    };
  }

  if (error instanceof VSphereResponseTooLargeError) {
    return {
      code: XcpNgCollectionErrorCode.PayloadTooLarge,
      message: `${context.what} at ${where} answered with more than one probe reads at once. Use the XCP-ng Agent for it.`,
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
        code: XcpNgCollectionErrorCode.AddressNotFound,
        message: `The probe cannot find ${context.host} in DNS (${code}). Check the spelling, or use its IP address.`,
      };
    case "ECONNREFUSED":
      return {
        code: XcpNgCollectionErrorCode.ConnectionRefused,
        message: `${where} refused the connection: nothing listens on port ${context.port} there. ${context.what} serves HTTPS on port 443 unless it was changed.`,
      };
    case "ETIMEDOUT":
    case "ESOCKETTIMEDOUT":
      return {
        code: XcpNgCollectionErrorCode.ConnectionTimedOut,
        message: `The probe got no answer from ${where} (${code}). Allow the probe's machine to reach ${context.what} on TCP ${context.port}, or pick a probe in its network.`,
      };
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "ECONNRESET":
    case "EPIPE":
    case "ECONNABORTED":
    case "EADDRNOTAVAIL":
      return {
        code: XcpNgCollectionErrorCode.ConnectionFailed,
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
      code: XcpNgCollectionErrorCode.TlsFailed,
      message: `The secure connection to ${where} failed (${code}): ${message} Check that the address points at an HTTPS port.`,
    };
  }

  // SSRFProtection's refusals, by the label they start with.
  if (code === "" && message.includes(context.addressLabel)) {
    if (RESOLUTION_FAILURE_PATTERN.test(message)) {
      return {
        code: XcpNgCollectionErrorCode.AddressNotFound,
        message: `The probe cannot find ${context.host} in DNS. Check the spelling, or use its IP address.`,
      };
    }

    /*
     * The guard's own sentence says "private" too, but a private address is
     * allowed here: only the forbidden tier ever reaches this.
     */
    return {
      code: XcpNgCollectionErrorCode.AddressNotAllowed,
      message: `The probe does not connect to ${context.host}: it is, or resolves to, a loopback, link-local, cloud metadata or other reserved address. Enter the address ${context.what} answers on in your network.`,
    };
  }

  if (TLS_FAILURE_PATTERN.test(message)) {
    return {
      code: XcpNgCollectionErrorCode.TlsFailed,
      message: `The secure connection to ${where} failed: ${message}`,
    };
  }

  return {
    code: XcpNgCollectionErrorCode.Internal,
    message: `The probe could not read ${where}: ${message}`,
  };
}
