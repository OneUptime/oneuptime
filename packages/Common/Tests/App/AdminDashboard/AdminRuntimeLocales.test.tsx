import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import ts from "typescript";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  getPluralOneFormKeys,
  isLocaleTree,
  RuntimeLocaleTree,
  SAME_AS_ENGLISH_MARK,
} from "../../../UI/esbuild-locales";
import {
  ADMIN_DASHBOARD_CODES,
  ADMIN_DASHBOARD_DIRECTORY,
  ADMIN_DASHBOARD_ENGLISH,
  markedAdminDashboardLocale,
  readAdminDashboardLocale,
  shippedAdminDashboardLocale,
} from "../../Helpers/AdminDashboardLocales";
import {
  createTranslator,
  TemplateValues,
  translatableTerm,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import TranslatedSentence from "../../../UI/Components/TranslatedSentence/TranslatedSentence";
import Pill from "../../../UI/Components/Pill/Pill";
import { Green } from "../../../Types/BrandColors";

/*
 * THE ADMIN DASHBOARD'S SHIPPED LOCALES READ AS ITS FILES DO (#8146).
 *
 * The Admin Dashboard shipped every locale whole, all eighteen in the entry
 * chunk, because nothing showed its lookups read the same from the trimmed
 * copies the Dashboard ships. It ships them trimmed now, as the Dashboard's
 * (Common/UI/esbuild-locales.js): en.json without its identity entries and
 * its plural "_one" forms, every other locale without the strings English
 * reads the same - bar the "_one" forms a language with a "one" form reads,
 * and the marks beside the ones it words as English does on purpose.
 *
 * That is only safe if every lookup reads exactly the same from the shipped
 * copies as from the files (with the same marks), so this proves it on the
 * real Admin locale files, with i18next set up the way the Admin's
 * Utils/i18n.ts sets it up, in all eighteen languages:
 *
 *   - every flat key, read as useTranslateValue reads it and with a bare
 *     t(), and - since the Admin's pages call t() themselves
 *     (t("Send test: {{name}}", { name })) - with its values too; every
 *     template filled; every nested key (t("pages.settings.sso.cardTitle"));
 *     every plural at counts that pick each language's forms;
 *   - and the Admin's own pages and the shared components drawing them, in
 *     German and Persian: the page reads the same text from both.
 *
 * Each i18next instance reaches the components through I18nextProvider
 * only, so nothing leaks into the global instance other suites use. The
 * same check for the Dashboard is Tests/App/Dashboard/DashboardRuntimeLocales.
 */

jest.setTimeout(120000);

const mockFetchFeedbackSummary: MockFunction = getJestMockFunction();
const mockFetchFeedbackList: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ProductFeedback",
  () => {
    return {
      __esModule: true,
      fetchFeedbackSummary: (...args: Array<unknown>): unknown => {
        return mockFetchFeedbackSummary(...args);
      },
      fetchFeedbackList: (...args: Array<unknown>): unknown => {
        return mockFetchFeedbackList(...args);
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelSwitch/ModelSwitchCard", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: () => {
      return react.createElement("div");
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { children?: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/ClickhouseCapacitySummary",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/VisitorAddressesSummary",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import FeedbackPage from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Feedback/Index";
import CommunityHealthOverview from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/CommunityHealthOverview";
import EnterpriseHealthUpgrade from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/EnterpriseHealthUpgrade";
import {
  ProductFeedbackKind,
  summarizeProductFeedback,
} from "../../../Types/ProductFeedback/ProductFeedback";

// packages/Common/Tests/App/AdminDashboard -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const ENGLISH: string = ADMIN_DASHBOARD_ENGLISH;

const TRANSLATED_CODES: Array<string> = ADMIN_DASHBOARD_CODES.filter(
  (code: string): boolean => {
    return code !== ENGLISH;
  },
);

// Counts that land in every plural category the Admin's languages have.
const COUNTS: Array<number> = [0, 1, 2, 3, 5, 11, 21, 22, 25, 101, 1.5];

/*
 * An instance with the options the Admin Dashboard's Utils/i18n.ts passes.
 * Its language detector and lazy backend are left out: the resources are
 * given here directly, as the backend hands them over.
 */
const createAdminInstance: (
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
    supportedLngs: [...ADMIN_DASHBOARD_CODES],
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

const SOURCE_FILE: RegExp = /\.tsx?$/;

// A value for every placeholder: a word to translate, or a plain name.
const sampleValues: (template: string) => TemplateValues = (
  template: string,
): TemplateValues => {
  const values: TemplateValues = {};

  for (const match of template.matchAll(PLACEHOLDER)) {
    const name: string = match[1] as string;

    values[name] = name.toLowerCase().includes("name")
      ? translatableTerm("Projects", { inSentence: true })
      : `«${name}»`;
  }

  return values;
};

// The values a page hands t() itself: plain strings.
const plainValues: (template: string) => Record<string, string> = (
  template: string,
): Record<string, string> => {
  const values: Record<string, string> = {};

  for (const match of template.matchAll(PLACEHOLDER)) {
    values[match[1] as string] = `«${match[1]}»`;
  }

  return values;
};

interface Reading {
  label: string;
  text: string;
}

/*
 * Every string the locale files can put on a screen, read through one
 * instance, in a fixed order: two instances that read the same give equal
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
          text: String(instance.t(nestedKey, plainValues(value))),
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

    // A "_one" key is read as the one form of its plural, at every count below.
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
      readings.push({
        label: `t(${key}, values)`,
        text: String(instance.t(key, plainValues(key))),
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

const fullEnglish: RuntimeLocaleTree = readAdminDashboardLocale(ENGLISH);
const shippedEnglish: RuntimeLocaleTree = shippedAdminDashboardLocale(ENGLISH);

const fullResources: (code: string) => Record<string, RuntimeLocaleTree> = (
  code: string,
): Record<string, RuntimeLocaleTree> => {
  return code === ENGLISH
    ? { en: fullEnglish }
    : { en: fullEnglish, [code]: markedAdminDashboardLocale(code) };
};

const shippedResources: (code: string) => Record<string, RuntimeLocaleTree> = (
  code: string,
): Record<string, RuntimeLocaleTree> => {
  return code === ENGLISH
    ? { en: shippedEnglish }
    : { en: shippedEnglish, [code]: shippedAdminDashboardLocale(code) };
};

describe("what the Admin Dashboard's shipped locales read, against its files", () => {
  test("the shipped English is a small part of en.json: its nested keys and the texts it words apart", () => {
    const fullKeys: number = Object.keys(fullEnglish).length;
    const shippedKeys: number = Object.keys(shippedEnglish).length;

    expect(fullKeys).toBeGreaterThan(2000);
    expect(shippedKeys).toBeGreaterThan(0);
    expect(shippedKeys).toBeLessThan(fullKeys / 50);
    // The nested keys pages read with t("pages.settings.email.smtpCardTitle") stay.
    expect(Object.keys(shippedEnglish)).toEqual(
      expect.arrayContaining(["pages", "breadcrumbs", "sideMenu", "navbar"]),
    );
    // No plural "_one" form: each language ships the ones it reads.
    expect(getPluralOneFormKeys(fullEnglish).length).toBeGreaterThan(50);
    expect(
      getPluralOneFormKeys(fullEnglish).filter((key: string): boolean => {
        return Object.prototype.hasOwnProperty.call(shippedEnglish, key);
      }),
    ).toEqual([]);
  });

  test("every language ships less than its file, and the eighteen together far less than they weighed", () => {
    let fileBytes: number = 0;
    let shippedBytes: number = 0;

    for (const code of ADMIN_DASHBOARD_CODES) {
      const file: number = JSON.stringify(
        code === ENGLISH ? fullEnglish : readAdminDashboardLocale(code),
      ).length;
      const shipped: number = JSON.stringify(
        shippedAdminDashboardLocale(code),
      ).length;

      expect([code, shipped < file]).toEqual([code, true]);
      fileBytes += file;
      shippedBytes += shipped;
    }

    expect(shippedBytes).toBeLessThan(fileBytes);
  });

  /*
   * The readings take a "_one" key only as the one form of its plural,
   * because that is the only way a page reads one: a PluralTemplate handed
   * to translatePlural. A string literal naming a "_one" key would be a
   * lookup of it on its own, which the shipped English - without its "_one"
   * forms - answers with the key.
   */
  test("no Admin source, nor any shared component it draws, reads a plural _one form on its own", () => {
    const oneForms: Set<string> = new Set<string>(
      getPluralOneFormKeys(fullEnglish),
    );
    const found: Array<string> = [];
    let scanned: number = 0;

    const roots: Array<string> = [
      path.join(ADMIN_DASHBOARD_DIRECTORY, "src"),
      path.join(REPOSITORY_ROOT, "packages", "Common", "UI"),
      path.join(REPOSITORY_ROOT, "packages", "Common", "Types"),
      path.join(REPOSITORY_ROOT, "ee", "AdminDashboard"),
    ].filter((root: string): boolean => {
      return fs.existsSync(root);
    });

    const walk: (dir: string) => Array<string> = (
      dir: string,
    ): Array<string> => {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry: fs.Dirent): Array<string> => {
          const full: string = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            return entry.name === "node_modules" ? [] : walk(full);
          }

          return SOURCE_FILE.test(entry.name) ? [full] : [];
        });
    };

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

    for (const root of roots) {
      for (const file of walk(root)) {
        scanned++;

        const source: string = fs.readFileSync(file, "utf8");

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

    expect(scanned).toBeGreaterThan(1000);
    expect(found).toEqual([]);
  });

  test("English reads the same: value-keyed, bare, with values, nested, plural and interpolated", async () => {
    const full: i18n = await createAdminInstance(
      ENGLISH,
      fullResources(ENGLISH),
    );
    const shipped: i18n = await createAdminInstance(
      ENGLISH,
      shippedResources(ENGLISH),
    );

    const fullReadings: Array<Reading> = readEverything(full, fullEnglish);

    expect(fullReadings.length).toBeGreaterThan(5000);
    expect(
      differentReadings(readEverything(shipped, fullEnglish), fullReadings),
    ).toEqual([]);
  });

  test.each(TRANSLATED_CODES)(
    "%s reads the same, its strings still in English read in English",
    async (code: string) => {
      const full: i18n = await createAdminInstance(code, fullResources(code));
      const shipped: i18n = await createAdminInstance(
        code,
        shippedResources(code),
      );

      expect(
        differentReadings(
          readEverything(shipped, fullEnglish),
          readEverything(full, fullEnglish),
        ),
      ).toEqual([]);
    },
  );

  /*
   * The comparison has teeth: a copy that also dropped what a page reads
   * - the nested keys, or a language's one forms - reads otherwise, and is
   * named.
   */
  test("a copy trimmed too far is told apart: no nested keys in English, no one forms in German", async () => {
    const full: i18n = await createAdminInstance("de", fullResources("de"));
    const withoutNested: RuntimeLocaleTree = Object.fromEntries(
      Object.entries(shippedEnglish).filter(
        ([, value]: [string, unknown]): boolean => {
          return !isLocaleTree(value);
        },
      ),
    ) as RuntimeLocaleTree;
    const germanWithoutOneForms: RuntimeLocaleTree = Object.fromEntries(
      Object.entries(shippedAdminDashboardLocale("de")).filter(
        ([key]: [string, unknown]): boolean => {
          return !key.endsWith("_one");
        },
      ),
    ) as RuntimeLocaleTree;

    for (const resources of [
      { en: withoutNested, de: shippedAdminDashboardLocale("de") },
      { en: shippedEnglish, de: germanWithoutOneForms },
    ]) {
      const broken: i18n = await createAdminInstance("de", resources);

      expect(
        differentReadings(
          readEverything(broken, fullEnglish),
          readEverything(full, fullEnglish),
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  /*
   * #8068's forms, from the shipped copies: Portuguese counts 0 as one and
   * says "0 monitor", French "0 minute" and "0 instance". Their marks ship
   * in the lazy chunks as they did in the whole files.
   */
  test.each([
    [
      "pt",
      { one: "{{count}} monitor", other: "{{count}} monitors" },
      0,
      "0 monitor",
    ],
    [
      "pt",
      { one: "{{count}} monitor", other: "{{count}} monitors" },
      1,
      "1 monitor",
    ],
    [
      "fr",
      { one: "{{count}} minute", other: "{{count}} minutes" },
      0,
      "0\u00A0minute",
    ],
    [
      "fr",
      { one: "{{count}} instance", other: "{{count}} instances" },
      0,
      "0 instance",
    ],
    [
      "sv",
      { one: "{{count}} person", other: "{{count}} people" },
      1,
      "1 person",
    ],
  ])(
    "%s reads its own one form from the shipped copy: %j at %d",
    async (
      code: string,
      template: { one: string; other: string },
      count: number,
      expected: string,
    ) => {
      const shipped: i18n = await createAdminInstance(
        code,
        shippedResources(code),
      );

      expect(translatorFor(shipped).translatePlural(template, count)).toBe(
        expected,
      );
      expect(
        Object.keys(shippedAdminDashboardLocale(code)).some(
          (key: string): boolean => {
            return key === `${template.other}_one${SAME_AS_ENGLISH_MARK}`;
          },
        ),
      ).toBe(true);
    },
  );
});

describe("the Admin Dashboard's own pages, from the shipped locales", () => {
  beforeEach(() => {
    mockFetchFeedbackSummary.mockReset();
    mockFetchFeedbackList.mockReset();
    mockFetchFeedbackSummary.mockResolvedValue({
      sinceDays: 90,
      topics: summarizeProductFeedback([
        {
          kind: ProductFeedbackKind.SetupFlow,
          topic: "website_down",
          score: 4,
          isPositive: null,
          hasDetails: true,
        },
      ]),
      askAi: { helpful: 3, notHelpful: 1, ratedDown: null },
    } as never);
    mockFetchFeedbackList.mockResolvedValue({ items: [], count: 0 } as never);
  });

  afterEach(() => {
    cleanup();
  });

  const textOf: (
    instance: i18n,
    element: ReactElement,
    ready: () => void,
  ) => Promise<string> = async (
    instance: i18n,
    element: ReactElement,
    ready: () => void,
  ): Promise<string> => {
    const { container, unmount } = render(
      <I18nextProvider i18n={instance}>{element}</I18nextProvider>,
    );

    await waitFor(ready);

    const text: string = container.textContent || "";

    unmount();

    return text;
  };

  test.each(["en", "de", "fa", "ar"])(
    "%s: the Feedback page reads the same from the shipped copies",
    async (code: string) => {
      const ready: () => void = (): void => {
        expect(screen.getByTestId("admin-feedback-average")).toBeVisible();
      };
      const fromFiles: string = await textOf(
        await createAdminInstance(code, fullResources(code)),
        <FeedbackPage />,
        ready,
      );
      const shipped: string = await textOf(
        await createAdminInstance(code, shippedResources(code)),
        <FeedbackPage />,
        ready,
      );

      expect(shipped).toBe(fromFiles);
      expect(shipped).toContain(
        readAdminDashboardLocale(code)["By Question"] as string,
      );
    },
  );

  test.each(["en", "de", "fa", "ar"])(
    "%s: the Health page and its upgrade card read the same from the shipped copies",
    async (code: string) => {
      const page: () => ReactElement = (): ReactElement => {
        return (
          <div>
            <CommunityHealthOverview />
            <EnterpriseHealthUpgrade
              featureName="Query Console"
              featureDescription="Run queries against this instance's datastores."
            />
          </div>
        );
      };
      const ready: () => void = (): void => {
        expect(document.body.textContent).toContain("ClickHouse");
      };
      const fromFiles: string = await textOf(
        await createAdminInstance(code, fullResources(code)),
        page(),
        ready,
      );
      const shipped: string = await textOf(
        await createAdminInstance(code, shippedResources(code)),
        page(),
        ready,
      );

      expect(shipped).toBe(fromFiles);
      expect(shipped).toContain(
        readAdminDashboardLocale(code)["Available on every edition"] as string,
      );
    },
  );

  test("a shared component's sentence and a translated prop read the same, German and Persian", async () => {
    for (const code of ["de", "fa"]) {
      const element: ReactElement = (
        <div>
          <TranslatedSentence
            template="{{count}} of {{total}}"
            slots={{ count: <strong>3</strong>, total: <strong>5</strong> }}
          />
          <Pill text="Enabled" color={Green} />
        </div>
      );
      const ready: () => void = (): void => {
        expect(document.body.textContent).toContain("3");
      };

      const fromFiles: string = await textOf(
        await createAdminInstance(code, fullResources(code)),
        element,
        ready,
      );
      const shipped: string = await textOf(
        await createAdminInstance(code, shippedResources(code)),
        element,
        ready,
      );

      expect([code, shipped]).toEqual([code, fromFiles]);
    }
  });

  test("a string a language still holds in English is not shipped, and reads in English", async () => {
    // German as a translator might leave it: one text not done yet.
    const unfinished: RuntimeLocaleTree = {
      ...readAdminDashboardLocale("de"),
      "By Question": "By Question",
    };
    const shippedGerman: RuntimeLocaleTree = shippedAdminDashboardLocale("de");

    expect(shippedGerman["By Question"]).toBe(
      readAdminDashboardLocale("de")["By Question"],
    );

    const instance: i18n = await createAdminInstance("de", {
      en: shippedEnglish,
      de: Object.fromEntries(
        Object.entries(unfinished).filter(
          ([key, value]: [string, unknown]): boolean => {
            return value !== fullEnglish[key];
          },
        ),
      ) as RuntimeLocaleTree,
    });

    expect(translatorFor(instance).translateText("By Question")).toBe(
      "By Question",
    );
    // The strings that are translated stay German.
    expect(translatorFor(instance).translateText("What People Said")).toBe(
      readAdminDashboardLocale("de")["What People Said"],
    );
  });
});
