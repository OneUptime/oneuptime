import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
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

configure({ asyncUtilTimeout: 15000 });

/*
 * BaseModelTable.getDeleteDisabledReason: rows that can never be deleted -
 * a project's built-in states - and why.
 *
 * The state settings pages used to refuse such a delete only in
 * onBeforeDelete, after the click, in an error dialog. And the bulk Delete
 * every deletable table offers never ran onBeforeDelete at all, so once the
 * pages became ordinary tables, ticking Resolved and pressing Delete would
 * have sent it to the server. What is pinned here:
 *
 *   - a locked row keeps Delete in its ⋯ menu, locked, describing why, and
 *     pressing it opens nothing;
 *   - every other row deletes as before;
 *   - a bulk Delete skips the locked rows - nothing is sent for them - and
 *     lists them with the reason, next to the ones it did delete;
 *   - a table without the prop is exactly as it was.
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

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

type Row = {
  _id: string;
  name: string;
  order: number;
  isCreatedState?: boolean;
  isResolvedState?: boolean;
};

const ROWS: Array<Row> = [
  { _id: "state-1", name: "Identified", order: 1, isCreatedState: true },
  { _id: "state-2", name: "Investigating", order: 2 },
  { _id: "state-3", name: "Resolved", order: 3, isResolvedState: true },
];

const LOCKED_REASON: string =
  "Built-in states can be renamed, but not deleted.";

const isBuiltIn: (item: IncidentState) => boolean = (
  item: IncidentState,
): boolean => {
  const row: Row = item as unknown as Row;
  return Boolean(row.isCreatedState || row.isResolvedState);
};

let deletedIds: Array<string> = [];

const makeProps: (options: {
  withLock: boolean;
  enableDragAndDrop?: boolean;
}) => BaseModelTableProps<IncidentState> = (options: {
  withLock: boolean;
  enableDragAndDrop?: boolean;
}): BaseModelTableProps<IncidentState> => {
  const callbacks: BaseTableCallbacks<IncidentState> = {
    deleteItem: async (item: IncidentState): Promise<void> => {
      deletedIds.push(String((item as unknown as Row)._id));
    },
    getModelFromJSON: (item: JSONObject): IncidentState => {
      return item as unknown as IncidentState;
    },
    getJSONFromModel: (item: IncidentState): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<IncidentState>> => {
      return {
        data: ROWS as unknown as Array<IncidentState>,
        count: ROWS.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      return <div data-testid="create-edit-modal" />;
    },
  } as unknown as BaseTableCallbacks<IncidentState>;

  return {
    modelType: IncidentState,
    id: "incident-state-table",
    name: "Settings > Incident State",
    userPreferencesKey: "incident-state-delete-lock-table",
    urlStateKey: "incident-state-delete-lock-table",
    columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
    filters: [],
    cardProps: {
      title: "Incident States",
      description: "Incidents only ever move down this list.",
    },
    isCreateable: true,
    isEditable: true,
    isDeleteable: true,
    callbacks: callbacks,
    ...(options.enableDragAndDrop
      ? { enableDragAndDrop: true, dragDropIndexField: "order" }
      : {}),
    ...(options.withLock
      ? {
          getDeleteDisabledReason: (
            item: IncidentState,
          ): string | undefined => {
            return isBuiltIn(item) ? LOCKED_REASON : undefined;
          },
        }
      : {}),
  } as unknown as BaseModelTableProps<IncidentState>;
};

// The ⋯ menu of the row that shows `name`.
const openRowMenu: (name: string) => Promise<HTMLElement> = async (
  name: string,
): Promise<HTMLElement> => {
  await waitFor(() => {
    expect(screen.getByText(name)).toBeInTheDocument();
  });

  const row: HTMLElement = screen.getByText(name).closest("tr")!;

  fireEvent.click(within(row).getByTestId("row-actions-more-button"));

  return screen.getByRole("menu");
};

const reasonOf: (item: HTMLElement) => string | null = (
  item: HTMLElement,
): string | null => {
  const describedBy: string | null = item.getAttribute("aria-describedby");
  return describedBy
    ? document.getElementById(describedBy)?.textContent || null
    : null;
};

/* Ticks the row checkboxes of the rows that show these names. */
const selectRows: (names: Array<string>) => Promise<void> = async (
  names: Array<string>,
): Promise<void> => {
  await waitFor(() => {
    expect(screen.getByText(names[0]!)).toBeInTheDocument();
  });

  for (const name of names) {
    const row: HTMLElement = screen.getByText(name).closest("tr")!;
    fireEvent.click(row.querySelector('input[type="checkbox"]')!);
  }
};

const runBulkDelete: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.getByText("Bulk Actions")).toBeInTheDocument();
  });

  fireEvent.click(screen.getByText("Bulk Actions"));

  await waitFor(() => {
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]')).some(
        (item: Element) => {
          return (item.textContent || "").trim() === "Delete";
        },
      ),
    ).toBe(true);
  });

  fireEvent.click(
    Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item: HTMLElement) => {
      return (item.textContent || "").trim() === "Delete";
    })!,
  );

  await waitFor(() => {
    expect(
      document.querySelector('[data-testid="modal-footer"]'),
    ).not.toBeNull();
  });

  fireEvent.click(
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="modal-footer"] button',
      ),
    ).find((button: HTMLButtonElement) => {
      return (button.textContent || "").trim() === "Delete";
    })!,
  );
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  deletedIds = [];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/settings");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("a row's Delete, locked by getDeleteDisabledReason", () => {
  test("a built-in state keeps Delete in its menu, locked, and says why", async () => {
    render(
      <BaseModelTable<IncidentState> {...makeProps({ withLock: true })} />,
    );

    for (const name of ["Identified", "Resolved"]) {
      const menu: HTMLElement = await openRowMenu(name);
      const deleteItem: HTMLElement = within(menu).getByRole("menuitem", {
        name: "Delete",
      });

      expect(deleteItem).toHaveAttribute("aria-disabled", "true");
      expect(reasonOf(deleteItem)).toBe(LOCKED_REASON);

      // Close the menu again.
      fireEvent.keyDown(menu, { key: "Escape" });
    }
  });

  test("pressing a locked Delete opens nothing", async () => {
    render(
      <BaseModelTable<IncidentState> {...makeProps({ withLock: true })} />,
    );

    const menu: HTMLElement = await openRowMenu("Resolved");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    expect(document.querySelector('[data-testid="modal-footer"]')).toBeNull();
    expect(deletedIds).toEqual([]);
  });

  test("a state the project added deletes as before", async () => {
    render(
      <BaseModelTable<IncidentState> {...makeProps({ withLock: true })} />,
    );

    const menu: HTMLElement = await openRowMenu("Investigating");
    const deleteItem: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });

    expect(deleteItem).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(deleteItem);

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="modal-footer"]'),
      ).not.toBeNull();
    });
  });

  test("without the prop, nothing is locked", async () => {
    render(
      <BaseModelTable<IncidentState> {...makeProps({ withLock: false })} />,
    );

    const menu: HTMLElement = await openRowMenu("Resolved");

    expect(
      within(menu).getByRole("menuitem", { name: "Delete" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  test("the table's Create is the card's button", async () => {
    render(
      <BaseModelTable<IncidentState> {...makeProps({ withLock: true })} />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Create Incident State" }),
      ).toBeInTheDocument();
    });
  });
});

describe.each([
  ["a plain table", false],
  ["a drag-ordered table", true],
])("a bulk Delete on %s", (_label: string, enableDragAndDrop: boolean) => {
  test("skips the built-in states and says why, and deletes the rest", async () => {
    render(
      <BaseModelTable<IncidentState>
        {...makeProps({ withLock: true, enableDragAndDrop })}
      />,
    );

    await selectRows(["Identified", "Investigating"]);
    await runBulkDelete();

    await waitFor(() => {
      expect(screen.queryByText(/failed/)).not.toBeNull();
    });

    // Nothing was sent for the built-in state.
    expect(deletedIds).toEqual(["state-2"]);
    expect(screen.getByText("1 Incident State failed")).toBeInTheDocument();
    expect(screen.getByText("1 Incident State succeeded")).toBeInTheDocument();
    expect(screen.getByText(LOCKED_REASON)).toBeInTheDocument();
  });

  test("a selection of built-in states only deletes nothing", async () => {
    render(
      <BaseModelTable<IncidentState>
        {...makeProps({ withLock: true, enableDragAndDrop })}
      />,
    );

    await selectRows(["Identified", "Resolved"]);
    await runBulkDelete();

    await waitFor(() => {
      expect(screen.getByText("2 Incident States failed")).toBeInTheDocument();
    });

    expect(deletedIds).toEqual([]);
    expect(screen.queryByText(/succeeded/)).toBeNull();
  });
});
