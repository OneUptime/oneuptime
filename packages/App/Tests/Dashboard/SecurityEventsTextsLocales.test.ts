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
 * "оповещения", "записи") after a word that wants another case; since #6893
 * no Hindi sentence makes a word agree with them, as Microsoft Sentinel's
 * incidents (घटनाएं) are feminine where every other connector's are
 * masculine.
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
function getKeys(
  dashboardFiles: Array<string> = DASHBOARD_FILES.map(
    (file: string): string => {
      return path.join(DASHBOARD, "src", file);
    },
  ),
  commonFiles: Array<string> = COMMON_FILES.map((file: string): string => {
    return path.join(REPOSITORY_ROOT, file);
  }),
): Array<string> {
  const keys: Set<string> = new Set<string>();
  const strings: Array<ExtractedString> = [
    ...dashboardFiles.flatMap((file: string): Array<ExtractedString> => {
      return scan(file, "ui");
    }),
    ...commonFiles.flatMap((file: string): Array<ExtractedString> => {
      return scan(file, "keys");
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

const SOURCE_FILE: RegExp = /\.tsx?$/;

// Every source file under `folder`, its own folders included.
function sourceFiles(folder: string): Array<string> {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const file: string = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        return sourceFiles(file);
      }

      return SOURCE_FILE.test(entry.name) ? [file] : [];
    })
    .sort();
}

/*
 * Every Security Events screen, not only the files this change routed: the
 * story an event's request tells, where an event came from, the watchlists,
 * the cases, and the words the Common catalogs give them.
 */
const SECURITY_EVENTS_DASHBOARD_FOLDERS: Array<string> = [
  "Components/SecurityEvents",
  "Components/SecurityCase",
  "Pages/SecurityEvents",
];

const SECURITY_EVENTS_COMMON_FOLDER: string =
  "packages/Common/Types/SecurityEvent";

const SECURITY_EVENTS_DASHBOARD_FILES: Array<string> =
  SECURITY_EVENTS_DASHBOARD_FOLDERS.flatMap((folder: string): Array<string> => {
    return sourceFiles(path.join(DASHBOARD, "src", folder));
  });

const EVERY_SECURITY_EVENTS_KEY: Array<string> = getKeys(
  SECURITY_EVENTS_DASHBOARD_FILES,
  sourceFiles(path.join(REPOSITORY_ROOT, SECURITY_EVENTS_COMMON_FOLDER)),
);

// The keys a language still holds in English, without recording them so.
function untranslated(
  language: string,
  keys: Array<string>,
  locale: Record<string, string> = readLocale(language),
): Array<string> {
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

  test("every Security Events screen's keys are worded in every language, not only this change's files", () => {
    // The request story and Where it came from live in files of their own.
    expect(SECURITY_EVENTS_DASHBOARD_FILES).toEqual(
      expect.arrayContaining([
        path.join(
          DASHBOARD,
          "src/Components/SecurityEvents/SecurityEventRequestCopy.ts",
        ),
        path.join(
          DASHBOARD,
          "src/Components/SecurityEvents/Watchlists/WatchlistsCopy.ts",
        ),
      ]),
    );
    expect(EVERY_SECURITY_EVENTS_KEY.length).toBeGreaterThan(KEYS.length * 2);
    expect(EVERY_SECURITY_EVENTS_KEY).toEqual(
      expect.arrayContaining(["What happened next", "Where it came from"]),
    );

    const missing: Record<string, Array<string>> = {};

    for (const language of LANGUAGES) {
      const keys: Array<string> = untranslated(
        language,
        EVERY_SECURITY_EVENTS_KEY,
      );

      if (keys.length > 0) {
        missing[language] = keys;
      }
    }

    expect(missing).toEqual({});

    // A sentence a language holds in English is found, as German held this one.
    const german: Record<string, string> = {
      ...readLocale("de"),
      "What happened next": "What happened next",
    };

    expect(untranslated("de", EVERY_SECURITY_EVENTS_KEY, german)).toEqual([
      "What happened next",
    ]);
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
   * оповещений" - which the filled sentence cannot give: #6781. The label
   * of the choice that imports the rest ("Обнаружения") is such a plural
   * too, so a sentence names it after a noun: "с вариантом «Обнаружения»".
   */
  const RUSSIAN_RECORDS_PLACEHOLDERS: Array<string> = [
    "records",
    "alerting",
    "nonAlerting",
    "nonAlertingLabel",
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

    // The diagnostics name the Detections choice after a noun, in quotes.
    expect(
      russian[
        "Test connection checks access to {{provider}}, what it has available to import with and without {{nonAlertingLabel}}, and whether OneUptime's workers and scheduler are running. It runs immediately and imports nothing. Run now imports the next poll window immediately, including when the schedule is paused."
      ],
    ).toContain("с вариантом «{{nonAlertingLabel}}» и без него");
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
    // The Detections label straight after "с", as the diagnostics had it.
    expect(
      russianCaseProblems(
        "что доступно для импорта с {{nonAlertingLabel}} и без них",
      ),
    ).toEqual(["с {{nonAlertingLabel}}"]);
    // A nominative plural reads right, where the sentence starts or after "все".
    expect(
      russianCaseProblems(
        "{{records}} за эту минуту не импортированы; все {{records}} этого окна.",
      ),
    ).toEqual([]);
  });

  /*
   * A Hindi sentence names the records a connector imports with a plural
   * the locale words them in: इवेंट, अलर्ट, निष्कर्ष, रिकॉर्ड and डिटेक्शन are
   * masculine, and Microsoft Sentinel's incidents, घटनाएं, are feminine.
   * Hindi makes the words around a noun agree with it - इतने / इतनी, नए /
   * नई, बने / बनीं, थे / थीं, किए गए / की गईं - so a sentence written for
   * the masculine ones read wrongly on a Sentinel connection (#6893). And a
   * postposition after the word (का, के, को, के लिए) wants its oblique
   * form, घटनाओं, which the filled sentence cannot give either. So no
   * Hindi sentence puts a word that agrees with the records next to them,
   * or a postposition straight after them, and no verb or participle after
   * them in their clause agrees with them (Hindi puts its verb last; one
   * before them, as in "बताए गए मिनट के लिए", agrees with a noun of its own).
   */
  const HINDI_RECORDS_PLACEHOLDERS: Array<string> = [
    "records",
    "what",
    "alerting",
    "nonAlerting",
    "nonAlertingLabel",
  ];

  // Postpositions: the noun before them takes its oblique form.
  const HINDI_POSTPOSITIONS: ReadonlySet<string> = new Set([
    "का",
    "के",
    "की",
    "को",
    "में",
    "से",
    "पर",
    "तक",
    "ने",
  ]);

  // Words that agree with the noun after them, in gender or in number.
  const HINDI_AGREEING_MODIFIERS: ReadonlySet<string> = new Set([
    "का",
    "के",
    "की",
    "इतना",
    "इतने",
    "इतनी",
    "जितना",
    "जितने",
    "जितनी",
    "नया",
    "नए",
    "नये",
    "नई",
    "पुराना",
    "पुराने",
    "पुरानी",
    "सारा",
    "सारे",
    "सारी",
    "ऐसा",
    "ऐसे",
    "ऐसी",
    "कितने",
    "कितनी",
    "अपने",
    "अपनी",
    "बने",
    "बनी",
    "बनीं",
    "गए",
    "गई",
    "गईं",
    "किए",
    "हुए",
    "हुई",
    "वाले",
    "वाली",
    "कोई",
  ]);

  /*
   * The plural verbs and participles that agree with their subject or
   * object, masculine and feminine: after the records in their clause, each
   * one agrees with them.
   */
  const HINDI_AGREEING_PLURAL_VERBS: ReadonlySet<string> = new Set([
    "बने",
    "बनीं",
    "थे",
    "थीं",
    "पढ़े",
    "पढ़ीं",
    "गए",
    "गईं",
    "किए",
    "कीं",
    "दिए",
    "दीं",
    "हुए",
    "हुईं",
    "आते",
    "आतीं",
    "जाते",
    "जातीं",
    "होते",
    "होतीं",
    "रहते",
    "रहतीं",
    "चुके",
    "चुकीं",
  ]);

  const HINDI_CLAUSE_END: RegExp = /[।;,?:]/;

  const HINDI_WORD_SPLIT: RegExp = /[\s"“”'(),;:।?]+/;

  function hindiWords(text: string): Array<string> {
    return text.split(HINDI_WORD_SPLIT).filter(Boolean);
  }

  // Where a Hindi sentence makes a word agree with the records it names.
  function hindiAgreementProblems(sentence: string): Array<string> {
    const problems: Array<string> = [];

    for (const name of HINDI_RECORDS_PLACEHOLDERS) {
      const placeholder: string = `{{${name}}}`;
      const parts: Array<string> = sentence.split(placeholder);

      parts.slice(0, -1).forEach((before: string, index: number): void => {
        const after: string = parts[index + 1] as string;
        const previous: string = hindiWords(before).pop() || "";
        const next: string = after.startsWith(" ")
          ? hindiWords(after)[0] || ""
          : "";

        if (HINDI_AGREEING_MODIFIERS.has(previous)) {
          problems.push(`${previous} ${placeholder}`);
        }

        if (HINDI_POSTPOSITIONS.has(next)) {
          problems.push(`${placeholder} ${next}`);
        }

        // The rest of the placeholder's clause, up to its next clause end.
        const rest: string = after.split(HINDI_CLAUSE_END)[0] || "";

        for (const verb of hindiWords(rest)) {
          if (HINDI_AGREEING_PLURAL_VERBS.has(verb)) {
            problems.push(`${placeholder} ... ${verb}`);
          }
        }
      });
    }

    return [...new Set(problems)];
  }

  // Every connector's records, as the Hindi locale names them in a sentence.
  function hindiRecordsWords(): Array<string> {
    const hindi: Record<string, string> = readLocale("hi");

    return [
      ...new Set(
        SecurityEventConnectorCatalog.map(
          (definition: SecurityEventConnectorDefinition): string => {
            const key: string = `${definition.importedRecordName}s`;

            expect({ key, english: ENGLISH[key] }).toEqual({
              key,
              english: key,
            });

            return hindi[key] as string;
          },
        ),
      ),
    ];
  }

  test("Hindi names Microsoft Sentinel's incidents with a feminine plural and the rest with masculine ones", () => {
    const hindi: Record<string, string> = readLocale("hi");

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
        return hindi[name] as string;
      }),
    ).toEqual([
      "घटनाएं",
      "अलर्ट",
      "उल्लेखनीय इवेंट",
      "निष्कर्ष",
      "लॉग इवेंट",
      "रिकॉर्ड",
      "ऑडिट इवेंट",
      "डिटेक्शन",
    ]);
    // Every connector's records are among them, Sentinel's incidents too.
    expect(hindiRecordsWords()).toEqual(expect.arrayContaining(["घटनाएं"]));
  });

  test("no Hindi sentence makes a word agree with the records it names (#6893)", () => {
    const hindi: Record<string, string> = readLocale("hi");
    const sentences: Array<string> = EVERY_SECURITY_EVENTS_KEY.filter(
      (key: string): boolean => {
        return HINDI_RECORDS_PLACEHOLDERS.some((name: string): boolean => {
          return key.includes(`{{${name}}}`);
        });
      },
    );

    // The diagnostics, the run details and the import confirmation, at least.
    expect(sentences.length).toBeGreaterThan(10);
    expect(sentences).toEqual(
      expect.arrayContaining([
        "Preview {{records}}",
        "Find historical {{records}}",
        "More {{records}} were created in one minute than one poll can read. Polling moved past that minute so newer {{records}} keep arriving; the {{records}} from it that this poll did not read were not imported.",
        "This window held more {{records}} than one poll can read, so the cursor stayed where it was. The next scheduled poll reads a window of {{window}} from the same starting point and widens it again as polls complete.",
        "Import {{what}} from {{start}} to {{end}} into OneUptime? Imported events become available to security rules and monitors. Already imported {{records}} are skipped.",
      ]),
    );

    const problems: Array<string> = sentences.flatMap(
      (key: string): Array<string> => {
        return hindiAgreementProblems(hindi[key] as string).map(
          (problem: string): string => {
            return `${problem}: ${key}`;
          },
        );
      },
    );

    expect(problems).toEqual([]);

    // Filled with every connector's records, Sentinel's incidents read whole.
    const words: Array<string> = hindiRecordsWords();

    for (const key of sentences) {
      for (const word of words) {
        const filled: string = (hindi[key] as string)
          .split("{{records}}")
          .join(word)
          .split("{{what}}")
          .join(word);

        for (const modifier of ["इतने", "नए", "पुराने", "कोई"]) {
          expect({
            key,
            word,
            modifier,
            found: filled.includes(`${modifier} ${word}`),
          }).toEqual({ key, word, modifier, found: false });
        }

        for (const postposition of ["का", "के", "की", "को"]) {
          expect({
            key,
            word,
            postposition,
            found: filled.includes(`${word} ${postposition} `),
          }).toEqual({ key, word, postposition, found: false });
        }
      }
    }
  });

  test("the Hindi sentences #6893 reworded read the same for every connector's records", () => {
    const hindi: Record<string, string> = readLocale("hi");

    expect(
      hindi[
        "More {{records}} were created in one minute than one poll can read. Polling moved past that minute so newer {{records}} keep arriving; the {{records}} from it that this poll did not read were not imported."
      ],
    ).toBe(
      "एक ही मिनट में एक पोल जितना पढ़ सकता है, उससे अधिक {{records}} हैं। पोलिंग उस मिनट से आगे बढ़ गई, ताकि OneUptime नवीनतम {{records}} आयात करता रहे; यह पोल उस मिनट में से बाकी {{records}} नहीं पढ़ पाया, इसलिए उनका आयात नहीं हुआ।",
    );
    expect(
      hindi[
        "This window held more {{records}} than one poll can read, so the cursor stayed where it was. The next scheduled poll reads a window of {{window}} from the same starting point and widens it again as polls complete."
      ],
    ).toContain(
      "इस विंडो में एक पोल जितना पढ़ सकता है, उससे अधिक {{records}} हैं,",
    );
    expect(
      hindi[
        "Preview a window before importing. The first scheduled poll looks back 24 hours; older {{records}} need a historical import. Choose up to 7 days per run. When Last Error says polling moved past a minute it could not read in full, import that minute here to recover what one run can read."
      ],
    ).toContain(
      "उससे पहले के समय से {{records}} लाने के लिए ऐतिहासिक आयात चलाएँ।",
    );
    expect(
      hindi[
        "Import {{what}} from {{start}} to {{end}} into OneUptime? Imported events become available to security rules and monitors. Already imported {{records}} are skipped."
      ],
    ).toContain("OneUptime पहले से आयातित {{records}} छोड़ देता है।");
    expect(hindi["Preview {{records}}"]).toBe(
      "पूर्वावलोकन में {{records}} देखें",
    );
    // What a run skips names a record of its own, not the records' plural.
    for (const key of [
      "To recover them, use Import this time range under Find historical {{records}} for {{start}} → {{end}}. Any already imported are skipped.",
      "To recover them, use Import this time range under Find historical {{records}} on the minute named in the warnings. Any already imported are skipped.",
    ]) {
      expect(hindi[key]).toContain(
        "पहले से आयात हो चुका कोई भी रिकॉर्ड छोड़ दिया जाता है।",
      );
      expect(hindi[key]).not.toContain("पहले से आयात किए गए छोड़ दिए जाते हैं");
    }
  });

  test("the Hindi check finds the wordings #6893 replaced", () => {
    // As the Hindi locale worded them before: masculine around the records.
    expect(
      hindiAgreementProblems(
        "एक मिनट में इतने {{records}} बने जितने एक पोल नहीं पढ़ सकता। पोलिंग उस मिनट से आगे बढ़ गई ताकि नए {{records}} आते रहें; उस मिनट के जो {{records}} इस पोल ने नहीं पढ़े, वे आयात नहीं किए गए।",
      ),
    ).toEqual([
      "इतने {{records}}",
      "{{records}} ... बने",
      "नए {{records}}",
      "{{records}} ... आते",
      "{{records}} ... पढ़े",
    ]);
    expect(
      hindiAgreementProblems(
        "इस विंडो में इतने {{records}} थे जितने एक पोल नहीं पढ़ सकता, इसलिए कर्सर अपनी जगह पर रहा।",
      ),
    ).toEqual(["इतने {{records}}", "{{records}} ... थे"]);
    expect(
      hindiAgreementProblems(
        "पहला शेड्यूल किया गया पोल 24 घंटे पीछे तक देखता है; पुराने {{records}} के लिए ऐतिहासिक आयात चाहिए।",
      ),
    ).toEqual(["पुराने {{records}}", "{{records}} के"]);
    expect(
      hindiAgreementProblems(
        "{{start}} से {{end}} तक के {{what}} OneUptime में आयात करें? पहले से आयात किए गए {{records}} छोड़ दिए जाते हैं।",
      ),
    ).toEqual([
      "गए {{records}}",
      "{{records}} ... दिए",
      "{{records}} ... जाते",
      "के {{what}}",
    ]);
    expect(hindiAgreementProblems("{{records}} का पूर्वावलोकन")).toEqual([
      "{{records}} का",
    ]);
    expect(
      hindiAgreementProblems(
        "इस {{control}} चयन के साथ केवल {{alerting}} आयात किए जाते हैं;",
      ),
    ).toEqual(["{{alerting}} ... किए", "{{alerting}} ... जाते"]);
    expect(
      hindiAgreementProblems(
        "{{nonAlertingLabel}} के साथ और उसके बिना आयात के लिए क्या उपलब्ध है",
      ),
    ).toEqual(["{{nonAlertingLabel}} के"]);
    // A sentence where nothing agrees with the records reads right.
    expect(
      hindiAgreementProblems(
        "ऐतिहासिक {{records}} खोजें; पूर्वावलोकन में {{records}} देखें; OneUptime पहले से आयातित {{records}} छोड़ देता है।",
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
