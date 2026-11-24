import Errors from "../../../Server/Utils/Errors";
import {
  isEmptyErrorPhrase,
  meetsErrorMessageRule,
} from "../../../Types/Exception/ErrorMessageRule";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY AN INVITATION WAS REFUSED, AND WHAT TO DO NEXT (#7271).
 *
 * "This user has already been invited to this team" had no full stop and no
 * next step, and "Please upgrade your plan to Growth to invite more users"
 * did not say where. Since #9528 a pending person's row has Resend
 * Invitation, which is what someone re-inviting a pending address wanted,
 * and the plan is changed under Project Settings > Billing and Invoices >
 * Billing. Both are keys of the Dashboard's locales, worded in every
 * language, and keep the words the docs and the Terraform provider know
 * them by.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [
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
  "ar",
];

const localeOf: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
};

const REFUSALS: Array<[string, string]> = [
  ["ALREADY_INVITED", Errors.TeamMemberService.ALREADY_INVITED],
  [
    "LIMIT_REACHED_FOR_FREE_PLAN",
    Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
  ],
];

describe("an invitation's refusals", () => {
  test.each(REFUSALS)(
    "%s is a sentence that says what happened and what to do next",
    (_name: string, message: string) => {
      expect(meetsErrorMessageRule(message)).toBe(true);
      expect(isEmptyErrorPhrase(message)).toBe(false);
      // Two sentences: what happened, then what to do.
      expect(message.split(". ").length).toBeGreaterThanOrEqual(2);
      expect(message).not.toMatch(/\bPlease\b/);
    },
  );

  test("someone in the team already: Resend Invitation, as the row names it", () => {
    const message: string = Errors.TeamMemberService.ALREADY_INVITED;

    expect(message).toContain("Resend Invitation");
    // The Dashboard's button, by its own key.
    expect(localeOf("en")["Resend Invitation"]).toBe("Resend Invitation");
    // The Terraform provider recognises it by these words (AlreadyInvitedHint).
    expect(message.toLowerCase()).toContain("already been invited");
    // The docs quote it by its first sentence.
    expect(
      message.startsWith(
        "This person has already been invited to this team, or is a member of it.",
      ),
    ).toBe(true);
  });

  test("the Free plan full: where the plan is changed", () => {
    const message: string =
      Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN;

    expect(message).toContain(
      "Project Settings > Billing and Invoices > Billing",
    );
    expect(message).toContain("Growth");
    // The docs quote it by its first sentence.
    expect(
      message.startsWith("You have reached the user limit for the free plan."),
    ).toBe(true);
  });

  test.each(LANGUAGES)("each is worded in %s", (language: string) => {
    const english: Record<string, unknown> = localeOf("en");
    const locale: Record<string, unknown> = localeOf(language);

    for (const [, message] of REFUSALS) {
      expect(english[message]).toBe(message);
      expect({ language, message, words: typeof locale[message] }).toEqual({
        language,
        message,
        words: "string",
      });
      expect(locale[message]).not.toBe(message);
    }

    // The button the message names, as this language's Dashboard draws it.
    expect(locale[Errors.TeamMemberService.ALREADY_INVITED]).toContain(
      locale["Resend Invitation"] as string,
    );
  });
});
