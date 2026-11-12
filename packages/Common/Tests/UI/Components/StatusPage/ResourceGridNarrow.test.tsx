import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import ResourceGrid from "../../../../UI/Components/StatusPage/ResourceGrid";
import {
  RESOURCE_GRID_BODY_CLASS_NAME,
  RESOURCE_GRID_CELL_CLASS_NAME,
  RESOURCE_GRID_CELL_LABEL_CLASS_NAME,
  RESOURCE_GRID_CHIP_ACTIONS_CLASS_NAME,
  RESOURCE_GRID_CLASS_NAME,
  RESOURCE_GRID_HEAD_CLASS_NAME,
  RESOURCE_GRID_ROW_CLASS_NAME,
  RESOURCE_GRID_ROW_HEADING_CLASS_NAME,
  RESOURCE_GRID_STACK_VARIANT,
  RESOURCE_GRID_TABLE_CLASS_NAME,
} from "../../../../UI/Components/StatusPage/ResourceGridLayout";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";

/*
 * STATUS PAGE > RESOURCES' GRID ON A PHONE, OR BESIDE A SIDE MENU (#7087).
 *
 * A three-column grid was 694px wide in the 316px a phone's Resources card
 * leaves it, so it scrolled 378px sideways, and each chip's name had 56px
 * beside the room its hidden Edit and ⋯ keep. Below 30rem of its own width
 * (a container query on the grid's box) the same table is now drawn as a
 * stack - each row a box headed by its value, each cell under its column's
 * name - and on a device with no hover a chip's buttons are drawn, as a
 * list's row draws them.
 *
 * jsdom applies no Tailwind and measures nothing: these read the classes
 * that draw the stack, that the matrix keeps its classes, and that the
 * buttons are reached by keyboard in the order they are drawn in either
 * layout (the stack moves no element: it is the same table, styled). The
 * layout itself was measured in Chromium at 390, 768, 1100 and 1280 pixels
 * (see the pull request).
 */

jest.setTimeout(30000);

afterEach(() => {
  cleanup();
});

const COLUMNS: Array<string> = ["API", "Web app", "Background workers"];
const ROWS: Array<string> = ["EU West", "US East"];

const makeResource: (data: {
  id: string;
  name: string;
  rowAxisValue: string;
  columnAxisValue: string;
}) => StatusPageResource = (data: {
  id: string;
  name: string;
  rowAxisValue: string;
  columnAxisValue: string;
}): StatusPageResource => {
  const monitor: Monitor = new Monitor();
  monitor._id = `monitor-${data.id}`;
  monitor.name = data.name;

  const resource: StatusPageResource = new StatusPageResource();
  resource._id = data.id;
  resource.monitor = monitor;
  resource.rowAxisValue = data.rowAxisValue;
  resource.columnAxisValue = data.columnAxisValue;

  return resource;
};

const LONG_NAME: string =
  "oneuptime-test - High Node Memory Utilization on AllNodesInEuWest1";

const ON_THE_GRID: StatusPageResource = makeResource({
  id: "resource-memory",
  name: LONG_NAME,
  rowAxisValue: "EU West",
  columnAxisValue: "API",
});
const BESIDE_IT: StatusPageResource = makeResource({
  id: "resource-webhook",
  name: "Payments webhook receiver",
  rowAxisValue: "EU West",
  columnAxisValue: "Web app",
});
const STRANDED: StatusPageResource = makeResource({
  id: "resource-stranded",
  name: "Legacy billing reconciler",
  rowAxisValue: "europe-west1-legacy-datacenter",
  columnAxisValue: "API",
});

type ResourceCallback = (statusPageResource: StatusPageResource) => void;

const renderGrid: (callbacks?: {
  onEdit?: ResourceCallback;
  onToggle?: ResourceCallback;
}) => void = (
  callbacks: { onEdit?: ResourceCallback; onToggle?: ResourceCallback } = {},
): void => {
  render(
    <ResourceGrid
      rowLabel="Region"
      columnLabel="Service"
      rowValues={ROWS}
      columnValues={COLUMNS}
      statusPageResources={[ON_THE_GRID, BESIDE_IT, STRANDED]}
      getResourceElement={(
        statusPageResource: StatusPageResource,
      ): ReactElement => {
        // A link, as the Dashboard's StatusPageResourceName draws one.
        return (
          <a href={`/monitors/${statusPageResource.monitor?._id}`}>
            {statusPageResource.monitor?.name}
          </a>
        );
      }}
      isCreateable={true}
      isEditable={true}
      isDeleteable={true}
      isSelectable={true}
      selectedResourceIds={new Set<string>()}
      onToggleResourceSelected={callbacks.onToggle || ((): void => {})}
      onAddToCell={() => {}}
      onEdit={callbacks.onEdit || ((): void => {})}
      onDelete={() => {}}
      onShowId={() => {}}
    />,
  );
};

const grid: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("status-page-resource-grid");
};

const chipOf: (name: string) => HTMLElement = (name: string): HTMLElement => {
  const chip: HTMLElement | undefined = screen
    .getAllByTestId("status-page-resource-grid-cell-item")
    .find((each: HTMLElement): boolean => {
      return (each.textContent || "").includes(name);
    });

  if (!chip) {
    throw new Error(`No chip named ${name}`);
  }

  return chip;
};

/*
 * An element's children with this tag. (jsdom's selector engine cannot read
 * ":scope >" beside these class names, so the children are walked.)
 */
const childrenTagged: (
  parent: Element,
  tagName: string,
) => Array<HTMLElement> = (
  parent: Element,
  tagName: string,
): Array<HTMLElement> => {
  return Array.from(parent.children).filter((child: Element): boolean => {
    return child.tagName === tagName;
  }) as Array<HTMLElement>;
};

// A class's tokens, split at its spaces.
const tokensOf: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return className.split(" ").filter(Boolean);
};

// What a class draws outside the stack: its tokens not under the query.
const matrixClassOf: (className: string) => string = (
  className: string,
): string => {
  return tokensOf(className)
    .filter((token: string): boolean => {
      return !token.startsWith(RESOURCE_GRID_STACK_VARIANT);
    })
    .join(" ");
};

// What a class adds in the stack: its tokens under the query, unprefixed.
const stackClassOf: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return tokensOf(className)
    .filter((token: string): boolean => {
      return token.startsWith(RESOURCE_GRID_STACK_VARIANT);
    })
    .map((token: string): string => {
      return token.slice(RESOURCE_GRID_STACK_VARIANT.length);
    });
};

const STACK_CLASS_NAMES: Record<string, string> = {
  table: RESOURCE_GRID_TABLE_CLASS_NAME,
  head: RESOURCE_GRID_HEAD_CLASS_NAME,
  body: RESOURCE_GRID_BODY_CLASS_NAME,
  row: RESOURCE_GRID_ROW_CLASS_NAME,
  rowHeading: RESOURCE_GRID_ROW_HEADING_CLASS_NAME,
  cell: RESOURCE_GRID_CELL_CLASS_NAME,
  cellLabel: RESOURCE_GRID_CELL_LABEL_CLASS_NAME,
};

describe("ResourceGrid below 30rem of its own width: a stack (#7087)", () => {
  test("the grid's box is what the query measures, whatever the window", () => {
    renderGrid();

    expect(RESOURCE_GRID_STACK_VARIANT).toBe("[@container(max-width:30rem)]:");
    expect(grid().className).toBe(RESOURCE_GRID_CLASS_NAME);
    expect(grid()).toHaveClass("[container-type:inline-size]");
  });

  test("the table, its head and body, each row, its heading and each cell carry the stack's classes", () => {
    renderGrid();

    const table: HTMLElement = within(grid()).getByRole("table");
    const head: HTMLElement = table.querySelector("thead") as HTMLElement;
    const body: HTMLElement = table.querySelector("tbody") as HTMLElement;
    const rows: Array<HTMLElement> = childrenTagged(body, "TR");

    expect(table.className).toBe(RESOURCE_GRID_TABLE_CLASS_NAME);
    expect(head.className).toBe(RESOURCE_GRID_HEAD_CLASS_NAME);
    expect(body.className).toBe(RESOURCE_GRID_BODY_CLASS_NAME);
    expect(rows).toHaveLength(ROWS.length);

    rows.forEach((row: HTMLElement, index: number) => {
      const heading: HTMLElement = row.firstElementChild as HTMLElement;
      const cells: Array<HTMLElement> = childrenTagged(row, "TD");

      expect(row.className).toBe(RESOURCE_GRID_ROW_CLASS_NAME);
      expect(heading.tagName).toBe("TH");
      expect(heading.className).toBe(RESOURCE_GRID_ROW_HEADING_CLASS_NAME);
      expect(heading).toHaveTextContent(ROWS[index]!);
      expect(cells).toHaveLength(COLUMNS.length);

      for (const cell of cells) {
        expect(cell.className).toBe(RESOURCE_GRID_CELL_CLASS_NAME);
      }
    });
  });

  test("in the stack: each row a box of its own, its heading a line over its cells, each cell a line of the box, and no column headings", () => {
    expect(stackClassOf(RESOURCE_GRID_TABLE_CLASS_NAME)).toEqual(["block"]);
    expect(stackClassOf(RESOURCE_GRID_HEAD_CLASS_NAME)).toEqual(["hidden"]);
    expect(stackClassOf(RESOURCE_GRID_BODY_CLASS_NAME)).toEqual([
      "flex",
      "flex-col",
      "gap-3",
    ]);
    expect(stackClassOf(RESOURCE_GRID_ROW_CLASS_NAME)).toEqual([
      "block",
      "rounded-lg",
      "border",
    ]);
    // Held at the start of a matrix that scrolls; a heading in the stack.
    expect(stackClassOf(RESOURCE_GRID_ROW_HEADING_CLASS_NAME)).toEqual([
      "static",
      "block",
      "rounded-t-lg",
      "border-r-0",
      "py-2",
    ]);
    expect(stackClassOf(RESOURCE_GRID_CELL_CLASS_NAME)).toEqual([
      "block",
      "last:border-b-0",
    ]);
    expect(stackClassOf(RESOURCE_GRID_CELL_LABEL_CLASS_NAME)).toEqual([
      "block",
    ]);
  });

  test("from 30rem up the matrix keeps the classes it had", () => {
    expect(matrixClassOf(RESOURCE_GRID_TABLE_CLASS_NAME)).toBe(
      "min-w-full border-separate border-spacing-0",
    );
    expect(matrixClassOf(RESOURCE_GRID_HEAD_CLASS_NAME)).toBe("");
    expect(matrixClassOf(RESOURCE_GRID_BODY_CLASS_NAME)).toBe("");
    expect(matrixClassOf(RESOURCE_GRID_ROW_HEADING_CLASS_NAME)).toBe(
      "sticky left-0 z-10 border-b border-r border-gray-200 bg-white px-3 py-3 text-left align-top text-xs font-semibold text-gray-800",
    );
    expect(matrixClassOf(RESOURCE_GRID_CELL_CLASS_NAME)).toBe(
      "border-b border-gray-200 px-2 py-2 align-top",
    );
    /*
     * A row's border colour, for its box in the stack: a row of a table
     * whose borders are separate draws no border, and nothing outside the
     * query gives it a width.
     */
    expect(matrixClassOf(RESOURCE_GRID_ROW_CLASS_NAME)).toBe("border-gray-200");
    // The cell's column name is not drawn in the matrix.
    expect(
      tokensOf(matrixClassOf(RESOURCE_GRID_CELL_LABEL_CLASS_NAME))[0],
    ).toBe("hidden");
  });

  test("one query, and no colour under it: dark mode remaps a colour's own class, never one a variant names", () => {
    const COLOUR_PATTERN: RegExp =
      /^(?:[a-z-]+:)?(?:bg|text|border|ring|divide|outline)-(?:white|black|transparent|[a-z]+-\d{2,3})(?:\/\d+)?$/;

    for (const [part, className] of Object.entries(STACK_CLASS_NAMES)) {
      for (const token of tokensOf(className)) {
        if (token.includes("@container")) {
          expect(`${part}: ${token}`).toBe(
            `${part}: ${RESOURCE_GRID_STACK_VARIANT}${token.slice(RESOURCE_GRID_STACK_VARIANT.length)}`,
          );
        }
      }

      for (const added of stackClassOf(className)) {
        expect(`${part}: ${added} ${COLOUR_PATTERN.test(added)}`).toBe(
          `${part}: ${added} false`,
        );
      }
    }

    // The pattern does tell a colour apart.
    expect(COLOUR_PATTERN.test("bg-gray-50")).toBe(true);
    expect(COLOUR_PATTERN.test("border-gray-200")).toBe(true);
    expect(COLOUR_PATTERN.test("border-r-0")).toBe(false);
  });

  test("each cell names its column over its chips, drawn only in the stack, and the matrix's headings still name each column", () => {
    renderGrid();

    const labels: Array<HTMLElement> = screen.getAllByTestId(
      "status-page-resource-grid-cell-label",
    );

    expect(labels).toHaveLength(ROWS.length * COLUMNS.length);

    for (const row of Array.from(
      grid().querySelectorAll("tbody > tr"),
    ) as Array<HTMLElement>) {
      const cells: Array<HTMLElement> = childrenTagged(row, "TD");

      cells.forEach((cell: HTMLElement, index: number) => {
        const label: HTMLElement = within(cell).getByTestId(
          "status-page-resource-grid-cell-label",
        );

        expect(label).toHaveTextContent(COLUMNS[index]!);
        expect(label.className).toBe(RESOURCE_GRID_CELL_LABEL_CLASS_NAME);
        // First in its cell: over the chips and the Add button.
        expect(label.parentElement!.firstElementChild).toBe(label);
        expect(label.parentElement!.parentElement).toBe(cell);
      });
    }

    // Drawn as the column's heading is.
    expect(RESOURCE_GRID_CELL_LABEL_CLASS_NAME).toContain(
      "text-[11px] font-semibold uppercase tracking-wide text-gray-500",
    );

    const headings: Array<string> = Array.from(
      grid().querySelectorAll("thead th"),
    ).map((heading: Element): string => {
      return (heading.textContent || "").trim();
    });

    expect(headings).toEqual(["Region", ...COLUMNS]);
  });

  test("each cell's Add still names its row and its column", () => {
    renderGrid();

    for (const row of ROWS) {
      for (const column of COLUMNS) {
        expect(
          screen.getByRole("button", {
            name: `Add a monitor to ${row} and ${column}`,
          }),
        ).toBeInTheDocument();
      }
    }
  });
});

describe("a chip's Edit and ⋯ on a device with no hover (#7087)", () => {
  test("a chip's buttons are drawn where nothing can hover, and fade in on hover elsewhere", () => {
    renderGrid();

    const actions: HTMLElement = within(chipOf(LONG_NAME)).getByTestId(
      "status-page-resource-grid-actions",
    );

    expect(actions.className).toBe(RESOURCE_GRID_CHIP_ACTIONS_CLASS_NAME);
    expect(actions).toHaveClass(
      "[@media(hover:none)]:opacity-100",
      "opacity-0",
      "group-hover:opacity-100",
      "focus-within:opacity-100",
      "has-[[aria-expanded=true]]:opacity-100",
      "flex-shrink-0",
    );
  });

  test("a stranded resource's buttons are drawn as they were: always", () => {
    renderGrid();

    const stranded: HTMLElement = screen.getByTestId(
      "status-page-resource-grid-orphan",
    );
    const actions: HTMLElement = within(stranded).getByTestId(
      "status-page-resource-grid-actions",
    );

    expect(actions.className).toBe("flex flex-shrink-0 items-center gap-0.5");
  });

  test("Tab reaches a chip's box, its name, its Edit and its ⋯, in the order they are drawn, and Enter on Edit edits that resource", async () => {
    const onEdit: Mock<ResourceCallback> = jest.fn<ResourceCallback>();
    const user: UserEvent = userEvent.setup();

    renderGrid({ onEdit: onEdit });

    const chip: HTMLElement = chipOf(LONG_NAME);
    const box: HTMLElement = within(chip).getByRole("checkbox");
    const name: HTMLElement = within(chip).getByRole("link", {
      name: LONG_NAME,
    });
    const edit: HTMLElement = within(chip).getByRole("button", {
      name: `Edit ${LONG_NAME}`,
    });
    const more: HTMLElement = within(chip).getByRole("button", {
      name: `More actions for ${LONG_NAME}`,
    });
    const actions: HTMLElement = within(chip).getByTestId(
      "status-page-resource-grid-actions",
    );

    box.focus();
    expect(document.activeElement).toBe(box);

    const reached: Array<Element | null> = [];

    for (let step: number = 0; step < 3; step++) {
      await user.tab();
      reached.push(document.activeElement);
    }

    expect(reached).toEqual([name, edit, more]);
    // Focus is in the buttons' box, which shows them (focus-within).
    expect(actions).toContainElement(document.activeElement as HTMLElement);

    edit.focus();
    await user.keyboard("{Enter}");

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0]![0]).toBe(ON_THE_GRID);
  });

  test("the next Tab leaves the chip for the next one in its cell, or the cell's Add", async () => {
    const user: UserEvent = userEvent.setup();

    renderGrid();

    const more: HTMLElement = within(chipOf(LONG_NAME)).getByRole("button", {
      name: `More actions for ${LONG_NAME}`,
    });

    more.focus();
    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("button", {
        name: "Add a monitor to EU West and API",
      }),
    );
  });
});
