import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import Table, {
  ComponentProps as TableProps,
  DRAG_HANDLE_USAGE_INSTRUCTIONS,
} from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";

/*
 * Reordering a table by dragging its rows - the shared Table every
 * drag-ordered settings list renders through.
 *
 * react-beautiful-dnd's keyboard sensor runs in jsdom, so these drag for
 * real: focus a row's grip, Space to pick it up, arrow keys to move it,
 * Space to drop it. What they pin:
 *
 *   - every row has a grip that is a real, named, focusable control;
 *   - a drop reports positions ON SCREEN - the Draggable index used to be
 *     the row's stored order number, which broke as soon as those numbers
 *     started at 1, skipped one or repeated;
 *   - a drop at the top (index 0) is reported - it used to be dropped on the
 *     floor by a truthiness check, so nothing could be moved to the top;
 *   - a drop back where the row started, or an Escape, reports nothing;
 *   - while reordering is off the grips stay, greyed and focusable, and say
 *     why, and Space does not pick a row up;
 *   - a lifted row keeps the column widths of the header above it.
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

interface Row {
  _id: string;
  name: string;
  order: number;
}

const SPACE: { keyCode: number; key: string } = { keyCode: 32, key: " " };
const ARROW_UP: { keyCode: number; key: string } = {
  keyCode: 38,
  key: "ArrowUp",
};
const ARROW_DOWN: { keyCode: number; key: string } = {
  keyCode: 40,
  key: "ArrowDown",
};
const ESCAPE: { keyCode: number; key: string } = {
  keyCode: 27,
  key: "Escape",
};

const columns: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
];

// Stored numbers that are NOT positions: a list with gaps, out of 1..n.
const ROWS: Array<Row> = [
  { _id: "a", name: "Alpha", order: 5 },
  { _id: "b", name: "Beta", order: 1 },
  { _id: "c", name: "Gamma", order: 9 },
];

type DropCall = [string, number, number];

let onDragDrop: jest.Mock<(...args: Array<unknown>) => void>;

const setViewportWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const renderTable: (props?: Partial<TableProps<Row>>) => void = (
  props?: Partial<TableProps<Row>>,
): void => {
  render(
    <Table<Row>
      id="rules"
      data={ROWS}
      columns={columns}
      currentPageNumber={1}
      totalItemsCount={ROWS.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      singularLabel="Rule"
      pluralLabel="Rules"
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={() => {}}
      onNavigateToPage={() => {}}
      enableDragAndDrop={true}
      dragDropIdField="_id"
      dragDropIndexField="order"
      onDragDrop={onDragDrop as never}
      bulkItemToString={(row: Row): string => {
        return `Rule: ${row.name}`;
      }}
      {...(props || {})}
    />,
  );
};

const grips: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.getAllByTestId("drag-handle");
};

const wait: (ms: number) => Promise<void> = async (
  ms: number,
): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, ms);
    });
  });
};

const press: (
  element: HTMLElement,
  key: { keyCode: number; key: string },
) => Promise<void> = async (
  element: HTMLElement,
  key: { keyCode: number; key: string },
): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(element, key);
  });
  await wait(30);
};

// Picks the row at `from` up, moves it `steps` places (negative is up), drops it.
const dragFromKeyboard: (from: number, steps: number) => Promise<void> = async (
  from: number,
  steps: number,
): Promise<void> => {
  const grip: HTMLElement = grips()[from]!;
  grip.focus();

  await press(grip, SPACE);

  for (let i: number = 0; i < Math.abs(steps); i++) {
    await press(grip, steps < 0 ? ARROW_UP : ARROW_DOWN);
  }

  await press(grip, SPACE);
  // The drop animation has to finish before onDragEnd is called.
  await wait(400);
};

beforeEach(() => {
  onDragDrop = jest.fn();
  setViewportWidth(1024);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  setViewportWidth(1024);
});

describe("the grip", () => {
  test("every row has one", () => {
    renderTable();

    expect(grips()).toHaveLength(ROWS.length);
  });

  test("is a focusable control named after its row", () => {
    renderTable();

    const grip: HTMLElement = grips()[1]!;

    expect(grip).toHaveAttribute("tabindex", "0");
    expect(grip).toHaveAttribute("role", "button");
    expect(grip).toHaveAccessibleName("Drag to reorder Rule: Beta");
    expect(grip).toHaveAttribute("title", "Drag to reorder");
    expect(grip).not.toHaveAttribute("aria-disabled");
  });

  test("is named plainly when the table does not say what a row is", () => {
    renderTable({ bulkItemToString: undefined });

    expect(grips()[0]!).toHaveAccessibleName("Drag to reorder");
  });

  test("sits in the first cell, and the select box beside it is not a drag handle", () => {
    renderTable({
      matchBulkSelectedItemByField: "_id",
      bulkSelectedItems: [],
      bulkActions: {
        buttons: [
          {
            title: "Delete",
            buttonStyleType: ButtonStyleType.DANGER,
            onClick: (): Promise<void> => {
              return Promise.resolve();
            },
          },
        ],
      },
    });

    const firstRow: HTMLElement = screen.getAllByRole("row")[1]!;
    const cells: Array<HTMLElement> = within(firstRow).getAllByRole("cell");

    expect(within(cells[0]!).getByTestId("drag-handle")).toBeInTheDocument();
    expect(
      cells[1]!.hasAttribute("data-rbd-drag-handle-draggable-id"),
    ).toBe(false);
    expect(
      cells[1]!.querySelector("[data-rbd-drag-handle-draggable-id]"),
    ).toBeNull();
  });

  test("tells a screen reader how to use it, in the page's language", () => {
    renderTable();

    expect(document.body.textContent).toContain(DRAG_HANDLE_USAGE_INSTRUCTIONS);
  });

  test("the grip column's header is named for screen readers only", () => {
    renderTable();

    const header: HTMLElement = screen.getAllByRole("columnheader")[0]!;

    expect(header).toHaveTextContent("Drag to reorder");
    expect(within(header).getByText("Drag to reorder")).toHaveClass("sr-only");
  });

  test("a table that cannot be reordered has no grips", () => {
    renderTable({ enableDragAndDrop: false });

    expect(screen.queryAllByTestId("drag-handle")).toHaveLength(0);
  });
});

describe("dropping a row", () => {
  test("reports the row and where it moved on screen, whatever number it holds", async () => {
    renderTable();

    await dragFromKeyboard(2, -1);

    expect(onDragDrop.mock.calls).toEqual([["c", 1, 2]] as Array<DropCall>);
  });

  test("reports a drop at the very top - index 0", async () => {
    renderTable();

    await dragFromKeyboard(1, -1);

    expect(onDragDrop.mock.calls).toEqual([["b", 0, 1]] as Array<DropCall>);
  });

  test("reports a move down", async () => {
    renderTable();

    await dragFromKeyboard(0, 2);

    expect(onDragDrop.mock.calls).toEqual([["a", 2, 0]] as Array<DropCall>);
  });

  test("reports nothing for a row put back where it started", async () => {
    renderTable();

    await dragFromKeyboard(1, 0);

    expect(onDragDrop).not.toHaveBeenCalled();
  });

  test("reports nothing when the drag is cancelled with Escape", async () => {
    renderTable();

    const grip: HTMLElement = grips()[2]!;
    grip.focus();

    await press(grip, SPACE);
    await press(grip, ARROW_UP);
    await press(grip, ESCAPE);
    await wait(400);

    expect(onDragDrop).not.toHaveBeenCalled();
  });
});

describe("while reordering is off", () => {
  test("the grips stay, greyed out, focusable, and say why", () => {
    renderTable({
      isDragDisabled: true,
      dragDisabledReason: "Drag to reorder is off while a filter or search is on.",
    });

    for (const grip of grips()) {
      expect(grip).toHaveAttribute("aria-disabled", "true");
      expect(grip).toHaveAttribute("tabindex", "0");
      expect(grip).toHaveAttribute(
        "title",
        "Drag to reorder is off while a filter or search is on.",
      );
      expect(grip).toHaveClass("cursor-not-allowed");
    }
  });

  test("Space does not pick a row up", async () => {
    renderTable({ isDragDisabled: true });

    await dragFromKeyboard(2, -1);

    expect(onDragDrop).not.toHaveBeenCalled();
  });
});

describe("rows that move keep their identity", () => {
  test("a focused grip stays focused when its row moves", () => {
    const { rerender } = render(
      <Table<Row>
        id="rules"
        data={ROWS}
        columns={columns}
        currentPageNumber={1}
        totalItemsCount={ROWS.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Rule"
        pluralLabel="Rules"
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        onNavigateToPage={() => {}}
        enableDragAndDrop={true}
        dragDropIdField="_id"
        dragDropIndexField="order"
        onDragDrop={onDragDrop as never}
      />,
    );

    const gammaGrip: HTMLElement = grips()[2]!;
    gammaGrip.focus();

    rerender(
      <Table<Row>
        id="rules"
        data={[ROWS[2]!, ROWS[0]!, ROWS[1]!]}
        columns={columns}
        currentPageNumber={1}
        totalItemsCount={ROWS.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Rule"
        pluralLabel="Rules"
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        onNavigateToPage={() => {}}
        enableDragAndDrop={true}
        dragDropIdField="_id"
        dragDropIndexField="order"
        onDragDrop={onDragDrop as never}
      />,
    );

    // The same element, now first, still has focus.
    expect(grips()[0]).toBe(gammaGrip);
    expect(document.activeElement).toBe(gammaGrip);
  });

  test("a grip disabled while a move is saved keeps its focus", () => {
    const props: Partial<TableProps<Row>> = {};
    const { rerender } = render(
      <Table<Row>
        id="rules"
        data={ROWS}
        columns={columns}
        currentPageNumber={1}
        totalItemsCount={ROWS.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Rule"
        pluralLabel="Rules"
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        onNavigateToPage={() => {}}
        enableDragAndDrop={true}
        dragDropIdField="_id"
        dragDropIndexField="order"
        onDragDrop={onDragDrop as never}
        {...props}
      />,
    );

    const grip: HTMLElement = grips()[1]!;
    grip.focus();

    rerender(
      <Table<Row>
        id="rules"
        data={ROWS}
        columns={columns}
        currentPageNumber={1}
        totalItemsCount={ROWS.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Rule"
        pluralLabel="Rules"
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        onNavigateToPage={() => {}}
        enableDragAndDrop={true}
        isDragDisabled={true}
        dragDisabledReason="Saving the new order..."
        dragDropIdField="_id"
        dragDropIndexField="order"
        onDragDrop={onDragDrop as never}
      />,
    );

    expect(document.activeElement).toBe(grip);
    expect(grip).toHaveAttribute("aria-disabled", "true");
  });
});

describe("a lifted row", () => {
  test("keeps the widths of the header cells above it", async () => {
    const widths: Record<string, number> = { 0: 40, 1: 360 };

    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.tagName === "TH") {
          const index: number = Array.from(
            this.parentElement!.children,
          ).indexOf(this);

          return {
            width: widths[index] || 0,
            height: 40,
            top: 0,
            left: 0,
            right: widths[index] || 0,
            bottom: 40,
            x: 0,
            y: 0,
            toJSON: () => {
              return {};
            },
          } as DOMRect;
        }

        return {
          width: 400,
          height: 48,
          top: 0,
          left: 0,
          right: 400,
          bottom: 48,
          x: 0,
          y: 0,
          toJSON: () => {
            return {};
          },
        } as DOMRect;
      });

    renderTable();

    const grip: HTMLElement = grips()[1]!;
    grip.focus();
    await press(grip, SPACE);

    const liftedRow: HTMLElement = grip.closest("tr")!;
    const cells: Array<HTMLElement> = Array.from(
      liftedRow.querySelectorAll("td"),
    );

    expect(liftedRow.style.display).toBe("table");
    expect(liftedRow.style.tableLayout).toBe("fixed");
    expect(cells[0]!.style.width).toBe("40px");
    expect(cells[1]!.style.width).toBe("360px");

    // The rows that were not picked up are laid out by the table as before.
    const otherRow: HTMLElement = grips()[0]!.closest("tr")!;

    expect(otherRow.style.display).toBe("");
    expect(otherRow.querySelector("td")!.style.width).toBe("");

    // Put it down where it was: once dropped, it is an ordinary row again.
    await press(grip, SPACE);
    await wait(50);
    await act(async () => {
      const event: Event = new Event("transitionend", { bubbles: true });
      Object.defineProperty(event, "propertyName", { value: "transform" });
      liftedRow.dispatchEvent(event);
    });
    await wait(400);

    expect(liftedRow.style.display).toBe("");
    expect(cells[1]!.style.width).toBe("");
  });
});

describe("on a phone", () => {
  test("a card's grip and select box share one line", () => {
    setViewportWidth(500);

    renderTable({
      matchBulkSelectedItemByField: "_id",
      bulkSelectedItems: [],
      bulkActions: {
        buttons: [
          {
            title: "Delete",
            buttonStyleType: ButtonStyleType.DANGER,
            onClick: (): Promise<void> => {
              return Promise.resolve();
            },
          },
        ],
      },
    });

    const grip: HTMLElement = grips()[0]!;
    const line: HTMLElement = grip.parentElement!;

    expect(line).toHaveClass("flex");
    expect(within(line).getByRole("checkbox")).toBeInTheDocument();
  });

  test("a card can be moved from the keyboard too", async () => {
    setViewportWidth(500);
    renderTable();

    await dragFromKeyboard(2, -2);

    expect(onDragDrop.mock.calls).toEqual([["c", 0, 2]] as Array<DropCall>);
  });
});
