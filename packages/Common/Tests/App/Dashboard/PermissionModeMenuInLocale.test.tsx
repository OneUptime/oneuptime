import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import PermissionModePicker from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PermissionModePicker";
import { describePermissionMode } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PermissionModeWords";
import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
  AIChatPermissionModeOption,
} from "../../../Types/AI/AIChatPermissionMode";

/*
 * THE PERMISSION MENU IN EVERY LANGUAGE.
 *
 * Ask AI's composer and the AI Investigation card's both have the menu that
 * says what the AI may do. Its names were translated and its sentences were
 * not: a German reader met "The copilot pauses and asks before it changes
 * anything" under "Genehmigung anfordern", beside a button that said "Vor
 * Aktionen fragen", and "Auto-run (bypass approvals)" in English in every
 * language. Each name and sentence is read from the Dashboard's locale
 * files themselves, and the menu is drawn in German and in Persian.
 */

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

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const OPTIONS: Array<AIChatPermissionModeOption> =
  AIChatPermissionModeHelper.getOptions();

const MODES: Array<AIChatPermissionMode> = OPTIONS.map(
  (option: AIChatPermissionModeOption): AIChatPermissionMode => {
    return option.value;
  },
);

// Each mode's name: the button's and the menu's (the picker's own test pins them equal).
const NAMES: Array<string> = OPTIONS.map(
  (option: AIChatPermissionModeOption): string => {
    return option.title;
  },
);

const SENTENCES: Array<string> = MODES.map(
  (mode: AIChatPermissionMode): string => {
    return describePermissionMode(mode);
  },
);

// The menu's own label and the button's title.
const CHROME: Array<string> = [
  "AI permissions",
  "Choose what the AI is allowed to do",
];

async function instanceFor(language: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: language,
    resources: { [language]: { translation: readLocale(language) } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return instance;
}

afterEach(() => {
  cleanup();
});

describe("the permission menu, in every language", () => {
  test("the menu's names and sentences are the ones the code looks up", () => {
    expect(NAMES).toEqual(["Ask to act", "Auto-run", "Read-only"]);
    expect(SENTENCES).toEqual([
      "Asks for approval before it changes anything.",
      "Acts on clear requests right away, within your permissions.",
      "Only reads and answers. It never changes anything.",
    ]);
  });

  test.each(LANGUAGES)(
    "%s words every mode's name and sentence, and the menu's label",
    (language: string) => {
      const english: Record<string, string> = readLocale("en");
      const words: Record<string, string> = readLocale(language);

      for (const key of [...NAMES, ...SENTENCES, ...CHROME]) {
        expect({ key, inEnglish: english[key] }).toEqual({
          key,
          inEnglish: key,
        });
        expect({ key, translated: words[key] !== key }).toEqual({
          key,
          translated: true,
        });
        expect((words[key] || "").trim().length).toBeGreaterThan(0);
      }
    },
  );

  test.each(["de", "fa"])(
    "in %s the menu reads the language's own names and sentences, and no English",
    async (language: string) => {
      const words: Record<string, string> = readLocale(language);

      render(
        <I18nextProvider i18n={await instanceFor(language)}>
          <PermissionModePicker
            value={AIChatPermissionMode.AskForApproval}
            onChange={() => {}}
          />
        </I18nextProvider>,
      );

      const button: HTMLElement = screen.getByTitle(
        words["Choose what the AI is allowed to do"] as string,
      );

      expect(button).toHaveTextContent(words["Ask to act"] as string);

      fireEvent.click(button);

      const menu: HTMLElement = screen.getByRole("menu");

      expect(menu).toHaveAccessibleName(words["AI permissions"] as string);
      expect(
        within(menu)
          .getAllByRole("menuitemradio")
          .map((item: HTMLElement): string => {
            return item.textContent || "";
          }),
      ).toEqual(
        MODES.map((mode: AIChatPermissionMode, index: number): string => {
          return `${words[NAMES[index] as string]}${
            words[describePermissionMode(mode)]
          }`;
        }),
      );

      for (const english of [...NAMES, ...SENTENCES]) {
        expect(menu.textContent).not.toContain(english);
      }
    },
  );
});
