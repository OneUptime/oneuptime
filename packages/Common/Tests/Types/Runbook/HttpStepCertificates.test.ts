import {
  CaCertificateProblem,
  DATED_CERTIFICATE_CODES,
  HTTP_STEP_CA_CERTIFICATE_MAX_LENGTH,
  HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES,
  HTTP_STEP_CERTIFICATE_EXPIRED_MESSAGE,
  HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE,
  HTTP_STEP_CERTIFICATE_NOT_YET_VALID_MESSAGE,
  HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE,
  HttpStepCertificateSettings,
  UNTRUSTED_CERTIFICATE_CODES,
  UNVERIFIED_CERTIFICATE_CODES,
  getCaCertificateBlocks,
  getCaCertificateShapeProblem,
  getHttpStepCertificateFailureMessage,
  getHttpStepCertificateForAnotherHostMessage,
  getHttpStepCertificateNotVerifiedMessage,
  getHttpStepCertificateSettings,
  getHttpStepProxyCertificateMessage,
} from "../../../Types/Runbook/HttpStepCertificates";
import { HttpRequestStepConfig } from "../../../Types/Runbook/RunbookStep";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW AN HTTP REQUEST STEP CHECKS THE SERVER'S CERTIFICATE (issue #10277):
 * the rules the editor and the server share. How a step's config is read
 * (the switch on only when exactly true, the CA certificate used only while
 * the step checks), what a CA certificate may hold, and what the step says
 * when a certificate is refused - each refusal pointing at what in the step
 * lets it through.
 */

// The shape of a certificate in PEM; the server parses the real ones.
const CERTIFICATE: string = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBszCCAVmgAwIBAgIUQ2VydGlmaWNhdGUgc2hhcGUgb25seQ==",
  "-----END CERTIFICATE-----",
].join("\n");

const OTHER_CERTIFICATE: string = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBtDCCAVqgAwIBAgIUQW5vdGhlciBjZXJ0aWZpY2F0ZQ==",
  "-----END CERTIFICATE-----",
].join("\n");

// A step's config as stored: any value, as the API or Terraform may write it.
function settings(
  config: Record<string, unknown>,
): HttpStepCertificateSettings {
  return getHttpStepCertificateSettings(
    config as unknown as HttpRequestStepConfig,
  );
}

const CHECKS: HttpStepCertificateSettings = {
  skipsCertificateChecks: false,
  caCertificate: undefined,
};

const CHECKS_WITH_CA: HttpStepCertificateSettings = {
  skipsCertificateChecks: false,
  caCertificate: CERTIFICATE,
};

const SKIPS: HttpStepCertificateSettings = {
  skipsCertificateChecks: true,
  caCertificate: undefined,
};

describe("how a step's config is read", () => {
  test("a step with neither checks the certificate against the CAs OneUptime trusts", () => {
    expect(settings({})).toEqual(CHECKS);
    expect(getHttpStepCertificateSettings(undefined)).toEqual(CHECKS);
    expect(getHttpStepCertificateSettings(null)).toEqual(CHECKS);
  });

  test("the switch skips the checks only when it is exactly true", () => {
    expect(settings({ allowSelfSignedCertificates: true })).toEqual(SKIPS);

    for (const value of [false, "true", "yes", 1, {}, [], null]) {
      expect({
        value,
        skips: settings({ allowSelfSignedCertificates: value })
          .skipsCertificateChecks,
      }).toEqual({ value, skips: false });
    }
  });

  test("a CA certificate is used, trimmed, while the step checks", () => {
    expect(settings({ caCertificate: `\n  ${CERTIFICATE}\n\n` })).toEqual(
      CHECKS_WITH_CA,
    );
  });

  test("a CA certificate of nothing but spaces is none", () => {
    expect(settings({ caCertificate: "  \n\t " })).toEqual(CHECKS);
    expect(settings({ caCertificate: 42 })).toEqual(CHECKS);
  });

  test("with the switch on, the checks are off and the CA certificate is not used", () => {
    expect(
      settings({
        allowSelfSignedCertificates: true,
        caCertificate: CERTIFICATE,
      }),
    ).toEqual(SKIPS);
  });
});

describe("what a CA certificate may hold", () => {
  test("empty is no problem: the step trusts the CAs OneUptime trusts", () => {
    for (const text of ["", "   ", undefined, null]) {
      expect(getCaCertificateShapeProblem(text)).toBeNull();
    }
  });

  test("one certificate in PEM, or a bundle of them, is taken", () => {
    expect(getCaCertificateShapeProblem(CERTIFICATE)).toBeNull();
    expect(
      getCaCertificateShapeProblem(`${CERTIFICATE}\n${OTHER_CERTIFICATE}\n`),
    ).toBeNull();
    // openssl writes a subject line before each certificate of a bundle.
    expect(
      getCaCertificateShapeProblem(
        `subject=CN=Root\n${CERTIFICATE}\nsubject=CN=Intermediate\n${OTHER_CERTIFICATE}`,
      ),
    ).toBeNull();
  });

  test.each([
    ["text", "hello"],
    [
      "a certificate's BEGIN line with no END",
      "-----BEGIN CERTIFICATE-----\nabc",
    ],
    [
      "a public key",
      "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----",
    ],
    [
      "an SSH host key",
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
    ],
  ])("%s is not a certificate", (_what: string, text: string) => {
    expect(getCaCertificateShapeProblem(text)).toBe(
      CaCertificateProblem.NotACertificate,
    );
  });

  test.each([
    ["PRIVATE KEY"],
    ["RSA PRIVATE KEY"],
    ["EC PRIVATE KEY"],
    ["ENCRYPTED PRIVATE KEY"],
    ["OPENSSH PRIVATE KEY"],
  ])("a %s is refused, alone or beside a certificate", (kind: string) => {
    const key: string = `-----BEGIN ${kind}-----\nMIGHAgEAMBMGByqGSM49\n-----END ${kind}-----`;

    expect(getCaCertificateShapeProblem(key)).toBe(
      CaCertificateProblem.PrivateKey,
    );
    expect(getCaCertificateShapeProblem(`${CERTIFICATE}\n${key}`)).toBe(
      CaCertificateProblem.PrivateKey,
    );
  });

  test("a text longer than a CA certificate can be is refused", () => {
    const certificates: Array<string> = [];

    while (
      certificates.join("\n").length <= HTTP_STEP_CA_CERTIFICATE_MAX_LENGTH
    ) {
      certificates.push(CERTIFICATE);
    }

    expect(getCaCertificateShapeProblem(certificates.join("\n"))).toBe(
      CaCertificateProblem.TooLong,
    );
    expect(
      getCaCertificateShapeProblem(certificates.slice(0, 3).join("\n")),
    ).toBeNull();
  });

  test("the certificates of a text are read in order, each whole", () => {
    expect(
      getCaCertificateBlocks(
        `intro\n${CERTIFICATE}\nmiddle\n${OTHER_CERTIFICATE}\nend`,
      ),
    ).toEqual([CERTIFICATE, OTHER_CERTIFICATE]);
    expect(getCaCertificateBlocks("hello")).toEqual([]);
    expect(getCaCertificateBlocks(42 as unknown as string)).toEqual([]);
  });

  test("each problem says, as the step's error, that nothing was sent and where to fix it", () => {
    for (const problem of Object.values(CaCertificateProblem)) {
      const message: string =
        HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES[problem];

      expect(message.startsWith("This step's CA certificate ")).toBe(true);
      expect(message).toContain("so the request was not sent");
      expect(message).toContain("Under the step's More fields");
      expect(message.endsWith(".")).toBe(true);
    }
  });
});

describe("what the step says when the server's certificate is refused", () => {
  const HOST: string = "billing.internal.example";

  test.each(
    UNTRUSTED_CERTIFICATE_CODES.map((code: string) => {
      return [code];
    }),
  )(
    "%s, with no CA certificate: paste the CA's certificate, or turn on the switch",
    (code: string) => {
      expect(
        getHttpStepCertificateFailureMessage({
          code,
          host: HOST,
          settings: CHECKS,
        }),
      ).toBe(HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE);
    },
  );

  test.each(
    UNTRUSTED_CERTIFICATE_CODES.map((code: string) => {
      return [code];
    }),
  )(
    "%s, with a CA certificate: it did not sign the server's",
    (code: string) => {
      expect(
        getHttpStepCertificateFailureMessage({
          code,
          host: HOST,
          settings: CHECKS_WITH_CA,
        }),
      ).toBe(HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE);
    },
  );

  test("an expired certificate, and one not valid yet, say which", () => {
    for (const ca of [CHECKS, CHECKS_WITH_CA]) {
      expect(
        getHttpStepCertificateFailureMessage({
          code: "CERT_HAS_EXPIRED",
          host: HOST,
          settings: ca,
        }),
      ).toBe(HTTP_STEP_CERTIFICATE_EXPIRED_MESSAGE);
      expect(
        getHttpStepCertificateFailureMessage({
          code: "CERT_NOT_YET_VALID",
          host: HOST,
          settings: ca,
        }),
      ).toBe(HTTP_STEP_CERTIFICATE_NOT_YET_VALID_MESSAGE);
    }

    expect(DATED_CERTIFICATE_CODES).toEqual([
      "CERT_HAS_EXPIRED",
      "CERT_NOT_YET_VALID",
    ]);
  });

  test("a certificate for another host names the URL's host", () => {
    const message: string | null = getHttpStepCertificateFailureMessage({
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
      host: HOST,
      settings: CHECKS_WITH_CA,
    });

    expect(message).toBe(getHttpStepCertificateForAnotherHostMessage(HOST));
    expect(message).toContain(`not for ${HOST},`);
  });

  test.each(
    UNVERIFIED_CERTIFICATE_CODES.map((code: string) => {
      return [code];
    }),
  )(
    "%s says the certificate could not be verified, and its code",
    (code: string) => {
      expect(
        getHttpStepCertificateFailureMessage({
          code,
          host: HOST,
          settings: CHECKS,
        }),
      ).toBe(getHttpStepCertificateNotVerifiedMessage(code));
      expect(getHttpStepCertificateNotVerifiedMessage(code)).toContain(
        `(${code})`,
      );
    },
  );

  test("with the switch on, a refused certificate is the outbound proxy's: the switch never loosens it", () => {
    for (const code of [
      ...UNTRUSTED_CERTIFICATE_CODES,
      ...DATED_CERTIFICATE_CODES,
      ...UNVERIFIED_CERTIFICATE_CODES,
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ]) {
      expect(
        getHttpStepCertificateFailureMessage({
          code,
          host: HOST,
          settings: SKIPS,
        }),
      ).toBe(getHttpStepProxyCertificateMessage(code));
    }

    expect(
      getHttpStepProxyCertificateMessage("SELF_SIGNED_CERT_IN_CHAIN"),
    ).toBe(
      "The outbound proxy's certificate could not be verified (SELF_SIGNED_CERT_IN_CHAIN), so the request was not sent. Allow self-signed certificates skips the checks of the step's server, never the proxy's: ask whoever runs this OneUptime server to check the proxy set in HTTPS_PROXY or ALL_PROXY.",
    );
  });

  test.each([
    ["a refused connection", "ECONNREFUSED"],
    ["a timeout", "ECONNABORTED"],
    ["a name that did not resolve", "ENOTFOUND"],
    ["a proxy's refused tunnel", "ERR_PROXY_TUNNEL"],
    ["no code", undefined],
    ["an empty code", ""],
  ])(
    "%s is no refusal of a certificate: the error is kept",
    (_what: string, code: string | undefined) => {
      for (const ca of [CHECKS, CHECKS_WITH_CA, SKIPS]) {
        expect(
          getHttpStepCertificateFailureMessage({
            code,
            host: HOST,
            settings: ca,
          }),
        ).toBeNull();
      }
    },
  );

  test("the families of codes do not overlap", () => {
    const all: Array<string> = [
      ...UNTRUSTED_CERTIFICATE_CODES,
      ...DATED_CERTIFICATE_CODES,
      ...UNVERIFIED_CERTIFICATE_CODES,
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ];

    expect(new Set<string>(all).size).toBe(all.length);
  });

  test("every refusal says nothing was sent, and names the switch as the step's editor does", () => {
    const messages: Array<string> = [
      HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE,
      HTTP_STEP_CERTIFICATE_EXPIRED_MESSAGE,
      HTTP_STEP_CERTIFICATE_NOT_YET_VALID_MESSAGE,
      getHttpStepCertificateForAnotherHostMessage(HOST),
      getHttpStepCertificateNotVerifiedMessage("CERT_REVOKED"),
    ];

    for (const message of messages) {
      expect(message).toContain("so the request was not sent");
      expect(message).toContain("turn on Allow self-signed certificates");
      expect(message).toContain("More fields");
      expect(message.endsWith(".")).toBe(true);
    }

    // The safer way first.
    expect(
      HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE.indexOf("CA certificate"),
    ).toBeLessThan(
      HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE.indexOf(
        "Allow self-signed certificates",
      ),
    );
    expect(HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE).toContain(
      "the server's own certificate when it is self-signed",
    );
  });
});
