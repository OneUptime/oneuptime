import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import TableBody from "../../../../UI/Components/Table/TableBody";
import TableEmptyValue from "../../../../UI/Components/Table/TableEmptyValue";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../../UI/Utils/LineDirection";
import { TABLE_FOLDED_MAIN_ATTRIBUTE } from "../../../../UI/Components/Table/FullValueTitle";
import { TABLE_FOLDED_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableFoldedValues";

/*
 * A table's plain value is cut short with "..." at its cell's edge, and a
 * line ends where the page's lines do. On a Persian page an English value
 * lost its start - Threat Intel's Last Poll Summary, an indicator's Value
 * and Feed, every plain column of every list. A cell whose value reads the
 * other way from the page reads its own way (dir), so it is cut at its own
 * end, and lines up with the column as the page's lines do. Everything else
 * is drawn as it always was.
 */

interface Row {
  _id: string;
  summary: string;
  owner: string;
  createdAt: string;
}

const ROW: Row = {
  _id: "44000000-0000-4000-8000-000000000001",
  summary:
    "Polled 4,812 indicators from the AlienVault OTX pulse feed; 12 were new.",
  owner: "تیم پرداخت",
  createdAt: "2026-10-16T05:34:00.000Z",
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { en: { translation: {} }, fa: { translation: {} } },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const drawRow: (data: {
  language: string;
  columns: Columns<Row>;
  foldedColumns?: Columns<Row> | undefined;
}) => void = (data: {
  language: string;
  columns: Columns<Row>;
  foldedColumns?: Columns<Row> | undefined;
}): void => {
  render(
    <I18nextProvider i18n={instances[data.language]!}>
      <table>
        <TableBody<Row>
          id="line-direction-body"
          data={[ROW]}
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

// The box the cell's value is cut short in: the <td>'s direct child.
const cutBoxOf: (text: string) => HTMLElement = (text: string): HTMLElement => {
  const cell: HTMLElement = screen.getByText(text).closest("td") as HTMLElement;

  return cell.firstElementChild as HTMLElement;
};

const SUMMARY_AND_OWNER: Columns<Row> = [
  { title: "Owner", type: FieldType.Text, key: "owner" },
  { title: "Last Poll Summary", type: FieldType.Text, key: "summary" },
];

describe("on a Persian page", () => {
  test("an English value's box reads left to right, lined up as the page's lines", () => {
    drawRow({ language: "fa", columns: SUMMARY_AND_OWNER });

    const box: HTMLElement = cutBoxOf(ROW.summary);

    expect(box).toHaveAttribute("dir", "ltr");
    /*
     * A value that gives way before the rows scroll sideways: lined up by
     * its last line, as the row's name is (below).
     */
    expect(box).toHaveClass(
      LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
    );
    expect(box).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    // Still cut short there, as every one-line value is.
    expect(box).toHaveClass("overflow-x-clip", "text-ellipsis");
  });

  test("an English value in a column its page sized is lined up by its end", () => {
    drawRow({
      language: "fa",
      columns: [
        { title: "Owner", type: FieldType.Text, key: "owner" },
        {
          title: "Last Poll Summary",
          type: FieldType.Text,
          key: "summary",
          contentClassName: "max-w-xs",
        },
      ],
    });

    const box: HTMLElement = cutBoxOf(ROW.summary);

    expect(box).toHaveAttribute("dir", "ltr");
    expect(box).toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });

  test("a Persian value's box reads as the page does, with nothing of its own", () => {
    drawRow({ language: "fa", columns: SUMMARY_AND_OWNER });

    const box: HTMLElement = cutBoxOf(ROW.owner);

    expect(box).not.toHaveAttribute("dir");
    expect(box).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });

  test("a column that draws its own element, or a date, keeps the page's way", () => {
    drawRow({
      language: "fa",
      columns: [
        {
          title: "Summary",
          type: FieldType.Text,
          key: "summary",
          getElement: (row: Row): ReactElement => {
            return <span>{row.summary}</span>;
          },
        },
        { title: "Created", type: FieldType.DateTime, key: "createdAt" },
      ],
    });

    expect(cutBoxOf(ROW.summary)).not.toHaveAttribute("dir");

    const dateBox: HTMLElement = screen
      .getAllByRole("cell")[1]!
      .querySelector("div") as HTMLElement;

    expect(dateBox).not.toHaveAttribute("dir");
  });

  test("a cell with another column's value folded under it keeps the page's way", () => {
    drawRow({
      language: "fa",
      columns: [
        { title: "Last Poll Summary", type: FieldType.Text, key: "summary" },
      ],
      foldedColumns: [
        {
          title: "Owner",
          type: FieldType.Text,
          key: "owner",
          hideBelowLargeScreen: true,
          foldInto: "summary",
        },
      ],
    });

    const cell: HTMLElement = screen
      .getByText(ROW.summary)
      .closest("td") as HTMLElement;

    expect(cell.firstElementChild).not.toHaveAttribute("dir");

    /*
     * Its own value's line reads its way, so an English title cut short to
     * its lines ends in "..." at its own end - not at its start, as "...every
     * EU region while the payments gateway" did - and sits at the page's
     * start, as wide as its words.
     */
    const main: HTMLElement = cell.querySelector(
      `[${TABLE_FOLDED_MAIN_ATTRIBUTE}]`,
    ) as HTMLElement;

    expect(main).toHaveTextContent(ROW.summary);
    expect(main).toHaveAttribute("dir", "ltr");
    expect(main).toHaveClass(CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    expect(main).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);

    // The folded value under it is a line of the page's, outside it.
    const folded: HTMLElement = screen.getByTestId(TABLE_FOLDED_VALUE_TEST_ID);

    expect(folded).toHaveTextContent(ROW.owner);
    expect(folded).not.toHaveAttribute("dir");
    expect(main).not.toContainElement(folded);
  });

  test("a cell whose folded columns have nothing to say reads as an unfolded one", () => {
    drawRow({
      language: "fa",
      columns: [
        { title: "Last Poll Summary", type: FieldType.Text, key: "summary" },
      ],
      foldedColumns: [
        {
          title: "Notes",
          type: FieldType.Element,
          key: "owner",
          hideBelowLargeScreen: true,
          foldInto: "summary",
          // Nothing to say: the quiet dash, which draws no line.
          getElement: (): ReactElement => {
            return <TableEmptyValue />;
          },
        },
      ],
    });

    const cell: HTMLElement = screen
      .getByText(ROW.summary)
      .closest("td") as HTMLElement;

    expect(cell.firstElementChild).toHaveAttribute("dir", "ltr");
    expect(cell.querySelector(`[${TABLE_FOLDED_MAIN_ATTRIBUTE}]`)).toBe(null);
  });

  test("a Persian value with an English one folded under it is drawn as it always was", () => {
    drawRow({
      language: "fa",
      columns: [{ title: "Owner", type: FieldType.Text, key: "owner" }],
      foldedColumns: [
        {
          title: "Last Poll Summary",
          type: FieldType.Text,
          key: "summary",
          hideBelowLargeScreen: true,
          foldInto: "owner",
        },
      ],
    });

    const main: HTMLElement = screen
      .getByText(ROW.owner)
      .closest(`[${TABLE_FOLDED_MAIN_ATTRIBUTE}]`) as HTMLElement;

    expect(main).not.toHaveAttribute("dir");
    expect(main).not.toHaveClass(CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });
});

describe("on an English page", () => {
  test("a Persian value's box reads right to left", () => {
    drawRow({ language: "en", columns: SUMMARY_AND_OWNER });

    const box: HTMLElement = cutBoxOf(ROW.owner);

    expect(box).toHaveAttribute("dir", "rtl");
    // The row's name: lined up by its last line (below).
    expect(box).toHaveClass("text-start", "[text-align-last:end]");
  });

  test("an English value's box is drawn as it always was", () => {
    drawRow({ language: "en", columns: SUMMARY_AND_OWNER });

    const box: HTMLElement = cutBoxOf(ROW.summary);

    expect(box).not.toHaveAttribute("dir");
    expect(box).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });
});

/*
 * A row's name may be cut short to its first line (line-clamp, while its
 * table fits its card). Aligned to its end, that line's "..." was drawn
 * past the box's edge and cut ("Customer notifications worker (queue
 * co.." on an Arabic monitor list); only its last line is aligned to its
 * end, so a name that fits still starts where the page's lines do. So is
 * any other column's value that gives way when the table needs the room
 * ("High Node Memo." on an Arabic alerts list); a column its page sized
 * keeps its end alignment (above).
 */
describe("a row's name that reads the other way", () => {
  test("is lined up by its last line, so a line cut short keeps its whole ellipsis", () => {
    drawRow({
      language: "fa",
      columns: [
        { title: "Last Poll Summary", type: FieldType.Text, key: "summary" },
        { title: "Owner", type: FieldType.Text, key: "owner" },
      ],
    });

    const box: HTMLElement = cutBoxOf(ROW.summary);

    expect(box).toHaveAttribute("dir", "ltr");
    expect(box).toHaveClass("text-start", "[text-align-last:end]");
    expect(box).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    expect(LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME).toBe(
      "text-start [text-align-last:end]",
    );
  });

  test("an element that names its words (getLineText) reads their way", () => {
    drawRow({
      language: "fa",
      columns: [
        {
          title: "Summary",
          type: FieldType.Element,
          key: "summary",
          getElement: (row: Row): ReactElement => {
            return (
              <a href="#summary">
                <span className="flex">{row.summary}</span>
              </a>
            );
          },
          getLineText: (row: Row): string => {
            return row.summary;
          },
        },
        {
          title: "Owner",
          type: FieldType.Element,
          key: "owner",
          getElement: (row: Row): ReactElement => {
            return <span>{row.owner}</span>;
          },
          getLineText: (row: Row): string => {
            return row.owner;
          },
        },
      ],
    });

    const name: HTMLElement = cutBoxOf(ROW.summary);

    expect(name).toHaveAttribute("dir", "ltr");
    expect(name).toHaveClass("text-start", "[text-align-last:end]");

    // A Persian value on a Persian page is drawn as it always was.
    expect(cutBoxOf(ROW.owner)).not.toHaveAttribute("dir");
  });

  test("an English element on an English page is drawn as it always was", () => {
    drawRow({
      language: "en",
      columns: [
        {
          title: "Summary",
          type: FieldType.Element,
          key: "summary",
          getElement: (row: Row): ReactElement => {
            return <span>{row.summary}</span>;
          },
          getLineText: (row: Row): string => {
            return row.summary;
          },
        },
      ],
    });

    const box: HTMLElement = cutBoxOf(ROW.summary);

    expect(box).not.toHaveAttribute("dir");
    expect(box).not.toHaveClass("[text-align-last:end]");
  });
});
