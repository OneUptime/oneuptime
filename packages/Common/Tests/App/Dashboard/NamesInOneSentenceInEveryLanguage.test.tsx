import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import CorrelateFilterBuilder from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateFilterBuilder";
import CorrelateFilterChips from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateFilterChips";
import {
  CorrelationCondition,
  CorrelationFieldKey,
  CorrelationOperator,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventCorrelation";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import {
  getTemplatePlaceholders,
  translatableTerm,
  Translator,
} from "../../../Types/Translator";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import FiltersForm from "../../../UI/Components/Filters/FiltersForm";
import Filter from "../../../UI/Components/Filters/Types/Filter";
import FieldType from "../../../UI/Components/Types/FieldType";
import {
  dashboardTranslator,
  readDashboardLocale,
  readDashboardSameAsEnglish,
} from "../../Helpers/DashboardLocales";
import {
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
  STATUS_PAGE_LANGUAGES,
} from "../../Helpers/TranslatedLanguages";

/*
 * NAMES AND TITLES IN ONE SENTENCE, IN EVERY LANGUAGE (#8076).
 *
 * Every table row's ⋯ was named "More actions for" and then the row's
 * name, the Correlate builder's remove buttons "Remove condition" and then
 * a Latin figure, a security playbook's buttons "View" or "Add Playbook",
 * a colon and the template's name, and a filter's clear button "Clear",
 * its title and "filter": each piece translated, joined in English's
 * order. Japanese puts a name first, Persian writes its own digits, French
 * sets its colon apart. Each is now one key with {{placeholders}}, worded
 * in every language the frontends offer.
 *
 * This reads the shipped locale files: each of the sentences is worded in
 * every Dashboard language and keeps its placeholders; drawn with the
 * Dashboard's own Japanese, German and Persian words, each name reads in
 * the language's order and digits; and the Admin Dashboard and the status
 * page word theirs too. SentencesFromTranslatedPiecesGuard keeps new ones
 * from being joined again.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

// The sentences this issue made, as en.json holds them.
const SENTENCES: ReadonlyArray<string> = [
  "More actions for {{name}}",
  "Remove condition {{number}}",
  "View: {{name}}",
  "Add Playbook: {{name}}",
  "Add Rule: {{name}}",
  "Clear {{filter}}",
  "Clear {{filter}} filter",
  "Move Up: {{name}}",
  "Move Down: {{name}}",
  "Reload list: {{title}}",
  "Show more: {{title}}",
  "Show on map {{name}}",
  "Trigger: {{name}}",
  "{{name}}, Secret",
  "Value {{number}}",
  "Last refreshed: {{time}}",
  "{{shown}} of {{total}} resources shown.",
  "{{shown}} of {{total}} connections shown.",
  "On call now, until {{time}}",
  "On call now, until at least {{time}}",
  "{{start}} – at least {{end}}",
  "{{count}} conditions",
  "{{count}} connections",
  "{{count}} critical or high",
  "{{count}} less frequent not shown",
  "{{count}} less frequent observables not drawn",
  "{{from}} – {{to}}: {{count}} events",
];

const ENGLISH: Record<string, string> = readDashboardLocale("en");

const placeholdersOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return getTemplatePlaceholders(text).sort();
};

afterEach(() => {
  cleanup();
});

describe("the sentences, in every Dashboard language", () => {
  test("each is a key of en.json, mapped to itself", () => {
    for (const sentence of SENTENCES) {
      expect({ sentence, english: ENGLISH[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each, its own words, with the English placeholders",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const sameAsEnglish: ReadonlyArray<string> =
        readDashboardSameAsEnglish(language);

      for (const sentence of SENTENCES) {
        const worded: string | undefined = words[sentence];

        expect({ sentence, isWorded: typeof worded === "string" }).toEqual({
          sentence,
          isWorded: true,
        });
        expect({ sentence, placeholders: placeholdersOf(worded!) }).toEqual({
          sentence,
          placeholders: placeholdersOf(sentence),
        });
        expect({
          sentence,
          isEnglish: worded === sentence && !sameAsEnglish.includes(sentence),
        }).toEqual({ sentence, isEnglish: false });
      }
    },
  );

  test("a plural's one form is worded too, where the language has one", () => {
    for (const language of ["de", "fr", "es", "ru", "hi", "fa", "ar"]) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of SENTENCES.filter((text: string): boolean => {
        return text.startsWith("{{count}}") || text.startsWith("{{from}}");
      })) {
        const one: string | undefined = words[`${sentence}_one`];

        expect({ language, sentence, one: typeof one }).toEqual({
          language,
          sentence,
          one: "string",
        });
        expect({
          language,
          sentence,
          isEnglish: one === ENGLISH[`${sentence}_one`],
        }).toEqual({ language, sentence, isEnglish: false });
      }
    }
  });
});

describe("each sentence reads in the language's order and digits", () => {
  test("Japanese names the row first, then its other actions", () => {
    const japanese: Translator = dashboardTranslator("ja");

    expect(
      japanese.translateTemplate("More actions for {{name}}", {
        name: "Monitor: Checkout API",
      }),
    ).toBe("Monitor: Checkout API のその他のアクション");
  });

  test("Persian numbers the condition in its own digits", () => {
    const persian: Translator = dashboardTranslator("fa");
    const removeSecond: string = persian.translateTemplate(
      "Remove condition {{number}}",
      { number: persian.formatNumber(2) },
    );

    expect(removeSecond).toBe("حذف شرط ۲");
    expect(removeSecond).not.toMatch(/[0-9]/);
  });

  test("German puts the verb last, the name where its grammar does", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      german.translateTemplate("View: {{name}}", {
        name: translatableTerm("Close a Data Exposure"),
      }),
    ).toMatch(/ anzeigen$/);
    expect(
      german.translateTemplate("Move Up: {{name}}", { name: "E-Mail" }),
    ).toBe("E-Mail nach oben verschieben");
    expect(
      german.translateTemplate("Clear {{filter}} filter", {
        filter: translatableTerm("Status"),
      }),
    ).toBe("Filter „Status“ löschen");
  });

  test("French sets its colon apart", () => {
    const french: Translator = dashboardTranslator("fr");

    expect(
      french.translateTemplate("Add Playbook: {{name}}", { name: "Phishing" }),
    ).toBe("Ajouter le playbook\u00A0: Phishing");
    expect(
      french.translateTemplate("Last refreshed: {{time}}", { time: "10:15" }),
    ).toBe("Dernière actualisation\u00A0: 10:15");
  });

  test("Chinese says the total before what is shown, in one sentence", () => {
    const chinese: Translator = dashboardTranslator("zh-CN");

    expect(
      chinese.translateTemplate("{{shown}} of {{total}} resources shown.", {
        shown: chinese.formatNumber(50000),
        total: chinese.formatNumber(61234),
      }),
    ).toBe("已显示 61,234 个资源中的 50,000 个。");
  });

  test("Russian counts with its general form, and its one form for 21", () => {
    const russian: Translator = dashboardTranslator("ru");
    const conditions: { one: string; other: string } = {
      one: "{{count}} condition",
      other: "{{count}} conditions",
    };

    expect(russian.translatePlural(conditions, 3)).toBe("Условий: 3");
    expect(russian.translatePlural(conditions, 21)).toBe("21 условие");
  });

  test("Persian writes a count in its digits inside a plural", () => {
    const persian: Translator = dashboardTranslator("fa");

    expect(
      persian.translatePlural(
        {
          one: "{{from}} – {{to}}: {{count}} event",
          other: "{{from}} – {{to}}: {{count}} events",
        },
        12,
        { from: "Authentication", to: "10.0.0.5" },
      ),
    ).toBe("Authentication – 10.0.0.5: ۱۲ رویداد");
  });

  test("English reads as it always did", () => {
    const english: Translator = dashboardTranslator("en");

    expect(
      english.translateTemplate("More actions for {{name}}", {
        name: "Monitor: Checkout API",
      }),
    ).toBe("More actions for Monitor: Checkout API");
    expect(
      english.translateTemplate("Remove condition {{number}}", {
        number: english.formatNumber(2),
      }),
    ).toBe("Remove condition 2");
    expect(
      english.translateTemplate("Add Playbook: {{name}}", {
        name: translatableTerm("Close a Data Exposure"),
      }),
    ).toBe("Add Playbook: Close a Data Exposure");
  });
});

// The Dashboard's words for `language`, as its i18next instance ships them.
const dashboardI18n: (language: string) => i18n = (language: string): i18n => {
  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language]: { translation: readDashboardLocale(language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
};

const inLanguage: (language: string, element: ReactElement) => void = (
  language: string,
  element: ReactElement,
): void => {
  render(
    <I18nextProvider i18n={dashboardI18n(language)}>{element}</I18nextProvider>,
  );
};

interface Member extends GenericObject {
  id: string;
  name: string;
}

const ROW_ACTIONS: Array<ActionButtonSchema<Member>> = [
  {
    title: "View",
    icon: IconProp.Eye,
    buttonStyleType: ButtonStyleType.NORMAL,
    onClick: (): void => {},
  },
  {
    title: "Delete",
    icon: IconProp.Trash,
    buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
    onClick: (): void => {},
  },
];

const CONDITIONS: Array<CorrelationCondition> = [
  {
    field: CorrelationFieldKey.Observable,
    operator: CorrelationOperator.Equals,
    value: "10.0.0.5",
  },
  {
    field: CorrelationFieldKey.RuleName,
    operator: CorrelationOperator.StartsWith,
    value: "ssh",
  },
];

describe("drawn in the reader's language", () => {
  test.each([
    ["ja", "Member: Ada Lovelace のその他のアクション"],
    ["de", "Weitere Aktionen für Member: Ada Lovelace"],
    ["en", "More actions for Member: Ada Lovelace"],
  ])(
    "a row's ⋯ in %s is one sentence around the row's name",
    (language: string, name: string) => {
      inLanguage(
        language,
        <RowActions<Member>
          item={{ id: "ada", name: "Ada Lovelace" }}
          actionButtons={ROW_ACTIONS}
          itemLabel="Member: Ada Lovelace"
        />,
      );

      expect(
        screen.getByTestId("row-actions-more-button"),
      ).toHaveAccessibleName(name);
    },
  );

  test("the Correlate chips number their remove buttons in Persian digits", () => {
    inLanguage(
      "fa",
      <CorrelateFilterChips
        filter={{ connector: "and", conditions: CONDITIONS }}
        onRemoveCondition={(): void => {}}
        onClearAll={(): void => {}}
      />,
    );

    expect(
      screen.getByTestId("correlate-filter-chip-remove-0"),
    ).toHaveAttribute("aria-label", "حذف شرط ۱");
    expect(
      screen.getByTestId("correlate-filter-chip-remove-1"),
    ).toHaveAttribute("aria-label", "حذف شرط ۲");
  });

  test("the Correlate builder numbers its delete buttons in Persian digits", () => {
    inLanguage(
      "fa",
      <CorrelateFilterBuilder
        conditions={CONDITIONS}
        connector="and"
        onChange={(): void => {}}
      />,
    );

    expect(
      screen.getByTestId("correlate-condition-delete-1"),
    ).toHaveAccessibleName("حذف شرط ۲");
  });

  test("the Correlate builder's delete buttons read 'Remove condition 2' in English", () => {
    inLanguage(
      "en",
      <CorrelateFilterBuilder
        conditions={CONDITIONS}
        connector="and"
        onChange={(): void => {}}
      />,
    );

    expect(
      screen.getByTestId("correlate-condition-delete-1"),
    ).toHaveAccessibleName("Remove condition 2");
  });

  test("a filter's clear button names its filter in German order", () => {
    type Row = GenericObject & { name?: string };
    const filters: Array<Filter<Row>> = [
      { key: "name", title: "Name", type: FieldType.Text },
    ];

    inLanguage(
      "de",
      <FiltersForm<Row>
        id="sentence-filter-form"
        showFilter={true}
        filters={filters}
        filterData={{ name: "checkout" }}
        onFilterChanged={(): void => {}}
      />,
    );

    const german: Record<string, string> = readDashboardLocale("de");
    const name: string = german["Name"] || "Name";
    const clear: HTMLElement = screen.getByRole("button", {
      name: `Filter „${name}“ löschen`,
    });

    expect(clear).toHaveAttribute("title", `${name} löschen`);
  });
});

const readJson: (file: string) => Record<string, unknown> = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
  ) as Record<string, unknown>;
};

const nested: (
  tree: Record<string, unknown>,
  dotted: string,
) => string | undefined = (
  tree: Record<string, unknown>,
  dotted: string,
): string | undefined => {
  const value: unknown = dotted
    .split(".")
    .reduce((node: unknown, part: string): unknown => {
      return node && typeof node === "object"
        ? (node as Record<string, unknown>)[part]
        : undefined;
    }, tree);

  return typeof value === "string" ? value : undefined;
};

describe("the other frontends word theirs", () => {
  const ADMIN: string = "packages/App/FeatureSet/AdminDashboard/src/Locales";
  const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src/Locales";
  const STATUS_PAGE: string = "packages/App/FeatureSet/StatusPage/src/Locales";

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "the Admin Dashboard's %s names a row's ⋯ and a filter's clear button as its Dashboard does",
    (language: string) => {
      const admin: Record<string, unknown> = readJson(
        `${ADMIN}/${language}.json`,
      );
      const dashboard: Record<string, string> = readDashboardLocale(language);

      for (const sentence of [
        "More actions for {{name}}",
        "Clear {{filter}} filter",
        "Clear {{filter}}",
      ]) {
        expect({ sentence, admin: admin[sentence] }).toEqual({
          sentence,
          admin: dashboard[sentence],
        });
      }

      // The phrase the name was tacked onto is gone.
      expect(admin["More actions for"]).toBeUndefined();
    },
  );

  test.each([
    ...[DASHBOARD, ADMIN].flatMap((folder: string): Array<[string, string]> => {
      return ["en", ...DASHBOARD_LANGUAGES].map(
        (language: string): [string, string] => {
          return [folder, language];
        },
      );
    }),
  ])(
    "%s/%s says why the version is not shown in one sentence",
    (folder: string, language: string) => {
      const tree: Record<string, unknown> = readJson(
        `${folder}/${language}.json`,
      );
      const sentence: string | undefined = nested(
        tree,
        "footer.versionUnavailableWithError",
      );
      const lead: string | undefined = nested(
        tree,
        "footer.versionUnavailable",
      );

      expect(sentence).toBeDefined();
      expect(placeholdersOf(sentence!)).toEqual(["error"]);
      // The same words as the sentence on its own, then the reason.
      expect(sentence!.startsWith(lead!)).toBe(true);
      expect(sentence!.endsWith("{{error}}")).toBe(true);
    },
  );

  const STATUS_PAGE_SENTENCES: Record<string, string> = {
    "incidents.declaredAtTime": "time",
    "announcements.announcedAtTime": "time",
    "scheduledEvents.scheduledAtTime": "time",
    "overview.uptimePercent": "percent",
  };

  test.each(["en", ...STATUS_PAGE_LANGUAGES])(
    "the status page's %s words an event's date and a group's uptime as one sentence",
    (language: string) => {
      const tree: Record<string, unknown> = readJson(
        `${STATUS_PAGE}/${language}.json`,
      );
      const english: Record<string, unknown> = readJson(
        `${STATUS_PAGE}/en.json`,
      );

      for (const [key, value] of Object.entries(STATUS_PAGE_SENTENCES)) {
        const sentence: string | undefined = nested(tree, key);

        expect({ key, placeholders: placeholdersOf(sentence || "") }).toEqual({
          key,
          placeholders: [value],
        });

        if (language !== "en") {
          expect({ key, isEnglish: sentence === nested(english, key) }).toEqual(
            { key, isEnglish: false },
          );
        }
      }
    },
  );

  test("a status page puts the date where its language does", () => {
    const hindi: i18n = createInstance();

    hindi.init({
      lng: "hi",
      resources: {
        hi: { translation: readJson(`${STATUS_PAGE}/hi.json`) },
      },
      interpolation: { escapeValue: false },
      initImmediate: false,
    });

    expect(
      hindi.t("incidents.declaredAtTime", { time: "15 नव॰ 2026, 10:15" }),
    ).toBe("15 नव॰ 2026, 10:15 को घोषित किया गया");

    const japanese: i18n = createInstance();

    japanese.init({
      lng: "ja",
      resources: {
        ja: { translation: readJson(`${STATUS_PAGE}/ja.json`) },
      },
      interpolation: { escapeValue: false },
      initImmediate: false,
    });

    // The figure comes written with its percent sign (formatUptimePercentFigure).
    expect(japanese.t("overview.uptimePercent", { percent: "99.95%" })).toBe(
      "稼働率 99.95%",
    );
  });
});
