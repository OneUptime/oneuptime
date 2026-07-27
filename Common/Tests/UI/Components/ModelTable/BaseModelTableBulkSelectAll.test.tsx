import "@testing-library/jest-dom/extend-expect";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * Selecting thousands of rows renders and re-renders a real table several
 * times over, which comfortably outruns the 1s default when the whole suite
 * is competing for the same box. A regression still fails, just later.
 */
configure({ asyncUtilTimeout: 15000 });
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * BaseModelTable pulls in permissions, the current project and the i18n
 * provider. None of those are what these tests are about, so they are stubbed
 * to their permissive/no-op form and the tests focus on one thing: what
 * "Select All" actually asks the API for, and what ends up selected.
 */
jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  BULK_SELECT_ALL_PAGE_SIZE,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableColumnsToCsv from "../../../../UI/Utils/TableColumnsToCsv";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import Query from "../../../../Types/BaseDatabase/Query";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

type GetListCall = {
  query: Query<Monitor>;
  limit: number;
  skip: number;
  sort: JSONObject;
  select: JSONObject;
};

type Row = {
  _id: string;
  name: string;
  description: string;
  createdAt: string;
};

type MakeRowsFunction = (count: number) => Array<Row>;

const makeRows: MakeRowsFunction = (count: number): Array<Row> => {
  const rows: Array<Row> = [];

  for (let i: number = 0; i < count; i++) {
    rows.push({
      _id: `id-${String(i).padStart(6, "0")}`,
      name: `Monitor ${i}`,
      description: `Description ${i}`,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  }

  return rows;
};

const COLUMNS: Array<unknown> = [
  { field: { name: true }, title: "Name", type: FieldType.Text },
  {
    field: { description: true },
    title: "Description",
    type: FieldType.LongText,
  },
];

type CallPredicate = (call: GetListCall) => boolean;

type RenderOptions = {
  rows: Array<Row>;
  /*
   * Matched against each recorded getList call. Predicates rather than call
   * indexes, so that a future extra fetch on mount cannot silently retarget
   * the injected failure at the table's own page request.
   */
  failWhen?: CallPredicate | undefined;
  deferWhen?: CallPredicate | undefined;
  /*
   * Simulates rows being inserted while the selection is being paged: every
   * page after the first is served from `overlapPages` rows earlier than
   * asked, so the boundary rows come back twice.
   */
  overlapPages?: number | undefined;
  /*
   * Serve the analytics shape, where the endpoint skips COUNT(*) and reports
   * `hasMore` with a `count` that is only a lower bound.
   */
  useHasMore?: boolean | undefined;
  selectMoreFields?: JSONObject | undefined;
  query?: Query<Monitor> | undefined;
};

/*
 * The bulk selection pages at BULK_SELECT_ALL_PAGE_SIZE; the table's own page
 * fetches use its (much smaller) page size, so the limit tells them apart.
 */
type IsBulkCallFunction = (call: GetListCall) => boolean;

const isBulkCall: IsBulkCallFunction = (call: GetListCall): boolean => {
  return call.limit === BULK_SELECT_ALL_PAGE_SIZE;
};

describe("BaseModelTable bulk Select All", () => {
  let calls: Array<GetListCall> = [];
  let deferredResolve: (() => void) | null = null;
  let downloadedCsvFiles: Array<{ csv: string; filename: string }> = [];

  type RenderTableFunction = (
    options: RenderOptions,
  ) => ReturnType<typeof render>;

  const renderTable: RenderTableFunction = (
    options: RenderOptions,
  ): ReturnType<typeof render> => {
    const callbacks: BaseTableCallbacks<Monitor> = {
      deleteItem: async () => {
        return undefined;
      },
      getModelFromJSON: (item: JSONObject) => {
        return item as unknown as Monitor;
      },
      getJSONFromModel: (item: Monitor) => {
        return item as unknown as JSONObject;
      },
      addSlugToSelect: (select: unknown) => {
        return select;
      },
      getList: async (data: GetListCall): Promise<ListResult<Monitor>> => {
        const call: GetListCall = {
          query: data.query,
          limit: data.limit,
          skip: data.skip,
          sort: data.sort as unknown as JSONObject,
          select: data.select as unknown as JSONObject,
        };

        calls.push(call);

        if (options.failWhen?.(call)) {
          throw new Error("Select all blew up");
        }

        if (options.deferWhen?.(call)) {
          await new Promise<void>((resolve: () => void) => {
            deferredResolve = resolve;
          });
        }

        const skip: number =
          options.overlapPages && data.skip > 0
            ? Math.max(0, data.skip - options.overlapPages)
            : data.skip;

        const page: Array<Row> = options.rows.slice(skip, skip + data.limit);

        /*
         * The API only returns the fields the caller selected. Honouring that
         * here is what makes these tests able to see the bug at all: a row
         * fetched with `select: { _id: true }` comes back as a bare id with
         * every other field missing.
         */
        const projected: Array<JSONObject> = page.map((row: Row) => {
          const projectedRow: JSONObject = {};

          for (const field of Object.keys(data.select || {})) {
            if (field in row) {
              projectedRow[field] = (row as unknown as JSONObject)[field];
            }
          }

          return projectedRow;
        });

        if (options.useHasMore) {
          const hasMore: boolean = skip + page.length < options.rows.length;

          return {
            data: projected as unknown as Array<Monitor>,
            count: skip + page.length + (hasMore ? 1 : 0),
            hasMore: hasMore,
            skip: data.skip,
            limit: data.limit,
          };
        }

        return {
          data: projected as unknown as Array<Monitor>,
          count: options.rows.length,
          skip: data.skip,
          limit: data.limit,
        };
      },
      toJSONArray: () => {
        return [];
      },
      updateById: async () => {
        return undefined;
      },
      showCreateEditModal: () => {
        return <></>;
      },
    } as unknown as BaseTableCallbacks<Monitor>;

    const props: BaseModelTableProps<Monitor> = {
      modelType: Monitor,
      id: "monitors-table",
      name: "Monitors",
      singularName: "Monitor",
      pluralName: "Monitors",
      userPreferencesKey: "monitors-bulk-table",
      urlStateKey: "monitors-bulk-table",
      columns: COLUMNS,
      filters: [],
      isDeleteable: false,
      isCreateable: false,
      isViewable: false,
      isEditable: false,
      callbacks: callbacks,
      bulkActions: {
        buttons: [
          {
            title: "Archive",
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (): Promise<void> => {
              return Promise.resolve();
            },
          },
        ],
      },
      ...(options.selectMoreFields
        ? { selectMoreFields: options.selectMoreFields }
        : {}),
      ...(options.query ? { query: options.query } : {}),
    } as unknown as BaseModelTableProps<Monitor>;

    return render(<BaseModelTable<Monitor> {...props} />);
  };

  type SelectCurrentPageFunction = (container: HTMLElement) => Promise<void>;

  /*
   * Ticks the header checkbox, which selects the rows on screen and is what
   * makes the bulk bar (and its "Select All" button) appear in the first
   * place.
   */
  const selectCurrentPage: SelectCurrentPageFunction = async (
    container: HTMLElement,
  ): Promise<void> => {
    // The header checkbox is disabled until the first page has rendered.
    await waitFor(() => {
      expect(
        container.querySelectorAll('input[type="checkbox"]:not([disabled])')
          .length,
      ).toBeGreaterThan(0);
    });

    const checkboxes: NodeListOf<HTMLInputElement> =
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

    fireEvent.click(checkboxes[0]!);
  };

  type BulkCallsFunction = () => Array<GetListCall>;

  const bulkCalls: BulkCallsFunction = (): Array<GetListCall> => {
    return calls.filter(isBulkCall);
  };

  const isSelectAllCall: CallPredicate = (call: GetListCall): boolean => {
    return isBulkCall(call);
  };

  // Only the opening page, so later pages resolve on their own.
  const isFirstSelectAllCall: CallPredicate = (call: GetListCall): boolean => {
    return isBulkCall(call) && call.skip === 0;
  };

  beforeEach(() => {
    calls = [];
    deferredResolve = null;
    downloadedCsvFiles = [];
    window.history.replaceState(
      window.history.state,
      "",
      "/dashboard/monitors",
    );
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();

    /*
     * Intercepting the download rather than the Blob keeps the assertion on
     * the exact bytes the user would have opened in a spreadsheet.
     */
    jest
      .spyOn(TableColumnsToCsv, "downloadCsv")
      .mockImplementation((data: { csv: string; filename: string }): void => {
        downloadedCsvFiles.push(data);
      });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("it fetches the same columns as the page fetch, not just _id", async () => {
    /*
     * Regression for the reported bug: "Select All" then "Export CSV"
     * produced a file with a header row and nothing else. Select All asked
     * for `select: { _id: true }`, so every selected row was an id with no
     * fields on it and every exported cell came out empty.
     */
    const { container, getByText } = renderTable({ rows: makeRows(25) });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    const pageSelect: JSONObject = calls[0]!.select;

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(bulkCalls().length).toBe(1);
    });

    const bulkSelect: JSONObject = bulkCalls()[0]!.select;

    // Every column the table renders is fetched for the selection too.
    for (const field of Object.keys(pageSelect)) {
      expect(bulkSelect[field]).toEqual(pageSelect[field]);
    }

    expect(bulkSelect["name"]).toBe(true);
    expect(bulkSelect["description"]).toBe(true);
    expect(bulkSelect["_id"]).toBe(true);
  });

  test("it selects the column it orders by, which the database requires", async () => {
    const { container, getByText } = renderTable({ rows: makeRows(25) });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(bulkCalls().length).toBe(1);
    });

    for (const sortColumn of Object.keys(bulkCalls()[0]!.sort)) {
      expect(bulkCalls()[0]!.select[sortColumn]).toBe(true);
    }
  });

  test("the exported CSV of a select-all carries real values on every row", async () => {
    // More rows than fit on a page, so this cannot pass on the page selection.
    const { container, getByText } = renderTable({ rows: makeRows(25) });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(getByText("25 Monitors Selected")).toBeTruthy();
    });

    fireEvent.click(getByText("Bulk Actions"));
    fireEvent.click(getByText("Export CSV"));

    await waitFor(() => {
      expect(downloadedCsvFiles.length).toBe(1);
    });

    const lines: Array<string> = downloadedCsvFiles[0]!.csv.split("\r\n");

    expect(lines.length).toBe(26);
    expect(lines[0]).toBe("Name,Description");
    expect(lines[1]).toBe("Monitor 0,Description 0");
    expect(lines[25]).toBe("Monitor 24,Description 24");
  });

  test("it selects every matching row, not just the current page", async () => {
    const { container, getByText, queryByText } = renderTable({
      rows: makeRows(1262),
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    // The page holds 10 rows at the default page size.
    expect(getByText("10 Monitors Selected")).toBeTruthy();

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(getByText("1262 Monitors Selected")).toBeTruthy();
    });

    // Everything is selected, so there is nothing left for the button to do.
    expect(queryByText("Select All Monitors")).toBeNull();
  });

  test("it pages the fetch instead of asking for everything at once", async () => {
    const { container, getByText } = renderTable({ rows: makeRows(1262) });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(getByText("1262 Monitors Selected")).toBeTruthy();
    });

    expect(
      bulkCalls().map((call: GetListCall) => {
        return call.skip;
      }),
    ).toEqual([0, BULK_SELECT_ALL_PAGE_SIZE]);
  });

  test("it stops at the first short page", async () => {
    const { container, getByText } = renderTable({ rows: makeRows(300) });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(getByText("300 Monitors Selected")).toBeTruthy();
    });

    expect(bulkCalls().length).toBe(1);
  });

  test("it does not spend a round trip proving an exact multiple is finished", async () => {
    /*
     * Every list request also runs an unbounded count over the filtered set,
     * so the empty page at the end is not free.
     */
    const { container, getByText } = renderTable({
      rows: makeRows(BULK_SELECT_ALL_PAGE_SIZE * 2),
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(
        getByText(`${BULK_SELECT_ALL_PAGE_SIZE * 2} Monitors Selected`),
      ).toBeTruthy();
    });

    expect(bulkCalls().length).toBe(2);
  });

  test("it stops on hasMore for endpoints that report no exact count", async () => {
    const { container, getByText, queryByText } = renderTable({
      rows: makeRows(BULK_SELECT_ALL_PAGE_SIZE),
      useHasMore: true,
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(
        getByText(`${BULK_SELECT_ALL_PAGE_SIZE} Monitors Selected`),
      ).toBeTruthy();
    });

    expect(bulkCalls().length).toBe(1);
    // Nothing was left behind, so there is nothing to warn about.
    expect(queryByText(/matching Monitors/)).toBeNull();
  });

  test("a row served twice across pages is only selected once", async () => {
    /*
     * Offset paging over a table that is still taking writes can hand back a
     * row an earlier page already returned. Selecting it twice would
     * duplicate it in the export and inflate the count.
     */
    const { container, getByText } = renderTable({
      rows: makeRows(1262),
      overlapPages: 5,
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(getByText("1262 Monitors Selected")).toBeTruthy();
    });

    fireEvent.click(getByText("Bulk Actions"));
    fireEvent.click(getByText("Export CSV"));

    await waitFor(() => {
      expect(downloadedCsvFiles.length).toBe(1);
    });

    const lines: Array<string> = downloadedCsvFiles[0]!.csv.split("\r\n");

    expect(lines.length).toBe(1263);
    expect(new Set(lines.slice(1)).size).toBe(1262);
  });

  test("an unsorted table keeps the order it is displayed in", async () => {
    /*
     * The API only applies its default ordering when no sort is sent, so the
     * selection has to name that ordering itself - otherwise a select-all
     * exports in an order unrelated to the table, and a selection capped at
     * the ceiling keeps an arbitrary slice instead of the newest rows.
     */
    const { container, getByText } = renderTable({ rows: makeRows(25) });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(bulkCalls().length).toBe(1);
    });

    expect(bulkCalls()[0]!.sort).toEqual({
      createdAt: SortOrder.Descending,
      _id: SortOrder.Ascending,
    });
  });

  test("an active column sort is kept, with the id appended as a tiebreaker", async () => {
    const { container, getByText } = renderTable({ rows: makeRows(25) });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    // Sorting by the "Name" header puts a sort on the table.
    fireEvent.click(getByText("Name"));

    await waitFor(() => {
      expect(calls[calls.length - 1]!.sort).toEqual({
        name: SortOrder.Descending,
      });
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(bulkCalls().length).toBe(1);
    });

    expect(bulkCalls()[0]!.sort).toEqual({
      name: SortOrder.Descending,
      _id: SortOrder.Ascending,
    });
  });

  test("it carries the table's query so it never selects outside the filters", async () => {
    const query: Query<Monitor> = {
      projectId: "project-1",
    } as unknown as Query<Monitor>;

    const { container, getByText } = renderTable({
      rows: makeRows(25),
      query: query,
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(bulkCalls().length).toBe(1);
    });

    expect(bulkCalls()[0]!.query).toEqual(calls[0]!.query);
    expect(bulkCalls()[0]!.query["projectId"]).toBe("project-1");
  });

  test("it honours selectMoreFields, which a hand-rolled column list would drop", async () => {
    const { container, getByText } = renderTable({
      rows: makeRows(25),
      selectMoreFields: { monitorType: true },
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(bulkCalls().length).toBe(1);
    });

    expect(bulkCalls()[0]!.select["monitorType"]).toBe(true);
  });

  test("it stops at the selection ceiling and says so", async () => {
    const { container, getByText } = renderTable({
      rows: makeRows(LIMIT_PER_PROJECT + 250),
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(getByText(`${LIMIT_PER_PROJECT} Monitors Selected`)).toBeTruthy();
    });

    expect(bulkCalls().length).toBe(
      LIMIT_PER_PROJECT / BULK_SELECT_ALL_PAGE_SIZE,
    );

    // The warning names the real numbers rather than inferring truncation.
    expect(
      getByText(
        new RegExp(
          `Selected ${LIMIT_PER_PROJECT.toLocaleString()} of ${(
            LIMIT_PER_PROJECT + 250
          ).toLocaleString()} matching Monitors`,
        ),
      ),
    ).toBeTruthy();
  });

  test("it does not warn about truncation when everything was selected", async () => {
    const { container, getByText, queryByText } = renderTable({
      rows: makeRows(25),
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(getByText("25 Monitors Selected")).toBeTruthy();
    });

    expect(queryByText(/matching Monitors/)).toBeNull();
  });

  test("a failed select-all keeps the previous selection and stays retryable", async () => {
    /*
     * The failure mode behind "even though I selected Select All, only the
     * records on the current page are selected": the request failed, the
     * error was swallowed, and the bulk bar hid the Select All button while
     * still holding just the page rows.
     */
    const { container, getByText, queryByText } = renderTable({
      rows: makeRows(1262),
      failWhen: isSelectAllCall,
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(getByText("Select all blew up")).toBeTruthy();
    });

    // The page selection survived untouched...
    expect(getByText("10 Monitors Selected")).toBeTruthy();
    // ...and the button is still there to try again.
    expect(queryByText("Select All Monitors")).not.toBeNull();
  });

  test("a failed select-all can be retried, and the error goes away", async () => {
    let shouldFail: boolean = true;

    const { container, getByText, queryByText } = renderTable({
      rows: makeRows(1262),
      failWhen: (call: GetListCall): boolean => {
        return isSelectAllCall(call) && shouldFail;
      },
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(getByText("Select all blew up")).toBeTruthy();
    });

    shouldFail = false;

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(getByText("1262 Monitors Selected")).toBeTruthy();
    });

    // A stale failure banner under a complete selection would be a lie.
    expect(queryByText("Select all blew up")).toBeNull();
  });

  test("it reports progress and blocks a second run while it is loading", async () => {
    const { container, getByText, queryByText } = renderTable({
      rows: makeRows(1262),
      deferWhen: isFirstSelectAllCall,
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(getByText("Selecting All Monitors...")).toBeTruthy();
    });

    // A second click while it runs must not start an overlapping fetch.
    fireEvent.click(getByText("Selecting All Monitors..."));

    await act(async () => {
      deferredResolve!();
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 50);
      });
    });

    await waitFor(() => {
      expect(getByText("1262 Monitors Selected")).toBeTruthy();
    });

    expect(queryByText("Selecting All Monitors...")).toBeNull();
    expect(bulkCalls().length).toBe(2);
  });

  test("clearing the selection wins over a select-all still in flight", async () => {
    const { container, getByText, queryByText } = renderTable({
      rows: makeRows(1262),
      deferWhen: isFirstSelectAllCall,
    });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Select All Monitors"));

    await waitFor(() => {
      expect(deferredResolve).not.toBeNull();
    });

    fireEvent.click(getByText("Clear Selection"));

    // The bulk bar is gone once nothing is selected.
    await waitFor(() => {
      expect(queryByText("Clear Selection")).toBeNull();
    });

    await act(async () => {
      deferredResolve!();
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 50);
      });
    });

    // The superseded run must not resurrect a selection the user cleared...
    expect(queryByText(/Monitors Selected/)).toBeNull();
    // ...nor keep paging for it.
    expect(bulkCalls().length).toBe(1);
  });

  test("selecting only the current page still exports just those rows", async () => {
    const { container, getByText } = renderTable({ rows: makeRows(25) });

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await selectCurrentPage(container);

    fireEvent.click(getByText("Bulk Actions"));
    fireEvent.click(getByText("Export CSV"));

    await waitFor(() => {
      expect(downloadedCsvFiles.length).toBe(1);
    });

    const lines: Array<string> = downloadedCsvFiles[0]!.csv.split("\r\n");

    // Header plus the ten rows on screen.
    expect(lines.length).toBe(11);
    expect(lines[1]).toBe("Monitor 0,Description 0");
  });
});
