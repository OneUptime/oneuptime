import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import TelemetrySearchHelp, {
  TELEMETRY_SEARCH_HELP_DESCRIPTION_CELL_CLASS_NAME,
  TELEMETRY_SEARCH_HELP_EXAMPLE_CELL_CLASS_NAME,
  TELEMETRY_SEARCH_HELP_ROW_CLASS_NAME,
  TELEMETRY_SEARCH_HELP_SYNTAX_CELL_CLASS_NAME,
  TELEMETRY_SEARCH_HELP_WIDTH_CLASS_NAME,
} from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchHelp";
import { SearchHelpRow } from "../../../UI/Components/TelemetryViewer/types";
import {
  LAYERED_POPOVER_CLASS_NAME,
  LayeredPopoverAlignment,
} from "../../../UI/Components/Tooltip/LayeredPopover";

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

// A search box the panel hangs from, as the explorers and the session list draw theirs.
function SearchWithHelp(props: {
  align?: LayeredPopoverAlignment | undefined;
  onExampleClick?: ((example: string) => void) | undefined;
}): React.ReactElement {
  const searchRef: React.RefObject<HTMLDivElement> =
    React.useRef<HTMLDivElement>(null);

  return (
    <div data-testid="card" style={{ overflow: "hidden" }}>
      <div ref={searchRef} data-testid="search">
        <input aria-label="Search" />
      </div>
      <TelemetrySearchHelp
        anchorRef={searchRef}
        id="search-help"
        rows={ROWS}
        combinedExample="user:jane@example.com url:/checkout"
        align={props.align}
        onExampleClick={props.onExampleClick}
        dataTestId="help"
      />
    </div>
  );
}

function renderHelp(
  align?: LayeredPopoverAlignment,
  onExampleClick?: (example: string) => void,
): HTMLElement {
  render(<SearchWithHelp align={align} onExampleClick={onExampleClick} />);

  return screen.getByTestId("help");
}

function layerOf(help: HTMLElement): HTMLElement {
  const layer: HTMLElement | null = help.closest<HTMLElement>(
    `.${LAYERED_POPOVER_CLASS_NAME}`,
  );

  expect(layer).not.toBeNull();

  return layer!;
}

describe("TelemetrySearchHelp placement", () => {
  it("is drawn on the tooltip layer, never inside the card its search sits in (#9909)", () => {
    const help: HTMLElement = renderHelp();

    expect(screen.getByTestId("card")).not.toContainElement(help);
    expect(layerOf(help).parentElement).toBe(document.body);
    expect(help).toHaveAttribute("id", "search-help");
    // No place of its own: the layer places it against the search.
    expect(help).not.toHaveClass("absolute", "left-0", "right-0", "top-full");
  });

  it("hangs from the search's start by default", () => {
    const help: HTMLElement = renderHelp();

    expect(layerOf(help)).toHaveAttribute(
      "data-popper-placement",
      "bottom-start",
    );
  });

  it("hangs from its end in a table's header", () => {
    const help: HTMLElement = renderHelp("end");

    expect(layerOf(help)).toHaveAttribute(
      "data-popper-placement",
      "bottom-end",
    );
  });

  it("on a page read right to left, its start is the search's right edge", () => {
    document.documentElement.setAttribute("dir", "rtl");

    try {
      const help: HTMLElement = renderHelp();

      // The line starts at the right: Popper's "end" is the right edge.
      expect(layerOf(help)).toHaveAttribute(
        "data-popper-placement",
        "bottom-end",
      );
    } finally {
      document.documentElement.removeAttribute("dir");
    }
  });

  it("is 36rem wide from md up, never wider than the window, and as wide as its search below md", () => {
    const help: HTMLElement = renderHelp();

    expect(help).toHaveClass(
      ...classesOf(TELEMETRY_SEARCH_HELP_WIDTH_CLASS_NAME),
    );
    expect(classesOf(TELEMETRY_SEARCH_HELP_WIDTH_CLASS_NAME)).toEqual([
      "w-[36rem]",
      "max-w-[calc(100vw-1rem)]",
      "max-md:w-[var(--layered-popover-anchor-width)]",
    ]);
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

    const help: HTMLElement = renderHelp("end");

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
    const help: HTMLElement = renderHelp("end", onExampleClick);

    fireEvent.mouseDown(within(help).getAllByRole("row")[1]!);

    expect(onExampleClick).toHaveBeenCalledTimes(1);
    expect(onExampleClick).toHaveBeenCalledWith("url:/checkout");
  });
});
