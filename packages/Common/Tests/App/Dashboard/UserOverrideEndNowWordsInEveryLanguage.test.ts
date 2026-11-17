/** @timezone UTC */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  USER_OVERRIDE_END_NOW_ACTION,
  USER_OVERRIDE_END_NOW_ARIA_LABEL,
  USER_OVERRIDE_END_NOW_COVERED,
  USER_OVERRIDE_END_NOW_SKIPPED,
  USER_OVERRIDE_END_NOW_TITLE,
  USER_OVERRIDE_ENDED_TOAST,
  getUserOverrideEndNowQuestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideEndNow";
import { USER_OVERRIDE_ENDS_TEXT } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import OneUptimeDate from "../../../Types/Date";
import {
  USER_OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL,
  USER_OVERRIDE_END_NOW_NOT_STARTED_REFUSAL,
} from "../../../Types/OnCallDutyPolicy/UserOverrideEdit";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * END NOW IN THE READER'S LANGUAGE (issue #7899).
 *
 * Every word End Now says - its button, its question and the sentence of
 * what happens to the time left, its toast, the server's two new refusals,
 * and what Ends now says under an override under way - is a key of the
 * Dashboard's English and is worded in every language the Dashboard
 * offers, with the same {{placeholders}}. Filled in, the question names
 * whose override it ends, who covers, and until when, keeps no
 * placeholder, and keeps no English word of the sentence.
 */

const EN: Record<string, string> = readDashboardLocale("en");

const OTHER_LANGUAGES: ReadonlyArray<string> = DASHBOARD_LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const NEW_WORDS: ReadonlyArray<string> = [
  USER_OVERRIDE_END_NOW_ACTION,
  USER_OVERRIDE_END_NOW_TITLE,
  USER_OVERRIDE_END_NOW_ARIA_LABEL,
  USER_OVERRIDE_END_NOW_COVERED,
  USER_OVERRIDE_END_NOW_SKIPPED,
  USER_OVERRIDE_ENDED_TOAST,
  USER_OVERRIDE_END_NOW_NOT_STARTED_REFUSAL,
  USER_OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL,
  USER_OVERRIDE_ENDS_TEXT,
];

// English a translated question must not keep.
const ENGLISH_WORDS: RegExp =
  /\b(stops|covering|instead|skipped|alerts page|turns|override|again)\b/i;

const NOW: Date = OneUptimeDate.fromString("2026-11-13T12:00:00.000Z");

// The question writes the end as the lists do, from now: noon on 13 November.
beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the words of End Now", () => {
  test("are keys of the Dashboard's English, each as itself", () => {
    expect(NEW_WORDS).toHaveLength(9);

    for (const key of NEW_WORDS) {
      expect({ key: key, english: EN[key] }).toEqual({
        key: key,
        english: key,
      });
    }
  });

  test.each(OTHER_LANGUAGES)(
    "%s: each is worded in the language, with the same placeholders",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of NEW_WORDS) {
        expect({
          key: key,
          worded: isWordedInDashboardLocale(key, language),
          placeholders: placeholdersOf(words[key] || ""),
        }).toEqual({
          key: key,
          worded: true,
          placeholders: placeholdersOf(key),
        });
      }
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s: the question, filled in, names who and until when, and keeps no English",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const coverName of ["Sam Rivera", null]) {
        const question: { title: string; description: string } =
          getUserOverrideEndNowQuestion({
            translator: translator,
            target: {
              id: "7899c000-0000-4000-8000-000000000001",
              startsAt: OneUptimeDate.fromString("2026-11-13T08:00:00.000Z"),
              endsAt: OneUptimeDate.fromString("2026-11-14T08:00:00.000Z"),
              awayName: "Alex Chen",
              coverName: coverName,
            },
          });

        for (const text of [question.title, question.description]) {
          expect({ text: text }).toEqual({
            text: expect.not.stringContaining("{{"),
          });
          expect({ text: text }).toEqual({
            text: expect.stringContaining("Alex Chen"),
          });
        }

        if (coverName) {
          expect(question.description).toContain(coverName);
        }

        const withoutNames: string = question.description
          .split("Alex Chen")
          .join("")
          .split("Sam Rivera")
          .join("");

        expect({
          language: language,
          english: ENGLISH_WORDS.test(withoutNames),
        }).toEqual({ language: language, english: false });
      }
    },
  );
});
