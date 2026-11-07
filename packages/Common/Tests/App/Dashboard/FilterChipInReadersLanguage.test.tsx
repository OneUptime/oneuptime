import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import FilterChipDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { CLOUD_ACCOUNT_FACET_LABEL } from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsAccountFacet";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import IconProp from "../../../Types/Icon/IconProp";
import { getTemplatePlaceholders } from "../../../Types/Translator";

/*
 * A filter chip in the reader's language (FilterChipDropdown), as App
 * Platforms' Cloud Account chip draws it - the UI review of #6149.
 *
 * Its popover said "Search cloud account..." in German and Persian, and a
 * chip set to "is not" read "Cloud-Konto · not 4109-2277-8841": the chip's
 * own words were English in fifteen languages. And in Persian an account
 * id after the chip's name - "حساب ابری · 4109-2277-8841" - was drawn with
 * its digit groups the wrong way round ("8841-2277-4109"): the browser
 * read its digits as Persian ones, and its hyphens as the sentence's.
 * Now what is picked is set apart from the chip's name, and every word the
 * chip says is the reader's - its separator too: a bullet on a Persian page
 * (InlineSeparator), where the middle dot beside digits read as a zero.
 */

const ACCOUNT: string = "4109-2277-8841";

const OPTIONS: Array<FilterChipDropdownOption> = [
  { value: ACCOUNT, label: ACCOUNT, icon: IconProp.Cloud, group: "AWS" },
  {
    value: "acme-prod",
    label: "acme-prod",
    icon: IconProp.Cloud,
    group: "Google Cloud",
  },
];

// The chip's own words, every one a key of the Dashboard's locale files.
const CHIP_WORDS: ReadonlyArray<string> = [
  "Search {{label}}...",
  "not {{value}}",
  "Clear {{label}} filter",
  "{{label}} operator",
  "Nothing to show",
  "No options available",
  "Try a different search term",
];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const [language, locale] of [
    ["en", englishLocale],
    ["de", germanLocale],
    ["fa", persianLocale],
  ] as Array<[string, Record<string, unknown>]>) {
    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts).
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function accountChip(data: {
  language: string;
  value: Array<string>;
  operator?: FilterOperator;
  options?: Array<FilterChipDropdownOption>;
}): ReactElement {
  return (
    <I18nextProvider i18n={instances[data.language]!}>
      <FilterChipDropdown
        label={CLOUD_ACCOUNT_FACET_LABEL}
        emptyIcon={IconProp.Cloud}
        options={data.options || OPTIONS}
        isMultiSelect={true}
        value={data.value}
        operator={data.operator || "is"}
        supportedOperators={["is", "is_not"]}
        onChange={(): void => {}}
        onOperatorChange={(): void => {}}
      />
    </I18nextProvider>
  );
}

function chipButton(): HTMLElement {
  return screen.getAllByRole("button")[0] as HTMLElement;
}

describe("what the chip is set to", () => {
  test("is set apart from the chip's name: an account id reads whole after a Persian name", () => {
    render(accountChip({ language: "fa", value: [ACCOUNT] }));

    const value: HTMLElement = screen.getByTestId("filter-chip-value");

    // An isolate, its direction its own: the hyphens stay between its digits.
    expect(value.tagName).toBe("BDI");
    expect(value).not.toHaveAttribute("dir");
    expect(value.textContent).toBe(ACCOUNT);
    expect(chipButton()).toHaveAccessibleName(`حساب ابری \u{2022} ${ACCOUNT}`);
  });

  test("several picks are one isolate, in the order they were listed", () => {
    render(accountChip({ language: "fa", value: [ACCOUNT, "acme-prod"] }));

    expect(screen.getByTestId("filter-chip-value").textContent).toBe(
      `${ACCOUNT}, acme-prod`,
    );
  });

  test("in English the chip reads as it always did", () => {
    render(accountChip({ language: "en", value: [ACCOUNT] }));

    expect(chipButton()).toHaveAccessibleName(`Cloud Account · ${ACCOUNT}`);
    expect(screen.getByTestId("filter-chip-value").textContent).toBe(ACCOUNT);
  });

  test("'is not' is the reader's word, the value set apart inside it", () => {
    render(
      accountChip({ language: "de", value: [ACCOUNT], operator: "is_not" }),
    );

    expect(chipButton()).toHaveAccessibleName(`Cloud-Konto · nicht ${ACCOUNT}`);
    cleanup();

    render(
      accountChip({ language: "fa", value: [ACCOUNT], operator: "is_not" }),
    );

    const words: string = chipButton().textContent || "";

    expect(withoutIsolateMarks(words)).toBe(
      `حساب ابری \u{2022} ${persianLocale["not {{value}}"].replace("{{value}}", ACCOUNT)}`,
    );
    // Its digits keep their order inside the Persian words.
    expect(words).toContain(isolated(ACCOUNT));
    expect(screen.queryByTestId("filter-chip-value")).toBeNull();
    cleanup();

    render(
      accountChip({ language: "en", value: [ACCOUNT], operator: "is_not" }),
    );
    expect(chipButton()).toHaveAccessibleName(`Cloud Account · not ${ACCOUNT}`);
  });

  test("its clear button is named in the reader's language", () => {
    render(accountChip({ language: "de", value: [ACCOUNT] }));

    expect(
      screen.getByRole("button", { name: "Filter für Cloud-Konto entfernen" }),
    ).toBeInTheDocument();
  });
});

describe("the chip's popover", () => {
  async function open(
    language: string,
    value: Array<string> = [],
  ): Promise<void> {
    render(accountChip({ language, value }));

    await act(async () => {
      await userEvent.setup().click(chipButton());
    });
  }

  test("says everything in German", async () => {
    await open("de");

    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "Cloud-Konto suchen...",
    );
    expect(
      screen.getByRole("combobox", { name: "Operator für Cloud-Konto" }),
    ).toBeInTheDocument();
  });

  test("and in Persian", async () => {
    await open("fa");

    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "جستجوی حساب ابری...",
    );
    expect(
      screen.getByRole("combobox", { name: "عملگر حساب ابری" }),
    ).toBeInTheDocument();
  });

  test("a search that matches nothing says so in the reader's language", async () => {
    await open("de");

    await act(async () => {
      await userEvent.setup().type(screen.getByRole("textbox"), "zzz");
    });

    expect(screen.getByText("Keine Treffer")).toBeInTheDocument();
    expect(
      screen.getByText(germanLocale["Try a different search term"]),
    ).toBeInTheDocument();
    expect(screen.queryByText("Try a different search term")).toBeNull();
  });

  test("a chip with nothing to offer says so in the reader's language", async () => {
    render(accountChip({ language: "fa", value: [], options: [] }));

    await act(async () => {
      await userEvent.setup().click(chipButton());
    });

    expect(
      screen.getByText(persianLocale["Nothing to show"]),
    ).toBeInTheDocument();
    expect(
      screen.getByText(persianLocale["No options available"]),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nothing to show")).toBeNull();
  });
});

describe("the chip's words in every language", () => {
  test("each is the language's own, with the same values as the English", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const key of CHIP_WORDS) {
        const worded: string = locale[key] || "";

        expect({ language, key, translated: worded !== key }).toEqual({
          language,
          key,
          translated: true,
        });
        expect({
          language,
          key,
          values: getTemplatePlaceholders(worded).sort(),
        }).toEqual({
          language,
          key,
          values: getTemplatePlaceholders(key).sort(),
        });
      }
    }
  });
});
