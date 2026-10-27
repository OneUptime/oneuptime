import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import TelemetryViewer, {
  TELEMETRY_VIEWER_LIST_TEST_ID,
  TELEMETRY_VIEWER_ROW_BOX_CLASS_NAME,
  TELEMETRY_VIEWER_SELECT_PAGE_TEST_ID,
  TELEMETRY_VIEWER_SELECT_PAGE_WORDS_TEST_ID,
  TELEMETRY_VIEWER_SELECT_ROW_TEST_ID,
  TelemetryViewerBulk,
} from "../../../../UI/Components/TelemetryViewer/TelemetryViewer";
import { TABLE_SELECTED_ROW_CLASS_NAME } from "../../../../UI/Components/Table/TableLayout";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "../../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { runBulkAction } from "../../../../UI/Components/BulkUpdate/BulkActionRunner";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import IconProp from "../../../../Types/Icon/IconProp";
import TimeRange from "../../../../Types/Time/TimeRange";

/*
 * BULK ACTIONS ON A TELEMETRY LIST (TelemetryViewer's `bulk`).
 *
 * The exceptions list gave each exception a ⋯ with Resolve, Reopen,
 * Archive and Unarchive, and no way to act on several at once (#5248's
 * follow-up). The shared telemetry list now takes Bulk Actions as a table
 * does: a box beside each row, one in the list's header for the page, and
 * the bar over the rows while some are ticked - how many, Clear Selection
 * and the actions' menu, with the same progress and result dialog. A list
 * pages, so a selection is the page's ticked rows. Left out, the list is
 * drawn exactly as before.
 */

interface Row {
  id: string;
  name: string;
  isResolved: boolean;
}

const ROWS: Array<Row> = [
  { id: "1", name: "TypeError: x is undefined", isResolved: false },
  { id: "2", name: "RangeError: too deep", isResolved: false },
  { id: "3", name: "Error: socket hang up", isResolved: true },
];

function viewer(data: {
  items: Array<Row>;
  bulk?: TelemetryViewerBulk<Row> | undefined;
}): React.ReactElement {
  return (
    <TelemetryViewer<Row>
      items={data.items}
      isLoading={false}
      renderRow={(item: Row): React.ReactElement => {
        return <span data-testid={`row-${item.id}`}>{item.name}</span>;
      }}
      getRowKey={(item: Row): string => {
        return item.id;
      }}
      searchValue=""
      onSearchChange={(): void => {}}
      onSearchSubmit={(): void => {}}
      timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      onTimeRangeChange={(): void => {}}
      page={1}
      pageSize={50}
      totalCount={data.items.length}
      onPageChange={(): void => {}}
      onPageSizeChange={(): void => {}}
      itemLabel="exceptions"
      bulk={data.bulk}
    />
  );
}

const resolved: Array<string> = [];
let actionEnds: number = 0;

const resolveAction: BulkActionButtonSchema<Row> = {
  title: "Resolve",
  icon: IconProp.Check,
  buttonStyleType: ButtonStyleType.NORMAL,
  onClick: async (actionProps: BulkActionOnClickProps<Row>): Promise<void> => {
    await runBulkAction<Row>({
      actionProps: actionProps,
      step: async (row: Row): Promise<void> => {
        resolved.push(row.id);
      },
    });
  },
};

const BULK: TelemetryViewerBulk<Row> = {
  buttons: [resolveAction],
  singularLabel: "Exception",
  pluralLabel: "Exceptions",
  getItemId: (row: Row): string => {
    return row.id;
  },
  itemToString: (row: Row): string => {
    return row.name;
  },
  onActionEnd: (): void => {
    actionEnds++;
  },
};

function rowBoxes(): Array<HTMLInputElement> {
  return screen.getAllByTestId(
    TELEMETRY_VIEWER_SELECT_ROW_TEST_ID,
  ) as Array<HTMLInputElement>;
}

function pageBox(): HTMLInputElement {
  return screen.getByTestId(
    TELEMETRY_VIEWER_SELECT_PAGE_TEST_ID,
  ) as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  resolved.length = 0;
  actionEnds = 0;
});

describe("a telemetry list without Bulk Actions", () => {
  test("is drawn as before: no boxes, no bar, each row as the list draws it", () => {
    render(viewer({ items: ROWS }));

    expect(
      screen.queryByTestId(TELEMETRY_VIEWER_SELECT_PAGE_TEST_ID),
    ).toBeNull();
    expect(
      screen.queryByTestId(TELEMETRY_VIEWER_SELECT_ROW_TEST_ID),
    ).toBeNull();
    expect(screen.getByTestId("row-1").parentElement?.tagName).toBe("LI");
  });
});

describe("a telemetry list with Bulk Actions", () => {
  test("puts a box beside each row, named by the row, and one for the page", () => {
    render(viewer({ items: ROWS, bulk: BULK }));

    expect(rowBoxes()).toHaveLength(3);
    expect(rowBoxes()[0]).toHaveAttribute(
      "aria-label",
      "Select TypeError: x is undefined",
    );
    expect(pageBox()).toHaveAttribute(
      "aria-label",
      "Select all exceptions on this page",
    );
    // The row is still the list's own, beside its box.
    const row: HTMLElement = screen.getByTestId("row-1");
    expect(row.closest("li")).toContainElement(rowBoxes()[0]!);
    expect(row.closest("li")).toHaveAttribute("data-selected", "false");
  });

  test("shows no bar until a row is ticked, then how many, Clear Selection and the actions", () => {
    render(viewer({ items: ROWS, bulk: BULK }));

    expect(screen.queryByText("Clear Selection")).toBeNull();

    fireEvent.click(rowBoxes()[0]!);
    fireEvent.click(rowBoxes()[1]!);

    expect(screen.getByText("2 Exceptions Selected")).toBeVisible();
    expect(screen.getByText("Clear Selection")).toBeVisible();
    // A list pages: the page's box is its Select All, so the bar has none.
    expect(screen.queryByText("Select All Exceptions")).toBeNull();

    expect(screen.getByTestId("row-1").closest("li")).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(screen.getByTestId("row-1").closest("li")).toHaveClass(
      "bg-indigo-50",
    );

    // Two of three: the page's box is part-ticked.
    expect(pageBox().indeterminate).toBe(true);
    expect(pageBox().checked).toBe(false);

    fireEvent.click(screen.getByText("Clear Selection"));

    expect(screen.queryByText("Clear Selection")).toBeNull();
    for (const box of rowBoxes()) {
      expect(box.checked).toBe(false);
    }
  });

  test("the page's box says what it does beside it, and a press on those words ticks it", () => {
    render(viewer({ items: ROWS, bulk: BULK }));

    const words: HTMLElement = screen.getByTestId(
      TELEMETRY_VIEWER_SELECT_PAGE_WORDS_TEST_ID,
    );
    expect(words).toHaveTextContent("Select all exceptions on this page");
    expect(words).toBeVisible();
    // The words are the box's own label, so they name it and tick it.
    expect(words.closest("label")).toHaveAttribute("for", pageBox().id);
    expect(
      screen.getByRole("checkbox", {
        name: "Select all exceptions on this page",
      }),
    ).toBe(pageBox());

    fireEvent.click(words);

    for (const box of rowBoxes()) {
      expect(box.checked).toBe(true);
    }
    expect(screen.getByText("3 Exceptions Selected")).toBeVisible();

    fireEvent.click(words);

    for (const box of rowBoxes()) {
      expect(box.checked).toBe(false);
    }
  });

  test("the page's box ticks every row on the page, and clears them again", () => {
    render(viewer({ items: ROWS, bulk: BULK }));

    fireEvent.click(pageBox());

    for (const box of rowBoxes()) {
      expect(box.checked).toBe(true);
    }
    expect(pageBox().checked).toBe(true);
    expect(pageBox().indeterminate).toBe(false);
    expect(screen.getByText("3 Exceptions Selected")).toBeVisible();

    fireEvent.click(pageBox());

    for (const box of rowBoxes()) {
      expect(box.checked).toBe(false);
    }
    expect(screen.queryByText("Clear Selection")).toBeNull();
  });

  test("a row read again keeps its tick; a row that left the page leaves the selection", () => {
    const view: RenderResult = render(viewer({ items: ROWS, bulk: BULK }));

    fireEvent.click(rowBoxes()[0]!);
    fireEvent.click(rowBoxes()[2]!);
    expect(screen.getByText("2 Exceptions Selected")).toBeVisible();

    // The list read again: row 1 resolved, row 3 gone from the page.
    view.rerender(
      viewer({
        items: [{ ...ROWS[0]!, isResolved: true }, ROWS[1]!],
        bulk: BULK,
      }),
    );

    expect(screen.getByText("1 Exception Selected")).toBeVisible();
    expect(rowBoxes()[0]!.checked).toBe(true);
    expect(rowBoxes()[1]!.checked).toBe(false);
  });

  test("an action runs on the ticked rows, then the selection clears and the list is told to read again", async () => {
    render(viewer({ items: ROWS, bulk: BULK }));

    fireEvent.click(rowBoxes()[0]!);
    fireEvent.click(rowBoxes()[1]!);

    fireEvent.click(screen.getByRole("button", { name: "Bulk Actions" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Resolve" }));
    });

    await waitFor(() => {
      expect(resolved.sort()).toEqual(["1", "2"]);
    });

    // The result says how it went; closing it ends the action.
    const dialog: HTMLElement = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).getByText("2 Exceptions succeeded")).toBeVisible();
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(actionEnds).toBe(1);
    });
    expect(screen.queryByText("Clear Selection")).toBeNull();
    for (const box of rowBoxes()) {
      expect(box.checked).toBe(false);
    }
  });

  test("an empty list has no page box, and a failed read none either", () => {
    const view: RenderResult = render(viewer({ items: [], bulk: BULK }));

    expect(
      screen.queryByTestId(TELEMETRY_VIEWER_SELECT_PAGE_TEST_ID),
    ).toBeNull();

    view.rerender(
      <TelemetryViewer<Row>
        items={ROWS}
        isLoading={false}
        error="The search took too long."
        renderRow={(item: Row): React.ReactElement => {
          return <span>{item.name}</span>;
        }}
        getRowKey={(item: Row): string => {
          return item.id;
        }}
        searchValue=""
        onSearchChange={(): void => {}}
        onSearchSubmit={(): void => {}}
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onTimeRangeChange={(): void => {}}
        page={1}
        pageSize={50}
        totalCount={3}
        onPageChange={(): void => {}}
        onPageSizeChange={(): void => {}}
        bulk={BULK}
      />,
    );

    expect(
      within(screen.getByTestId(TELEMETRY_VIEWER_LIST_TEST_ID)).queryByTestId(
        TELEMETRY_VIEWER_SELECT_PAGE_TEST_ID,
      ),
    ).toBeNull();
  });

  test("a ticked row wears a table's ticked row's wash, and its box sits at its start, level with its first line", () => {
    render(viewer({ items: ROWS, bulk: BULK }));

    fireEvent.click(rowBoxes()[1]!);

    const ticked: HTMLElement = screen.getByTestId("row-2").closest("li")!;
    const plain: HTMLElement = screen.getByTestId("row-1").closest("li")!;

    for (const name of TABLE_SELECTED_ROW_CLASS_NAME.split(" ")) {
      expect(ticked).toHaveClass(name);
    }
    expect(plain).not.toHaveClass("bg-indigo-50");

    // The box comes first in the row, in its own slot, then the row itself.
    const slot: HTMLElement = rowBoxes()[1]!.closest(
      `.${TELEMETRY_VIEWER_ROW_BOX_CLASS_NAME.split(" ")[0]}`,
    ) as HTMLElement;
    expect(slot.className).toBe(TELEMETRY_VIEWER_ROW_BOX_CLASS_NAME);
    expect(ticked.firstElementChild).toBe(slot);
    expect(TELEMETRY_VIEWER_ROW_BOX_CLASS_NAME).toBe("flex-none pl-4 pt-3");
  });

  test("the menu offers what the ticked rows can take as the list read them last", () => {
    const seen: Array<Array<boolean>> = [];
    const watching: TelemetryViewerBulk<Row> = {
      ...BULK,
      buttons: [
        {
          ...resolveAction,
          isVisible: (rows: Array<Row>): boolean => {
            seen.push(
              rows.map((row: Row): boolean => {
                return row.isResolved;
              }),
            );
            return rows.some((row: Row): boolean => {
              return !row.isResolved;
            });
          },
        },
      ],
    };

    const view: RenderResult = render(viewer({ items: ROWS, bulk: watching }));

    fireEvent.click(rowBoxes()[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Bulk Actions" }));
    expect(screen.getByRole("menuitem", { name: "Resolve" })).toBeVisible();
    expect(seen[seen.length - 1]).toEqual([false]);

    // Read again: row 1 is resolved now, and the menu has nothing for it.
    view.rerender(
      viewer({
        items: [{ ...ROWS[0]!, isResolved: true }, ROWS[1]!, ROWS[2]!],
        bulk: watching,
      }),
    );

    expect(seen[seen.length - 1]).toEqual([true]);
    expect(screen.queryByRole("menuitem", { name: "Resolve" })).toBeNull();
  });

  test("while an action runs the selection stands still, whatever the list reads meanwhile", async () => {
    let finish: () => void = (): void => {};
    const held: Promise<void> = new Promise<void>((resolve: () => void) => {
      finish = resolve;
    });

    const slowResolve: BulkActionButtonSchema<Row> = {
      ...resolveAction,
      onClick: async (
        actionProps: BulkActionOnClickProps<Row>,
      ): Promise<void> => {
        await runBulkAction<Row>({
          actionProps: actionProps,
          step: async (row: Row): Promise<void> => {
            await held;
            resolved.push(row.id);
          },
        });
      },
    };
    const slow: TelemetryViewerBulk<Row> = { ...BULK, buttons: [slowResolve] };

    const view: RenderResult = render(viewer({ items: ROWS, bulk: slow }));

    fireEvent.click(rowBoxes()[0]!);
    fireEvent.click(rowBoxes()[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Bulk Actions" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Resolve" }));
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");

    // The list is read again mid-run, and both ticked rows have left it.
    view.rerender(viewer({ items: [ROWS[2]!], bulk: slow }));

    // The run and its dialog keep the two rows they started with.
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByText("2 Exceptions Selected")).toBeVisible();

    await act(async () => {
      finish();
      await held;
    });

    await waitFor(() => {
      expect(within(dialog).getByText("2 Exceptions succeeded")).toBeVisible();
    });
    expect(resolved.sort()).toEqual(["1", "2"]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(actionEnds).toBe(1);
    });
    // Closed, the selection clears, and the list as read now is all there is.
    expect(screen.queryByText("Clear Selection")).toBeNull();
    expect(rowBoxes()).toHaveLength(1);
    expect(rowBoxes()[0]!.checked).toBe(false);
  });

  test("a row that left the page is never counted, not even before the selection is kept to the page", () => {
    const view: RenderResult = render(viewer({ items: ROWS, bulk: BULK }));

    fireEvent.click(rowBoxes()[0]!);
    fireEvent.click(rowBoxes()[1]!);

    // Page 2: none of the ticked rows are on it.
    view.rerender(
      viewer({
        items: [{ id: "4", name: "Error: page two", isResolved: false }],
        bulk: BULK,
      }),
    );

    expect(screen.queryByText("Clear Selection")).toBeNull();
    expect(screen.queryByText(/Selected/)).toBeNull();
    expect(rowBoxes()[0]!.checked).toBe(false);

    // Back on page 1, the rows ticked before are no longer ticked.
    view.rerender(viewer({ items: ROWS, bulk: BULK }));

    for (const box of rowBoxes()) {
      expect(box.checked).toBe(false);
    }
  });
});
