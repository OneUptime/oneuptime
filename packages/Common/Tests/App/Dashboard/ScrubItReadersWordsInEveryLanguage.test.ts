import {
  NOTHING_LEFT,
  SCRUBBED_TOOLTIP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueTelemetryFindings";
import {
  ALREADY_SCRUBBED,
  SCRUB_IT_SCOPE_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/ScrubItModal";
import { SCRUB_NOTICES } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/TelemetryScrubIt";
import { SCRUB_RULE_READERS_UNCHECKED } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/FieldReaders/ScrubRuleReadersPreview";
import {
  FIELD_READ_OF_KEY,
  FIELD_READ_OF_PART,
  FIELD_READER_CONSEQUENCES,
  FIELD_READER_UNCHECKED,
  FIELD_READERS_HEADING,
  FIELD_READERS_ONLY_HIDDEN,
  SECURITY_EVENTS_LOSSES,
  SECURITY_EVENTS_UNCHECKED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/FieldReaders/TelemetryFieldReadersList";
import {
  LOG_SCRUB_RULE_SERVICE_HELP,
  TRACE_SCRUB_RULE_SERVICE_HELP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleForm";
import {
  ExtractedString,
  scanSourceRoots,
} from "../../../../App/FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../../../App/FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { TelemetryFieldReaderKind } from "../../../Types/Telemetry/TelemetryFieldReaders";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * SCRUB IT'S SCOPE, AND WHAT A SCRUB RULE WOULD BREAK, IN EVERY LANGUAGE
 * (#10433).
 *
 * Scrub It said its rule "masks this data" at "this place": the rule
 * redacted it, in every service. It now says whose records the rule
 * changes and what reads the values it would hide - in its dialog, under
 * the scrub rule form's name, and in a rule's Enable - and that a rule
 * hides, not masks. Each sentence is worded in every one of the seventeen
 * languages besides English, keeping its placeholders, and the sentences it
 * replaced are gone from every locale.
 */

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readLocale("en");

const KINDS: ReadonlyArray<TelemetryFieldReaderKind> = Object.values(
  TelemetryFieldReaderKind,
);

// Every sentence this change wrote, by the file that draws it.
const WORDS_BY_FILE: Record<string, ReadonlyArray<string>> = {
  "Components/DataSecurity/ScrubItModal.tsx": [
    SCRUB_IT_SCOPE_SENTENCES.log.service,
    SCRUB_IT_SCOPE_SENTENCES.log.everyService,
    SCRUB_IT_SCOPE_SENTENCES.trace.service,
    SCRUB_IT_SCOPE_SENTENCES.trace.everyService,
    ALREADY_SCRUBBED,
  ],
  "Components/Telemetry/FieldReaders/TelemetryFieldReadersList.tsx": [
    FIELD_READERS_HEADING,
    ...KINDS.map((kind: TelemetryFieldReaderKind): string => {
      return FIELD_READER_CONSEQUENCES[kind];
    }),
    ...KINDS.map((kind: TelemetryFieldReaderKind): string => {
      return FIELD_READER_UNCHECKED[kind];
    }),
    ...Object.values(FIELD_READ_OF_KEY),
    ...(Object.values(FIELD_READ_OF_PART) as Array<string>),
    ...Object.values(SECURITY_EVENTS_LOSSES),
    SECURITY_EVENTS_UNCHECKED,
    FIELD_READERS_ONLY_HIDDEN[TelemetryFieldReaderKind.SavedView].other,
  ],
  "Components/Telemetry/FieldReaders/ScrubRuleReadersPreview.tsx": [
    SCRUB_RULE_READERS_UNCHECKED,
  ],
  "Components/Telemetry/ScrubRuleForm.ts": [
    LOG_SCRUB_RULE_SERVICE_HELP,
    TRACE_SCRUB_RULE_SERVICE_HELP,
  ],
  "Components/DataSecurity/TelemetryScrubIt.ts": [
    SCRUB_NOTICES.log,
    SCRUB_NOTICES.trace,
  ],
  "Components/DataSecurity/IssueTelemetryFindings.tsx": [
    SCRUBBED_TOOLTIP,
    NOTHING_LEFT,
  ],
  "Pages/DataSecurity/StoreView/Inside.tsx": [
    "A scrub rule hides this data at ingest.",
  ],
};

const WORDS: ReadonlyArray<string> = Object.values(WORDS_BY_FILE).flat();

// The words they replaced, which said "masks" of a rule that redacts.
const RETIRED: ReadonlyArray<string> = [
  "The scrub rule {{name}} now masks this data in new logs.",
  "The scrub rule {{name}} now masks this data in new traces.",
  "A scrub rule masks this data at ingest. What was stored before keeps it until its retention ends.",
  "Nothing is left to scrub: every finding behind this issue is masked at ingest, or no longer seen.",
  "OneUptime adds a scrub rule that masks this kind of data at this place in new telemetry, before it is stored. What is already stored does not change.",
  "A scrub rule masks this data at ingest.",
];

// "Masks", "masked": what a rule that redacts never says it does.
const SAYS_MASK: RegExp = /\bmask/i;

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

describe("Scrub It's scope and what a rule would break, in every language", () => {
  test("the words say a rule hides - never masks - and whose records it changes", () => {
    expect(WORDS.length).toBe(new Set(WORDS).size);

    for (const text of WORDS) {
      expect([text, SAYS_MASK.test(text)]).toEqual([text, false]);
    }

    expect(SCRUB_IT_SCOPE_SENTENCES.log.service).toBe(
      "OneUptime adds a scrub rule to the logs {{service}} sends, before they are stored. Other services' logs stay as they are.",
    );
    expect(SCRUB_IT_SCOPE_SENTENCES.trace.everyService).toBe(
      "OneUptime adds a scrub rule to the spans of every service and app in this project, before they are stored.",
    );
  });

  test("en.json maps every one of them to itself", () => {
    for (const text of WORDS) {
      expect([text, ENGLISH[text]]).toEqual([text, text]);
    }

    // The saved views' count, its one form beside it.
    expect(ENGLISH["{{count}} saved views you can't see_one"]).toBe(
      FIELD_READERS_ONLY_HIDDEN[TelemetryFieldReaderKind.SavedView].one,
    );
  });

  test("the extractor finds every one of them in the file that draws it", () => {
    for (const file of Object.keys(WORDS_BY_FILE)) {
      const found: Set<string> = new Set<string>(
        scanSourceRoots([
          {
            directory: `packages/App/FeatureSet/Dashboard/src/${file}`,
            kind: "ui",
          },
        ]).strings.map((entry: ExtractedString): string => {
          return entry.text;
        }),
      );

      expect({
        file,
        missing: WORDS_BY_FILE[file]!.filter((text: string): boolean => {
          return !found.has(text);
        }),
      }).toEqual({ file, missing: [] });
    }
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
  });

  test.each(TRANSLATED_LOCALES)(
    "%s has its own words for every one of them, keeping their placeholders",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const text of [
        ...WORDS,
        "{{count}} saved views you can't see_one",
      ]) {
        const value: unknown = locale[text];
        const english: string = ENGLISH[text] as string;

        expect([text, typeof value]).toEqual([text, "string"]);
        expect([text, (value as string).trim().length > 0]).toEqual([
          text,
          true,
        ]);
        expect([text, value]).not.toEqual([text, english]);
        expect([text, placeholdersOf(value as string)]).toEqual([
          text,
          placeholdersOf(english),
        ]);
      }
    },
  );
});
