import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import ts from "typescript";
import {
  getPluralOneFormKeys,
  getRuntimeLocale,
  isLocaleTree,
  RuntimeLocaleTree,
} from "../../../UI/esbuild-locales";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  createTranslator,
  TemplateValues,
  translatableTerm,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "../../../Types/Dashboard/DashboardLanguage";
import EventItem, {
  TimelineItemType,
} from "../../../UI/Components/EventItem/EventItem";
import BulkUpdateForm from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Pill from "../../../UI/Components/Pill/Pill";
import TranslatedSentence from "../../../UI/Components/TranslatedSentence/TranslatedSentence";
import Route from "../../../Types/API/Route";
import { Green, Red } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * The Dashboard ships its locale files without what the English fallback
 * already renders (UI/esbuild-locales.js): en.json without its identity
 * entries and its plural "_one" forms, every other locale without its English
 * placeholders - bar the "_one" forms a language with a "one" form reads. That
 * is only safe if every lookup reads exactly the same from the shipped copies
 * as from the full files. This proves it on the real locale files, with
 * i18next set up the way App/FeatureSet/Dashboard/src/Utils/i18n.ts sets it
 * up:
 *
 *   - every flat key (value-keyed, read as useTranslateValue does, and with a
 *     bare t()), every template with its placeholders filled, every nested key
 *     and every plural sentence at counts that pick each language's forms -
 *     in all seventeen languages. A "_one" key is read the way the code reads
 *     it, as the "one" form of its plural, and no source reads it on its own;
 *   - and the shared components drawing those strings: nested keys and
 *     interpolation (EventItem), plurals (BulkUpdateForm), a whole sentence
 *     with elements in it (TranslatedSentence) and a translated text prop
 *     (Pill), in English and in German, with an untranslated German string
 *     falling back to English.
 *
 * Each i18next instance reaches the components through I18nextProvider only,
 * so nothing leaks into the global instance other suites use.
 */

// packages/Common/Tests/App/Dashboard -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const ENGLISH: string = DEFAULT_DASHBOARD_LANGUAGE;

const TRANSLATED_CODES: Array<string> =
  SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
    return code !== ENGLISH;
  });

// Counts that land in every plural category the Dashboard's languages have.
const COUNTS: Array<number> = [0, 1, 2, 3, 5, 11, 21, 22, 25, 101, 1.5];

const readLocale: (code: string) => RuntimeLocaleTree = (
  code: string,
): RuntimeLocaleTree => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as RuntimeLocaleTree;
};

const shippedLocale: (
  code: string,
  locale: RuntimeLocaleTree,
  english: RuntimeLocaleTree,
) => RuntimeLocaleTree = (
  code: string,
  locale: RuntimeLocaleTree,
  english: RuntimeLocaleTree,
): RuntimeLocaleTree => {
  return getRuntimeLocale({
    language: code,
    fallbackLanguage: ENGLISH,
    locale: locale,
    fallback: english,
  });
};

/*
 * An instance with the options the Dashboard's Utils/i18n.ts passes. Its
 * language detector and lazy backend are left out: the resources are given
 * here directly, as the backend would hand them over.
 */
const createDashboardInstance: (
  language: string,
  resources: Record<string, RuntimeLocaleTree>,
) => Promise<i18n> = async (
  language: string,
  resources: Record<string, RuntimeLocaleTree>,
): Promise<i18n> => {
  const instance: i18n = createInstance();
  const bundles: Record<string, { translation: RuntimeLocaleTree }> = {};

  for (const code of Object.keys(resources)) {
    bundles[code] = { translation: resources[code] as RuntimeLocaleTree };
  }

  await instance.init({
    lng: language,
    resources: bundles,
    partialBundledLanguages: true,
    fallbackLng: ENGLISH,
    supportedLngs: SUPPORTED_DASHBOARD_LANGUAGE_CODES,
    load: "currentOnly",
    interpolation: { escapeValue: false },
  });

  return instance;
};

// The lookup useTranslateValue() gives the shared components.
const translatorFor: (instance: i18n) => Translator = (
  instance: i18n,
): Translator => {
  return createTranslator((text: string): string | undefined => {
    const translated: unknown = instance.t(text, {
      defaultValue: text,
      keySeparator: false,
      nsSeparator: false,
    });

    return typeof translated === "string" ? translated : text;
  }, instance.resolvedLanguage || instance.language);
};

const PLACEHOLDER: RegExp = /\{\{\s*([\w.]+)\s*\}\}/g;

// A value for every placeholder: a word to translate, or a plain name.
const sampleValues: (template: string) => TemplateValues = (
  template: string,
): TemplateValues => {
  const values: TemplateValues = {};

  for (const match of template.matchAll(PLACEHOLDER)) {
    const name: string = match[1] as string;

    values[name] = name.toLowerCase().includes("name")
      ? translatableTerm("Monitors", { inSentence: true })
      : `«${name}»`;
  }

  return values;
};

interface Reading {
  label: string;
  text: string;
}

/*
 * Every string the locale files can put on a screen, read through one
 * instance, in a fixed order - two instances that read the same give equal
 * lists.
 */
const readEverything: (
  instance: i18n,
  english: RuntimeLocaleTree,
) => Array<Reading> = (
  instance: i18n,
  english: RuntimeLocaleTree,
): Array<Reading> => {
  const translator: Translator = translatorFor(instance);
  const readings: Array<Reading> = [];

  const walkNested: (node: RuntimeLocaleTree, prefix: Array<string>) => void = (
    node: RuntimeLocaleTree,
    prefix: Array<string>,
  ): void => {
    for (const key of Object.keys(node)) {
      const value: unknown = node[key];
      const keyPath: Array<string> = [...prefix, key];

      if (isLocaleTree(value)) {
        walkNested(value, keyPath);
      } else if (typeof value === "string") {
        const nestedKey: string = keyPath.join(".");

        readings.push({
          label: `t(${nestedKey})`,
          text: String(instance.t(nestedKey, sampleValues(value))),
        });
      }
    }
  };

  const pluralOneForms: Set<string> = new Set<string>(
    getPluralOneFormKeys(english),
  );

  for (const key of Object.keys(english)) {
    const value: unknown = english[key];

    if (isLocaleTree(value)) {
      walkNested(value, [key]);
      continue;
    }

    /*
     * A "_one" key is the "one" form of the plural under its base key, read
     * with that key below at every count. Nothing looks it up on its own
     * (proved below), so it is not read on its own here either.
     */
    if (pluralOneForms.has(key)) {
      continue;
    }

    readings.push({
      label: `translateText(${key})`,
      text: translator.translateText(key) || "",
    });
    readings.push({ label: `t(${key})`, text: String(instance.t(key)) });

    if (key.includes("{{")) {
      readings.push({
        label: `translateTemplate(${key})`,
        text: translator.translateTemplate(key, sampleValues(key)),
      });
    }

    const one: unknown = english[`${key}_one`];

    if (typeof one === "string") {
      for (const count of COUNTS) {
        readings.push({
          label: `translatePlural(${key}, ${count})`,
          text: translator.translatePlural(
            { one: one, other: key },
            count,
            sampleValues(`${one} ${key}`),
          ),
        });
      }
    }
  }

  return readings;
};

const differentReadings: (
  shipped: Array<Reading>,
  full: Array<Reading>,
) => Array<string> = (
  shipped: Array<Reading>,
  full: Array<Reading>,
): Array<string> => {
  const differences: Array<string> = [];

  expect(shipped.length).toBe(full.length);

  full.forEach((reading: Reading, index: number): void => {
    const other: Reading = shipped[index] as Reading;

    if (other.text !== reading.text && differences.length < 20) {
      differences.push(
        `${reading.label}: ${JSON.stringify(other.text)} instead of ${JSON.stringify(reading.text)}`,
      );
    }
  });

  return differences;
};

const fullEnglish: RuntimeLocaleTree = readLocale(ENGLISH);
const shippedEnglish: RuntimeLocaleTree = shippedLocale(
  ENGLISH,
  fullEnglish,
  fullEnglish,
);

describe("what the shipped locales read, against the full files", () => {
  test("the shipped English is a small part of en.json", () => {
    const fullKeys: number = Object.keys(fullEnglish).length;
    const shippedKeys: number = Object.keys(shippedEnglish).length;

    expect(shippedKeys).toBeGreaterThan(0);
    expect(shippedKeys).toBeLessThan(fullKeys / 100);
  });

  /*
   * The readings take a "_one" key only as the "one" form of its plural,
   * because that is the only way the front ends read one: a PluralTemplate
   * handed to translatePlural. A string literal naming a "_one" key would be
   * a lookup of it on its own, which the shipped English - without its
   * "_one" forms - answers with the key.
   */
  test("no source reads a plural _one form on its own", () => {
    const oneForms: Set<string> = new Set<string>(
      getPluralOneFormKeys(fullEnglish),
    );
    const found: Array<string> = [];
    let scanned: number = 0;

    const collect: (file: string, node: ts.Node) => void = (
      file: string,
      node: ts.Node,
    ): void => {
      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)) &&
        oneForms.has(node.text)
      ) {
        found.push(`${path.relative(REPOSITORY_ROOT, file)}: ${node.text}`);
      }

      ts.forEachChild(node, (child: ts.Node): void => {
        collect(file, child);
      });
    };

    for (const root of listScanRoots(REPOSITORY_ROOT)) {
      for (const file of listSourceFiles(root)) {
        scanned++;

        const source: string = fs.readFileSync(file, "utf8");

        // A file without the suffix names no "_one" key.
        if (!source.includes("_one")) {
          continue;
        }

        collect(
          file,
          ts.createSourceFile(
            file,
            source,
            ts.ScriptTarget.Latest,
            true,
            file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
          ),
        );
      }
    }

    expect(oneForms.size).toBeGreaterThan(100);
    expect(scanned).toBeGreaterThan(1000);
    expect(found).toEqual([]);
  });

  test("English reads the same: value-keyed, nested, plural and interpolated", async () => {
    const full: i18n = await createDashboardInstance(ENGLISH, {
      en: fullEnglish,
    });
    const shipped: i18n = await createDashboardInstance(ENGLISH, {
      en: shippedEnglish,
    });

    const fullReadings: Array<Reading> = readEverything(full, fullEnglish);

    expect(fullReadings.length).toBeGreaterThan(20000);
    expect(
      differentReadings(readEverything(shipped, fullEnglish), fullReadings),
    ).toEqual([]);
  });

  test.each(TRANSLATED_CODES)(
    "%s reads the same, its untranslated strings in English",
    async (code: string) => {
      const locale: RuntimeLocaleTree = readLocale(code);
      const full: i18n = await createDashboardInstance(code, {
        en: fullEnglish,
        [code]: locale,
      });
      const shipped: i18n = await createDashboardInstance(code, {
        en: shippedEnglish,
        [code]: shippedLocale(code, locale, fullEnglish),
      });

      expect(
        differentReadings(
          readEverything(shipped, fullEnglish),
          readEverything(full, fullEnglish),
        ),
      ).toEqual([]);
    },
  );
});

describe("the shared components, from the shipped locales", () => {
  let english: i18n;
  let german: i18n;
  let germanFull: i18n;
  // English everywhere: a front end whose locale has none of these keys.
  let noKeys: i18n;

  const fullGerman: RuntimeLocaleTree = readLocale("de");

  beforeAll(async () => {
    english = await createDashboardInstance(ENGLISH, { en: shippedEnglish });
    german = await createDashboardInstance("de", {
      en: shippedEnglish,
      de: shippedLocale("de", fullGerman, fullEnglish),
    });
    germanFull = await createDashboardInstance("de", {
      en: fullEnglish,
      de: fullGerman,
    });
    noKeys = await createDashboardInstance(ENGLISH, { en: {} });
  });

  afterEach(() => {
    cleanup();
  });

  const inLocale: (instance: i18n, element: ReactElement) => string = (
    instance: i18n,
    element: ReactElement,
  ): string => {
    const { container } = render(
      <I18nextProvider i18n={instance}>{element}</I18nextProvider>,
    );

    return container.textContent || "";
  };

  const eventItem: () => ReactElement = (): ReactElement => {
    return (
      <EventItem
        eventTitle="Checkout is slow"
        eventType="Incident"
        eventTypeColor={Red}
        eventResourcesAffected={["Checkout API"]}
        eventTimeline={[
          {
            date: new Date("2026-03-04T05:06:00.000Z"),
            type: TimelineItemType.StateChange,
            stateDisplayName: "Resolved",
            icon: IconProp.CheckCircle,
            iconColor: Green,
          },
          {
            date: new Date("2026-03-04T05:00:00.000Z"),
            type: TimelineItemType.Note,
            note: "We rolled the deploy back.",
            icon: IconProp.Chat,
            iconColor: Green,
          },
        ]}
        eventViewRoute={new Route("/status-page/incidents/42")}
        isDetailItem={false}
        eventSecondDescription=""
      />
    );
  };

  const bulkForm: (selected: number) => ReactElement = (
    selected: number,
  ): ReactElement => {
    return (
      <BulkUpdateForm<{ _id: string }>
        selectedItems={Array.from(
          { length: selected },
          (_item: unknown, index: number) => {
            return { _id: `row-${index}` };
          },
        )}
        isAllItemsSelected={false}
        onSelectAllClick={() => {}}
        onClearSelectionClick={() => {}}
        singularLabel="Monitor"
        pluralLabel="Monitors"
        buttons={[
          {
            title: "Archive",
            icon: IconProp.Archive,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: (): Promise<void> => {
              return Promise.resolve();
            },
          },
        ]}
      />
    );
  };

  const sentence: () => ReactElement = (): ReactElement => {
    return (
      <p>
        <TranslatedSentence
          template="{{field}} contains {{value}}"
          slots={{
            field: <strong>Name</strong>,
            value: <strong>api</strong>,
          }}
        />
      </p>
    );
  };

  test("EventItem reads its nested keys in English, the event type filled in", () => {
    inLocale(english, eventItem());

    expect(screen.getByText("Affected resources")).toBeInTheDocument();
    expect(screen.getByText("state changed to")).toBeInTheDocument();
    expect(screen.getByText("Update to this Incident")).toBeInTheDocument();
    expect(screen.getByText(/^posted on /)).toBeInTheDocument();
    expect(screen.getByText("View Incident")).toBeInTheDocument();
  });

  test("EventItem reads its nested keys in German", () => {
    const text: string = inLocale(german, eventItem());

    expect(screen.getByText("Betroffene Ressourcen")).toBeInTheDocument();
    expect(screen.getByText("Status geändert auf")).toBeInTheDocument();
    expect(screen.getByText("Update zu diesem Incident")).toBeInTheDocument();
    expect(screen.getByText(/^veröffentlicht am /)).toBeInTheDocument();
    expect(screen.getByText("Incident ansehen")).toBeInTheDocument();
    expect(text).not.toContain("eventItem.");
  });

  test("EventItem reads English, never a raw key, where no locale has its keys", () => {
    const text: string = inLocale(noKeys, eventItem());

    expect(screen.getByText("Affected resources")).toBeInTheDocument();
    expect(screen.getByText("View Incident")).toBeInTheDocument();
    expect(text).not.toContain("eventItem.");
  });

  test("a count reads in English's plural forms", () => {
    inLocale(english, bulkForm(3));

    expect(screen.getByText("3 Monitors Selected")).toBeInTheDocument();
    expect(screen.getByText("Select All Monitors")).toBeInTheDocument();

    cleanup();
    inLocale(english, bulkForm(1));

    expect(screen.getByText("1 Monitor Selected")).toBeInTheDocument();
  });

  test("a count reads in German's plural forms, as from the full files", () => {
    for (const selected of [1, 3]) {
      const fromFull: string = inLocale(germanFull, bulkForm(selected));

      cleanup();

      const shipped: string = inLocale(german, bulkForm(selected));

      cleanup();

      expect(shipped).toBe(fromFull);
      expect(shipped).toContain("ausgewählt");
    }
  });

  test("a sentence with elements in it reads in each language", () => {
    expect(inLocale(english, sentence())).toBe("Name contains api");

    cleanup();

    const fromFull: string = inLocale(germanFull, sentence());

    cleanup();

    const shipped: string = inLocale(german, sentence());

    expect(shipped).toBe(fromFull);
    expect(shipped).toBe("Name enthält api");
    expect(screen.getByText("api").tagName).toBe("STRONG");
  });

  test("a translated text prop reads in each language", () => {
    expect(inLocale(english, <Pill text="Operational" color={Green} />)).toBe(
      "Operational",
    );

    cleanup();

    expect(inLocale(german, <Pill text="Operational" color={Green} />)).toBe(
      fullGerman["Operational"] as string,
    );
  });

  test("a German string that is still English is not shipped, and reads in English", async () => {
    // German as a translator might leave it: two strings not done yet.
    const unfinished: RuntimeLocaleTree = {
      ...fullGerman,
      Operational: "Operational",
      eventItem: {
        ...(fullGerman["eventItem"] as RuntimeLocaleTree),
        view: "View {{eventType}}",
      },
    };
    const shipped: RuntimeLocaleTree = shippedLocale(
      "de",
      unfinished,
      fullEnglish,
    );

    expect(shipped["Operational"]).toBeUndefined();
    expect((shipped["eventItem"] as RuntimeLocaleTree)["view"]).toBeUndefined();

    const instance: i18n = await createDashboardInstance("de", {
      en: shippedEnglish,
      de: shipped,
    });

    expect(inLocale(instance, <Pill text="Operational" color={Green} />)).toBe(
      "Operational",
    );

    cleanup();
    inLocale(instance, eventItem());

    expect(screen.getByText("View Incident")).toBeInTheDocument();
    // The strings that are translated stay German.
    expect(screen.getByText("Betroffene Ressourcen")).toBeInTheDocument();
  });
});
