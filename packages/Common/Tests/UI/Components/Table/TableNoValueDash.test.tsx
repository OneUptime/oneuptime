import "@testing-library/jest-dom";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import TableBody from "../../../../UI/Components/Table/TableBody";
import Column from "../../../../UI/Components/Table/Types/Column";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import TableEmptyValue, {
  TABLE_EMPTY_VALUE_TEST_ID,
  TABLE_NO_VALUE_MESSAGE_CLASS_NAME,
  TableNoValueMessage,
  getTableNoValue,
} from "../../../../UI/Components/Table/TableEmptyValue";
import {
  DASH_PLACEHOLDERS,
  EMPTY_VALUE_MARK,
  isDashText,
} from "../../../../UI/Components/Detail/EmptyValue";
import { renderAttributeValue } from "../../../../UI/Components/ModelTable/AttributeColumns";
import { renderCustomFieldValue } from "../../../../UI/Components/ModelTable/CustomFieldColumns";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";

/*
 * ISSUE #7264: A COLUMN'S "-" FOR AN EMPTY VALUE WAS A DARK HYPHEN BESIDE
 * THE QUIET DASH EVERY OTHER EMPTY CELL HAS.
 *
 * An empty cell is the quiet dash (TableEmptyValue): light grey, "Not set"
 * for a screen reader. A column that set `noValueMessage: "-"` drew its own
 * `<span class="text-gray-500">-</span>` instead - a hyphen, darker, with
 * nothing to hear - so one row could show both marks (the Workspace Logs'
 * Channel and User, #7116). A dash written as a column's words is now the
 * quiet dash (getTableNoValue), on a laptop's row and a phone's card (which
 * leaves out a field with nothing to say, as it does every empty one);
 * words of a column's own ("Never") are drawn as written.
 *
 * Every table is drawn by the real TableBody.
 */

interface Row {
  _id: string;
  name: string;
  value?: unknown;
}

const ROW_ID: string = "72640000-0000-4000-8000-000000000001";
const ROW_NAME: string = "Primary key";
const VALUE_TITLE: string = "Value";

const GERMAN_FILE: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

let german: i18n;

beforeAll(async () => {
  german = createInstance();
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: { de: { translation: GERMAN_FILE } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

// Every way a page wrote a dash for "nothing here".
const DASHES: Array<[string, string]> = [
  ["a hyphen", "-"],
  ["an en dash", "\u2013"],
  ["an em dash", "\u2014"],
  ["a hyphen with spaces", " - "],
];

// The column types a cell draws an empty value for itself (TableRow).
const TYPES: Array<[string, FieldType]> = [
  ["a text", FieldType.Text],
  ["a long text", FieldType.LongText],
  ["a number", FieldType.Number],
  ["a date", FieldType.Date],
  ["a date and time", FieldType.DateTime],
  ["an email", FieldType.Email],
  ["a phone number", FieldType.Phone],
  ["a colour", FieldType.Color],
  ["an amount", FieldType.USDCents],
  ["a share", FieldType.Percent],
];

function valueColumn(data: {
  type: FieldType;
  noValueMessage?: string | undefined;
  extra?: Partial<Column<Row>> | undefined;
}): Column<Row> {
  return {
    title: VALUE_TITLE,
    type: data.type,
    key: "value",
    ...(data.noValueMessage !== undefined
      ? { noValueMessage: data.noValueMessage }
      : {}),
    ...(data.extra || {}),
  };
}

function draw(data: {
  columns: Columns<Row>;
  row?: Partial<Row> | undefined;
  isMobile?: boolean | undefined;
  foldedColumns?: Columns<Row> | undefined;
  instance?: i18n | undefined;
}): HTMLElement {
  const body: ReactElement = (
    <TableBody<Row>
      id="table-no-value-dash"
      data={[{ _id: ROW_ID, name: ROW_NAME, ...(data.row || {}) }]}
      columns={data.columns}
      selectedItems={[]}
      matchBulkSelectedItemByField={undefined}
      isMobile={Boolean(data.isMobile)}
      isPhone={Boolean(data.isMobile)}
      foldedColumns={data.foldedColumns}
    />
  );
  const rows: ReactElement = data.isMobile ? (
    <div data-testid="rows">{body}</div>
  ) : (
    <table data-testid="rows">{body}</table>
  );

  return render(
    data.instance ? (
      <I18nextProvider i18n={data.instance}>{rows}</I18nextProvider>
    ) : (
      rows
    ),
  ).getByTestId("rows");
}

const NAME_COLUMN: Column<Row> = {
  title: "Name",
  type: FieldType.Text,
  key: "name",
};

// The value column's <td>: the row's second cell.
function valueCellOf(rows: HTMLElement): HTMLElement {
  const cell: HTMLElement | undefined = Array.from(
    rows.querySelectorAll("td"),
  )[1] as HTMLElement | undefined;

  if (!cell) {
    throw new Error("The row has no value cell");
  }

  return cell;
}

/*
 * The text a reader sees in an element: what is neither hidden from a
 * screen reader's eyes (aria-hidden marks are seen) nor visually hidden.
 * A dash drawn as words is seen; the quiet dash is seen as its mark.
 */
function seenTextOf(element: HTMLElement): string {
  const clone: HTMLElement = element.cloneNode(true) as HTMLElement;

  for (const hidden of Array.from(clone.querySelectorAll(".sr-only"))) {
    hidden.remove();
  }

  return (clone.textContent || "").trim();
}

// The marks drawn in an element outside the quiet dash: a hyphen of a column's own.
function ownDashesOf(element: HTMLElement): Array<string> {
  const clone: HTMLElement = element.cloneNode(true) as HTMLElement;

  for (const quiet of Array.from(
    clone.querySelectorAll(`[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`),
  )) {
    quiet.remove();
  }

  return Array.from(clone.querySelectorAll("*"))
    .filter((node: Element): boolean => {
      return node.children.length === 0 && isDashText(node.textContent || "");
    })
    .map((node: Element): string => {
      return node.textContent || "";
    });
}

describe("a column whose words for an empty value are a dash", () => {
  describe.each(DASHES)("written as %s", (_label: string, dash: string) => {
    test.each(TYPES)(
      "on a laptop, %s cell is the quiet dash, with no hyphen of its own",
      (_type: string, type: FieldType) => {
        const rows: HTMLElement = draw({
          columns: [NAME_COLUMN, valueColumn({ type, noValueMessage: dash })],
        });
        const cell: HTMLElement = valueCellOf(rows);
        const quiet: HTMLElement = within(cell).getByTestId(
          TABLE_EMPTY_VALUE_TEST_ID,
        );

        expect(quiet).toBeVisible();
        expect(seenTextOf(cell)).toBe(EMPTY_VALUE_MARK);
        expect(ownDashesOf(cell)).toEqual([]);
        // A screen reader hears the words every empty cell says.
        expect(quiet.querySelector(".sr-only")).toHaveTextContent("Not set");
        expect(
          cell.querySelector(`.${TABLE_NO_VALUE_MESSAGE_CLASS_NAME}`),
        ).toBeNull();
      },
    );

    test.each(TYPES)(
      "on a phone's card, %s field with nothing to say is left out, as every empty field is",
      (_type: string, type: FieldType) => {
        const cards: HTMLElement = draw({
          columns: [NAME_COLUMN, valueColumn({ type, noValueMessage: dash })],
          isMobile: true,
        });

        // The card still names its row.
        expect(within(cards).getByText(ROW_NAME)).toBeVisible();
        expect(within(cards).queryByText(VALUE_TITLE)).toBeNull();
        expect(ownDashesOf(cards)).toEqual([]);
        expect(seenTextOf(cards)).toBe(ROW_NAME);
      },
    );
  });

  test("draws the same as a column with no words at all, on a laptop and a phone", () => {
    for (const isMobile of [false, true]) {
      const withDash: string = draw({
        columns: [
          NAME_COLUMN,
          valueColumn({ type: FieldType.Text, noValueMessage: "-" }),
        ],
        isMobile,
      }).innerHTML;
      cleanup();

      const withNone: string = draw({
        columns: [NAME_COLUMN, valueColumn({ type: FieldType.Text })],
        isMobile,
      }).innerHTML;
      cleanup();

      expect([isMobile, withDash]).toEqual([isMobile, withNone]);
    }
  });

  test("a value it holds is drawn as itself, never the dash", () => {
    const rows: HTMLElement = draw({
      columns: [
        NAME_COLUMN,
        valueColumn({ type: FieldType.Text, noValueMessage: "-" }),
      ],
      row: { value: "Rotated weekly" },
    });
    const cell: HTMLElement = valueCellOf(rows);

    expect(within(cell).getByText("Rotated weekly")).toBeVisible();
    expect(within(cell).queryByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeNull();
  });

  test("a dash folded under another column's value draws no line, as no value does", () => {
    const folded: Column<Row> = valueColumn({
      type: FieldType.Text,
      noValueMessage: "-",
      extra: { foldInto: "name", showTitleWhenFolded: true },
    });
    const rows: HTMLElement = draw({
      columns: [NAME_COLUMN],
      foldedColumns: [folded],
    });
    const cell: HTMLElement = rows.querySelector("td") as HTMLElement;

    expect(seenTextOf(cell)).toBe(ROW_NAME);
    expect(ownDashesOf(cell)).toEqual([]);
    expect(within(cell).queryByText(VALUE_TITLE)).toBeNull();
  });

  test("the check can fail: a folded column with words of its own draws its line", () => {
    const folded: Column<Row> = valueColumn({
      type: FieldType.Text,
      noValueMessage: "Never rotated",
      extra: { foldInto: "name" },
    });
    const rows: HTMLElement = draw({
      columns: [NAME_COLUMN],
      foldedColumns: [folded],
    });

    expect(
      within(rows.querySelector("td") as HTMLElement).getByText(
        "Never rotated",
      ),
    ).toBeVisible();
  });
});

describe("a column with words of its own for an empty value", () => {
  const WORDS: Array<string> = ["Never", "No labels attached.", "-1", "--"];

  test.each(WORDS)(
    "draws '%s' as written, in the grey of a missing value, on a laptop",
    (words: string) => {
      const rows: HTMLElement = draw({
        columns: [
          NAME_COLUMN,
          valueColumn({ type: FieldType.Text, noValueMessage: words }),
        ],
      });
      const cell: HTMLElement = valueCellOf(rows);
      const drawn: HTMLElement = within(cell).getByText(words);

      expect(drawn).toBeVisible();
      expect(drawn).toHaveClass(TABLE_NO_VALUE_MESSAGE_CLASS_NAME);
      expect(within(cell).queryByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeNull();
    },
  );

  test.each(WORDS)(
    "keeps '%s' on a phone's card, under the column's name",
    (words: string) => {
      const cards: HTMLElement = draw({
        columns: [
          NAME_COLUMN,
          valueColumn({ type: FieldType.DateTime, noValueMessage: words }),
        ],
        isMobile: true,
      });

      expect(within(cards).getByText(VALUE_TITLE)).toBeVisible();
      expect(within(cards).getByText(words)).toHaveClass(
        TABLE_NO_VALUE_MESSAGE_CLASS_NAME,
      );
    },
  );

  test("in the reader's language", () => {
    const never: string = GERMAN_FILE["Never"] as string;

    expect(never).toBeTruthy();
    expect(never).not.toBe("Never");

    const rows: HTMLElement = draw({
      columns: [
        NAME_COLUMN,
        valueColumn({ type: FieldType.DateTime, noValueMessage: "Never" }),
      ],
      instance: german,
    });

    expect(within(valueCellOf(rows)).getByText(never)).toBeVisible();
  });

  test("the quiet dash a dash becomes says 'Not set' in the reader's language", () => {
    const notSet: string = GERMAN_FILE["Not set"] as string;

    expect(notSet).toBeTruthy();
    expect(notSet).not.toBe("Not set");

    const rows: HTMLElement = draw({
      columns: [
        NAME_COLUMN,
        valueColumn({ type: FieldType.Text, noValueMessage: "-" }),
      ],
      instance: german,
    });

    expect(
      within(valueCellOf(rows))
        .getByTestId(TABLE_EMPTY_VALUE_TEST_ID)
        .querySelector(".sr-only"),
    ).toHaveTextContent(notSet);
  });

  test("blank words are no words: the quiet dash", () => {
    const rows: HTMLElement = draw({
      columns: [
        NAME_COLUMN,
        valueColumn({ type: FieldType.Text, noValueMessage: "   " }),
      ],
    });

    expect(
      within(valueCellOf(rows)).getByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).toBeVisible();
  });
});

describe("an amount or a share with no value", () => {
  test.each([
    [FieldType.USDCents, "0 USD"],
    [FieldType.Percent, "0%"],
  ])(
    "with no words is %s's zero, as it always was",
    (type: FieldType, zero: string) => {
      const rows: HTMLElement = draw({
        columns: [NAME_COLUMN, valueColumn({ type })],
      });

      expect(seenTextOf(valueCellOf(rows))).toBe(zero);
    },
  );

  test.each([FieldType.USDCents, FieldType.Percent])(
    "with words of its own draws them as every column does (%s)",
    (type: FieldType) => {
      const rows: HTMLElement = draw({
        columns: [NAME_COLUMN, valueColumn({ type, noValueMessage: "Free" })],
      });

      expect(within(valueCellOf(rows)).getByText("Free")).toHaveClass(
        TABLE_NO_VALUE_MESSAGE_CLASS_NAME,
      );
    },
  );
});

describe("getTableNoValue", () => {
  test.each(
    DASH_PLACEHOLDERS.map((dash: string): [string] => {
      return [dash];
    }),
  )(
    "is the quiet dash itself for '%s', so a phone's card knows to leave it out",
    (dash: string) => {
      expect(getTableNoValue(dash).type).toBe(TableEmptyValue);
    },
  );

  test.each([[undefined], [""], ["  "]])(
    "is the quiet dash for no words (%p)",
    (words: string | undefined) => {
      expect(getTableNoValue(words).type).toBe(TableEmptyValue);
    },
  );

  test("is the column's words for words", () => {
    const element: ReactElement = getTableNoValue("Never");

    expect(element.type).toBe(TableNoValueMessage);
    expect((element.props as { text: string }).text).toBe("Never");
  });
});

describe("isDashText", () => {
  test.each([["-"], ["\u2013"], ["\u2014"], [" - "], ["\u2014 "]])(
    "'%s' is only a dash",
    (text: string) => {
      expect(isDashText(text)).toBe(true);
    },
  );

  test.each([
    [undefined],
    [""],
    ["--"],
    ["-1"],
    ["Never"],
    ["- none"],
    // A minus sign is a number's, not a dash.
    ["\u{2212}"],
  ])("%p is not", (text: string | undefined) => {
    expect(isDashText(text)).toBe(false);
  });
});

describe("a table's attribute and custom field columns", () => {
  const attributeColumn: Column<Row> = {
    title: VALUE_TITLE,
    type: FieldType.Element,
    key: "value",
    getElement: (item: Row): ReactElement => {
      return renderAttributeValue({ value: item.value });
    },
  };

  const customFieldColumn: Column<Row> = {
    title: VALUE_TITLE,
    type: FieldType.Element,
    key: "value",
    getElement: (item: Row): ReactElement => {
      return renderCustomFieldValue({
        value: item.value,
        definition: { name: "Owner", customFieldType: CustomFieldType.Text },
      });
    },
  };

  test.each([
    ["an attribute the row does not carry", attributeColumn],
    ["a custom field nobody filled in", customFieldColumn],
  ])(
    "%s is the quiet dash on a laptop, not a '-' of its own",
    (_label: string, column: Column<Row>) => {
      const cell: HTMLElement = valueCellOf(
        draw({ columns: [NAME_COLUMN, column] }),
      );

      expect(within(cell).getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeVisible();
      expect(seenTextOf(cell)).toBe(EMPTY_VALUE_MARK);
      expect(ownDashesOf(cell)).toEqual([]);
    },
  );

  test.each([
    ["an attribute the row does not carry", attributeColumn],
    ["a custom field nobody filled in", customFieldColumn],
  ])(
    "%s is left out of a phone's card",
    (_label: string, column: Column<Row>) => {
      const cards: HTMLElement = draw({
        columns: [NAME_COLUMN, column],
        isMobile: true,
      });

      expect(within(cards).queryByText(VALUE_TITLE)).toBeNull();
      expect(seenTextOf(cards)).toBe(ROW_NAME);
    },
  );

  test.each([
    ["an attribute", attributeColumn],
    ["a custom field", customFieldColumn],
  ])(
    "%s with a value shows it, on a phone's card too",
    (_label: string, column: Column<Row>) => {
      const cards: HTMLElement = draw({
        columns: [NAME_COLUMN, column],
        row: { value: "web-1" },
        isMobile: true,
      });

      expect(within(cards).getByText(VALUE_TITLE)).toBeInTheDocument();
      expect(within(cards).getByText("web-1")).toBeVisible();
    },
  );
});
