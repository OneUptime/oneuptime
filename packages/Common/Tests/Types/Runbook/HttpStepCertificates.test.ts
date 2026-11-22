import {
  CaCertificatePemProblem,
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
  getCaCertificatePemShapeProblem,
  getCaCertificateShapeProblem,
  getHttpStepCaCertificateVariable,
  getHttpStepCaCertificateVariableProblemMessage,
  getHttpStepCertificateFailureMessage,
  getHttpStepCertificateForAnotherHostMessage,
  getHttpStepCertificateNotFromVariableCaMessage,
  getHttpStepCertificateNotVerifiedMessage,
  getHttpStepCertificateSettings,
  getHttpStepProxyCertificateMessage,
} from "../../../Types/Runbook/HttpStepCertificates";
import { HttpRequestStepConfig } from "../../../Types/Runbook/RunbookStep";
import {
  RunbookVariableReference,
  RunbookVariableScope,
} from "../../../Types/Runbook/RunbookVariableReference";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW AN HTTP REQUEST STEP CHECKS THE SERVER'S CERTIFICATE (issue #10277):
 * the rules the editor and the server share. How a step's config is read
 * (the switch on only when exactly true, the CA certificate used only while
 * the step checks), what a CA certificate may hold - certificates in PEM,
 * or one runbook variable alone that holds them (#10441) - and what the
 * step says when a certificate is refused - each refusal pointing at what
 * in the step, or in the variable it names, lets it through.
 */

const INTERNAL_CA: RunbookVariableReference = {
  scope: RunbookVariableScope.Global,
  name: "INTERNAL_CA",
};

const LAB_CA: RunbookVariableReference = {
  scope: RunbookVariableScope.Local,
  name: "LAB_CA",
};

const PEM_PROBLEMS: Array<CaCertificatePemProblem> = [
  CaCertificateProblem.NotACertificate,
  CaCertificateProblem.PrivateKey,
  CaCertificateProblem.TooLong,
];

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

  test("a CA certificate that names a variable is read as written: the step fills it in when it runs", () => {
    expect(
      settings({ caCertificate: " {{global.variables.INTERNAL_CA}}\n" }),
    ).toEqual({
      skipsCertificateChecks: false,
      caCertificate: "{{global.variables.INTERNAL_CA}}",
    });
  });
});

describe("the variable a CA certificate names", () => {
  function variableOf(
    config: Record<string, unknown>,
  ): RunbookVariableReference | null {
    return getHttpStepCaCertificateVariable(
      config as unknown as HttpRequestStepConfig,
    );
  }

  test("is the one variable written there alone, global or the runbook's own", () => {
    expect(
      variableOf({ caCertificate: "{{global.variables.INTERNAL_CA}}" }),
    ).toEqual(INTERNAL_CA);
    expect(variableOf({ caCertificate: "{{local.variables.LAB_CA}}" })).toEqual(
      LAB_CA,
    );
  });

  test("white space around it, and inside its braces, is taken", () => {
    expect(
      variableOf({
        caCertificate: "\n  {{ global.variables.INTERNAL_CA }} \n",
      }),
    ).toEqual(INTERNAL_CA);
  });

  test("an old runbook secret's spelling names its global variable", () => {
    expect(
      variableOf({ caCertificate: "{{runbookSecrets.INTERNAL_CA}}" }),
    ).toEqual(INTERNAL_CA);
  });

  test("with the switch on there is none: the CA certificate, and so its variable, is not used", () => {
    expect(
      variableOf({
        allowSelfSignedCertificates: true,
        caCertificate: "{{global.variables.INTERNAL_CA}}",
      }),
    ).toBeNull();

    // Only exactly true is on.
    expect(
      variableOf({
        allowSelfSignedCertificates: "true",
        caCertificate: "{{global.variables.INTERNAL_CA}}",
      }),
    ).toEqual(INTERNAL_CA);
  });

  test.each([
    ["no CA certificate", undefined],
    ["an empty one", "  "],
    ["a certificate pasted in", CERTIFICATE],
    [
      "a variable beside a certificate",
      `${CERTIFICATE}\n{{global.variables.INTERNAL_CA}}`,
    ],
    [
      "two variables",
      "{{global.variables.INTERNAL_CA}}{{local.variables.LAB_CA}}",
    ],
    [
      "the same variable twice",
      "{{global.variables.A}} {{global.variables.A}}",
    ],
    ["a variable in a sentence", "use {{global.variables.INTERNAL_CA}}"],
    ["braces that name no variable", "{{ .Values.ca }}"],
    ["a name a variable cannot have", "{{global.variables.my ca}}"],
    ["what is not text", 42],
  ])("%s names none", (_what: string, caCertificate: unknown) => {
    expect(variableOf({ caCertificate })).toBeNull();
  });

  test("a step with no config names none", () => {
    expect(getHttpStepCaCertificateVariable(undefined)).toBeNull();
    expect(getHttpStepCaCertificateVariable(null)).toBeNull();
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

describe("a CA certificate that names a runbook variable", () => {
  test.each([
    ["a global variable", "{{global.variables.INTERNAL_CA}}"],
    ["a runbook's own", "{{local.variables.LAB_CA}}"],
    ["with white space around it", "\n {{global.variables.INTERNAL_CA}}  \n"],
  ])(
    "alone, %s, is taken as written: its value is checked once filled in",
    (_what: string, text: string) => {
      expect(getCaCertificateShapeProblem(text)).toBeNull();
    },
  );

  test.each([
    [
      "beside a certificate",
      `${CERTIFICATE}\n{{global.variables.INTERNAL_CA}}`,
    ],
    [
      "inside a certificate's lines",
      `-----BEGIN CERTIFICATE-----\n{{global.variables.INTERNAL_CA}}\n-----END CERTIFICATE-----`,
    ],
    [
      "beside another",
      "{{global.variables.INTERNAL_CA}}\n{{local.variables.LAB_CA}}",
    ],
    [
      "written twice",
      "{{global.variables.INTERNAL_CA}}{{global.variables.INTERNAL_CA}}",
    ],
    ["in a sentence", "the CA is in {{global.variables.INTERNAL_CA}}"],
  ])(
    "%s is refused: the field holds one or the other",
    (_what: string, text: string) => {
      expect(getCaCertificateShapeProblem(text)).toBe(
        CaCertificateProblem.VariableAmongText,
      );
    },
  );

  test("beside a private key, the private key is what is said: it must never be kept", () => {
    expect(
      getCaCertificateShapeProblem(
        `{{global.variables.INTERNAL_CA}}\n-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49\n-----END PRIVATE KEY-----`,
      ),
    ).toBe(CaCertificateProblem.PrivateKey);
  });

  test("beside more text than a CA certificate can be, its length is what is said", () => {
    expect(
      getCaCertificateShapeProblem(
        `{{global.variables.INTERNAL_CA}}\n${"x".repeat(HTTP_STEP_CA_CERTIFICATE_MAX_LENGTH)}`,
      ),
    ).toBe(CaCertificateProblem.TooLong);
  });

  test("braces that name no variable are text: a certificate around them is taken, as openssl's lines are", () => {
    expect(
      getCaCertificateShapeProblem(`{{ .Values.ca }}\n${CERTIFICATE}`),
    ).toBeNull();
    expect(getCaCertificateShapeProblem("{{ .Values.ca }}")).toBe(
      CaCertificateProblem.NotACertificate,
    );
  });
});

describe("the certificates a step trusts as it runs", () => {
  test("certificates in PEM, one or a bundle, are taken", () => {
    expect(getCaCertificatePemShapeProblem(CERTIFICATE)).toBeNull();
    expect(
      getCaCertificatePemShapeProblem(`${CERTIFICATE}\n${OTHER_CERTIFICATE}`),
    ).toBeNull();
  });

  test("empty is no certificate: a variable named for the CA that holds nothing trusts nothing", () => {
    for (const text of ["", "  \n", undefined, null]) {
      expect(getCaCertificatePemShapeProblem(text)).toBe(
        CaCertificateProblem.NotACertificate,
      );
    }
  });

  test("a variable's value that is itself a reference is no certificate: a value is never read again", () => {
    expect(
      getCaCertificatePemShapeProblem("{{global.variables.INTERNAL_CA}}"),
    ).toBe(CaCertificateProblem.NotACertificate);
  });

  test("a private key, and a value longer than a CA certificate can be, are refused", () => {
    expect(
      getCaCertificatePemShapeProblem(
        `${CERTIFICATE}\n-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE\n-----END EC PRIVATE KEY-----`,
      ),
    ).toBe(CaCertificateProblem.PrivateKey);

    const certificates: Array<string> = [];

    while (
      certificates.join("\n").length <= HTTP_STEP_CA_CERTIFICATE_MAX_LENGTH
    ) {
      certificates.push(CERTIFICATE);
    }

    expect(getCaCertificatePemShapeProblem(certificates.join("\n"))).toBe(
      CaCertificateProblem.TooLong,
    );
  });

  test("never says a variable is beside other text: a value names no variable", () => {
    expect(
      getCaCertificatePemShapeProblem(
        `${CERTIFICATE}\n{{global.variables.INTERNAL_CA}}`,
      ),
    ).toBeNull();
  });
});

describe("what the step says when the variable its CA certificate names holds no certificate", () => {
  test.each(
    PEM_PROBLEMS.map((problem: CaCertificatePemProblem) => {
      return [problem];
    }),
  )(
    "%s: names the variable, says nothing was sent, and where to change it",
    (problem: CaCertificatePemProblem) => {
      const global: string = getHttpStepCaCertificateVariableProblemMessage({
        problem,
        reference: INTERNAL_CA,
      });
      const local: string = getHttpStepCaCertificateVariableProblemMessage({
        problem,
        reference: LAB_CA,
      });

      expect(
        global.startsWith(
          `This step's CA certificate, the variable "INTERNAL_CA", `,
        ),
      ).toBe(true);
      expect(global).toContain("so the request was not sent");
      expect(global).toContain(
        "Under Runbooks → Settings → Global Variables, replace its value with ",
      );
      expect(global.endsWith(".")).toBe(true);

      expect(
        local.startsWith(`This step's CA certificate, the variable "LAB_CA", `),
      ).toBe(true);
      expect(local).toContain(
        "Under the runbook's Settings → Variables, replace its value with ",
      );
      expect(local).not.toContain("Global Variables");
    },
  );

  test("each says what is wrong with the value, as a certificate pasted in is told", () => {
    expect(
      getHttpStepCaCertificateVariableProblemMessage({
        problem: CaCertificateProblem.NotACertificate,
        reference: INTERNAL_CA,
      }),
    ).toBe(
      `This step's CA certificate, the variable "INTERNAL_CA", is not a certificate in PEM, so the request was not sent. Under Runbooks → Settings → Global Variables, replace its value with the CA's certificate, from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----.`,
    );
    expect(
      getHttpStepCaCertificateVariableProblemMessage({
        problem: CaCertificateProblem.PrivateKey,
        reference: LAB_CA,
      }),
    ).toBe(
      `This step's CA certificate, the variable "LAB_CA", holds a private key, so the request was not sent. Under the runbook's Settings → Variables, replace its value with only the certificate, and keep the key on the server.`,
    );
    expect(
      getHttpStepCaCertificateVariableProblemMessage({
        problem: CaCertificateProblem.TooLong,
        reference: INTERNAL_CA,
      }),
    ).toBe(
      `This step's CA certificate, the variable "INTERNAL_CA", is longer than 64 KB, so the request was not sent. Under Runbooks → Settings → Global Variables, replace its value with only the certificate of the CA that signed the server's certificate.`,
    );
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

  test.each(
    UNTRUSTED_CERTIFICATE_CODES.map((code: string) => {
      return [code];
    }),
  )(
    "%s, with a CA certificate from a variable: it did not sign the server's, and that variable is where to change it",
    (code: string) => {
      for (const reference of [INTERNAL_CA, LAB_CA]) {
        expect(
          getHttpStepCertificateFailureMessage({
            code,
            host: HOST,
            settings: CHECKS_WITH_CA,
            caCertificateVariable: reference,
          }),
        ).toBe(getHttpStepCertificateNotFromVariableCaMessage(reference));
      }
    },
  );

  test("the variable's refusal names the variable, never its value, and says where to change it", () => {
    expect(getHttpStepCertificateNotFromVariableCaMessage(INTERNAL_CA)).toBe(
      `The server's certificate is not signed by the step's CA certificate, the variable "INTERNAL_CA", so the request was not sent. Under Runbooks → Settings → Global Variables, replace its value with the certificate of the CA that signed it, or the server's own certificate when it is self-signed.`,
    );
    expect(getHttpStepCertificateNotFromVariableCaMessage(LAB_CA)).toContain(
      `the variable "LAB_CA", so the request was not sent. Under the runbook's Settings → Variables, replace its value`,
    );
  });

  test("a variable changes nothing else a refusal says", () => {
    const codes: Array<string> = [
      ...DATED_CERTIFICATE_CODES,
      ...UNVERIFIED_CERTIFICATE_CODES,
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "ECONNREFUSED",
    ];

    for (const code of codes) {
      expect(
        getHttpStepCertificateFailureMessage({
          code,
          host: HOST,
          settings: CHECKS_WITH_CA,
          caCertificateVariable: INTERNAL_CA,
        }),
      ).toBe(
        getHttpStepCertificateFailureMessage({
          code,
          host: HOST,
          settings: CHECKS_WITH_CA,
        }),
      );
    }

    // With no CA certificate, nor the switch on, it is no refusal of the variable's.
    expect(
      getHttpStepCertificateFailureMessage({
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        host: HOST,
        settings: CHECKS,
        caCertificateVariable: INTERNAL_CA,
      }),
    ).toBe(HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE);
    expect(
      getHttpStepCertificateFailureMessage({
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        host: HOST,
        settings: SKIPS,
        caCertificateVariable: INTERNAL_CA,
      }),
    ).toBe(getHttpStepProxyCertificateMessage("DEPTH_ZERO_SELF_SIGNED_CERT"));
  });

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
