import { HttpRequestStepConfig } from "./RunbookStep";

/*
 * HOW AN HTTP REQUEST STEP CHECKS THE SERVER'S CERTIFICATE (issue #10277).
 *
 * A self-hosted OneUptime often calls services on its own network, and those
 * often answer with a certificate a private CA signed, or one the server
 * signed itself. The step refused them all: it checked the certificate
 * against the CAs Node trusts, and nothing in the step could change that.
 * Monitors have had "Allow self-signed certificates" (MonitorStep's
 * allowSelfSignedCertificates) all along. An HTTP request step has it now,
 * named the same, with a safer way beside it:
 *
 *   - CA certificate (caCertificate): the certificate, in PEM, of the CA that
 *     signed the server's certificate, or the server's own when it is
 *     self-signed. The step trusts it alone, and still checks everything
 *     else: that the server's chain ends there, the dates, and that the
 *     certificate names the URL's host. Someone between OneUptime and the
 *     server who answers in its place is still refused.
 *   - Allow self-signed certificates (allowSelfSignedCertificates): no check
 *     at all. Any certificate is taken, for any host, so anyone on the
 *     network path could read the request, its secrets included, and change
 *     the answer. On only when it is exactly true: "true" written as a string
 *     through the API never turns the checks off, and the save says so
 *     (Server/Utils/Runbook/HttpStepCaCertificate).
 *
 * With both set, the checks are off and the CA certificate is not used, as
 * the editor shows it: it hides the CA certificate while the switch is on.
 *
 * Only that step's request is sent so: the agents built for it carry the
 * setting (DataSourceEgressGuard's TargetTlsOptions), never a global agent,
 * never an outbound proxy's own connection, never
 * NODE_TLS_REJECT_UNAUTHORIZED.
 *
 * Browser-safe: the editor and the server read the same rules.
 */

export interface HttpStepCertificateSettings {
  // The checks are off: any certificate is taken, for any host.
  skipsCertificateChecks: boolean;
  /*
   * The PEM the step trusts alone, while it checks; undefined to trust the
   * CAs OneUptime trusts. Always undefined while the checks are off.
   */
  caCertificate: string | undefined;
}

// How a step's config says it checks the server's certificate.
export function getHttpStepCertificateSettings(
  config:
    | Pick<
        HttpRequestStepConfig,
        "allowSelfSignedCertificates" | "caCertificate"
      >
    | undefined
    | null,
): HttpStepCertificateSettings {
  const skipsCertificateChecks: boolean =
    config?.allowSelfSignedCertificates === true;
  const caCertificate: string =
    typeof config?.caCertificate === "string"
      ? config.caCertificate.trim()
      : "";

  return {
    skipsCertificateChecks,
    caCertificate:
      skipsCertificateChecks || !caCertificate ? undefined : caCertificate,
  };
}

// ------------------------------------------------------- the CA certificate

/*
 * The most a CA certificate may hold: a bundle of a few certificates is a
 * few kilobytes. The server parses every one each time the step runs.
 */
export const HTTP_STEP_CA_CERTIFICATE_MAX_LENGTH: number = 64 * 1024;

const PEM_CERTIFICATE_BLOCK: RegExp =
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

const PEM_PRIVATE_KEY_LINE: RegExp = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

// What is wrong with the text pasted as a CA certificate.
export enum CaCertificateProblem {
  // No certificate in PEM, or one that does not parse.
  NotACertificate = "NotACertificate",
  /*
   * A private key, which must never be stored in a step: everyone who may
   * read the runbook reads its steps.
   */
  PrivateKey = "PrivateKey",
  TooLong = "TooLong",
}

// The certificates of a PEM text, each from its BEGIN line to its END line.
export function getCaCertificateBlocks(text: string): Array<string> {
  return typeof text === "string"
    ? text.match(PEM_CERTIFICATE_BLOCK) || []
    : [];
}

/*
 * Whether the text has the shape of one or more certificates in PEM, and
 * nothing that must not be kept in a step. Empty text has no problem: the
 * step then trusts the CAs OneUptime trusts. The server also parses each
 * certificate (HttpStepCaCertificate).
 */
export function getCaCertificateShapeProblem(
  text: string | undefined | null,
): CaCertificateProblem | null {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  if (PEM_PRIVATE_KEY_LINE.test(text)) {
    return CaCertificateProblem.PrivateKey;
  }

  if (text.length > HTTP_STEP_CA_CERTIFICATE_MAX_LENGTH) {
    return CaCertificateProblem.TooLong;
  }

  return getCaCertificateBlocks(text).length > 0
    ? null
    : CaCertificateProblem.NotACertificate;
}

/*
 * Why the step was not sent, as its error says it, when its CA certificate
 * has a problem. The step's run reads the stored step, which a save checks
 * already: this is for a step saved before that check, or written around it.
 */
export const HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES: Record<
  CaCertificateProblem,
  string
> = {
  [CaCertificateProblem.NotACertificate]:
    "This step's CA certificate is not a certificate in PEM, so the request was not sent. Under the step's More fields, paste the CA's certificate, from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----.",
  [CaCertificateProblem.PrivateKey]:
    "This step's CA certificate holds a private key, so the request was not sent. Under the step's More fields, paste only the certificate, and keep the key on the server.",
  [CaCertificateProblem.TooLong]:
    "This step's CA certificate is longer than 64 KB, so the request was not sent. Under the step's More fields, paste only the certificate of the CA that signed the server's certificate.",
};

// ------------------------------------------- a certificate the step refused

/*
 * What the step's error says when the server's certificate was refused, by
 * the code Node gave the refusal. Each says what happened, that nothing was
 * sent, and what to do: the CA certificate first, the safer way, then the
 * switch that skips the checks.
 */
export const HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE: string =
  "The server's certificate is self-signed, or signed by a CA OneUptime does not trust, so the request was not sent. Under the step's More fields, paste that CA's certificate in CA certificate, or turn on Allow self-signed certificates.";

export const HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE: string =
  "The server's certificate is not signed by the step's CA certificate, so the request was not sent. Under the step's More fields, paste the certificate of the CA that signed it, or the server's own certificate when it is self-signed.";

export const HTTP_STEP_CERTIFICATE_EXPIRED_MESSAGE: string =
  "The server's certificate has expired, so the request was not sent. Renew the certificate on the server, or turn on Allow self-signed certificates under the step's More fields to skip the check.";

export const HTTP_STEP_CERTIFICATE_NOT_YET_VALID_MESSAGE: string =
  "The server's certificate is not valid yet, so the request was not sent. Check the clocks of the server and of OneUptime, or turn on Allow self-signed certificates under the step's More fields to skip the check.";

export function getHttpStepCertificateForAnotherHostMessage(
  host: string,
): string {
  return `The server's certificate is not for ${host}, so the request was not sent. Call the server by a name its certificate lists, or turn on Allow self-signed certificates under the step's More fields to skip the check.`;
}

export function getHttpStepCertificateNotVerifiedMessage(code: string): string {
  return `The server's certificate could not be verified (${code}), so the request was not sent. If you trust this server, turn on Allow self-signed certificates under the step's More fields to skip the check.`;
}

/*
 * A certificate refused while the step checks none of the server's: the
 * only certificate checked then is an https:// outbound proxy's, which the
 * switch never loosens.
 */
export function getHttpStepProxyCertificateMessage(code: string): string {
  return `The outbound proxy's certificate could not be verified (${code}), so the request was not sent. Allow self-signed certificates skips the checks of the step's server, never the proxy's: ask whoever runs this OneUptime server to check the proxy set in HTTPS_PROXY or ALL_PROXY.`;
}

/*
 * The codes of a certificate nobody the step trusts signed: one the server
 * signed itself, or one whose chain ends at a CA the step does not trust.
 */
export const UNTRUSTED_CERTIFICATE_CODES: ReadonlyArray<string> = [
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "CERT_UNTRUSTED",
];

// A certificate refused for its dates.
export const DATED_CERTIFICATE_CODES: ReadonlyArray<string> = [
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
];

// Any other refusal of a certificate, as OpenSSL and Node name them.
export const UNVERIFIED_CERTIFICATE_CODES: ReadonlyArray<string> = [
  "CERT_SIGNATURE_FAILURE",
  "CERT_REVOKED",
  "CERT_REJECTED",
  "CERT_CHAIN_TOO_LONG",
  "INVALID_CA",
  "INVALID_PURPOSE",
  "PATH_LENGTH_EXCEEDED",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
  "ERR_TLS_CERT_ALTNAME_FORMAT",
];

/*
 * What the step's error says when the server's certificate was refused with
 * `code`, or null when `code` is no refusal of a certificate (a refused
 * connection, a timeout), which keeps the error it came with. `host` is the
 * host name the step's URL names.
 */
export function getHttpStepCertificateFailureMessage(data: {
  code: string | undefined | null;
  host: string;
  settings: HttpStepCertificateSettings;
}): string | null {
  const code: string = data.code || "";

  if (
    data.settings.skipsCertificateChecks &&
    (UNTRUSTED_CERTIFICATE_CODES.includes(code) ||
      UNVERIFIED_CERTIFICATE_CODES.includes(code) ||
      DATED_CERTIFICATE_CODES.includes(code) ||
      code === "ERR_TLS_CERT_ALTNAME_INVALID")
  ) {
    return getHttpStepProxyCertificateMessage(code);
  }

  if (UNTRUSTED_CERTIFICATE_CODES.includes(code)) {
    return data.settings.caCertificate
      ? HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE
      : HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE;
  }

  if (code === "CERT_HAS_EXPIRED") {
    return HTTP_STEP_CERTIFICATE_EXPIRED_MESSAGE;
  }

  if (code === "CERT_NOT_YET_VALID") {
    return HTTP_STEP_CERTIFICATE_NOT_YET_VALID_MESSAGE;
  }

  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return getHttpStepCertificateForAnotherHostMessage(data.host);
  }

  if (UNVERIFIED_CERTIFICATE_CODES.includes(code)) {
    return getHttpStepCertificateNotVerifiedMessage(code);
  }

  return null;
}
