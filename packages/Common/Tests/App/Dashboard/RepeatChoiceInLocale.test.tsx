import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";

/*
 * What happens after a policy's last level, in the reader's language.
 *
 * The card's row is one sentence with a count in it: "Start again from
 * Level 1, up to 2 more times". Each language words the sentence and the
 * count together - Russian puts 1 and 21 in one form (раза) and 2, 5 and 0
 * in another (раз) - and a language that has not worded the sentence reads
 * it all in English, the count included, never "up to 2 weitere Male".
 *
 * The card, its dialog and the form are the real ones, with the shipped
 * Dashboard locales; only the network and the permission snapshot are
 * stubbed.
 */

configure({ asyncUtilTimeout: 15000 });

const POLICY_ID: string = "4e000000-0000-4000-8000-0000000000e2";

let stored: JSONObject = {};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: { new (): unknown };
      }): Promise<unknown> => {
        const item: Record<string, unknown> = new data.modelType() as Record<
          string,
          unknown
        >;
        return Object.assign(item, { _id: POLICY_ID }, stored);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: unknown;
      }): Promise<{ data: unknown }> => {
        return { data: data.model };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import ObjectID from "../../../Types/ObjectID";
import RepeatPolicy from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatPolicy";
import { RepeatChoiceSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatChoice/RepeatChoiceCard";
import {
  INCOMING_CALL_POLICY_REPEAT,
  ON_CALL_POLICY_REPEAT,
  RepeatChoiceConfig,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatChoice/RepeatChoice";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

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

const ON_CALL_SUMMARY: string = "Start again from Level 1, up to {{times}}";
const INCOMING_CALL_SUMMARY: string =
  "Ring again from the first rule, up to {{times}}";
const POLICY_AT_A_GLANCE: string =
  "If it is still unacknowledged, the whole policy repeats up to {{times}} before stopping.";
const MORE_TIMES: string = "{{count}} more times";

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function onCallPair(times: number): JSONObject {
  return {
    repeatPolicyIfNoOneAcknowledges: true,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: times,
  };
}

function summaryText(config: RepeatChoiceConfig, item: JSONObject): string {
  const view: ReturnType<typeof render> = render(
    <RepeatChoiceSummary config={config} item={item} />,
  );
  const text: string =
    view.getByTestId(`${config.dataTestId}-summary`).textContent || "";
  view.unmount();
  return text;
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 4; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of ["de", "ru", "ja"]) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  stored = {};
  await readIn("en");
});

describe("the repeat summary reads as one sentence in the reader's language", () => {
  test("German, in its own plural forms", async () => {
    await readIn("de");

    expect(summaryText(ON_CALL_POLICY_REPEAT, onCallPair(2))).toBe(
      "Erneut bei Level 1 beginnen, bis zu 2 weitere Male",
    );
    expect(summaryText(ON_CALL_POLICY_REPEAT, onCallPair(1))).toBe(
      "Erneut bei Level 1 beginnen, bis zu 1 weiteres Mal",
    );
    expect(
      summaryText(INCOMING_CALL_POLICY_REPEAT, {
        repeatPolicyIfNoOneAnswers: true,
        repeatPolicyIfNoOneAnswersTimes: 3,
      }),
    ).toBe("Erneut ab der ersten Regel klingeln, bis zu 3 weitere Male");
  });

  test("German names the stop the way the dialog's answer does", async () => {
    await readIn("de");

    expect(
      summaryText(ON_CALL_POLICY_REPEAT, {
        repeatPolicyIfNoOneAcknowledges: false,
      }),
    ).toBe("Alarmierung beenden");
    expect(
      summaryText(INCOMING_CALL_POLICY_REPEAT, {
        repeatPolicyIfNoOneAnswers: false,
      }),
    ).toBe("Anruf beenden");
  });

  test("Russian puts 1 and 21 in one form, and 2, 5 and 11 in another", async () => {
    await readIn("ru");

    expect(summaryText(ON_CALL_POLICY_REPEAT, onCallPair(1))).toBe(
      "Начать заново с Level 1, ещё не более 1 раза",
    );
    expect(summaryText(ON_CALL_POLICY_REPEAT, onCallPair(21))).toBe(
      "Начать заново с Level 1, ещё не более 21 раза",
    );
    expect(summaryText(ON_CALL_POLICY_REPEAT, onCallPair(2))).toBe(
      "Начать заново с Level 1, ещё не более 2 раз",
    );
    expect(summaryText(ON_CALL_POLICY_REPEAT, onCallPair(5))).toBe(
      "Начать заново с Level 1, ещё не более 5 раз",
    );
    expect(summaryText(ON_CALL_POLICY_REPEAT, onCallPair(11))).toBe(
      "Начать заново с Level 1, ещё не более 11 раз",
    );
  });

  test("Japanese", async () => {
    await readIn("ja");

    expect(summaryText(ON_CALL_POLICY_REPEAT, onCallPair(2))).toBe(
      "Level 1 からやり直す（最大 あと 2 回）",
    );
  });

  test("a language that has not worded the sentence reads it all in English, the count included", async () => {
    const german: Record<string, string> = readLocale("de");
    const withoutSentence: Record<string, string> = { ...german };
    delete withoutSentence[ON_CALL_SUMMARY];

    i18next.removeResourceBundle("de", "translation");
    i18next.addResourceBundle("de", "translation", withoutSentence);

    try {
      await readIn("de");

      // The count alone is still worded in German...
      expect(withoutSentence[MORE_TIMES]).toBe("{{count}} weitere Male");
      // ...but never inside an English sentence.
      expect(summaryText(ON_CALL_POLICY_REPEAT, onCallPair(2))).toBe(
        "Start again from Level 1, up to 2 more times",
      );
    } finally {
      i18next.removeResourceBundle("de", "translation");
      i18next.addResourceBundle("de", "translation", german);
    }
  });

  test.each(LANGUAGES)(
    "%s words each sentence that holds the count, and the count",
    (language: string) => {
      const strings: Record<string, string> = readLocale(language);

      for (const sentence of [
        ON_CALL_SUMMARY,
        INCOMING_CALL_SUMMARY,
        POLICY_AT_A_GLANCE,
      ]) {
        expect(strings[sentence]).toBeDefined();
        expect(strings[sentence]).not.toBe(sentence);
        expect(strings[sentence]).toContain("{{times}}");
      }

      expect(strings[MORE_TIMES]).not.toBe(MORE_TIMES);
      expect(strings[MORE_TIMES]).toContain("{{count}}");
    },
  );
});

describe("the Repeat Policy card and its dialog, in German", () => {
  test("the card names what it decides, and the row says what the policy does", async () => {
    await readIn("de");
    stored = onCallPair(2);

    render(<RepeatPolicy onCallDutyPolicyId={new ObjectID(POLICY_ID)} />);
    await settle();

    expect(screen.getByText("Wiederholungsrichtlinie")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Was passiert, wenn nach der letzten Stufe niemand bestätigt.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Nach der letzten Stufe")).toBeInTheDocument();
    expect(screen.getByTestId("repeat-policy-summary")).toHaveTextContent(
      "Erneut bei Level 1 beginnen, bis zu 2 weitere Male",
    );
  });

  test("the dialog asks its question with two answers, each said plainly", async () => {
    await readIn("de");
    stored = onCallPair(2);

    render(<RepeatPolicy onCallDutyPolicyId={new ObjectID(POLICY_ID)} />);
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });
    await settle();

    const dialog: HTMLElement = await screen.findByTestId("modal");

    expect(
      within(dialog).getByText("Wiederholungsrichtlinie bearbeiten"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Wenn nach der letzten Stufe niemand bestätigt"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", { name: /Alarmierung beenden/ }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", {
        name: /Erneut bei Level 1 beginnen/,
      }),
    ).toBeChecked();
    expect(within(dialog).getByText("Wie oft noch?")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Danach endet die Alarmierung."),
    ).toBeInTheDocument();
  });
});
