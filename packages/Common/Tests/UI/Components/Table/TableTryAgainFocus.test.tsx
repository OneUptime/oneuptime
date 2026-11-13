import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, useEffect, useState } from "react";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { getUnexplainedServerErrorMessage } from "../../../../Types/Exception/UnexplainedError";

/*
 * A table's Try again, on a failed load (#7621). It gives way to the
 * loading rows, which hold nothing to focus: pressed from the keyboard, the
 * focus fell to the page, and the next Tab started over at its top - in
 * Chromium, Firefox and WebKit alike. The table holds the focus now while
 * the rows load again, hands it back to Try again if they fail once more,
 * and keeps it, just before the rows, when they arrive. A focus that was
 * elsewhere on the page is left where it is, and the table is focusable
 * only while it holds the focus.
 *
 * The table is read as BaseModelTable reads it: Try again clears the error
 * and loads again, and a failure ends the load with the server's message.
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

/*
 * A busy page: while it is on, the failure's words take longer to draw than
 * the scheduler's slice (5 ms), so React runs the passive effects of the
 * commit that draws them in a task of their own - after a Try again pressed
 * at once. The words are ErrorMessageText's own all the same.
 */
const mockBusyPage: { isOn: boolean } = { isOn: false };

jest.mock("../../../../UI/Components/ErrorMessage/ErrorMessageText", () => {
  const ReactModule: typeof React = jest.requireActual("react") as typeof React;
  const ActualErrorMessageText: React.ComponentType<Record<string, unknown>> = (
    jest.requireActual(
      "../../../../UI/Components/ErrorMessage/ErrorMessageText",
    ) as { default: React.ComponentType<Record<string, unknown>> }
  ).default;

  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      if (mockBusyPage.isOn) {
        const drawnBy: number = Date.now() + 25;

        while (Date.now() < drawnBy) {
          // Drawing, slowly.
        }
      }

      return ReactModule.createElement(ActualErrorMessageText, props);
    },
  };
});

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
}

const columns: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
];

const ROWS: Array<Row> = [
  { _id: "1", name: "Alpha" },
  { _id: "2", name: "Beta" },
];

const TABLE_ID: string = "monitors-table";
const LOAD_ERROR_TEST_ID: string = `${TABLE_ID}-load-error`;

/*
 * The page's own class for the table, as BaseModelTable gives its frame -
 * which its tests find the table by.
 */
const PAGE_CLASS: string = "monitors-frame";

// What the server answers for a failure it could not explain (#6836).
const SERVER_FAILURE: string = getUnexplainedServerErrorMessage("a1b2c3d4");

interface PendingRead {
  resolve: (rows: Array<Row>) => void;
  reject: (message: string) => void;
}

type TableRead = () => Promise<Array<Row>>;

/*
 * How the coming reads of the rows end, in order - a failure, or a read
 * left for the test to answer. Every read after them gets the rows.
 */
let tableReads: Array<TableRead> = [];

const failingRead: () => TableRead = (): TableRead => {
  return (): Promise<Array<Row>> => {
    return Promise.reject(SERVER_FAILURE);
  };
};

const pendingRead: (pending: Array<PendingRead>) => TableRead = (
  pending: Array<PendingRead>,
): TableRead => {
  return (): Promise<Array<Row>> => {
    return new Promise<Array<Row>>(
      (
        resolve: (rows: Array<Row>) => void,
        reject: (message: string) => void,
      ) => {
        pending.push({ resolve, reject });
      },
    );
  };
};

const readRows: TableRead = (): Promise<Array<Row>> => {
  const read: TableRead | undefined = tableReads.shift();

  return read ? read() : Promise.resolve(ROWS);
};

// A page with a control of its own, and the table, loaded as a model table is.
const TablePage: () => ReactElement = (): ReactElement => {
  const [data, setData] = useState<Array<Row>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchRows: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      setData(await readRows());
    } catch (err) {
      setError(err as string);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchRows();
  }, []);

  return (
    <div>
      <button type="button" data-testid="elsewhere">
        Elsewhere on the page
      </button>
      <Table<Row>
        id={TABLE_ID}
        className={PAGE_CLASS}
        data={data}
        columns={columns}
        currentPageNumber={1}
        totalItemsCount={data.length}
        itemsOnPage={10}
        error={error}
        isLoading={isLoading}
        singularLabel="Monitor"
        pluralLabel="Monitors"
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        onNavigateToPage={() => {}}
        onRefreshClick={() => {
          void fetchRows();
        }}
      />
    </div>
  );
};

/*
 * The page on a first read that failed. Rendered, then waited for at once:
 * the failure is drawn while the test waits, as it is on a page - outside
 * act, which would run every effect of the commit before the test went on.
 */
const renderFailedTable: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    tableReads.unshift(failingRead());

    render(<TablePage />);

    return screen.findByTestId(LOAD_ERROR_TEST_ID);
  };

const tryAgainIn: (failure: HTMLElement) => HTMLElement = (
  failure: HTMLElement,
): HTMLElement => {
  return within(failure).getByRole("button", { name: "Try again" });
};

// The table as a whole: what holds the scroll box, the failure and the footer.
const tableRegion: () => HTMLElement = (): HTMLElement => {
  const region: HTMLElement = screen.getByTestId("table-scroll")
    .parentElement as HTMLElement;

  expect(region).toContainElement(screen.getByTestId("table-footer"));

  return region;
};

// The rows' names drawn in the table.
const rowsDrawn: () => Array<string> = (): Array<string> => {
  return ROWS.map((row: Row) => {
    return row.name as string;
  }).filter((name: string) => {
    return screen.queryAllByText(name).length > 0;
  });
};

/*
 * The table on a failed read, with Try again focused and pressed: the read
 * it starts waits in `pending`.
 */
const pressTryAgain: () => Promise<{
  region: HTMLElement;
  pending: Array<PendingRead>;
}> = async (): Promise<{
  region: HTMLElement;
  pending: Array<PendingRead>;
}> => {
  const pending: Array<PendingRead> = [];
  tableReads.push(pendingRead(pending));

  const failure: HTMLElement = await renderFailedTable();
  const tryAgain: HTMLElement = tryAgainIn(failure);

  tryAgain.focus();
  expect(document.activeElement).toBe(tryAgain);

  // Enter or Space on a focused button is a click on it, with the focus where it is.
  fireEvent.click(tryAgain);

  const region: HTMLElement = tableRegion();

  // Loading again, with the focus on the table - not on the page.
  expect(screen.queryByTestId(LOAD_ERROR_TEST_ID)).toBeNull();
  expect(document.activeElement).toBe(region);
  expect(pending).toHaveLength(1);

  return { region, pending };
};

afterEach(() => {
  cleanup();
  tableReads = [];
  mockBusyPage.isOn = false;
});

describe("a table's Try again, pressed from the keyboard", () => {
  test("while the rows load again, the table holds the focus, without a ring", async () => {
    const { region } = await pressTryAgain();

    expect(region).toHaveAttribute("tabindex", "-1");
    expect(region.getAttribute("class")).toBe(
      `${PAGE_CLASS} focus:outline-none`,
    );
  });

  test("when the rows arrive, the focus stays on the table, before them", async () => {
    const { region, pending } = await pressTryAgain();

    await act(async () => {
      pending[0]!.resolve(ROWS);
    });

    expect(rowsDrawn()).toHaveLength(2);
    expect(document.activeElement).toBe(region);
  });

  test("when they fail once more, the focus moves on to Try again, not to the reference's copy button", async () => {
    const { region, pending } = await pressTryAgain();

    await act(async () => {
      pending[0]!.reject(SERVER_FAILURE);
    });

    const failure: HTMLElement = screen.getByTestId(LOAD_ERROR_TEST_ID);
    const tryAgain: HTMLElement = tryAgainIn(failure);
    const copy: HTMLElement = within(
      within(failure).getByTestId("error-reference"),
    ).getByRole("button");

    expect(copy).not.toBe(tryAgain);
    expect(document.activeElement).toBe(tryAgain);
    // It holds the focus no more, and is not focusable again until the next press.
    expect(region).not.toHaveAttribute("tabindex");
    expect(region.getAttribute("class")).toBe(PAGE_CLASS);
  });

  test("pressed again after that failure, it keeps the focus the same way", async () => {
    const { pending } = await pressTryAgain();
    tableReads.push(pendingRead(pending));

    await act(async () => {
      pending[0]!.reject(SERVER_FAILURE);
    });

    fireEvent.click(tryAgainIn(screen.getByTestId(LOAD_ERROR_TEST_ID)));
    expect(document.activeElement).toBe(tableRegion());

    await act(async () => {
      pending[1]!.resolve(ROWS);
    });

    expect(rowsDrawn()).toHaveLength(2);
    expect(document.activeElement).toBe(tableRegion());
  });

  /*
   * On a busy page a failure takes longer to draw than the scheduler's
   * slice, and React runs the passive effects of that commit in a later
   * task - after a Try again pressed at once. Run then, the check that hands
   * the focus back to Try again would find it on the table, where that
   * press had just put it, and move it to the Try again the press was
   * taking away: the focus would fall to the page. The check runs as the
   * failure is drawn.
   */
  test("on a busy page, Try again pressed as soon as the failure is drawn still keeps the focus on the table", async () => {
    const { region, pending } = await pressTryAgain();
    tableReads.push(pendingRead(pending));
    mockBusyPage.isOn = true;

    /*
     * The read fails while the test waits, as on a page: outside act, which
     * would run every effect of the commit before the test went on.
     */
    pending[0]!.reject(SERVER_FAILURE);
    const failure: HTMLElement = await screen.findByTestId(LOAD_ERROR_TEST_ID);
    const tryAgain: HTMLElement = tryAgainIn(failure);

    // Pressed at once: a click, which focuses the button it presses first.
    tryAgain.focus();
    fireEvent.click(tryAgain);

    expect(screen.queryByTestId(LOAD_ERROR_TEST_ID)).toBeNull();
    expect(document.activeElement).toBe(region);

    await act(async () => {
      pending[1]!.resolve(ROWS);
    });

    expect(rowsDrawn()).toHaveLength(2);
    expect(document.activeElement).toBe(region);
  });

  test("a focus that was elsewhere on the page is left where it is", async () => {
    const pending: Array<PendingRead> = [];
    tableReads.push(pendingRead(pending), pendingRead(pending));

    const failure: HTMLElement = await renderFailedTable();
    const elsewhere: HTMLElement = screen.getByTestId("elsewhere");

    elsewhere.focus();
    // A click that left the focus where it was, as a click does in Safari.
    fireEvent.click(tryAgainIn(failure));
    expect(document.activeElement).toBe(elsewhere);
    expect(tableRegion()).not.toHaveAttribute("tabindex");

    await act(async () => {
      pending[0]!.reject(SERVER_FAILURE);
    });

    const failedAgain: HTMLElement = screen.getByTestId(LOAD_ERROR_TEST_ID);
    expect(document.activeElement).toBe(elsewhere);

    fireEvent.click(tryAgainIn(failedAgain));

    await act(async () => {
      pending[1]!.resolve(ROWS);
    });

    expect(rowsDrawn()).toHaveLength(2);
    expect(document.activeElement).toBe(elsewhere);
  });
});

/*
 * Focusable for good, the table would take every click on its rows' words,
 * and in Chromium the next Tab would then start over at its top rather than
 * after what was clicked. It is focusable only while it holds the focus for
 * Try again.
 */
describe("the table, focusable only while it holds the focus", () => {
  test("a table that loaded, or failed to, is not focusable, and has the page's class alone", async () => {
    render(<TablePage />);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(tableRegion()).not.toHaveAttribute("tabindex");
    expect(tableRegion().getAttribute("class")).toBe(PAGE_CLASS);

    cleanup();

    await renderFailedTable();
    expect(tableRegion()).not.toHaveAttribute("tabindex");
    expect(tableRegion().getAttribute("class")).toBe(PAGE_CLASS);
  });

  test("once the focus moves on from it, it is not focusable again", async () => {
    const { region, pending } = await pressTryAgain();

    await act(async () => {
      pending[0]!.resolve(ROWS);
    });

    expect(region).toHaveAttribute("tabindex", "-1");

    act(() => {
      screen.getByTestId("elsewhere").focus();
    });

    expect(region).not.toHaveAttribute("tabindex");
    expect(region.getAttribute("class")).toBe(PAGE_CLASS);
  });

  /*
   * A window sent to the back fires blur at the focused element and keeps
   * it as the document's focused element, to give the focus back to when it
   * is in front again: the table stays focusable for that.
   */
  test("a window sent to the back leaves it focusable, to take the focus back", async () => {
    const { region } = await pressTryAgain();

    fireEvent.blur(region);
    fireEvent.focusOut(region);

    expect(document.activeElement).toBe(region);
    expect(region).toHaveAttribute("tabindex", "-1");
    expect(region.getAttribute("class")).toBe(
      `${PAGE_CLASS} focus:outline-none`,
    );
  });
});
