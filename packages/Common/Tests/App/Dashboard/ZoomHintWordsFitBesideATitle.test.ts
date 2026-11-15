// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  TIME_RANGE_ZOOM_HINT_BOTH_TEXT,
  TIME_RANGE_ZOOM_HINT_RESET_TEXT,
  TIME_RANGE_ZOOM_HINT_TEXT,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE ZOOM HINT'S WORDS ARE SHORT IN EVERY LANGUAGE (#8048).
 *
 * The hint sits on a chart's title row, beside its title, and its words are
 * "short on purpose": four chart cards can share a row. Russian said "Drag
 * to zoom" in 34 characters ("Выделите область, чтобы приблизить"), almost
 * three times English's 12, and with the way back while zoomed in 68; the
 * etcd charts' titles beside it were cut to a word.
 *
 * Each hint the chart rows draw has a length budget, in characters, that
 * every Dashboard language keeps. A language that cannot say it within the
 * budget says it shorter, as Russian now does ("Выделите для увеличения").
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleTree = { [key: string]: string | LocaleTree };

function readLocale(language: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as LocaleTree;
}

// Characters, as a reader counts them: "é" and "ё" are one each.
function lengthOf(text: string): number {
  return Array.from(text).length;
}

/*
 * Roughly twice English for the short hints (a long language's words for
 * them run to about that), and half as much again for both gestures in one
 * line. Every language is measured against the same budget.
 */
export const ZOOM_HINT_BUDGETS: Record<string, number> = {
  [TIME_RANGE_ZOOM_HINT_TEXT]: 26,
  [TIME_RANGE_ZOOM_HINT_RESET_TEXT]: 34,
  [TIME_RANGE_ZOOM_HINT_BOTH_TEXT]: 62,
};

// What the budget is for: whatever overruns it, in which language.
export function getOverBudgetHints(
  locales: Record<string, LocaleTree>,
  budgets: Record<string, number>,
): Array<string> {
  const over: Array<string> = [];

  for (const [language, locale] of Object.entries(locales)) {
    for (const [key, budget] of Object.entries(budgets)) {
      const words: string | LocaleTree | undefined = locale[key];

      if (typeof words === "string" && lengthOf(words) > budget) {
        over.push(
          `${language}: "${words}" is ${lengthOf(words)} characters, over ${budget}`,
        );
      }
    }
  }

  return over;
}

const LOCALES: Record<string, LocaleTree> = Object.fromEntries(
  ["en", ...DASHBOARD_LANGUAGES].map((language: string) => {
    return [language, readLocale(language)];
  }),
);

describe("the zoom hint's words, in every Dashboard language", () => {
  test("each hint is a key of every locale, worded as a string", () => {
    for (const [language, locale] of Object.entries(LOCALES)) {
      for (const key of Object.keys(ZOOM_HINT_BUDGETS)) {
        expect([language, typeof locale[key]]).toEqual([language, "string"]);
      }
    }
  });

  test("English is well within every budget", () => {
    expect(lengthOf(TIME_RANGE_ZOOM_HINT_TEXT)).toBe(12);
    expect(lengthOf(TIME_RANGE_ZOOM_HINT_RESET_TEXT)).toBe(21);
    expect(lengthOf(TIME_RANGE_ZOOM_HINT_BOTH_TEXT)).toBe(36);
  });

  test("every language keeps every budget", () => {
    expect(getOverBudgetHints(LOCALES, ZOOM_HINT_BUDGETS)).toEqual([]);
  });

  test("negative control: Russian's old words overrun the budget", () => {
    const old: Record<string, LocaleTree> = {
      ru: {
        [TIME_RANGE_ZOOM_HINT_TEXT]: "Выделите область, чтобы приблизить",
        [TIME_RANGE_ZOOM_HINT_BOTH_TEXT]:
          "Выделите область, чтобы приблизить · дважды щёлкните, чтобы сбросить",
      },
      // A language that says it one character longer than the budget.
      fr: {
        [TIME_RANGE_ZOOM_HINT_BOTH_TEXT]:
          "Faites glisser pour zoomer · double-cliquez pour réinitialiser.",
      },
    };

    expect(getOverBudgetHints(old, ZOOM_HINT_BUDGETS)).toHaveLength(3);
  });

  test("Russian names the drag in its new, short words, the same way in both lines", () => {
    const russian: LocaleTree = LOCALES["ru"]!;
    const drag: string = russian[TIME_RANGE_ZOOM_HINT_TEXT] as string;

    expect(drag).toBe("Выделите для увеличения");
    expect(
      (russian[TIME_RANGE_ZOOM_HINT_BOTH_TEXT] as string).startsWith(
        `${drag} · `,
      ),
    ).toBe(true);
    expect(russian["Click or drag to zoom"]).toBe(
      "Нажмите или выделите для увеличения",
    );
  });

  test("a line of both gestures starts with the language's own words for the drag", () => {
    for (const [language, locale] of Object.entries(LOCALES)) {
      const drag: string = locale[TIME_RANGE_ZOOM_HINT_TEXT] as string;
      const both: string = locale[TIME_RANGE_ZOOM_HINT_BOTH_TEXT] as string;

      expect([language, both.startsWith(drag)]).toEqual([language, true]);
    }
  });
});
