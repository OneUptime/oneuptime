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
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import Table, {
  ComponentProps as TableProps,
  DRAG_HANDLE_USAGE_INSTRUCTIONS,
} from "../../../../UI/Components/Table/Table";
import { getLoadedDragAndDrop } from "../../../../UI/Components/DragAndDrop/DragAndDropLoader";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";

/*
 * A table that reorders its rows loads react-beautiful-dnd itself, the first
 * time one is drawn (DragAndDropLoader, issue #5619). The library used to be
 * a static import of Table, so every page that draws one - the sign-in page,
 * through a form's summary step - downloaded and parsed it before it could
 * draw, though only a table with enableDragAndDrop drags a row.
 *
 * What is pinned, in this order (a test file loads the library once, so the
 * order is part of the test):
 *
 *   - a table whose rows stay where they are never loads it;
 *   - one that reorders draws every row at once, its grip included, exactly
 *     as it will look once the library is there - nothing on the page moves
 *     when it arrives;
 *   - its grips drag once it has arrived;
 *   - a table drawn after that drags from its first frame.
 */

const mockLibrary: { requires: number } = { requires: 0 };

jest.mock("react-beautiful-dnd", () => {
  mockLibrary.requires++;
  return jest.requireActual("react-beautiful-dnd");
});

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

const columns: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
];

const ROWS: Array<Row> = [
  { _id: "a", name: "Alpha", order: 1 },
  { _id: "b", name: "Beta", order: 2 },
  { _id: "c", name: "Gamma", order: 3 },
];

let onDragDrop: ReturnType<typeof jest.fn>;

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

// What react-beautiful-dnd adds to wire a row and its grip up.
const isWiringAttribute: (name: string) => boolean = (
  name: string,
): boolean => {
  return (
    name.startsWith("data-rbd-") ||
    name === "aria-describedby" ||
    name === "draggable"
  );
};

// The table as drawn, without that wiring: what the page shows.
const drawnTable: () => string = (): string => {
  const table: HTMLElement = screen
    .getByRole("table")
    .cloneNode(true) as HTMLElement;

  for (const element of [table, ...Array.from(table.querySelectorAll("*"))]) {
    for (const name of element.getAttributeNames()) {
      if (isWiringAttribute(name)) {
        element.removeAttribute(name);
      }
    }
  }

  return table.outerHTML;
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

beforeEach(() => {
  onDragDrop = jest.fn();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1024,
  });
});

afterEach(() => {
  cleanup();
});

describe("a table whose rows stay where they are", () => {
  test("never loads the drag-and-drop library", async () => {
    renderTable({ enableDragAndDrop: false });

    expect(screen.getAllByRole("row")).toHaveLength(ROWS.length + 1);
    expect(screen.queryAllByTestId("drag-handle")).toHaveLength(0);

    await wait(10);

    expect(mockLibrary.requires).toBe(0);
    expect(getLoadedDragAndDrop()).toBeNull();
  });
});

describe("a table that reorders its rows", () => {
  test("draws every row and grip at once, as they will look, and they drag once the library is there", async () => {
    renderTable();

    // The first frame: every row, every grip, the grip column's header.
    expect(getLoadedDragAndDrop()).toBeNull();
    expect(grips()).toHaveLength(ROWS.length);
    expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent(
      "Drag to reorder",
    );
    expect(grips()[1]).toHaveAccessibleName("Drag to reorder Rule: Beta");
    expect(grips()[1]).toHaveAttribute("tabindex", "0");
    // Not wired up yet: Space picks nothing up, and nothing breaks.
    expect(grips()[0]).not.toHaveAttribute("data-rbd-drag-handle-draggable-id");

    const firstFrame: string = drawnTable();

    fireEvent.keyDown(grips()[0]!, SPACE);

    await waitFor(() => {
      expect(grips()[0]).toHaveAttribute(
        "data-rbd-drag-handle-draggable-id",
        "a",
      );
    });

    // Nothing the page shows moved or changed as the library arrived.
    expect(drawnTable()).toBe(firstFrame);
    expect(document.body.textContent).toContain(DRAG_HANDLE_USAGE_INSTRUCTIONS);
    expect(mockLibrary.requires).toBe(1);

    // And the grips drag: Gamma moves up one place.
    const grip: HTMLElement = grips()[2]!;
    grip.focus();
    await press(grip, SPACE);
    await press(grip, ARROW_UP);
    await press(grip, SPACE);
    // The drop animation has to finish before onDragEnd is called.
    await wait(400);

    expect(onDragDrop.mock.calls).toEqual([["c", 1, 2]]);
  });

  test("drags from its first frame once a table has loaded the library", () => {
    renderTable();

    for (const [index, grip] of grips().entries()) {
      expect(grip).toHaveAttribute(
        "data-rbd-drag-handle-draggable-id",
        ROWS[index]!._id,
      );
    }

    expect(document.body.textContent).toContain(DRAG_HANDLE_USAGE_INSTRUCTIONS);
    // Loaded once, for every table after the first.
    expect(mockLibrary.requires).toBe(1);
  });

  test("draws its cards on a phone the same way, wired up", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });

    renderTable();

    expect(screen.queryByRole("table")).toBeNull();
    expect(grips()).toHaveLength(ROWS.length);
    expect(grips()[0]).toHaveAttribute(
      "data-rbd-drag-handle-draggable-id",
      "a",
    );
  });
});
