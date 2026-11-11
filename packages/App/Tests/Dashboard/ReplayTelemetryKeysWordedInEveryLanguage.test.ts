import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ExtractedString,
  listSourceFiles,
  scanSourceText,
  toRepositoryPath,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { getDefaultContext } from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import {
  getLocaleStatus,
  LocaleStatus,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";

/*
 * SESSION REPLAY, USER FLOWS, TELEMETRY, TRACE PIPELINES, TEAMS, USERS,
 * SLACK AND WORKFLOWS, IN EVERY LANGUAGE (#6752) - read from the Dashboard's
 * shipped locale files and the translated docs.
 *
 * About 228 keys these screens look up still showed English to an Italian,
 * Portuguese, Dutch, Danish, Norwegian, Swedish, Russian, Korean, Chinese,
 * Hindi or Persian reader: a session's Journeys and Top paths, a trace
 * pipeline's processor form, a service's Trace health, the telemetry
 * investigation drawer, a workflow variable's Update Content and OAuth 2.0
 * settings, Slack's Connect with Slack and channel list, and "No teams.".
 * Every key the files below look up is now worded in every language the
 * Dashboard ships; what a language keeps as written (Hash, Client ID,
 * Angular (Browser)) is recorded in its progress file, and the colours the
 * extractor reads from a style prop (var(--ou-link, #4338ca)) are on the
 * global list of text that reads the same everywhere.
 *
 * The translated docs that quoted these labels in English now quote them
 * as each language's Dashboard draws them.
 */

const CONTEXT: ReturnType<typeof getDefaultContext> = getDefaultContext();
const REPOSITORY_ROOT: string = CONTEXT.repositoryRoot;
const DASHBOARD: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard",
);
const DOCS: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Docs/Content",
);

// Every language besides English.
const LANGUAGES: Array<string> = CONTEXT.locales.slice();

// The twelve languages these keys were missing from.
const LANGUAGES_THAT_LACKED_THEM: Array<string> = [
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// The marks that set a run's direction: LRM, RLM and ALM.
const DIRECTION_MARK: RegExp = /[‎‏؜]/;

/*
 * A keyboard key a sentence names in brackets ("({)", "(< slower"), held
 * between two LRMs so a page read from the right does not mirror it.
 */
const MARKED_KEYBOARD_KEY: RegExp = /‎[{}<>]‎/g;

// Languages with one plural form: their "_one" keys are never read.
const ONE_FORM_LANGUAGES: ReadonlySet<string> = new Set([
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
]);

// Languages read from the right.
const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["ar", "fa"];

// The folders and pages of the issue, under the Dashboard's src.
const SOURCES: Array<string> = [
  "Components/SessionReplay",
  "Components/UserFlow",
  "Components/Telemetry",
  "Components/TelemetryResource",
  "Components/TracePipeline",
  "Components/Traces",
  "Components/Team",
  "Components/User",
  "Components/Slack",
  "Components/Workflow",
  "Pages/Settings/TelemetrySettings.tsx",
];

function sourceFiles(): Array<string> {
  const files: Array<string> = [];

  for (const source of SOURCES) {
    const absolute: string = path.join(DASHBOARD, "src", source);

    if (fs.statSync(absolute).isDirectory()) {
      files.push(...listSourceFiles(absolute));
    } else {
      files.push(absolute);
    }
  }

  return files;
}

// Every key the files look up: a plural's general sentence and its "_one".
function getKeys(): Array<string> {
  const keys: Set<string> = new Set<string>();

  for (const file of sourceFiles()) {
    const strings: Array<ExtractedString> = scanSourceText(
      toRepositoryPath(file, REPOSITORY_ROOT),
      fs.readFileSync(file, "utf8"),
      { kind: "ui" },
    ).strings;

    for (const entry of strings) {
      if (entry.nestedPath) {
        continue;
      }

      keys.add(entry.text);

      if (entry.pluralOne !== undefined) {
        keys.add(`${entry.text}_one`);
      }
    }
  }

  return [...keys].sort();
}

const KEYS: Array<string> = getKeys();

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

function keptAsWritten(language: string): Array<string> {
  const progress: { sameAsEnglish?: Array<string> } = readJson(
    path.join(DASHBOARD, `i18n/Progress/${language}.json`),
  ) as { sameAsEnglish?: Array<string> };

  return progress.sameAsEnglish || [];
}

/*
 * The keys of `keys` a language does not word, as npm run i18n:check counts
 * them: missing, or still the English without a record that it reads the
 * same (a one-form language's "_one" and a sentence without letters never
 * count).
 */
function untranslated(
  language: string,
  keys: Array<string>,
  locale: Record<string, string> = readLocale(language),
): Array<string> {
  const status: LocaleStatus = getLocaleStatus({
    code: language,
    english: ENGLISH,
    locale,
    globalSameAsEnglish: GLOBAL_SAME_AS_ENGLISH,
    localeSameAsEnglish: keptAsWritten(language),
  });
  const wanted: Set<string> = new Set<string>(keys);

  return status.untranslated
    .map((entry: { key: string }): string => {
      return entry.key;
    })
    .filter((key: string): boolean => {
      return wanted.has(key);
    })
    .sort();
}

// The {{values}} a sentence fills in.
function tokensOf(text: string): string {
  return (text.match(/\{\{[^}]+\}\}/g) || []).sort().join(" ");
}

/*
 * Sentences of the screens a reader meets most, named here so the source
 * scan cannot quietly lose them.
 */
const NAMED_KEYS: Array<string> = [
  // Session Replay and user flows.
  "Journeys",
  "Top paths",
  "Landing page",
  "Exit page",
  "Back and forth",
  "Hide this page",
  "Show all users",
  "See all their journeys",
  "Filter by user or session ID",
  "Visit {{visit}} to this page",
  "{{count}} sessions in this range",
  "{{count}} sessions in this range_one",
  // Telemetry and traces.
  "Trace health",
  "Traces with every span",
  "Investigate window",
  "Open these logs in the explorer",
  "Edit Retention Settings",
  "Sensitive Attribute Keys",
  // Trace pipelines.
  "Attribute Remapper",
  "Category Processor",
  "Span Kind Remapper",
  "Status Remapper Configuration",
  "first match wins",
  // Teams and users.
  "No teams.",
  "No users.",
  "Remove User Error",
  // Slack.
  "Connect with Slack",
  "Uninstall OneUptime from Slack",
  "Refresh Channels",
  "Channels ({{count}})",
  // Workflows.
  "Create OAuth 2.0 Variable",
  "OAuth 2.0 Settings",
  "Update Content",
  "Use in Workflows",
  "Fixed once the variable is saved.",
];

describe("the keys the Session Replay, telemetry, team, Slack and workflow screens look up", () => {
  test("the source scan finds the screens' sentences, and every one is in en.json", () => {
    expect(KEYS).toEqual(expect.arrayContaining(NAMED_KEYS));
    expect(KEYS.length).toBeGreaterThan(2500);
    expect(
      KEYS.filter((key: string): boolean => {
        return ENGLISH[key] === undefined;
      }),
    ).toEqual([]);
  });

  test("there is a language to check besides English, and the twelve that lacked them are among them", () => {
    expect(LANGUAGES.length).toBe(17);
    expect(LANGUAGES).toEqual(
      expect.arrayContaining([...LANGUAGES_THAT_LACKED_THEM, "de", "ja", "ar"]),
    );
  });
});

describe("Session Replay, user flows, telemetry, trace pipelines, teams, users, Slack and workflows in every language", () => {
  test("every language words every key these screens look up", () => {
    const gaps: Record<string, Array<string>> = {};

    for (const language of LANGUAGES) {
      const left: Array<string> = untranslated(language, KEYS);

      if (left.length > 0) {
        gaps[language] = left;
      }
    }

    expect(gaps).toEqual({});
  });

  test("every language keeps each sentence's values", () => {
    const wrong: Array<string> = [];

    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      for (const key of KEYS) {
        const words: string | undefined = locale[key];

        if (
          words !== undefined &&
          tokensOf(words) !== tokensOf(ENGLISH[key] as string)
        ) {
          wrong.push(`${language}: ${key}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("Arabic and Persian put no direction marks in these sentences: the page sets their code apart", () => {
    for (const language of RIGHT_TO_LEFT_LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        marked: KEYS.filter((key: string): boolean => {
          return DIRECTION_MARK.test(
            (locale[key] || "").replace(MARKED_KEYBOARD_KEY, ""),
          );
        }),
      }).toEqual({ language, marked: [] });
    }
  });

  test("a key the twelve languages lacked reads differently from English in each, unless it keeps the English on purpose", () => {
    for (const language of LANGUAGES_THAT_LACKED_THEM) {
      const locale: Record<string, string> = readLocale(language);
      const kept: Set<string> = new Set<string>([
        ...GLOBAL_SAME_AS_ENGLISH,
        ...keptAsWritten(language),
      ]);

      expect({
        language,
        english: NAMED_KEYS.filter((key: string): boolean => {
          if (ONE_FORM_LANGUAGES.has(language) && key.endsWith("_one")) {
            return false;
          }

          return locale[key] === ENGLISH[key] && !kept.has(ENGLISH[key]!);
        }),
      }).toEqual({ language, english: [] });
    }
  });

  test("a name a language keeps as written is recorded as kept, not left untranslated", () => {
    const kept: Record<string, Array<string>> = {
      it: ["Hash", "Client ID", "Angular (Browser)", "React (Browser)"],
      pt: ["Hash", "Client ID"],
      nl: ["Hash", "Angular (Browser)", "React (Browser)", "Journeys"],
      da: ["Hash"],
      no: ["Hash"],
      sv: ["Hash", "Mask"],
      ru: ["Client ID"],
    };

    for (const language of Object.keys(kept)) {
      const locale: Record<string, string> = readLocale(language);

      for (const name of kept[language]!) {
        expect({ language, name, words: locale[name] }).toEqual({
          language,
          name,
          words: name,
        });
        expect(keptAsWritten(language)).toContain(name);
      }
    }
  });

  test("each language's trace health says health the way the rest of its Dashboard does", () => {
    const HEALTH_WORDS: Record<string, string> = {
      ja: "ヘルス",
      ko: "상태",
      "zh-CN": "健康",
      "zh-TW": "健康",
      hi: "स्वास्थ्य",
      fa: "سلامت",
    };

    for (const language of Object.keys(HEALTH_WORDS)) {
      const locale: Record<string, string> = readLocale(language);

      expect({ language, health: locale["Health"] }).toEqual({
        language,
        health: expect.stringContaining(HEALTH_WORDS[language]!),
      });
      expect({ language, trace: locale["Trace health"] }).toEqual({
        language,
        trace: expect.stringContaining(HEALTH_WORDS[language]!),
      });
    }
  });
});

describe("the colours a style prop names, which the extractor reads as copy", () => {
  const COLOURS: Array<string> = Object.keys(ENGLISH).filter(
    (key: string): boolean => {
      return key.startsWith("var(--");
    },
  );

  test("every one is on the global list of text that reads the same in every language", () => {
    expect(COLOURS).toEqual(
      expect.arrayContaining([
        "var(--ou-link, #4338ca)",
        "var(--ou-success-text, #166534)",
        "var(--ou-tool-text, #0e7490)",
      ]),
    );
    expect(
      COLOURS.filter((colour: string): boolean => {
        return !GLOBAL_SAME_AS_ENGLISH.includes(colour);
      }),
    ).toEqual([]);
  });

  test("no language lists one of its own as well, and every language writes it as English does", () => {
    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        listed: keptAsWritten(language).filter((text: string): boolean => {
          return COLOURS.includes(text);
        }),
        changed: COLOURS.filter((colour: string): boolean => {
          return locale[colour] !== colour;
        }),
      }).toEqual({ language, listed: [], changed: [] });
    }
  });

  test("the global list stays sorted, one entry each", () => {
    const sorted: Array<string> = [...new Set(GLOBAL_SAME_AS_ENGLISH)].sort(
      (a: string, b: string): number => {
        if (a === b) {
          return 0;
        }

        return a < b ? -1 : 1;
      },
    );

    expect(GLOBAL_SAME_AS_ENGLISH).toEqual(sorted);
  });
});

describe("wordings that said something else", () => {
  test("French says a variable's name cannot change once saved, not that it was corrected", () => {
    const words: string = readLocale("fr")[
      "Fixed once the variable is saved."
    ] as string;

    expect(words).not.toMatch(/^Corrigé/);
    expect(words).toMatch(/modifié/);
  });

  test("the Remove User error's title names a failed removal, not a user error to remove", () => {
    const before: Record<string, string> = {
      de: "Benutzerfehler entfernen",
      es: "Quitar error de usuario",
      ja: "ユーザーエラーを削除",
    };
    const error: Record<string, RegExp> = {
      de: /^Fehler beim Entfernen/,
      es: /^Error al quitar/,
      ja: /削除エラー$/,
    };

    for (const language of Object.keys(before)) {
      const words: string = readLocale(language)["Remove User Error"] as string;

      expect({ language, words }).not.toEqual({
        language,
        words: before[language],
      });
      expect(words).toMatch(error[language]!);
    }
  });
});

/*
 * The translated docs pages that quote these labels, and the labels each
 * quotes. A vendor's own field (Client ID on an identity provider's page,
 * Azure's New client secret) is the vendor's word and is not on the list.
 */
const DOCS_LABELS: Record<string, Array<string>> = {
  "telemetry/session-replay.md": [
    "Back and forth",
    "Exit page",
    "Filter by user or session ID",
    "Hide this page",
    "Journeys",
    "Landing page",
    "See all their journeys",
    "Show all users",
    "Top paths",
  ],
  "workflows/variables.md": [
    "Create OAuth 2.0 Variable",
    "OAuth 2.0 Settings",
    "Update Content",
    "Use in Workflows",
  ],
  "workspace-connections/slack.md": [
    "Connect with Slack",
    "Uninstall OneUptime from Slack",
  ],
  "self-hosted/slack-integration.md": [
    "Connect with Slack",
    "Integrating Slack with your OneUptime Project",
  ],
  "telemetry/ai-agent-circuit-breaker.md": ["Update Content"],
  "telemetry/data-retention.md": ["Edit Retention Settings"],
  "telemetry/drop-filters-and-scrub-rules.md": ["Sensitive Attribute Keys"],
  "data-security/telemetry.md": ["Sensitive Attribute Keys"],
  "telemetry/log-pipelines.md": ["Category name"],
  "integrations/microsoft-dynamics-365.md": ["Create OAuth 2.0 Variable"],
  "rum/troubleshooting.md": ["No web vitals reported yet"],
  "rum/web-vitals.md": ["No web vitals reported yet"],
};

// How a docs page quotes a label: bold, or in any language's quotation marks.
const QUOTES: Array<[string, string]> = [
  ["**", "**"],
  ["«", "»"],
  ["« ", " »"],
  ['"', '"'],
  ["“", "”"],
  ["”", "”"],
  ["„", "“"],
  ["'", "'"],
  ["「", "」"],
  ["『", "』"],
];

function readPage(language: string, page: string): string | undefined {
  const file: string = path.join(DOCS, language, page);

  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

// The labels a page quotes in English where `locale` words them otherwise.
function quotedInEnglish(
  text: string,
  labels: Array<string>,
  locale: Record<string, string>,
): Array<string> {
  return labels.filter((label: string): boolean => {
    if (locale[label] === undefined || locale[label] === label) {
      return false;
    }

    return QUOTES.some(([open, close]: [string, string]): boolean => {
      return text.includes(`${open}${label}${close}`);
    });
  });
}

// The languages the docs are translated into.
const DOCS_LANGUAGES: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return fs.existsSync(path.join(DOCS, language));
  },
);

describe("the translated docs quote these labels as each language's Dashboard draws them", () => {
  test("the docs are translated into the twelve languages, among others", () => {
    expect(DOCS_LANGUAGES).toEqual(
      expect.arrayContaining([...LANGUAGES_THAT_LACKED_THEM, "de", "ja"]),
    );
  });

  for (const language of DOCS_LANGUAGES) {
    test(`${language}: no page quotes one of them in English`, () => {
      const locale: Record<string, string> = readLocale(language);
      const english: Record<string, Array<string>> = {};
      let pages: number = 0;

      for (const page of Object.keys(DOCS_LABELS)) {
        const text: string | undefined = readPage(language, page);

        if (text === undefined) {
          continue;
        }

        pages++;

        const left: Array<string> = quotedInEnglish(
          text,
          DOCS_LABELS[page]!,
          locale,
        );

        if (left.length > 0) {
          english[page] = left;
        }
      }

      expect(pages).toBe(Object.keys(DOCS_LABELS).length);
      expect(english).toEqual({});
    });
  }

  test("each of the twelve languages names the session replay page's labels in its own words", () => {
    for (const language of LANGUAGES_THAT_LACKED_THEM) {
      const locale: Record<string, string> = readLocale(language);
      const text: string = readPage(
        language,
        "telemetry/session-replay.md",
      ) as string;

      expect({
        language,
        absent: DOCS_LABELS["telemetry/session-replay.md"]!.filter(
          (label: string): boolean => {
            return !text.includes(locale[label] as string);
          },
        ),
      }).toEqual({ language, absent: [] });
    }
  });

  test("Persian's log pipeline page heads and lists the processors as its Dashboard names them", () => {
    const persian: Record<string, string> = readLocale("fa");
    const text: string = readPage("fa", "telemetry/log-pipelines.md") as string;

    for (const processor of ["Attribute Remapper", "Category Processor"]) {
      expect(persian[processor]).not.toBe(processor);
      expect(text).toContain(`## ${persian[processor]}\n`);
      expect(text).toContain(`| ${persian[processor]} |`);
      expect(text).not.toContain(`## ${processor}\n`);
    }
  });
});

describe("the check itself", () => {
  test("a sentence set back to English, or left out, is reported", () => {
    const italian: Record<string, string> = readLocale("it");

    expect(untranslated("it", KEYS, italian)).toEqual([]);
    expect(
      untranslated("it", KEYS, { ...italian, "Top paths": "Top paths" }),
    ).toEqual(["Top paths"]);

    const withoutJourneys: Record<string, string> = { ...italian };
    delete withoutJourneys["Journeys"];

    expect(untranslated("it", KEYS, withoutJourneys)).toEqual(["Journeys"]);
  });

  test("what a language keeps as written, a one-form language's _one and a sentence without letters are not reported", () => {
    const korean: Record<string, string> = readLocale("ko");
    const dutch: Record<string, string> = readLocale("nl");
    const one: string = "{{count}} sessions in this range_one";

    expect(dutch["Journeys"]).toBe("Journeys");
    expect(untranslated("nl", ["Journeys"], dutch)).toEqual([]);
    expect(
      untranslated("ko", [one], { ...korean, [one]: ENGLISH[one]! }),
    ).toEqual([]);
    // Persian has a "one" form: its _one in English is reported.
    expect(
      untranslated("fa", [one], { ...readLocale("fa"), [one]: ENGLISH[one]! }),
    ).toEqual([one]);
  });

  test("a docs page that quotes a label in English is reported, in bold or in quotation marks", () => {
    const italian: Record<string, string> = readLocale("it");

    expect(
      quotedInEnglish("Apri **Top paths** qui.", ["Top paths"], italian),
    ).toEqual(["Top paths"]);
    expect(
      quotedInEnglish(
        "La scheda dice «No web vitals reported yet».",
        ["No web vitals reported yet"],
        italian,
      ),
    ).toEqual(["No web vitals reported yet"]);
    expect(
      quotedInEnglish(
        `Apri **${italian["Top paths"]}** qui.`,
        ["Top paths"],
        italian,
      ),
    ).toEqual([]);
    // A label the language keeps as written may stay.
    expect(
      quotedInEnglish("**Hash**", ["Hash"], { ...italian, Hash: "Hash" }),
    ).toEqual([]);
  });

  test("a placeholder a translation drops is caught", () => {
    expect(tokensOf("Visita alla pagina")).not.toBe(
      tokensOf(ENGLISH["Visit {{visit}} to this page"] as string),
    );
    expect(tokensOf("{{spans}} in {{traces}}")).toBe("{{spans}} {{traces}}");
  });
});
