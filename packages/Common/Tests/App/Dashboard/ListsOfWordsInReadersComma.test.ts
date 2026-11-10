import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import i18next from "i18next";
import {
  ARABIC_LIST_SEPARATOR,
  IDEOGRAPHIC_LIST_SEPARATOR,
  joinList,
  LIST_SEPARATOR,
} from "../../../UI/Utils/ListSeparator";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { getWorkflowLintCountText } from "../../../UI/Components/Workflow/GraphLintSummary";
import { summarizeScope } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/AlertPolicyScopeFormFields";
import { describeDays } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursText";

/*
 * A LIST OF THE READER'S WORDS, JOINED WITH THE READER'S COMMA.
 *
 * About forty lists of words the reader's language words - counts ("2
 * sites, 1 role"), phrases ("1 error, 2 warnings"), day names ("Mon, Wed,
 * Fri"), labels and permission titles - were joined with a Latin comma, so a
 * Persian page read "۲ سایت, ۱ نقش" with a Latin comma between Persian words.
 * Each now joins with the comma of the script its words are written in
 * (joinList, ListSeparator): "، " in Persian, "、" in Chinese and Japanese,
 * ", " where the words are still English. Lists of codes, addresses and
 * names someone typed keep their Latin comma.
 */

type Locale = Record<string, string>;

const LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (code: string) => Locale = (code: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf-8"),
  ) as Locale;
};

const PERSIAN: Locale = readLocale("fa");
const JAPANESE: Locale = readLocale("ja");

const translatorOf: (locale: Locale, language: string) => Translator = (
  locale: Locale,
  language: string,
): Translator => {
  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
};

const useLanguage: (language: string, locale: Locale) => Promise<void> = async (
  language: string,
  locale: Locale,
): Promise<void> => {
  await i18next.init({
    lng: language,
    fallbackLng: "en",
    resources: { [language]: { translation: locale } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
};

beforeAll(async () => {
  await useLanguage("en", {});
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("joinList", () => {
  test("joins with the comma of the script the words are written in", () => {
    expect(joinList(["Description", "Labels"])).toBe(
      `Description${LIST_SEPARATOR}Labels`,
    );
    expect(joinList(["توضیحات", "برچسب‌ها"])).toBe(
      `توضیحات${ARABIC_LIST_SEPARATOR}برچسب‌ها`,
    );
    expect(joinList(["説明", "ラベル"])).toBe(
      `説明${IDEOGRAPHIC_LIST_SEPARATOR}ラベル`,
    );
  });

  test("words still in English keep the English comma on any page", () => {
    expect(joinList(["Project limits", "Ports"])).toBe("Project limits, Ports");
  });

  test("one word, or none, is as it is", () => {
    expect(joinList(["سایت"])).toBe("سایت");
    expect(joinList([])).toBe("");
  });
});

describe("a workflow's problems, counted", () => {
  test("in Persian, joined with the Persian comma", async () => {
    await useLanguage("fa", PERSIAN);

    const text: string = getWorkflowLintCountText({
      errorCount: 1,
      warningCount: 2,
    });

    expect(text).toContain(ARABIC_LIST_SEPARATOR);
    expect(text).not.toContain(", ");
  });

  test("in English, as it always was", async () => {
    await useLanguage("en", {});

    expect(getWorkflowLintCountText({ errorCount: 1, warningCount: 2 })).toBe(
      "1 error, 2 warnings",
    );
  });
});

describe("an alert policy's scope", () => {
  const SCOPE: { siteIds: Array<string>; networkDeviceRoleIds: Array<string> } =
    {
      siteIds: [
        "6d0f1c3e-7a2b-4c5d-8e9f-0a1b2c3d4e5f",
        "7e1f2d4f-8b3c-4d6e-9f0a-1b2c3d4e5f6a",
      ],
      networkDeviceRoleIds: ["8f2a3e5a-9c4d-4e7f-8a1b-2c3d4e5f6a7b"],
    };

  test("in Persian, its counts joined with the Persian comma", async () => {
    await useLanguage("fa", PERSIAN);

    const text: string = summarizeScope(SCOPE);

    expect(text.split(ARABIC_LIST_SEPARATOR)).toHaveLength(2);
    expect(text).not.toContain(", ");
  });

  test("in English: 2 sites, 1 role", async () => {
    await useLanguage("en", {});

    expect(summarizeScope(SCOPE)).toBe("2 sites, 1 role");
  });
});

describe("an on-call rule's days", () => {
  test("in Persian, the days' names joined with the Persian comma", () => {
    const text: string = describeDays([0, 2, 4], translatorOf(PERSIAN, "fa"));

    expect(text.split(ARABIC_LIST_SEPARATOR)).toHaveLength(3);
  });

  test("in Japanese, with the ideographic comma", () => {
    const text: string = describeDays([0, 2, 4], translatorOf(JAPANESE, "ja"));

    expect(text.split(IDEOGRAPHIC_LIST_SEPARATOR)).toHaveLength(3);
    expect(text).not.toContain(",");
  });

  test("in English, as it always was", () => {
    expect(describeDays([0, 2, 4], createTranslator(undefined, "en"))).toBe(
      "Mon, Wed, Fri",
    );
  });
});
