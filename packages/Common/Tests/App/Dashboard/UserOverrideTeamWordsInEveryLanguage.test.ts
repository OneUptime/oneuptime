import { describe, expect, test } from "@jest/globals";
import { USER_OVERRIDE_TEAM_PICKER_EMPTY_TEXT } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import { getUserOverrideTeamHint } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideTeamLimit";
import {
  USER_OVERRIDE_TEAM_AWAY_REFUSAL,
  USER_OVERRIDE_TEAM_COVER_REFUSAL,
  USER_OVERRIDE_TEAM_DELETE_REFUSAL,
  USER_OVERRIDE_TEAM_EDIT_REFUSAL,
  USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL,
  USER_OVERRIDE_TEAM_PICKER_HINT,
} from "../../../Types/OnCallDutyPolicy/UserOverrideTeamAccess";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * USER OVERRIDES FOR ONE'S OWN TEAM, IN THE READER'S LANGUAGE (issue
 * #9733).
 *
 * Every word the team rule says - the server's refusals of somebody outside
 * the reader's teams, which the dashboard says under the field or on the
 * locked button, and the line above a picker kept to the teams' people -
 * is a key of the Dashboard's English and is worded in every language the
 * Dashboard offers, with the same {{placeholders}}. Filled in, the line
 * names the teams and keeps no placeholder.
 */

const EN: Record<string, string> = readDashboardLocale("en");

const OTHER_LANGUAGES: ReadonlyArray<string> = DASHBOARD_LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const NEW_WORDS: ReadonlyArray<string> = [
  USER_OVERRIDE_TEAM_AWAY_REFUSAL,
  USER_OVERRIDE_TEAM_COVER_REFUSAL,
  USER_OVERRIDE_TEAM_EDIT_REFUSAL,
  USER_OVERRIDE_TEAM_DELETE_REFUSAL,
  USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL,
  USER_OVERRIDE_TEAM_PICKER_HINT,
  USER_OVERRIDE_TEAM_PICKER_EMPTY_TEXT,
];

describe("the words of the team rule", () => {
  test("are keys of the Dashboard's English, each as itself", () => {
    expect(NEW_WORDS).toHaveLength(7);

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
    "%s: the line above a picker, filled in, names the teams and keeps no placeholder",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      const hint: string | null = getUserOverrideTeamHint({
        translator: translator,
        teamNames: ["Payments", "Mobile"],
      });

      expect(hint).toEqual(expect.stringContaining("Payments"));
      expect(hint).toEqual(expect.stringContaining("Mobile"));
      expect(hint).toEqual(expect.not.stringContaining("{{"));
      expect(hint).not.toContain("are listed");
    },
  );
});
