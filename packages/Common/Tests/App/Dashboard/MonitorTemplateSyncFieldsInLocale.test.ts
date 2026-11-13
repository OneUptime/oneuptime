import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next, { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorTemplateSyncFieldUtil, {
  MonitorTemplateSyncField,
} from "../../../Types/Monitor/MonitorTemplateSyncField";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { createTranslator, Translator } from "../../../Types/Translator";
import { joinClauses, joinList } from "../../../UI/Utils/ListSeparator";
import MonitorTemplateSyncFields, {
  getMonitorTemplateSyncFieldSummary,
  MonitorTemplateSyncFieldsSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorTemplateSyncFields";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE TEMPLATE SYNC SETTINGS' FIELDS IN THE READER'S LANGUAGE (#7546).
 *
 * A monitor template's Template sync settings card lists the fields a
 * linked monitor can keep its own value for, and its summary line names
 * the ones the template protects. The names and the descriptions come from
 * a catalogue in Common/Types (MonitorTemplateSyncField) the Dashboard's
 * extractor did not read: no locale file had them, so the card and its
 * summary line named every field in English, in every language. Each name
 * and description is a translationKey now, the catalogue a "keys" root,
 * and every language words them, so a field added to the catalogue fails
 * here until it is translated. A field's path is never a key: a template
 * stores it in doNotSyncFields, and the sync reads it back as written.
 *
 * The summary line names the fields in its own sentence's language: the
 * reader's where their language words the sentence, English where it words
 * only the names.
 */

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);

const CATALOG_FILE: string =
  "packages/Common/Types/Monitor/MonitorTemplateSyncField.ts";
const CATALOG_SOURCE: string = fs.readFileSync(
  path.resolve(__dirname, "../../../Types/Monitor/MonitorTemplateSyncField.ts"),
  "utf8",
);

const KIND_KEYS_AFTER_DIRECTORY: RegExp = /^"[^"]+",\s*kind: "keys"/;
// A word the catalogue marks: translationKey("Monitor destination").
const MARKED_WORD: RegExp = /translationKey\(\s*"([^"]+)"\s*,?\s*\)/g;

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];
const EVERY_FILE: ReadonlyArray<string> = ["en", ...LANGUAGES];

const SUMMARY_SENTENCE: string =
  "These fields keep each monitor's current values during sync: {{fields}}. All other step settings are copied from the template.";
const STEP_SENTENCE: string = "Step {{number}}: {{fields}}";

// The card's own words: its title, what it is for, each row's checkbox and the summary's sentences.
const CARD_WORDS: ReadonlyArray<string> = [
  "Template sync settings",
  "Check fields to keep each monitor's current values when syncing this template to one or all linked monitors. The template's values remain the defaults for new monitors. Lists such as request headers are preserved in full.",
  "Do not sync this field",
  SUMMARY_SENTENCE,
  STEP_SENTENCE,
  "No fields are protected. Sync copies all step settings, including destinations and request options when applicable.",
  "Network device bindings are always preserved. Other step settings are copied from the template.",
  "New monitors still start with the template's values for every field.",
];

interface TypeFields {
  monitorType: MonitorType;
  fields: Array<MonitorTemplateSyncField>;
}

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set<string>(values));
}

// Every monitor type that offers fields, with the fields its card lists.
const FIELDS_BY_TYPE: Array<TypeFields> = (
  Object.values(MonitorType) as Array<MonitorType>
)
  .map((monitorType: MonitorType): TypeFields => {
    return {
      monitorType: monitorType,
      fields: MonitorTemplateSyncFieldUtil.getFields(monitorType),
    };
  })
  .filter((entry: TypeFields): boolean => {
    return entry.fields.length > 0;
  });

const ALL_FIELDS: Array<MonitorTemplateSyncField> = FIELDS_BY_TYPE.flatMap(
  (entry: TypeFields): Array<MonitorTemplateSyncField> => {
    return entry.fields;
  },
);

// Each field's name, and what it keeps together where it says so.
const WORDS: Array<string> = unique(
  ALL_FIELDS.flatMap((field: MonitorTemplateSyncField): Array<string> => {
    return field.description ? [field.label, field.description] : [field.label];
  }),
);

const PATHS: Array<string> = unique(
  ALL_FIELDS.map((field: MonitorTemplateSyncField): string => {
    return field.path;
  }),
);

const API_LABELS: Array<string> = MonitorTemplateSyncFieldUtil.getFields(
  MonitorType.API,
).map((field: MonitorTemplateSyncField): string => {
  return field.label;
});

function apiStep(protectedPaths: Array<string>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.doNotSyncFields = protectedPaths;
  return step;
}

function stepsOf(...steps: Array<MonitorStep>): MonitorSteps {
  const result: MonitorSteps = new MonitorSteps();
  result.setMonitorStepsInstanceArray(steps);
  return result;
}

function apiSummary(
  monitorSteps: MonitorSteps,
  translator: Translator,
): string {
  return getMonitorTemplateSyncFieldSummary(
    { monitorType: MonitorType.API, monitorSteps: monitorSteps },
    translator,
  );
}

// The API fields' English names a line still says, where `language` words them.
function englishNamesIn(line: string, language: string): Array<string> {
  const words: Record<string, string> = readDashboardLocale(language);

  return API_LABELS.filter((label: string): boolean => {
    return words[label] !== label && line.includes(label);
  });
}

// A template filled by hand: `values` go in as they are.
function filled(template: string, values: Record<string, string>): string {
  let result: string = template;

  for (const key of Object.keys(values)) {
    result = result.split(`{{${key}}}`).join(values[key] as string);
  }

  return result;
}

const ONE_STEP: MonitorSteps = stepsOf(
  apiStep(["monitorDestination", "requestHeaders"]),
);
const TWO_STEPS: MonitorSteps = stepsOf(
  apiStep(["monitorDestination"]),
  apiStep(["requestTimeoutInMs", "retryCount"]),
);

describe("the template sync fields' names and descriptions are keys", () => {
  test("the catalogue is a keys root of the extractor", () => {
    const extractor: string = fs.readFileSync(
      path.join(DASHBOARD, "scripts/i18n/ExtractStrings.ts"),
      "utf8",
    );
    const at: number = extractor.indexOf(`"${CATALOG_FILE}"`);

    expect(at).toBeGreaterThanOrEqual(0);
    // Its entry reads only the words the file marks, never a path.
    expect(extractor.slice(at, at + CATALOG_FILE.length + 40)).toMatch(
      KIND_KEYS_AFTER_DIRECTORY,
    );
  });

  test("the catalogue marks every field's name and description, and no path", () => {
    const marked: Array<string> = unique(
      Array.from(CATALOG_SOURCE.matchAll(MARKED_WORD)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    );

    expect(
      WORDS.filter((word: string): boolean => {
        return !marked.includes(word);
      }),
    ).toEqual([]);
    expect(
      PATHS.filter((fieldPath: string): boolean => {
        return marked.includes(fieldPath);
      }),
    ).toEqual([]);
    // The fields are many: a regression that empties a list would pass otherwise.
    expect(WORDS.length).toBeGreaterThan(60);
    expect(PATHS.length).toBeGreaterThan(80);
    expect(WORDS).toEqual(
      expect.arrayContaining([
        "Monitor destination",
        "Keep the DNS server and port together.",
        "Kubernetes cluster",
        "Status page provider",
      ]),
    );
  });

  test("every name and description is a key of the English locale, and no path is", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(
      WORDS.filter((word: string): boolean => {
        return english[word] !== word;
      }),
    ).toEqual([]);
    expect(
      PATHS.filter((fieldPath: string): boolean => {
        return Object.prototype.hasOwnProperty.call(english, fieldPath);
      }),
    ).toEqual([]);
  });

  test.each(EVERY_FILE)(
    "%s.json has every name and description, none of them empty",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const missing: Array<string> = WORDS.filter((word: string): boolean => {
        return typeof words[word] !== "string" || !words[word]!.trim();
      });

      expect({ language, missing }).toEqual({ language, missing: [] });
    },
  );

  test.each(LANGUAGES)(
    "%s words every name and description, or keeps one as written on purpose",
    (language: string) => {
      const english: Array<string> = WORDS.filter((word: string): boolean => {
        return !isWordedInDashboardLocale(word, language);
      });

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );

  test.each(EVERY_FILE)(
    "%s never gives two fields of one card the same name",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const sharedNames: Array<string> = FIELDS_BY_TYPE.filter(
        (entry: TypeFields): boolean => {
          const names: Array<string> = entry.fields.map(
            (field: MonitorTemplateSyncField): string => {
              return translator.translateText(field.label) as string;
            },
          );

          return new Set<string>(names).size !== names.length;
        },
      ).map((entry: TypeFields): string => {
        return entry.monitorType;
      });

      expect({ language, sharedNames }).toEqual({ language, sharedNames: [] });
    },
  );
});

describe("the card's own words", () => {
  test.each(LANGUAGES)(
    "%s words the card's title, its help, the checkbox and the summary's sentences",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const english: Array<string> = CARD_WORDS.filter(
        (key: string): boolean => {
          return !isWordedInDashboardLocale(key, language);
        },
      );
      const placeholdersChanged: Array<string> = CARD_WORDS.filter(
        (key: string): boolean => {
          return (
            placeholdersOf(words[key] || "").join() !==
            placeholdersOf(key).join()
          );
        },
      );

      expect({ language, english, placeholdersChanged }).toEqual({
        language,
        english: [],
        placeholdersChanged: [],
      });
    },
  );
});

describe("the summary line names the protected fields in the reader's language", () => {
  test("English reads as before", () => {
    const english: Translator = dashboardTranslator("en");

    expect(apiSummary(ONE_STEP, english)).toBe(
      "These fields keep each monitor's current values during sync: Monitor destination, Request headers. All other step settings are copied from the template.",
    );
    expect(apiSummary(TWO_STEPS, english)).toBe(
      "These fields keep each monitor's current values during sync: Step 1: Monitor destination; Step 2: Request timeout, Retry count. All other step settings are copied from the template.",
    );
  });

  test.each(LANGUAGES)(
    "%s names one step's fields in its own words",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const line: string = apiSummary(ONE_STEP, dashboardTranslator(language));

      expect(line).toBe(
        filled(words[SUMMARY_SENTENCE] as string, {
          fields: joinList([
            words["Monitor destination"] as string,
            words["Request headers"] as string,
          ]),
        }),
      );
      expect({ language, english: englishNamesIn(line, language) }).toEqual({
        language,
        english: [],
      });
    },
  );

  test.each(LANGUAGES)(
    "%s names each step and its fields in its own words",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const line: string = apiSummary(TWO_STEPS, dashboardTranslator(language));
      const step: (number: string, names: Array<string>) => string = (
        number: string,
        names: Array<string>,
      ): string => {
        return filled(words[STEP_SENTENCE] as string, {
          number: number,
          fields: joinList(
            names.map((name: string): string => {
              return words[name] as string;
            }),
          ),
        });
      };

      // The steps are clauses: "; ", "；" or "؛ " (#7607).
      expect(line).toBe(
        filled(words[SUMMARY_SENTENCE] as string, {
          fields: joinClauses([
            step("1", ["Monitor destination"]),
            step("2", ["Request timeout", "Retry count"]),
          ]),
        }),
      );
      expect({ language, english: englishNamesIn(line, language) }).toEqual({
        language,
        english: [],
      });
    },
  );

  /*
   * Between two steps goes the semicolon of the line's script: the summary
   * joined them with "; " in every language (#7607).
   */
  test.each([
    ["zh-CN", "；"],
    ["zh-TW", "；"],
    ["ja", "；"],
    ["fa", "؛ "],
    ["ar", "؛ "],
  ])(
    "%s puts %s between two steps, never a Latin semicolon",
    (language: string, semicolon: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const line: string = apiSummary(TWO_STEPS, dashboardTranslator(language));
      const firstStep: string = filled(words[STEP_SENTENCE] as string, {
        number: "1",
        fields: words["Monitor destination"] as string,
      });

      expect(line).toContain(`${firstStep}${semicolon}`);
      expect(line).not.toContain(";");
    },
  );

  test("a Latin or Cyrillic line keeps its semicolon and space", () => {
    expect(apiSummary(TWO_STEPS, dashboardTranslator("de"))).toContain(
      "Schritt 1: Monitor-Ziel; Schritt 2:",
    );
    expect(apiSummary(TWO_STEPS, dashboardTranslator("ru"))).toMatch(
      /; \S+ 2: /u,
    );
  });

  test("a language that words the names but not the sentence reads the whole line in English", () => {
    const german: Record<string, string> = readDashboardLocale("de");
    // German's words for the fields and for a step, but none for the line.
    const namesOnly: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === SUMMARY_SENTENCE ? undefined : german[text];
      },
      "de",
    );
    const english: Translator = dashboardTranslator("en");

    expect(namesOnly.translateText("Monitor destination")).toBe("Monitor-Ziel");
    expect(apiSummary(ONE_STEP, namesOnly)).toBe(apiSummary(ONE_STEP, english));
    expect(apiSummary(TWO_STEPS, namesOnly)).toBe(
      apiSummary(TWO_STEPS, english),
    );
  });
});

describe("the card and its summary, drawn in German", () => {
  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        de: { translation: readDashboardLocale("de") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  test("each row names its field, says what it keeps together and offers its checkbox in German", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    render(
      React.createElement(MonitorTemplateSyncFields, {
        monitorType: MonitorType.API,
        isMonitorTemplate: true,
        value: apiStep([]),
        onChange: jest.fn<(value: MonitorStep) => void>(),
      }),
    );

    expect(german["Monitor destination"]).toBe("Monitor-Ziel");
    expect(
      screen.getByRole("heading", {
        name: german["Template sync settings"] as string,
      }),
    ).toBeVisible();
    expect(screen.getByText("Monitor-Ziel")).toBeVisible();
    expect(
      screen.getByText(
        german["Keep the monitor's entire set of request headers."] as string,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", {
        name: `Monitor-Ziel ${german["Do not sync this field"]}`,
      }),
    ).not.toBeChecked();

    // No row is named in English.
    for (const label of API_LABELS) {
      expect({ label, drawn: screen.queryByText(label) }).toEqual({
        label,
        drawn: null,
      });
    }
  });

  test("the summary line names the protected fields in German, and no field in English", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    render(
      React.createElement(MonitorTemplateSyncFieldsSummary, {
        monitorType: MonitorType.API,
        monitorSteps: ONE_STEP,
      }),
    );

    const line: HTMLElement = screen.getByText(
      filled(german[SUMMARY_SENTENCE] as string, {
        fields: "Monitor-Ziel, Anfrage-Header",
      }),
    );

    expect(line).toBeVisible();
    expect(englishNamesIn(line.textContent || "", "de")).toEqual([]);
    expect(
      screen.getByRole("heading", {
        name: german["Template sync settings"] as string,
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        german[
          "New monitors still start with the template's values for every field."
        ] as string,
      ),
    ).toBeVisible();
  });
});

/*
 * A ROW AND A NAME IN THE SUMMARY START LIKE A LABEL (#7607).
 *
 * "Kubernetes cluster", "Docker host" and the other names of what an
 * infrastructure monitor watches are keys the sentences about that
 * infrastructure share ("No open or recent alerts on {{resources}}"), so
 * es, fr, it, pt and ru word them for the middle of a sentence: "clúster de
 * Kubernetes". The card drew them so at the start of a row, and the summary
 * in its list of names. Both draw a name as a label now, with a capital
 * wherever the language writes one; the locale keeps its word as it is.
 */
describe("the card's rows and the summary's names start like a label, in every language", () => {
  // Scripts without capitals: a name there starts as it is written.
  const CASELESS: ReadonlyArray<string> = [
    "ar",
    "fa",
    "hi",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
  ];
  const LOWER_CASE_START: RegExp = /^\p{Ll}/u;
  const UPPER_CASE_START: RegExp = /^\p{Lu}/u;
  const instances: Record<string, i18n> = {};

  // An i18next of the Dashboard's words in `language`, set up once.
  const instanceFor: (language: string) => Promise<i18n> = async (
    language: string,
  ): Promise<i18n> => {
    if (!instances[language]) {
      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          en: { translation: readDashboardLocale("en") },
          [language]: { translation: readDashboardLocale(language) },
        },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });
      instances[language] = instance;
    }

    return instances[language]!;
  };

  const drawIn: (
    language: string,
    ...elements: Array<React.ReactElement>
  ) => Promise<HTMLElement> = async (
    language: string,
    ...elements: Array<React.ReactElement>
  ): Promise<HTMLElement> => {
    const instance: i18n = await instanceFor(language);

    return render(
      React.createElement(I18nextProvider, { i18n: instance }, ...elements),
    ).container;
  };

  const card: (monitorType: MonitorType, key?: string) => React.ReactElement = (
    monitorType: MonitorType,
    key?: string,
  ): React.ReactElement => {
    return React.createElement(MonitorTemplateSyncFields, {
      key: key,
      monitorType: monitorType,
      isMonitorTemplate: true,
      value: apiStep([]),
      onChange: jest.fn<(value: MonitorStep) => void>(),
    });
  };

  // The name that starts each row, in the order the cards draw them.
  const rowNames: (container: HTMLElement) => Array<string> = (
    container: HTMLElement,
  ): Array<string> => {
    return Array.from(container.querySelectorAll("p[id$='-name']")).map(
      (row: Element): string => {
        return row.textContent || "";
      },
    );
  };

  // A word as it starts a label, worked out here apart from the Dashboard's code.
  const capitalized: (word: string, language: string) => string = (
    word: string,
    language: string,
  ): string => {
    return `${word.charAt(0).toLocaleUpperCase(language)}${word.slice(1)}`;
  };

  afterEach(() => {
    cleanup();
  });

  test.each(LANGUAGES)(
    "%s starts every row of every card with a capital, where its script writes one",
    async (language: string) => {
      const rows: Array<string> = rowNames(
        await drawIn(
          language,
          ...FIELDS_BY_TYPE.map((entry: TypeFields): React.ReactElement => {
            return card(entry.monitorType, entry.monitorType);
          }),
        ),
      );

      // Every field of every card: a scan that found no row would pass.
      expect(rows.length).toBe(ALL_FIELDS.length);
      expect({
        language,
        lowerCase: rows.filter((row: string): boolean => {
          return LOWER_CASE_START.test(row);
        }),
      }).toEqual({ language, lowerCase: [] });

      if (!CASELESS.includes(language)) {
        expect({
          language,
          noCapital: rows.filter((row: string): boolean => {
            return !UPPER_CASE_START.test(row);
          }),
        }).toEqual({ language, noCapital: [] });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s names every protected field in the summary as its row does",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const translator: Translator = dashboardTranslator(language);
      const lowerCase: Array<string> = [];

      for (const entry of FIELDS_BY_TYPE) {
        const line: string = getMonitorTemplateSyncFieldSummary(
          {
            monitorType: entry.monitorType,
            monitorSteps: stepsOf(
              apiStep(
                entry.fields.map((field: MonitorTemplateSyncField): string => {
                  return field.path;
                }),
              ),
            ),
          },
          translator,
        );

        for (const field of entry.fields) {
          const word: string = words[field.label] as string;

          if (
            LOWER_CASE_START.test(word) &&
            (line.includes(word) || !line.includes(capitalized(word, language)))
          ) {
            lowerCase.push(`${entry.monitorType}: ${word}`);
          }
        }
      }

      expect({ language, lowerCase }).toEqual({ language, lowerCase: [] });
    },
  );

  test.each([
    [
      "es",
      MonitorType.Kubernetes,
      "Kubernetes cluster",
      "Clúster de Kubernetes",
    ],
    ["fr", MonitorType.Docker, "Docker host", "Hôte Docker"],
    ["it", MonitorType.Ceph, "Ceph cluster", "Cluster Ceph"],
    ["pt", MonitorType.IoTDevice, "IoT fleet", "Frota IoT"],
    ["ru", MonitorType.OpenStack, "OpenStack cloud", "Облако OpenStack"],
  ])(
    "%s: the %s card's %s row reads %s, and the summary names it so",
    async (
      language: string,
      monitorType: MonitorType,
      label: string,
      drawn: string,
    ) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const field: MonitorTemplateSyncField | undefined =
        MonitorTemplateSyncFieldUtil.getFields(monitorType).find(
          (candidate: MonitorTemplateSyncField): boolean => {
            return candidate.label === label;
          },
        );

      // The locale words it for the middle of a sentence, and keeps it so.
      expect(words[label]).toMatch(LOWER_CASE_START);
      expect(capitalized(words[label] as string, language)).toBe(drawn);

      const container: HTMLElement = await drawIn(
        language,
        card(monitorType, "card"),
        React.createElement(MonitorTemplateSyncFieldsSummary, {
          key: "summary",
          monitorType: monitorType,
          monitorSteps: stepsOf(apiStep([field!.path])),
        }),
      );

      expect(screen.getByText(drawn)).toBeVisible();
      expect(
        screen.getByRole("checkbox", {
          name: `${drawn} ${words["Do not sync this field"]}`,
        }),
      ).not.toBeChecked();
      expect(
        screen.getByText(
          filled(words[SUMMARY_SENTENCE] as string, { fields: drawn }),
        ),
      ).toBeVisible();
      expect(container.textContent).not.toContain(words[label]);
    },
  );

  test.each([
    ["zh-CN", "；"],
    ["fa", "؛ "],
  ])(
    "%s draws a summary of two steps with %s between them, never a Latin semicolon",
    async (language: string, semicolon: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const step: (number: string, names: Array<string>) => string = (
        number: string,
        names: Array<string>,
      ): string => {
        return filled(words[STEP_SENTENCE] as string, {
          number: number,
          fields: joinList(
            names.map((name: string): string => {
              return words[name] as string;
            }),
          ),
        });
      };

      await drawIn(
        language,
        React.createElement(MonitorTemplateSyncFieldsSummary, {
          monitorType: MonitorType.API,
          monitorSteps: TWO_STEPS,
        }),
      );

      const line: HTMLElement = screen.getByText(
        filled(words[SUMMARY_SENTENCE] as string, {
          fields: `${step("1", ["Monitor destination"])}${semicolon}${step(
            "2",
            ["Request timeout", "Retry count"],
          )}`,
        }),
      );

      expect(line).toBeVisible();
      expect(line.textContent).not.toContain(";");
    },
  );
});
