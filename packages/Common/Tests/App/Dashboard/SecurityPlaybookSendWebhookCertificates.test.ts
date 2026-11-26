import { getStepSettingsFields } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepDialog";
import {
  RUN_IF_KEY,
  STEP_ACTION_KEY,
  formValuesToStep,
  stepToFormValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepForm";
import {
  HTTP_ALLOW_SELF_SIGNED_DESCRIPTION,
  HTTP_ALLOW_SELF_SIGNED_TITLE,
  HTTP_CA_CERTIFICATE_HELP,
  HTTP_CA_CERTIFICATE_PLACEHOLDER,
  HTTP_CA_CERTIFICATE_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Steps/RunbookStepEditorModel";
import { JSONObject } from "../../../Types/JSON";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { Argument } from "../../../Types/Workflow/Component";
import { API_CERTIFICATE_ARGUMENTS } from "../../../Types/Workflow/Components/ApiCertificates";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { describe, expect, test } from "@jest/globals";

/*
 * A PLAYBOOK'S SEND WEBHOOK, IN ITS STEP DIALOG (issue #10440).
 *
 * The step has a Runbook HTTP step's two certificate settings, and the
 * dialog draws them as that step's editor and a workflow API step's
 * settings draw them: the same names and the same lines, under More fields,
 * with the CA certificate shown while Allow self-signed certificates is off
 * and its shape checked as it is typed, as the save checks it.
 */

const URL_TEXT: string = "https://hooks.internal.example/soc";
const PEM: string =
  "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ0E=\n-----END CERTIFICATE-----";

const FIELDS: Array<Field<JSONObject>> = getStepSettingsFields([], {
  mayTurnOffContainmentApproval: false,
});

function fieldOf(key: string): Field<JSONObject> {
  const field: Field<JSONObject> | undefined = FIELDS.find(
    (candidate: Field<JSONObject>) => {
      return Object.keys(candidate.field || {})[0] === key;
    },
  );

  expect({ key, found: Boolean(field) }).toEqual({ key, found: true });

  return field!;
}

function valuesOf(values: JSONObject): FormValues<JSONObject> {
  return values as FormValues<JSONObject>;
}

const SEND_WEBHOOK: JSONObject = {
  [STEP_ACTION_KEY]: SecurityPlaybookActionType.SendWebhook,
  url: URL_TEXT,
};

describe("the two settings in Send Webhook's dialog", () => {
  test("read as a Runbook HTTP step's and a workflow API step's do", () => {
    const allow: Field<JSONObject> = fieldOf("allowSelfSignedCertificates");
    const ca: Field<JSONObject> = fieldOf("caCertificate");

    expect(allow.title).toBe(HTTP_ALLOW_SELF_SIGNED_TITLE);
    expect(allow.description).toBe(HTTP_ALLOW_SELF_SIGNED_DESCRIPTION);
    expect(allow.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(ca.title).toBe(HTTP_CA_CERTIFICATE_TITLE);
    expect(ca.placeholder).toBe(HTTP_CA_CERTIFICATE_PLACEHOLDER);
    expect(ca.fieldType).toBe(FormFieldSchemaType.LongText);

    // The workflow API steps' settings say the same.
    expect(
      API_CERTIFICATE_ARGUMENTS.map((argument: Argument): Array<string> => {
        return [argument.name, argument.description];
      }),
    ).toEqual([
      [HTTP_ALLOW_SELF_SIGNED_TITLE, HTTP_ALLOW_SELF_SIGNED_DESCRIPTION],
      [
        HTTP_CA_CERTIFICATE_TITLE,
        "The step trusts only this certificate (PEM): that of the CA that signed the server's certificate, or the server's own when it is self-signed.",
      ],
    ]);
    /*
     * #10277's line, as a workflow API step's: a runbook's also names its
     * variables (#10441), which a webhook has none of.
     */
    expect(ca.description).toBe(API_CERTIFICATE_ARGUMENTS[1]!.description);
    expect(HTTP_CA_CERTIFICATE_HELP).toContain("{{reference}}");
  });

  test("are folded under More fields, beside how the step runs, and optional", () => {
    const allow: Field<JSONObject> = fieldOf("allowSelfSignedCertificates");
    const ca: Field<JSONObject> = fieldOf("caCertificate");
    const runIf: Field<JSONObject> = fieldOf(RUN_IF_KEY);

    expect(allow.collapsibleSection).toBeDefined();
    expect(allow.collapsibleSection).toBe(runIf.collapsibleSection);
    expect(ca.collapsibleSection).toBe(runIf.collapsibleSection);
    expect(allow.required).toBe(false);
    expect(ca.required).toBe(false);

    // One fold: a section's fields are drawn together only when they follow each other.
    const index: (field: Field<JSONObject>) => number = (
      field: Field<JSONObject>,
    ): number => {
      return FIELDS.indexOf(field);
    };

    expect(index(ca)).toBe(index(allow) + 1);
    expect(index(runIf)).toBe(index(ca) + 1);
  });

  test("are shown for Send Webhook only, and the CA certificate while the switch is off", () => {
    const allow: Field<JSONObject> = fieldOf("allowSelfSignedCertificates");
    const ca: Field<JSONObject> = fieldOf("caCertificate");

    expect(allow.showIf!(valuesOf(SEND_WEBHOOK))).toBe(true);
    expect(ca.showIf!(valuesOf(SEND_WEBHOOK))).toBe(true);
    expect(
      ca.showIf!(
        valuesOf({ ...SEND_WEBHOOK, allowSelfSignedCertificates: false }),
      ),
    ).toBe(true);
    expect(
      ca.showIf!(
        valuesOf({ ...SEND_WEBHOOK, allowSelfSignedCertificates: true }),
      ),
    ).toBe(false);

    const runWorkflow: FormValues<JSONObject> = valuesOf({
      [STEP_ACTION_KEY]: SecurityPlaybookActionType.RunWorkflow,
    });

    expect(allow.showIf!(runWorkflow)).toBe(false);
    expect(ca.showIf!(runWorkflow)).toBe(false);
  });

  test.each([
    ["empty", "", null],
    ["a certificate in PEM", PEM, null],
    [
      "text",
      "hello",
      "Paste a certificate in PEM, from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----.",
    ],
    [
      "a runbook variable, which a playbook does not fill in",
      "{{global.variables.INTERNAL_CA}}",
      "Paste a certificate in PEM, from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----.",
    ],
    [
      "a private key",
      "-----BEGIN PRIVATE KEY-----\nMIIEvQ==\n-----END PRIVATE KEY-----",
      "This holds a private key. Paste only the certificate: everyone who may read this playbook can read its steps.",
    ],
  ])(
    "a CA certificate that is %s says, as it is typed, what the save would",
    (_what: string, text: string, problem: string | null) => {
      const ca: Field<JSONObject> = fieldOf("caCertificate");

      expect(
        ca.customValidation!(
          valuesOf({ ...SEND_WEBHOOK, caCertificate: text }),
        ),
      ).toBe(problem);

      // The save agrees: refused exactly when the dialog says so.
      let refused: boolean = false;

      try {
        parseSecurityPlaybookSteps([
          {
            id: "s1",
            action: SecurityPlaybookActionType.SendWebhook,
            config: { url: URL_TEXT, caCertificate: text },
          },
        ]);
      } catch {
        refused = true;
      }

      expect(refused).toBe(problem !== null);
    },
  );
});

describe("Send Webhook's settings, from the dialog to the step and back", () => {
  test("the switch and the CA certificate survive the round trip", () => {
    const step: SecurityPlaybookStep = formValuesToStep({
      values: {
        ...SEND_WEBHOOK,
        allowSelfSignedCertificates: true,
        caCertificate: PEM,
      },
      index: 0,
    });

    expect(step.config["allowSelfSignedCertificates"]).toBe(true);

    const reopened: JSONObject = stepToFormValues(step);

    expect(reopened["url"]).toBe(URL_TEXT);
    expect(reopened["allowSelfSignedCertificates"]).toBe(true);

    const withCa: SecurityPlaybookStep = formValuesToStep({
      values: { ...SEND_WEBHOOK, caCertificate: PEM },
      index: 0,
    });

    expect(withCa.config["caCertificate"]).toBe(PEM);
    expect(stepToFormValues(withCa)["caCertificate"]).toBe(PEM);
  });

  test("the switch is kept as on or off, never as text, and off keeps nothing", () => {
    const off: SecurityPlaybookStep = formValuesToStep({
      values: { ...SEND_WEBHOOK, allowSelfSignedCertificates: undefined },
      index: 0,
    });

    expect(
      parseSecurityPlaybookSteps([off])[0]!.config[
        "allowSelfSignedCertificates"
      ],
    ).toBeUndefined();
    expect(parseSecurityPlaybookSteps([off])[0]!.config).toEqual({
      url: URL_TEXT,
    });
  });
});
