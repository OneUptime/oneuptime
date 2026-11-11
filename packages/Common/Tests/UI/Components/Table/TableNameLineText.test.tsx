import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import TableBody from "../../../../UI/Components/Table/TableBody";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import Column from "../../../../UI/Components/Table/Types/Column";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  drawsItsOwnLines,
  getElementLineText,
  isNameFieldKey,
  NAME_FIELD_KEYS,
} from "../../../../UI/Components/Table/ColumnLineText";
import {
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../../UI/Utils/LineDirection";

/*
 * A RECORD'S NAME, DRAWN AS A LINK, READS THE WAY IT IS WRITTEN.
 *
 * A table's cell reads its line the way its words do when that is not the
 * page's way - but a column that drew an element (a record's name as a
 * link to it) said nothing of its words, so its cell kept the page's way.
 * On an Arabic or Persian page an English incident title ("Checkout API
 * latency above 2s for EU customers") was cut at its start: "...latency
 * above 2s for EU customers". A column on a record's name or title now
 * reads that field's value as its words (ColumnLineText), unless it says
 * otherwise (getLineText) - other words, or none (drawsItsOwnLines) for a
 * cell that lays out a mark, a badge or the page's own words beside the
 * name.
 */

interface Row {
  _id: string;
  name?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  priority?: number | undefined;
}

const ENGLISH_TITLE: string =
  "Checkout API latency above 2s for EU customers since the 14:05 deploy";
const ENGLISH_NAME: string = "payments-gateway-eu-west-1 (primary)";
const ARABIC_NAME: string = "بوابة الدفع الرئيسية";
const PERSIAN_NAME: string = "درگاه پرداخت اصلی";

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

const drawRows: (data: {
  language: string;
  rows: Array<Row>;
  columns: Columns<Row>;
  foldedColumns?: Columns<Row> | undefined;
}) => void = (data: {
  language: string;
  rows: Array<Row>;
  columns: Columns<Row>;
  foldedColumns?: Columns<Row> | undefined;
}): void => {
  render(
    <I18nextProvider i18n={instances[data.language]!}>
      <table>
        <TableBody<Row>
          id="name-line-text-body"
          data={data.rows}
          columns={data.columns}
          foldedColumns={data.foldedColumns}
          selectedItems={[]}
          matchBulkSelectedItemByField={undefined}
          isMobile={false}
        />
      </table>
    </I18nextProvider>,
  );
};

// The box the cell's line is cut short in: the <td>'s direct child.
const cutBoxOf: (text: string) => HTMLElement = (text: string): HTMLElement => {
  const cell: HTMLElement = screen.getByText(text).closest("td") as HTMLElement;

  return cell.firstElementChild as HTMLElement;
};

// A record's name or title drawn as a link to it, as most lists open.
const linkColumn: (data: {
  key: "name" | "title";
  title?: string | undefined;
  getLineText?: ((row: Row) => string | undefined) | undefined;
}) => Column<Row> = (data: {
  key: "name" | "title";
  title?: string | undefined;
  getLineText?: ((row: Row) => string | undefined) | undefined;
}): Column<Row> => {
  return {
    title: data.title || "Name",
    type: FieldType.Element,
    key: data.key,
    ...(data.getLineText ? { getLineText: data.getLineText } : {}),
    getElement: (row: Row): ReactElement => {
      return <a href={`#${row._id}`}>{row[data.key] || ""}</a>;
    },
  };
};

const PRIORITY_COLUMN: Column<Row> = {
  title: "Priority",
  type: FieldType.Number,
  key: "priority",
};

describe.each([
  ["an Arabic page", "ar"],
  ["a Persian page", "fa"],
])("on %s", (_page: string, language: string) => {
  test("an English title drawn as a link reads left to right and is cut at its own end", () => {
    drawRows({
      language,
      rows: [{ _id: "1", title: ENGLISH_TITLE, priority: 1 }],
      columns: [linkColumn({ key: "title", title: "Title" }), PRIORITY_COLUMN],
    });

    const box: HTMLElement = cutBoxOf(ENGLISH_TITLE);

    expect(box).toHaveAttribute("dir", "ltr");
    // The row's name: lined up by its last line, so a clamped line keeps its "...".
    expect(box).toHaveClass(
      ...LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
    );
    // Still a box that cuts its line short.
    expect(box).toHaveClass("overflow-x-clip", "text-ellipsis");
    // The link and its words are drawn as they always were.
    expect(screen.getByRole("link", { name: ENGLISH_TITLE })).toHaveAttribute(
      "href",
      "#1",
    );
  });

  test("an English name drawn as a link reads left to right", () => {
    drawRows({
      language,
      rows: [{ _id: "1", name: ENGLISH_NAME, priority: 1 }],
      columns: [linkColumn({ key: "name" }), PRIORITY_COLUMN],
    });

    expect(cutBoxOf(ENGLISH_NAME)).toHaveAttribute("dir", "ltr");
  });

  /*
   * A name in another column gives way when the table needs the room - cut
   * to its first line - so it is lined up by its last line too: aligned to
   * its end, that line's "..." was drawn past the box's edge ("High Node
   * Memo." with one dot of three).
   */
  test("a name that is not the row's first column lines up by its last line", () => {
    drawRows({
      language,
      rows: [{ _id: "1", name: ENGLISH_NAME, priority: 1 }],
      columns: [PRIORITY_COLUMN, linkColumn({ key: "name" })],
    });

    const box: HTMLElement = cutBoxOf(ENGLISH_NAME);

    expect(box).toHaveAttribute("dir", "ltr");
    expect(box).toHaveClass(
      ...LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
    );
    expect(box).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });

  test("a name in the page's own script is drawn as it always was", () => {
    drawRows({
      language,
      rows: [
        { _id: "1", name: ARABIC_NAME, priority: 1 },
        { _id: "2", name: PERSIAN_NAME, priority: 2 },
      ],
      columns: [linkColumn({ key: "name" }), PRIORITY_COLUMN],
    });

    for (const name of [ARABIC_NAME, PERSIAN_NAME]) {
      const box: HTMLElement = cutBoxOf(name);

      expect(box).not.toHaveAttribute("dir");
      expect(box).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
      expect(box).not.toHaveClass("[text-align-last:end]");
    }
  });

  test("each row reads its own name's way: an English one and an Arabic one in one list", () => {
    drawRows({
      language,
      rows: [
        { _id: "1", name: ENGLISH_NAME, priority: 1 },
        { _id: "2", name: ARABIC_NAME, priority: 2 },
      ],
      columns: [linkColumn({ key: "name" }), PRIORITY_COLUMN],
    });

    expect(cutBoxOf(ENGLISH_NAME)).toHaveAttribute("dir", "ltr");
    expect(cutBoxOf(ARABIC_NAME)).not.toHaveAttribute("dir");
  });

  test("a column that names other words reads theirs, not the field's", () => {
    drawRows({
      language,
      rows: [{ _id: "1", name: ENGLISH_NAME, priority: 1 }],
      columns: [
        {
          title: "Name",
          type: FieldType.Element,
          key: "name",
          // Shows a word of the page's in place of the stored name.
          getLineText: (): string => {
            return ARABIC_NAME;
          },
          getElement: (): ReactElement => {
            return <span>{ARABIC_NAME}</span>;
          },
        },
        PRIORITY_COLUMN,
      ],
    });

    expect(cutBoxOf(ARABIC_NAME)).not.toHaveAttribute("dir");
  });

  test("a column that names an English line for another field reads it left to right", () => {
    drawRows({
      language,
      rows: [{ _id: "1", description: "Primary EU card processor" }],
      columns: [
        {
          title: "Description",
          type: FieldType.Element,
          key: "description",
          getLineText: (row: Row): string => {
            return row.description || "";
          },
          getElement: (row: Row): ReactElement => {
            return <span>{row.description}</span>;
          },
        },
      ],
    });

    expect(cutBoxOf("Primary EU card processor")).toHaveAttribute("dir", "ltr");
  });

  test("a cell that lays out its own lines (drawsItsOwnLines) keeps the page's way", () => {
    drawRows({
      language,
      rows: [{ _id: "1", name: ENGLISH_NAME, priority: 1 }],
      columns: [
        {
          title: "Name",
          type: FieldType.Element,
          key: "name",
          getLineText: drawsItsOwnLines,
          getElement: (row: Row): ReactElement => {
            return (
              <div className="flex gap-2">
                <span aria-hidden="true">*</span>
                <span>{row.name}</span>
              </div>
            );
          },
        },
        PRIORITY_COLUMN,
      ],
    });

    const box: HTMLElement = cutBoxOf(ENGLISH_NAME);

    expect(box).not.toHaveAttribute("dir");
    expect(box).not.toHaveClass("[text-align-last:end]");
  });

  test("an element column on any other field still keeps the page's way", () => {
    drawRows({
      language,
      rows: [{ _id: "1", description: "Primary EU card processor" }],
      columns: [
        {
          title: "Description",
          type: FieldType.Element,
          key: "description",
          getElement: (row: Row): ReactElement => {
            return <span>{row.description}</span>;
          },
        },
      ],
    });

    expect(cutBoxOf("Primary EU card processor")).not.toHaveAttribute("dir");
  });

  test("a name with a column folded under it keeps the page's way: its folded lines are the page's", () => {
    drawRows({
      language,
      rows: [{ _id: "1", name: ENGLISH_NAME, priority: 3 }],
      columns: [linkColumn({ key: "name" })],
      foldedColumns: [
        {
          ...PRIORITY_COLUMN,
          hideBelowLargeScreen: true,
          foldInto: "name",
        },
      ],
    });

    expect(cutBoxOf(ENGLISH_NAME)).not.toHaveAttribute("dir");
  });

  test("a row with no name draws its empty cell as it always was", () => {
    drawRows({
      language,
      rows: [
        { _id: "1", name: "", priority: 1 },
        { _id: "2", name: "   ", priority: 2 },
      ],
      columns: [
        {
          title: "Name",
          type: FieldType.Element,
          key: "name",
          getElement: (row: Row): ReactElement => {
            return <span data-testid={`empty-name-${row._id}`}>-</span>;
          },
        },
        PRIORITY_COLUMN,
      ],
    });

    const rows: Array<HTMLTableRowElement> = Array.from(
      document.querySelectorAll<HTMLTableRowElement>("tbody tr"),
    );

    expect(rows).toHaveLength(2);

    for (const row of rows) {
      const box: HTMLElement = row.querySelector("td")!
        .firstElementChild as HTMLElement;

      expect(box).not.toHaveAttribute("dir");
      expect(box).not.toHaveClass("[text-align-last:end]");
    }
  });
});

describe("on an English page", () => {
  test("an English name drawn as a link is drawn as it always was", () => {
    drawRows({
      language: "en",
      rows: [{ _id: "1", title: ENGLISH_TITLE, priority: 1 }],
      columns: [linkColumn({ key: "title", title: "Title" }), PRIORITY_COLUMN],
    });

    const box: HTMLElement = cutBoxOf(ENGLISH_TITLE);

    expect(box).not.toHaveAttribute("dir");
    expect(box).not.toHaveClass("[text-align-last:end]");
    expect(box).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });

  test("an Arabic name drawn as a link reads right to left", () => {
    drawRows({
      language: "en",
      rows: [{ _id: "1", name: ARABIC_NAME, priority: 1 }],
      columns: [linkColumn({ key: "name" }), PRIORITY_COLUMN],
    });

    expect(cutBoxOf(ARABIC_NAME)).toHaveAttribute("dir", "rtl");
  });
});

describe("getElementLineText: the words an element column draws", () => {
  const ROW: Row = {
    _id: "1",
    name: ENGLISH_NAME,
    title: ENGLISH_TITLE,
    description: "Primary EU card processor",
    priority: 2,
  };

  test("a record's own name fields are name and title", () => {
    expect(NAME_FIELD_KEYS).toEqual(["name", "title"]);
    expect(isNameFieldKey("name")).toBe(true);
    expect(isNameFieldKey("title")).toBe(true);
    for (const key of ["description", "Name", "names", "", undefined, 1]) {
      expect(isNameFieldKey(key)).toBe(false);
    }
  });

  test("a column on the name or title reads that field's value", () => {
    expect(getElementLineText<Row>(linkColumn({ key: "name" }), ROW)).toBe(
      ENGLISH_NAME,
    );
    expect(getElementLineText<Row>(linkColumn({ key: "title" }), ROW)).toBe(
      ENGLISH_TITLE,
    );
  });

  test("getLineText wins over the field, both ways", () => {
    expect(
      getElementLineText<Row>(
        linkColumn({
          key: "name",
          getLineText: (): string => {
            return "Shown words";
          },
        }),
        ROW,
      ),
    ).toBe("Shown words");

    expect(
      getElementLineText<Row>(
        { ...linkColumn({ key: "name" }), getLineText: drawsItsOwnLines },
        ROW,
      ),
    ).toBeUndefined();

    // An empty line is no words: the cell keeps the page's way.
    expect(
      getElementLineText<Row>(
        linkColumn({
          key: "name",
          getLineText: (): string => {
            return "";
          },
        }),
        ROW,
      ),
    ).toBeUndefined();
  });

  test("any other field, or a name that is not words, gives none", () => {
    expect(
      getElementLineText<Row>(
        { title: "Description", type: FieldType.Element, key: "description" },
        ROW,
      ),
    ).toBeUndefined();
    expect(
      getElementLineText<Row>(
        { title: "Actions", type: FieldType.Actions },
        ROW,
      ),
    ).toBeUndefined();
    expect(
      getElementLineText<Row>(linkColumn({ key: "name" }), {
        _id: "2",
        name: "  ",
      }),
    ).toBeUndefined();
    expect(
      getElementLineText<Row>(linkColumn({ key: "name" }), { _id: "3" }),
    ).toBeUndefined();
    expect(
      getElementLineText<Row>(linkColumn({ key: "title" }), {
        _id: "4",
        title: 12 as unknown as string,
      }),
    ).toBeUndefined();
  });

  test("drawsItsOwnLines names no words", () => {
    expect(drawsItsOwnLines()).toBeUndefined();
  });
});
