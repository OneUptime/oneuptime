/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import {
  ALLOW_SELF_SIGNED_CERTIFICATES_NOT_TRUE_OR_FALSE_MESSAGE,
  CA_CERTIFICATE_NOT_TEXT_MESSAGE,
  CA_CERTIFICATE_SAVE_MESSAGES,
  getCaCertificatePemProblem,
  getCaCertificateProblem,
  getHttpStepCaCertificateRunRefusal,
  getHttpStepCertificateSaveRefusal,
} from "../../../../Server/Utils/Runbook/HttpStepCaCertificate";
import {
  CaCertificatePemProblem,
  CaCertificateProblem,
  HTTP_STEP_CA_CERTIFICATE_MAX_LENGTH,
  HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES,
  HttpStepCertificateSettings,
  getHttpStepCaCertificateVariableProblemMessage,
} from "../../../../Types/Runbook/HttpStepCertificates";
import {
  RunbookVariableReference,
  RunbookVariableScope,
} from "../../../../Types/Runbook/RunbookVariableReference";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import {
  TestCertificates,
  generateTestCertificates,
  removeTestCertificates,
} from "../../TestingUtils/SelfSignedHttpsFixture";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * AN HTTP REQUEST STEP'S CERTIFICATE SETTINGS, AS THE SERVER READS THEM
 * (issue #10277).
 *
 * Node takes text that is not a certificate as a CA without a word, so the
 * server parses each certificate of a step's CA certificate - certificates
 * openssl made, here - and a save of steps (the API, Terraform, the editor)
 * is refused while one is not a certificate, holds a private key, or the
 * switch is anything but true or false. A save that names neither, or other
 * step types that happen to, is never refused for them.
 *
 * A CA certificate may also be one runbook variable alone (#10441): a save
 * takes it - whether the variable exists is the run's to ask - and refuses
 * a variable written beside other text. The run parses the variable's
 * value once it is filled in, and says which variable holds no certificate.
 */

const INTERNAL_CA: RunbookVariableReference = {
  scope: RunbookVariableScope.Global,
  name: "INTERNAL_CA",
};

let certificates: TestCertificates;

beforeAll(() => {
  certificates = generateTestCertificates("billing.internal.example");
});

afterAll(() => {
  removeTestCertificates(certificates);
});

function httpStep(
  config: Record<string, unknown>,
  title: string = "Call the billing service",
): Record<string, unknown> {
  return {
    id: "s1",
    order: 0,
    type: RunbookStepType.HttpRequest,
    title,
    config: {
      url: "https://billing.internal.example/health",
      method: "GET",
      ...config,
    },
  };
}

/*
 * A certificate's PEM cut short: its BEGIN line, the first line of its body
 * and its END line. Still base64, but no longer a whole certificate.
 */
function corrupted(pem: string): string {
  const lines: Array<string> = pem.trim().split("\n");

  return [lines[0], lines[1], lines[lines.length - 1]].join("\n");
}

describe("a CA certificate, parsed", () => {
  test("a CA's certificate, a self-signed one, and a bundle of them are certificates", () => {
    expect(getCaCertificateProblem(certificates.caCertificate)).toBeNull();
    expect(
      getCaCertificateProblem(certificates.selfSigned.certificate),
    ).toBeNull();
    expect(
      getCaCertificateProblem(
        `${certificates.caCertificate}\n${certificates.selfSigned.certificate}`,
      ),
    ).toBeNull();
  });

  test("empty text is no problem: the step then trusts the CAs OneUptime trusts", () => {
    expect(getCaCertificateProblem("")).toBeNull();
    expect(getCaCertificateProblem("  \n")).toBeNull();
    expect(getCaCertificateProblem(undefined)).toBeNull();
  });

  test("BEGIN and END lines around what does not parse are not a certificate", () => {
    expect(
      getCaCertificateProblem(
        "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----",
      ),
    ).toBe(CaCertificateProblem.NotACertificate);
    expect(getCaCertificateProblem(corrupted(certificates.caCertificate))).toBe(
      CaCertificateProblem.NotACertificate,
    );
  });

  test("one bad certificate in a bundle is enough", () => {
    expect(
      getCaCertificateProblem(
        `${certificates.caCertificate}\n${corrupted(certificates.selfSigned.certificate)}`,
      ),
    ).toBe(CaCertificateProblem.NotACertificate);
  });

  test("a private key, real or not, is refused", () => {
    expect(getCaCertificateProblem(certificates.selfSigned.key)).toBe(
      CaCertificateProblem.PrivateKey,
    );
    expect(
      getCaCertificateProblem(
        `${certificates.selfSigned.certificate}\n${certificates.selfSigned.key}`,
      ),
    ).toBe(CaCertificateProblem.PrivateKey);
  });

  test("one runbook variable alone is taken as written: its value is parsed when the step runs", () => {
    for (const text of [
      "{{global.variables.INTERNAL_CA}}",
      " {{local.variables.LAB_CA}}\n",
      "{{runbookSecrets.INTERNAL_CA}}",
    ]) {
      expect(getCaCertificateProblem(text)).toBeNull();
    }
  });

  test("a variable beside a real certificate, or beside another variable, is refused", () => {
    expect(
      getCaCertificateProblem(
        `${certificates.caCertificate}\n{{global.variables.INTERNAL_CA}}`,
      ),
    ).toBe(CaCertificateProblem.VariableAmongText);
    expect(
      getCaCertificateProblem(
        "{{global.variables.INTERNAL_CA}} {{local.variables.LAB_CA}}",
      ),
    ).toBe(CaCertificateProblem.VariableAmongText);
  });
});

describe("the certificates a step trusts as it runs, parsed", () => {
  test("a CA's certificate, a self-signed one, and a bundle are taken", () => {
    expect(getCaCertificatePemProblem(certificates.caCertificate)).toBeNull();
    expect(
      getCaCertificatePemProblem(
        `${certificates.caCertificate}${certificates.selfSigned.certificate}`,
      ),
    ).toBeNull();
  });

  test("empty, a reference, or what does not parse is no certificate", () => {
    for (const value of [
      "",
      "   ",
      undefined,
      "{{global.variables.INTERNAL_CA}}",
      "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----",
      corrupted(certificates.caCertificate),
    ]) {
      expect(getCaCertificatePemProblem(value)).toBe(
        CaCertificateProblem.NotACertificate,
      );
    }
  });

  test("a private key is refused, beside a certificate or alone", () => {
    expect(getCaCertificatePemProblem(certificates.caSigned.key)).toBe(
      CaCertificateProblem.PrivateKey,
    );
    expect(
      getCaCertificatePemProblem(
        `${certificates.caCertificate}\n${certificates.caSigned.key}`,
      ),
    ).toBe(CaCertificateProblem.PrivateKey);
  });
});

describe("what a step is refused before it is sent, for its CA certificate", () => {
  function checks(caCertificate?: string): HttpStepCertificateSettings {
    return { skipsCertificateChecks: false, caCertificate };
  }

  test("nothing, while it trusts a certificate - pasted in or from a variable - that parses", () => {
    expect(
      getHttpStepCaCertificateRunRefusal({
        settings: checks(certificates.caCertificate),
        variable: null,
      }),
    ).toBeNull();
    expect(
      getHttpStepCaCertificateRunRefusal({
        settings: checks(certificates.caCertificate),
        variable: INTERNAL_CA,
      }),
    ).toBeNull();
    expect(
      getHttpStepCaCertificateRunRefusal({
        settings: checks(),
        variable: null,
      }),
    ).toBeNull();
  });

  test("nothing while the checks are off: the CA certificate is not used", () => {
    expect(
      getHttpStepCaCertificateRunRefusal({
        settings: { skipsCertificateChecks: true, caCertificate: undefined },
        variable: INTERNAL_CA,
      }),
    ).toBeNull();
  });

  test.each([
    ["holds nothing", undefined, CaCertificateProblem.NotACertificate],
    ["is not a certificate", "hello", CaCertificateProblem.NotACertificate],
    [
      "is itself a reference, never read again",
      "{{global.variables.OTHER_CA}}",
      CaCertificateProblem.NotACertificate,
    ],
    ["holds a private key", "key", CaCertificateProblem.PrivateKey],
    ["is too long", "long", CaCertificateProblem.TooLong],
  ] as Array<[string, string | undefined, CaCertificatePemProblem]>)(
    "a variable that %s is refused, naming the variable",
    (
      _what: string,
      value: string | undefined,
      problem: CaCertificatePemProblem,
    ) => {
      const filled: string | undefined =
        value === "key"
          ? certificates.caSigned.key
          : value === "long"
            ? certificates.caCertificate.repeat(
                Math.ceil(
                  HTTP_STEP_CA_CERTIFICATE_MAX_LENGTH /
                    certificates.caCertificate.length,
                ) + 1,
              )
            : value;

      expect(
        getHttpStepCaCertificateRunRefusal({
          settings: checks(filled),
          variable: INTERNAL_CA,
        }),
      ).toBe(
        getHttpStepCaCertificateVariableProblemMessage({
          problem,
          reference: INTERNAL_CA,
        }),
      );
    },
  );

  test("a variable's refusal never holds its value", () => {
    const refusal: string | null = getHttpStepCaCertificateRunRefusal({
      settings: checks(certificates.caSigned.key),
      variable: INTERNAL_CA,
    });

    expect(refusal).toContain('"INTERNAL_CA"');

    for (const line of certificates.caSigned.key.split("\n")) {
      if (line.trim().length > 0) {
        expect(refusal).not.toContain(line);
      }
    }
  });

  test.each([
    ["is not a certificate", "hello", CaCertificateProblem.NotACertificate],
    ["holds a private key", "key", CaCertificateProblem.PrivateKey],
    [
      "names a variable beside other text",
      "mixed",
      CaCertificateProblem.VariableAmongText,
    ],
  ])(
    "one pasted in that %s is refused, as a save would refuse it",
    (_what: string, value: string, problem: CaCertificateProblem) => {
      const written: string =
        value === "key"
          ? certificates.caSigned.key
          : value === "mixed"
            ? `${certificates.caCertificate}\n{{global.variables.INTERNAL_CA}}`
            : value;

      expect(
        getHttpStepCaCertificateRunRefusal({
          settings: checks(written),
          variable: null,
        }),
      ).toBe(HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES[problem]);
    },
  );
});

describe("a save of steps", () => {
  test("is never refused for steps that name neither setting", () => {
    expect(getHttpStepCertificateSaveRefusal(undefined)).toBeNull();
    expect(getHttpStepCertificateSaveRefusal(null)).toBeNull();
    expect(getHttpStepCertificateSaveRefusal("steps")).toBeNull();
    expect(getHttpStepCertificateSaveRefusal([])).toBeNull();
    expect(
      getHttpStepCertificateSaveRefusal([
        null,
        "step",
        httpStep({}),
        { type: RunbookStepType.HttpRequest },
        { type: RunbookStepType.HttpRequest, config: "x" },
      ]),
    ).toBeNull();
  });

  test.each([
    ["on", true],
    ["off", false],
    ["left out", undefined],
    ["null", null],
  ])(
    "takes the switch %s, and a CA certificate that is one",
    (_what: string, value: unknown) => {
      expect(
        getHttpStepCertificateSaveRefusal([
          httpStep({
            allowSelfSignedCertificates: value,
            caCertificate: certificates.caCertificate,
          }),
        ]),
      ).toBeNull();
    },
  );

  test.each([
    ["the string 'true'", "true"],
    ["the string 'false'", "false"],
    ["1", 1],
    ["an object", {}],
  ])(
    "refuses the switch written as %s, naming the step",
    (_what: string, value: unknown) => {
      expect(
        getHttpStepCertificateSaveRefusal([
          httpStep({}, "Ping"),
          httpStep({ allowSelfSignedCertificates: value }),
        ]),
      ).toBe(
        `The step "Call the billing service" ${ALLOW_SELF_SIGNED_CERTIFICATES_NOT_TRUE_OR_FALSE_MESSAGE}`,
      );
    },
  );

  test("refuses a CA certificate that is not text", () => {
    expect(
      getHttpStepCertificateSaveRefusal([httpStep({ caCertificate: 42 })]),
    ).toBe(
      `The step "Call the billing service" ${CA_CERTIFICATE_NOT_TEXT_MESSAGE}`,
    );
  });

  test("refuses a CA certificate that is not one, while the step checks certificates", () => {
    expect(
      getHttpStepCertificateSaveRefusal([httpStep({ caCertificate: "hello" })]),
    ).toBe(
      `The step "Call the billing service" ${CA_CERTIFICATE_SAVE_MESSAGES[CaCertificateProblem.NotACertificate]}`,
    );
  });

  test("takes it while the switch is on: the CA certificate is not used then, and the editor hides it", () => {
    expect(
      getHttpStepCertificateSaveRefusal([
        httpStep({ allowSelfSignedCertificates: true, caCertificate: "hello" }),
      ]),
    ).toBeNull();
  });

  test("refuses a private key whatever the switch says: everyone who may read the runbook reads its steps", () => {
    for (const allowSelfSignedCertificates of [true, false, undefined]) {
      expect(
        getHttpStepCertificateSaveRefusal([
          httpStep({
            allowSelfSignedCertificates,
            caCertificate: certificates.selfSigned.key,
          }),
        ]),
      ).toBe(
        `The step "Call the billing service" ${CA_CERTIFICATE_SAVE_MESSAGES[CaCertificateProblem.PrivateKey]}`,
      );
    }
  });

  test.each([
    ["a global variable", "{{global.variables.INTERNAL_CA}}"],
    ["a runbook's own", "{{local.variables.LAB_CA}}"],
    ["with white space around it", "\n  {{global.variables.INTERNAL_CA}} \n"],
  ])(
    "takes a CA certificate that is one variable alone, %s - whether it exists is the run's to ask",
    (_what: string, caCertificate: string) => {
      for (const allowSelfSignedCertificates of [false, true, undefined]) {
        expect(
          getHttpStepCertificateSaveRefusal([
            httpStep({ allowSelfSignedCertificates, caCertificate }),
          ]),
        ).toBeNull();
      }
    },
  );

  test.each([
    [
      "beside a certificate",
      (): string => {
        return `${certificates.caCertificate}\n{{global.variables.INTERNAL_CA}}`;
      },
    ],
    [
      "beside another variable",
      (): string => {
        return "{{global.variables.INTERNAL_CA}}\n{{local.variables.LAB_CA}}";
      },
    ],
  ])(
    "refuses a variable written %s, naming the step, while the step checks certificates",
    (_what: string, caCertificate: () => string) => {
      expect(
        getHttpStepCertificateSaveRefusal([
          httpStep({ caCertificate: caCertificate() }),
        ]),
      ).toBe(
        `The step "Call the billing service" ${CA_CERTIFICATE_SAVE_MESSAGES[CaCertificateProblem.VariableAmongText]}`,
      );
    },
  );

  test("takes a variable beside other text while the switch is on: the CA certificate is not used then", () => {
    expect(
      getHttpStepCertificateSaveRefusal([
        httpStep({
          allowSelfSignedCertificates: true,
          caCertificate:
            "{{global.variables.INTERNAL_CA}} {{global.variables.OTHER}}",
        }),
      ]),
    ).toBeNull();
  });

  test("refuses a private key beside a variable whatever the switch says", () => {
    for (const allowSelfSignedCertificates of [true, false]) {
      expect(
        getHttpStepCertificateSaveRefusal([
          httpStep({
            allowSelfSignedCertificates,
            caCertificate: `{{global.variables.INTERNAL_CA}}\n${certificates.selfSigned.key}`,
          }),
        ]),
      ).toBe(
        `The step "Call the billing service" ${CA_CERTIFICATE_SAVE_MESSAGES[CaCertificateProblem.PrivateKey]}`,
      );
    }
  });

  test("names a step with no title by its type", () => {
    expect(
      getHttpStepCertificateSaveRefusal([
        httpStep({ allowSelfSignedCertificates: "yes" }, "   "),
      ]),
    ).toBe(
      `The step of type HttpRequest ${ALLOW_SELF_SIGNED_CERTIFICATES_NOT_TRUE_OR_FALSE_MESSAGE}`,
    );
  });

  test("leaves the same keys on other step types alone", () => {
    for (const type of Object.values(RunbookStepType)) {
      if (type === RunbookStepType.HttpRequest) {
        continue;
      }

      expect(
        getHttpStepCertificateSaveRefusal([
          {
            ...httpStep({
              allowSelfSignedCertificates: "true",
              caCertificate: "hello",
            }),
            type,
          },
        ]),
      ).toBeNull();
    }
  });

  test("every refusal is a sentence after the step's name", () => {
    for (const message of [
      ALLOW_SELF_SIGNED_CERTIFICATES_NOT_TRUE_OR_FALSE_MESSAGE,
      CA_CERTIFICATE_NOT_TEXT_MESSAGE,
      ...Object.values(CA_CERTIFICATE_SAVE_MESSAGES),
    ]) {
      expect(message.charAt(0)).toBe(message.charAt(0).toLowerCase());
      expect(message.endsWith(".")).toBe(true);
    }
  });

  test("a variable beside other text is told how to write one alone, with an example", () => {
    expect(
      CA_CERTIFICATE_SAVE_MESSAGES[CaCertificateProblem.VariableAmongText],
    ).toBe(
      "has a CA certificate that names a runbook variable beside other text. Write only the variable that holds the certificate, such as {{global.variables.INTERNAL_CA}}, or paste only the certificate.",
    );
  });
});
