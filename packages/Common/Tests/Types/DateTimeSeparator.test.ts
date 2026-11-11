import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import OneUptimeDate, {
  ARABIC_DATE_TIME_SEPARATOR,
  DATE_TIME_SEPARATOR,
} from "../../Types/Date";
import {
  ENGLISH_DATE_LANGUAGE,
  setDateDisplayLanguage,
} from "../../Types/DateLanguage";

/*
 * A DATE AND ITS TIME, JOINED WITH THE COMMA OF THE DATE'S SCRIPT.
 *
 * Some places write a date and a time apart, each from a fixed pattern
 * ("MMM DD" and "hh:mm A"), and join them: the Declared / Created tile of
 * an incident or alert, a workflow run's record. Each part is in the
 * reader's language, so the comma between them must be too: Arabic and
 * Persian turn theirs ("،"). Joined with English's, an Arabic tile read
 * "14 سبتمبر, 06:01 م". The helpers that write a date with its time in one
 * go (Intl) join them as each language does already; these two do it for
 * the callers that cannot.
 */

const SEPTEMBER_14: Date = new Date(Date.UTC(2026, 8, 14, 17, 1, 0));

describe("getDateTimeSeparator", () => {
  test.each<[string, string]>([
    // Arabic and Persian dates, in Latin or Persian digits.
    ["14 سبتمبر", ARABIC_DATE_TIME_SEPARATOR],
    ["14 سبتمبر 2025", ARABIC_DATE_TIME_SEPARATOR],
    ["۱۴ سپتامبر", ARABIC_DATE_TIME_SEPARATOR],
    ["اليوم", ARABIC_DATE_TIME_SEPARATOR],
    ["امروز", ARABIC_DATE_TIME_SEPARATOR],
    // Every other script keeps English's comma and space.
    ["Sep 14", DATE_TIME_SEPARATOR],
    ["14. Sept.", DATE_TIME_SEPARATOR],
    ["14 сент.", DATE_TIME_SEPARATOR],
    ["9月14日", DATE_TIME_SEPARATOR],
    ["9월 14일", DATE_TIME_SEPARATOR],
    ["14 सित॰", DATE_TIME_SEPARATOR],
    // A date with no words at all.
    ["2026-09-14", DATE_TIME_SEPARATOR],
    ["", DATE_TIME_SEPARATOR],
  ])("%p is joined to its time with %p", (date: string, separator: string) => {
    expect(OneUptimeDate.getDateTimeSeparator(date)).toBe(separator);
  });

  test("the two separators are the two scripts' commas, each with a space", () => {
    expect(DATE_TIME_SEPARATOR).toBe(", ");
    expect(ARABIC_DATE_TIME_SEPARATOR).toBe("، ");
  });
});

describe("joinDateAndTime", () => {
  test.each<[string, string, string]>([
    ["Sep 14", "06:01 PM", "Sep 14, 06:01 PM"],
    ["14. Sept.", "18:01", "14. Sept., 18:01"],
    ["14 سبتمبر", "06:01 م", "14 سبتمبر، 06:01 م"],
    ["۱۴ سپتامبر", "۱۸:۰۱", "۱۴ سپتامبر، ۱۸:۰۱"],
    ["Today", "3:25 PM", "Today, 3:25 PM"],
    ["اليوم", "3:25 م", "اليوم، 3:25 م"],
  ])("%p and %p read %p", (date: string, time: string, joined: string) => {
    expect(OneUptimeDate.joinDateAndTime(date, time)).toBe(joined);
  });

  test("never writes English's comma after an Arabic-script date", () => {
    for (const language of ["ar", "fa"]) {
      setDateDisplayLanguage(language);

      try {
        const date: string =
          OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
            date: SEPTEMBER_14,
            format: "MMM DD",
            timezone: "UTC",
          });
        const time: string =
          OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
            date: SEPTEMBER_14,
            format: "HH:mm",
            timezone: "UTC",
          });
        const joined: string = OneUptimeDate.joinDateAndTime(date, time);

        expect(joined).toContain("، ");
        expect(joined).not.toContain(",");
      } finally {
        setDateDisplayLanguage(ENGLISH_DATE_LANGUAGE);
      }
    }
  });

  test("an English page reads exactly as before", () => {
    const date: string = OneUptimeDate.getDateAsCustomFormattedStringInTimezone(
      { date: SEPTEMBER_14, format: "MMM DD", timezone: "UTC" },
    );
    const time: string = OneUptimeDate.getDateAsCustomFormattedStringInTimezone(
      { date: SEPTEMBER_14, format: "hh:mm A", timezone: "UTC" },
    );

    expect(OneUptimeDate.joinDateAndTime(date, time)).toBe("Sep 14, 05:01 PM");
  });
});

/*
 * The callers that join a date and a time by hand ask these helpers for the
 * comma, rather than writing English's: a new one copied from them keeps
 * the Arabic script's.
 */
describe("the callers that join a date and a time by hand", () => {
  const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");

  test.each<[string, string]>([
    [
      "App/FeatureSet/Dashboard/src/Utils/EventOverview.ts",
      "OneUptimeDate.getDateTimeSeparator(datePart)",
    ],
    [
      "Common/UI/Components/Workflow/RunRecordField.tsx",
      "OneUptimeDate.joinDateAndTime(relativeDay, time)",
    ],
  ])("%s asks for the comma", (file: string, call: string) => {
    const text: string = fs.readFileSync(path.join(PACKAGES, file), "utf8");

    expect(text).toContain(call);
    expect(text).not.toContain("}, ${time}");
  });
});
