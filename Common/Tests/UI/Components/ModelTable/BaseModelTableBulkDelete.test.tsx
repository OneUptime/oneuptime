import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
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
 * Rendering a real table several times over comfortably outruns the 1s
 * default when the whole suite is competing for the same box.
 */
configure({ asyncUtilTimeout: 15000 });

/*
 * Bulk-deleting the rows you selected.
 *
 * Issue #3559 came from Network -> Devices: 916 devices selected out of 7,489,
 * "Bulk Actions" open, and every action in it except the one the user wanted -
 * Add/Remove Labels, Set/Clear OID Template, Archive, Export CSV. Deleting a
 * batch of stale or duplicated devices meant deleting them one at a time.
 *
 * The action is not written per page: ModelTable adds a default "Delete" to
 * any table that already offers bulk actions, for anyone the model lets
 * delete. What is asserted here is that behaviour end to end - it is offered,
 * it asks first, it deletes exactly what was selected - plus the two things
 * that only matter once the selection is large:
 *
 *   - the confirmation can carry what else leaves with the rows
 *     (`deleteConfirmationWarning`), because a devices page knows things the
 *     generic sentence cannot;
 *   - a delete that FAILS is reported. Failures used to be collected but
 *     never handed to the progress modal unless a later row happened to
 *     succeed, so a run whose trailing rows failed under-reported, and a run
 *     where everything failed - a permission or FK problem, which is what a
 *     900-row delete actually hits - finished looking like it had done
 *     nothing at all.
 */

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
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
        return isMasterAdminForTest;
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
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

type Row = {
  _id: string;
  name: string;
};

const ROWS: Array<Row> = [
  { _id: "device-1", name: "core-router-1" },
  { _id: "device-2", name: "core-router-2" },
  { _id: "device-3", name: "core-router-3" },
];

const ARCHIVE_ACTION: unknown = {
  title: "Archive",
  buttonStyleType: ButtonStyleType.NORMAL,
  onClick: async (): Promise<void> => {
    return Promise.resolve();
  },
};

const DEVICE_DELETE_WARNING: string =
  "Their interfaces, links, endpoints and any monitor OneUptime created for them are deleted too.";

type TableOptions = {
  bulkActionButtons?: Array<unknown> | undefined;
  deleteConfirmationWarning?: string | undefined;
  deleteItem?: ((item: NetworkDevice) => Promise<void>) | undefined;
};

describe("BaseModelTable bulk Delete", () => {
  let deletedIds: Array<string> = [];
  let getListCallCount: number = 0;

  type MakePropsFunction = (
    options: TableOptions,
  ) => BaseModelTableProps<NetworkDevice>;

  const makeProps: MakePropsFunction = (
    options: TableOptions,
  ): BaseModelTableProps<NetworkDevice> => {
    const callbacks: BaseTableCallbacks<NetworkDevice> = {
      deleteItem: async (item: NetworkDevice): Promise<void> => {
        if (options.deleteItem) {
          await options.deleteItem(item);
        }

        deletedIds.push(String((item as unknown as Row)._id));
      },
      getModelFromJSON: (item: JSONObject): NetworkDevice => {
        return item as unknown as NetworkDevice;
      },
      getJSONFromModel: (item: NetworkDevice): JSONObject => {
        return item as unknown as JSONObject;
      },
      addSlugToSelect: (select: unknown): unknown => {
        return select;
      },
      getList: async (data: {
        skip: number;
        limit: number;
      }): Promise<ListResult<NetworkDevice>> => {
        getListCallCount++;

        return {
          data: ROWS as unknown as Array<NetworkDevice>,
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
    } as unknown as BaseTableCallbacks<NetworkDevice>;

    return {
      modelType: NetworkDevice,
      id: "network-devices-table",
      name: "Network Devices",
      userPreferencesKey: "network-devices-bulk-delete-table",
      urlStateKey: "network-devices-bulk-delete-table",
      columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
      filters: [],
      cardProps: {
        title: "Network Devices",
        description: "Every device in this project",
      },
      /*
       * Exactly how the Devices page is configured: no per-row Delete button.
       * Bulk deletion is deliberately not tied to that flag - `isDeleteable`
       * is about the Actions column, not about the selection bar.
       */
      isCreateable: true,
      isEditable: false,
      isDeleteable: false,
      isViewable: true,
      callbacks: callbacks,
      bulkActions: {
        buttons: options.bulkActionButtons ?? [ARCHIVE_ACTION],
        ...(options.deleteConfirmationWarning
          ? { deleteConfirmationWarning: options.deleteConfirmationWarning }
          : {}),
      },
    } as unknown as BaseModelTableProps<NetworkDevice>;
  };

  type RenderTableFunction = (
    options?: TableOptions | undefined,
  ) => ReturnType<typeof render>;

  const renderTable: RenderTableFunction = (
    options?: TableOptions | undefined,
  ): ReturnType<typeof render> => {
    return render(
      <BaseModelTable<NetworkDevice> {...makeProps(options || {})} />,
    );
  };

  type SelectRowsFunction = (
    container: HTMLElement,
    count: number,
  ) => Promise<void>;

  /* Ticks the first `count` row checkboxes, skipping the header's select-all. */
  const selectRows: SelectRowsFunction = async (
    container: HTMLElement,
    count: number,
  ): Promise<void> => {
    await waitFor(() => {
      expect(
        container.querySelectorAll('input[type="checkbox"]:not([disabled])')
          .length,
      ).toBeGreaterThan(ROWS.length);
    });

    const checkboxes: Array<HTMLInputElement> = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );

    /*
     * The header carries its own select-all box, so the row boxes are the
     * trailing ones. Taking them from the end keeps this independent of where
     * the header box sits in the DOM.
     */
    const rowCheckboxes: Array<HTMLInputElement> = checkboxes.slice(
      checkboxes.length - ROWS.length,
    );

    for (let index: number = 0; index < count; index++) {
      fireEvent.click(rowCheckboxes[index]!);
    }
  };

  type OpenBulkMenuFunction = () => Promise<void>;

  const openBulkMenu: OpenBulkMenuFunction = async (): Promise<void> => {
    await waitFor(() => {
      expect(screen.getByText("Bulk Actions")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Bulk Actions"));

    await waitFor(() => {
      expect(
        document.querySelectorAll('[role="menuitem"]').length,
      ).toBeGreaterThan(0);
    });
  };

  type FindMenuItemFunction = (label: string) => HTMLElement | undefined;

  const findMenuItem: FindMenuItemFunction = (
    label: string,
  ): HTMLElement | undefined => {
    return Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item: HTMLElement) => {
      return (item.textContent || "").trim() === label;
    });
  };

  type MenuItemLabelsFunction = () => Array<string>;

  const menuItemLabels: MenuItemLabelsFunction = (): Array<string> => {
    return Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((item: HTMLElement) => {
      return (item.textContent || "").trim();
    });
  };

  type ConfirmFunction = () => Promise<void>;

  /* Presses the danger button in the confirmation dialog's footer. */
  const confirmDelete: ConfirmFunction = async (): Promise<void> => {
    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="modal-footer"]'),
      ).not.toBeNull();
    });

    const footer: HTMLElement = document.querySelector<HTMLElement>(
      '[data-testid="modal-footer"]',
    )!;

    const submitButton: HTMLButtonElement | undefined = Array.from(
      footer.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button: HTMLButtonElement) => {
      return (button.textContent || "").trim() === "Delete";
    });

    expect(submitButton).toBeDefined();

    fireEvent.click(submitButton!);
  };

  type CloseProgressModalFunction = () => Promise<void>;

  /*
   * The results modal stays up until the user dismisses it - that is when the
   * table drops the selection and refetches.
   */
  const closeProgressModal: CloseProgressModalFunction =
    async (): Promise<void> => {
      await waitFor(() => {
        expect(
          Array.from(
            document.querySelectorAll<HTMLButtonElement>(
              '[data-testid="modal-footer"] button',
            ),
          ).find((button: HTMLButtonElement) => {
            return (
              (button.textContent || "").trim() === "Close" && !button.disabled
            );
          }),
        ).toBeDefined();
      });

      const closeButton: HTMLButtonElement = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[data-testid="modal-footer"] button',
        ),
      ).find((button: HTMLButtonElement) => {
        return (
          (button.textContent || "").trim() === "Close" && !button.disabled
        );
      })!;

      fireEvent.click(closeButton);
    };

  type StartBulkDeleteFunction = (
    options?: TableOptions | undefined,
  ) => Promise<ReturnType<typeof render>>;

  /* Select two rows, open the menu, click Delete. Stops before confirming. */
  const startBulkDelete: StartBulkDeleteFunction = async (
    options?: TableOptions | undefined,
  ): Promise<ReturnType<typeof render>> => {
    const result: ReturnType<typeof render> = renderTable(options);

    await selectRows(result.container, 2);
    await openBulkMenu();

    fireEvent.click(findMenuItem("Delete")!);

    return result;
  };

  type ConfirmationTextFunction = () => string;

  const confirmationText: ConfirmationTextFunction = (): string => {
    return (
      document.querySelector('[data-testid="confirm-modal-description"]')
        ?.textContent || ""
    );
  };

  beforeEach(() => {
    isMasterAdminForTest = false;
    permissionsForTest = [Permission.ProjectAdmin];
    deletedIds = [];
    getListCallCount = 0;
    PermissionGate.clearPermissionPropsCache();
    window.history.replaceState(
      window.history.state,
      "",
      "/dashboard/network-devices",
    );
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("the action is offered", () => {
    /*
     * The report itself: a devices table whose bulk menu had Archive and
     * Export CSV in it and no way to delete anything.
     */
    test("Delete sits in the bulk menu alongside the page's own actions", async () => {
      const { container } = renderTable();

      await selectRows(container, 1);
      await openBulkMenu();

      expect(menuItemLabels()).toEqual(
        expect.arrayContaining(["Archive", "Export CSV", "Delete"]),
      );
      expect(findMenuItem("Delete")).not.toBeDisabled();
    });

    /* `isDeleteable={false}` is about the row's Actions column, nothing else. */
    test("is offered even though the table has no per-row Delete button", async () => {
      const { container } = renderTable();

      await selectRows(container, 1);

      const rowDeleteButton: HTMLButtonElement | undefined = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button: HTMLButtonElement) => {
        return (button.textContent || "").trim() === "Delete";
      });

      expect(rowDeleteButton).toBeUndefined();

      await openBulkMenu();

      expect(findMenuItem("Delete")).toBeDefined();
    });

    /* One Delete, whoever supplied it - not the page's plus an injected one. */
    test("is not duplicated when the page supplies its own Delete", async () => {
      const { container } = renderTable({
        bulkActionButtons: [
          ARCHIVE_ACTION,
          {
            title: "Delete",
            buttonStyleType: ButtonStyleType.DANGER,
            onClick: async (): Promise<void> => {
              return Promise.resolve();
            },
          },
        ],
      });

      await selectRows(container, 1);
      await openBulkMenu();

      expect(
        menuItemLabels().filter((label: string) => {
          return label === "Delete";
        }).length,
      ).toBe(1);
    });
  });

  describe("the confirmation", () => {
    test("names the count and the model, and warns it cannot be undone", async () => {
      await startBulkDelete();

      await waitFor(() => {
        expect(confirmationText()).not.toBe("");
      });

      expect(confirmationText()).toContain("delete 2 Network Devices");
      expect(confirmationText()).toContain("cannot be undone");
    });

    test("uses the singular when one row is selected", async () => {
      const { container } = renderTable();

      await selectRows(container, 1);
      await openBulkMenu();

      fireEvent.click(findMenuItem("Delete")!);

      await waitFor(() => {
        expect(confirmationText()).not.toBe("");
      });

      expect(confirmationText()).toContain("delete 1 Network Device?");
    });

    /*
     * A devices page knows what leaves with a device - its interfaces, links
     * and auto-created monitor - and that Archive is the reversible option.
     * The default sentence cannot know any of that.
     */
    test("carries the table's own warning when it sets one", async () => {
      await startBulkDelete({
        deleteConfirmationWarning: DEVICE_DELETE_WARNING,
      });

      await waitFor(() => {
        expect(confirmationText()).not.toBe("");
      });

      expect(confirmationText()).toContain("cannot be undone");
      expect(confirmationText()).toContain(DEVICE_DELETE_WARNING);
    });

    test("says nothing extra when the table sets no warning", async () => {
      await startBulkDelete();

      await waitFor(() => {
        expect(confirmationText()).not.toBe("");
      });

      expect(confirmationText().trim()).toBe(
        "Are you sure you want to delete 2 Network Devices? This action cannot be undone.",
      );
    });

    test("deletes nothing until it is confirmed", async () => {
      await startBulkDelete();

      await waitFor(() => {
        expect(confirmationText()).not.toBe("");
      });

      expect(deletedIds).toEqual([]);
    });
  });

  describe("running the delete", () => {
    test("deletes every selected row, and only those", async () => {
      await startBulkDelete();
      await confirmDelete();

      await waitFor(() => {
        expect(deletedIds.length).toBe(2);
      });

      expect(deletedIds.sort()).toEqual(["device-1", "device-2"]);
    });

    test("reloads the table once the results are dismissed", async () => {
      await startBulkDelete();
      await confirmDelete();

      await waitFor(() => {
        expect(deletedIds.length).toBe(2);
      });

      const callsBefore: number = getListCallCount;

      await closeProgressModal();

      await waitFor(() => {
        expect(getListCallCount).toBeGreaterThan(callsBefore);
      });
    });

    test("reports how many succeeded", async () => {
      await startBulkDelete();
      await confirmDelete();

      await waitFor(() => {
        expect(screen.queryByText(/succeeded/)).not.toBeNull();
      });

      expect(
        screen.getByText("2 Network Devices succeeded"),
      ).toBeInTheDocument();
    });
  });

  describe("reporting failures", () => {
    type FailingDeleteFunction = (
      failingIds: Array<string>,
    ) => (item: NetworkDevice) => Promise<void>;

    const failFor: FailingDeleteFunction = (
      failingIds: Array<string>,
    ): ((item: NetworkDevice) => Promise<void>) => {
      return (item: NetworkDevice): Promise<void> => {
        if (failingIds.includes(String((item as unknown as Row)._id))) {
          return Promise.reject(
            new Error("Device is referenced by a monitor you cannot delete"),
          );
        }

        return Promise.resolve();
      };
    };

    test("names the failures and their reason alongside the successes", async () => {
      await startBulkDelete({ deleteItem: failFor(["device-1"]) });
      await confirmDelete();

      await waitFor(() => {
        expect(screen.queryByText(/failed/)).not.toBeNull();
      });

      expect(screen.getByText("1 Network Device failed")).toBeInTheDocument();
      expect(
        screen.getByText("1 Network Device succeeded"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Device is referenced by a monitor you cannot delete"),
      ).toBeInTheDocument();
    });

    /*
     * A trailing failure used to reach the modal only by accident: the
     * progress info handed React the live `failed` array, so a push after the
     * last report mutated the snapshot already in state. The fix hands out
     * copies, which is the honest thing to do and removes that accident - so
     * this case now depends entirely on reporting from the catch, and is
     * pinned here.
     */
    test("reports a failure on the last row of the run", async () => {
      await startBulkDelete({ deleteItem: failFor(["device-2"]) });
      await confirmDelete();

      await waitFor(() => {
        expect(screen.queryByText(/failed/)).not.toBeNull();
      });

      expect(screen.getByText("1 Network Device failed")).toBeInTheDocument();
    });

    /*
     * The shape that was plainly broken: with nothing succeeding, the progress
     * info was never reported at all, so the modal fell back on the snapshot
     * taken before the run and finished completely blank - no successes, no
     * failures, no explanation of why nothing had been deleted.
     */
    test("reports failures when every row fails", async () => {
      await startBulkDelete({
        deleteItem: failFor(["device-1", "device-2"]),
      });
      await confirmDelete();

      await waitFor(() => {
        expect(screen.queryByText(/failed/)).not.toBeNull();
      });

      expect(screen.getByText("2 Network Devices failed")).toBeInTheDocument();
      expect(screen.queryByText(/succeeded/)).toBeNull();
    });

    test("keeps deleting the rest of the selection after one fails", async () => {
      await startBulkDelete({ deleteItem: failFor(["device-1"]) });
      await confirmDelete();

      await waitFor(() => {
        expect(deletedIds).toEqual(["device-2"]);
      });
    });
  });

  describe("permission", () => {
    test("is locked, with a reason, for someone who may not delete", async () => {
      permissionsForTest = [Permission.Viewer];

      const { container } = renderTable();

      await selectRows(container, 1);
      await openBulkMenu();

      const deleteItem: HTMLElement | undefined = findMenuItem("Delete");

      expect(deleteItem).toBeDefined();
      expect(deleteItem).toBeDisabled();

      fireEvent.mouseEnter(deleteItem!.parentElement as HTMLElement);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "You do not have permission to delete this Network Device.",
      );
    });

    /*
     * A master admin is allowed everything by the gate, but holds no project
     * permission for the model-level check to find - so the menu offered them
     * every action except the one they were most entitled to.
     */
    test("is offered to a master admin holding no project permissions", async () => {
      isMasterAdminForTest = true;
      permissionsForTest = [];

      const { container } = renderTable();

      await selectRows(container, 1);
      await openBulkMenu();

      expect(findMenuItem("Delete")).toBeDefined();
      expect(findMenuItem("Delete")).not.toBeDisabled();
    });

    /*
     * The row checkboxes exist only because the table has bulk actions at all,
     * so a table with none must not grow a selection column just because
     * somebody may delete. This is the reason the gate is not consulted on its
     * own, and it holds for a master admin too.
     */
    test("is not injected into a table that offers no bulk actions", async () => {
      isMasterAdminForTest = true;
      permissionsForTest = [];

      const { container } = renderTable({ bulkActionButtons: [] });

      await waitFor(() => {
        expect(screen.getByText("core-router-1")).toBeInTheDocument();
      });

      expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(
        0,
      );
    });

    test("a locked Delete does not open the confirmation", async () => {
      permissionsForTest = [Permission.Viewer];

      const { container } = renderTable();

      await selectRows(container, 1);
      await openBulkMenu();

      fireEvent.click(findMenuItem("Delete")!);

      expect(
        document.querySelector('[data-testid="confirm-modal-description"]'),
      ).toBeNull();
      expect(deletedIds).toEqual([]);
    });
  });
});
