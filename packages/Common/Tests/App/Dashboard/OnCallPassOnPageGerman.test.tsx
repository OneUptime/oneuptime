import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * "PASS IT ON" IN THE READER'S LANGUAGE, FROM THE REAL LOCALE FILES.
 *
 * The header button, the dialog's question and its answer, the sentences
 * saying what passing on does - in German the way a German reader sees
 * them, and in Japanese for a language with no "one" form and its own way
 * of joining names. Then every language the Dashboard ships: each has its
 * own words for every Pass it on sentence, so no reader gets an English
 * sentence in the middle of their own language.
 */

import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import japaneseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import EventStatusPanel, {
  EventStateItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import {
  PASS_ON_PAGE_TEXT,
  describePassOnResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/PassOnPage";
import usePassOnPage, {
  PassOnPageControls,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/usePassOnPage";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallPageRecordType,
  OnCallPassOnOutcome,
  OnCallPassOnResult,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { StateListType } from "../../../Utils/StateOrder";
import fs from "fs";
import path from "path";

const EN: Record<string, string> = englishLocale as unknown as Record<
  string,
  string
>;
const DE: Record<string, string> = germanLocale as unknown as Record<
  string,
  string
>;
const JA: Record<string, string> = japaneseLocale as unknown as Record<
  string,
  string
>;

const LOCALES_DIRECTORY: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

// Every language the Dashboard is translated into, besides English.
const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Languages with no "one" form: their _one keys are never read.
const NO_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

// Every sentence Pass it on puts on the Dashboard.
const PASS_ON_KEYS: Array<string> = [
  "Pass it on",
  "Pass it on?",
  "You passed it on",
  "You won't be paged about it again.",
  "Could not pass it on. Please try again.",
  "Passed On",
  "Escalation rule {{order}} of {{count}} ({{name}}) is next, and is being paged now.",
  "Escalation rule {{order}} of {{count}} ({{name}}) is paged right away, without waiting.",
  "Escalation rule {{order}} of {{count}} ({{name}}) is paging {{names}} now.",
  "If nobody acknowledges by {{time}}, escalation rule {{order}} of {{count}} ({{name}}) is next.",
  "If nobody acknowledges by {{time}}, the policy moves on.",
  "Nobody else is being paged: paging stops, and somebody needs to take it.",
  "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
  "Nobody else is left to page: paging stops, and somebody needs to take it.",
  "Somebody acknowledged it already, so there is nothing to pass on.",
  "That was the policy's last escalation rule, so the policy started again from escalation rule 1.",
  "The next escalation rule is being paged now.",
  "The next escalation rule is paged right away, without waiting.",
  "The policy has moved on already: a later escalation rule is paging now.",
  "The policy has moved on already: escalation rule {{order}} of {{count}} ({{name}}) is paging now.",
  "This is the policy's last escalation rule, so the policy starts again from escalation rule 1 right away.",
  "This page is over: the on-call policy has stopped paging.",
  "You are not being paged about this right now.",
  "You passed this page on already.",
  "{{names}} are still being paged.",
  "{{names}} are still being paged._one",
  "{{name}} acknowledged it already, so there is nothing to pass on.",
];

const RECORD_ID: ObjectID = new ObjectID(
  "4c1d7e2a-5b3f-4e6a-9c8d-0a1b2c3d4e5f",
);

function result(overrides: Partial<OnCallPassOnResult>): OnCallPassOnResult {
  return {
    outcome: OnCallPassOnOutcome.NextRulePaged,
    isPreview: true,
    isDirectPage: false,
    policyName: "Critical",
    rule: { order: 2, name: "Level 2" },
    pagedNames: [],
    stillPagedNames: [],
    ruleCount: 3,
    ...overrides,
  };
}

function instanceFor(language: string, locale: Record<string, string>): i18n {
  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      [language]: { translation: locale },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
}

function translatorFor(
  language: string,
  locale: Record<string, string>,
): Translator {
  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

let german: i18n;

beforeAll(() => {
  german = instanceFor("de", DE);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("in German", () => {
  const GERMAN: Translator = translatorFor("de", DE);

  test("what passing on will do, in a German sentence with the rule's place and name", () => {
    expect(describePassOnResult(result({}), GERMAN)).toBe(
      "Eskalationsregel 2 von 3 (Level 2) wird sofort alarmiert, ohne zu warten.",
    );
  });

  test("who is paged now, joined with und", () => {
    expect(
      describePassOnResult(
        result({ isPreview: false, pagedNames: ["Bob Smith", "Carl Diaz"] }),
        GERMAN,
      ),
    ).toBe(
      "Eskalationsregel 2 von 3 (Level 2) alarmiert jetzt Bob Smith und Carl Diaz.",
    );
  });

  test("one person still paged, and several: German's two forms", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
        }),
        GERMAN,
      ),
    ).toBe("Bob Smith wird weiterhin alarmiert.");
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith", "Carl Diaz"],
        }),
        GERMAN,
      ),
    ).toBe("Bob Smith und Carl Diaz werden weiterhin alarmiert.");
  });

  test("the last rule and the end of paging", () => {
    expect(
      describePassOnResult(
        result({ outcome: OnCallPassOnOutcome.PolicyStartedAgain }),
        GERMAN,
      ),
    ).toBe(
      "Dies ist die letzte Eskalationsregel der Richtlinie, daher beginnt die Richtlinie sofort wieder mit Eskalationsregel 1.",
    );
    expect(
      describePassOnResult(
        result({ outcome: OnCallPassOnOutcome.PagingStopped }),
        GERMAN,
      ),
    ).toBe(
      "Es ist niemand mehr übrig, der alarmiert werden kann: Die Alarmierung endet, und jemand muss sich darum kümmern.",
    );
  });

  describe("the header and the dialog", () => {
    const STATES: Array<EventStateItem> = [
      { id: "created", name: "Created", color: new Color("#64748b") },
      {
        id: "acknowledged",
        name: "Acknowledged",
        color: new Color("#f59e0b"),
      },
    ];

    let getAnswers: Array<JSONObject>;
    let postAnswers: Array<JSONObject>;

    beforeEach(() => {
      getAnswers = [];
      postAnswers = [];

      jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
      jest.spyOn(API, "get").mockImplementation((async (_args: {
        url: URL;
      }) => {
        return new HTTPResponse<JSONObject>(
          200,
          getAnswers.shift() || { pages: [] },
          {},
        );
      }) as never);
      jest.spyOn(API, "post").mockImplementation((async (_args: {
        url: URL;
      }) => {
        return new HTTPResponse<JSONObject>(
          200,
          postAnswers.shift() || { answers: [] },
          {},
        );
      }) as never);
    });

    const flush: () => Promise<void> = async (): Promise<void> => {
      await act(async () => {
        for (let i: number = 0; i < 5; i++) {
          await Promise.resolve();
        }
      });
    };

    function Header(): ReactElement {
      const passOn: PassOnPageControls = usePassOnPage({
        recordType: OnCallPageRecordType.Alert,
        recordId: RECORD_ID,
      });

      return (
        <div>
          <EventStatusPanel
            stateList={StateListType.AlertState}
            states={STATES}
            identifier="#42"
            currentStateId="created"
            actions={[
              {
                stateId: "acknowledged",
                label: "Acknowledge",
                icon: IconProp.Check,
                buttonStyle: ButtonStyleType.PRIMARY,
                id: "alert-acknowledge-btn",
              },
            ]}
            onActionClick={(): void => {}}
            onStateSelect={(): void => {}}
            secondaryActions={passOn.actions}
          />
          {passOn.dialog}
        </div>
      );
    }

    const lines: (testId: string) => Array<string> = (
      testId: string,
    ): Array<string> => {
      return Array.from(screen.getByTestId(testId).querySelectorAll("p")).map(
        (line: HTMLParagraphElement): string => {
          return (line.textContent || "").trim();
        },
      );
    };

    test("Weitergeben in the header, asked and answered in German", async () => {
      getAnswers.push({
        pages: [
          {
            executionLogId: "a1b2c3d4-0000-4000-8000-000000000001",
            preview: result({}),
          },
        ] as unknown as JSONObject["pages"],
      });
      postAnswers.push({
        answers: [
          {
            passedOn: true,
            result: result({ isPreview: false, pagedNames: ["Carl Diaz"] }),
          },
        ] as unknown as JSONObject["answers"],
      });

      render(
        <I18nextProvider i18n={german}>
          <Header />
        </I18nextProvider>,
      );
      await flush();

      const button: HTMLElement = within(
        screen.getByRole("group", {
          name: DE["Event actions"] || "Event actions",
        }),
      ).getByRole("button", { name: "Weitergeben" });

      fireEvent.click(button);

      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Weitergeben?",
      );
      expect(lines("pass-on-preview")).toEqual([
        "Sie werden dazu nicht mehr alarmiert.",
        "Eskalationsregel 2 von 3 (Level 2) wird sofort alarmiert, ohne zu warten.",
      ]);
      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent("Weitergeben");
      expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
        DE["Cancel"]!,
      );

      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      await flush();

      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Sie haben es weitergegeben",
      );
      expect(lines("pass-on-answer")).toEqual([
        "Eskalationsregel 2 von 3 (Level 2) alarmiert jetzt Carl Diaz.",
        "Sie werden dazu nicht mehr alarmiert.",
      ]);
      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent(DE["Close"]!);
    });
  });
});

describe("in Japanese", () => {
  const JAPANESE: Translator = translatorFor("ja", JA);

  test("names are joined the Japanese way, in the one form Japanese has", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
        }),
        JAPANESE,
      ),
    ).toBe("Bob Smith は引き続き呼び出されています。");
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith", "Carl Diaz"],
        }),
        JAPANESE,
      ),
    ).toBe("Bob Smith、Carl Diaz は引き続き呼び出されています。");
  });

  test("a question ends with a full-width question mark", () => {
    expect(JA[PASS_ON_PAGE_TEXT.dialogTitle]).toBe("パスしますか？");
  });
});

describe("in every language the Dashboard ships", () => {
  test("the list of sentences is every Pass it on key en.json has", () => {
    for (const key of PASS_ON_KEYS) {
      expect(EN[key]).toBeDefined();
    }

    for (const text of Object.values(PASS_ON_PAGE_TEXT)) {
      expect(PASS_ON_KEYS).toContain(text);
    }
  });

  test.each(LANGUAGES)(
    "%s has its own words for every Pass it on sentence, keeping its placeholders",
    (language: string) => {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), {
          encoding: "utf8",
        }),
      ) as Record<string, string>;

      const placeholders: (text: string) => Array<string> = (
        text: string,
      ): Array<string> => {
        return (text.match(/\{\{[a-zA-Z]+\}\}/g) || []).sort();
      };

      for (const key of PASS_ON_KEYS) {
        const value: string | undefined = locale[key];

        expect(typeof value).toBe("string");

        if (key.endsWith("_one") && NO_ONE_FORM.includes(language)) {
          continue;
        }

        // Not the English: the reader's own words.
        expect({ key, value }).not.toEqual({ key, value: EN[key] });
        expect(placeholders(value!)).toEqual(placeholders(EN[key]!));
      }
    },
  );
});
