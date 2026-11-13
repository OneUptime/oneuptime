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
import { TableCellContext } from "../../../../UI/Components/Table/TableCellContext";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableEmptyValue";
import TableColumnListComponent from "../../../../UI/Components/TableColumnList/TableColumnListComponent";
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
      within(within(detail).getByTestId(EMPTY_VALUE_TEST_ID)).getByText(notSet),
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
      const placeholder: HTMLElement =
        within(detail).getByTestId("placeholder-text");

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

/*
 * A detail field that draws its own element for "nothing here" as a bare
 * dash - `<p>-</p>`, as the Admin Dashboard's Invited By did - drew a
 * hyphen as dark as a value beside the card's quiet dash. A table's cell
 * already read such an element as empty (isDashPlaceholder); a detail
 * card now does too: the card's own dash, or the field's words for that.
 */
describe("a detail field whose own element is a bare dash", () => {
  function drawElementField(data: {
    element: React.ReactElement | string;
    placeholder?: string | undefined;
  }): HTMLElement {
    return render(
      <div data-testid="detail">
        <Detail<Item>
          id="detail-dash-element"
          item={{ name: "Production", value: "set" }}
          fields={[
            { key: "name", title: "Name", fieldType: FieldType.Text },
            {
              key: "value",
              title: "Invited By",
              fieldType: FieldType.Element,
              ...(data.placeholder ? { placeholder: data.placeholder } : {}),
              getElement: (): React.ReactElement => {
                return data.element as React.ReactElement;
              },
            },
          ]}
          showRecordLine={false}
        />
      </div>,
    ).getByTestId("detail");
  }

  const BARE_DASHES: Array<[string, React.ReactElement | string]> = [
    ["<p>-</p>", <p key="p">-</p>],
    ["<span>-</span>", <span key="span">-</span>],
    ["<>-</>", <React.Fragment key="fragment">-</React.Fragment>],
    ["<p>\u2014</p>", <p key="em">{"\u2014"}</p>],
    ["<p>\u2013</p>", <p key="en">{"\u2013"}</p>],
    ["<p> - </p>", <p key="spaced">{" - "}</p>],
    ["a bare '-'", "-"],
  ];

  test.each(BARE_DASHES)(
    "%s is the card's quiet dash, read out as 'Not set'",
    (_label: string, element: React.ReactElement | string) => {
      const detail: HTMLElement = drawElementField({ element });
      const empty: HTMLElement =
        within(detail).getByTestId(EMPTY_VALUE_TEST_ID);

      expect(empty).toBeVisible();
      expect(within(empty).getByText(EMPTY_VALUE_MARK)).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(within(empty).getByText("Not set")).toHaveClass("sr-only");
      // No hyphen of its own anywhere on the card.
      expect(detail.textContent).not.toContain("-");
    },
  );

  test("draws exactly what an empty field draws", () => {
    const fromElement: string = within(
      drawElementField({ element: <p>-</p> }),
    ).getByTestId(EMPTY_VALUE_TEST_ID).outerHTML;
    cleanup();

    render(<EmptyValue />);

    expect(fromElement).toBe(screen.getByTestId(EMPTY_VALUE_TEST_ID).outerHTML);
  });

  test("the field's own words stand in for it, as for any empty field", () => {
    const detail: HTMLElement = drawElementField({
      element: <p>-</p>,
      placeholder: "Signed up on their own.",
    });

    expect(within(detail).getByTestId("placeholder-text")).toHaveTextContent(
      "Signed up on their own.",
    );
    expect(within(detail).queryByTestId(EMPTY_VALUE_TEST_ID)).toBeNull();
  });

  test.each([
    [
      "a dash with classes of its own",
      <p key="c" className="font-mono">
        -
      </p>,
      "-",
    ],
    ["a value", <p key="v">Jane Cooper</p>, "Jane Cooper"],
    ["a negative number", <p key="n">-1</p>, "-1"],
    ["two hyphens", <p key="h">--</p>, "--"],
  ])(
    "%s is drawn as the page drew it",
    (_label: string, element: React.ReactElement, text: string) => {
      const detail: HTMLElement = drawElementField({ element });

      expect(within(detail).getByText(text)).toBeVisible();
      expect(within(detail).queryByTestId(EMPTY_VALUE_TEST_ID)).toBeNull();
    },
  );

  test("a Text field whose stored value is '-' is that value, not empty", () => {
    const detail: HTMLElement = drawDetail({
      fieldType: FieldType.Text,
      placeholder: "No description provided.",
      item: { name: "Production", value: "-" },
    });

    expect(within(detail).queryByTestId(EMPTY_VALUE_TEST_ID)).toBeNull();
    expect(within(detail).queryByTestId("placeholder-text")).toBeNull();
  });
});

/*
 * A record's list on a detail card (TableColumnListComponent: labels,
 * monitors, owners) with nothing in it shows its noItemsMessage as the
 * card's quiet placeholder words. Words that are only a dash are the card's
 * own dash, as a field's dash placeholder is - not a hyphen as placeholder
 * words beside the dash of the field next to it. In a table's cell, an
 * empty list was the quiet dash already; a dash for its words is read out
 * as "Not set", never as a dash.
 */
describe("an empty list whose noItemsMessage is a dash", () => {
  function drawDetailWithElement(element: React.ReactElement): HTMLElement {
    return render(
      <div data-testid="detail">
        <Detail<Item>
          id="detail-dash-list"
          item={{ name: "Production", value: "set" }}
          fields={[
            { key: "name", title: "Name", fieldType: FieldType.Text },
            {
              key: "value",
              title: "Monitors",
              fieldType: FieldType.Element,
              getElement: (): React.ReactElement => {
                return element;
              },
            },
          ]}
          showRecordLine={false}
        />
      </div>,
    ).getByTestId("detail");
  }

  function drawList(data: {
    noItemsMessage: string;
    inTableCell?: boolean | undefined;
  }): HTMLElement {
    const list: React.ReactElement = (
      <TableColumnListComponent<Item>
        items={[]}
        moreTemplate={{
          one: "{{count}} more monitor",
          other: "{{count}} more monitors",
        }}
        noItemsMessage={data.noItemsMessage}
        getEachElement={(item: Item): React.ReactElement => {
          return <span>{item.name}</span>;
        }}
      />
    );

    if (data.inTableCell) {
      return render(
        <div data-testid="cell">
          <TableCellContext.Provider value={true}>
            {list}
          </TableCellContext.Provider>
        </div>,
      ).getByTestId("cell");
    }

    return drawDetailWithElement(list);
  }

  describe.each(DASHES)("written as %s", (_label: string, dash: string) => {
    test("on a detail card is the card's quiet dash, read out as 'Not set'", () => {
      const detail: HTMLElement = drawList({ noItemsMessage: dash });
      const empty: HTMLElement =
        within(detail).getByTestId(EMPTY_VALUE_TEST_ID);

      expect(empty).toBeVisible();
      expect(within(empty).getByText(EMPTY_VALUE_MARK)).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(within(empty).getByText("Not set")).toHaveClass("sr-only");
      expect(within(detail).queryByTestId("placeholder-text")).toBeNull();
    });

    test("in a table's cell is the quiet dash, read out as 'Not set'", () => {
      const cell: HTMLElement = drawList({
        noItemsMessage: dash,
        inTableCell: true,
      });
      const empty: HTMLElement = within(cell).getByTestId(
        TABLE_EMPTY_VALUE_TEST_ID,
      );

      expect(within(empty).getByText("Not set")).toHaveClass("sr-only");
      // The only dash is the quiet one, hidden from a screen reader.
      expect(empty.textContent).toBe(EMPTY_VALUE_MARK + "Not set");
    });
  });

  test("on a detail card, words are still the card's placeholder words", () => {
    const detail: HTMLElement = drawList({ noItemsMessage: "No monitors." });
    const words: HTMLElement = within(detail).getByTestId("placeholder-text");

    expect(words).toHaveTextContent("No monitors.");
    expect(words.className).toBe(PLACEHOLDER_TEXT_CLASS_NAME);
    expect(within(detail).queryByTestId(EMPTY_VALUE_TEST_ID)).toBeNull();
  });

  test("on a detail card, a dash draws what an empty field with no words draws", () => {
    const listDashHtml: string = within(
      drawList({ noItemsMessage: "-" }),
    ).getByTestId(EMPTY_VALUE_TEST_ID).outerHTML;
    cleanup();

    render(<EmptyValue />);

    expect(listDashHtml).toBe(
      screen.getByTestId(EMPTY_VALUE_TEST_ID).outerHTML,
    );
  });
});
