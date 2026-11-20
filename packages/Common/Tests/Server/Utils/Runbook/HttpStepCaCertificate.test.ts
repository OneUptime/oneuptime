/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import {
  ALLOW_SELF_SIGNED_CERTIFICATES_NOT_TRUE_OR_FALSE_MESSAGE,
  CA_CERTIFICATE_NOT_TEXT_MESSAGE,
  CA_CERTIFICATE_SAVE_MESSAGES,
  getCaCertificateProblem,
  getHttpStepCertificateSaveRefusal,
} from "../../../../Server/Utils/Runbook/HttpStepCaCertificate";
import { CaCertificateProblem } from "../../../../Types/Runbook/HttpStepCertificates";
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
 */

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
});
