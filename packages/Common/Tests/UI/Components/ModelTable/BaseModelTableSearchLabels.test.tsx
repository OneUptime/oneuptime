import "@testing-library/jest-dom";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Same stubs as BaseModelTableUrlState.test.tsx — permissions, the current
 * project and i18n are not what these tests are about. The subject here is the
 * `labels` slice of the table's `-view` URL param and the in-search label
 * chips it feeds.
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
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Label from "../../../../Models/DatabaseModels/Label";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Query from "../../../../Types/BaseDatabase/Query";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";
import { SHARED_NAME_VALUE_DETAIL_TEST_ID } from "../../../../UI/Components/Dropdown/SharedNameOptionLines";

const LABEL_ID: string = "0192f2ce-1b1a-7000-8000-0000000000aa";

type GetListCall = {
  modelType: unknown;
  query: Query<Monitor>;
};

/*
 * The Labels filter as it is still declared on tables that kept it in the
 * filter popup (Telemetry Services, On-Call Schedules, ...). Its presence is
 * the only thing that switches on in-search label chips.
 */
const LABEL_FILTER: Filter<Monitor> = {
  title: "Labels",
  type: FieldType.EntityArray,
  field: { labels: { name: true, color: true } },
  filterEntityType: Label,
  filterQuery: {},
  filterDropdownField: { label: "name", value: "_id" },
} as unknown as Filter<Monitor>;

const PLAIN_FILTERS: Array<Filter<Monitor>> = [
  { title: "Name", type: FieldType.Text, field: { name: true } },
] as unknown as Array<Filter<Monitor>>;

/*
 * A table that has moved its Labels filter out to the facet bar — Monitors and
 * Network Devices — has no Label entry left in `filters` at all.
 */
const FACETED_FILTERS: Array<Filter<Monitor>> = PLAIN_FILTERS;

const WITH_LABEL_FILTERS: Array<Filter<Monitor>> = [
  ...PLAIN_FILTERS,
  LABEL_FILTER,
];

type SetUrlFunction = (url: string) => void;

const setUrl: SetUrlFunction = (url: string): void => {
  window.history.replaceState(window.history.state, "", url);
};

describe("BaseModelTable in-search label chips", () => {
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
          modelType: unknown;
          query: Query<Monitor>;
          limit: number;
        }): Promise<ListResult<Monitor>> => {
          calls.push({ modelType: data.modelType, query: data.query });
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

  /*
   * The label-suggestion fetch goes through the same `getList` callback with
   * `modelType: Label`, so the row requests have to be picked out explicitly.
   */
  type RowCallsFunction = () => Array<GetListCall>;

  const rowCalls: RowCallsFunction = (): Array<GetListCall> => {
    return calls.filter((c: GetListCall) => {
      return c.modelType === Monitor;
    });
  };

  type MakePropsFunction = (
    filters: Array<Filter<Monitor>>,
  ) => BaseModelTableProps<Monitor>;

  const makeProps: MakePropsFunction = (
    filters: Array<Filter<Monitor>>,
  ): BaseModelTableProps<Monitor> => {
    return {
      modelType: Monitor,
      id: "monitors-table",
      name: "Monitors",
      userPreferencesKey: "monitors-table",
      columns: [],
      filters: filters,
      isDeleteable: false,
      isCreateable: false,
      isViewable: false,
      isEditable: false,
      callbacks: makeCallbacks(),
      searchableFields: ["name"] as Array<keyof Monitor>,
    } as unknown as BaseModelTableProps<Monitor>;
  };

  type RenderTableFunction = (
    filters: Array<Filter<Monitor>>,
  ) => ReturnType<typeof render>;

  const renderTable: RenderTableFunction = (
    filters: Array<Filter<Monitor>>,
  ): ReturnType<typeof render> => {
    return render(<BaseModelTable<Monitor> {...makeProps(filters)} />);
  };

  beforeEach(() => {
    calls = [];
    setUrl("/dashboard/monitors");
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("when the table still has a Labels filter", () => {
    test("the restored ids constrain the first fetch", async () => {
      TableFilterUrlState.write("monitors-table", "view", {
        labels: [LABEL_ID],
      });

      renderTable(WITH_LABEL_FILTERS);

      await waitFor(() => {
        expect(rowCalls().length).toBeGreaterThan(0);
      });

      const labelsConstraint: unknown = (
        rowCalls()[0]?.query as unknown as JSONObject
      )["labels"];

      expect(labelsConstraint).toBeInstanceOf(Includes);
      expect((labelsConstraint as Includes).values).toEqual([LABEL_ID]);
    });

    test("a chip is rendered for each restored id", async () => {
      TableFilterUrlState.write("monitors-table", "view", {
        labels: [LABEL_ID],
      });

      const view: ReturnType<typeof render> = renderTable(WITH_LABEL_FILTERS);

      await waitFor(() => {
        expect(rowCalls().length).toBeGreaterThan(0);
      });

      /*
       * The chip is read by its id (#10646). This label is not there to
       * read, so once the read lands it says so - and it stays, because the
       * constraint IS applied and dropping it from a shared link would be
       * worse.
       */
      await waitFor(() => {
        expect(
          view.queryByLabelText("Remove No longer available"),
        ).not.toBeNull();
      });
      expect(view.getAllByTestId("table-search-label-chip")).toHaveLength(1);
    });

    test("the labels key stays on the URL", async () => {
      TableFilterUrlState.write("monitors-table", "view", {
        labels: [LABEL_ID],
      });

      renderTable(WITH_LABEL_FILTERS);

      await waitFor(() => {
        expect(rowCalls().length).toBeGreaterThan(0);
      });

      expect(TableFilterUrlState.read("monitors-table", "view")).toEqual({
        labels: [LABEL_ID],
      });
    });
  });

  describe("when the Labels filter has moved to the facet bar", () => {
    test("the restored ids do not constrain the fetch", async () => {
      TableFilterUrlState.write("monitors-table", "view", {
        labels: [LABEL_ID],
      });

      renderTable(FACETED_FILTERS);

      await waitFor(() => {
        expect(rowCalls().length).toBeGreaterThan(0);
      });

      expect(
        (rowCalls()[0]?.query as unknown as JSONObject)["labels"],
      ).toBeUndefined();
    });

    test("no phantom chip is rendered", async () => {
      /*
       * The regression this guards: the chip was seeded from the URL but
       * `availableLabels` is never fetched without a Labels filter, so it
       * could never hydrate past the raw UUID — a pill the table could not
       * name, could not apply, and that the user had to dismiss by hand.
       */
      TableFilterUrlState.write("monitors-table", "view", {
        labels: [LABEL_ID],
      });

      const view: ReturnType<typeof render> = renderTable(FACETED_FILTERS);

      await waitFor(() => {
        expect(rowCalls().length).toBeGreaterThan(0);
      });

      expect(view.queryByLabelText(`Remove ${LABEL_ID}`)).toBeNull();
      expect(view.queryByText(LABEL_ID)).toBeNull();
    });

    test("the search box is not forced open", async () => {
      TableFilterUrlState.write("monitors-table", "view", {
        labels: [LABEL_ID],
      });

      const view: ReturnType<typeof render> = renderTable(FACETED_FILTERS);

      await waitFor(() => {
        expect(rowCalls().length).toBeGreaterThan(0);
      });

      // Only shown while the search has text or chips behind it.
      expect(view.queryByLabelText("Clear search")).toBeNull();
    });

    test("the stale labels key is dropped from the URL", async () => {
      TableFilterUrlState.write("monitors-table", "view", {
        labels: [LABEL_ID],
        page: 2,
      });

      renderTable(FACETED_FILTERS);

      await waitFor(() => {
        expect(rowCalls().length).toBeGreaterThan(0);
      });

      /*
       * The rest of the view slice is untouched — only the key this table can
       * no longer honour is healed away, so the link keeps working.
       */
      await waitFor(() => {
        expect(TableFilterUrlState.read("monitors-table", "view")).toEqual({
          page: 2,
        });
      });
    });

    test("a search term restored alongside the stale key still applies", async () => {
      TableFilterUrlState.write("monitors-table", "view", {
        labels: [LABEL_ID],
        search: "api",
      });

      renderTable(FACETED_FILTERS);

      await waitFor(() => {
        expect(rowCalls().length).toBeGreaterThan(0);
      });

      expect(
        (rowCalls()[0]?.query as unknown as JSONObject)["_multiFieldSearch"],
      ).toBeDefined();
      expect(
        (rowCalls()[0]?.query as unknown as JSONObject)["labels"],
      ).toBeUndefined();
    });
  });

  /*
   * Two labels of one name, named alike before names were held to one label
   * each (#10314): the suggestions are read with what tells them apart, and
   * each chip says it after its name, so two picked twins read as two.
   */
  test("two labels of one name: each chip says what sets it apart, read with the labels", async () => {
    const OTHER_LABEL_ID: string = "0192f2ce-1b1a-7000-8000-0000000000bb";

    TableFilterUrlState.write("monitors-table", "view", {
      labels: [LABEL_ID, OTHER_LABEL_ID],
    });

    const labelSelects: Array<unknown> = [];
    const props: BaseModelTableProps<Monitor> = makeProps(WITH_LABEL_FILTERS);

    props.callbacks = {
      ...props.callbacks,
      getList: async (data: {
        modelType: unknown;
        query: Query<Monitor>;
        limit: number;
        select?: unknown;
      }): Promise<ListResult<Monitor>> => {
        calls.push({ modelType: data.modelType, query: data.query });

        if (data.modelType !== Label) {
          return { data: [], count: 0, skip: 0, limit: data.limit };
        }

        labelSelects.push(data.select);

        return {
          data: [
            Object.assign(new Label(), {
              _id: LABEL_ID,
              name: "Production",
              color: "#ef4444",
              description: "EU workloads",
            }),
            Object.assign(new Label(), {
              _id: OTHER_LABEL_ID,
              name: "production",
              color: "#22c55e",
              description: "US workloads",
            }),
          ] as never,
          count: 2,
          skip: 0,
          limit: data.limit,
        };
      },
    } as unknown as BaseTableCallbacks<Monitor>;

    const view: ReturnType<typeof render> = render(
      <BaseModelTable<Monitor> {...props} />,
    );

    await waitFor(() => {
      expect(
        view.queryAllByTestId(SHARED_NAME_VALUE_DETAIL_TEST_ID),
      ).toHaveLength(2);
    });

    expect(
      view
        .getAllByTestId(SHARED_NAME_VALUE_DETAIL_TEST_ID)
        .map((element: HTMLElement): string => {
          return element.textContent || "";
        })
        .join(" | "),
    ).toMatch(/EU workloads.*\|.*US workloads/);
    expect(labelSelects[0]).toMatchObject({
      _id: true,
      name: true,
      color: true,
      description: true,
      createdAt: true,
    });
  });

  test("a label no other one shares its name with is drawn as before", async () => {
    TableFilterUrlState.write("monitors-table", "view", {
      labels: [LABEL_ID],
    });

    const props: BaseModelTableProps<Monitor> = makeProps(WITH_LABEL_FILTERS);

    props.callbacks = {
      ...props.callbacks,
      getList: async (data: {
        modelType: unknown;
        query: Query<Monitor>;
        limit: number;
      }): Promise<ListResult<Monitor>> => {
        calls.push({ modelType: data.modelType, query: data.query });

        return data.modelType === Label
          ? {
              data: [
                Object.assign(new Label(), {
                  _id: LABEL_ID,
                  name: "Production",
                  description: "EU workloads",
                }),
              ] as never,
              count: 1,
              skip: 0,
              limit: data.limit,
            }
          : { data: [], count: 0, skip: 0, limit: data.limit };
      },
    } as unknown as BaseTableCallbacks<Monitor>;

    const view: ReturnType<typeof render> = render(
      <BaseModelTable<Monitor> {...props} />,
    );

    await waitFor(() => {
      expect(view.queryByLabelText("Remove Production")).not.toBeNull();
    });

    expect(
      view.queryAllByTestId(SHARED_NAME_VALUE_DETAIL_TEST_ID),
    ).toHaveLength(0);
  });

  test("chips are cleared when the Labels filter is removed after mount", async () => {
    TableFilterUrlState.write("monitors-table", "view", {
      labels: [LABEL_ID],
    });

    const view: ReturnType<typeof render> = renderTable(WITH_LABEL_FILTERS);

    await waitFor(() => {
      expect(view.queryAllByTestId("table-search-label-chip")).toHaveLength(1);
    });

    await act(async () => {
      view.rerender(
        <BaseModelTable<Monitor> {...makeProps(FACETED_FILTERS)} />,
      );
    });

    await waitFor(() => {
      expect(view.queryAllByTestId("table-search-label-chip")).toHaveLength(0);
    });

    await waitFor(() => {
      expect(TableFilterUrlState.read("monitors-table", "view")).toBeNull();
    });
  });
});
