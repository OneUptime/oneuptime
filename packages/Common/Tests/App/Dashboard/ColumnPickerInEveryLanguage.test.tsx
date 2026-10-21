import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import ColumnCustomizationModal, {
  COLUMN_LIST_TEST_ID,
} from "../../../UI/Components/ModelTable/ColumnCustomizationModal";
import {
  CustomizableColumn,
  ModelTableColumn,
  getCustomizableColumns,
} from "../../../UI/Components/ModelTable/ColumnPreference";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import FieldType from "../../../UI/Components/Types/FieldType";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * ---------------------------------------------------------------------------
 * Customize Columns, in every Dashboard language
 * ---------------------------------------------------------------------------
 *
 * VMware > All vCenters opens without Collected By and Agent Version; the
 * card's ... > Columns opens Customize Columns, where a viewer switches
 * them back on. That way back was half English in eleven languages: the
 * menu item said "Columns", and the dialog's sentence, search box, count
 * line, Hide all, hint and the row buttons' names were English under a
 * translated title - in Russian, "Настроить столбцы" over "Choose which
 * columns to show and drag them into the order you want."
 *
 * The REAL picker is drawn over the vCenters list's seven columns (Name,
 * Status, Collected By, Agent Version, Last Seen, Labels, Owners; the two
 * switched off, as the list ships them) under an i18next instance per
 * language, built from the Dashboard's own locale files the way
 * Utils/i18n.ts builds the Dashboard's. The page's column set itself is
 * pinned in VMwareVCentersListColumns.test.tsx.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, unknown>;

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.slice(0, -".json".length);
  })
  .sort();

const OTHER_LANGUAGES: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

// Languages without a "one" form: their `_one` keys are never shown.
const NO_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

const readLocale: (language: string) => Locale = (language: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Locale;
};

const ENGLISH: Locale = readLocale("en");
const LOCALES: Record<string, Locale> = {};
const INSTANCES: Record<string, i18n> = {};

// What the Dashboard draws for an English string: the locale's, or English.
const drawn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  const value: unknown = (LOCALES[language] as Locale)[english];

  return typeof value === "string" && value.trim() ? value : english;
};

// A number written the reader's way, as the picker's translator writes it.
const localNumber: (language: string, value: number) => string = (
  language: string,
  value: number,
): string => {
  try {
    return value.toLocaleString(language);
  } catch {
    return value.toLocaleString();
  }
};

const fill: (template: string, values: Record<string, string>) => string = (
  template: string,
  values: Record<string, string>,
): string => {
  let text: string = template;

  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{{${name}}}`).join(value);
  }

  return text;
};

// Everything the picker and the way to it say, as the source writes it.
const MENU_ITEM: string = "Columns";
const TITLE: string = "Customize Columns";
const DESCRIPTION: string =
  "Choose which columns to show and drag them into the order you want.";
const SEARCH_PLACEHOLDER: string = "Search columns...";
const COUNT_LINE: string = "{{visible}} of {{count}} columns shown";
const COUNT_LINE_ONE: string = `${COUNT_LINE}_one`;
const SHOW_ALL: string = "Show all";
const HIDE_ALL: string = "Hide all";
const REORDER_HINT: string =
  "Drag a row, or use the arrows, to change the column order.";
const CLEAR_TO_REORDER: string = "Clear the search to reorder columns.";
const NO_MATCH: string = 'No columns match "{{search}}".';
const MOVE_UP: string = "Move up";
const MOVE_DOWN: string = "Move down";
const MOVE_COLUMN_UP: string = "Move {{column}} up";
const MOVE_COLUMN_DOWN: string = "Move {{column}} down";
const DRAG_COLUMN: string = "Drag to reorder {{column}}";
const REMOVE_COLUMN: string = "Remove column";
const REMOVE_NAMED_COLUMN: string = "Remove {{column}}";
const SAVE: string = "Save";
const CANCEL: string = "Cancel";

const PICKER_STRINGS: Array<string> = [
  MENU_ITEM,
  TITLE,
  DESCRIPTION,
  SEARCH_PLACEHOLDER,
  COUNT_LINE,
  COUNT_LINE_ONE,
  SHOW_ALL,
  HIDE_ALL,
  REORDER_HINT,
  CLEAR_TO_REORDER,
  NO_MATCH,
  MOVE_UP,
  MOVE_DOWN,
  MOVE_COLUMN_UP,
  MOVE_COLUMN_DOWN,
  DRAG_COLUMN,
  REMOVE_COLUMN,
  REMOVE_NAMED_COLUMN,
  SAVE,
  CANCEL,
];

// The vCenters list's columns, in its order, the two it ships switched off.
const VCENTER_COLUMNS: Array<{
  title: string;
  field: string;
  isHiddenByDefault?: boolean | undefined;
}> = [
  { title: "Name", field: "name" },
  { title: "Status", field: "otelCollectorStatus" },
  { title: "Collected By", field: "collectionMethod", isHiddenByDefault: true },
  { title: "Agent Version", field: "agentVersion", isHiddenByDefault: true },
  { title: "Last Seen", field: "lastSeenAt" },
  { title: "Labels", field: "labels" },
  { title: "Owners", field: "_id" },
];

const pickerEntries: () => Array<CustomizableColumn<VMwareVCenter>> = (): Array<
  CustomizableColumn<VMwareVCenter>
> => {
  return getCustomizableColumns<VMwareVCenter>({
    columns: VCENTER_COLUMNS.map(
      (column: {
        title: string;
        field: string;
        isHiddenByDefault?: boolean | undefined;
      }): ModelTableColumn<VMwareVCenter> => {
        return {
          field: { [column.field]: true },
          title: column.title,
          type: FieldType.Text,
          isHiddenByDefault: column.isHiddenByDefault,
        } as ModelTableColumn<VMwareVCenter>;
      },
    ),
  });
};

const renderPicker: (language: string) => void = (language: string): void => {
  render(
    <I18nextProvider i18n={INSTANCES[language] as i18n}>
      <ColumnCustomizationModal<VMwareVCenter>
        columns={pickerEntries()}
        onSave={jest.fn()}
        onClose={jest.fn()}
        onReset={jest.fn()}
        isDefaultLayout={true}
      />
    </I18nextProvider>,
  );
};

const picker: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("column-customization-modal");
};

const searchFor: (text: string) => void = (text: string): void => {
  fireEvent.change(
    within(picker()).getByTestId("column-customization-search"),
    { target: { value: text } },
  );
};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    LOCALES[language] = readLocale(language);

    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts): default separators.
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: ENGLISH },
        [language]: { translation: LOCALES[language] as Locale },
      },
      interpolation: { escapeValue: false },
    });

    INSTANCES[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

describe("the strings Customize Columns and its menu item draw", () => {
  test("every Dashboard language is read: English and the 16 others", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(OTHER_LANGUAGES).toHaveLength(16);
  });

  test("each is a key of en.json, the English sentence the source writes", () => {
    for (const english of PICKER_STRINGS) {
      expect(Object.keys(ENGLISH)).toContain(english);
    }

    expect(ENGLISH[COUNT_LINE_ONE]).toBe(
      "{{visible}} of {{count}} column shown",
    );
  });

  test.each(OTHER_LANGUAGES)(
    "%s words every one of them in its own language",
    (language: string) => {
      const english: Array<string> = PICKER_STRINGS.filter(
        (key: string): boolean => {
          if (key === COUNT_LINE_ONE && NO_ONE_FORM.includes(language)) {
            return false;
          }

          return (
            (LOCALES[language] as Locale)[key] === (ENGLISH[key] as string)
          );
        },
      );

      expect(english).toEqual([]);
    },
  );
});

describe.each(LANGUAGES)("Customize Columns in %s", (language: string) => {
  test("the menu item that opens it", () => {
    render(
      <I18nextProvider i18n={INSTANCES[language] as i18n}>
        <MoreMenuItem
          text={MENU_ITEM}
          icon={IconProp.TableCells}
          onClick={jest.fn()}
        />
      </I18nextProvider>,
    );

    expect(screen.getByRole("menuitem")).toHaveTextContent(
      drawn(language, MENU_ITEM),
    );
  });

  test("its title, sentence, search box, count line, bulk buttons and hint", () => {
    renderPicker(language);

    const textOf: (testId: string) => string = (testId: string): string => {
      return (screen.getByTestId(testId).textContent || "").trim();
    };

    expect(screen.getByText(drawn(language, TITLE))).toBeInTheDocument();
    expect(screen.getByText(drawn(language, DESCRIPTION))).toBeInTheDocument();
    expect(
      within(picker()).getByTestId("column-customization-search"),
    ).toHaveAttribute("placeholder", drawn(language, SEARCH_PLACEHOLDER));

    // Five of the seven are on: the two the list ships switched off are not.
    expect(textOf("column-customization-count")).toBe(
      fill(drawn(language, COUNT_LINE), {
        visible: localNumber(language, 5),
        count: localNumber(language, 7),
      }),
    );
    expect(textOf("column-customization-show-all")).toBe(
      drawn(language, SHOW_ALL),
    );
    expect(textOf("column-customization-hide-all")).toBe(
      drawn(language, HIDE_ALL),
    );
    expect(textOf("column-customization-hint")).toBe(
      drawn(language, REORDER_HINT),
    );
    expect(textOf("modal-footer-submit-button")).toBe(drawn(language, SAVE));
    expect(textOf("modal-footer-close-button")).toBe(drawn(language, CANCEL));
  });

  test("each column by its name in the language, Collected By and Agent Version switched off", () => {
    renderPicker(language);

    for (const column of VCENTER_COLUMNS) {
      const toggle: HTMLElement = within(picker()).getByTestId(
        `column-toggle-${column.field}`,
      );
      const row: HTMLElement = toggle.closest(".group") as HTMLElement;

      expect(row).toHaveTextContent(drawn(language, column.title));

      if (column.isHiddenByDefault) {
        expect(toggle).not.toBeChecked();
      } else {
        expect(toggle).toBeChecked();
      }
    }
  });

  test("the list, its arrows and its drag handles are named in the language", () => {
    renderPicker(language);

    const list: HTMLElement = within(picker()).getByTestId(COLUMN_LIST_TEST_ID);

    expect(list.querySelector("[aria-label]")).toHaveAttribute(
      "aria-label",
      drawn(language, MENU_ITEM),
    );

    for (const column of VCENTER_COLUMNS) {
      const name: string = drawn(language, column.title);

      expect(
        within(picker()).getByTestId(`column-move-up-${column.field}`),
      ).toHaveAttribute(
        "aria-label",
        fill(drawn(language, MOVE_COLUMN_UP), { column: name }),
      );
      expect(
        within(picker()).getByTestId(`column-move-down-${column.field}`),
      ).toHaveAttribute(
        "aria-label",
        fill(drawn(language, MOVE_COLUMN_DOWN), { column: name }),
      );
      expect(
        within(list).getByLabelText(
          fill(drawn(language, DRAG_COLUMN), { column: name }),
        ),
      ).toBeInTheDocument();
    }
  });

  test("a search finds a column by the name the reader sees, and still by its English one", () => {
    renderPicker(language);

    const shownFields: () => Array<string> = (): Array<string> => {
      return within(picker())
        .queryAllByTestId(/^column-toggle-/)
        .map((toggle: HTMLElement): string => {
          return (toggle.getAttribute("data-testid") || "").slice(
            "column-toggle-".length,
          );
        });
    };

    // Typed the way it is drawn, in another case than the row's.
    act(() => {
      searchFor(drawn(language, "Agent Version").toUpperCase());
    });

    expect(shownFields()).toContain("agentVersion");
    expect(shownFields()).not.toContain("name");

    act(() => {
      searchFor("agent version");
    });

    expect(shownFields()).toContain("agentVersion");
    expect(shownFields()).not.toContain("lastSeenAt");
  });

  test("a search says why the arrows rest, and a search that finds nothing says so", () => {
    renderPicker(language);

    act(() => {
      searchFor(drawn(language, "Collected By"));
    });

    expect(
      within(picker()).getByTestId("column-toggle-collectionMethod"),
    ).toBeInTheDocument();
    expect(
      (
        within(picker()).getByTestId("column-customization-hint").textContent ||
        ""
      ).trim(),
    ).toBe(drawn(language, CLEAR_TO_REORDER));

    act(() => {
      searchFor("zzqx");
    });

    expect(
      (
        within(picker()).getByTestId("column-customization-no-results")
          .textContent || ""
      ).trim(),
    ).toBe(fill(drawn(language, NO_MATCH), { search: "zzqx" }));
  });
});
