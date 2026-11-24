import {
  LOG_SCRUB_RULE_FORM_OPTIONS,
  LOG_SCRUB_RULE_ONLY_IN_ATTRIBUTES_HELP,
  LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
  SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
  TRACE_SCRUB_RULE_DEFAULTS_SUMMARY,
  TRACE_SCRUB_RULE_FORM_OPTIONS,
  TRACE_SCRUB_RULE_ONLY_IN_ATTRIBUTES_HELP,
} from "../../FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleForm";
import {
  ExtractedString,
  scanSourceRoots,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT A SCRUB RULE READS, IN THE READER'S LANGUAGE (#6513).
 *
 * Since #6507 a trace rule set to Attributes Only or All scrubs the
 * attributes of a span's links with the span's own, and since #6513 All
 * scrubs the span's status message and its events' names too, and a log's
 * Sensitive Attribute Keys rule reads the keys of a JSON body. The scrub
 * rule form says so: the trace rule's Fields to Scrub help, the line its
 * folded section shows while All is kept, and the line a log's
 * Sensitive Attribute Keys rule shows. Each is worded in every one of the
 * seventeen languages besides English, keeping the [REDACTED] the rule
 * writes and the JSON it reads.
 */

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readLocale("en");

// Every sentence this change wrote.
const WORDS: ReadonlyArray<string> = [
  TRACE_SCRUB_RULE_FORM_OPTIONS.fieldsToScrubHelp,
  TRACE_SCRUB_RULE_DEFAULTS_SUMMARY,
  LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
];

// The words they replaced, which no locale keeps.
const RETIRED: ReadonlyArray<string> = [
  "Which parts of the span to scrub: span name, attribute values, event attribute values, or all.",
  "Matches are replaced with [REDACTED] in span names, attributes and event attributes.",
];

describe("what a scrub rule reads, in every language", () => {
  test("the words are the trace rule's help and folded line, and the log's sensitive-keys line", () => {
    expect(WORDS).toEqual([
      "Which parts of the span to scrub: span name, attribute and link attribute values, event attribute values, or all, status message and event names too.",
      "Matches are replaced with [REDACTED] in span names, status messages, attributes, events and links.",
      "The values of keys that look sensitive, in attributes and in a JSON log body, are replaced with [REDACTED].",
    ]);
    // The log rule's help is unchanged, and the span's sensitive-keys line.
    expect(LOG_SCRUB_RULE_FORM_OPTIONS.fieldsToScrubHelp).toBe(
      "Which parts of the log to scrub: the log body (message), attribute values, or both.",
    );
    expect(TRACE_SCRUB_RULE_FORM_OPTIONS.sensitiveKeysSummary).toBe(
      SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
    );
  });

  test("en.json maps every one of them to itself", () => {
    for (const text of WORDS) {
      expect([text, ENGLISH[text]]).toEqual([text, text]);
    }
  });

  test("the extractor finds every one of them in the form that draws them", () => {
    const found: Set<string> = new Set<string>(
      scanSourceRoots([
        {
          directory:
            "packages/App/FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleForm.ts",
          kind: "ui",
        },
      ]).strings.map((entry: ExtractedString): string => {
        return entry.text;
      }),
    );

    expect(
      WORDS.filter((text: string): boolean => {
        return !found.has(text);
      }),
    ).toEqual([]);
  });

  test("the words they replaced are gone from every locale", () => {
    for (const language of ["en", ...TRANSLATED_LOCALES]) {
      const locale: Record<string, unknown> = readLocale(language);

      expect({
        language,
        kept: RETIRED.filter((text: string): boolean => {
          return text in locale;
        }),
      }).toEqual({ language, kept: [] });
    }
  });

  test("seventeen languages besides English", () => {
    expect(TRANSLATED_LOCALES).toHaveLength(17);
    expect(TRANSLATED_LOCALES).toContain("ar");
  });

  test.each(TRANSLATED_LOCALES)(
    "%s has its own words for every one of them",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const text of WORDS) {
        const value: unknown = locale[text];

        expect([text, typeof value]).toEqual([text, "string"]);
        expect([text, (value as string).trim().length > 0]).toEqual([
          text,
          true,
        ]);
        expect([text, value]).not.toEqual([text, text]);
      }
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s keeps what the rule writes, [REDACTED], and the JSON it reads",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const text of WORDS) {
        const value: string = locale[text] as string;

        expect([text, value.includes("[REDACTED]")]).toEqual([
          text,
          text.includes("[REDACTED]"),
        ]);
        expect([text, value.includes("JSON")]).toEqual([
          text,
          text.includes("JSON"),
        ]);
      }
    },
  );
});

/*
 * #10751: Only in These Attributes, the attributes a pattern rule reads -
 * its title, what it says on each signal, and the key its placeholder
 * shows. Each in every language, its code (db.password) kept as written.
 */
describe("what a narrowed pattern rule reads, in every language", () => {
  const ONLY_IN_WORDS: ReadonlyArray<string> = [
    "Only in These Attributes",
    LOG_SCRUB_RULE_ONLY_IN_ATTRIBUTES_HELP,
    TRACE_SCRUB_RULE_ONLY_IN_ATTRIBUTES_HELP,
    "e.g. db.password",
  ];

  test("are the field's title, its help on each signal and its placeholder", () => {
    expect(ONLY_IN_WORDS).toEqual([
      "Only in These Attributes",
      "Reads only these attributes, one key a line, or every attribute when empty. The log body is read as Fields to Scrub says.",
      "Reads only these attributes, one key a line, or every attribute when empty. The span name and status message are read as Fields to Scrub says.",
      "e.g. db.password",
    ]);
    expect(LOG_SCRUB_RULE_FORM_OPTIONS.onlyInAttributesHelp).toBe(
      LOG_SCRUB_RULE_ONLY_IN_ATTRIBUTES_HELP,
    );
    expect(TRACE_SCRUB_RULE_FORM_OPTIONS.onlyInAttributesHelp).toBe(
      TRACE_SCRUB_RULE_ONLY_IN_ATTRIBUTES_HELP,
    );
  });

  test("en.json maps every one of them to itself, and the extractor finds them in the form", () => {
    const found: Set<string> = new Set<string>(
      scanSourceRoots([
        {
          directory:
            "packages/App/FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleForm.ts",
          kind: "ui",
        },
      ]).strings.map((entry: ExtractedString): string => {
        return entry.text;
      }),
    );

    for (const text of ONLY_IN_WORDS) {
      expect([text, ENGLISH[text]]).toEqual([text, text]);
      expect([text, found.has(text)]).toEqual([text, true]);
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s has its own words for every one of them, the key kept as written",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const text of ONLY_IN_WORDS) {
        const value: unknown = locale[text];

        expect([text, typeof value]).toEqual([text, "string"]);
        expect([text, (value as string).trim().length > 0]).toEqual([
          text,
          true,
        ]);
        expect([text, value]).not.toEqual([text, text]);
      }

      expect(locale["e.g. db.password"] as string).toContain("db.password");
    },
  );
});
