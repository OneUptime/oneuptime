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
 * "ESCALATE" IN THE READER'S LANGUAGE, FROM THE REAL LOCALE FILES.
 *
 * The header button, the dialog's question - "Escalate Incident?" in the
 * maintainer's English - and its answer, the sentences saying what
 * escalating does, with the level named by its name and place: in German
 * the way a German reader sees them, in French for a language that puts the
 * article in the level ("le niveau 2 sur 3"), and in Japanese for a
 * language with no "one" form and its own way of joining names. Then every
 * language the Dashboard ships: each has its own words for every Escalate
 * sentence, so no reader gets an English sentence in the middle of their
 * own language - and none of them still says the old "Pass it on".
 */

import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import frenchLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fr.json";
import japaneseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import EventStatusPanel, {
  EventStateItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import {
  PASS_ON_PAGE_TEXT,
  PASS_ON_RECORD_TEXT,
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
  OnCallPassOnRefusal,
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
const FR: Record<string, string> = frenchLocale as unknown as Record<
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

// Every sentence Escalate puts on the Dashboard.
const ESCALATE_KEYS: Array<string> = [
  "Escalate",
  "Escalate Incident?",
  "Escalate Alert?",
  "Escalate Episode?",
  "Incident escalated",
  "Alert escalated",
  "Episode escalated",
  "Already acknowledged",
  "Already escalated",
  "Nothing to escalate",
  "Could not escalate. Please try again.",
  "Escalated",
  "You will not be paged again for this incident.",
  "You will not be paged again for this alert.",
  "You will not be paged again for this episode.",
  "{{name}} (Level {{order}} of {{count}})",
  "Level {{order}} of {{count}}",
  "This will immediately page {{level}}, without waiting.",
  "This will immediately page the next level, without waiting.",
  "The policy is now paging {{level}}: {{names}}.",
  "The policy is now paging {{level}}.",
  "The policy is now paging the next level.",
  "There is no level after yours, so this will immediately page {{level}} again, without waiting.",
  "There is no level after yours, so this will immediately page the first level again, without waiting.",
  "There was no level after yours, so the policy started over and is paging {{level}} again.",
  "There was no level after yours, so the policy started over and is paging the first level again.",
  "If nobody acknowledges by {{time}}, the policy pages {{level}} next.",
  "If nobody acknowledges by {{time}}, the policy moves on.",
  "The policy has moved on already and is paging {{level}} now.",
  "The policy has moved on already and is paging a later level now.",
  "Nobody else is being paged: paging stops, and somebody needs to take it.",
  "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
  "Nobody else is left to page: paging stops, and somebody needs to take it.",
  "Somebody acknowledged it already, so there is nothing to escalate.",
  "{{name}} acknowledged it already, so there is nothing to escalate.",
  "You escalated it already, so you will not be paged again for it.",
  "This page is over: the on-call policy has stopped paging.",
  "You are not being paged about this right now.",
  "{{names}} are still being paged.",
  "{{names}} are still being paged._one",
];

/*
 * The keys the action had while it was called "Pass it on": none of them is
 * left in any locale - a key no code reads is a translation nobody sees.
 */
const RETIRED_KEYS: Array<string> = [
  "Pass it on",
  "Pass it on?",
  "You passed it on",
  "Already passed on",
  "Nothing to pass on",
  "You won't be paged about it again.",
  "Could not pass it on. Please try again.",
  "Passed On",
  "Escalation rule {{order}} of {{count}} ({{name}}) is paged right away, without waiting.",
  "Escalation rule {{order}} of {{count}} ({{name}}) is paging {{names}} now.",
  "You passed this page on already.",
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
    rule: { order: 2, name: "Plattform-Leads" },
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

  test("what escalating will do, with the level's name and its place, in German", () => {
    expect(describePassOnResult(result({}), GERMAN)).toBe(
      "Damit wird sofort Plattform-Leads (Stufe 2 von 3) alarmiert, ohne zu warten.",
    );
  });

  test("a level with no name of its own is its place, in German", () => {
    expect(
      describePassOnResult(
        result({ rule: { order: 2, name: "Level 2" } }),
        GERMAN,
      ),
    ).toBe("Damit wird sofort Stufe 2 von 3 alarmiert, ohne zu warten.");
    expect(describePassOnResult(result({ rule: undefined }), GERMAN)).toBe(
      "Damit wird sofort die nächste Stufe alarmiert, ohne zu warten.",
    );
  });

  test("who is paged now, joined with und", () => {
    expect(
      describePassOnResult(
        result({ isPreview: false, pagedNames: ["Bob Smith", "Carl Diaz"] }),
        GERMAN,
      ),
    ).toBe(
      "Die Richtlinie alarmiert jetzt Plattform-Leads (Stufe 2 von 3): Bob Smith und Carl Diaz.",
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

  test("the last level and the end of paging", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          rule: { order: 1, name: "Level 1" },
        }),
        GERMAN,
      ),
    ).toBe(
      "Nach Ihrer Stufe kommt keine weitere, daher wird sofort wieder Stufe 1 von 3 alarmiert, ohne zu warten.",
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

    function Header(props: {
      recordType?: OnCallPageRecordType;
    }): ReactElement {
      const passOn: PassOnPageControls = usePassOnPage({
        recordType: props.recordType || OnCallPageRecordType.Incident,
        recordId: RECORD_ID,
      });

      return (
        <div>
          <EventStatusPanel
            stateList={StateListType.IncidentState}
            states={STATES}
            identifier="INC-42"
            currentStateId="created"
            actions={[
              {
                stateId: "acknowledged",
                label: "Acknowledge",
                icon: IconProp.Check,
                buttonStyle: ButtonStyleType.PRIMARY,
                id: "incident-acknowledge-btn",
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

    const eskalieren: () => HTMLElement = (): HTMLElement => {
      return within(
        screen.getByRole("group", {
          name: DE["Event actions"] || "Event actions",
        }),
      ).getByRole("button", { name: "Eskalieren" });
    };

    test("Eskalieren in the header; the maintainer's dialog, asked and answered in German", async () => {
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

      fireEvent.click(eskalieren());

      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Vorfall eskalieren?",
      );
      expect(lines("pass-on-preview")).toEqual([
        "Damit wird sofort Plattform-Leads (Stufe 2 von 3) alarmiert, ohne zu warten.",
        "Sie werden zu diesem Vorfall nicht mehr alarmiert.",
      ]);
      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent("Eskalieren");
      expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
        DE["Cancel"]!,
      );

      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      await flush();

      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Vorfall eskaliert",
      );
      expect(lines("pass-on-answer")).toEqual([
        "Die Richtlinie alarmiert jetzt Plattform-Leads (Stufe 2 von 3): Carl Diaz.",
        "Sie werden zu diesem Vorfall nicht mehr alarmiert.",
      ]);
      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent(DE["Close"]!);
    });

    test("an alert and an episode are named as German names them", async () => {
      for (const [recordType, title, notPagedAgain] of [
        [
          OnCallPageRecordType.Alert,
          "Warnung eskalieren?",
          "Sie werden zu dieser Warnung nicht mehr alarmiert.",
        ],
        [
          OnCallPageRecordType.AlertEpisode,
          "Episode eskalieren?",
          "Sie werden zu dieser Episode nicht mehr alarmiert.",
        ],
      ] as Array<[OnCallPageRecordType, string, string]>) {
        getAnswers.push({
          pages: [
            {
              executionLogId: "a1b2c3d4-0000-4000-8000-000000000001",
              preview: result({}),
            },
          ] as unknown as JSONObject["pages"],
        });

        render(
          <I18nextProvider i18n={german}>
            <Header recordType={recordType} />
          </I18nextProvider>,
        );
        await flush();

        fireEvent.click(eskalieren());

        expect(screen.getByTestId("modal-title")).toHaveTextContent(title);
        expect(lines("pass-on-preview")[1]).toBe(notPagedAgain);

        cleanup();
      }
    });

    test("nothing escalated: why, in a few German words over the sentence", async () => {
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
            passedOn: false,
            refusal: OnCallPassOnRefusal.RecordAcknowledged,
            acknowledgedByName: "Ana Lopez",
          },
        ] as unknown as JSONObject["answers"],
      });

      render(
        <I18nextProvider i18n={german}>
          <Header />
        </I18nextProvider>,
      );
      await flush();

      fireEvent.click(eskalieren());
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      await flush();

      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Bereits bestätigt",
      );
      expect(lines("pass-on-answer")).toEqual([
        "Ana Lopez hat es bereits bestätigt, daher gibt es nichts zu eskalieren.",
      ]);
    });

    test("nobody left to page: the warning, in German", async () => {
      getAnswers.push({
        pages: [
          {
            executionLogId: "a1b2c3d4-0000-4000-8000-000000000001",
            preview: result({ outcome: OnCallPassOnOutcome.PagingStopped }),
          },
        ] as unknown as JSONObject["pages"],
      });

      render(
        <I18nextProvider i18n={german}>
          <Header />
        </I18nextProvider>,
      );
      await flush();

      fireEvent.click(eskalieren());

      expect(screen.getByTestId("pass-on-warning")).toHaveTextContent(
        "Es ist niemand mehr übrig, der alarmiert werden kann: Die Alarmierung endet, und jemand muss sich darum kümmern.",
      );
      expect(lines("pass-on-preview")).toEqual([
        "Sie werden zu diesem Vorfall nicht mehr alarmiert.",
      ]);
    });
  });
});

describe("in French", () => {
  const FRENCH: Translator = translatorFor("fr", FR);

  test("a level with no name of its own takes its article, as the object of the sentence", () => {
    expect(describePassOnResult(result({ rule: { order: 2 } }), FRENCH)).toBe(
      "Cela alertera immédiatement le niveau 2 sur 3, sans attendre.",
    );
    expect(describePassOnResult(result({}), FRENCH)).toBe(
      "Cela alertera immédiatement Plattform-Leads (niveau 2 sur 3), sans attendre.",
    );
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

  test("the level, with its name and place in full-width brackets", () => {
    expect(describePassOnResult(result({}), JAPANESE)).toBe(
      "待たずにすぐ Plattform-Leads（レベル 2/3） を呼び出します。",
    );
  });

  test("a question ends with a full-width question mark", () => {
    for (const text of Object.values(PASS_ON_RECORD_TEXT)) {
      expect(JA[text.question]!.endsWith("？")).toBe(true);
    }
  });
});

describe("in every language the Dashboard ships", () => {
  test("the list of sentences is every Escalate key en.json has", () => {
    for (const key of ESCALATE_KEYS) {
      expect({ key, inEnglish: EN[key] !== undefined }).toEqual({
        key,
        inEnglish: true,
      });
    }

    for (const text of [
      ...Object.values(PASS_ON_PAGE_TEXT),
      ...Object.values(PASS_ON_RECORD_TEXT).flatMap(
        (each: {
          question: string;
          doneTitle: string;
          notPagedAgain: string;
        }) => {
          return [each.question, each.doneTitle, each.notPagedAgain];
        },
      ),
    ]) {
      expect(ESCALATE_KEYS).toContain(text);
    }
  });

  test("the keys of the old Pass it on are gone from en.json", () => {
    for (const key of RETIRED_KEYS) {
      expect({ key, inEnglish: EN[key] !== undefined }).toEqual({
        key,
        inEnglish: false,
      });
    }
  });

  test.each(LANGUAGES)(
    "%s has its own words for every Escalate sentence, keeping its placeholders",
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

      for (const key of ESCALATE_KEYS) {
        const value: string | undefined = locale[key];

        expect(typeof value).toBe("string");

        if (key.endsWith("_one") && NO_ONE_FORM.includes(language)) {
          continue;
        }

        // Not the English: the reader's own words.
        expect({ key, value }).not.toEqual({ key, value: EN[key] });
        expect(placeholders(value!)).toEqual(placeholders(EN[key]!));
      }

      for (const key of RETIRED_KEYS) {
        expect({ language, key, kept: key in locale }).toEqual({
          language,
          key,
          kept: false,
        });
      }
    },
  );
});
