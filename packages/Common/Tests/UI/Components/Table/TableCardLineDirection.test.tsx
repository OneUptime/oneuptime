import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import TableBody from "../../../../UI/Components/Table/TableBody";
import Column from "../../../../UI/Components/Table/Types/Column";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { drawsItsOwnLines } from "../../../../UI/Components/Table/ColumnLineText";
import { TABLE_FOLDED_MAIN_ATTRIBUTE } from "../../../../UI/Components/Table/FullValueTitle";
import { TABLE_FOLDED_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableFoldedValues";
import {
  TABLE_CARD_WIDE_FIELD_CLASS_NAME,
  TABLE_MOBILE_FIELD_CLASS_NAME,
  TABLE_MOBILE_FIELD_NAME_CLASS_NAME,
  TABLE_MOBILE_FIELD_VALUE_CLASS_NAME,
  TABLE_WRAP_CELL_OTHER_WAY_LINE_CLASS_NAME,
} from "../../../../UI/Components/Table/TableLayout";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../../UI/Utils/LineDirection";

/*
 * A PHONE'S CARD, ON A PAGE READ FROM THE RIGHT (#6741).
 *
 * A phone draws each row of a list as a card: each column's name over its
 * value (a <dt> over a <dd>), the row's name first, as the card's title.
 * A table's cell has read its value's way since #6736 - an English title
 * on an Arabic page is cut at its own end - but a card's value kept the
 * page's way, and a card wraps its values rather than cut them short: an
 * English incident title's wrapped lines lined up on the right of an
 * Arabic card, ragged on their left, where they start, and its full stop
 * came first.
 *
 * Now a card's value reads as the table's cell does (TableRow's
 * getCellLineDirection): its <dd> takes the value's own way when that is
 * not the page's, and is as wide as its words
 * (CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME), so it still starts where
 * the card's other values do, each of its lines from its own start. A
 * column that draws more than the value's words keeps the card's way, as
 * its cell does. English pages draw every card exactly as they did.
 *
 * These draw real cards (TableBody with isMobile), on real i18next
 * instances for an English, an Arabic and a Persian page.
 */

interface Row {
  _id: string;
  title: string;
  description: string;
  owner: string;
  port: string;
  state: string;
  isEnabled: boolean;
  createdAt: string;
  notes: string;
}

const ENGLISH_TITLE: string =
  "High Node Memory Utilization on AllNodesInEuWest1";
const ENGLISH_DESCRIPTION: string =
  "Memory on every node in eu-west-1 has stayed above 92% for 15 minutes; the checkout pods were evicted twice.";
const PERSIAN_OWNER: string = "تیم پرداخت";
const ARABIC_TITLE: string = "ارتفاع استخدام الذاكرة على عقد الإنتاج";

const ROW: Row = {
  _id: "67410000-0000-4000-8000-000000000001",
  title: ENGLISH_TITLE,
  description: ENGLISH_DESCRIPTION,
  owner: PERSIAN_OWNER,
  port: "8443",
  state: "Investigating",
  isEnabled: true,
  createdAt: "2026-10-16T05:34:00.000Z",
  notes: "Paged the on-call engineer.",
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "ar", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        ar: { translation: {} },
        fa: { translation: {} },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

// The cards of `rows`, as a phone (or a tablet: isPhone false) draws them.
const drawCards: (data: {
  language: string;
  columns: Columns<Row>;
  rows?: Array<Row> | undefined;
  foldedColumns?: Columns<Row> | undefined;
  isPhone?: boolean | undefined;
}) => HTMLElement = (data: {
  language: string;
  columns: Columns<Row>;
  rows?: Array<Row> | undefined;
  foldedColumns?: Columns<Row> | undefined;
  isPhone?: boolean | undefined;
}): HTMLElement => {
  return render(
    <I18nextProvider i18n={instances[data.language]!}>
      <div data-testid="cards">
        <TableBody<Row>
          id="card-line-direction-body"
          data={data.rows || [ROW]}
          columns={data.columns}
          foldedColumns={data.foldedColumns}
          selectedItems={[]}
          matchBulkSelectedItemByField={undefined}
          isMobile={true}
          isPhone={data.isPhone ?? true}
        />
      </div>
    </I18nextProvider>,
  ).getByTestId("cards");
};

// The <dd> a card draws `text` in.
const valueOf: (text: string) => HTMLElement = (text: string): HTMLElement => {
  const value: HTMLElement | null = screen.getByText(text).closest("dd");

  if (!value) {
    throw new Error(`"${text}" is not in a card's value`);
  }

  return value;
};

// The <dt> over a card's field: its column's name.
const termOf: (title: string) => HTMLElement = (title: string): HTMLElement => {
  const term: HTMLElement | undefined = screen
    .getAllByRole("term")
    .find((element: HTMLElement): boolean => {
      return (element.textContent || "").trim() === title;
    });

  if (!term) {
    throw new Error(`No field named "${title}"`);
  }

  return term;
};

const TITLE_CLASS_NAME: string = `${TABLE_MOBILE_FIELD_VALUE_CLASS_NAME} font-medium`;

const CLAMPED_CLASSES: Array<string> =
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" ");

const TITLE_COLUMN: Column<Row> = {
  title: "Title",
  type: FieldType.Text,
  key: "title",
};

const PLAIN_COLUMNS: Columns<Row> = [
  TITLE_COLUMN,
  {
    title: "Description",
    type: FieldType.Text,
    key: "description",
    wrapContent: true,
  },
  { title: "Owner", type: FieldType.Text, key: "owner" },
  { title: "Port", type: FieldType.Text, key: "port" },
  { title: "Notes", type: FieldType.Text, key: "notes" },
];

// A title drawn as a link, as most lists draw a record's name.
const titleLink: (row: Row) => ReactElement = (row: Row): ReactElement => {
  return <a href={`/incidents/${row._id}`}>{row.title}</a>;
};

describe.each(["ar", "fa"])("a card on a %s page", (language: string) => {
  test("its English title reads left to right, as wide as its words, still the card's title", () => {
    drawCards({ language, columns: PLAIN_COLUMNS });

    const title: HTMLElement = valueOf(ENGLISH_TITLE);

    expect(title).toHaveAttribute("dir", "ltr");
    expect(title.getAttribute("class")).toBe(
      `${TITLE_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    );
    // Never aligned to its end: its wrapped lines would line up on the right.
    expect(title).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    expect(title).not.toHaveClass("text-start");
    // It still wraps rather than run past the card.
    expect(title).toHaveClass("break-words", "min-w-0");
  });

  test("the field around it, and its hidden name, keep the page's way", () => {
    drawCards({ language, columns: PLAIN_COLUMNS });

    const field: HTMLElement = valueOf(ENGLISH_TITLE)
      .parentElement as HTMLElement;

    expect(field).not.toHaveAttribute("dir");
    expect(field).toHaveClass(
      ...TABLE_MOBILE_FIELD_CLASS_NAME.split(" "),
      TABLE_CARD_WIDE_FIELD_CLASS_NAME,
    );

    const name: HTMLElement = field.querySelector("dt") as HTMLElement;

    expect(name).toHaveTextContent("Title");
    expect(name).toHaveClass("sr-only");
    expect(name).not.toHaveAttribute("dir");
    expect(field.closest("dl")).not.toHaveAttribute("dir");
  });

  test("an English value under its column's name reads its own way; the name keeps the page's", () => {
    drawCards({ language, columns: PLAIN_COLUMNS });

    const notes: HTMLElement = valueOf(ROW.notes);

    expect(notes).toHaveAttribute("dir", "ltr");
    expect(notes.getAttribute("class")).toBe(
      `${TABLE_MOBILE_FIELD_VALUE_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    );
    expect(notes).not.toHaveClass("font-medium");

    const name: HTMLElement = termOf("Notes");

    expect(name).not.toHaveAttribute("dir");
    expect(name.getAttribute("class")).toBe(TABLE_MOBILE_FIELD_NAME_CLASS_NAME);
  });

  test("a column of prose (wrapContent) reads its own way on the card itself, with no box inside", () => {
    drawCards({ language, columns: PLAIN_COLUMNS });

    const description: HTMLElement = valueOf(ENGLISH_DESCRIPTION);

    expect(description).toHaveAttribute("dir", "ltr");
    expect(description).toHaveClass(...CLAMPED_CLASSES);
    // The table's box inside its cell is the table's alone.
    expect(
      description.querySelector(
        `[class="${TABLE_WRAP_CELL_OTHER_WAY_LINE_CLASS_NAME}"]`,
      ),
    ).toBeNull();
    // Prose keeps the card's whole width, as before.
    expect(description.parentElement).toHaveClass(
      TABLE_CARD_WIDE_FIELD_CLASS_NAME,
    );
  });

  test("a value in the page's own script is drawn exactly as it was", () => {
    drawCards({
      language,
      columns: PLAIN_COLUMNS,
      rows: [{ ...ROW, title: ARABIC_TITLE }],
    });

    const owner: HTMLElement = valueOf(PERSIAN_OWNER);

    expect(owner).not.toHaveAttribute("dir");
    expect(owner.getAttribute("class")).toBe(
      TABLE_MOBILE_FIELD_VALUE_CLASS_NAME,
    );

    const title: HTMLElement = valueOf(ARABIC_TITLE);

    expect(title).not.toHaveAttribute("dir");
    expect(title.getAttribute("class")).toBe(TITLE_CLASS_NAME);
  });

  test("a value with no letters (a port) reads as the page does", () => {
    drawCards({ language, columns: PLAIN_COLUMNS });

    const port: HTMLElement = valueOf(ROW.port);

    expect(port).not.toHaveAttribute("dir");
    expect(port.getAttribute("class")).toBe(
      TABLE_MOBILE_FIELD_VALUE_CLASS_NAME,
    );
  });

  test("a value mostly in English letters that quotes the page's words reads left to right", () => {
    const title: string = `Payments for ${PERSIAN_OWNER} failed in eu-west-1`;

    drawCards({
      language,
      columns: PLAIN_COLUMNS,
      rows: [{ ...ROW, title }],
    });

    expect(valueOf(title)).toHaveAttribute("dir", "ltr");
  });

  test("a title drawn as a link reads its record's name's way (ColumnLineText)", () => {
    drawCards({
      language,
      columns: [{ ...TITLE_COLUMN, getElement: titleLink }],
    });

    const title: HTMLElement = valueOf(ENGLISH_TITLE);

    expect(title).toHaveAttribute("dir", "ltr");
    expect(title.getAttribute("class")).toBe(
      `${TITLE_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    );
    expect(within(title).getByRole("link")).toHaveTextContent(ENGLISH_TITLE);
  });

  test("an element whose column names its words (getLineText) reads their way", () => {
    drawCards({
      language,
      columns: [
        TITLE_COLUMN,
        {
          title: "State",
          type: FieldType.Element,
          key: "state",
          getElement: (row: Row): ReactElement => {
            return <span>{row.state}</span>;
          },
          getLineText: (row: Row): string => {
            return row.state;
          },
        },
      ],
    });

    const state: HTMLElement = valueOf(ROW.state);

    expect(state).toHaveAttribute("dir", "ltr");
    expect(state.getAttribute("class")).toBe(
      `${TABLE_MOBILE_FIELD_VALUE_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    );
  });

  test("an element that names no words of its own keeps the card's way", () => {
    drawCards({
      language,
      columns: [
        TITLE_COLUMN,
        {
          title: "State",
          type: FieldType.Element,
          key: "state",
          getElement: (row: Row): ReactElement => {
            return <span>{row.state}</span>;
          },
        },
      ],
    });

    const state: HTMLElement = valueOf(ROW.state);

    expect(state).not.toHaveAttribute("dir");
    expect(state.getAttribute("class")).toBe(
      TABLE_MOBILE_FIELD_VALUE_CLASS_NAME,
    );
  });

  test("a name that lays out its own lines (drawsItsOwnLines) keeps the card's way", () => {
    drawCards({
      language,
      columns: [
        {
          ...TITLE_COLUMN,
          getElement: (row: Row): ReactElement => {
            return (
              <span className="flex items-center gap-2">
                <span aria-hidden="true">*</span>
                <span dir="ltr">{row.title}</span>
              </span>
            );
          },
          getLineText: drawsItsOwnLines,
        },
      ],
    });

    const title: HTMLElement = valueOf(ENGLISH_TITLE);

    expect(title).not.toHaveAttribute("dir");
    expect(title.getAttribute("class")).toBe(TITLE_CLASS_NAME);
    // The element gives the name its way where it draws it.
    expect(screen.getByText(ENGLISH_TITLE)).toHaveAttribute("dir", "ltr");
  });

  test("a tick, a date and a long text keep the card's way", () => {
    drawCards({
      language,
      columns: [
        TITLE_COLUMN,
        { title: "Enabled", type: FieldType.Boolean, key: "isEnabled" },
        { title: "Created", type: FieldType.DateTime, key: "createdAt" },
        { title: "Notes", type: FieldType.LongText, key: "notes" },
      ],
    });

    for (const title of ["Enabled", "Created", "Notes"]) {
      const value: HTMLElement = termOf(title)
        .nextElementSibling as HTMLElement;

      expect(value.tagName).toBe("DD");
      expect(value).not.toHaveAttribute("dir");
      expect(value.getAttribute("class")).toBe(
        TABLE_MOBILE_FIELD_VALUE_CLASS_NAME,
      );
    }
  });

  test("a field with values folded under it keeps the card's way; its own line reads its way", () => {
    drawCards({
      language,
      columns: [TITLE_COLUMN],
      foldedColumns: [
        {
          title: "Owner",
          type: FieldType.Text,
          key: "owner",
          hideBelowLargeScreen: true,
          foldInto: "title",
        },
      ],
    });

    const main: HTMLElement = screen
      .getByText(ENGLISH_TITLE)
      .closest(`[${TABLE_FOLDED_MAIN_ATTRIBUTE}]`) as HTMLElement;

    expect(main).toHaveAttribute("dir", "ltr");

    const value: HTMLElement = main.closest("dd") as HTMLElement;

    expect(value).not.toHaveAttribute("dir");
    expect(value.getAttribute("class")).toBe(TITLE_CLASS_NAME);
    expect(
      within(value).getByTestId(TABLE_FOLDED_VALUE_TEST_ID),
    ).toHaveTextContent(PERSIAN_OWNER);
  });

  test("a tablet's card (no phone) reads its values the same way", () => {
    drawCards({ language, columns: PLAIN_COLUMNS, isPhone: false });

    expect(valueOf(ENGLISH_TITLE)).toHaveAttribute("dir", "ltr");
    expect(valueOf(ROW.notes)).toHaveAttribute("dir", "ltr");
    expect(valueOf(PERSIAN_OWNER)).not.toHaveAttribute("dir");
  });

  test("each card reads its own title's way", () => {
    drawCards({
      language,
      columns: PLAIN_COLUMNS,
      rows: [
        ROW,
        {
          ...ROW,
          _id: "67410000-0000-4000-8000-000000000002",
          title: ARABIC_TITLE,
        },
      ],
    });

    expect(valueOf(ENGLISH_TITLE)).toHaveAttribute("dir", "ltr");
    expect(valueOf(ARABIC_TITLE)).not.toHaveAttribute("dir");
  });

  test("a card's value is never a one-line box: no end alignment, nor the table's last-line one", () => {
    const cards: HTMLElement = drawCards({
      language,
      columns: [
        ...PLAIN_COLUMNS,
        {
          title: "State",
          type: FieldType.Element,
          key: "state",
          getElement: (row: Row): ReactElement => {
            return <span>{row.state}</span>;
          },
          getLineText: (row: Row): string => {
            return row.state;
          },
        },
      ],
    });

    for (const value of Array.from(cards.querySelectorAll("dd"))) {
      expect(value).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
      for (const className of LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(
        " ",
      )) {
        expect(value).not.toHaveClass(className);
      }
    }
  });
});

describe("a card on an English page", () => {
  test("is drawn exactly as it was: no value has a dir or a class of its own", () => {
    const cards: HTMLElement = drawCards({
      language: "en",
      columns: [
        { ...TITLE_COLUMN, getElement: titleLink },
        ...PLAIN_COLUMNS.slice(1),
        {
          title: "State",
          type: FieldType.Element,
          key: "state",
          getElement: (row: Row): ReactElement => {
            return <span>{row.state}</span>;
          },
          getLineText: (row: Row): string => {
            return row.state;
          },
        },
      ],
      rows: [{ ...ROW, owner: "Payments team" }],
    });

    // But a value's own isolate (IsolatedText's <bdi>), as always.
    expect(cards.querySelectorAll("[dir]:not(bdi)")).toHaveLength(0);

    const values: Array<HTMLElement> = Array.from(cards.querySelectorAll("dd"));

    expect(values).toHaveLength(6);
    expect(values[0]!.getAttribute("class")).toBe(TITLE_CLASS_NAME);
    for (const value of values.slice(1)) {
      expect(value.getAttribute("class")).toBe(
        TABLE_MOBILE_FIELD_VALUE_CLASS_NAME,
      );
    }
  });

  test("a Persian value reads right to left, as wide as its words", () => {
    drawCards({ language: "en", columns: PLAIN_COLUMNS });

    const owner: HTMLElement = valueOf(PERSIAN_OWNER);

    expect(owner).toHaveAttribute("dir", "rtl");
    expect(owner.getAttribute("class")).toBe(
      `${TABLE_MOBILE_FIELD_VALUE_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    );
    // Its English neighbours are drawn as they were.
    expect(valueOf(ENGLISH_TITLE)).not.toHaveAttribute("dir");
    expect(valueOf(ENGLISH_DESCRIPTION)).not.toHaveAttribute("dir");
  });

  test("an Arabic title reads right to left, still the card's title", () => {
    drawCards({
      language: "en",
      columns: PLAIN_COLUMNS,
      rows: [{ ...ROW, title: ARABIC_TITLE }],
    });

    const title: HTMLElement = valueOf(ARABIC_TITLE);

    expect(title).toHaveAttribute("dir", "rtl");
    expect(title.getAttribute("class")).toBe(
      `${TITLE_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    );
  });
});
