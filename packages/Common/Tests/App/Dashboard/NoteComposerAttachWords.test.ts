import { describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE NOTE COMPOSER'S ATTACH BUTTON, IN EVERY LANGUAGE.
 *
 * "Attach" is the composer's button that opens the file picker beside a
 * note (NoteComposer), and the Dashboard's only use of the key. Five
 * languages worded it as something else: Japanese "assign" (割り当て),
 * French "link to" (Rattacher), Spanish "associate" (Asociar) and Chinese
 * "append" (附加). Found in #7595's UI review, beside the private note badge.
 */

const ATTACH_FILES: Record<string, string> = {
  es: "Adjuntar",
  fr: "Joindre",
  ja: "添付",
  "zh-CN": "添加附件",
  "zh-TW": "新增附件",
};

// What those languages said before: the negative control.
const OLD_WORDS: Record<string, string> = {
  es: "Asociar",
  fr: "Rattacher",
  ja: "割り当て",
  "zh-CN": "附加",
  "zh-TW": "附加",
};

describe("the note composer's Attach button attaches files, in every language", () => {
  test.each(Object.entries(ATTACH_FILES))(
    "%s says %s",
    (language: string, words: string) => {
      expect(readDashboardLocale(language)["Attach"]).toBe(words);
      expect(readDashboardLocale(language)["Attach"]).not.toBe(
        OLD_WORDS[language],
      );
    },
  );

  test("every language words it, and none says what the five said before", () => {
    const oldWords: Set<string> = new Set<string>(Object.values(OLD_WORDS));

    for (const language of DASHBOARD_LANGUAGES) {
      const words: string = readDashboardLocale(language)["Attach"] || "";

      expect({
        language: language,
        worded: isWordedInDashboardLocale("Attach", language),
        isAnOldWord: oldWords.has(words),
      }).toEqual({ language: language, worded: true, isAnOldWord: false });
    }
  });
});
