import fs from "fs";
import path from "path";
import CompareCriteria from "../../../Server/Utils/Monitor/Criteria/CompareCriteria";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import {
  EvaluationSentence,
  EvaluationSentenceValue,
  englishOfEvaluationSentence,
  evaluationTerm,
  translatableSentence,
  withCurrentTemplates,
  wordStoredEvaluationText,
} from "../../../Types/Monitor/EvaluationSentence";
import {
  RETIRED_EVALUATION_TEMPLATES,
  currentEvaluationTemplate,
} from "../../../Types/Monitor/RetiredEvaluationTemplates";
import MonitorRootCauseWording from "../../../Utils/Monitor/MonitorRootCauseWording";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { describe, expect, test } from "@jest/globals";

/*
 * THE TEMPLATES THE MONITOR ENGINE NO LONGER WRITES (issue #6581).
 *
 * Incidents, alerts and evaluation logs written before a finding was
 * reworded hold its old template, and the old key has left the locale
 * files. Each retired template is read through the one in its place
 * (RetiredEvaluationTemplates), so an old finding reads in the reader's
 * language, in the new words: here, that every one has a place to go that
 * says the same with the same placeholders, that the place is a key each
 * language words, and that an old record reads so - in the evaluation log
 * and in the root cause.
 */

const RETIRED: Array<[string, string]> = Array.from(
  RETIRED_EVALUATION_TEMPLATES.entries(),
);

const REPOSITORY: string = path.resolve(__dirname, "../../../..");

// Where the engine and the readers of its sentences live.
const SOURCE_ROOTS: ReadonlyArray<string> = [
  "Common/Server",
  "Common/Types",
  "Common/Utils",
  "Common/UI",
  "App/FeatureSet",
  "MobileApp/src",
  "Probe",
];

const SKIPPED: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Locales",
  "Tests",
  "public",
]);

function listSourceFiles(directory: string, files: Array<string>): void {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) {
      continue;
    }

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      listSourceFiles(full, files);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
}

// An old record: what the engine stored before #6581, as it stored it.
function storedBefore(sentence: EvaluationSentence): EvaluationSentence {
  const retired: Array<string> = RETIRED.filter(
    (pair: [string, string]): boolean => {
      return pair[1] === sentence.template;
    },
  ).map((pair: [string, string]): string => {
    return pair[0];
  });

  expect(retired).toHaveLength(1);

  return JSON.parse(
    JSON.stringify({ ...sentence, template: retired[0] }),
  ) as EvaluationSentence;
}

function textFinding(
  filterType: FilterType,
  threshold: string,
): {
  english: string;
  sentence: EvaluationSentence;
} {
  const sentence: EvaluationSentence = CompareCriteria.getCompareSentence({
    values: "status: degraded",
    threshold: threshold,
    criteriaFilter: {
      checkOn: CheckOn.ResultValue,
      filterType: filterType,
      value: threshold,
    },
  });

  return { english: englishOfEvaluationSentence(sentence), sentence };
}

describe("each retired template has one in its place", () => {
  test("the list is not empty, and names the fifteen #6581 retired", () => {
    expect(RETIRED).toHaveLength(15);
  });

  test.each(RETIRED)(
    "%s -> its current template says it with the same placeholders",
    (retired: string, current: string) => {
      expect(current).not.toBe(retired);
      expect(placeholdersOf(current)).toEqual(placeholdersOf(retired));
      expect(currentEvaluationTemplate(retired)).toBe(current);
    },
  );

  test("a current template is never itself retired: one step reaches the words", () => {
    for (const [, current] of RETIRED) {
      expect(RETIRED_EVALUATION_TEMPLATES.has(current)).toBe(false);
      expect(currentEvaluationTemplate(current)).toBe(current);
    }
  });

  test("a template that was never retired reads as it is", () => {
    for (const template of [
      "{{subject}} is {{value}}.",
      "Response Status Code was {{code}}.",
      "",
    ]) {
      expect(currentEvaluationTemplate(template)).toBe(template);
    }
  });

  test("each current template is an English Dashboard key; no retired one is", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const [retired, current] of RETIRED) {
      expect({ current, key: english[current] }).toEqual({
        current,
        key: current,
      });
      expect({ retired, key: english[retired] }).toEqual({
        retired,
        key: undefined,
      });
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each current template, and holds no retired key",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);
      const unworded: Array<string> = [];
      const leftOver: Array<string> = [];

      for (const [retired, current] of RETIRED) {
        if (!isWordedInDashboardLocale(current, language)) {
          unworded.push(current);
        }

        if (Object.prototype.hasOwnProperty.call(locale, retired)) {
          leftOver.push(retired);
        }
      }

      expect({ language, unworded, leftOver }).toEqual({
        language,
        unworded: [],
        leftOver: [],
      });
    },
  );

  test("no code writes a retired template again", () => {
    const files: Array<string> = [];

    for (const root of SOURCE_ROOTS) {
      listSourceFiles(path.join(REPOSITORY, root), files);
    }

    // The engine's own files are among those read.
    expect(
      files.some((file: string): boolean => {
        return file.endsWith(path.join("Criteria", "CompareCriteria.ts"));
      }),
    ).toBe(true);
    expect(
      files.some((file: string): boolean => {
        return file.endsWith(path.join("Criteria", "APIRequestCriteria.ts"));
      }),
    ).toBe(true);

    const writers: Array<string> = [];

    for (const file of files) {
      if (file.endsWith("RetiredEvaluationTemplates.ts")) {
        continue;
      }

      const code: string = fs.readFileSync(file, "utf8");

      for (const [retired] of RETIRED) {
        for (const quote of ['"', "'", "`"]) {
          if (code.includes(`${quote}${retired}${quote}`)) {
            writers.push(`${path.relative(REPOSITORY, file)}: ${retired}`);
          }
        }
      }
    }

    expect(writers).toEqual([]);
  });
});

describe("a stored sentence reads through its current templates", () => {
  test("a sentence with no retired template is the same object", () => {
    const sentence: EvaluationSentence = translatableSentence(
      "{{subject}} is {{value}}.",
      { subject: evaluationTerm("Result Value"), value: "ok" },
    );

    expect(withCurrentTemplates(sentence)).toBe(sentence);
  });

  test("a retired template is replaced, its values kept, the stored record untouched", () => {
    const stored: EvaluationSentence = {
      template: "{{subject}} is {{values}} which is contains {{threshold}}.",
      values: {
        subject: evaluationTerm("Response Body"),
        values: "<html>",
        threshold: "App Title",
      },
    };
    const before: string = JSON.stringify(stored);
    const current: EvaluationSentence = withCurrentTemplates(stored);

    expect(current).not.toBe(stored);
    expect(current.template).toBe(
      "{{subject}} is {{values}}, which contains {{threshold}}.",
    );
    expect(current.values).toBe(stored.values);
    expect(JSON.stringify(stored)).toBe(before);
  });

  test("a retired template in a part, however deep, is replaced too", () => {
    const part: EvaluationSentence = {
      template: "Response header threshold contains {{text}}.",
      values: { text: "miss" },
    };
    const untouched: EvaluationSentence = translatableSentence(
      "{{subject}} is {{value}}.",
      { subject: evaluationTerm("Result Value"), value: "ok" },
    );
    const stored: EvaluationSentence = {
      template: "{{first}} {{second}}",
      values: {
        first: { template: "{{inner}}", values: { inner: part } },
        second: untouched,
      },
    };
    const before: string = JSON.stringify(stored);
    const current: EvaluationSentence = withCurrentTemplates(stored);
    const first: EvaluationSentence = (current.values || {})[
      "first"
    ] as EvaluationSentence;
    const inner: EvaluationSentenceValue = (first.values || {})["inner"]!;

    expect(current.template).toBe("{{first}} {{second}}");
    expect((inner as EvaluationSentence).template).toBe(
      "A response header has the value {{text}}.",
    );
    // A part with nothing retired is the same object.
    expect((current.values || {})["second"]).toBe(untouched);
    expect(JSON.stringify(stored)).toBe(before);
    expect(englishOfEvaluationSentence(current)).toBe(
      "A response header has the value miss. Result Value is ok.",
    );
  });

  test("the bare retired fallback reads as a whole sentence", () => {
    const stored: EvaluationSentence = {
      template: "{{subject}} is {{values}} which is",
      values: { subject: evaluationTerm("Result Value"), values: "ok" },
    };

    expect(
      wordStoredEvaluationText({
        english: "Result Value is ok which is",
        sentence: stored,
        translator: dashboardTranslator("en"),
      }),
    ).toBe("Result Value is ok.");
  });
});

describe("an old finding reads in the reader's language", () => {
  const CASES: Array<[string, FilterType, string]> = [
    ["Contains", FilterType.Contains, "degraded"],
    ["Not Contains", FilterType.NotContains, "ok"],
    ["Starts With", FilterType.StartsWith, "status"],
    ["Ends With", FilterType.EndsWith, "degraded"],
    ["Equal To", FilterType.EqualTo, "status: degraded"],
  ];

  test.each(CASES)(
    "%s: an old record reads as a new one does, in German and in English",
    (_name: string, filterType: FilterType, threshold: string) => {
      const now: { english: string; sentence: EvaluationSentence } =
        textFinding(filterType, threshold);
      const old: EvaluationSentence = storedBefore(now.sentence);
      // The English the engine stored with it, before #6581.
      const oldEnglish: string = englishOfEvaluationSentence(old);

      expect(oldEnglish).toContain(" which is ");
      expect(oldEnglish).not.toBe(now.english);

      for (const language of ["de", "en", "ar", "ja"]) {
        const fromOld: string = wordStoredEvaluationText({
          english: oldEnglish,
          sentence: old,
          translator: dashboardTranslator(language),
        });
        const fromNew: string = wordStoredEvaluationText({
          english: now.english,
          sentence: now.sentence,
          translator: dashboardTranslator(language),
        });

        expect({ language, fromOld }).toEqual({ language, fromOld: fromNew });
        expect(fromOld).not.toBe(oldEnglish);
      }
    },
  );

  test("an old record a language would read in English without the alias (the control)", () => {
    const now: { english: string; sentence: EvaluationSentence } = textFinding(
      FilterType.Contains,
      "degraded",
    );
    const old: EvaluationSentence = storedBefore(now.sentence);
    const german: Record<string, string> = readDashboardLocale("de");

    // The old key is gone from the locale: read as stored, it is English.
    expect(german[old.template]).toBeUndefined();
    expect(german[now.sentence.template]).toBeDefined();
  });

  test("an old response header finding reads in German", () => {
    const old: EvaluationSentence = {
      template: "Response header threshold does not contain {{text}}.",
      values: { text: "hit" },
    };

    expect(
      wordStoredEvaluationText({
        english: "Response header threshold does not contain hit.",
        sentence: old,
        translator: dashboardTranslator("de"),
      }),
    ).toBe("Kein Antwort-Header hat den Wert hit.");
    expect(
      wordStoredEvaluationText({
        english: "Response header contains x-cache.",
        sentence: {
          template: "Response header contains {{text}}.",
          values: { text: "x-cache" },
        },
        translator: dashboardTranslator("de"),
      }),
    ).toBe("Die Antwort hat den Header x-cache.");
  });

  test("an old root cause's finding line reads in German, the rest of it as stored", () => {
    const now: { english: string; sentence: EvaluationSentence } = textFinding(
      FilterType.Contains,
      "degraded",
    );
    const old: EvaluationSentence = storedBefore(now.sentence);
    const oldEnglish: string = englishOfEvaluationSentence(old);
    const rootCauseSaying: (finding: string) => string = (
      finding: string,
    ): string => {
      return [
        "**Created because the following criteria was met**:",
        "",
        "**Criteria Name**: Degraded",
        "",
        `**Filter Conditions Met**: ${finding}`,
      ].join("\n");
    };
    const rootCause: string = rootCauseSaying(oldEnglish);

    const worded: string = MonitorRootCauseWording.wordRootCause({
      rootCause: rootCause,
      translator: dashboardTranslator("de"),
      findings: [{ message: oldEnglish, messageSentence: old }],
    });
    // A root cause written since #6581, read in German.
    const wordedNow: string = MonitorRootCauseWording.wordRootCause({
      rootCause: rootCauseSaying(now.english),
      translator: dashboardTranslator("de"),
      findings: [{ message: now.english, messageSentence: now.sentence }],
    });
    const lines: Array<string> = worded.split("\n");

    expect(worded).toBe(wordedNow);
    expect(lines).toHaveLength(5);
    expect(lines[4]).not.toContain(oldEnglish);
    expect(lines[4]).not.toContain("which");
    expect(lines[4]).not.toContain("contains");
    // The criteria's own name reads as written.
    expect(lines[2]).toContain("Degraded");

    // An English reader reads the root cause as it was stored.
    expect(
      MonitorRootCauseWording.wordRootCause({
        rootCause: rootCause,
        translator: dashboardTranslator("en"),
        findings: [{ message: oldEnglish, messageSentence: old }],
      }),
    ).toBe(rootCause);
  });
});
