import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
 * Reordering a drag-ordered settings list end to end in the dashboard's
 * ModelTable: what is asked of the server, what a drop sends, and what the
 * person sees while it is saved, when it is saved and when it fails.
 *
 *   - the list is always read in its own order (ties broken by age, as the
 *     server breaks them), 50 rows a page, and its column headers do not
 *     re-sort it;
 *   - a drop moves the row on screen at once and sends the number held by
 *     the row it landed on - which the server reads as "take that row's
 *     place" (@ListOrderColumn);
 *   - while it is saved the grips wait and say so, and a screen reader is
 *     told when it is saved; the refresh after it does not dim the rows;
 *   - a failed save puts the rows back and says why, in a message that can
 *     be dismissed;
 *   - with a filter or search on, dragging is off and a line says why.
 *
 * Rows are dragged from the keyboard, which react-beautiful-dnd supports in
 * jsdom.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      // What the table reads a column's permissions against.
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          permissions: permissionsForTest.map((permission: unknown) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        };
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
        return false;
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

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
  MANUALLY_ORDERED_ITEMS_ON_PAGE,
  REORDER_FAILED,
  REORDER_OFF_WHILE_FILTERED,
  REORDER_SAVED,
  REORDER_SAVING,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import FieldType from "../../../../UI/Components/Types/FieldType";
import IncidentReminderRule from "../../../../Models/DatabaseModels/IncidentReminderRule";
import NetworkSiteAssignmentRule from "../../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

type Row = {
  _id: string;
  name: string;
  order: number | null;
};

const SPACE: { keyCode: number; key: string } = { keyCode: 32, key: " " };
const ARROW_UP: { keyCode: number; key: string } = {
  keyCode: 38,
  key: "ArrowUp",
};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

const deferred: () => Deferred = (): Deferred => {
  let resolve: () => void = (): void => {};
  let reject: (error: Error) => void = (): void => {};
  const promise: Promise<void> = new Promise<void>(
    (res: () => void, rej: (error: Error) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
};

let serverRows: Array<Row>;
let getListCalls: Array<{ sort: unknown; limit: number }>;
let updateCalls: Array<{ id: string; data: JSONObject }>;
let nextUpdate: Deferred | null;
let nextList: Deferred | null;

const makeCallbacks: () => BaseTableCallbacks<BaseModel> =
  (): BaseTableCallbacks<BaseModel> => {
    return {
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      getModelFromJSON: (item: JSONObject): BaseModel => {
        return item as unknown as BaseModel;
      },
      getJSONFromModel: (item: BaseModel): JSONObject => {
        return item as unknown as JSONObject;
      },
      addSlugToSelect: (select: unknown): unknown => {
        return select;
      },
      getList: async (data: {
        skip: number;
        limit: number;
        sort: unknown;
      }): Promise<ListResult<BaseModel>> => {
        getListCalls.push({ sort: data.sort, limit: data.limit });

        if (nextList) {
          const pending: Deferred = nextList;
          nextList = null;
          await pending.promise;
        }

        const rows: Array<Row> = [...serverRows].sort((a: Row, b: Row) => {
          return (a.order ?? 1e9) - (b.order ?? 1e9);
        });

        return {
          data: rows.map((row: Row) => {
            return { ...row };
          }) as unknown as Array<BaseModel>,
          count: rows.length,
          skip: data.skip,
          limit: data.limit,
        };
      },
      toJSONArray: (): Array<JSONObject> => {
        return [];
      },
      updateById: async (args: {
        id: ObjectID;
        data: JSONObject;
      }): Promise<void> => {
        updateCalls.push({ id: args.id.toString(), data: args.data });

        if (nextUpdate) {
          const pending: Deferred = nextUpdate;
          nextUpdate = null;
          await pending.promise;
        }

        // The server's side of a drop: take the target's place.
        const moved: Row = serverRows.find((row: Row) => {
          return row._id === args.id.toString();
        })!;
        const requested: number = args.data["order"] as number;
        const previous: number = moved.order as number;

        for (const row of serverRows) {
          if (row === moved || row.order === null) {
            continue;
          }

          if (requested < previous && row.order >= requested && row.order < previous) {
            row.order += 1;
          } else if (
            requested > previous &&
            row.order <= requested &&
            row.order > previous
          ) {
            row.order -= 1;
          }
        }

        moved.order = requested;
      },
      showCreateEditModal: (): React.ReactElement => {
        return <div />;
      },
    } as unknown as BaseTableCallbacks<BaseModel>;
  };

const ID: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

const renderTable: (
  extra?: Partial<BaseModelTableProps<BaseModel>>,
) => void = (extra?: Partial<BaseModelTableProps<BaseModel>>): void => {
  render(
    <BaseModelTable<BaseModel>
      {...({
        modelType: IncidentReminderRule,
        id: "reminder-rules",
        name: "Reminder Rules",
        singularName: "Rule",
        pluralName: "Rules",
        userPreferencesKey: "reminder-rules-drag-test",
        columns: [
          { field: { name: true }, title: "Name", type: FieldType.Text },
        ],
        filters: [
          { field: { name: true }, title: "Name", type: FieldType.Text },
        ],
        cardProps: { title: "Reminder Rules", description: "Rules" },
        isCreateable: false,
        isEditable: false,
        isDeleteable: false,
        isViewable: false,
        sortBy: "order",
        sortOrder: SortOrder.Ascending,
        enableDragAndDrop: true,
        dragDropIndexField: "order",
        callbacks: makeCallbacks(),
        ...(extra || {}),
      } as unknown as BaseModelTableProps<BaseModel>)}
    />,
  );
};

const rowNames: () => Array<string> = (): Array<string> => {
  return screen
    .getAllByTestId("drag-handle")
    .map((grip: HTMLElement): string => {
      return grip.closest("tr")!.textContent || "";
    });
};

const wait: (ms: number) => Promise<void> = async (
  ms: number,
): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, ms);
    });
  });
};

const press: (
  element: HTMLElement,
  key: { keyCode: number; key: string },
) => Promise<void> = async (
  element: HTMLElement,
  key: { keyCode: number; key: string },
): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(element, key);
  });
  await wait(30);
};

// Moves the row at `from` up by `steps` from the keyboard and drops it.
const moveUp: (from: number, steps: number) => Promise<void> = async (
  from: number,
  steps: number,
): Promise<void> => {
  const grip: HTMLElement = screen.getAllByTestId("drag-handle")[from]!;
  grip.focus();

  await press(grip, SPACE);

  for (let i: number = 0; i < steps; i++) {
    await press(grip, ARROW_UP);
  }

  await press(grip, SPACE);
  await wait(400);
};

const waitForRows: (count: number) => Promise<void> = async (
  count: number,
): Promise<void> => {
  await waitFor(() => {
    expect(screen.getAllByTestId("drag-handle")).toHaveLength(count);
  });
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  serverRows = [
    { _id: ID(1), name: "Critical every 15 minutes", order: 1 },
    { _id: ID(2), name: "Major every 30 minutes", order: 2 },
    { _id: ID(3), name: "Everything else every hour", order: 3 },
  ];
  getListCalls = [];
  updateCalls = [];
  nextUpdate = null;
  nextList = null;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("reading a drag-ordered list", () => {
  test("asks for it in its own order, ties broken by age, as the server orders it", async () => {
    renderTable();
    await waitForRows(3);

    expect(getListCalls[0]!.sort).toEqual({
      order: SortOrder.Ascending,
      createdAt: SortOrder.Ascending,
    });
  });

  test("shows a whole list on one page, so any row can be dragged anywhere", async () => {
    renderTable();
    await waitForRows(3);

    expect(MANUALLY_ORDERED_ITEMS_ON_PAGE).toBe(50);
    expect(getListCalls[0]!.limit).toBe(MANUALLY_ORDERED_ITEMS_ON_PAGE);
  });

  test("a page that asks for its own page size keeps it", async () => {
    renderTable({ initialItemsOnPage: 25 } as never);
    await waitForRows(3);

    expect(getListCalls[0]!.limit).toBe(25);
  });

  test("its column headers do not re-sort it", async () => {
    renderTable();
    await waitForRows(3);

    const header: HTMLElement = screen.getAllByRole("rowgroup")[0]!;

    expect(within(header).queryAllByRole("button")).toHaveLength(0);
  });

  test("a list whose top is its highest number is read highest first, whatever the page says", async () => {
    serverRows = [];

    renderTable({
      modelType: NetworkSiteAssignmentRule,
      columns: [
        {
          field: { subnetCidr: true },
          title: "Subnet CIDR",
          type: FieldType.Text,
        },
      ],
      filters: [],
      dragDropIndexField: "priority",
      sortBy: "priority",
      sortOrder: SortOrder.Ascending,
    } as never);

    await waitFor(() => {
      expect(getListCalls.length).toBeGreaterThan(0);
    });

    expect(getListCalls[0]!.sort).toEqual({
      priority: SortOrder.Descending,
      createdAt: SortOrder.Ascending,
    });
  });
});

describe("dropping a row", () => {
  test("moves it on screen at once and sends the number of the row it landed on", async () => {
    nextUpdate = deferred();
    const pending: Deferred = nextUpdate;

    renderTable();
    await waitForRows(3);

    await moveUp(2, 2);

    expect(updateCalls).toEqual([{ id: ID(3), data: { order: 1 } }]);
    // Before the server has answered, the row is already where it was dropped.
    expect(rowNames()[0]).toContain("Everything else every hour");

    await act(async () => {
      pending.resolve();
    });

    await waitFor(() => {
      expect(rowNames()).toEqual([
        "Everything else every hour",
        "Critical every 15 minutes",
        "Major every 30 minutes",
      ]);
    });
  });

  test("a row moved one place up sends the number of the row above it", async () => {
    renderTable();
    await waitForRows(3);

    await moveUp(1, 1);

    expect(updateCalls).toEqual([{ id: ID(2), data: { order: 1 } }]);
  });

  test("in a list with gaps it sends the target's number, not a position", async () => {
    serverRows = [
      { _id: ID(1), name: "Ten", order: 10 },
      { _id: ID(2), name: "Twenty", order: 20 },
      { _id: ID(3), name: "Thirty", order: 30 },
    ];

    renderTable();
    await waitForRows(3);

    await moveUp(2, 2);

    expect(updateCalls).toEqual([{ id: ID(3), data: { order: 10 } }]);
  });

  test("when the row it landed on has no number yet, it sends that row's place on the page", async () => {
    serverRows = [
      { _id: ID(1), name: "Unordered A", order: null },
      { _id: ID(2), name: "Unordered B", order: null },
    ];

    renderTable();
    await waitForRows(2);

    await moveUp(1, 1);

    expect(updateCalls).toEqual([{ id: ID(2), data: { order: 1 } }]);
  });

  test("while it is saved, every grip waits and says so, and a screen reader hears when it is done", async () => {
    nextUpdate = deferred();
    const pending: Deferred = nextUpdate;

    renderTable();
    await waitForRows(3);

    await moveUp(2, 1);

    for (const grip of screen.getAllByTestId("drag-handle")) {
      expect(grip).toHaveAttribute("aria-disabled", "true");
      expect(grip).toHaveAttribute("title", REORDER_SAVING);
    }

    expect(screen.getByRole("status")).toHaveTextContent(REORDER_SAVING);

    await act(async () => {
      pending.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(REORDER_SAVED);
    });

    for (const grip of screen.getAllByTestId("drag-handle")) {
      expect(grip).not.toHaveAttribute("aria-disabled");
    }
  });

  test("the refresh after a saved move does not dim the rows", async () => {
    renderTable();
    await waitForRows(3);

    nextList = deferred();
    const pendingList: Deferred = nextList;

    await moveUp(2, 1);

    await waitFor(() => {
      expect(getListCalls.length).toBe(2);
    });

    // The refresh is in flight: the rows stay as they are, not dimmed.
    expect(screen.getByTestId("table-content")).not.toHaveClass("opacity-60");

    await act(async () => {
      pendingList.resolve();
    });
  });

  test("a failed save puts the rows back and says why, until dismissed", async () => {
    nextUpdate = deferred();
    const pending: Deferred = nextUpdate;

    renderTable();
    await waitForRows(3);

    const before: Array<string> = rowNames();

    await moveUp(2, 2);

    await act(async () => {
      pending.reject(new Error("You do not have permission to edit this rule."));
    });

    await waitFor(() => {
      expect(screen.getByTestId("reorder-error")).toBeInTheDocument();
    });

    expect(rowNames()).toEqual(before);
    expect(screen.getByTestId("reorder-error")).toHaveTextContent(
      REORDER_FAILED,
    );
    expect(screen.getByTestId("reorder-error")).toHaveTextContent(
      "You do not have permission to edit this rule.",
    );

    for (const grip of screen.getAllByTestId("drag-handle")) {
      expect(grip).not.toHaveAttribute("aria-disabled");
    }

    fireEvent.click(
      within(screen.getByTestId("reorder-error")).getByRole("button"),
    );

    expect(screen.queryByTestId("reorder-error")).toBeNull();
  });

  test("the next drop clears the last failure", async () => {
    nextUpdate = deferred();
    const pending: Deferred = nextUpdate;

    renderTable();
    await waitForRows(3);

    await moveUp(2, 1);

    await act(async () => {
      pending.reject(new Error("Try again."));
    });

    await waitFor(() => {
      expect(screen.getByTestId("reorder-error")).toBeInTheDocument();
    });

    await moveUp(1, 1);

    expect(screen.queryByTestId("reorder-error")).toBeNull();
  });
});

describe("with a filter or search on", () => {
  test("dragging is off, the grips say why, and a line above the list says so too", async () => {
    renderTable({ initialFilterData: { name: "Major" } } as never);
    await waitForRows(3);

    expect(screen.getByTestId("reorder-off-while-filtered")).toHaveTextContent(
      REORDER_OFF_WHILE_FILTERED,
    );

    for (const grip of screen.getAllByTestId("drag-handle")) {
      expect(grip).toHaveAttribute("aria-disabled", "true");
      expect(grip).toHaveAttribute("title", REORDER_OFF_WHILE_FILTERED);
    }

    await moveUp(2, 1);

    expect(updateCalls).toEqual([]);
  });

  test("the line is not shown for a filtered list of one row, which has nothing to reorder", async () => {
    serverRows = [{ _id: ID(1), name: "Only", order: 1 }];

    renderTable({ initialFilterData: { name: "Only" } } as never);
    await waitForRows(1);

    expect(screen.queryByTestId("reorder-off-while-filtered")).toBeNull();
  });
});

describe("a table that is not drag-ordered", () => {
  test("keeps its own sort and page size, and has no grips", async () => {
    renderTable({
      enableDragAndDrop: false,
      dragDropIndexField: undefined,
      sortBy: "name",
    } as never);

    await waitFor(() => {
      expect(getListCalls.length).toBeGreaterThan(0);
    });

    expect(getListCalls[0]!.sort).toEqual({ name: SortOrder.Ascending });
    expect(getListCalls[0]!.limit).toBe(10);
    expect(screen.queryAllByTestId("drag-handle")).toHaveLength(0);
    expect(screen.queryByTestId("reorder-off-while-filtered")).toBeNull();
  });
});
