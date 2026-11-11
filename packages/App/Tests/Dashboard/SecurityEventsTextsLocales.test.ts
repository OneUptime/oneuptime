import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { getDefaultContext } from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import {
  ConnectorField,
  ConnectorFieldOption,
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";

/*
 * THE SECURITY EVENTS TEXTS (#6658, part 2), IN EVERY LANGUAGE - read from
 * the Dashboard's shipped locale files.
 *
 * Connection diagnostics, the connection test and its report, the connection
 * form, the setup guide, the event panels, the attribute column picker, the
 * Correlate builder and the Security Case entities card used to draw their
 * sentences as written, or glue them from English pieces ("Find historical "
 * + "detections", "Preview " + recordName + "s"). Now every one is looked up
 * whole, so each must be worded in the languages the Dashboard ships: a
 * sentence left in English is a German, Japanese or Arabic reader meeting
 * English again.
 *
 * Since #6700 and #6702 that is every Dashboard language, not only German,
 * Spanish, French, Japanese and Arabic, and the connection form's own words
 * from the connector catalog - each provider's description, each setting's
 * title, description and choices - are keys too. And since #6781 a Russian
 * sentence never puts the records a connector imports (a nominative plural:
 * "оповещения", "записи") after a word that wants another case.
 */

const CONTEXT: ReturnType<typeof getDefaultContext> = getDefaultContext();
const REPOSITORY_ROOT: string = CONTEXT.repositoryRoot;
const DASHBOARD: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard",
);

// Every language besides English.
const LANGUAGES: Array<string> = CONTEXT.locales.slice();

// Languages with one plural form: their "_one" keys are never read.
const ONE_FORM_LANGUAGES: ReadonlySet<string> = new Set([
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
]);

// The files this change routed through the translator.
const DASHBOARD_FILES: Array<string> = [
  "Components/SecurityCase/SecurityCaseEntitiesCard.tsx",
  "Components/SecurityEvents/ConnectionTestModal.tsx",
  "Components/SecurityEvents/ConnectorTestReportView.tsx",
  "Components/SecurityEvents/CorrelateFilterBuilder.tsx",
  "Components/SecurityEvents/CorrelateFilterChips.tsx",
  "Components/SecurityEvents/SecurityEventAttributeColumnPicker.tsx",
  "Components/SecurityEvents/SecurityEventConnectionDiagnostics.tsx",
  "Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil.ts",
  "Components/SecurityEvents/SecurityEventConnectionFormModal.tsx",
  "Components/SecurityEvents/SecurityEventConnectionRunDetails.tsx",
  "Components/SecurityEvents/SecurityEventConnectionsTable.tsx",
  "Components/SecurityEvents/SecurityEventDetail.tsx",
  "Components/SecurityEvents/SecurityEventDetailPanel.tsx",
  "Components/SecurityEvents/SecurityEventListRow.tsx",
  "Components/SecurityEvents/SecurityEventsFacets.ts",
  "Components/SecurityEvents/SecurityEventsSetupGuide.tsx",
  "Components/SecurityEvents/SecurityEventsViewer.tsx",
];

/*
 * The connector catalog: the Google SecOps "Data to import" control the
 * diagnostics quote, and every word the connection form draws from it.
 */
const COMMON_FILES: Array<string> = [
  "packages/Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog.ts",
];

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readLocale(language: string): Record<string, string> {
  return readJson(
    path.join(DASHBOARD, `src/Locales/${language}.json`),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

const GLOBAL_SAME_AS_ENGLISH: Array<string> = readJson(
  path.join(DASHBOARD, "i18n/SameAsEnglish.json"),
) as Array<string>;

// What reads the same as English in every language, and in this one.
function keptAsWritten(language: string): Set<string> {
  const progress: { sameAsEnglish?: Array<string> } = readJson(
    path.join(DASHBOARD, `i18n/Progress/${language}.json`),
  ) as { sameAsEnglish?: Array<string> };

  return new Set([
    ...GLOBAL_SAME_AS_ENGLISH,
    ...(progress.sameAsEnglish || []),
  ]);
}

function scan(file: string, kind: "ui" | "keys"): Array<ExtractedString> {
  return scanSourceText(
    path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
    fs.readFileSync(file, "utf8"),
    { kind },
  ).strings;
}

// Every key the files look up: a plural's general sentence and its "_one".
function getKeys(): Array<string> {
  const keys: Set<string> = new Set<string>();
  const strings: Array<ExtractedString> = [
    ...DASHBOARD_FILES.flatMap((file: string): Array<ExtractedString> => {
      return scan(path.join(DASHBOARD, "src", file), "ui");
    }),
    ...COMMON_FILES.flatMap((file: string): Array<ExtractedString> => {
      return scan(path.join(REPOSITORY_ROOT, file), "keys");
    }),
  ];

  for (const entry of strings) {
    keys.add(entry.text);

    if (entry.pluralOne !== undefined) {
      keys.add(`${entry.text}_one`);
    }
  }

  return [...keys].sort();
}

const KEYS: Array<string> = getKeys();

// The keys a language still holds in English, without recording them so.
function untranslated(language: string, keys: Array<string>): Array<string> {
  const locale: Record<string, string> = readLocale(language);
  const same: Set<string> = keptAsWritten(language);

  return keys.filter((key: string): boolean => {
    if (ENGLISH[key] === undefined) {
      return false;
    }

    if (ONE_FORM_LANGUAGES.has(language) && key.endsWith("_one")) {
      return false;
    }

    // The progress files record the English a language keeps, not its key.
    return locale[key] === ENGLISH[key] && !same.has(ENGLISH[key]!);
  });
}

const PLACEHOLDER: RegExp = /\{\{\s*([^}\s]+)\s*\}\}/g;

function placeholders(text: string): Array<string> {
  return [
    ...new Set(
      [...text.matchAll(PLACEHOLDER)].map((match: RegExpMatchArray): string => {
        return match[1] as string;
      }),
    ),
  ].sort();
}

/*
 * The sentences this change worded whole: each is listed so a key renamed in
 * the source without a translation fails here by name, not only as a count.
 */
const SENTENCES_THIS_CHANGE_WORDED: Array<string> = [
  // Connection diagnostics.
  "Connection diagnostics: {{name}}",
  "Check access, inspect what {{provider}} returns, and review imports. Times are shown in UTC; hover a time for your local clock.",
  "Enabled, every {{count}} minutes",
  "Enabled, every {{count}} minutes_one",
  "Find historical {{records}}",
  "Preview {{records}}",
  "Import {{what}} from {{start}} to {{end}} into OneUptime? Imported events become available to security rules and monitors. Already imported {{records}} are skipped.",
  "To import {{nonAlerting}} too, select {{nonAlertingLabel}} under {{control}} using Edit connection.",
  "Only {{alerting}} are imported with this {{control}} selection; select {{nonAlerting}} to import the rest.",
  "Requested window: {{start}} → {{end}}",
  "Local time: {{time}}",
  "{{time}} (approximate)",
  "Up to {{window}}",
  "{{window}}, the same length",
  "Choose a time range of 7 days or less.",
  "The start time must be before the end time.",
  "The end time must not be in the future.",
  "Polling, no events imported yet",
  // Run history's first column: what kind of run a row is ("Typ"), not "Run".
  "Type",
  "Poll overdue",
  "Schedule paused",
  "Catching up",
  // The connection test and its report.
  "Check access to {{provider}}, what it has available to import, and whether OneUptime's workers are running — before saving. Nothing is stored or imported.",
  "Checking access, availability and OneUptime workers…",
  "The settings changed after the last test. Test again to check the values the form holds now.",
  "The server did not return a test report. Check the API logs and try again.",
  "Test connection: {{name}}",
  "{{provider}} · completed {{time}}",
  "All checks passed",
  "Passed with warnings",
  "Some checks failed",
  "{{value}} s",
  // The connection form.
  "Paste the {{fields}} to test these settings before saving. A saved connection can be tested from its row's Test connection action.",
  "Enter the {{fields}} to test these settings before saving. A saved connection can be tested from its row's Test connection action.",
  "Choose a provider before testing.",
  "{{product}} settings",
  "{{product}} credentials",
  "{{product}} setup guide",
  "Values from your {{vendor}} console. The setup guide explains where each one lives.",
  "Remove the stored {{field}}",
  "Delete the stored {{field}} when you save, for example after changing the sign-in method.",
  "Update credentials: {{name}}",
  "Edit connection: {{name}}",
  "Replace the stored {{provider}} credentials. Blank fields keep their stored value.",
  "{{provider}} connection. The provider cannot be changed after creation; add a new connection to import from another product.",
  // The records a connector imports, named inside the sentences above.
  "audit events",
  "findings",
  "log events",
  "notable events",
  "the provider",
  // Google SecOps' Data to import control.
  "Alerts and detections",
  "Google's alerts API always includes alerts.",
  // The setup guide, and its endpoint's label handed to the key picker.
  "Security Events Ingest Endpoint",
  "Send Your Events",
  "Verify It Is Working",
  "Put The Events To Work",
  "Security events are flowing! {{count}} new events since you opened this guide.",
  "Security events are flowing! {{count}} new events since you opened this guide._one",
  "The dialect is detected per event when you leave {{format}} off, so one webhook can mix detection alerts with raw events.",
  "{{link}} pivots from any observable — a user, host or IP — to everything else that mentions it.",
  // The event panels, the column picker and the Correlate builder.
  'Correlate "{{observable}}"',
  "Show {{key}} on event rows",
  "Stop showing {{key}} on event rows",
  "Showing {{shown}} of {{total}} matching attributes. Keep typing to narrow.",
  "Move {{key}} up",
  "Move {{key}} down",
  "Add {{key}}",
  "Remove {{key}}",
  "Condition {{number}} field",
  "Condition {{number}} operator",
  "Condition {{number}} value",
  "Security event",
  // The event list's facets.
  "Principal Users",
  "Principal Hosts",
  "Parent Processes",
  "Request Outcomes",
];

describe("the Security Events texts in every language", () => {
  test("the files are read: hundreds of keys, every one in en.json", () => {
    expect(KEYS.length).toBeGreaterThan(400);

    const notInEnglish: Array<string> = KEYS.filter((key: string): boolean => {
      return ENGLISH[key] === undefined;
    });

    expect(notInEnglish).toEqual([]);
  });

  test("every Dashboard language words every key the files look up, Arabic included", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toEqual(expect.arrayContaining(["ar", "fa", "hi", "ru"]));

    // Every language's gaps at once, so a failure names them all.
    const missing: Record<string, Array<string>> = {};

    for (const language of LANGUAGES) {
      const keys: Array<string> = untranslated(language, KEYS);

      if (keys.length > 0) {
        missing[language] = keys;
      }
    }

    expect(missing).toEqual({});
  });

  test("every language words each sentence this change worded, with its placeholders", () => {
    // The list names keys that exist, and that the files look up.
    const unknown: Array<string> = SENTENCES_THIS_CHANGE_WORDED.filter(
      (key: string): boolean => {
        return ENGLISH[key] === undefined || !KEYS.includes(key);
      },
    );

    expect(unknown).toEqual([]);

    const missing: Record<string, Array<string>> = {};
    const wrongPlaceholders: Array<string> = [];

    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);
      const keys: Array<string> = untranslated(
        language,
        SENTENCES_THIS_CHANGE_WORDED,
      );

      if (keys.length > 0) {
        missing[language] = keys;
      }

      for (const key of SENTENCES_THIS_CHANGE_WORDED) {
        if (ONE_FORM_LANGUAGES.has(language) && key.endsWith("_one")) {
          continue;
        }

        const worded: Array<string> = placeholders(locale[key]!);
        const english: Array<string> = placeholders(ENGLISH[key]!);

        if (worded.join(",") !== english.join(",")) {
          wrongPlaceholders.push(
            `${language} ${key}: ${worded.join(",")} (English ${english.join(",")})`,
          );
        }
      }
    }

    expect(missing).toEqual({});
    expect(wrongPlaceholders).toEqual([]);
  });

  test("no glued English is left: the records a connector imports are worded whole in each sentence", () => {
    // The old source built these from pieces; none of the pieces is a key.
    for (const piece of [
      "Find historical ",
      "Preview ",
      "Enabled, every ",
      "Test connection: ",
      "Connection diagnostics: ",
    ]) {
      expect({ piece, key: ENGLISH[piece] }).toEqual({
        piece,
        key: undefined,
      });
    }

    // The German sentences carry the record names inside them.
    const german: Record<string, string> = readLocale("de");

    expect(german["Find historical {{records}}"]).toContain("{{records}}");
    expect(german["Preview {{records}}"]).toContain("{{records}}");
    expect(german["Find historical {{records}}"]).not.toBe(
      "Find historical {{records}}",
    );
  });

  // A placeholder showing a value to type: digits, an address, a query, JSON.
  const VALUE_TO_TYPE: RegExp = /[0-9./=@{"-]/;
  // A choice that is a code, such as a region's: europe-west2.
  const CODE: RegExp = /^[a-z0-9-]+$/;

  test("the connection form's words from the catalog are keys, worded in every language", () => {
    const words: Set<string> = new Set<string>();
    const asWritten: Array<string> = [];

    for (const definition of SecurityEventConnectorCatalog as Array<SecurityEventConnectorDefinition>) {
      words.add(definition.description);

      for (const field of [
        ...definition.configFields,
        ...definition.secretFields,
      ] as Array<ConnectorField>) {
        words.add(field.title);
        words.add(field.description);

        /*
         * A placeholder that shows a value to type - an ID, an address, a
         * query, a region code - is drawn as written; one written in words
         * is a key.
         */
        if (field.placeholder !== undefined) {
          if (VALUE_TO_TYPE.test(field.placeholder)) {
            asWritten.push(field.placeholder);
          } else {
            words.add(field.placeholder);
          }
        }

        /*
         * A choice that names a host (CrowdStrike's clouds) or is a code
         * (Google SecOps' regions, europe-west2) is drawn as written.
         */
        for (const option of (field.options ||
          []) as Array<ConnectorFieldOption>) {
          if (option.label.includes(".") || CODE.test(option.label)) {
            asWritten.push(option.label);
          } else {
            words.add(option.label);
          }
        }
      }
    }

    // Ten providers' descriptions and their settings, not a handful.
    expect(words.size).toBeGreaterThan(80);
    expect(words).toContain("Select a region");
    expect(words).toContain("Azure Government (US), DoD");
    expect(asWritten).toContain("US-1 (api.crowdstrike.com)");
    expect(asWritten).toContain("europe-west2");
    expect(asWritten).toContain("00000000-0000-0000-0000-000000000000");

    // Each is marked in the catalog, so the extractor reads it into en.json.
    const unmarked: Array<string> = [...words].filter(
      (word: string): boolean => {
        return !KEYS.includes(word) || ENGLISH[word] !== word;
      },
    );

    expect(unmarked).toEqual([]);

    const missing: Record<string, Array<string>> = {};

    for (const language of LANGUAGES) {
      const keys: Array<string> = untranslated(language, [...words]);

      if (keys.length > 0) {
        missing[language] = keys;
      }
    }

    expect(missing).toEqual({});
  });

  /*
   * A Russian sentence names the records a connector imports in the
   * nominative plural the locale words them in. After "больше" or "нет",
   * after a preposition, or after an adjective in another case ("более
   * старым"), Russian wants the genitive or the dative - "больше
   * оповещений" - which the filled sentence cannot give: #6781.
   */
  const RUSSIAN_RECORDS_PLACEHOLDERS: Array<string> = [
    "records",
    "alerting",
    "nonAlerting",
  ];

  const RUSSIAN_WORDS_WANTING_ANOTHER_CASE: ReadonlySet<string> = new Set([
    "больше",
    "меньше",
    "много",
    "мало",
    "нет",
    "сколько",
    "несколько",
    "без",
    "для",
    "из",
    "от",
    "до",
    "у",
    "к",
    "по",
    "с",
    "со",
    "о",
    "об",
    "при",
    "над",
    "под",
    "перед",
    "между",
    "среди",
    "около",
    "кроме",
    "вместо",
    "после",
  ]);

  // An adjective in a case other than the nominative plural: старым, новых.
  const RUSSIAN_OBLIQUE_ADJECTIVE: RegExp = /(?:ым|им|ых|их|ыми|ими|ому|ему)$/;

  // Where a Russian sentence puts a records word after a word wanting another case.
  function russianCaseProblems(sentence: string): Array<string> {
    const problems: Array<string> = [];

    for (const name of RUSSIAN_RECORDS_PLACEHOLDERS) {
      const parts: Array<string> = sentence.split(`{{${name}}}`);

      parts.slice(0, -1).forEach((before: string): void => {
        const words: Array<string> = before
          .toLowerCase()
          .split(/[\s«»"(),;:]+/)
          .filter(Boolean);
        const previous: string = words[words.length - 1] || "";

        if (
          RUSSIAN_WORDS_WANTING_ANOTHER_CASE.has(previous) ||
          RUSSIAN_OBLIQUE_ADJECTIVE.test(previous)
        ) {
          problems.push(`${previous} {{${name}}}`);
        }
      });
    }

    return problems;
  }

  test("Russian names the records a connector imports in the nominative plural its sentences are worded for", () => {
    const russian: Record<string, string> = readLocale("ru");

    expect(
      [
        "incidents",
        "alerts",
        "notable events",
        "findings",
        "log events",
        "records",
        "audit events",
        "detections",
      ].map((name: string): string => {
        return russian[name] as string;
      }),
    ).toEqual([
      "инциденты",
      "оповещения",
      "значимые события",
      "находки",
      "события журнала",
      "записи",
      "события аудита",
      "обнаружения",
    ]);
  });

  test("no Russian sentence puts the records after a word that wants another case", () => {
    const russian: Record<string, string> = readLocale("ru");
    const sentences: Array<string> = KEYS.filter((key: string): boolean => {
      return RUSSIAN_RECORDS_PLACEHOLDERS.some((name: string): boolean => {
        return key.includes(`{{${name}}}`);
      });
    });

    // The diagnostics, the run details and the import confirmation, at least.
    expect(sentences.length).toBeGreaterThan(8);

    const problems: Array<string> = sentences.flatMap(
      (key: string): Array<string> => {
        return russianCaseProblems(russian[key] as string).map(
          (problem: string): string => {
            return `${problem}: ${key}`;
          },
        );
      },
    );

    expect(problems).toEqual([]);

    // The three sentences #6781 reworded read as a Russian reader expects.
    expect(
      russian[
        "More {{records}} were created in one minute than one poll can read. Polling moved past that minute so newer {{records}} keep arriving; the {{records}} from it that this poll did not read were not imported."
      ],
    ).toContain(
      "Один опрос не может прочитать все {{records}}, созданные за одну минуту.",
    );
    expect(
      russian[
        "This window held more {{records}} than one poll can read, so the cursor stayed where it was. The next scheduled poll reads a window of {{window}} from the same starting point and widens it again as polls complete."
      ],
    ).toContain("Один опрос не может прочитать все {{records}} этого окна");
    expect(
      russian[
        "Preview a window before importing. The first scheduled poll looks back 24 hours; older {{records}} need a historical import. Choose up to 7 days per run. When Last Error says polling moved past a minute it could not read in full, import that minute here to recover what one run can read."
      ],
    ).toContain("более старые {{records}} требуют исторического импорта");
  });

  test("the Russian check finds the wordings #6781 replaced", () => {
    // As the Russian locale worded them before: the genitive the noun lacked.
    expect(
      russianCaseProblems(
        "За одну минуту было создано больше {{records}}, чем может прочитать один опрос.",
      ),
    ).toEqual(["больше {{records}}"]);
    expect(
      russianCaseProblems(
        "В этом окне было больше {{records}}, чем может прочитать один опрос, поэтому курсор остался на месте.",
      ),
    ).toEqual(["больше {{records}}"]);
    expect(
      russianCaseProblems(
        "Первый запланированный опрос смотрит на 24 часа назад; более старым {{records}} нужен исторический импорт.",
      ),
    ).toEqual(["старым {{records}}"]);
    // A nominative plural reads right, where the sentence starts or after "все".
    expect(
      russianCaseProblems(
        "{{records}} за эту минуту не импортированы; все {{records}} этого окна.",
      ),
    ).toEqual([]);
  });

  test("the Arabic counted sentences name their count in the one-form too", () => {
    const arabic: Record<string, string> = readLocale("ar");

    for (const key of SENTENCES_THIS_CHANGE_WORDED) {
      if (!key.endsWith("_one") || !ENGLISH[key]!.includes("{{count}}")) {
        continue;
      }

      expect({ key, one: arabic[key]!.includes("{{count}}") }).toEqual({
        key,
        one: true,
      });
    }
  });
});
