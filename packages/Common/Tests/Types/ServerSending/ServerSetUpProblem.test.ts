import { describe, expect, test } from "@jest/globals";
import ServerSetUpProblem, {
  SERVER_EMAIL_PROVIDER_NAMES,
  SERVER_EMAIL_SETTING_NAMES,
  SERVER_PUSH_TURNED_OFF_PROBLEM,
  SERVER_SET_UP_PROBLEMS,
  ServerSetUpProblemWords,
} from "../../../Types/ServerSending/ServerSetUpProblem";
import {
  createTranslator,
  getTemplatePlaceholders,
  isTranslatableTerm,
  TemplateValues,
  Translator,
} from "../../../Types/Translator";
import { SERVER_TEST_PUSH_REASONS } from "../../../Types/ServerSetup/ServerTestSend";

/*
 * WHAT A CHANNEL'S SETTINGS ARE MISSING, IN WORDS (#9437).
 *
 * The server sends each of its own set-up problems as a sentence every
 * language the Admin Dashboard speaks has, and the values that fill it: a
 * provider's name, drawn as written, and a setting's name, looked up with
 * the sentence. A browser takes only words it knows: anything else is drawn
 * as the English sentence sent beside them.
 */

describe("the sentences", () => {
  test("each fills only the values it names: a provider and a setting, or nothing", () => {
    for (const template of Object.values(SERVER_SET_UP_PROBLEMS)) {
      const placeholders: Array<string> = getTemplatePlaceholders(template);

      expect(
        placeholders.every((name: string) => {
          return name === "provider" || name === "field";
        }),
      ).toBe(true);
    }

    expect(
      getTemplatePlaceholders(SERVER_SET_UP_PROBLEMS.emailSettingNotSet).sort(),
    ).toEqual(["field", "provider"]);
  });

  test("a push turned off is said as the test push says it, word for word", () => {
    expect(SERVER_SET_UP_PROBLEMS.pushTurnedOff).toBe(
      SERVER_PUSH_TURNED_OFF_PROBLEM,
    );
    expect(SERVER_TEST_PUSH_REASONS.turnedOff).toBe(
      SERVER_PUSH_TURNED_OFF_PROBLEM,
    );
  });

  test("in English, as the server always said them", () => {
    expect(
      ServerSetUpProblem.toEnglish(
        ServerSetUpProblem.emailSettingNotSet(
          "SendGrid",
          SERVER_EMAIL_SETTING_NAMES.apiKey,
        ),
      ),
    ).toBe("SendGrid: the API Key is not set under Settings > Emails.");
    expect(
      ServerSetUpProblem.toEnglish(
        ServerSetUpProblem.emailSettingNotSet(
          "Amazon SES",
          SERVER_EMAIL_SETTING_NAMES.awsRegion,
        ),
      ),
    ).toBe(
      "Amazon SES: the Region (an AWS Region code, such as us-east-1) is not set under Settings > Emails.",
    );
    expect(
      ServerSetUpProblem.toEnglish(
        ServerSetUpProblem.of(SERVER_SET_UP_PROBLEMS.emailNotSetUp),
      ),
    ).toBe("Nothing is set up under Settings > Emails yet.");
  });
});

describe("what fills a sentence on a page", () => {
  test("the provider as written, the setting as a word looked up with the sentence", () => {
    const values: TemplateValues = ServerSetUpProblem.toValues(
      ServerSetUpProblem.emailSettingNotSet(
        "Mailgun",
        SERVER_EMAIL_SETTING_NAMES.fromEmail,
      ),
    );

    expect(values["provider"]).toBe("Mailgun");
    expect(isTranslatableTerm(values["field"])).toBe(true);
  });

  test("in the reader's language: the sentence and the setting's name, the provider as written", () => {
    const words: Record<string, string> = {
      "{{provider}}: the {{field}} is not set under Settings > Emails.":
        "{{provider}}: Das Feld „{{field}}“ ist unter Einstellungen > E-Mails nicht ausgefüllt.",
      "From Email": "Absender-E-Mail",
    };
    const german: Translator = createTranslator((text: string) => {
      return words[text];
    }, "de");
    const problem: ServerSetUpProblemWords =
      ServerSetUpProblem.emailSettingNotSet(
        "SendGrid",
        SERVER_EMAIL_SETTING_NAMES.fromEmail,
      );

    expect(
      german.translateTemplate(
        problem.template,
        ServerSetUpProblem.toValues(problem),
      ),
    ).toBe(
      "SendGrid: Das Feld „Absender-E-Mail“ ist unter Einstellungen > E-Mails nicht ausgefüllt.",
    );
  });

  test("a sentence with no values fills nothing", () => {
    expect(
      ServerSetUpProblem.toValues(
        ServerSetUpProblem.of(SERVER_SET_UP_PROBLEMS.smsNotSetUp),
      ),
    ).toEqual({});
  });
});

describe("read in a browser", () => {
  test("words this version knows read back whole", () => {
    for (const provider of SERVER_EMAIL_PROVIDER_NAMES) {
      for (const field of Object.values(SERVER_EMAIL_SETTING_NAMES)) {
        const sent: ServerSetUpProblemWords =
          ServerSetUpProblem.emailSettingNotSet(provider, field);

        expect(
          ServerSetUpProblem.parse(JSON.parse(JSON.stringify(sent))),
        ).toEqual(sent);
      }
    }

    for (const template of Object.values(SERVER_SET_UP_PROBLEMS)) {
      if (getTemplatePlaceholders(template).length > 0) {
        continue;
      }

      expect(ServerSetUpProblem.parse({ template: template })).toEqual({
        template: template,
        values: {},
      });
    }
  });

  test("anything else is no words: the English sentence is drawn as it came", () => {
    const valid: ServerSetUpProblemWords =
      ServerSetUpProblem.emailSettingNotSet(
        "SendGrid",
        SERVER_EMAIL_SETTING_NAMES.apiKey,
      );

    for (const sent of [
      null,
      undefined,
      "Nothing is set up under Settings > Emails yet.",
      [],
      {},
      // A sentence this version does not have.
      { template: "Something else went wrong.", values: {} },
      // A provider it does not know, or none.
      { ...valid, values: { provider: "Postfix", field: "API Key" } },
      { ...valid, values: { field: "API Key" } },
      // A setting it does not know, or none.
      { ...valid, values: { provider: "SendGrid", field: "Password" } },
      { ...valid, values: { provider: "SendGrid" } },
      // A value it does not fill.
      {
        ...valid,
        values: { provider: "SendGrid", field: "API Key", reason: "x" },
      },
      { ...valid, values: "SendGrid" },
      { ...valid, values: { provider: 3, field: "API Key" } },
    ]) {
      expect(ServerSetUpProblem.parse(sent)).toBeNull();
    }
  });

  test("knows its own sentences", () => {
    expect(
      ServerSetUpProblem.isTemplate(SERVER_SET_UP_PROBLEMS.callNotSetUp),
    ).toBe(true);
    expect(ServerSetUpProblem.isTemplate("535 Authentication failed")).toBe(
      false,
    );
  });
});
