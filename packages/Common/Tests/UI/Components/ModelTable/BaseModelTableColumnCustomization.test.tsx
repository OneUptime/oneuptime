import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * A real BaseModelTable mounts a card, a header, a full table and (in the
 * picker tests) a modal on top of that. That comfortably outruns the 1s
 * default when the whole Common suite is competing for the same box. A
 * regression still fails, just later.
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
 * to their permissive/no-op form and the tests focus on one thing: the column
 * layout a viewer chose, and how it survives the round trip through
 * localStorage into the rendered <th> cells.
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
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import Columns from "../../../../UI/Components/ModelTable/Columns";
import TableColumnsToCsv from "../../../../UI/Utils/TableColumnsToCsv";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Query from "../../../../Types/BaseDatabase/Query";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import UserPreferences, {
  UserPreferenceType,
} from "../../../../Utils/UserPreferences";
import { JSONObject, JSONValue } from "../../../../Types/JSON";

const PREFS_KEY: string = "monitors-columns-table";

type GetListCall = {
  query: Query<Monitor>;
  select: JSONObject;
  sort: JSONObject;
};

type DownloadedCsvFile = {
  csv: string;
  filename: string;
};

const FILTERS: Array<Filter<Monitor>> = [
  { title: "Name", type: FieldType.Text, field: { name: true } },
] as unknown as Array<Filter<Monitor>>;

type MakeColumnsOptions = {
  // Adds a `isHiddenByDefault` column ("Monitor Type") at the end.
  withHiddenByDefault?: boolean | undefined;
  /*
   * Adds a `isHiddenByDefault` *entity* column ("Template") at the end, shaped
   * like the one on the real Monitors table: several nested fields, and a cell
   * rendered from the relation rather than from a scalar on the row. A scalar
   * column cannot stand in for it - the nested part of the request is built by
   * a different function, and the cell it feeds is the one that goes blank.
   */
  withHiddenByDefaultEntity?: boolean | undefined;
  // Marks "Name" `isNotCustomizable`, i.e. pinned and kept out of the picker.
  pinName?: boolean | undefined;
};

type MakeColumnsFunction = (options?: MakeColumnsOptions) => Columns<Monitor>;

/*
 * Real Monitor columns, not placeholders: the ids the layout is keyed on are
 * derived from the declared `field`, so a table of fake columns would not
 * exercise the same id derivation the app does.
 */
const makeColumns: MakeColumnsFunction = (
  options: MakeColumnsOptions = {},
): Columns<Monitor> => {
  const columns: Array<unknown> = [
    {
      field: { name: true },
      title: "Name",
      type: FieldType.Text,
      ...(options.pinName ? { isNotCustomizable: true } : {}),
    },
    {
      field: { description: true },
      title: "Description",
      type: FieldType.LongText,
    },
    {
      field: { currentMonitorStatus: { name: true } },
      title: "Monitor Status",
      type: FieldType.Entity,
    },
    {
      field: { labels: { name: true } },
      title: "Labels",
      type: FieldType.EntityArray,
    },
  ];

  if (options.withHiddenByDefault) {
    columns.push({
      field: { monitorType: true },
      title: "Monitor Type",
      type: FieldType.Text,
      isHiddenByDefault: true,
    });
  }

  if (options.withHiddenByDefaultEntity) {
    columns.push({
      field: { monitorTemplate: { _id: true, templateName: true } },
      title: "Template",
      type: FieldType.Entity,
      isHiddenByDefault: true,
      getElement: (item: Monitor): ReactElement => {
        return <span>{item.monitorTemplate?.templateName || ""}</span>;
      },
    });
  }

  return columns as unknown as Columns<Monitor>;
};

const TEMPLATE_NAME: string = "Standard HTTP Template";

/*
 * One fully populated row. The relation is nested exactly as the API returns
 * it, because the point of these tests is what survives the round trip from
 * the request's `select` into the rendered cell.
 */
const ROWS: Array<JSONObject> = [
  {
    _id: "monitor-1",
    name: "api-gateway",
    description: "The public API gateway",
    monitorTemplate: {
      _id: "template-1",
      templateName: TEMPLATE_NAME,
    },
  },
];

type ProjectRowFunction = (row: JSONObject, select: JSONObject) => JSONObject;

/*
 * The API hands back exactly the fields the request asked for and nothing
 * else, so the fake has to as well. A fake that returned the whole row
 * whatever the select said would keep rendering a value for a field the table
 * had stopped asking for - which is precisely the regression these tests are
 * here to catch.
 */
const projectRow: ProjectRowFunction = (
  row: JSONObject,
  select: JSONObject,
): JSONObject => {
  const projected: JSONObject = {};

  for (const key of Object.keys(select)) {
    const value: JSONValue | undefined = row[key];
    const selected: JSONValue | undefined = select[key];

    if (value === undefined) {
      continue;
    }

    // A nested select projects the relation, not just the presence of it.
    if (
      selected !== null &&
      typeof selected === "object" &&
      value !== null &&
      typeof value === "object"
    ) {
      projected[key] = projectRow(value as JSONObject, selected as JSONObject);
      continue;
    }

    projected[key] = value;
  }

  return projected;
};

const ALL_TITLES: Array<string> = [
  "Name",
  "Description",
  "Monitor Status",
  "Labels",
];

type SeedPreferenceFunction = (data: {
  key: string;
  order: Array<string>;
  hidden: Array<string>;
}) => void;

/*
 * Written through UserPreferences rather than localStorage directly, so the
 * key derivation the table reads with is the same one the test writes with.
 */
const seedPreference: SeedPreferenceFunction = (data: {
  key: string;
  order: Array<string>;
  hidden: Array<string>;
}): void => {
  UserPreferences.saveUserPreferenceByTypeAsJSON({
    key: data.key,
    userPreferenceType: UserPreferenceType.BaseModelTableColumns,
    value: { order: data.order, hidden: data.hidden },
  });
};

type ReadPreferenceFunction = (key: string) => JSONObject | null;

const readPreference: ReadPreferenceFunction = (
  key: string,
): JSONObject | null => {
  return UserPreferences.getUserPreferenceByTypeAsJSON({
    key: key,
    userPreferenceType: UserPreferenceType.BaseModelTableColumns,
  });
};

type GetHeadersFunction = () => Array<string>;

const getHeaders: GetHeadersFunction = (): Array<string> => {
  return screen.getAllByRole("columnheader").map((header: HTMLElement) => {
    return (header.textContent || "").trim();
  });
};

type GetPickerRowIdsFunction = () => Array<string>;

/*
 * One checkbox per row in the picker, each tagged with the column id the
 * layout is stored under.
 */
const getPickerRowIds: GetPickerRowIdsFunction = (): Array<string> => {
  const modal: HTMLElement = screen.getByTestId("column-customization-modal");

  return Array.from(
    modal.querySelectorAll('[data-testid^="column-toggle-"]'),
  ).map((element: Element) => {
    return (element.getAttribute("data-testid") || "").replace(
      "column-toggle-",
      "",
    );
  });
};

describe("BaseModelTable column customization", () => {
  let calls: Array<GetListCall> = [];
  let downloadedCsvFiles: Array<DownloadedCsvFile> = [];

  type MakeCallbacksFunction = (
    rows: Array<JSONObject>,
  ) => BaseTableCallbacks<Monitor>;

  const makeCallbacks: MakeCallbacksFunction = (
    rows: Array<JSONObject>,
  ): BaseTableCallbacks<Monitor> => {
    return {
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
      getList: async (data: {
        query: Query<Monitor>;
        limit: number;
        select: JSONObject;
        sort: JSONObject;
      }): Promise<ListResult<Monitor>> => {
        const select: JSONObject = (data.select || {}) as unknown as JSONObject;

        calls.push({
          query: data.query,
          select: select,
          sort: (data.sort || {}) as unknown as JSONObject,
        });

        return {
          data: rows.map((row: JSONObject) => {
            return projectRow(row, select);
          }) as unknown as Array<Monitor>,
          count: rows.length,
          skip: 0,
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
  };

  type RenderTableOptions = {
    userPreferencesKey?: string | undefined;
    columns?: Columns<Monitor> | undefined;
    isDeleteable?: boolean | undefined;
    disableColumnCustomization?: boolean | undefined;
    /*
     * The rows the fake API has. Defaults to none, as most of this suite only
     * looks at headers.
     */
    rows?: Array<JSONObject> | undefined;
    /*
     * Gives the table a bulk action. Table grows its row checkboxes - and
     * offers "Export CSV" - only when this array is non-empty, so it is the
     * only way to reach the export from here.
     */
    withBulkActions?: boolean | undefined;
  };

  type RenderTableFunction = (
    options?: RenderTableOptions,
  ) => ReturnType<typeof render>;

  const renderTable: RenderTableFunction = (
    options: RenderTableOptions = {},
  ): ReturnType<typeof render> => {
    const props: BaseModelTableProps<Monitor> = {
      modelType: Monitor,
      id: "monitors-table",
      name: "Monitors",
      userPreferencesKey: options.userPreferencesKey || PREFS_KEY,
      /*
       * The Columns control lives in the card header, and BaseModelTable only
       * renders a header at all when cardProps is set.
       */
      cardProps: { title: "Monitors" },
      columns: options.columns || makeColumns(),
      filters: FILTERS,
      isDeleteable: Boolean(options.isDeleteable),
      isCreateable: false,
      isViewable: false,
      isEditable: false,
      // This suite is about columns; keep the URL out of it entirely.
      disableUrlState: true,
      callbacks: makeCallbacks(options.rows || []),
      ...(options.disableColumnCustomization
        ? { disableColumnCustomization: true }
        : {}),
      ...(options.withBulkActions
        ? {
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
          }
        : {}),
    } as unknown as BaseModelTableProps<Monitor>;

    return render(<BaseModelTable<Monitor> {...props} />);
  };

  type WaitForTableFunction = () => Promise<void>;

  const waitForTable: WaitForTableFunction = async (): Promise<void> => {
    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
    });
  };

  type WaitForCallCountFunction = (count: number) => Promise<void>;

  const waitForCallCount: WaitForCallCountFunction = async (
    count: number,
  ): Promise<void> => {
    await waitFor(() => {
      expect(calls.length).toBe(count);
    });
  };

  type SortByColumnFunction = (title: string) => Promise<void>;

  /*
   * The real click path for sorting: the header cell is a button, so this is
   * what a viewer does, and it drives the same sortBy/sortOrder state the
   * picker later has to reason about.
   */
  const sortByColumn: SortByColumnFunction = async (
    title: string,
  ): Promise<void> => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: title }));
    });
  };

  type OpenPickerFunction = () => Promise<void>;

  /*
   * The real click path. The Columns control is an icon-only card button, and
   * every non-primary card button is folded into the "⋯" overflow menu, where
   * it is labelled from its icon — so the viewer reaches it in two clicks.
   */
  const openPicker: OpenPickerFunction = async (): Promise<void> => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Columns"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("column-customization-modal")).not.toBeNull();
    });
  };

  type ClickFunction = (element: HTMLElement) => Promise<void>;

  const click: ClickFunction = async (element: HTMLElement): Promise<void> => {
    await act(async () => {
      fireEvent.click(element);
    });
  };

  type SavePickerFunction = () => Promise<void>;

  const savePicker: SavePickerFunction = async (): Promise<void> => {
    await click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("column-customization-modal")).toBeNull();
    });
  };

  type SelectRowsFunction = (container: HTMLElement) => Promise<void>;

  /*
   * Ticks the header checkbox, which selects every row on the page and is what
   * puts the bulk bar - and with it "Export CSV" - on screen at all.
   */
  const selectRows: SelectRowsFunction = async (
    container: HTMLElement,
  ): Promise<void> => {
    // The header checkbox is disabled until the first page has rendered.
    await waitFor(() => {
      expect(
        container.querySelectorAll('input[type="checkbox"]:not([disabled])')
          .length,
      ).toBeGreaterThan(0);
    });

    await click(
      container.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      )[0]!,
    );
  };

  type ExportCsvFunction = () => Promise<Array<string>>;

  /*
   * The real click path, run end to end and read back as the lines a viewer
   * would open in a spreadsheet. Every bulk action lives behind the bulk bar's
   * "Bulk Actions" menu, so the export takes two clicks. Intercepted at the
   * download rather than at the Blob, so the assertions are on the exact bytes
   * that would have been written to disk.
   */
  const exportCsv: ExportCsvFunction = async (): Promise<Array<string>> => {
    await click(screen.getByText("Bulk Actions"));

    await waitFor(() => {
      expect(screen.queryByText("Export CSV")).not.toBeNull();
    });

    await click(screen.getByText("Export CSV"));

    await waitFor(() => {
      expect(downloadedCsvFiles.length).toBe(1);
    });

    return (downloadedCsvFiles[0]?.csv || "").split("\r\n");
  };

  beforeEach(() => {
    calls = [];
    downloadedCsvFiles = [];

    jest
      .spyOn(TableColumnsToCsv, "downloadCsv")
      .mockImplementation((data: DownloadedCsvFile): void => {
        downloadedCsvFiles.push(data);
      });

    window.history.replaceState(
      window.history.state,
      "",
      "/dashboard/monitors",
    );
    TableFilterUrlState.resetClaimedKeys();
    /*
     * The whole point of this suite is what the table reads out of
     * localStorage on mount, and the runner shares one jsdom across files.
     */
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("rendering the declared layout", () => {
    test("renders every declared column, in declared order", async () => {
      renderTable({ columns: makeColumns({ withHiddenByDefault: true }) });

      await waitForTable();

      /*
       * `isHiddenByDefault` is the table author saying "useful, but not worth
       * the horizontal space" — it must not show up until someone asks for it
       * in the picker.
       */
      expect(getHeaders()).toEqual(ALL_TITLES);
    });

    test("a stored layout is applied on the very first paint", async () => {
      seedPreference({
        key: PREFS_KEY,
        order: ["labels", "currentMonitorStatus", "description", "name"],
        hidden: ["description"],
      });

      renderTable();

      await waitForTable();

      /*
       * Both halves of the layout at once: Description is gone, and what is
       * left follows the stored order rather than the declared one. Read
       * during render, not in an effect, so there is no flash of the default
       * layout first.
       */
      expect(getHeaders()).toEqual(["Labels", "Monitor Status", "Name"]);
    });

    test("a layout stored for another table does not leak into this one", async () => {
      seedPreference({
        key: "some-other-table",
        order: ["name"],
        hidden: ["description", "labels"],
      });

      renderTable();

      await waitForTable();

      expect(getHeaders()).toEqual(ALL_TITLES);
    });

    test("a stale layout naming columns that no longer exist is ignored", async () => {
      /*
       * A stored layout outlives the release that wrote it. If a dropped
       * column's id could still take part, a table could be left permanently
       * mis-ordered - or, worse, with everything hidden - by a layout the
       * viewer has no way to reason about.
       */
      seedPreference({
        key: PREFS_KEY,
        order: ["monitorSteps", "incomingRequestReceivedAt", "ghost-column"],
        hidden: ["monitorSteps", "ghost-column"],
      });

      renderTable();

      await waitForTable();

      expect(getHeaders()).toEqual(ALL_TITLES);
    });

    test("disableColumnCustomization ignores a stored layout entirely", async () => {
      seedPreference({
        key: PREFS_KEY,
        order: ["labels", "name"],
        hidden: ["description", "currentMonitorStatus"],
      });

      renderTable({ disableColumnCustomization: true });

      await waitForTable();

      /*
       * Tables opt out when their layout is load-bearing. Honouring a stored
       * layout there would break the surrounding page, and the viewer would
       * have no control to undo it with - the Columns button is gone too.
       */
      expect(getHeaders()).toEqual(ALL_TITLES);
      expect(
        screen.queryByRole("button", { name: "More options" }),
      ).not.toBeNull();
      expect(screen.queryByText("Columns")).toBeNull();
    });
  });

  describe("what hiding a column does NOT do", () => {
    test("a hidden column's field is still selected from the API", async () => {
      seedPreference({
        key: PREFS_KEY,
        order: ["name", "description", "currentMonitorStatus", "labels"],
        hidden: ["description"],
      });

      renderTable();

      await waitForTable();

      expect(getHeaders()).not.toContain("Description");

      /*
       * Deliberate: a *visible* column's getElement is arbitrary caller code
       * that may read a hidden column's field, and nothing can detect that
       * statically. Narrowing the select to what is on screen would therefore
       * silently blank some other cell. The cost is a few unused fields on the
       * wire; this test is the guard on that trade.
       */
      expect(calls[0]?.select["description"]).toBe(true);
      expect(calls[0]?.select["name"]).toBe(true);
    });

    test("a hidden entity column's relation is still selected, in full", async () => {
      /*
       * "monitorTemplate" is deliberately absent from the stored order: a
       * column the layout does not mention falls back to its declared
       * default, so this covers both ways an entity column ends up off
       * screen - the viewer switched it off, and the table ships it off.
       */
      seedPreference({
        key: PREFS_KEY,
        order: ["name", "description", "currentMonitorStatus", "labels"],
        hidden: ["currentMonitorStatus"],
      });

      renderTable({
        columns: makeColumns({ withHiddenByDefaultEntity: true }),
      });

      await waitForTable();

      expect(getHeaders()).not.toContain("Monitor Status");
      expect(getHeaders()).not.toContain("Template");

      /*
       * A relation is not selected by naming it - it is selected by the shape
       * nested under it, and that shape is built by a *different* function
       * (getRelationSelectFromColumns) with its own reference to the full
       * column set. Narrowing only that one would leave every scalar
       * assertion in this file green while every hidden entity cell came back
       * as a bare id, so the column would paint blank the moment a viewer
       * switched it on. Deep equality, because dropping the second key of a
       * multi-field relation is the same bug one field smaller.
       */
      expect(calls[0]?.select["currentMonitorStatus"]).toEqual({ name: true });
      expect(calls[0]?.select["monitorTemplate"]).toEqual({
        _id: true,
        templateName: true,
      });
    });

    test("a column that ships hidden is selected even with no stored layout", async () => {
      renderTable({ columns: makeColumns({ withHiddenByDefault: true }) });

      await waitForTable();

      /*
       * Hidden because the table author said so, not because this viewer
       * chose it - there is nothing in localStorage at all. The two states
       * reach the same select today, and an optimisation that only widened
       * the request "when the viewer has a stored layout" would look
       * perfectly reasonable and would break exactly the shipped default,
       * which is the state almost every viewer is in.
       */
      expect(getHeaders()).not.toContain("Monitor Type");
      expect(readPreference(PREFS_KEY)).toBeNull();
      expect(calls[0]?.select["monitorType"]).toBe(true);
    });
  });

  describe("switching a hidden column back on", () => {
    test("paints its value without asking the API again", async () => {
      renderTable({
        columns: makeColumns({ withHiddenByDefaultEntity: true }),
        rows: ROWS,
      });

      await waitForTable();

      expect(getHeaders()).not.toContain("Template");
      expect(screen.queryByText(TEMPLATE_NAME)).toBeNull();

      const callsBefore: number = calls.length;

      await openPicker();
      await click(screen.getByTestId("column-toggle-monitorTemplate"));
      await savePicker();

      await waitFor(() => {
        expect(getHeaders()).toContain("Template");
      });

      /*
       * The whole contract this table's hidden columns rest on, in one test.
       *
       * The request is built from the DECLARED columns, never the visible
       * ones, and the fetch effect does not depend on the column set - so a
       * column the viewer switches on is painted from the page already in
       * hand, with its relation intact and no spinner. Wire the request up to
       * the visible columns instead (there is a preference-filtered
       * `selectFields` sitting unused in serializeToTableColumns that invites
       * exactly that) and this cell comes back empty, with nothing to refetch
       * it: the viewer's click would produce a column of blanks.
       */
      expect(screen.getByText(TEMPLATE_NAME)).toBeInTheDocument();
      expect(calls.length).toBe(callsBefore);
    });
  });

  describe("what the viewer's layout does to the CSV export", () => {
    test("a column that ships hidden is not in the exported file", async () => {
      const { container } = renderTable({
        columns: makeColumns({ withHiddenByDefaultEntity: true }),
        rows: ROWS,
        withBulkActions: true,
      });

      await waitForTable();

      await selectRows(container);

      const lines: Array<string> = await exportCsv();

      /*
       * "Export what you see". The export is built from the table's own
       * column set, so a column the table ships switched off has no header
       * and no cell in the file.
       *
       * This is the one assertion in the suite that is about data leaving the
       * product rather than about pixels. Every other test here is happy for
       * a hidden column's field to be fetched - it has to be, or switching
       * the column on would paint blanks - so the row in memory is carrying
       * the relation the whole time. Only the column filtering keeps it out
       * of a file the viewer opens, mails and uploads.
       *
       * Build the Table columns from the unfiltered `allColumns` instead of
       * the preference-filtered `columnsToRender` in serializeToTableColumns
       * - a one-word change, and the first thing anyone would reach for after
       * a ticket saying "the CSV lost my Template column" - and every table
       * in the app starts exporting columns nobody asked to see.
       */
      expect(lines[0]).toBe("Name,Description,Monitor Status,Labels");
      expect(lines[1]).toBe("api-gateway,The public API gateway,,");
      expect(lines.join("\r\n")).not.toContain(TEMPLATE_NAME);
    });

    test("switching it on puts it in the exported file", async () => {
      const { container } = renderTable({
        columns: makeColumns({ withHiddenByDefaultEntity: true }),
        rows: ROWS,
        withBulkActions: true,
      });

      await waitForTable();

      await openPicker();
      await click(screen.getByTestId("column-toggle-monitorTemplate"));
      await savePicker();

      await waitFor(() => {
        expect(getHeaders()).toContain("Template");
      });

      await selectRows(container);

      const lines: Array<string> = await exportCsv();

      /*
       * The other half of the same contract, and the reason the test above
       * cannot be satisfied by simply never exporting an `isHiddenByDefault`
       * column: the file follows this viewer's layout, not the table author's
       * default. Someone who switches Template on has almost certainly done
       * it *because* they want it in the export, and freezing the export
       * columns at the shipped default would hand them a file missing the one
       * column they went to the picker for.
       */
      expect(lines[0]).toBe("Name,Description,Monitor Status,Labels,Template");
      expect(lines[1]).toContain(TEMPLATE_NAME);
    });
  });

  describe("the sort a hidden column leaves behind", () => {
    test("showing a column does not refetch; hiding the sorted one does", async () => {
      renderTable({
        columns: makeColumns({ withHiddenByDefaultEntity: true }),
        rows: ROWS,
      });

      await waitForTable();

      await sortByColumn("Description");
      await waitForCallCount(2);
      expect(calls[1]?.sort).toEqual({
        description: SortOrder.Descending,
      });

      await openPicker();
      await click(screen.getByTestId("column-toggle-monitorTemplate"));
      await savePicker();

      await waitFor(() => {
        expect(getHeaders()).toContain("Template");
      });

      /*
       * Adding a column changes nothing the server was asked for, so the
       * guard in onColumnCustomizationSave has to leave the sort alone. A
       * reset-on-every-save would throw the viewer's ordering away - and
       * their page - every time they ticked a box.
       */
      expect(calls.length).toBe(2);
      expect(screen.getByText(TEMPLATE_NAME)).toBeInTheDocument();

      await openPicker();
      await click(screen.getByTestId("column-toggle-description"));
      await savePicker();

      await waitFor(() => {
        expect(getHeaders()).not.toContain("Description");
      });

      /*
       * Hiding the column the table is sorted by is different: the header
       * that ordering came from is gone, so the viewer can neither see it nor
       * click it off. The sort falls back to the table's default (here: none)
       * and the page is refetched, rather than leaving them staring at rows
       * in an order they cannot explain or undo.
       */
      await waitForCallCount(3);
      expect(calls[2]?.sort).toEqual({});
    });
  });

  describe("the generated Actions column", () => {
    test("stays last however the viewer reorders, and is not in the picker", async () => {
      seedPreference({
        key: PREFS_KEY,
        order: ["labels", "currentMonitorStatus", "description", "name"],
        hidden: [],
      });

      renderTable({ isDeleteable: true });

      await waitForTable();

      const headers: Array<string> = getHeaders();

      expect(headers).toEqual([
        "Labels",
        "Monitor Status",
        "Description",
        "Name",
        "Actions",
      ]);

      /*
       * Actions is generated, not declared, and the row buttons it holds are
       * right-aligned against the edge of the table. It is not the viewer's to
       * move or switch off, so the layout is applied to the *input* of the
       * column build rather than to the finished array.
       */
      expect(headers[headers.length - 1]).toBe("Actions");

      await openPicker();

      expect(getPickerRowIds()).toEqual([
        "labels",
        "currentMonitorStatus",
        "description",
        "name",
      ]);
      expect(
        screen
          .getByTestId("column-customization-modal")
          .textContent?.includes("Actions"),
      ).toBe(false);
    });
  });

  describe("the picker", () => {
    test("opens from the card header with a row per customizable column", async () => {
      renderTable({
        columns: makeColumns({ withHiddenByDefault: true, pinName: true }),
      });

      await waitForTable();

      await openPicker();

      /*
       * Name is pinned (`isNotCustomizable`), so it is not offered: a table
       * must never be customizable into anonymity. Monitor Type is offered
       * even though it starts hidden - that is the only way to switch it on.
       */
      expect(getPickerRowIds()).toEqual([
        "description",
        "currentMonitorStatus",
        "labels",
        "monitorType",
      ]);

      expect(
        screen.getByTestId("column-customization-count").textContent,
      ).toContain("3 of 4 columns shown");
    });

    test("saving a change updates the table and stores the layout", async () => {
      renderTable();

      await waitForTable();
      expect(getHeaders()).toEqual(ALL_TITLES);

      await openPicker();
      await click(screen.getByTestId("column-toggle-description"));
      await savePicker();

      await waitFor(() => {
        expect(getHeaders()).toEqual(["Name", "Monitor Status", "Labels"]);
      });

      const stored: JSONObject | null = readPreference(PREFS_KEY);

      expect(stored).not.toBeNull();
      expect(stored?.["hidden"]).toEqual(["description"]);
      expect(stored?.["order"]).toEqual([
        "name",
        "description",
        "currentMonitorStatus",
        "labels",
      ]);
    });

    test("saving a layout identical to the default stores nothing", async () => {
      renderTable({ columns: makeColumns({ withHiddenByDefault: true }) });

      await waitForTable();

      await openPicker();
      await savePicker();

      /*
       * Otherwise every table anyone ever opened the picker on would be pinned
       * to the column set of the release they opened it in, and a column
       * shipped later would arrive already stale - present in the code, absent
       * from every viewer's stored order.
       */
      expect(readPreference(PREFS_KEY)).toBeNull();
      expect(
        window.localStorage.getItem(
          `${UserPreferenceType.BaseModelTableColumns}.${PREFS_KEY}`,
        ),
      ).toBeNull();

      expect(getHeaders()).toEqual(ALL_TITLES);
    });

    test("Reset drops the stored layout and restores the declared columns", async () => {
      seedPreference({
        key: PREFS_KEY,
        order: ["labels", "name", "currentMonitorStatus", "description"],
        hidden: ["description"],
      });

      renderTable();

      await waitForTable();
      expect(getHeaders()).toEqual(["Labels", "Name", "Monitor Status"]);

      await openPicker();
      await click(screen.getByTestId("column-customization-reset"));

      await waitFor(() => {
        expect(screen.queryByTestId("column-customization-modal")).toBeNull();
      });

      await waitFor(() => {
        expect(getHeaders()).toEqual(ALL_TITLES);
      });

      expect(readPreference(PREFS_KEY)).toBeNull();
    });
  });

  describe("persistence across a remount", () => {
    test("a layout saved from the picker is still there on the next visit", async () => {
      const view: ReturnType<typeof render> = renderTable();

      await waitForTable();

      await openPicker();
      await click(screen.getByTestId("column-toggle-labels"));
      await savePicker();

      await waitFor(() => {
        expect(getHeaders()).toEqual(["Name", "Description", "Monitor Status"]);
      });

      view.unmount();
      calls = [];

      // Same userPreferencesKey: this is the viewer coming back to the page.
      renderTable();

      await waitForTable();

      expect(getHeaders()).toEqual(["Name", "Description", "Monitor Status"]);
    });
  });
});
