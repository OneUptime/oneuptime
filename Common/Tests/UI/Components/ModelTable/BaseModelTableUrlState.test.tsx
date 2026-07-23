import "@testing-library/jest-dom/extend-expect";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
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
 * to their permissive/no-op form and the tests focus on the one thing that
 * matters here: the table's view state and the URL are kept in sync, in both
 * directions.
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
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import Navigation from "../../../../UI/Utils/Navigation";
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Query from "../../../../Types/BaseDatabase/Query";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

type GetListCall = {
  query: Query<Monitor>;
  limit: number;
  skip: number;
  sort: JSONObject;
};

type RenderTableOptions = {
  urlStateKey?: string | undefined;
  userPreferencesKey?: string | undefined;
  disableUrlState?: boolean | undefined;
  sortBy?: keyof Monitor | undefined;
  sortOrder?: SortOrder | undefined;
  query?: Query<Monitor> | undefined;
};

const FILTERS: Array<Filter<Monitor>> = [
  { title: "Name", type: FieldType.Text, field: { name: true } },
  {
    title: "Description",
    type: FieldType.Text,
    field: { description: true },
  },
] as unknown as Array<Filter<Monitor>>;

type SetUrlFunction = (url: string) => void;

const setUrl: SetUrlFunction = (url: string): void => {
  window.history.replaceState(window.history.state, "", url);
};

describe("BaseModelTable URL state", () => {
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
        getList: async (data: GetListCall): Promise<ListResult<Monitor>> => {
          calls.push({
            query: data.query,
            limit: data.limit,
            skip: data.skip,
            sort: data.sort as unknown as JSONObject,
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
      userPreferencesKey: options.userPreferencesKey || "monitors-table",
      columns: [],
      filters: FILTERS,
      isDeleteable: false,
      isCreateable: false,
      isViewable: false,
      isEditable: false,
      callbacks: makeCallbacks(),
      searchableFields: ["name"] as Array<keyof Monitor>,
      ...(options.urlStateKey ? { urlStateKey: options.urlStateKey } : {}),
      ...(options.disableUrlState ? { disableUrlState: true } : {}),
      ...(options.sortBy ? { sortBy: options.sortBy } : {}),
      ...(options.sortOrder ? { sortOrder: options.sortOrder } : {}),
      ...(options.query ? { query: options.query } : {}),
    } as unknown as BaseModelTableProps<Monitor>;

    return render(<BaseModelTable<Monitor> {...props} />);
  };

  beforeEach(() => {
    calls = [];
    setUrl("/dashboard/monitors");
    TableFilterUrlState.resetClaimedKeys();
    /*
     * The table stores its page size per `userPreferencesKey` in localStorage,
     * so without this a test that changes the page size would silently set the
     * starting page size for every test after it.
     */
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("restoring from the URL", () => {
    test("the FIRST fetch already carries the restored filter", async () => {
      /*
       * The whole point of reading the URL during render rather than in an
       * effect. If the restore happened in an effect, this first request would
       * go out unfiltered — the user would see a flash of every row, and the
       * server would do the work twice.
       */
      TableFilterUrlState.write("monitors-table", "filter", {
        name: new Search("api"),
      });

      renderTable();

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(calls[0]?.query["name"]).toBeInstanceOf(Search);
      expect((calls[0]?.query["name"] as Search<string>).toString()).toBe(
        "api",
      );
    });

    test("an unfiltered table fetches without a filter", async () => {
      renderTable();

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(calls[0]?.query["name"]).toBeUndefined();
    });

    test("restores the page number instead of snapping back to page 1", async () => {
      TableFilterUrlState.write("monitors-table", "view", { page: 3 });

      renderTable();

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      // page 3 at the default page size of 10
      expect(calls[0]?.skip).toBe(20);
    });

    test("restores the sort", async () => {
      TableFilterUrlState.write("monitors-table", "view", {
        sortBy: "name",
        sortOrder: SortOrder.Descending,
      });

      renderTable({ sortBy: "createdAt", sortOrder: SortOrder.Ascending });

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(calls[0]?.sort).toEqual({ name: SortOrder.Descending });
    });

    test("restores the page size", async () => {
      TableFilterUrlState.write("monitors-table", "view", {
        itemsOnPage: 25,
        page: 2,
      });

      renderTable();

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(calls[0]?.limit).toBe(25);
      expect(calls[0]?.skip).toBe(25);
    });

    test("restores the search term into the first fetch", async () => {
      TableFilterUrlState.write("monitors-table", "view", { search: "api" });

      renderTable();

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(
        (calls[0]?.query as unknown as JSONObject)["_multiFieldSearch"],
      ).toBeDefined();
    });

    test("ignores a key the table has no filter for", async () => {
      /*
       * A hand-edited link must not be able to add a constraint the filter UI
       * could never have produced.
       */
      TableFilterUrlState.write("monitors-table", "filter", {
        name: "api",
        projectId: "somebody-elses-project",
      });

      renderTable();

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(calls[0]?.query["name"]).toBe("api");
      expect(calls[0]?.query["projectId"]).toBeUndefined();
    });

    test("survives a corrupt param and renders unfiltered", async () => {
      Navigation.setQueryString({
        "monitors-table-filter": "}{ not json",
        "monitors-table-view": "also not json",
      });

      renderTable();

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(calls[0]?.query["name"]).toBeUndefined();
      expect(calls[0]?.skip).toBe(0);
    });

    test("falls back to userPreferencesKey when no explicit key is given", async () => {
      TableFilterUrlState.write("custom-prefs-key", "filter", { name: "api" });

      renderTable({ userPreferencesKey: "custom-prefs-key" });

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(calls[0]?.query["name"]).toBe("api");
    });

    test("an explicit urlStateKey wins over userPreferencesKey", async () => {
      TableFilterUrlState.write("explicit-key", "filter", { name: "api" });
      TableFilterUrlState.write("prefs-key", "filter", { name: "wrong" });

      renderTable({
        urlStateKey: "explicit-key",
        userPreferencesKey: "prefs-key",
      });

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(calls[0]?.query["name"]).toBe("api");
    });

    test("disableUrlState ignores the URL entirely", async () => {
      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });

      renderTable({ disableUrlState: true });

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(calls[0]?.query["name"]).toBeUndefined();
    });
  });

  describe("writing to the URL", () => {
    test("a table nobody has touched adds no query params", async () => {
      renderTable();

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(window.location.search).toBe("");
    });

    test("keeps params owned by anything else on the route", async () => {
      Navigation.setQueryString({ tab: "overview" });
      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });

      renderTable();

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(Navigation.getQueryStringByName("tab")).toBe("overview");
    });

    test("a restored view is written back unchanged, not widened", async () => {
      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });

      renderTable();

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(TableFilterUrlState.read("monitors-table", "filter")).toEqual({
        name: "api",
      });
    });

    test("disableUrlState writes nothing", async () => {
      renderTable({ disableUrlState: true });

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(window.location.search).toBe("");
    });
  });

  describe("several tables on one page", () => {
    type RenderTwoFunction = () => ReactElement;

    const renderTwo: RenderTwoFunction = (): ReactElement => {
      const base: JSONObject = {
        modelType: Monitor,
        name: "Monitors",
        columns: [],
        filters: FILTERS,
        isDeleteable: false,
        isCreateable: false,
        isViewable: false,
        isEditable: false,
      } as unknown as JSONObject;

      return (
        <>
          <BaseModelTable<Monitor>
            {...(base as unknown as BaseModelTableProps<Monitor>)}
            id="left-table"
            userPreferencesKey="left-table"
            callbacks={makeCallbacks()}
          />
          <BaseModelTable<Monitor>
            {...(base as unknown as BaseModelTableProps<Monitor>)}
            id="right-table"
            userPreferencesKey="right-table"
            callbacks={makeCallbacks()}
          />
        </>
      );
    };

    test("each table restores only its own filter", async () => {
      TableFilterUrlState.write("left-table", "filter", { name: "left" });
      TableFilterUrlState.write("right-table", "filter", { name: "right" });

      render(renderTwo());

      await waitFor(() => {
        expect(calls.length).toBeGreaterThanOrEqual(2);
      });

      const names: Array<unknown> = calls.map((c: GetListCall) => {
        return c.query["name"];
      });

      expect(names).toContain("left");
      expect(names).toContain("right");
    });

    test("each table restores only its own page", async () => {
      TableFilterUrlState.write("left-table", "view", { page: 2 });
      TableFilterUrlState.write("right-table", "view", { page: 5 });

      render(renderTwo());

      await waitFor(() => {
        expect(calls.length).toBeGreaterThanOrEqual(2);
      });

      const skips: Array<number> = calls.map((c: GetListCall) => {
        return c.skip;
      });

      expect(skips).toContain(10);
      expect(skips).toContain(40);
    });

    test("one table's params never clobber the other's", async () => {
      TableFilterUrlState.write("left-table", "filter", { name: "left" });
      TableFilterUrlState.write("right-table", "filter", { name: "right" });

      render(renderTwo());

      await waitFor(() => {
        expect(calls.length).toBeGreaterThanOrEqual(2);
      });

      expect(TableFilterUrlState.read("left-table", "filter")).toEqual({
        name: "left",
      });
      expect(TableFilterUrlState.read("right-table", "filter")).toEqual({
        name: "right",
      });
    });

    test("warns when two tables are given the same key", async () => {
      const warn: ReturnType<typeof jest.spyOn> = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const base: JSONObject = {
        modelType: Monitor,
        name: "Monitors",
        columns: [],
        filters: FILTERS,
        isDeleteable: false,
        isCreateable: false,
        isViewable: false,
        isEditable: false,
        userPreferencesKey: "duplicate-key",
        id: "duplicate-key",
      } as unknown as JSONObject;

      render(
        <>
          <BaseModelTable<Monitor>
            {...(base as unknown as BaseModelTableProps<Monitor>)}
            callbacks={makeCallbacks()}
          />
          <BaseModelTable<Monitor>
            {...(base as unknown as BaseModelTableProps<Monitor>)}
            callbacks={makeCallbacks()}
          />
        </>,
      );

      await waitFor(() => {
        expect(calls.length).toBeGreaterThanOrEqual(2);
      });

      const messages: Array<string> = warn.mock.calls.map(
        (c: Array<unknown>) => {
          return String(c[0]);
        },
      );

      expect(
        messages.some((m: string) => {
          return m.includes("duplicate-key");
        }),
      ).toBe(true);
    });
  });

  describe("the caller's scoping query", () => {
    test("is still applied alongside a restored filter", async () => {
      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });

      renderTable({
        query: { projectId: "scoped-project" } as unknown as Query<Monitor>,
      });

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });

      expect(calls[0]?.query["projectId"]).toBe("scoped-project");
      expect(calls[0]?.query["name"]).toBe("api");
    });

    test("a facet-driven query change sends the user back to page 1", async () => {
      /*
       * Facet selections reach the table through the `query` prop. Narrowing
       * the result set while on page 3 used to re-request page 3 of a shorter
       * list — an empty page, which then got written into the shareable URL.
       */
      TableFilterUrlState.write("monitors-table", "view", { page: 3 });

      const view: ReturnType<typeof render> = renderTable({
        query: { projectId: "a" } as unknown as Query<Monitor>,
      });

      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });
      expect(calls[0]?.skip).toBe(20);

      const props: BaseModelTableProps<Monitor> = {
        modelType: Monitor,
        id: "monitors-table",
        name: "Monitors",
        userPreferencesKey: "monitors-table",
        columns: [],
        filters: FILTERS,
        isDeleteable: false,
        isCreateable: false,
        isViewable: false,
        isEditable: false,
        callbacks: makeCallbacks(),
        query: { projectId: "b" },
      } as unknown as BaseModelTableProps<Monitor>;

      await act(async () => {
        view.rerender(<BaseModelTable<Monitor> {...props} />);
      });

      await waitFor(() => {
        expect(calls[calls.length - 1]?.skip).toBe(0);
      });
    });
  });
});
