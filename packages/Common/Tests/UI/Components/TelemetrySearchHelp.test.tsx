import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import TelemetrySearchHelp, {
  TELEMETRY_SEARCH_HELP_DESCRIPTION_CELL_CLASS_NAME,
  TELEMETRY_SEARCH_HELP_EXAMPLE_CELL_CLASS_NAME,
  TELEMETRY_SEARCH_HELP_PLACEMENT_CLASS_NAMES,
  TELEMETRY_SEARCH_HELP_ROW_CLASS_NAME,
  TELEMETRY_SEARCH_HELP_SYNTAX_CELL_CLASS_NAME,
} from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchHelp";
import { SearchHelpRow } from "../../../UI/Components/TelemetryViewer/types";

/*
 * The search syntax panel an explorer's search and the session list's
 * search drop down while they are empty.
 *
 * On a phone it used to hang 36rem wide from one edge of its search: from
 * the session list's header search (right-aligned) it ran past the left edge
 * of a 390px screen, and its three columns squeezed what each token does to
 * a word or two a line. Below md it is now exactly as wide as its search,
 * and below sm each row puts the token and its example on one line and what
 * the token does under both. From sm up nothing changed.
 */

const ROWS: Array<SearchHelpRow> = [
  {
    syntax: "user:<reference>",
    description: "Every session of one signed-in user",
    example: "user:jane@example.com",
  },
  {
    syntax: "url:<path>",
    description: "Visited a page whose address starts with this",
    example: "url:/checkout",
  },
];

function classesOf(className: string): Array<string> {
  return className.split(" ").filter((name: string): boolean => {
    return name.length > 0;
  });
}

function renderHelp(
  align?: "left" | "right",
  onExampleClick?: (example: string) => void,
): HTMLElement {
  render(
    <TelemetrySearchHelp
      rows={ROWS}
      combinedExample="user:jane@example.com url:/checkout"
      align={align}
      onExampleClick={onExampleClick}
      dataTestId="help"
    />,
  );

  return screen.getByTestId("help");
}

describe("TelemetrySearchHelp placement", () => {
  it("hangs from the search's left edge by default, as wide as its search below md", () => {
    const help: HTMLElement = renderHelp();

    expect(help).toHaveClass(
      ...classesOf(TELEMETRY_SEARCH_HELP_PLACEMENT_CLASS_NAMES.left),
    );
    expect(help).toHaveClass("left-0", "w-[36rem]");
    expect(help).toHaveClass("max-md:right-0", "max-md:w-auto");
    expect(help).not.toHaveClass("right-0");
  });

  it("hangs from the right edge in a table's header, as wide as its search below md", () => {
    const help: HTMLElement = renderHelp("right");

    expect(help).toHaveClass(
      ...classesOf(TELEMETRY_SEARCH_HELP_PLACEMENT_CLASS_NAMES.right),
    );
    expect(help).toHaveClass("right-0", "w-[36rem]");
    /* Never wider than the screen from md up. */
    expect(help).toHaveClass("max-w-[calc(100vw-2rem)]");
    /* Below md: from edge to edge of the search, with no cap of its own. */
    expect(help).toHaveClass(
      "max-md:left-0",
      "max-md:w-auto",
      "max-md:max-w-none",
    );
    expect(help).not.toHaveClass("left-0");
  });

  it("keeps its 36rem width only from md up in both placements", () => {
    for (const className of Object.values(
      TELEMETRY_SEARCH_HELP_PLACEMENT_CLASS_NAMES,
    )) {
      expect(classesOf(className)).toEqual(
        expect.arrayContaining(["w-[36rem]", "max-md:w-auto"]),
      );
    }
  });
});

describe("TelemetrySearchHelp rows", () => {
  it("is a table of token, what it does and an example from sm up", () => {
    const help: HTMLElement = renderHelp();
    const rows: Array<HTMLElement> = within(help).getAllByRole("row");

    expect(rows).toHaveLength(ROWS.length);

    rows.forEach((row: HTMLElement, index: number): void => {
      const cells: Array<HTMLElement> = within(row).getAllByRole("cell");

      expect(
        cells.map((cell: HTMLElement): string | null => {
          return cell.textContent;
        }),
      ).toEqual([
        ROWS[index]!.syntax,
        ROWS[index]!.description,
        ROWS[index]!.example,
      ]);
      expect(row).toHaveClass(
        ...classesOf(TELEMETRY_SEARCH_HELP_ROW_CLASS_NAME),
      );
      expect(cells[0]).toHaveClass(
        ...classesOf(TELEMETRY_SEARCH_HELP_SYNTAX_CELL_CLASS_NAME),
      );
      expect(cells[1]).toHaveClass(
        ...classesOf(TELEMETRY_SEARCH_HELP_DESCRIPTION_CELL_CLASS_NAME),
      );
      expect(cells[2]).toHaveClass(
        ...classesOf(TELEMETRY_SEARCH_HELP_EXAMPLE_CELL_CLASS_NAME),
      );
    });

    /* From sm up the table lays itself out as a table. */
    expect(within(help).getByRole("table")).toHaveClass("w-full");
  });

  it("below sm puts the token and its example on one line and what it does under both", () => {
    const row: Array<string> = classesOf(TELEMETRY_SEARCH_HELP_ROW_CLASS_NAME);

    expect(row).toEqual(
      expect.arrayContaining([
        "max-sm:grid",
        "max-sm:grid-cols-[auto_minmax(0,1fr)]",
      ]),
    );
    expect(
      classesOf(TELEMETRY_SEARCH_HELP_DESCRIPTION_CELL_CLASS_NAME),
    ).toEqual(
      expect.arrayContaining(["max-sm:col-span-2", "max-sm:row-start-2"]),
    );
    expect(classesOf(TELEMETRY_SEARCH_HELP_EXAMPLE_CELL_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "max-sm:col-start-2",
        "max-sm:row-start-1",
        "max-sm:min-w-0",
        "max-sm:truncate",
      ]),
    );
    /* The token keeps to one line; the example gives way to it. */
    expect(classesOf(TELEMETRY_SEARCH_HELP_SYNTAX_CELL_CLASS_NAME)).toContain(
      "whitespace-nowrap",
    );

    const help: HTMLElement = renderHelp("right");

    expect(within(help).getByRole("table")).toHaveClass("max-sm:block");
    expect(help.querySelector("tbody")).toHaveClass("max-sm:block");
  });

  it("never leaves one word of what a token does on a line of its own", () => {
    expect(
      classesOf(TELEMETRY_SEARCH_HELP_DESCRIPTION_CELL_CLASS_NAME),
    ).toContain("text-pretty");
  });

  it("runs what a token does onto a second line 16px under the first, its text's own line", () => {
    /*
     * The cell is 12px text (text-xs, a 16px line), not just its words: on
     * the cell's inherited 24px line, a description that wrapped left a gap
     * under its first line as tall as the text.
     */
    expect(
      classesOf(TELEMETRY_SEARCH_HELP_DESCRIPTION_CELL_CLASS_NAME),
    ).toContain("text-xs");
  });

  it("still puts a row's example in the search when it is pressed", () => {
    const onExampleClick: MockFunction = getJestMockFunction();
    const help: HTMLElement = renderHelp("right", onExampleClick);

    fireEvent.mouseDown(within(help).getAllByRole("row")[1]!);

    expect(onExampleClick).toHaveBeenCalledTimes(1);
    expect(onExampleClick).toHaveBeenCalledWith("url:/checkout");
  });
});
