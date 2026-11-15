import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import {
  ADMIN_DASHBOARD_CODES,
  ADMIN_DASHBOARD_ENGLISH,
  readAdminDashboardLocale,
  readAdminDashboardSameAsEnglish,
  shippedAdminDashboardLocale,
} from "../../Helpers/AdminDashboardLocales";
import Detail from "../../../UI/Components/Detail/Detail";
import TranslatedSentence from "../../../UI/Components/TranslatedSentence/TranslatedSentence";
import FieldType from "../../../UI/Components/Types/FieldType";
import {
  getPluralOneFormKeys,
  RuntimeLocaleTree,
  SAME_AS_ENGLISH_MARK,
} from "../../../UI/esbuild-locales";
import {
  createTranslator,
  getPluralCategory,
  PluralTemplate,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * THE ADMIN DASHBOARD'S ONE FORMS THAT READ LIKE ENGLISH ARE ITS LANGUAGES'
 * OWN (#8068).
 *
 * A plural's "_one" form that reads exactly as English's is taken for
 * English left in the locale (isEnglishPlaceholder, Types/Translator): the
 * sentence is then English, in English's form for the count. Some languages
 * word their one form as English does on purpose - Portuguese "{{count}}
 * monitor" beside "{{count}} monitores", French "{{count}} minute". The
 * Admin Dashboard had no list of them, so Portuguese at 0, which it counts
 * as one, read English's "0 monitors", and French "0 minutes".
 *
 * Its build now ships a mark beside each form its language's same-as-English
 * list names (AdminDashboard/i18n/Progress/<code>.json, esbuild.config.js).
 * Read here through i18next set up as the Admin's Utils/i18n.ts sets it up,
 * with the locales as the build ships them, and through the shared
 * components that draw a count.
 */

const MONITORS: PluralTemplate = {
  one: "{{count}} monitor",
  other: "{{count}} monitors",
};
const MINUTES: PluralTemplate = {
  one: "{{count}} minute",
  other: "{{count}} minutes",
};
const INSTANCES: PluralTemplate = {
  one: "{{count}} instance",
  other: "{{count}} instances",
};
const PEOPLE: PluralTemplate = {
  one: "{{count}} person",
  other: "{{count}} people",
};
const PROJECTS: PluralTemplate = {
  one: "{{count}} project",
  other: "{{count}} projects",
};
const PRODUCTS: PluralTemplate = {
  one: "{{count}} product",
  other: "{{count}} products",
};

// Counts that land in every plural category the Admin's languages have.
const COUNTS: Array<number> = [0, 1, 2, 3, 5, 11, 21, 22, 25, 101, 1000000];

type Resources = Record<string, RuntimeLocaleTree>;

const shippedResources: () => Resources = (): Resources => {
  const resources: Resources = {};

  for (const code of ADMIN_DASHBOARD_CODES) {
    resources[code] = shippedAdminDashboardLocale(code);
  }

  return resources;
};

// The locale files as they are written, with no mark: the Admin before #8068.
const fileResources: () => Resources = (): Resources => {
  const resources: Resources = {};

  for (const code of ADMIN_DASHBOARD_CODES) {
    resources[code] = readAdminDashboardLocale(code);
  }

  return resources;
};

/*
 * An instance with the options the Admin Dashboard's Utils/i18n.ts passes.
 * Its language detector and lazy backend are left out: the language is
 * given here, and its words as the backend would hand them over.
 */
const createAdminInstance: (
  language: string,
  resources: Resources,
) => Promise<i18n> = async (
  language: string,
  resources: Resources,
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
    fallbackLng: ADMIN_DASHBOARD_ENGLISH,
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

const shipped: Map<string, Translator> = new Map<string, Translator>();
const unmarked: Map<string, Translator> = new Map<string, Translator>();
const shippedInstances: Map<string, i18n> = new Map<string, i18n>();

beforeAll(async () => {
  const marked: Resources = shippedResources();
  const files: Resources = fileResources();

  for (const code of ADMIN_DASHBOARD_CODES) {
    const instance: i18n = await createAdminInstance(code, marked);

    shippedInstances.set(code, instance);
    shipped.set(code, translatorFor(instance));
    unmarked.set(code, translatorFor(await createAdminInstance(code, files)));
  }
});

afterEach(() => {
  cleanup();
});

const read: (
  code: string,
  template: PluralTemplate,
  count: number,
) => string = (
  code: string,
  template: PluralTemplate,
  count: number,
): string => {
  return (shipped.get(code) as Translator).translatePlural(template, count);
};

describe("a one form a language words as English does is its own", () => {
  test("Portuguese counts 0 as one, and says 0 monitor", () => {
    expect(getPluralCategory("pt", 0)).toBe("one");
    expect(read("pt", MONITORS, 0)).toBe("0 monitor");
    expect(read("pt", MONITORS, 1)).toBe("1 monitor");
    expect(read("pt", MONITORS, 2)).toBe("2 monitores");
    expect(read("pt", MONITORS, 21)).toBe("21 monitores");
  });

  test("French counts 0 as one, and says 0 minute and 0 instance", () => {
    expect(getPluralCategory("fr", 0)).toBe("one");
    expect(read("fr", MINUTES, 0)).toBe("0 minute");
    expect(read("fr", MINUTES, 1)).toBe("1 minute");
    expect(read("fr", MINUTES, 5)).toBe("5 minutes");
    expect(read("fr", INSTANCES, 0)).toBe("0 instance");
    expect(read("fr", INSTANCES, 1)).toBe("1 instance");
    expect(read("fr", INSTANCES, 3)).toBe("3 instances");
  });

  test.each([
    ["es", "1 monitor", "3 monitores", MONITORS],
    ["da", "1 monitor", "3 monitorer", MONITORS],
    ["no", "1 monitor", "3 monitorer", MONITORS],
    ["sv", "1 monitor", "3 monitorer", MONITORS],
    ["da", "1 person", "3 personer", PEOPLE],
    ["no", "1 person", "3 personer", PEOPLE],
    ["sv", "1 person", "3 personer", PEOPLE],
    ["nl", "1 project", "3 projecten", PROJECTS],
    ["nl", "1 product", "3 producten", PRODUCTS],
  ])(
    "%s says %s, and %s",
    (code: string, one: string, three: string, template: PluralTemplate) => {
      expect(read(code, template, 1)).toBe(one);
      expect(read(code, template, 3)).toBe(three);
    },
  );

  // English reads its own two forms, with no mark to read.
  test("English reads 0 monitors and 1 monitor", () => {
    expect(read("en", MONITORS, 0)).toBe("0 monitors");
    expect(read("en", MONITORS, 1)).toBe("1 monitor");
    expect(read("en", MINUTES, 0)).toBe("0 minutes");
  });
});

/*
 * The files as they are written, unmarked: the one form reads as English
 * left in the locale, so the sentence is English's - "0 monitors" - at a
 * count the language reads its one form at but English does not.
 */
describe("without the marks", () => {
  test("Portuguese said English's 0 monitors, and French 0 minutes", () => {
    const portuguese: Translator = unmarked.get("pt") as Translator;
    const french: Translator = unmarked.get("fr") as Translator;

    expect(portuguese.translatePlural(MONITORS, 0)).toBe("0 monitors");
    expect(french.translatePlural(MINUTES, 0)).toBe("0 minutes");
    expect(french.translatePlural(INSTANCES, 0)).toBe("0 instances");
    // At 1, English's one form is the same text.
    expect(portuguese.translatePlural(MONITORS, 1)).toBe("1 monitor");
  });
});

/*
 * What the marks change: a reading of a plural at a count its language
 * reads the one form at, but English does not - and nothing else. Every
 * plural the Admin's en.json has, in every language, at counts that land in
 * every category.
 */
describe("the marks change what they should, and nothing else", () => {
  test("only Portuguese and French at 0 read otherwise", () => {
    const english: RuntimeLocaleTree = readAdminDashboardLocale(
      ADMIN_DASHBOARD_ENGLISH,
    );
    const changed: Array<string> = [];

    for (const code of ADMIN_DASHBOARD_CODES) {
      const withMarks: Translator = shipped.get(code) as Translator;
      const withoutMarks: Translator = unmarked.get(code) as Translator;

      for (const oneKey of getPluralOneFormKeys(english)) {
        const template: PluralTemplate = {
          one: english[oneKey] as string,
          other: oneKey.slice(0, -"_one".length),
        };

        for (const count of COUNTS) {
          const marked: string = withMarks.translatePlural(template, count, {
            itemName: "item",
            itemsName: "items",
          });
          const plain: string = withoutMarks.translatePlural(template, count, {
            itemName: "item",
            itemsName: "items",
          });

          if (marked !== plain) {
            changed.push(`${code} ${count}: ${plain} -> ${marked}`);
          }
        }
      }
    }

    expect(changed.sort()).toEqual(
      [
        "fr 0: 0 instances -> 0 instance",
        "fr 0: 0 minutes -> 0 minute",
        "pt 0: 0 monitors -> 0 monitor",
      ].sort(),
    );
  });

  /*
   * Every mark the build ships stands for a form on its language's list -
   * and every list entry is shipped as a mark, so a list names no form the
   * Admin does not word as English does.
   */
  test("each language ships a mark for every form on its list", () => {
    const marked: Record<string, Array<string>> = {};
    const listed: Record<string, Array<string>> = {};

    for (const code of ADMIN_DASHBOARD_CODES) {
      const locale: RuntimeLocaleTree = shippedAdminDashboardLocale(code);
      const marks: Array<string> = Object.keys(locale)
        .filter((key: string): boolean => {
          return key.endsWith(SAME_AS_ENGLISH_MARK);
        })
        .map((key: string): string => {
          return locale[key] as string;
        })
        .sort();
      const list: Array<string> = [
        ...readAdminDashboardSameAsEnglish(code),
      ].sort();

      if (marks.length > 0) {
        marked[code] = marks;
      }

      if (list.length > 0) {
        listed[code] = list;
      }
    }

    expect(marked).toEqual(listed);
    expect(marked).toEqual({
      da: ["{{count}} monitor", "{{count}} person"],
      es: ["{{count}} monitor"],
      fr: ["{{count}} instance", "{{count}} minute"],
      nl: ["{{count}} product", "{{count}} project"],
      no: ["{{count}} monitor", "{{count}} person"],
      pt: ["{{count}} monitor"],
      sv: ["{{count}} monitor", "{{count}} person"],
    });
  });
});

/*
 * The shared components draw the count the same way: a sentence with the
 * count as an element in it (TranslatedSentence), and a record's minutes
 * (Detail's FieldType.Minutes, "{{count}} minute").
 */
describe("drawn by the shared components", () => {
  const renderIn: (code: string, element: React.ReactElement) => HTMLElement = (
    code: string,
    element: React.ReactElement,
  ): HTMLElement => {
    return render(
      <I18nextProvider i18n={shippedInstances.get(code) as i18n}>
        {element}
      </I18nextProvider>,
    ).container;
  };

  test("a Portuguese sentence counts 0 monitor", () => {
    const container: HTMLElement = renderIn(
      "pt",
      <TranslatedSentence
        template={MONITORS}
        count={0}
        slots={{ count: <strong>0</strong> }}
      />,
    );

    expect(container).toHaveTextContent(/^0 monitor$/);
    expect(container.querySelector("strong")).toHaveTextContent("0");
  });

  test("a French record's 0 minutes reads 0 minute, and 5 reads 5 minutes", () => {
    const container: HTMLElement = renderIn(
      "fr",
      <Detail
        item={{ wait: 0, retry: 5 }}
        showRecordLine={false}
        fields={[
          { key: "wait", title: "Wait", fieldType: FieldType.Minutes },
          { key: "retry", title: "Retry", fieldType: FieldType.Minutes },
        ]}
      />,
    );

    const values: Array<string> = Array.from(
      container.querySelectorAll("[data-testid='detail-value']"),
    ).map((value: Element): string => {
      return (value.textContent || "").trim();
    });

    expect(values).toEqual(["0 minute", "5 minutes"]);
  });
});
