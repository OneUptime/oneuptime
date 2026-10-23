import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
 * No filter chips over a list with nothing in it.
 *
 * The Owner and Labels chips came to some thirty lists that are often
 * empty - an archive, a project's own probes and Runners before it has
 * any, its templates and episodes - and "Filter: Owner, Labels" sat over
 * "No archived hosts", offering to narrow a list with nothing to narrow.
 * A table whose emptyState says hideTopContentWhileEmpty (the facet chips'
 * hook does) leaves its topContent out while its last load found no
 * record and nothing narrowing the list; a chip, a search or a filter in
 * force keeps the chips so they can be cleared, a failed load keeps them,
 * and a list with records never draws without them.
 */

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
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
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
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
import EmptyStateOptions from "../../../../UI/Components/ModelTable/EmptyStateOptions";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

const ROWS: Array<JSONObject> = [
  { _id: "10000000-0000-4000-8000-000000000001", name: "Checkout API" },
  { _id: "10000000-0000-4000-8000-000000000002", name: "Billing Worker" },
];

const CHIPS_TEST_ID: string = "facet-chips";

type GetListFunction = () => Promise<ListResult<Monitor>>;

interface TableOptions {
  getList: GetListFunction;
  emptyState?: EmptyStateOptions | undefined;
  initialFilterData?: JSONObject | undefined;
  refreshToggle?: string | undefined;
}

const answer: (rows: Array<JSONObject>) => ListResult<Monitor> = (
  rows: Array<JSONObject>,
): ListResult<Monitor> => {
  return {
    data: rows as unknown as Array<Monitor>,
    count: rows.length,
    skip: 0,
    limit: 10,
  };
};

const makeProps: (options: TableOptions) => BaseModelTableProps<Monitor> = (
  options: TableOptions,
): BaseModelTableProps<Monitor> => {
  const callbacks: BaseTableCallbacks<Monitor> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): Monitor => {
      return item as unknown as Monitor;
    },
    getJSONFromModel: (item: Monitor): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: options.getList,
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      return <div data-testid="create-edit-modal" />;
    },
  } as unknown as BaseTableCallbacks<Monitor>;

  return {
    modelType: Monitor,
    id: "monitors-table",
    name: "Monitors",
    singularName: "Monitor",
    pluralName: "Monitors",
    userPreferencesKey: "monitors-top-content-table",
    urlStateKey: "monitors-top-content-table",
    columns: [
      {
        field: { name: true },
        title: "Name",
        type: FieldType.Text,
      },
    ],
    filters: [],
    cardProps: { title: "Monitors", description: "All monitors" },
    topContent: <div data-testid={CHIPS_TEST_ID}>Filter: Owner, Labels</div>,
    emptyState: options.emptyState,
    initialFilterData: options.initialFilterData,
    refreshToggle: options.refreshToggle,
    isCreateable: false,
    isEditable: false,
    isDeleteable: false,
    isViewable: false,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<Monitor>;
};

const HIDES_WHILE_EMPTY: EmptyStateOptions = {
  hideTopContentWhileEmpty: true,
};

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/monitors");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a table's chips over a list with nothing in it", () => {
  test("an empty list with nothing applied shows its empty state alone", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          getList: async () => {
            return answer([]);
          },
          emptyState: HIDES_WHILE_EMPTY,
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("No monitors yet")).toBeInTheDocument();
    });

    expect(screen.queryByTestId(CHIPS_TEST_ID)).not.toBeInTheDocument();
  });

  test("a list with records keeps its chips", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          getList: async () => {
            return answer(ROWS);
          },
          emptyState: HIDES_WHILE_EMPTY,
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Checkout API").length).toBeGreaterThan(0);
    });

    expect(screen.getByTestId(CHIPS_TEST_ID)).toBeInTheDocument();
  });

  test("the chips are there from the first frame, while the first load runs", async () => {
    let resolve: (result: ListResult<Monitor>) => void = () => {
      return undefined;
    };

    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          getList: () => {
            return new Promise(
              (done: (result: ListResult<Monitor>) => void) => {
                resolve = done;
              },
            );
          },
          emptyState: HIDES_WHILE_EMPTY,
        })}
      />,
    );

    // A list that turns out to have records never draws without its chips.
    expect(screen.getByTestId(CHIPS_TEST_ID)).toBeInTheDocument();

    await act(async (): Promise<void> => {
      resolve(answer([]));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByTestId(CHIPS_TEST_ID)).not.toBeInTheDocument();
    });
  });

  test("a chip in force keeps them, with the way to clear it", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          getList: async () => {
            return answer([]);
          },
          emptyState: {
            ...HIDES_WHILE_EMPTY,
            isFiltered: true,
            onClearFilters: () => {
              return undefined;
            },
          },
        })}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No monitors match your search or filters"),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId(CHIPS_TEST_ID)).toBeInTheDocument();
  });

  test("a filter of the table's own in force keeps them", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          getList: async () => {
            return answer([]);
          },
          emptyState: HIDES_WHILE_EMPTY,
          initialFilterData: { name: "nothing-matches-this" },
        })}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No monitors match your search or filters"),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId(CHIPS_TEST_ID)).toBeInTheDocument();
  });

  test("a list that failed to load is not known to be empty: they stay", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          getList: async () => {
            throw new Error("The server could not be reached.");
          },
          emptyState: HIDES_WHILE_EMPTY,
        })}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText(/The server could not be reached/).length,
      ).toBeGreaterThan(0);
    });

    expect(screen.getByTestId(CHIPS_TEST_ID)).toBeInTheDocument();
  });

  test("an empty list whose refresh fails shows them with the error", async () => {
    let calls: number = 0;

    const getList: GetListFunction = async (): Promise<ListResult<Monitor>> => {
      calls++;

      if (calls === 1) {
        return answer([]);
      }

      throw new Error("The server could not be reached.");
    };

    const view: ReturnType<typeof render> = render(
      <BaseModelTable<Monitor>
        {...makeProps({
          getList: getList,
          emptyState: HIDES_WHILE_EMPTY,
          refreshToggle: "0",
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("No monitors yet")).toBeInTheDocument();
    });

    expect(screen.queryByTestId(CHIPS_TEST_ID)).not.toBeInTheDocument();

    view.rerender(
      <BaseModelTable<Monitor>
        {...makeProps({
          getList: getList,
          emptyState: HIDES_WHILE_EMPTY,
          refreshToggle: "1",
        })}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText(/The server could not be reached/).length,
      ).toBeGreaterThan(0);
    });

    expect(screen.getByTestId(CHIPS_TEST_ID)).toBeInTheDocument();
  });

  test("a refresh of an empty list does not draw them for the moment it takes", async () => {
    let calls: number = 0;
    let resolveRefresh: (result: ListResult<Monitor>) => void = () => {
      return undefined;
    };

    const getList: GetListFunction = (): Promise<ListResult<Monitor>> => {
      calls++;

      if (calls === 1) {
        return Promise.resolve(answer([]));
      }

      return new Promise((done: (result: ListResult<Monitor>) => void) => {
        resolveRefresh = done;
      });
    };

    const view: ReturnType<typeof render> = render(
      <BaseModelTable<Monitor>
        {...makeProps({
          getList: getList,
          emptyState: HIDES_WHILE_EMPTY,
          refreshToggle: "0",
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("No monitors yet")).toBeInTheDocument();
    });

    expect(screen.queryByTestId(CHIPS_TEST_ID)).not.toBeInTheDocument();

    view.rerender(
      <BaseModelTable<Monitor>
        {...makeProps({
          getList: getList,
          emptyState: HIDES_WHILE_EMPTY,
          refreshToggle: "1",
        })}
      />,
    );

    await waitFor(() => {
      expect(calls).toBe(2);
    });

    // Still loading: nothing new is known, so nothing moves.
    expect(screen.queryByTestId(CHIPS_TEST_ID)).not.toBeInTheDocument();

    // The first record arrived meanwhile: the chips come back with it.
    await act(async (): Promise<void> => {
      resolveRefresh(answer([ROWS[0]!]));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId(CHIPS_TEST_ID)).toBeInTheDocument();
    });
  });

  test("a table that did not ask keeps its topContent over an empty list", async () => {
    /*
     * Pages put other things over a table too - a notification method's
     * verification steps, a capture's controls - which an empty list
     * needs most.
     */
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          getList: async () => {
            return answer([]);
          },
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("No monitors yet")).toBeInTheDocument();
    });

    expect(screen.getByTestId(CHIPS_TEST_ID)).toBeInTheDocument();
  });
});
