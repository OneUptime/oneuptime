import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import FilterChipDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import {
  FILTER_CHIP_OPTION_LABEL_CLASS_NAME,
  FILTER_CHIP_OPTION_SUBLABEL_CLASS_NAME,
  FilterChipOptionLine,
  getFilterChipOptionLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipStyles";
import {
  CLOUD_ACCOUNT_FACET_LABEL,
  getCloudAccountFacetOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsAccountFacet";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";

/*
 * An option's lines in a filter chip's popover, each read the way what it
 * holds is written - the UI review of #6149's follow-up (the Cloud Account
 * chip names each account, its id under the name).
 *
 * On a Persian page every line of an option ends where the page's lines
 * do, at the left, so an account's id in Latin letters was cut short at
 * its start ("...f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"): the part that tells two
 * Azure subscriptions apart was the part left out. A line that reads the
 * other way from the page reads its own way now (LineDirection), cut short
 * at its own end, and lined up as the page's lines are: a short id still
 * starts under its name, beside the option's icon.
 */

const AZURE_SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const AWS_ACCOUNT: string = "123456789012";
const PERSIAN_NAME: string = "حساب اصلی";

// The chip's options as All Resources offers them: named, with ids under the names.
const OPTIONS: Array<FilterChipDropdownOption> = getCloudAccountFacetOptions(
  [
    { cloudProvider: "aws", cloudAccountId: AWS_ACCOUNT },
    { cloudProvider: "azure", cloudAccountId: AZURE_SUBSCRIPTION },
    { cloudProvider: "gcp", cloudAccountId: "acme-prod" },
  ],
  [
    { provider: "aws", accountId: AWS_ACCOUNT, name: PERSIAN_NAME },
    {
      provider: "azure",
      accountId: AZURE_SUBSCRIPTION,
      name: "Contoso production",
    },
  ],
);

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const [language, locale] of [
    ["en", englishLocale],
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

async function openChip(language: string): Promise<HTMLElement> {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <FilterChipDropdown
        label={CLOUD_ACCOUNT_FACET_LABEL}
        options={OPTIONS}
        isMultiSelect={true}
        value={[]}
        operator="is"
        supportedOperators={["is", "is_not"]}
        onChange={(): void => {}}
        onOperatorChange={(): void => {}}
      />
    </I18nextProvider>,
  );

  await act(async () => {
    await userEvent.setup().click(screen.getAllByRole("button")[0]!);
  });

  return screen.getByRole("listbox");
}

interface DrawnLine {
  text: string;
  dir: string | null;
  isAlignedAsThePage: boolean;
}

// Each option's lines as drawn: its name, then what is under it.
function drawnLines(
  listbox: HTMLElement,
): Array<{ label: DrawnLine; sublabel: DrawnLine | null }> {
  const read: (line: HTMLElement) => DrawnLine = (
    line: HTMLElement,
  ): DrawnLine => {
    return {
      text: line.textContent || "",
      dir: line.getAttribute("dir"),
      isAlignedAsThePage: line.classList.contains(
        LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
      ),
    };
  };

  return within(listbox)
    .getAllByRole("option")
    .map((option: HTMLElement) => {
      const sublabel: HTMLElement | null = within(option).queryByTestId(
        "filter-chip-option-sublabel",
      );

      return {
        label: read(within(option).getByTestId("filter-chip-option-label")),
        sublabel: sublabel ? read(sublabel) : null,
      };
    });
}

describe("an option's lines on a Persian page", () => {
  test("an account's Latin name and its id read left to right, each cut short at its own end and lined up as the page's lines", async () => {
    const listbox: HTMLElement = await openChip("fa");

    expect(drawnLines(listbox)).toEqual([
      // A Persian name reads as the page does; digits alone have no way of their own.
      {
        label: { text: PERSIAN_NAME, dir: null, isAlignedAsThePage: false },
        sublabel: { text: AWS_ACCOUNT, dir: null, isAlignedAsThePage: false },
      },
      {
        label: {
          text: "Contoso production",
          dir: "ltr",
          isAlignedAsThePage: true,
        },
        sublabel: {
          text: AZURE_SUBSCRIPTION,
          dir: "ltr",
          isAlignedAsThePage: true,
        },
      },
      // An account no connection names: its id alone, its own way.
      {
        label: { text: "acme-prod", dir: "ltr", isAlignedAsThePage: true },
        sublabel: null,
      },
    ]);
  });

  test("each line keeps its one-line look: it still ends in '...' where the list does", async () => {
    const listbox: HTMLElement = await openChip("fa");
    const azure: HTMLElement = within(listbox).getAllByRole("option")[1]!;

    expect(within(azure).getByTestId("filter-chip-option-label")).toHaveClass(
      ...FILTER_CHIP_OPTION_LABEL_CLASS_NAME.split(" "),
    );
    expect(
      within(azure).getByTestId("filter-chip-option-sublabel"),
    ).toHaveClass(...FILTER_CHIP_OPTION_SUBLABEL_CLASS_NAME.split(" "));
    expect(FILTER_CHIP_OPTION_LABEL_CLASS_NAME.split(" ")).toContain(
      "truncate",
    );
    expect(FILTER_CHIP_OPTION_SUBLABEL_CLASS_NAME.split(" ")).toContain(
      "truncate",
    );
  });
});

describe("an option's lines on an English page", () => {
  test("Latin lines are drawn as they always were; a Persian name reads its own way", async () => {
    const listbox: HTMLElement = await openChip("en");

    expect(drawnLines(listbox)).toEqual([
      {
        label: { text: PERSIAN_NAME, dir: "rtl", isAlignedAsThePage: true },
        sublabel: { text: AWS_ACCOUNT, dir: null, isAlignedAsThePage: false },
      },
      {
        label: {
          text: "Contoso production",
          dir: null,
          isAlignedAsThePage: false,
        },
        sublabel: {
          text: AZURE_SUBSCRIPTION,
          dir: null,
          isAlignedAsThePage: false,
        },
      },
      {
        label: { text: "acme-prod", dir: null, isAlignedAsThePage: false },
        sublabel: null,
      },
    ]);
  });
});

describe("getFilterChipOptionLine", () => {
  test("a line that reads the other way from the page gets its own way and the page's alignment", () => {
    expect(
      getFilterChipOptionLine({
        text: AZURE_SUBSCRIPTION,
        language: "fa",
        className: FILTER_CHIP_OPTION_SUBLABEL_CLASS_NAME,
      }),
    ).toEqual({
      dir: "ltr",
      className: `${FILTER_CHIP_OPTION_SUBLABEL_CLASS_NAME} ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    } as FilterChipOptionLine);
  });

  test("a line that reads as the page does, or has no letters, or nothing, is left as it is", () => {
    for (const [text, language] of [
      ["Contoso production", "en"],
      ["Contoso production", "de"],
      [PERSIAN_NAME, "fa"],
      [AWS_ACCOUNT, "fa"],
      [AWS_ACCOUNT, "en"],
      ["", "fa"],
      [undefined, "fa"],
    ] as Array<[string | undefined, string]>) {
      expect({
        text,
        language,
        line: getFilterChipOptionLine({
          text,
          language,
          className: FILTER_CHIP_OPTION_LABEL_CLASS_NAME,
        }),
      }).toEqual({
        text,
        language,
        line: {
          dir: undefined,
          className: FILTER_CHIP_OPTION_LABEL_CLASS_NAME,
        },
      });
    }
  });
});
