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
} from "@testing-library/react";
import React, { ReactElement, useEffect, useState } from "react";
import Table from "../../../../UI/Components/Table/Table";
import * as TableLayout from "../../../../UI/Components/Table/TableLayout";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { forgetRememberedTableFits } from "../../../../UI/Components/Table/useTableFit";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { getUnexplainedServerErrorMessage } from "../../../../Types/Exception/UnexplainedError";

/*
 * A TABLE DRAWS EACH UPDATE ONCE (#7707).
 *
 * A list's first failure - and its first page of rows - was drawn twice in
 * the same task. As the table was first drawn, its measuring (the box's
 * width, whether the rows scroll sideways, whether they fit at all) set
 * what it had found even when that was what it had already. React keeps
 * such an update in its queue at the priority it was asked at - the
 * highest, in a layout effect - and the table's next update at a lower
 * one, the server's answer, passed it by, then drew the whole table again
 * in the same task to take it up. Nobody saw it, but every list did the
 * work twice, and the focus code that runs as a failure is drawn ran
 * around a draw nobody asked for. A measurement that finds nothing new
 * asks for nothing now.
 *
 * Two things are counted. The table's own draws: each one works out its
 * footer's look once (TableLayout's getTableFooterClassName, which nothing
 * else calls). And, for a failure, React's commits of everything inside
 * the table (a Profiler round it): one, never a second "nested-update" -
 * React's name for a draw asked for while the last one was committed. A
 * first page of rows also draws the footer's rows-per-page picker for the
 * first time, which reads its value as it is drawn, in a commit of its
 * own: that one is the picker's, not the table's.
 *
 * The page reads its rows as BaseModelTable does: a read clears the error
 * and loads, and ends with the rows or the server's message.
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
  _id?: string | undefined;
  name?: string | undefined;
  owner?: string | undefined;
  region?: string | undefined;
}

const TABLE_ID: string = "monitors-table";
const LOAD_ERROR_TEST_ID: string = `${TABLE_ID}-load-error`;

const COLUMNS: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
  { title: "Owner", type: FieldType.Text, key: "owner" },
  { title: "Region", type: FieldType.Text, key: "region" },
];

const pageOf: (page: number) => Array<Row> = (page: number): Array<Row> => {
  return [1, 2].map((index: number): Row => {
    return {
      _id: `${page}-${index}`,
      name: `Monitor ${page}.${index}`,
      owner: "Platform",
      region: "eu-west-1",
    };
  });
};

// What the server answers for a failure it could not explain (#6836).
const SERVER_FAILURE: string = getUnexplainedServerErrorMessage("a1b2c3d4");

// A read of the rows, left for the test to answer.
interface PendingRead {
  resolve: (rows: Array<Row>) => void;
  reject: (message: string) => void;
}

let pendingReads: Array<PendingRead> = [];

// Each commit inside the table, by React's name for it.
let commits: Array<string> = [];

// The page's read of its rows, for a test that reads them again.
let readRowsAgain: (() => void) | null = null;

const ListPage: () => ReactElement = (): ReactElement => {
  const [data, setData] = useState<Array<Row>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [sort, setSort] = useState<{
    by: keyof Row | null;
    order: SortOrder;
  }>({ by: null, order: SortOrder.Ascending });

  const fetchRows: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      setData(
        await new Promise<Array<Row>>(
          (
            resolve: (rows: Array<Row>) => void,
            reject: (message: string) => void,
          ) => {
            pendingReads.push({ resolve, reject });
          },
        ),
      );
    } catch (err) {
      setError(err as string);
    }

    setIsLoading(false);
  };

  readRowsAgain = (): void => {
    void fetchRows();
  };

  useEffect(() => {
    void fetchRows();
  }, []);

  return (
    <React.Profiler
      id={TABLE_ID}
      onRender={(_id: string, phase: string) => {
        commits.push(phase);
      }}
    >
      <Table<Row>
        id={TABLE_ID}
        data={data}
        columns={COLUMNS}
        currentPageNumber={1}
        totalItemsCount={data.length}
        itemsOnPage={10}
        error={error}
        isLoading={isLoading}
        singularLabel="Monitor"
        pluralLabel="Monitors"
        sortOrder={sort.order}
        sortBy={sort.by}
        onSortChanged={(by: keyof Row | null, order: SortOrder) => {
          setSort({ by: by, order: order });
        }}
        onNavigateToPage={() => {}}
        onRefreshClick={() => {
          void fetchRows();
        }}
      />
    </React.Profiler>
  );
};

// What one step brought: the table's own draws, and the commits inside it.
interface Drawn {
  tableDraws: number;
  commits: Array<string>;
}

let footerLooks: ReturnType<typeof jest.spyOn>;

// Counts what `step` draws, once everything it set off is over.
const countDrawn: (step: () => void) => Promise<Drawn> = async (
  step: () => void,
): Promise<Drawn> => {
  footerLooks.mockClear();
  commits = [];

  await act(async () => {
    step();
  });

  return { tableDraws: footerLooks.mock.calls.length, commits: commits };
};

/*
 * The page, drawn with its first read on the way: the mount's own draws are
 * over (render runs every effect), and nothing is counted from them.
 */
const renderListPage: () => void = (): void => {
  render(<ListPage />);

  expect(pendingReads).toHaveLength(1);
};

// The latest read answers.
const answer: (outcome: { rows: Array<Row> } | { failure: string }) => void = (
  outcome: { rows: Array<Row> } | { failure: string },
): void => {
  const read: PendingRead = pendingReads[pendingReads.length - 1]!;

  if ("rows" in outcome) {
    read.resolve(outcome.rows);
  } else {
    read.reject(outcome.failure);
  }
};

// The page reads its rows again, as a refresh or a new page does.
const readAgain: () => void = (): void => {
  readRowsAgain!();
};

const rowNames: () => Array<string> = (): Array<string> => {
  return Array.from(document.querySelectorAll("tbody tr td"))
    .map((cell: Element): string => {
      return (cell.textContent || "").trim();
    })
    .filter((text: string): boolean => {
      return text.startsWith("Monitor ");
    });
};

/*
 * jsdom lays nothing out. A test that needs a layout hands out the box's
 * width and the table's, as TableFitInTable does: each header cell
 * `columnWidth` wide.
 */
const rect: (width: number) => DOMRect = (width: number): DOMRect => {
  return {
    width: width,
    height: 40,
    top: 0,
    left: 0,
    right: width,
    bottom: 40,
    x: 0,
    y: 0,
    toJSON: (): unknown => {
      return {};
    },
  } as DOMRect;
};

const layout: { boxWidth: number; columnWidth: number } = {
  boxWidth: 0,
  columnWidth: 0,
};

const layOut: (widths: {
  boxWidth: number;
  columnWidth: number;
}) => void = (widths: { boxWidth: number; columnWidth: number }): void => {
  layout.boxWidth = widths.boxWidth;
  layout.columnWidth = widths.columnWidth;

  jest
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element): DOMRect {
      if (this.getAttribute("data-testid") === "table-scroll") {
        return rect(layout.boxWidth);
      }

      if (this.tagName === "TABLE") {
        return rect(
          this.querySelectorAll("thead th").length * layout.columnWidth,
        );
      }

      return rect(0);
    });
};

const setWindowWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const resizeWindow: () => void = (): void => {
  window.dispatchEvent(new Event("resize"));
};

beforeEach(() => {
  pendingReads = [];
  commits = [];
  readRowsAgain = null;
  setWindowWidth(1280);
  footerLooks = jest.spyOn(TableLayout, "getTableFooterClassName");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  forgetRememberedTableFits();
  setWindowWidth(1024);
});

describe("a list's first answer, drawn once", () => {
  test("its first failure is drawn once, with Try again, in one commit", async () => {
    renderListPage();

    const drawn: Drawn = await countDrawn(() => {
      answer({ failure: SERVER_FAILURE });
    });

    expect(screen.getByTestId(LOAD_ERROR_TEST_ID)).toBeInTheDocument();
    expect(drawn).toEqual({ tableDraws: 1, commits: ["update"] });
  });

  test("in a card that is measured, its first failure is drawn once, in one commit", async () => {
    layOut({ boxWidth: 938, columnWidth: 200 });
    renderListPage();

    const drawn: Drawn = await countDrawn(() => {
      answer({ failure: SERVER_FAILURE });
    });

    expect(screen.getByTestId(LOAD_ERROR_TEST_ID)).toBeInTheDocument();
    expect(drawn).toEqual({ tableDraws: 1, commits: ["update"] });
  });

  test("its first page of rows is drawn once", async () => {
    renderListPage();

    const drawn: Drawn = await countDrawn(() => {
      answer({ rows: pageOf(1) });
    });

    expect(rowNames()).toEqual(["Monitor 1.1", "Monitor 1.2"]);
    expect(drawn.tableDraws).toBe(1);
  });

  /*
   * A click is drawn at a higher priority than the server's answer: what
   * the table set as it was first drawn - after it was drawn, at a page's
   * priority - was passed by the click's draw, and drawn once more after
   * it.
   */
  test("a column sorted while its first page loads is drawn once, and so is the page that comes", async () => {
    renderListPage();

    const sorted: Drawn = await countDrawn(() => {
      fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    });

    expect(sorted.tableDraws).toBe(1);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    expect(
      (
        await countDrawn(() => {
          answer({ rows: pageOf(1) });
        })
      ).tableDraws,
    ).toBe(1);
    expect(rowNames()).toEqual(["Monitor 1.1", "Monitor 1.2"]);
  });
});

describe("a list read again, each answer drawn once", () => {
  /*
   * Every read draws the table twice - loading, then its answer - and each
   * of those once.
   */
  const expectEachReadDrawnOnce: () => Promise<void> =
    async (): Promise<void> => {
      expect(
        (
          await countDrawn(() => {
            answer({ rows: pageOf(1) });
          })
        ).tableDraws,
      ).toBe(1);

      for (const page of [2, 3]) {
        expect((await countDrawn(readAgain)).tableDraws).toBe(1);
        expect(
          (
            await countDrawn(() => {
              answer({ rows: pageOf(page) });
            })
          ).tableDraws,
        ).toBe(1);
        expect(rowNames()).toEqual([`Monitor ${page}.1`, `Monitor ${page}.2`]);
      }

      // And a failure after them, in one commit.
      expect((await countDrawn(readAgain)).tableDraws).toBe(1);
      expect(
        await countDrawn(() => {
          answer({ failure: SERVER_FAILURE });
        }),
      ).toEqual({ tableDraws: 1, commits: ["update"] });
    };

  test("a list that fits its card", async () => {
    // Three columns of 200px in a 938px card.
    layOut({ boxWidth: 938, columnWidth: 200 });
    renderListPage();

    await expectEachReadDrawnOnce();
  });

  /*
   * Too wide even at its last step: a card 48rem or wider has no cards to
   * turn to, and these columns do not fold. Its measuring says so again as
   * each page is drawn, and finds nothing new to do about it.
   */
  test("a list too wide for its card even at its last step", async () => {
    // Three columns of 600px in a 900px card.
    layOut({ boxWidth: 900, columnWidth: 600 });
    renderListPage();

    expect(
      (
        await countDrawn(() => {
          answer({ rows: pageOf(1) });
        })
      ).tableDraws,
    ).toBe(1);
    // Rows, scrolling sideways in their card.
    expect(document.querySelector("table")).not.toBeNull();
    expect(screen.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "true",
    );

    for (const page of [2, 3]) {
      expect((await countDrawn(readAgain)).tableDraws).toBe(1);
      expect(
        (
          await countDrawn(() => {
            answer({ rows: pageOf(page) });
          })
        ).tableDraws,
      ).toBe(1);
      expect(rowNames()).toEqual([`Monitor ${page}.1`, `Monitor ${page}.2`]);
    }

    expect(screen.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "true",
    );
  });

  test("a window resized with the card as it was draws nothing, and the next answer once", async () => {
    layOut({ boxWidth: 938, columnWidth: 200 });
    renderListPage();
    await countDrawn(() => {
      answer({ rows: pageOf(1) });
    });

    expect((await countDrawn(resizeWindow)).tableDraws).toBe(0);
    expect((await countDrawn(readAgain)).tableDraws).toBe(1);
    expect(
      await countDrawn(() => {
        answer({ failure: SERVER_FAILURE });
      }),
    ).toEqual({ tableDraws: 1, commits: ["update"] });
  });
});

/*
 * Nothing is lost by asking only when something changed: a card made
 * narrow still turns the rows into cards, and made wide again, back into
 * rows; rows made too wide for their card still scroll sideways.
 */
describe("a list whose card changes width, measured as ever", () => {
  test("a window made narrow turns the rows into cards, and made wide again, back into rows", async () => {
    layOut({ boxWidth: 938, columnWidth: 200 });
    renderListPage();
    await countDrawn(() => {
      answer({ rows: pageOf(1) });
    });
    expect(document.querySelector("table")).not.toBeNull();

    // A phone: cards.
    layout.boxWidth = 342;
    setWindowWidth(390);
    await countDrawn(resizeWindow);
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getAllByText("Monitor 1.1").length).toBeGreaterThan(0);

    // Wide again: rows.
    layout.boxWidth = 938;
    setWindowWidth(1280);
    await countDrawn(resizeWindow);
    expect(document.querySelector("table")).not.toBeNull();
    expect(rowNames()).toEqual(["Monitor 1.1", "Monitor 1.2"]);
  });

  test("columns made wider than the card scroll sideways, and made narrow again, fit", async () => {
    layOut({ boxWidth: 938, columnWidth: 200 });
    renderListPage();
    await countDrawn(() => {
      answer({ rows: pageOf(1) });
    });
    const scrollBox: HTMLElement = screen.getByTestId("table-scroll");
    expect(scrollBox).toHaveAttribute("data-overflowing", "false");

    layout.columnWidth = 600;
    await countDrawn(resizeWindow);
    expect(scrollBox).toHaveAttribute("data-overflowing", "true");

    layout.columnWidth = 200;
    await countDrawn(resizeWindow);
    expect(scrollBox).toHaveAttribute("data-overflowing", "false");
  });
});
