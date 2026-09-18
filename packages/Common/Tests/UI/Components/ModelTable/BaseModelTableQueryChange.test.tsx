import "@testing-library/jest-dom";
import { cleanup, configure, render, waitFor } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// A real BaseModelTable is a lot of tree; see BaseModelTableAttributeColumns.
configure({ asyncUtilTimeout: 15000 });

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
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Query from "../../../../Types/BaseDatabase/Query";
import Search from "../../../../Types/BaseDatabase/Search";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

/*
 * onQueryChange: the table reports the query it lists rows with, so a
 * surface summarizing the same rows (the Security Events volume chart) counts
 * exactly what the table shows. What matters is that the report IS the list
 * query - the caller's scope, the column filters and the search box, merged
 * the same way - and that it fires once per change rather than once per
 * render.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const FILTERS: Array<Filter<Monitor>> = [
  { title: "Name", type: FieldType.Text, field: { name: true } },
  {
    title: "Description",
    type: FieldType.Text,
    field: { description: true },
  },
] as unknown as Array<Filter<Monitor>>;

describe("BaseModelTable onQueryChange", () => {
  let listQueries: Array<Query<Monitor>> = [];
  let reported: Array<Query<Monitor>> = [];

  const onQueryChange: (query: Query<Monitor>) => void = (
    query: Query<Monitor>,
  ): void => {
    reported.push(query);
  };

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
    getList: async (data: {
      query: Query<Monitor>;
      limit: number;
    }): Promise<ListResult<Monitor>> => {
      listQueries.push(data.query);
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

  const makeProps: (
    overrides?: Partial<BaseModelTableProps<Monitor>>,
  ) => BaseModelTableProps<Monitor> = (
    overrides: Partial<BaseModelTableProps<Monitor>> = {},
  ): BaseModelTableProps<Monitor> => {
    return {
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
      callbacks: callbacks,
      searchableFields: ["name"] as Array<keyof Monitor>,
      onQueryChange: onQueryChange,
      ...overrides,
    } as unknown as BaseModelTableProps<Monitor>;
  };

  beforeEach(() => {
    listQueries = [];
    reported = [];
    window.history.replaceState(null, "", "/dashboard/monitors");
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("reports the query once on mount", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({ query: { projectId: PROJECT_ID } as never })}
      />,
    );

    await waitFor(() => {
      expect(listQueries.length).toBeGreaterThan(0);
    });

    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual({ projectId: PROJECT_ID });
  });

  test("what it reports is what the list request sends", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({ query: { projectId: PROJECT_ID } as never })}
      />,
    );

    await waitFor(() => {
      expect(listQueries.length).toBeGreaterThan(0);
    });

    expect(reported[0]).toEqual(listQueries[0]);
  });

  test("the report carries column filters restored from the URL, merged over the caller's query", async () => {
    TableFilterUrlState.write("monitors-table", "filter", {
      name: new Search("api"),
    });

    render(
      <BaseModelTable<Monitor>
        {...makeProps({ query: { projectId: PROJECT_ID } as never })}
      />,
    );

    await waitFor(() => {
      expect(reported.length).toBeGreaterThan(0);
    });

    expect(reported[0]?.["projectId"]).toBe(PROJECT_ID);
    expect(reported[0]?.["name"]).toBeInstanceOf(Search);
    expect((reported[0]?.["name"] as Search<string>).toString()).toBe("api");
  });

  test("the report carries the search box", async () => {
    TableFilterUrlState.write("monitors-table", "view", { search: "db" });

    render(<BaseModelTable<Monitor> {...makeProps()} />);

    await waitFor(() => {
      expect(reported.length).toBeGreaterThan(0);
    });

    expect(
      (reported[0] as unknown as JSONObject)["_multiFieldSearch"],
    ).toBeDefined();
  });

  test("a re-render with an equal query literal does not report again", async () => {
    const view: ReturnType<typeof render> = render(
      <BaseModelTable<Monitor>
        {...makeProps({ query: { projectId: PROJECT_ID } as never })}
      />,
    );

    await waitFor(() => {
      expect(reported).toHaveLength(1);
    });

    // A fresh object with the same contents, as a parent re-render produces.
    view.rerender(
      <BaseModelTable<Monitor>
        {...makeProps({ query: { projectId: PROJECT_ID } as never })}
      />,
    );
    view.rerender(
      <BaseModelTable<Monitor>
        {...makeProps({ query: { projectId: PROJECT_ID } as never })}
      />,
    );

    // Give any stray effect the chance to run before asserting it did not.
    await waitFor(() => {
      expect(listQueries.length).toBeGreaterThan(0);
    });
    expect(reported).toHaveLength(1);
  });

  test("a changed caller query is reported, with the filters still merged in", async () => {
    TableFilterUrlState.write("monitors-table", "filter", {
      name: new Search("api"),
    });

    const firstWindow: InBetween<Date> = new InBetween<Date>(
      new Date("2026-09-17T00:00:00.000Z"),
      new Date("2026-09-18T00:00:00.000Z"),
    );
    const secondWindow: InBetween<Date> = new InBetween<Date>(
      new Date("2026-09-17T06:00:00.000Z"),
      new Date("2026-09-17T07:00:00.000Z"),
    );

    const view: ReturnType<typeof render> = render(
      <BaseModelTable<Monitor>
        {...makeProps({
          query: { projectId: PROJECT_ID, createdAt: firstWindow } as never,
        })}
      />,
    );

    await waitFor(() => {
      expect(reported).toHaveLength(1);
    });

    view.rerender(
      <BaseModelTable<Monitor>
        {...makeProps({
          query: { projectId: PROJECT_ID, createdAt: secondWindow } as never,
        })}
      />,
    );

    await waitFor(() => {
      expect(reported).toHaveLength(2);
    });

    expect(reported[1]?.["createdAt"]).toBe(secondWindow);
    expect(reported[1]?.["name"]).toBeInstanceOf(Search);

    // And the refetch the new scope triggered used the same query.
    await waitFor(() => {
      expect(listQueries[listQueries.length - 1]?.["createdAt"]).toBe(
        secondWindow,
      );
    });
    expect(listQueries[listQueries.length - 1]).toEqual(reported[1]);
  });

  test("a refresh toggle refetches without reporting a new query", async () => {
    const view: ReturnType<typeof render> = render(
      <BaseModelTable<Monitor>
        {...makeProps({
          query: { projectId: PROJECT_ID } as never,
          refreshToggle: "0",
        })}
      />,
    );

    await waitFor(() => {
      expect(reported).toHaveLength(1);
    });

    const fetchesBefore: number = listQueries.length;

    view.rerender(
      <BaseModelTable<Monitor>
        {...makeProps({
          query: { projectId: PROJECT_ID } as never,
          refreshToggle: "1",
        })}
      />,
    );

    await waitFor(() => {
      expect(listQueries.length).toBeGreaterThan(fetchesBefore);
    });
    expect(reported).toHaveLength(1);
  });

  test("a table without the callback still lists rows", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          query: { projectId: PROJECT_ID } as never,
          onQueryChange: undefined,
        })}
      />,
    );

    await waitFor(() => {
      expect(listQueries.length).toBeGreaterThan(0);
    });

    expect(listQueries[0]).toEqual({ projectId: PROJECT_ID });
    expect(reported).toHaveLength(0);
  });
});
