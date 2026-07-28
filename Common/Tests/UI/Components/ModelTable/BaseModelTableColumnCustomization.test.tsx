import "@testing-library/jest-dom/extend-expect";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

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
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Query from "../../../../Types/BaseDatabase/Query";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import UserPreferences, {
  UserPreferenceType,
} from "../../../../Utils/UserPreferences";
import { JSONObject } from "../../../../Types/JSON";

const PREFS_KEY: string = "monitors-columns-table";

type GetListCall = {
  query: Query<Monitor>;
  select: JSONObject;
};

const FILTERS: Array<Filter<Monitor>> = [
  { title: "Name", type: FieldType.Text, field: { name: true } },
] as unknown as Array<Filter<Monitor>>;

type MakeColumnsOptions = {
  // Adds a `isHiddenByDefault` column ("Monitor Type") at the end.
  withHiddenByDefault?: boolean | undefined;
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

  return columns as unknown as Columns<Monitor>;
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

  type MakeCallbacksFunction = () => BaseTableCallbacks<Monitor>;

  const makeCallbacks: MakeCallbacksFunction =
    (): BaseTableCallbacks<Monitor> => {
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
        }): Promise<ListResult<Monitor>> => {
          calls.push({
            query: data.query,
            select: (data.select || {}) as unknown as JSONObject,
          });
          return { data: [], count: 0, skip: 0, limit: data.limit };
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
      callbacks: makeCallbacks(),
      ...(options.disableColumnCustomization
        ? { disableColumnCustomization: true }
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

  beforeEach(() => {
    calls = [];
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
