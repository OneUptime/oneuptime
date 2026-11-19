import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import CSVFileUpload, {
  CSV_FILE_UPLOAD_AREA_TEST_ID,
  CSV_FILE_UPLOAD_ERROR_TEST_ID,
  CSVColumn,
  CSVRow,
  isCsvFile,
} from "../../../../UI/Components/CSVFileUpload/CSVFileUpload";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * The upload area said "Click to upload CSV or drag and drop", and took no
 * drop: the browser opened the file instead (#9224). A file dropped on it is
 * now read as a chosen one is, the area lights up while one is dragged over
 * it, and anything but one .csv file is refused, said out loud. A click and
 * the keyboard still open the chooser.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const COLUMNS: Array<CSVColumn> = [
  { key: "name", title: "Name", required: true },
  { key: "email", title: "Email", required: false },
];

const CSV: string =
  "Name,Email\nAda,ada@example.com\nGrace,grace@example.com\n";

afterEach(() => {
  cleanup();
});

function csvFile(name: string = "people.csv", text: string = CSV): File {
  return new File([text], name, { type: "text/csv" });
}

function renderUpload(): MockFunction {
  const onDataChanged: MockFunction = getJestMockFunction();
  render(
    <CSVFileUpload
      columns={COLUMNS}
      onDataChanged={onDataChanged as unknown as (d: Array<CSVRow>) => void}
    />,
  );
  return onDataChanged;
}

function area(): HTMLElement {
  return screen.getByTestId(CSV_FILE_UPLOAD_AREA_TEST_ID);
}

// A drag event carrying files, as a file dragged in from the desktop is.
function dragEvent(
  type: "dragEnter" | "dragOver" | "dragLeave" | "drop",
  files: Array<File>,
  element: HTMLElement = area(),
): Event {
  const event: Event = createEvent[type](element);
  Object.defineProperty(event, "dataTransfer", {
    value: { types: ["Files"], files: files, dropEffect: "none" },
  });
  return event;
}

describe("isCsvFile", () => {
  test.each([
    ["people.csv", true],
    ["PEOPLE.CSV", true],
    ["people.xlsx", false],
    ["people.csv.txt", false],
    ["people", false],
  ])("%s: %s", (name: string, isCsv: boolean) => {
    expect(isCsvFile(csvFile(name))).toBe(isCsv);
  });
});

describe("dropping a file on the upload area", () => {
  test("a dropped CSV is read as a chosen one is", async () => {
    const onDataChanged: MockFunction = renderUpload();

    const drop: Event = dragEvent("drop", [csvFile()]);
    fireEvent(area(), drop);

    // Taken from the browser, which would otherwise open the file.
    expect(drop.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(onDataChanged).toHaveBeenCalledTimes(1);
    });
    expect(onDataChanged).toHaveBeenCalledWith([
      { name: "Ada", email: "ada@example.com" },
      { name: "Grace", email: "grace@example.com" },
    ]);
    /*
     * The rows are handed on in the same callback that sets them, and React
     * draws them after it returns: the sentence is waited for, not read in
     * the instant the callback was seen.
     */
    expect(
      await screen.findByText("people.csv - 2 rows ready to import"),
    ).toBeInTheDocument();
  });

  test("a file dragged over lights the area and says to drop it, and leaving puts it back", () => {
    renderUpload();

    const over: Event = dragEvent("dragOver", [csvFile()]);
    fireEvent(area(), dragEvent("dragEnter", [csvFile()]));
    fireEvent(area(), over);

    expect(over.defaultPrevented).toBe(true);
    expect(area()).toHaveAttribute("data-dragging", "true");
    expect(area()).toHaveClass("border-indigo-500", "bg-indigo-50");
    expect(area()).toHaveTextContent("Drop the CSV file to upload it");

    // Moving onto the words inside the area keeps it lit.
    const words: HTMLElement = screen.getByText(
      "Drop the CSV file to upload it",
    );
    fireEvent(area(), dragEvent("dragEnter", [], words));
    fireEvent(area(), dragEvent("dragLeave", [], words));
    expect(area()).toHaveAttribute("data-dragging", "true");

    fireEvent(area(), dragEvent("dragLeave", [csvFile()]));
    expect(area()).not.toHaveAttribute("data-dragging");
    expect(area()).toHaveTextContent("Click to upload CSV or drag and drop");
  });

  test("a file that is not a CSV is refused, by name, out loud", () => {
    const onDataChanged: MockFunction = renderUpload();

    fireEvent(area(), dragEvent("drop", [csvFile("report.xlsx")]));

    expect(screen.getByTestId(CSV_FILE_UPLOAD_ERROR_TEST_ID)).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "report.xlsx is not a CSV file. Choose or drop a file that ends in .csv.",
    );
    expect(onDataChanged).not.toHaveBeenCalled();
    expect(area()).not.toHaveAttribute("data-dragging");
  });

  test("two files at once are refused: one at a time", () => {
    const onDataChanged: MockFunction = renderUpload();

    fireEvent(area(), dragEvent("drop", [csvFile("a.csv"), csvFile("b.csv")]));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Drop one CSV file at a time.",
    );
    expect(onDataChanged).not.toHaveBeenCalled();
  });

  test("text dragged off the page is left to the browser", () => {
    renderUpload();

    const over: Event = createEvent.dragOver(area());
    Object.defineProperty(over, "dataTransfer", {
      value: { types: ["text/plain"], files: [] },
    });
    fireEvent(area(), over);

    expect(over.defaultPrevented).toBe(false);
    expect(area()).not.toHaveAttribute("data-dragging");
  });
});

describe("choosing a file still works", () => {
  test("Tab reaches the area's file input, and a chosen CSV is read", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const onDataChanged: MockFunction = renderUpload();

    // The template button first, then the area's input.
    await user.tab();
    await user.tab();
    const input: HTMLInputElement = area().querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("accept", ".csv");

    await user.upload(input, csvFile());
    await waitFor(() => {
      expect(onDataChanged).toHaveBeenCalledTimes(1);
    });
  });

  test("a chosen file that is not a CSV is refused the same way", () => {
    renderUpload();
    const input: HTMLInputElement = area().querySelector(
      "input[type=file]",
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [csvFile("notes.txt")] } });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "notes.txt is not a CSV file.",
    );
  });
});
