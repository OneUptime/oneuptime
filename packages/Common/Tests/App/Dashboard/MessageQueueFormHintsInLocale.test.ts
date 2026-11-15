import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import i18next from "i18next";
import {
  MESSAGE_QUEUE_DESTINATION_DESCRIPTION,
  MESSAGE_QUEUE_NAMESPACE_DESCRIPTION,
  MESSAGE_QUEUE_OTHER_SYSTEM_FIELD,
  MESSAGE_QUEUE_OTHER_SYSTEM_VALUE,
  MESSAGE_QUEUE_SAVED_AS_DESTINATION_HINT,
  MESSAGE_QUEUE_SAVED_AS_HINT,
  MESSAGE_QUEUE_SAVED_AS_SYSTEM_HINT,
  getMessageQueueDestinationHint,
  getMessageQueueNamespaceHint,
  getMessageQueueOtherSystemHint,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueuePresentation";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE QUEUE CREATE FORM'S HELP AND HINTS, IN THE READER'S LANGUAGE.
 *
 * The create form's Destination and Namespace fields explained themselves
 * in English on every page, and the hints under the fields - what a URL,
 * an ARN, a namespace host or a typed system is saved as - were English
 * sentences built in code: a German reader picked "Anderes
 * Messaging-System" and read "Saved as "mqtt"." under it. The help and the
 * three hints are keys now, worded in every language with the value where
 * the language puts it. The hints are written outside React, in the
 * reader's language (the global translator): checked here behind the real
 * i18next with the shipped locale files.
 */

const RENDERED: ReadonlyArray<string> = ["de", "fa", "ar", "ja"];

const HELP: Array<string> = [
  MESSAGE_QUEUE_DESTINATION_DESCRIPTION,
  MESSAGE_QUEUE_NAMESPACE_DESCRIPTION,
];

const HINTS: Array<string> = [
  MESSAGE_QUEUE_SAVED_AS_HINT,
  MESSAGE_QUEUE_SAVED_AS_SYSTEM_HINT,
  MESSAGE_QUEUE_SAVED_AS_DESTINATION_HINT,
];

const SQS_URL: Record<string, unknown> = {
  messagingSystem: "aws_sqs",
  destinationName: "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
};

const NAMESPACE_HOST: Record<string, unknown> = {
  messagingSystem: "servicebus",
  brokerScope: "Shop-Prod.servicebus.windows.net",
};

// "AmazonSQS" typed under Other is Amazon SQS (aws_sqs); "MQTT" is "mqtt".
function typedSystem(typed: string): Record<string, unknown> {
  return {
    messagingSystem: MESSAGE_QUEUE_OTHER_SYSTEM_VALUE,
    [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: typed,
  };
}

function hintsFor(): Array<string> {
  return [
    getMessageQueueDestinationHint(SQS_URL) || "",
    getMessageQueueNamespaceHint(NAMESPACE_HOST) || "",
    getMessageQueueOtherSystemHint(typedSystem("MQTT")) || "",
    getMessageQueueOtherSystemHint(typedSystem("AmazonSQS")) || "",
  ].map(withoutIsolateMarks);
}

describe("the help and the hints are keys of the Dashboard's locale files", () => {
  test("each is a key of the English file", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of [...HELP, ...HINTS]) {
      expect(english[key]).toBe(key);
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each of them",
    (language: string) => {
      expect(
        [...HELP, ...HINTS].filter((key: string): boolean => {
          return !isWordedInDashboardLocale(key, language);
        }),
      ).toEqual([]);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps each hint's value and name, and the namespace host as written",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of HINTS) {
        expect({ key, placeholders: placeholdersOf(words[key] || "") }).toEqual(
          { key, placeholders: placeholdersOf(key) },
        );
      }
      expect(words[MESSAGE_QUEUE_NAMESPACE_DESCRIPTION]).toContain(
        "<namespace>.servicebus.windows.net",
      );
    },
  );
});

describe("the hints, in English", () => {
  test("read as they always did", () => {
    expect(hintsFor()).toEqual([
      'Saved as "orders", the name OneUptime reads from this value in your telemetry.',
      'Saved as "shop-prod".',
      'Saved as "mqtt".',
      'Saved as "aws_sqs", Amazon SQS.',
    ]);
  });
});

describe("the hints, in the reader's language", () => {
  beforeAll(async () => {
    const resources: Record<string, { translation: Record<string, string> }> =
      {};
    for (const language of RENDERED) {
      resources[language] = { translation: readDashboardLocale(language) };
    }
    await i18next.init({
      lng: "en",
      fallbackLng: "en",
      resources: resources,
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test.each(RENDERED)(
    "in %s, every hint is the language's sentence with the stored value in it",
    async (language: string) => {
      await i18next.changeLanguage(language);
      const words: Record<string, string> = readDashboardLocale(language);
      const said: Array<string> = hintsFor();

      expect(said).toEqual([
        words[MESSAGE_QUEUE_SAVED_AS_DESTINATION_HINT]!.replace(
          "{{value}}",
          "orders",
        ),
        words[MESSAGE_QUEUE_SAVED_AS_HINT]!.replace("{{value}}", "shop-prod"),
        words[MESSAGE_QUEUE_SAVED_AS_HINT]!.replace("{{value}}", "mqtt"),
        words[MESSAGE_QUEUE_SAVED_AS_SYSTEM_HINT]!.replace(
          "{{value}}",
          "aws_sqs",
        ).replace("{{name}}", "Amazon SQS"),
      ]);
      for (const hint of said) {
        expect(hint).not.toMatch(/^Saved as/);
      }
    },
  );

  test.each([
    ["de", "Gespeichert als „mqtt“."],
    ["fa", "با نام «mqtt» ذخیره می‌شود."],
    ["ar", "يُحفظ باسم «mqtt»."],
  ])("in %s, MQTT reads %s", async (language: string, hint: string) => {
    await i18next.changeLanguage(language);

    expect(
      withoutIsolateMarks(
        getMessageQueueOtherSystemHint(typedSystem("MQTT")) || "",
      ),
    ).toBe(hint);
  });
});
