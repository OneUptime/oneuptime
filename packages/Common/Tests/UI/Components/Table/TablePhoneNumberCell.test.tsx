import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import TableBody from "../../../../UI/Components/Table/TableBody";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableEmptyValue";
import {
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../../UI/Utils/LineDirection";
import Phone from "../../../../Types/Phone";
import { ObjectType } from "../../../../Types/JSON";

/*
 * ISSUE #6605: A TABLE'S PHONE NUMBER READ 447700900123+ ON A PERSIAN OR
 * ARABIC PAGE.
 *
 * Every list with a phone column (FieldType.Phone: the SMS, call and
 * WhatsApp logs, an incoming call policy's logs, a status page's SMS
 * subscribers, a user's SMS and call numbers) printed the number as text,
 * and on a page read right to left its "+" went to the end of its digits.
 * The cell now draws the number as an isolate that reads left to right
 * (PhoneNumberText), and the cell's line reads left to right too, so a
 * number cut short keeps its "+44" and loses its last digits - as an
 * English value's cell does on a Persian page (TableCellLineDirection).
 */

const UK: string = "+447700900123";
const SG: string = "+6581234567";

interface Row {
  _id: string;
  name: string;
  phone?: Phone | string | undefined;
}

const ROW_ID: string = "66050000-0000-4000-8000-000000000001";

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "fa", "ar"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        fa: { translation: {} },
        ar: { translation: {} },
      },
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
  phone: Row["phone"];
  columns?: Columns<Row> | undefined;
  isMobile?: boolean | undefined;
}) => HTMLElement = (data: {
  language: string;
  phone: Row["phone"];
  columns?: Columns<Row> | undefined;
  isMobile?: boolean | undefined;
}): HTMLElement => {
  const body: ReactElement = (
    <TableBody<Row>
      id="phone-number-body"
      data={[{ _id: ROW_ID, name: "Primary line", phone: data.phone }]}
      columns={data.columns || PHONE_COLUMNS}
      selectedItems={[]}
      matchBulkSelectedItemByField={undefined}
      isMobile={Boolean(data.isMobile)}
      isPhone={Boolean(data.isMobile)}
    />
  );

  return render(
    <I18nextProvider i18n={instances[data.language]!}>
      {data.isMobile ? (
        <div data-testid="cards">{body}</div>
      ) : (
        <table data-testid="cards">{body}</table>
      )}
    </I18nextProvider>,
  ).getByTestId("cards");
};

const PHONE_COLUMNS: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
  { title: "Phone Number", type: FieldType.Phone, key: "phone" },
];

// The phone column's <td>: the row's second cell.
const phoneCellOf: (table: HTMLElement) => HTMLElement = (
  table: HTMLElement,
): HTMLElement => {
  const cells: Array<HTMLElement> = Array.from(table.querySelectorAll("td"));
  const cell: HTMLElement | undefined = cells.find(
    (candidate: HTMLElement): boolean => {
      return !(candidate.textContent || "").includes("Primary line");
    },
  );

  if (!cell) {
    throw new Error("The row has no phone cell");
  }

  return cell;
};

// Each isolate an element draws: "<its dir> <its text>".
const isolatesOf: (element: HTMLElement) => Array<string> = (
  element: HTMLElement,
): Array<string> => {
  return Array.from(element.querySelectorAll("bdi")).map(
    (isolate: HTMLElement): string => {
      return `${isolate.getAttribute("dir")} ${isolate.textContent}`;
    },
  );
};

describe.each(["fa", "ar"])(
  "a phone column on a %s page",
  (language: string) => {
    test("its number is an isolate that reads left to right: +447700900123, not 447700900123+", () => {
      const table: HTMLElement = drawRow({ language, phone: new Phone(UK) });
      const cell: HTMLElement = phoneCellOf(table);

      expect(isolatesOf(cell)).toEqual([`ltr ${UK}`]);
      expect(cell).toHaveTextContent(UK);
    });

    test("its cell's line reads left to right, lined up with the column as the page's lines are", () => {
      const table: HTMLElement = drawRow({ language, phone: new Phone(UK) });
      const box: HTMLElement = phoneCellOf(table)
        .firstElementChild as HTMLElement;

      /*
       * Cut short in a narrow column, the number keeps its "+44" and loses
       * its last digits ("+4477009..."), where a line read from the right
       * cut its start away.
       */
      expect(box).toHaveAttribute("dir", "ltr");
      expect(box).toHaveClass("overflow-x-clip", "text-ellipsis");
      expect(box).toHaveClass(
        LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
      );
      expect(box).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    });

    test("the row's other cells are drawn as they always were", () => {
      const table: HTMLElement = drawRow({ language, phone: new Phone(UK) });
      const nameCell: HTMLElement = screen
        .getByText("Primary line")
        .closest("td") as HTMLElement;

      expect(table).toContainElement(nameCell);
      // An English name on this page reads its own way, as before.
      expect(nameCell.firstElementChild).toHaveAttribute("dir", "ltr");
      expect(nameCell.querySelectorAll("bdi")).toHaveLength(1);
    });

    test("a number stored as text, or as the JSON of a Phone, is drawn the same way", () => {
      const fromText: HTMLElement = drawRow({ language, phone: UK });

      expect(isolatesOf(phoneCellOf(fromText))).toEqual([`ltr ${UK}`]);
      cleanup();

      const fromJson: HTMLElement = drawRow({
        language,
        phone: { _type: ObjectType.Phone, value: SG } as unknown as Phone,
      });

      expect(isolatesOf(phoneCellOf(fromJson))).toEqual([`ltr ${SG}`]);
      // Printed as text, the JSON of a Phone read "[object Object]".
      expect(phoneCellOf(fromJson)).not.toHaveTextContent("[object Object]");
    });

    test("a list of numbers typed as one value: each number its own isolate, separated by the Arabic comma", () => {
      const table: HTMLElement = drawRow({ language, phone: `${SG}, ${UK}` });
      const cell: HTMLElement = phoneCellOf(table);

      expect(isolatesOf(cell)).toEqual([`ltr ${SG}`, `ltr ${UK}`]);
      expect(cell.textContent).toBe(`${SG}، ${UK}`);
    });

    test("no number is the quiet dash, in a cell that reads the page's way", () => {
      const table: HTMLElement = drawRow({ language, phone: undefined });
      const cell: HTMLElement = phoneCellOf(table);

      expect(cell.querySelector("bdi")).toBeNull();
      expect(
        cell.querySelector(`[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`),
      ).not.toBeNull();
      expect(cell.firstElementChild).not.toHaveAttribute("dir");
    });

    test("no number is the column's own words, where it has them", () => {
      const table: HTMLElement = drawRow({
        language,
        phone: "",
        columns: [
          { title: "Name", type: FieldType.Text, key: "name" },
          {
            title: "Phone Number",
            type: FieldType.Phone,
            key: "phone",
            noValueMessage: "No number yet",
          },
        ],
      });
      const cell: HTMLElement = phoneCellOf(table);

      expect(cell).toHaveTextContent("No number yet");
      expect(cell.querySelector("bdi")).toBeNull();
    });

    test("a phone column that draws its own element decides its own line", () => {
      const table: HTMLElement = drawRow({
        language,
        phone: new Phone(UK),
        columns: [
          { title: "Name", type: FieldType.Text, key: "name" },
          {
            title: "Phone Number",
            type: FieldType.Phone,
            key: "phone",
            getElement: (): ReactElement => {
              return <span data-testid="own-element">Twilio: {UK}</span>;
            },
          },
        ],
      });
      const cell: HTMLElement = phoneCellOf(table);

      expect(screen.getByTestId("own-element")).toBeVisible();
      expect(cell.querySelector("bdi")).toBeNull();
      // An icon or a word beside the number: the page's line, not the number's.
      expect(cell.firstElementChild).not.toHaveAttribute("dir");
    });

    test("on a phone's card the number reads left to right too", () => {
      const cards: HTMLElement = drawRow({
        language,
        phone: new Phone(UK),
        isMobile: true,
      });
      const value: HTMLElement = screen
        .getByText(UK)
        .closest("dd") as HTMLElement;

      expect(cards).toContainElement(value);
      expect(isolatesOf(value)).toEqual([`ltr ${UK}`]);
      expect(value).toHaveAttribute("dir", "ltr");
    });
  },
);

describe("a phone column on an English page", () => {
  test("its number is still an isolate that reads left to right, in a cell drawn as before", () => {
    const table: HTMLElement = drawRow({
      language: "en",
      phone: new Phone(UK),
    });
    const cell: HTMLElement = phoneCellOf(table);

    expect(isolatesOf(cell)).toEqual([`ltr ${UK}`]);
    expect(cell).toHaveTextContent(UK);
    // The page reads left to right already: the cell is given no way of its own.
    expect(cell.firstElementChild).not.toHaveAttribute("dir");
    expect(cell.firstElementChild).toHaveClass("overflow-x-clip");
  });

  test("a list reads as it was typed, separated by commas", () => {
    const table: HTMLElement = drawRow({
      language: "en",
      phone: `${SG}, ${UK}`,
    });

    expect(phoneCellOf(table).textContent).toBe(`${SG}, ${UK}`);
    expect(isolatesOf(phoneCellOf(table))).toEqual([`ltr ${SG}`, `ltr ${UK}`]);
  });

  test("a name in a number's place in Persian reads its own way", () => {
    const table: HTMLElement = drawRow({
      language: "en",
      phone: "خط پشتیبانی",
    });

    expect(isolatesOf(phoneCellOf(table))).toEqual(["rtl خط پشتیبانی"]);
    expect(phoneCellOf(table).firstElementChild).toHaveAttribute("dir", "rtl");
  });
});
