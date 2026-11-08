import {
  ExtractedString,
  scanSourceRoots,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  LocaleProgress,
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN EVENT'S METRIC INVESTIGATION IN THE READER'S LANGUAGE (#6304).
 *
 * The metric card of an incident, an alert or an episode - on its Overview,
 * and beside the root cause on an incident's and an alert's Root Cause
 * page - shares its words: the time picker and the ranges around the event
 * ("Around the start", "The hour before it started", "What the monitor
 * saw"), Edit metrics, the links' and Reset's tooltips, the note that the
 * charts are the monitor's as it reads them now, and the moments and the
 * shaded window on the charts. A log, trace or exception card's picker
 * (EventTimeRangeControls) offers the same ranges. Some thirty of them were
 * English in all sixteen languages, so a German or a Japanese Root Cause
 * page read "Around the start", "Edit metrics" and "What the monitor saw"
 * in English around its own words. Every string these components and the
 * helpers that name the ranges and moments draw (as `npm run i18n:extract`
 * finds them) is worded now in each of the sixteen languages besides
 * English, as the toolchain counts it (`npm run i18n:check`): a value of
 * its own, or the same English the language keeps on purpose (the
 * same-as-English lists), or text with no words, or a "one" form a
 * language never reads.
 *
 * And the way back names the range it goes back to as that range is
 * named: "Go back to what the monitor saw" says "what the monitor saw" in
 * the words of the range "What the monitor saw", in every language.
 *
 * A word added to these cards later is translated with it, or fails here.
 */

const DASHBOARD_SRC: string = "packages/App/FeatureSet/Dashboard/src";

const INVESTIGATION_ROOTS: Array<SourceRoot> = [
  `${DASHBOARD_SRC}/Components/Metrics/Investigation`,
  `${DASHBOARD_SRC}/Components/Telemetry/EventMetricInvestigationPanel.tsx`,
  `${DASHBOARD_SRC}/Components/Telemetry/EventTimeRangeControls.tsx`,
  `${DASHBOARD_SRC}/Components/Telemetry/EventRootCauseMetricChart.tsx`,
  `${DASHBOARD_SRC}/Components/Incident/IncidentRootCauseMetricChart.tsx`,
  `${DASHBOARD_SRC}/Components/Alert/AlertRootCauseMetricChart.tsx`,
  `${DASHBOARD_SRC}/Utils/EventTimePresets.ts`,
  `${DASHBOARD_SRC}/Utils/EventMetricInvestigation.ts`,
].map((directory: string): SourceRoot => {
  return { directory: directory, kind: "ui" };
});

// Languages whose plurals have no "one" form: their "_one" key is never read.
const LANGUAGES_WITHOUT_ONE: ReadonlyArray<string> = [
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
];

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readLocale("en");
const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

interface InvestigationKey {
  key: string;
  file: string;
}

// Every key the cards read: each text, and a plural's "one" form.
function getInvestigationKeys(): Array<InvestigationKey> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(INVESTIGATION_ROOTS).strings) {
    if (entry.nestedPath) {
      continue;
    }

    const found: ExtractedString = entry;

    if (!keys.has(found.text)) {
      keys.set(found.text, found.file);
    }

    if (found.pluralOne !== undefined && !keys.has(`${found.text}_one`)) {
      keys.set(`${found.text}_one`, found.file);
    }
  }

  return Array.from(keys.entries()).map(
    ([key, file]: [string, string]): InvestigationKey => {
      return { key, file };
    },
  );
}

const INVESTIGATION_KEYS: Array<InvestigationKey> = getInvestigationKeys();

// Whether `language` words `key` its own way, as npm run i18n:check counts it.
function isWorded(data: {
  key: string;
  language: string;
  locale: Record<string, unknown>;
  sameAsEnglish: Set<string>;
}): boolean {
  const english: unknown = ENGLISH[data.key];
  const value: unknown = data.locale[data.key];

  if (typeof english !== "string" || typeof value !== "string") {
    return false;
  }

  if (!value.trim()) {
    return false;
  }

  if (value !== english) {
    return true;
  }

  if (
    data.key.endsWith("_one") &&
    LANGUAGES_WITHOUT_ONE.includes(data.language)
  ) {
    return true;
  }

  if (!LETTER.test(english.replace(PLACEHOLDER, ""))) {
    return true;
  }

  return GLOBAL_SAME_AS_ENGLISH.has(english) || data.sameAsEnglish.has(english);
}

const WHAT_THE_MONITOR_SAW: string = "What the monitor saw";
const BACK_TO_WHAT_THE_MONITOR_SAW: string = "Go back to what the monitor saw";

/*
 * What a range's name says once its first word is set aside: grammar
 * changes a sentence's first word ("То, что видел монитор" is "к тому, что
 * видел монитор" after "back to"), not the words that name what the
 * monitor saw. A name written without spaces (Chinese, Japanese) is kept
 * whole.
 */
function namingWords(name: string): string {
  const words: Array<string> = name.trim().split(/\s+/);

  return (words.length > 1 ? words.slice(1).join(" ") : name)
    .trim()
    .toLocaleLowerCase();
}

describe("an event's metric investigation in every language", () => {
  test("the cards draw words, every one of them in English", () => {
    // The scan finds the cards' words, and each is an en.json key.
    expect(INVESTIGATION_KEYS.length).toBeGreaterThan(40);
    expect(
      INVESTIGATION_KEYS.filter((entry: InvestigationKey): boolean => {
        return typeof ENGLISH[entry.key] !== "string";
      }),
    ).toEqual([]);

    const keys: Set<string> = new Set<string>(
      INVESTIGATION_KEYS.map((entry: InvestigationKey): string => {
        return entry.key;
      }),
    );

    // The words this pass worded, among them.
    for (const key of [
      // The ranges around the event, and their headings.
      "Around this alert",
      "Around this incident",
      "Around this episode",
      "Around the start",
      "The hour before it started",
      "The day before it started",
      "Start to now",
      "Start to resolution",
      WHAT_THE_MONITOR_SAW,
      "Relative to now",
      "Suggested",
      // The card's toolbar, and the tooltips of its links and Reset.
      "Edit metrics",
      "Copy a link to these charts",
      "Go back to the metrics and time range you started from",
      "Copy a link to this time range",
      BACK_TO_WHAT_THE_MONITOR_SAW,
      // The note that the charts are the monitor's as it reads them now.
      "Charted for {{resource}}, which this monitor checks now.",
      "Charted for what this monitor checks now.",
      "The metrics you picked. Reset brings back the metrics the monitor watched.",
      // What the charts mark.
      "What the monitor evaluated when it opened this alert.",
      "State changed",
      // The Root Cause card, while it reads.
      "Metrics for this alert.",
      "Metrics related to this incident.",
    ]) {
      expect({ key, found: keys.has(key) }).toEqual({ key, found: true });
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s words every one of them",
    (language: string) => {
      const progress: LocaleProgress | undefined = readLocaleProgress(language);
      const sameAsEnglish: Set<string> = new Set<string>(
        progress ? progress.sameAsEnglish : [],
      );
      const locale: Record<string, unknown> = readLocale(language);

      const unworded: Array<string> = INVESTIGATION_KEYS.filter(
        (entry: InvestigationKey): boolean => {
          return !isWorded({
            key: entry.key,
            language,
            locale,
            sameAsEnglish,
          });
        },
      ).map((entry: InvestigationKey): string => {
        return `${entry.key} (${path.basename(entry.file)})`;
      });

      expect(unworded).toEqual([]);
    },
  );

  test("the English way back names the range as the range is named", () => {
    expect(BACK_TO_WHAT_THE_MONITOR_SAW.toLocaleLowerCase()).toContain(
      namingWords(WHAT_THE_MONITOR_SAW),
    );
  });

  test.each(TRANSLATED_LOCALES)(
    "%s names the way back to what the monitor saw in the words of that range",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const name: string = String(locale[WHAT_THE_MONITOR_SAW]);
      const back: string = String(locale[BACK_TO_WHAT_THE_MONITOR_SAW]);

      // Both worded: neither is the English placeholder.
      expect(name).not.toBe(WHAT_THE_MONITOR_SAW);
      expect(back).not.toBe(BACK_TO_WHAT_THE_MONITOR_SAW);
      expect({
        language,
        name,
        back,
        namesTheRange: back.toLocaleLowerCase().includes(namingWords(name)),
      }).toEqual({ language, name, back, namesTheRange: true });
    },
  );
});
