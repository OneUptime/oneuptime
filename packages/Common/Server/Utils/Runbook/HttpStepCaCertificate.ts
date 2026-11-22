import crypto from "crypto";
import {
  CaCertificatePemProblem,
  CaCertificateProblem,
  HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES,
  HttpStepCertificateSettings,
  getCaCertificateBlocks,
  getCaCertificatePemShapeProblem,
  getCaCertificateShapeProblem,
  getHttpStepCaCertificateVariableProblemMessage,
} from "../../../Types/Runbook/HttpStepCertificates";
import {
  RunbookVariableReference,
  parseSingleRunbookVariableReference,
} from "../../../Types/Runbook/RunbookVariableReference";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";

/*
 * AN HTTP REQUEST STEP'S CERTIFICATE SETTINGS, AS THE SERVER READS THEM
 * (issue #10277; the rules are Types/Runbook/HttpStepCertificates).
 *
 * The editor checks a CA certificate's shape as it is typed. The server
 * parses it too, certificate by certificate: Node takes text that is not a
 * certificate as a CA without a word, and the step would then fail on a
 * certificate it was meant to trust, with nothing to say why. So a save of
 * steps through the API, Terraform or the editor is refused when an HTTP
 * request step's CA certificate is not one or is too long, or names a
 * runbook variable beside other text, while the step checks certificates -
 * and when it holds a private key, always - and when
 * allowSelfSignedCertificates is anything but true or false, since a step
 * reads only true as on. The step's run checks again, for a step stored
 * before this check.
 *
 * A CA certificate that is one runbook variable alone (#10441) is taken as
 * it is: a runbook may be written before its variables, by the API or
 * Terraform, as a step's other references are. The step's run parses the
 * variable's value, once it is filled in (getHttpStepCaCertificateRunRefusal).
 */

// The first certificate of a PEM text that does not parse, said so; or null.
function getParseProblem(
  text: string,
): CaCertificateProblem.NotACertificate | null {
  for (const certificate of getCaCertificateBlocks(text)) {
    try {
      new crypto.X509Certificate(certificate);
    } catch {
      return CaCertificateProblem.NotACertificate;
    }
  }

  return null;
}

/*
 * What is wrong with what a step's CA certificate holds as written, or
 * null: certificates in PEM, each parsed, or one runbook variable alone,
 * whose value is checked when the step runs (getCaCertificatePemProblem).
 */
export function getCaCertificateProblem(
  text: string | undefined | null,
): CaCertificateProblem | null {
  const shapeProblem: CaCertificateProblem | null =
    getCaCertificateShapeProblem(text);

  if (
    shapeProblem ||
    typeof text !== "string" ||
    !text.trim() ||
    parseSingleRunbookVariableReference(text)
  ) {
    return shapeProblem;
  }

  return getParseProblem(text);
}

/*
 * What is wrong with the certificates a step trusts as it runs - the value
 * of the variable its CA certificate names - or null: certificates in PEM,
 * each parsed. Empty is no certificate, and a reference in a value is text,
 * never read again.
 */
export function getCaCertificatePemProblem(
  pem: string | undefined | null,
): CaCertificatePemProblem | null {
  return (
    getCaCertificatePemShapeProblem(pem) ||
    getParseProblem(typeof pem === "string" ? pem : "")
  );
}

/*
 * Why an HTTP request step is not sent for the CA certificate it would
 * trust, or null - asked as it runs, its variables filled in, before
 * anything is sent:
 *
 *   - when its CA certificate names a variable, the variable's value must be
 *     certificates in PEM, and the error names the variable, never its
 *     value, and says where to change it;
 *   - when it holds the certificate itself, as a save checks it: for a step
 *     stored before that check, or written around it.
 */
export function getHttpStepCaCertificateRunRefusal(data: {
  // How the step checks certificates, read with its variables filled in.
  settings: HttpStepCertificateSettings;
  // The variable its stored CA certificate names (getHttpStepCaCertificateVariable).
  variable: RunbookVariableReference | null;
}): string | null {
  if (data.settings.skipsCertificateChecks) {
    return null;
  }

  if (data.variable) {
    const problem: CaCertificatePemProblem | null = getCaCertificatePemProblem(
      data.settings.caCertificate,
    );

    return problem
      ? getHttpStepCaCertificateVariableProblemMessage({
          problem,
          reference: data.variable,
        })
      : null;
  }

  if (!data.settings.caCertificate) {
    return null;
  }

  const problem: CaCertificateProblem | null = getCaCertificateProblem(
    data.settings.caCertificate,
  );

  return problem ? HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES[problem] : null;
}

// What a save that sets these is told, after the step's name.
export const ALLOW_SELF_SIGNED_CERTIFICATES_NOT_TRUE_OR_FALSE_MESSAGE: string =
  "sets allowSelfSignedCertificates to something other than true or false. Set it to true to skip the server's certificate checks, or to false to keep them.";

export const CA_CERTIFICATE_NOT_TEXT_MESSAGE: string =
  "has a caCertificate that is not text. Set it to the CA's certificate in PEM, or leave it out.";

export const CA_CERTIFICATE_SAVE_MESSAGES: Record<
  CaCertificateProblem,
  string
> = {
  [CaCertificateProblem.NotACertificate]:
    "has a CA certificate that is not a certificate in PEM. Paste the CA's certificate, from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----.",
  [CaCertificateProblem.PrivateKey]:
    "has a private key in its CA certificate, where everyone who may read this runbook could read it. Paste only the certificate, and keep the key on the server.",
  [CaCertificateProblem.TooLong]:
    "has a CA certificate longer than 64 KB. Paste only the certificate of the CA that signed the server's certificate.",
  [CaCertificateProblem.VariableAmongText]:
    "has a CA certificate that names a runbook variable beside other text. Write only the variable that holds the certificate, such as {{global.variables.INTERNAL_CA}}, or paste only the certificate.",
};

// A step as a refusal names it: its title, or else its type.
function nameOf(step: Record<string, unknown>): string {
  const title: unknown = step["title"];

  return typeof title === "string" && title.trim()
    ? `"${title.trim().slice(0, 80)}"`
    : `of type ${String(step["type"])}`;
}

/*
 * Why `steps` may not be saved because an HTTP request step's certificate
 * settings are not ones it can run with, or null. Reads only what the steps
 * hold: nothing else is asked - not whether a variable a CA certificate
 * names exists, which the step's run asks.
 */
export function getHttpStepCertificateSaveRefusal(
  steps: unknown,
): string | null {
  for (const step of Array.isArray(steps) ? steps : []) {
    if (!step || typeof step !== "object") {
      continue;
    }

    const values: Record<string, unknown> = step as Record<string, unknown>;
    const config: unknown = values["config"];

    if (
      values["type"] !== RunbookStepType.HttpRequest ||
      !config ||
      typeof config !== "object"
    ) {
      continue;
    }

    const allowSelfSigned: unknown = (config as Record<string, unknown>)[
      "allowSelfSignedCertificates"
    ];

    if (
      allowSelfSigned !== undefined &&
      allowSelfSigned !== null &&
      typeof allowSelfSigned !== "boolean"
    ) {
      return `The step ${nameOf(values)} ${ALLOW_SELF_SIGNED_CERTIFICATES_NOT_TRUE_OR_FALSE_MESSAGE}`;
    }

    const caCertificate: unknown = (config as Record<string, unknown>)[
      "caCertificate"
    ];

    if (caCertificate === undefined || caCertificate === null) {
      continue;
    }

    if (typeof caCertificate !== "string") {
      return `The step ${nameOf(values)} ${CA_CERTIFICATE_NOT_TEXT_MESSAGE}`;
    }

    const problem: CaCertificateProblem | null =
      getCaCertificateProblem(caCertificate);

    /*
     * While the checks are off the CA certificate is not used, and the
     * editor hides it, so only what must never be kept in a step is
     * refused then: a private key.
     */
    if (
      problem === CaCertificateProblem.PrivateKey ||
      (problem && allowSelfSigned !== true)
    ) {
      return `The step ${nameOf(values)} ${CA_CERTIFICATE_SAVE_MESSAGES[problem]}`;
    }
  }

  return null;
}
