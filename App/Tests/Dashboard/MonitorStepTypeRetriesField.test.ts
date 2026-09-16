import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The per-type "Retries" field on the DNS, DNSSEC, Domain and External Status
 * Page step forms.
 *
 * These four types keep their retry count in their own step config, and the
 * forms read the box with `parseInt(value) || 3`. A typed 0 is falsy, so the
 * one value that means "check once, do not retry" was saved as three retries —
 * four attempts now that the probe counts retries after the first one. The
 * forms must read the box through the shared parser instead.
 *
 * The help text is translated by exact-key lookup, so the description must
 * also be a key in every Dashboard locale file, or it silently renders in
 * English for the sixteen other languages.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES: Array<string> = [
  "en",
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

const RETRIES_DESCRIPTION: string =
  "Number of times to retry after the first attempt fails. For example, 2 means up to 3 attempts in total. Set to 0 for no retries. Defaults to 3.";

/*
 * The wording this field carried while a 0 could not be saved. It said nothing
 * about what the number counts, so a user reading it had no way to know that 3
 * means four attempts.
 */
const SUPERSEDED_DESCRIPTION: string = "Number of times to retry on failure";

const FORMS: Array<{ name: string; file: string }> = [
  {
    name: "DnsMonitorStepForm",
    file: path.join(
      DASHBOARD_SRC,
      "Components",
      "Form",
      "Monitor",
      "DnsMonitor",
      "DnsMonitorStepForm.tsx",
    ),
  },
  {
    name: "DnssecMonitorStepForm",
    file: path.join(
      DASHBOARD_SRC,
      "Components",
      "Form",
      "Monitor",
      "DnssecMonitor",
      "DnssecMonitorStepForm.tsx",
    ),
  },
  {
    name: "DomainMonitorStepForm",
    file: path.join(
      DASHBOARD_SRC,
      "Components",
      "Form",
      "Monitor",
      "DomainMonitor",
      "DomainMonitorStepForm.tsx",
    ),
  },
  {
    name: "ExternalStatusPageMonitorStepForm",
    file: path.join(
      DASHBOARD_SRC,
      "Components",
      "Form",
      "Monitor",
      "ExternalStatusPageMonitor",
      "ExternalStatusPageMonitorStepForm.tsx",
    ),
  },
];

/*
 * Any decimal digit, in any script. The Persian file writes its numbers in
 * Persian digits, so an assertion on ASCII "3" would fail a correct
 * translation.
 */
const ANY_DECIMAL_DIGIT: RegExp = /\p{Nd}/u;

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${locale}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

describe("Per-type monitor step Retries field", () => {
  test.each(FORMS)(
    "$name saves a typed 0 instead of falling back to 3",
    (form: { name: string; file: string }) => {
      const source: string = fs.readFileSync(form.file, "utf8");

      /*
       * Asserted as tokens rather than a quoted span of JSX: the files are
       * prettier-formatted, and a reflow changes nothing about behaviour.
       */
      expect(source).toContain("parseMonitorStepRetriesInput");
      expect(source).toMatch(
        /retries:\s*parseMonitorStepRetriesInput\(\s*value,\s*3,?\s*\)/,
      );
      expect(source).not.toMatch(/retries:\s*parseInt\(/);
    },
  );

  test.each(FORMS)(
    "$name states the counting rule in its help text",
    (form: { name: string; file: string }) => {
      const source: string = fs.readFileSync(form.file, "utf8");

      expect(source).toContain(RETRIES_DESCRIPTION);
      expect(source).not.toContain(SUPERSEDED_DESCRIPTION);
    },
  );
});

describe("Per-type Retries help text locales", () => {
  test("en.json carries the description as an identity pair", () => {
    expect(readLocale("en")[RETRIES_DESCRIPTION]).toBe(RETRIES_DESCRIPTION);
  });

  test.each(LOCALES)(
    "%s.json translates the description into a non-empty value that keeps its numbers",
    (locale: string) => {
      const translated: unknown = readLocale(locale)[RETRIES_DESCRIPTION];

      expect(typeof translated).toBe("string");
      expect((translated as string).trim().length).toBeGreaterThan(0);
      expect(ANY_DECIMAL_DIGIT.test(translated as string)).toBe(true);
    },
  );

  test("the translations are not left in English", () => {
    for (const locale of LOCALES) {
      if (locale === "en") {
        continue;
      }

      expect(readLocale(locale)[RETRIES_DESCRIPTION]).not.toBe(
        RETRIES_DESCRIPTION,
      );
    }
  });

  test("no locale keeps the superseded wording", () => {
    for (const locale of LOCALES) {
      expect(readLocale(locale)[SUPERSEDED_DESCRIPTION]).toBeUndefined();
    }
  });
});
