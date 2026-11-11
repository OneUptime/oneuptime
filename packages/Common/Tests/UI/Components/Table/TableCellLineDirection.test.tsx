import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import TableBody from "../../../../UI/Components/Table/TableBody";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../../UI/Utils/LineDirection";

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
    expect(box).toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    // Still cut short there, as every one-line value is.
    expect(box).toHaveClass("overflow-x-clip", "text-ellipsis");
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
 * end, so a name that fits still starts where the page's lines do. Any
 * other column's value stays on one line and keeps its end alignment.
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
