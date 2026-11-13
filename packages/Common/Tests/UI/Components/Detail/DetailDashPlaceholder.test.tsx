import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import Detail from "../../../../UI/Components/Detail/Detail";
import EmptyValue, {
  DASH_PLACEHOLDERS,
  EMPTY_VALUE_MARK,
  EMPTY_VALUE_TEST_ID,
} from "../../../../UI/Components/Detail/EmptyValue";
import Field from "../../../../UI/Components/Detail/Field";
import { PLACEHOLDER_TEXT_CLASS_NAME } from "../../../../UI/Components/Detail/PlaceholderText";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * ISSUE #7264, ON A DETAIL CARD: A FIELD WHOSE PLACEHOLDER IS "-".
 *
 * A detail card's empty field is a quiet dash (EmptyValue), light grey and
 * read out as "Not set". A field that set `placeholder: "-"` - the Admin
 * Dashboard's project, user and subscription cards, a data source's
 * connection fields, an enterprise licence's fields - drew its "-" as
 * placeholder words instead: a hyphen in the darker grey of words, with
 * nothing for a screen reader, beside the dash of the field next to it. A
 * placeholder that is only a dash is now that dash; words stay words.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const GERMAN_FILE: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
) as Record<string, string>;

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    resources: { de: { translation: GERMAN_FILE } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

interface Item {
  name?: string | undefined;
  value?: unknown;
}

const DASHES: Array<[string, string]> = [
  ["a hyphen", "-"],
  ["an en dash", "\u2013"],
  ["an em dash", "\u2014"],
  ["a hyphen with spaces", " - "],
];

const TYPES: Array<[string, FieldType]> = [
  ["a text", FieldType.Text],
  ["a name", FieldType.Name],
  ["an email", FieldType.Email],
  ["a long text", FieldType.LongText],
  ["a date", FieldType.Date],
  ["a date and time", FieldType.DateTime],
  ["a number", FieldType.Number],
  ["a dropdown", FieldType.Dropdown],
  ["a multi-select dropdown", FieldType.MultiSelectDropdown],
];

const VALUE_TITLE: string = "Database Host";

function drawDetail(data: {
  fieldType: FieldType;
  placeholder: string;
  item?: Item | undefined;
  instance?: i18n | undefined;
}): HTMLElement {
  const fields: Array<Field<Item>> = [
    { key: "name", title: "Name", fieldType: FieldType.Text },
    {
      key: "value",
      title: VALUE_TITLE,
      fieldType: data.fieldType,
      placeholder: data.placeholder,
      dropdownOptions: [{ label: "Primary", value: "primary" }],
    },
  ];
  const detail: React.ReactElement = (
    <div data-testid="detail">
      <Detail<Item>
        id="detail-dash-placeholder"
        item={data.item || { name: "Production" }}
        fields={fields}
        showRecordLine={false}
      />
    </div>
  );

  return render(
    data.instance ? (
      <I18nextProvider i18n={data.instance}>{detail}</I18nextProvider>
    ) : (
      detail
    ),
  ).getByTestId("detail");
}

// The field's row: its title and its value.
function rowOf(detail: HTMLElement, title: string): HTMLElement {
  const label: HTMLElement = within(detail).getByText(title);
  let row: HTMLElement | null = label.parentElement;

  while (row && !row.querySelector(`[data-testid="${EMPTY_VALUE_TEST_ID}"]`)) {
    if (row.querySelector('[data-testid="placeholder-text"]')) {
      return row;
    }
    row = row.parentElement;
  }

  if (!row) {
    throw new Error(`No row for ${title}`);
  }

  return row;
}

describe("a detail field whose placeholder is a dash", () => {
  describe.each(DASHES)("written as %s", (_label: string, dash: string) => {
    test.each(TYPES)(
      "%s field with no value is the quiet dash, read out as 'Not set'",
      (_type: string, fieldType: FieldType) => {
        const detail: HTMLElement = drawDetail({
          fieldType,
          placeholder: dash,
        });
        const row: HTMLElement = rowOf(detail, VALUE_TITLE);
        const empty: HTMLElement = within(row).getByTestId(EMPTY_VALUE_TEST_ID);

        expect(empty).toBeVisible();
        expect(within(empty).getByText(EMPTY_VALUE_MARK)).toHaveAttribute(
          "aria-hidden",
          "true",
        );
        expect(within(empty).getByText("Not set")).toHaveClass("sr-only");
        // No hyphen of its own, as placeholder words.
        expect(within(row).queryByTestId("placeholder-text")).toBeNull();
      },
    );
  });

  test("draws exactly what a field with no placeholder draws", () => {
    const withDash: string = drawDetail({
      fieldType: FieldType.Text,
      placeholder: "-",
    }).innerHTML;
    cleanup();

    const withNone: string = render(
      <div data-testid="detail">
        <Detail<Item>
          id="detail-dash-placeholder"
          item={{ name: "Production" }}
          fields={[
            { key: "name", title: "Name", fieldType: FieldType.Text },
            {
              key: "value",
              title: VALUE_TITLE,
              fieldType: FieldType.Text,
              dropdownOptions: [{ label: "Primary", value: "primary" }],
            },
          ]}
          showRecordLine={false}
        />
      </div>,
    ).getByTestId("detail").innerHTML;

    expect(withDash).toBe(withNone);
  });

  test("a value is drawn as itself", () => {
    const detail: HTMLElement = drawDetail({
      fieldType: FieldType.Text,
      placeholder: "-",
      item: { name: "Production", value: "db.internal" },
    });

    expect(within(detail).getByText("db.internal")).toBeVisible();
    expect(within(detail).queryByTestId(EMPTY_VALUE_TEST_ID)).toBeNull();
  });

  test("'Not set' is in the reader's language", () => {
    const notSet: string = GERMAN_FILE["Not set"] as string;

    expect(notSet).toBeTruthy();
    expect(notSet).not.toBe("Not set");

    const detail: HTMLElement = drawDetail({
      fieldType: FieldType.Text,
      placeholder: "-",
      instance: german,
    });

    expect(
      within(within(detail).getByTestId(EMPTY_VALUE_TEST_ID)).getByText(
        notSet,
      ),
    ).toHaveClass("sr-only");
  });
});

describe("a detail field whose placeholder is words", () => {
  test.each([["No description provided."], ["-1"], ["--"], ["- none -"]])(
    "draws '%s' as placeholder words, as it always did",
    (words: string) => {
      const detail: HTMLElement = drawDetail({
        fieldType: FieldType.Text,
        placeholder: words,
      });
      const placeholder: HTMLElement = within(detail).getByTestId(
        "placeholder-text",
      );

      expect(placeholder).toHaveTextContent(words);
      expect(placeholder.className).toBe(PLACEHOLDER_TEXT_CLASS_NAME);
      expect(within(detail).queryByTestId(EMPTY_VALUE_TEST_ID)).toBeNull();
    },
  );
});

describe("EmptyValue", () => {
  test.each(
    DASH_PLACEHOLDERS.map((dash: string): [string] => {
      return [dash];
    }),
  )("with '%s' for its placeholder is the dash", (dash: string) => {
    render(<EmptyValue placeholder={dash} />);

    expect(screen.getByTestId(EMPTY_VALUE_TEST_ID)).toBeVisible();
    expect(screen.queryByTestId("placeholder-text")).toBeNull();
  });

  test("with blank words for its placeholder is the dash", () => {
    render(<EmptyValue placeholder="   " />);

    expect(screen.getByTestId(EMPTY_VALUE_TEST_ID)).toBeVisible();
    expect(screen.queryByTestId("placeholder-text")).toBeNull();
  });
});
