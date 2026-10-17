import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import TableEmptyValue, {
  DASH_PLACEHOLDERS,
  TABLE_EMPTY_VALUE_CLASS_NAME,
  TABLE_EMPTY_VALUE_TEST_ID,
  isDashPlaceholder,
} from "../../../../UI/Components/Table/TableEmptyValue";
import { EMPTY_VALUE_MARK } from "../../../../UI/Components/Detail/EmptyValue";

/*
 * What a table's cell shows for a value that is not there: a quiet dash,
 * the column's words kept for a screen reader (Common/UI/Components/Table/
 * TableEmptyValue.tsx) - where every row of the Incidents list said "No
 * labels attached." and "No owners.".
 */

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

describe("the dash", () => {
  test("is the detail card's mark, hidden from a screen reader, which hears 'Not set'", () => {
    render(<TableEmptyValue />);

    const value: HTMLElement = screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID);
    const [mark, words] = Array.from(value.children) as Array<HTMLElement>;

    expect(mark).toHaveTextContent(EMPTY_VALUE_MARK);
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(words).toHaveClass("sr-only");
    expect(words).toHaveTextContent("Not set");
  });

  test("says the column's own words to a screen reader when it has some", () => {
    render(<TableEmptyValue screenReaderText="No labels attached." />);

    expect(
      screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID).querySelector(".sr-only"),
    ).toHaveTextContent("No labels attached.");
  });

  test("blank words fall back to 'Not set'", () => {
    render(<TableEmptyValue screenReaderText="   " />);

    expect(
      screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID).querySelector(".sr-only"),
    ).toHaveTextContent("Not set");
  });

  test("in quiet grey, on the row's 24px line", () => {
    render(<TableEmptyValue />);

    expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID).className).toBe(
      TABLE_EMPTY_VALUE_CLASS_NAME,
    );
    expect(TABLE_EMPTY_VALUE_CLASS_NAME.split(" ")).toEqual([
      "text-sm",
      "leading-6",
      "text-gray-400",
    ]);
  });

  test("the words are the reader's language", () => {
    const notSet: string = GERMAN_FILE["Not set"] as string;
    const noOwners: string = GERMAN_FILE["No owners."] as string;

    expect(notSet).toBeTruthy();
    expect(notSet).not.toBe("Not set");
    expect(noOwners).toBeTruthy();
    expect(noOwners).not.toBe("No owners.");

    render(
      <I18nextProvider i18n={german}>
        <TableEmptyValue />
        <TableEmptyValue screenReaderText="No owners." />
      </I18nextProvider>,
    );

    const words: Array<string> = screen
      .getAllByTestId(TABLE_EMPTY_VALUE_TEST_ID)
      .map((value: HTMLElement): string => {
        return value.querySelector(".sr-only")?.textContent || "";
      });

    expect(words).toEqual([notSet, noOwners]);
  });
});

describe("a column's own dash is the table's dash", () => {
  const PLACEHOLDERS: Array<[string, React.ReactNode]> = [
    ["a hyphen in a fragment", <>-</>],
    ["a hyphen in a paragraph", <p>-</p>],
    ["a hyphen in a span", <span>-</span>],
    ["an em dash in a fragment", <>{"—"}</>],
    ["an en dash in a span", <span>{"–"}</span>],
    ["a hyphen string", "-"],
    ["an em dash string with spaces", " — "],
  ];

  test.each(PLACEHOLDERS)("%s", (_label: string, node: React.ReactNode) => {
    expect(isDashPlaceholder(node)).toBe(true);
  });

  const VALUES: Array<[string, React.ReactNode]> = [
    [
      "a styled dash, kept as the page drew it",
      <span className="text-gray-400">-</span>,
    ],
    ["a number", <span>0</span>],
    ["a word", <>None</>],
    ["a negative number", <span>-1</span>],
    ["a dash inside something else", <div>-</div>],
    [
      "a dash with another element",
      <span>
        <b>-</b>
      </span>,
    ],
    ["nothing", null],
    ["an empty string", ""],
  ];

  test.each(VALUES)("not %s", (_label: string, node: React.ReactNode) => {
    expect(isDashPlaceholder(node)).toBe(false);
  });

  test("the marks it knows", () => {
    expect([...DASH_PLACEHOLDERS]).toEqual(["-", "–", "—"]);
  });

  test("an element of a column of its own that draws a dash", () => {
    const element: ReactElement = <>-</>;

    expect(isDashPlaceholder(element)).toBe(true);
  });
});
