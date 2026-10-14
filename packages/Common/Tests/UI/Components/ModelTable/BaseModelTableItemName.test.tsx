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
 * BaseModelTable.getItemName: what a row is called where the table names
 * it, for a model with no name column of its own.
 *
 * A monitor's status event has none. The table named such a row by its id,
 * so a bulk Delete that skipped the event the server refuses listed it as
 * "Monitor Status Event 7e1f0a0e-4444-4c1e-9a1e-000000000001", and a screen
 * reader heard "More actions" on every row alike. What is pinned here:
 *
 *   - the name reaches every place the table names a row: the row's ⋯ and
 *     checkbox, the bulk Delete's question and its list of what it skipped,
 *     and the per-row Delete question;
 *   - "" falls back to the row's own name column, and a table without the
 *     prop is as it was;
 *   - the kind of row before the name is in the reader's language.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
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

// The reader's language, for the words this file looks for: German.
const GERMAN: Record<string, string> = {
  "Monitor Status Event": "Monitor-Statusereignis",
};

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value && GERMAN[value] ? GERMAN[value] : value;
        },
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" && GERMAN[value]
            ? GERMAN[value]
            : value;
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
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

type Row = {
  _id: string;
  rootCause: string;
  status: string;
  shownStartsAt: string;
};

const ROWS: Array<Row> = [
  {
    _id: "7e1f0a0e-4444-4c1e-9a1e-000000000003",
    rootCause: "Recovered",
    status: "Operational",
    shownStartsAt: "Sep 25 2026, 02:04 PM GMT",
  },
  {
    _id: "7e1f0a0e-4444-4c1e-9a1e-000000000002",
    rootCause: "Timed out",
    status: "Offline",
    shownStartsAt: "Sep 24 2026, 02:04 PM GMT",
  },
  {
    _id: "7e1f0a0e-4444-4c1e-9a1e-000000000001",
    rootCause: "Created",
    status: "Operational",
    shownStartsAt: "Oct 14 2025, 02:04 PM GMT",
  },
];

const OLDEST_ID: string = "7e1f0a0e-4444-4c1e-9a1e-000000000001";
const LOCKED_REASON: string =
  "The monitor's oldest status event can't be deleted while it covers part of the last 90 days.";

/*
 * A row as the table holds it: a model, whose kind ("Monitor Status Event")
 * the table reads off it. Its status and start ride along as plain fields.
 */
const toModel: (row: Row) => MonitorStatusTimeline = (
  row: Row,
): MonitorStatusTimeline => {
  const model: MonitorStatusTimeline = new MonitorStatusTimeline();
  model._id = row._id;
  model.rootCause = row.rootCause;
  Object.assign(model, {
    status: row.status,
    shownStartsAt: row.shownStartsAt,
  });
  return model;
};

const nameOf: (item: MonitorStatusTimeline) => string = (
  item: MonitorStatusTimeline,
): string => {
  const row: Row = item as unknown as Row;
  return `${row.status} (${row.shownStartsAt})`;
};

let deletedIds: Array<string> = [];

const makeProps: (options: {
  getItemName?: ((item: MonitorStatusTimeline) => string) | undefined;
}) => BaseModelTableProps<MonitorStatusTimeline> = (options: {
  getItemName?: ((item: MonitorStatusTimeline) => string) | undefined;
}): BaseModelTableProps<MonitorStatusTimeline> => {
  const callbacks: BaseTableCallbacks<MonitorStatusTimeline> = {
    deleteItem: async (item: MonitorStatusTimeline): Promise<void> => {
      deletedIds.push(String((item as unknown as Row)._id));
    },
    getModelFromJSON: (item: JSONObject): MonitorStatusTimeline => {
      return item as unknown as MonitorStatusTimeline;
    },
    getJSONFromModel: (item: MonitorStatusTimeline): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<MonitorStatusTimeline>> => {
      return {
        data: ROWS.map(toModel),
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
  } as unknown as BaseTableCallbacks<MonitorStatusTimeline>;

  return {
    modelType: MonitorStatusTimeline,
    id: "monitor-status-timeline-name-table",
    name: "Monitor > Status Timeline",
    userPreferencesKey: "monitor-status-timeline-name-table",
    urlStateKey: "monitor-status-timeline-name-table",
    columns: [
      {
        field: { rootCause: true },
        title: "Root Cause",
        type: FieldType.Text,
      },
    ],
    filters: [],
    cardProps: {
      title: "Status Timeline",
      description: "Each status this monitor has been in.",
    },
    isCreateable: false,
    isEditable: false,
    isDeleteable: true,
    // Show ID beside Delete, as the Status Timeline has: the row gets its ⋯.
    showViewIdButton: true,
    callbacks: callbacks,
    getDeleteDisabledReason: (
      item: MonitorStatusTimeline,
    ): string | undefined => {
      return (item as unknown as Row)._id === OLDEST_ID
        ? LOCKED_REASON
        : undefined;
    },
    ...(options.getItemName ? { getItemName: options.getItemName } : {}),
  } as unknown as BaseModelTableProps<MonitorStatusTimeline>;
};

const rowOf: (text: string) => Promise<HTMLElement> = async (
  text: string,
): Promise<HTMLElement> => {
  await waitFor(() => {
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  return screen.getByText(text).closest("tr")!;
};

const runBulkDeleteOfEveryRow: () => Promise<void> =
  async (): Promise<void> => {
    for (const row of ROWS) {
      const element: HTMLElement = await rowOf(row.rootCause);
      fireEvent.click(element.querySelector('input[type="checkbox"]')!);
    }

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
  };

const confirmBulkDelete: () => void = (): void => {
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
  window.history.replaceState(window.history.state, "", "/dashboard/monitor");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("a row named by getItemName", () => {
  test("its ⋯ and its checkbox say which row they belong to", async () => {
    render(
      <BaseModelTable<MonitorStatusTimeline>
        {...makeProps({ getItemName: nameOf })}
      />,
    );

    const row: HTMLElement = await rowOf("Timed out");

    expect(
      within(row).getByTestId("row-actions-more-button"),
    ).toHaveAccessibleName(
      "More actions for Monitor-Statusereignis: Offline (Sep 24 2026, 02:04 PM GMT)",
    );
    expect(
      row.querySelector('input[type="checkbox"]')!.getAttribute("aria-label"),
    ).toBe(
      "Select Monitor-Statusereignis: Offline (Sep 24 2026, 02:04 PM GMT)",
    );
  });

  test("a bulk Delete names the rows it asks about", async () => {
    render(
      <BaseModelTable<MonitorStatusTimeline>
        {...makeProps({ getItemName: nameOf })}
      />,
    );

    await runBulkDeleteOfEveryRow();

    const dialog: HTMLElement = screen.getByRole("dialog");

    for (const row of ROWS) {
      expect(
        within(dialog).getByText(`${row.status} (${row.shownStartsAt})`),
      ).toBeInTheDocument();
    }
  });

  test("and names the row it skipped, with why, never by its id", async () => {
    render(
      <BaseModelTable<MonitorStatusTimeline>
        {...makeProps({ getItemName: nameOf })}
      />,
    );

    await runBulkDeleteOfEveryRow();
    confirmBulkDelete();

    await waitFor(() => {
      expect(
        screen.getByTestId("bulk-action-failed-items"),
      ).toBeInTheDocument();
    });

    const failed: HTMLElement = screen.getByTestId("bulk-action-failed-items");

    expect(failed).toHaveTextContent(
      "Monitor-Statusereignis: Operational (Oct 14 2025, 02:04 PM GMT)",
    );
    expect(failed).toHaveTextContent(LOCKED_REASON);
    expect(failed).not.toHaveTextContent(OLDEST_ID);

    // The other two were deleted; nothing was sent for the locked one.
    expect(deletedIds.sort()).toEqual([ROWS[0]!._id, ROWS[1]!._id].sort());
  });

  test("the per-row Delete asks about the row by its name", async () => {
    render(
      <BaseModelTable<MonitorStatusTimeline>
        {...makeProps({ getItemName: nameOf })}
      />,
    );

    const row: HTMLElement = await rowOf("Recovered");
    fireEvent.click(within(row).getByTestId("row-actions-more-button"));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Delete",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("delete-confirmation-name"),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("delete-confirmation-name")).toHaveTextContent(
      "Operational (Sep 25 2026, 02:04 PM GMT)",
    );
  });

  test('"" falls back to the row\'s own name, as a table without the prop does', async () => {
    render(
      <BaseModelTable<MonitorStatusTimeline>
        {...makeProps({
          getItemName: (): string => {
            return "";
          },
        })}
      />,
    );

    const row: HTMLElement = await rowOf("Timed out");

    // A status event has no name column: the kind of row, then its id.
    expect(
      row.querySelector('input[type="checkbox"]')!.getAttribute("aria-label"),
    ).toBe(`Select Monitor-Statusereignis ${ROWS[1]!._id}`);
  });
});

describe("a table without getItemName", () => {
  test("names a row with no name column by its kind and id, as before", async () => {
    render(<BaseModelTable<MonitorStatusTimeline> {...makeProps({})} />);

    const row: HTMLElement = await rowOf("Created");

    expect(
      row.querySelector('input[type="checkbox"]')!.getAttribute("aria-label"),
    ).toBe(`Select Monitor-Statusereignis ${OLDEST_ID}`);
  });
});
