import { describe, expect, test } from "@jest/globals";
import { FoundDescription, scanProductDescriptions } from "./DescriptionScan";

/*
 * The forms of Project Settings, Teams, Users, onboarding and the Admin
 * Dashboard's settings say what each field is for in their own words.
 *
 * A form field with no description of its own shows its model column's
 * (BasicModelForm), written for the API reference: "Any friendly name of
 * this object", "Friendly description for this config so you remember what
 * this is about", "Probe Icon" under a field titled Probe Logo. The
 * settings / admin simplicity audit gave each field in this area a short
 * line of its own, or turned the column's off (Field.hideColumnDescription)
 * where the field's title and placeholder say it all. This keeps it so: a
 * field added here later says what it is for, or says nothing.
 *
 * DescriptionScan finds the fields that fall back to their column's
 * description (kind "column"); ShortDescriptionsGuard holds every
 * description, these included, to its length.
 */

// The settings and admin area: its pages, the components only they draw, and the shared forms they build.
const AREA: ReadonlyArray<RegExp> = [
  /^packages\/App\/FeatureSet\/Dashboard\/src\/Pages\/(Settings|Teams|Users|Onboarding)\//,
  /^packages\/App\/FeatureSet\/Dashboard\/src\/Components\/(Team|ApiKey|CustomRole|Permission|CustomSMTP|CallSMS|ProjectBalance|Sso)\//,
  /^packages\/App\/FeatureSet\/AdminDashboard\/src\/Pages\/(Settings|Projects|Users)\//,
  /^packages\/Common\/UI\/Components\/(SmtpConfig|Sso)\//,
];

interface Exception {
  where: RegExp;
  reason: string;
}

/*
 * Pages in the area another audit owns, whose forms are reworked there. An
 * entry that no longer matches a fallback is reported, so the list only
 * shrinks.
 */
const EXCEPTIONS: ReadonlyArray<Exception> = [
  /*
   * The LLM provider forms left this list with #4990: they are one shared
   * form now (Common/UI/Components/AI/LlmProviderFormFields), in its own
   * words. The global AI agents' form left it with its page: global Runners
   * took their work.
   */
];

const FALLBACKS: Array<FoundDescription> = scanProductDescriptions().filter(
  (description: FoundDescription): boolean => {
    return (
      description.kind === "column" &&
      AREA.some((area: RegExp): boolean => {
        return area.test(description.where);
      })
    );
  },
);

function isExcepted(description: FoundDescription): boolean {
  return EXCEPTIONS.some((exception: Exception): boolean => {
    return exception.where.test(description.where);
  });
}

describe("the settings and admin forms say what each field is for in their own words", () => {
  test("the scan reads the area: the forms the exceptions name are found", () => {
    for (const exception of EXCEPTIONS) {
      expect({
        exception: exception.where.source,
        found: FALLBACKS.some((description: FoundDescription): boolean => {
          return exception.where.test(description.where);
        }),
      }).toEqual({ exception: exception.where.source, found: true });
    }
  });

  test("no field falls back to its column's API description", () => {
    expect(
      FALLBACKS.filter((description: FoundDescription): boolean => {
        return !isExcepted(description);
      }).map((description: FoundDescription): string => {
        return `${description.where}: "${description.text}" (from ${description.writtenAt}) - give the field a short description of its own, or hideColumnDescription: true`;
      }),
    ).toEqual([]);
  });

  test("every exception says why", () => {
    for (const exception of EXCEPTIONS) {
      expect(exception.reason.length).toBeGreaterThan(20);
    }
  });
});
