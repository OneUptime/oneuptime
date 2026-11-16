import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { ComponentArgument } from "Common/Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentsUtil from "Common/Utils/Dashboard/Components/Index";
import {
  ExtractedString,
  isTranslatableText,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * A DASHBOARD WIDGET'S SETTINGS READ IN THE READER'S LANGUAGE (#8164).
 *
 * The widget settings form looks every word of a widget's settings up as it
 * draws it: a setting's name, what it does, its placeholder, its options and
 * the section it is in. None of them was extracted (Common/Utils/Dashboard
 * was no source root), so a word read in the reader's language only where
 * another page happened to use it: the Incident List's and the Alert List's
 * Lifecycle State filter read "Lifecycle State", "Quick filter by lifecycle
 * state" and "Unresolved (open)" in English in every language, beside
 * "Alle", "Bestätigt" and "Behoben" in German.
 *
 * The same was true of every other widget's settings form (#8479): a
 * Chart's "Chart Type" and "Stacked Area Chart", a Clock's "Time Format", a
 * Gauge's "Red zone starts at this value", about 300 words in all. Every
 * widget's settings are keys now (Common/Utils/Dashboard/Components is a
 * source root, and a setting's and a section's name is a word by its type),
 * worded in every language, and a new widget's words are keys from the
 * start. What is data, not words, is drawn as written: a Clock's timezones
 * and the OCSF event classes a Security Events List filters by.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const LETTER: RegExp = /\p{L}/u;

interface SettingsWord {
  text: string;
  where: string;
}

// Every word a widget's settings form draws, looked up.
function settingsWords(type: DashboardComponentType): Array<SettingsWord> {
  const words: Array<SettingsWord> = [];
  const add: (text: string | undefined, where: string) => void = (
    text: string | undefined,
    where: string,
  ): void => {
    // What the extraction reads as words: code samples it leaves as written.
    if (text && LETTER.test(text) && isTranslatableText(text, "prop")) {
      words.push({ text, where });
    }
  };

  for (const argument of DashboardComponentsUtil.getComponentSettingsArguments(
    type,
  ) as Array<ComponentArgument<DashboardBaseComponent>>) {
    const id: string = String(argument.id);

    add(argument.name, `${id}: name`);
    add(argument.description, `${id}: description`);
    add(argument.placeholder, `${id}: placeholder`);
    add(argument.section?.name, `${id}: section`);
    add(argument.section?.description, `${id}: section description`);

    for (const option of argument.dropdownOptions || []) {
      // A name as written (a product's) is never looked up.
      if (!option.isUserContent) {
        add(String(option.label), `${id}: option`);
      }
    }
  }

  return words;
}

// The words of a widget's settings no locale has a key for.
function unkeyed(type: DashboardComponentType): Array<string> {
  const english: Record<string, string> = readDashboardLocale("en");

  return [
    ...new Set(
      settingsWords(type)
        .filter((word: SettingsWord): boolean => {
          return english[word.text] === undefined;
        })
        .map((word: SettingsWord): string => {
          return word.text;
        }),
    ),
  ].sort();
}

// Every widget with settings, its words read at run time.
function hasSettings(type: DashboardComponentType): boolean {
  try {
    return (
      DashboardComponentsUtil.getComponentSettingsArguments(type).length > 0
    );
  } catch {
    return false;
  }
}

const WIDGETS: ReadonlyArray<DashboardComponentType> = Object.values(
  DashboardComponentType,
).filter(hasSettings);

const KEYED: ReadonlyArray<DashboardComponentType> = [
  DashboardComponentType.IncidentList,
  DashboardComponentType.AlertList,
];

describe("every widget's settings form", () => {
  test("the scan reads every widget's settings", () => {
    expect(WIDGETS.length).toBeGreaterThan(50);
    expect(WIDGETS).toEqual(
      expect.arrayContaining([
        DashboardComponentType.Chart,
        DashboardComponentType.Clock,
        DashboardComponentType.Html,
        DashboardComponentType.NetworkMap,
      ]),
    );
  });

  test.each(WIDGETS)(
    "%s: every word it draws is a key",
    (type: DashboardComponentType) => {
      expect(settingsWords(type).length).toBeGreaterThan(0);
      expect(unkeyed(type)).toEqual([]);
    },
  );

  test.each(WIDGETS)(
    "%s: and each is worded in every language",
    (type: DashboardComponentType) => {
      const notWorded: Array<string> = [];

      for (const language of DASHBOARD_LANGUAGES) {
        for (const word of settingsWords(type)) {
          if (!isWordedInDashboardLocale(word.text, language)) {
            notWorded.push(`${language} ${word.where}: ${word.text}`);
          }
        }
      }

      expect(notWorded).toEqual([]);
    },
  );

  test("a Chart's settings, word for word in German", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    for (const [english, words] of [
      ["Chart Type", "Diagrammtyp"],
      ["Stacked Area Chart", "Gestapeltes Flächendiagramm"],
      [
        "Configure what data to display on the chart",
        "Festlegen, welche Daten das Diagramm zeigt",
      ],
    ] as Array<[string, string]>) {
      expect({ english, german: german[english] }).toEqual({
        english,
        german: words,
      });
    }
  });

  test("data is drawn as written: a Clock's timezones and the OCSF event classes", () => {
    const clock: Array<ComponentArgument<DashboardBaseComponent>> =
      DashboardComponentsUtil.getComponentSettingsArguments(
        DashboardComponentType.Clock,
      ) as Array<ComponentArgument<DashboardBaseComponent>>;
    const zones: Array<{
      label: unknown;
      isUserContent?: boolean | undefined;
    }> =
      clock.find(
        (argument: ComponentArgument<DashboardBaseComponent>): boolean => {
          return argument.id === "timezone";
        },
      )?.dropdownOptions || [];

    expect(zones.length).toBeGreaterThan(300);
    expect(
      zones.every((zone: { isUserContent?: boolean | undefined }): boolean => {
        return zone.isUserContent === true;
      }),
    ).toBe(true);

    const classes: Array<{
      label: unknown;
      isUserContent?: boolean | undefined;
    }> =
      (
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.SecurityEventsList,
        ) as Array<ComponentArgument<DashboardBaseComponent>>
      ).find((argument: ComponentArgument<DashboardBaseComponent>): boolean => {
        return argument.id === "classNameFilters";
      })?.dropdownOptions || [];

    expect(classes.length).toBeGreaterThan(20);
    expect(
      classes.every(
        (option: { isUserContent?: boolean | undefined }): boolean => {
          return option.isUserContent === true;
        },
      ),
    ).toBe(true);
  });

  /*
   * A reduce picker's placeholder named its default by the enum's value,
   * "Last", where the menu says "Last value": no option, and no word.
   */
  test("a reduce picker's placeholder names its default as the menu does", () => {
    for (const type of [
      DashboardComponentType.DataSourceValue,
      DashboardComponentType.DataSourceGauge,
      DashboardComponentType.Table,
    ]) {
      const reduce: ComponentArgument<DashboardBaseComponent> | undefined = (
        DashboardComponentsUtil.getComponentSettingsArguments(type) as Array<
          ComponentArgument<DashboardBaseComponent>
        >
      ).find((argument: ComponentArgument<DashboardBaseComponent>): boolean => {
        return (argument.dropdownOptions || []).some(
          (option: { label: unknown }): boolean => {
            return option.label === "Last value";
          },
        );
      });

      expect({ type, placeholder: reduce?.placeholder }).toEqual({
        type,
        placeholder: "Last value",
      });
    }
  });
});

describe("the Incident List and Alert List settings", () => {
  test.each(KEYED)(
    "%s: every word its settings form draws is a key",
    (type: DashboardComponentType) => {
      expect(settingsWords(type).length).toBeGreaterThan(15);
      expect(unkeyed(type)).toEqual([]);
    },
  );

  test.each(KEYED)(
    "%s: and each is worded in every language",
    (type: DashboardComponentType) => {
      const notWorded: Array<string> = [];

      for (const language of DASHBOARD_LANGUAGES) {
        for (const word of settingsWords(type)) {
          if (!isWordedInDashboardLocale(word.text, language)) {
            notWorded.push(`${language} ${word.where}: ${word.text}`);
          }
        }
      }

      expect(notWorded).toEqual([]);
    },
  );

  test("the Lifecycle State filter: its name, what it does and its options", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    for (const type of KEYED) {
      const lifecycle: ComponentArgument<DashboardBaseComponent> | undefined =
        DashboardComponentsUtil.getComponentSettingsArguments(type).find(
          (argument: ComponentArgument<DashboardBaseComponent>): boolean => {
            return argument.id === "stateFilter";
          },
        );

      expect(lifecycle?.name).toBe("Lifecycle State");
      expect(
        (lifecycle?.dropdownOptions || []).map(
          (option: { label: string }): string => {
            return german[option.label] as string;
          },
        ),
      ).toEqual(["Alle", "Nicht behoben (offen)", "Bestätigt", "Behoben"]);
    }

    expect(german["Lifecycle State"]).toBe("Lebenszyklus-Status");
    expect(german["Quick filter by lifecycle state"]).toBe(
      "Schnellfilter nach Lebenszyklus-Status",
    );
  });

  /*
   * "Unresolved (open)" is worded with each language's own Unresolved, the
   * word the Dashboard says beside it, and reads as its whole text: it is
   * no key that names a meaning (MeaningKeys).
   */
  test("Unresolved (open) says each language's Unresolved", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        startsWithUnresolved: (locale["Unresolved (open)"] || "").startsWith(
          locale["Unresolved"] as string,
        ),
      }).toEqual({ language, startsWithUnresolved: true });
    }
  });
});

describe("the list widgets' shared settings", () => {
  test("the View Mode every list widget offers is keyed already", () => {
    for (const type of [
      DashboardComponentType.IncidentList,
      DashboardComponentType.AlertList,
      DashboardComponentType.MonitorList,
    ]) {
      const words: Array<string> = settingsWords(type)
        .filter((word: SettingsWord): boolean => {
          return word.where.startsWith("viewMode");
        })
        .map((word: SettingsWord): string => {
          return word.text;
        });

      expect(words).toEqual(
        expect.arrayContaining(["View Mode", "List", "Honeycomb"]),
      );

      for (const word of words) {
        expect({ type, word, keyed: unkeyed(type).includes(word) }).toEqual({
          type,
          word,
          keyed: false,
        });
      }
    }
  });
});

/*
 * The widgets page describes the Lifecycle State filter by its options,
 * and five languages named Acknowledged by a word the Dashboard does not
 * draw (Danish kvitterede, French acquittés, Italian presi in carico, Korean
 * 확인됨 - its word for Confirmed - and Portuguese reconhecidos); German,
 * Dutch, Russian and Persian named Unresolved and Resolved so too. Each
 * cell names the three as the Dashboard does, inflected as its sentence
 * needs: the stem below is in the Dashboard's word and in the cell.
 */
const LIFECYCLE_STEMS: Record<
  string,
  { unresolved: string; acknowledged: string; resolved: string }
> = {
  de: {
    unresolved: "nicht behoben",
    acknowledged: "bestätigt",
    resolved: "behoben",
  },
  fr: {
    unresolved: "non résolu",
    acknowledged: "en compte",
    resolved: "résolu",
  },
  es: {
    unresolved: "sin resolver",
    acknowledged: "reconocid",
    resolved: "resuelt",
  },
  it: {
    unresolved: "non risolt",
    acknowledged: "riconosciut",
    resolved: "risolt",
  },
  pt: {
    unresolved: "não resolvid",
    acknowledged: "confirmad",
    resolved: "resolvid",
  },
  nl: {
    unresolved: "niet opgelost",
    acknowledged: "bevestigd",
    resolved: "opgelost",
  },
  da: { unresolved: "uløst", acknowledged: "bekræfte", resolved: "løst" },
  no: { unresolved: "uløst", acknowledged: "bekrefte", resolved: "løst" },
  sv: { unresolved: "olöst", acknowledged: "bekräftad", resolved: "löst" },
  ru: {
    unresolved: "устранён",
    acknowledged: "подтверждён",
    resolved: "устранён",
  },
  ja: { unresolved: "未解決", acknowledged: "確認済み", resolved: "解決済み" },
  ko: { unresolved: "미해결", acknowledged: "인지됨", resolved: "해결됨" },
  "zh-CN": { unresolved: "未解决", acknowledged: "已确认", resolved: "已解决" },
  "zh-TW": { unresolved: "未解決", acknowledged: "已確認", resolved: "已解決" },
  hi: { unresolved: "अनसुलझ", acknowledged: "स्वीकार", resolved: "सुलझ" },
  fa: {
    unresolved: "برطرف‌نشده",
    acknowledged: "تأییدشده",
    resolved: "برطرف‌شده",
  },
};

// Lower case, with no spaces: a stem is found whatever the cell's spacing.
function folded(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function widgetsPageRows(language: string): Array<string> {
  const page: string = fs.readFileSync(
    path.join(
      REPOSITORY_ROOT,
      "packages/App/FeatureSet/Docs/Content",
      language,
      "dashboards/widgets.md",
    ),
    "utf8",
  );
  const lines: Array<string> = page.split("\n");
  const english: Array<string> = fs
    .readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/Docs/Content/en/dashboards/widgets.md",
      ),
      "utf8",
    )
    .split("\n");

  // The rows the English page gives the Incident List and the Alert List.
  return english
    .map((line: string, index: number): string | undefined => {
      return line.startsWith("| **Incident List** |") ||
        line.startsWith("| **Alert List** |")
        ? lines[index]
        : undefined;
    })
    .filter((line: string | undefined): line is string => {
      return Boolean(line);
    });
}

describe("the widgets page names the Lifecycle State options as the Dashboard draws them", () => {
  test("every docs language has its stems, each in the Dashboard's word", () => {
    for (const language of Object.keys(LIFECYCLE_STEMS)) {
      const locale: Record<string, string> = readDashboardLocale(language);
      const stems: {
        unresolved: string;
        acknowledged: string;
        resolved: string;
      } = LIFECYCLE_STEMS[language] as {
        unresolved: string;
        acknowledged: string;
        resolved: string;
      };

      expect({
        language,
        unresolved: folded(locale["Unresolved"] as string).includes(
          folded(stems.unresolved),
        ),
        acknowledged: folded(locale["Acknowledged"] as string).includes(
          folded(stems.acknowledged),
        ),
        resolved: folded(locale["Resolved"] as string).includes(
          folded(stems.resolved),
        ),
      }).toEqual({
        language,
        unresolved: true,
        acknowledged: true,
        resolved: true,
      });
    }
  });

  test.each(Object.keys(LIFECYCLE_STEMS))(
    "%s: the Incident List and Alert List rows name the three by them",
    (language: string) => {
      const rows: Array<string> = widgetsPageRows(language);
      const stems: {
        unresolved: string;
        acknowledged: string;
        resolved: string;
      } = LIFECYCLE_STEMS[language] as {
        unresolved: string;
        acknowledged: string;
        resolved: string;
      };

      expect(rows).toHaveLength(2);

      for (const row of rows) {
        // The filters' column: the row's last cell.
        const cells: Array<string> = row.split("|");
        const filters: string = folded(cells[cells.length - 2] || "");

        expect({
          language,
          unresolved: filters.includes(folded(stems.unresolved)),
          acknowledged: filters.includes(folded(stems.acknowledged)),
          resolved: filters.includes(folded(stems.resolved)),
        }).toEqual({
          language,
          unresolved: true,
          acknowledged: true,
          resolved: true,
        });
      }
    },
  );

  test("the words the issue found are gone (negative control)", () => {
    const gone: Record<string, string> = {
      da: "kvitterede",
      fr: "acquitt",
      it: "presi in carico",
      ko: "확인됨",
      pt: "reconhecidos",
    };

    for (const language of Object.keys(gone)) {
      for (const row of widgetsPageRows(language)) {
        expect({
          language,
          found: row.includes(gone[language] as string),
        }).toEqual({ language, found: false });
      }
    }
  });
});

// What the extraction reads from a fixture widget, as its texts.
function extractedFrom(source: string): Array<string> {
  return scanSourceText(
    "packages/Common/Utils/Dashboard/Components/DashboardExampleComponent.ts",
    source,
    { kind: "ui" },
  ).strings.map((entry: ExtractedString): string => {
    return entry.text;
  });
}

describe("the extraction reads a setting's name by its type (#8479)", () => {
  test("a setting pushed onto a typed list, a section, and a list a method returns", () => {
    const texts: Array<string> = extractedFrom(
      [
        'const Section: ComponentArgumentSection = { name: "Example Section", order: 1 };',
        "class Example {",
        "  public static first(): Array<ComponentArgument<Widget>> {",
        "    const componentArguments: Array<ComponentArgument<Widget>> = [];",
        '    componentArguments.push({ name: "Example Pushed", id: "a" });',
        "    return componentArguments;",
        "  }",
        "  public static second(): Array<ComponentArgument<Widget>> {",
        '    return [{ name: "Example Returned", id: "b" }];',
        "  }",
        "}",
        "function shared<T>(): ComponentArgument<T> {",
        '  return { name: "Example Shared", id: "c" };',
        "}",
      ].join("\n"),
    );

    expect(texts).toEqual(
      expect.arrayContaining([
        "Example Section",
        "Example Pushed",
        "Example Returned",
        "Example Shared",
      ]),
    );
  });

  test("a name in a list of anything else stays out (negative control)", () => {
    const texts: Array<string> = extractedFrom(
      [
        'const people: Array<Person> = [{ name: "Ada Lovelace" }];',
        'function make(): Array<Row> { return [{ name: "row_id" }]; }',
        'const plain = [{ name: "Plain Name" }];',
      ].join("\n"),
    );

    for (const name of ["Ada Lovelace", "row_id", "Plain Name"]) {
      expect({ name, extracted: texts.includes(name) }).toEqual({
        name,
        extracted: false,
      });
    }
  });
});
