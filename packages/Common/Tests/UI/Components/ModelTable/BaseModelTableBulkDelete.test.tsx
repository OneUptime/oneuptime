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
 * any table whose rows are deleted from it (`isDeleteable` - the same switch
 * that puts Delete in each row's ⋯ menu) and that already offers bulk
 * actions, for anyone the model lets delete. What is asserted here is that
 * behaviour end to end - it is offered exactly where the row's Delete is, it
 * asks first, it deletes exactly what was selected - plus the things that
 * only matter once the selection is large:
 *
 *   - the confirmation says what else leaves with the rows - the model's own
 *     sentence (DeleteConsequences), then the table's
 *     (`deleteConfirmationWarning`) - in a paragraph after their names;
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
  BULK_SKIPPED_COUNT,
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
  ModalTableBulkDefaultActions,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import fs from "fs";
import path from "path";
import { BulkActionConfirmControls } from "../../../../UI/Components/BulkUpdate/BulkUpdateForm";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Permission from "../../../../Types/Permission";
import IconProp from "../../../../Types/Icon/IconProp";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

type Row = {
  _id: string;
  name: string;
};

// "{{count}}": nothing between the braces may be a brace, which keeps it linear.
const SKIPPED_PLACEHOLDER: RegExp = /\{\{[^{}]+\}\}/g;

const ROWS: Array<Row> = [
  { _id: "device-1", name: "core-router-1" },
  { _id: "device-2", name: "core-router-2" },
  { _id: "device-3", name: "core-router-3" },
];

const ARCHIVE_ACTION: unknown = {
  title: "Archive",
  icon: IconProp.Archive,
  buttonStyleType: ButtonStyleType.NORMAL,
  onClick: async (): Promise<void> => {
    return Promise.resolve();
  },
};

const DEVICE_DELETE_WARNING: string =
  "Archive devices instead to keep their history.";

// DeleteConsequences' sentence for a network device, said by every Delete.
const NETWORK_DEVICE_CONSEQUENCE: string =
  "Deleting a network device also deletes its interfaces, links, endpoints and any monitor OneUptime created for it, with that monitor's history.";

type TableOptions = {
  isDeleteable?: boolean | undefined;
  deleteConfirmationDetails?:
    | ((
        items: Array<NetworkDevice>,
        controls: BulkActionConfirmControls,
      ) => React.ReactElement | undefined)
    | undefined;
  getDeleteRefusal?: ((item: NetworkDevice) => string | undefined) | undefined;
  onDeleteEnd?: (() => void) | undefined;
  bulkActionButtons?: Array<unknown> | undefined;
  deleteConfirmationWarning?: string | undefined;
  deleteVerb?: string | undefined;
  deleteIcon?: IconProp | undefined;
  deleteItem?: ((item: NetworkDevice) => Promise<void>) | undefined;
  deleteConcurrency?: number | undefined;
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
       * As the Devices page is configured: rows deleted from the list - Delete
       * in each row's ⋯ menu and in Bulk Actions, the two always together.
       */
      isCreateable: true,
      isEditable: false,
      isDeleteable: options.isDeleteable ?? true,
      isViewable: true,
      callbacks: callbacks,
      bulkActions: {
        buttons: options.bulkActionButtons ?? [ARCHIVE_ACTION],
        ...(options.deleteConfirmationWarning
          ? { deleteConfirmationWarning: options.deleteConfirmationWarning }
          : {}),
        ...(options.deleteVerb ? { deleteVerb: options.deleteVerb } : {}),
        ...(options.deleteIcon ? { deleteIcon: options.deleteIcon } : {}),
        ...(options.deleteConcurrency !== undefined
          ? { deleteConcurrency: options.deleteConcurrency }
          : {}),
        ...(options.deleteConfirmationDetails
          ? { deleteConfirmationDetails: options.deleteConfirmationDetails }
          : {}),
        ...(options.getDeleteRefusal
          ? { getDeleteRefusal: options.getDeleteRefusal }
          : {}),
        ...(options.onDeleteEnd ? { onDeleteEnd: options.onDeleteEnd } : {}),
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

  type ConfirmFunction = (buttonText?: string | undefined) => Promise<void>;

  /* Presses the danger button in the confirmation dialog's footer. */
  const confirmDelete: ConfirmFunction = async (
    buttonText?: string | undefined,
  ): Promise<void> => {
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
      return (button.textContent || "").trim() === (buttonText || "Delete");
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

  // What the bulk dialog says goes with the rows, after their names.
  const consequenceText: ConfirmationTextFunction = (): string => {
    return (
      document.querySelector('[data-testid="bulk-delete-consequence"]')
        ?.textContent || ""
    );
  };

  type HasTextFunction = (testId: string) => string;

  const textOf: HasTextFunction = (testId: string): string => {
    return (
      document.querySelector(`[data-testid="${testId}"]`)?.textContent || ""
    ).trim();
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

    /*
     * One switch for both: a list whose rows are deleted from it offers Delete
     * in each row's ⋯ menu and in Bulk Actions.
     */
    test("is offered where each row's ⋯ menu offers Delete too", async () => {
      const { container } = renderTable();

      await waitFor(() => {
        expect(
          container.querySelectorAll('[data-testid="row-actions-more-button"]')
            .length,
        ).toBe(ROWS.length);
      });

      fireEvent.click(
        container.querySelector<HTMLElement>(
          '[data-testid="row-actions-more-button"]',
        )!,
      );

      await waitFor(() => {
        expect(findMenuItem("Delete")).toBeDefined();
      });

      // Close the row's menu before opening Bulk Actions.
      fireEvent.keyDown(document.activeElement || document.body, {
        key: "Escape",
      });

      await selectRows(container, 1);
      await openBulkMenu();

      expect(findMenuItem("Delete")).toBeDefined();
    });

    /*
     * A list that keeps Delete off its rows on purpose - another resource's
     * members, a list across projects, history - used to delete from Bulk
     * Actions anyway, for anyone the model let delete.
     */
    test("is not offered on a list whose rows are not deleted from it, even to someone who may delete", async () => {
      const { container } = renderTable({ isDeleteable: false });

      await selectRows(container, 1);
      await openBulkMenu();

      expect(menuItemLabels()).toEqual(
        expect.arrayContaining(["Archive", "Export CSV"]),
      );
      expect(findMenuItem("Delete")).toBeUndefined();
    });

    test("is not placed there either when the list names the default Delete", async () => {
      const { container } = renderTable({
        isDeleteable: false,
        bulkActionButtons: [
          ARCHIVE_ACTION,
          ModalTableBulkDefaultActions.Delete,
        ],
      });

      await selectRows(container, 1);
      await openBulkMenu();

      expect(findMenuItem("Delete")).toBeUndefined();
      // And never the raw enum as an unnamed item.
      expect(menuItemLabels()).not.toContain("");
    });

    /*
     * The other half of the old rule: a table with no bulk actions of its own
     * grew a selection column whose actions were Delete and Export CSV, for
     * whoever may delete the model - on lists that never offered Delete at
     * all. Delete is gone from such a list; the selection stays for the same
     * people, with Export CSV alone (the monitor logs' and LLM calls'
     * exports are worded for it).
     */
    test("keeps the selection on such a list, with Export CSV alone, for someone who may delete", async () => {
      const { container } = renderTable({
        isDeleteable: false,
        bulkActionButtons: [],
      });

      await selectRows(container, 1);
      await openBulkMenu();

      expect(menuItemLabels()).toEqual(["Export CSV"]);
      expect(findMenuItem("Delete")).toBeUndefined();
    });

    test("grows no selection column on such a list for someone who may not delete", async () => {
      permissionsForTest = [Permission.Viewer];

      const { container } = renderTable({
        isDeleteable: false,
        bulkActionButtons: [],
      });

      await waitFor(() => {
        expect(screen.getByText("core-router-1")).toBeInTheDocument();
      });

      expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(
        0,
      );
    });

    /*
     * Unchanged for a deletable list with no bulk actions of its own: whoever
     * may delete gets the selection column, and Delete in it.
     */
    test("is the one bulk action of a deletable list with none of its own, for someone who may delete", async () => {
      const { container } = renderTable({ bulkActionButtons: [] });

      await selectRows(container, 1);
      await openBulkMenu();

      expect(menuItemLabels()).toEqual(
        expect.arrayContaining(["Delete", "Export CSV"]),
      );
    });

    /* One Delete, whoever supplied it - not the page's plus an injected one. */
    test("is not duplicated when the page supplies its own Delete", async () => {
      const { container } = renderTable({
        bulkActionButtons: [
          ARCHIVE_ACTION,
          {
            title: "Delete",
            icon: IconProp.Trash,
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

      expect(confirmationText()).toContain("delete 2 network devices");
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

      expect(confirmationText()).toContain("delete 1 network device?");
    });

    /*
     * What leaves with a device - its interfaces, links and auto-created
     * monitor - is the model's own sentence (DeleteConsequences), said by
     * every Delete of one. A list adds its own after it: that Archive is the
     * reversible option, say.
     */
    test("says what goes with the rows, then the table's own warning, after their names", async () => {
      await startBulkDelete({
        deleteConfirmationWarning: DEVICE_DELETE_WARNING,
      });

      await waitFor(() => {
        expect(consequenceText()).not.toBe("");
      });

      expect(consequenceText()).toBe(
        `${NETWORK_DEVICE_CONSEQUENCE} ${DEVICE_DELETE_WARNING}`,
      );

      // After the names, in the dialog's details - not inside the question.
      const items: Element = document.querySelector(
        '[data-testid="delete-confirmation-items"]',
      )!;
      const consequence: Element = document.querySelector(
        '[data-testid="bulk-delete-consequence"]',
      )!;

      expect(
        items.compareDocumentPosition(consequence) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    test("asks the question on its own, and says only the model's sentence without a table warning", async () => {
      await startBulkDelete();

      await waitFor(() => {
        expect(confirmationText()).not.toBe("");
      });

      expect(confirmationText().trim()).toBe(
        "Are you sure you want to delete 2 network devices? This action cannot be undone.",
      );
      expect(consequenceText()).toBe(NETWORK_DEVICE_CONSEQUENCE);
    });

    test("names the rows as a sentence does, where the dialog's title keeps a title's capitals", async () => {
      await startBulkDelete();

      await waitFor(() => {
        expect(confirmationText()).not.toBe("");
      });

      // "2 Network Devices" in the middle of a question read as a heading.
      expect(confirmationText()).toContain("delete 2 network devices?");
      expect(confirmationText()).not.toContain("Network Devices");
      expect(screen.getByText("Delete 2 Network Devices")).toBeInTheDocument();
    });

    test("uses the table's own warning for many rows instead of the one for its rows", async () => {
      await startBulkDelete({
        deleteConfirmationWarning: DEVICE_DELETE_WARNING,
      });

      await waitFor(() => {
        expect(consequenceText()).not.toBe("");
      });

      expect(consequenceText()).toContain(DEVICE_DELETE_WARNING);
    });

    test("deletes nothing until it is confirmed", async () => {
      await startBulkDelete();

      await waitFor(() => {
        expect(confirmationText()).not.toBe("");
      });

      expect(deletedIds).toEqual([]);
    });
  });

  describe("how many rows it deletes at once (issue #5299)", () => {
    /*
     * A delete's hooks can check a rule over the rows that are left - a
     * project keeps an owner, a list keeps its last state - so a table's
     * bulk Delete runs one row at a time unless the table says its deletes
     * check nothing across rows (deleteConcurrency), as the alert and
     * incident lists do.
     */
    type CountingDelete = {
      deleteItem: (item: NetworkDevice) => Promise<void>;
      mostAtOnce: () => number;
    };

    const countingDelete: () => CountingDelete = (): CountingDelete => {
      let inFlight: number = 0;
      let mostAtOnce: number = 0;

      return {
        deleteItem: async (): Promise<void> => {
          inFlight++;
          mostAtOnce = Math.max(mostAtOnce, inFlight);

          for (let i: number = 0; i < 5; i++) {
            await Promise.resolve();
          }

          inFlight--;
        },
        mostAtOnce: (): number => {
          return mostAtOnce;
        },
      };
    };

    test("one row at a time unless the table says otherwise", async () => {
      const counting: CountingDelete = countingDelete();

      await startBulkDelete({ deleteItem: counting.deleteItem });
      await confirmDelete();

      await waitFor(() => {
        expect(textOf("bulk-action-succeeded-count")).not.toBe("");
      });

      expect(deletedIds.sort()).toEqual(["device-1", "device-2"]);
      expect(counting.mostAtOnce()).toBe(1);
    });

    test("several at once on a table whose deletes check nothing across rows", async () => {
      const counting: CountingDelete = countingDelete();

      await startBulkDelete({
        deleteItem: counting.deleteItem,
        deleteConcurrency: 4,
      });
      await confirmDelete();

      // The summary shows once the run has ended, after the last delete.
      await waitFor(() => {
        expect(textOf("bulk-action-succeeded-count")).not.toBe("");
      });

      expect(deletedIds.sort()).toEqual(["device-1", "device-2"]);
      expect(counting.mostAtOnce()).toBe(2);
      expect(textOf("bulk-action-succeeded-count")).toBe(
        "2 Network Devices deleted",
      );
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

    test("reports how many were deleted", async () => {
      await startBulkDelete();
      await confirmDelete();

      await waitFor(() => {
        expect(textOf("bulk-action-succeeded-count")).not.toBe("");
      });

      // What happened, not only that something did ("succeeded").
      expect(textOf("bulk-action-succeeded-count")).toBe(
        "2 Network Devices deleted",
      );
      expect(textOf("bulk-action-failed-count")).toBe("");
    });

    test("clears the selection once the results are dismissed", async () => {
      await startBulkDelete();
      await confirmDelete();

      await waitFor(() => {
        expect(deletedIds.length).toBe(2);
      });

      expect(
        screen.getByText("2 Network Devices Selected"),
      ).toBeInTheDocument();

      await closeProgressModal();

      await waitFor(() => {
        expect(screen.queryByText(/Network Devices? Selected/)).toBeNull();
      });
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
        expect(textOf("bulk-action-failed-count")).not.toBe("");
      });

      expect(textOf("bulk-action-failed-count")).toBe(
        "1 Network Device not deleted",
      );
      expect(textOf("bulk-action-succeeded-count")).toBe(
        "1 Network Device deleted",
      );
      // Which one, and why.
      expect(textOf("bulk-action-failed-items")).toContain("core-router-1");
      expect(textOf("bulk-action-failed-items")).not.toContain("core-router-2");
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
        expect(textOf("bulk-action-failed-count")).not.toBe("");
      });

      expect(textOf("bulk-action-failed-count")).toBe(
        "1 Network Device not deleted",
      );
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
        expect(textOf("bulk-action-failed-count")).not.toBe("");
      });

      expect(textOf("bulk-action-failed-count")).toBe(
        "2 Network Devices not deleted",
      );
      expect(textOf("bulk-action-succeeded-count")).toBe("");
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
      // Locked, but still reachable from the keyboard: aria-disabled.
      expect(deleteItem).toHaveAttribute("aria-disabled", "true");

      fireEvent.mouseEnter(deleteItem!);

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

  /*
   * A table of links (an incident's linked alerts, say) deletes rows that are
   * relationships, not things. "Delete 3 Alerts ... This action cannot be
   * undone" read as if the alerts themselves were going, and contradicted the
   * warning appended after it. Such a table names its own verb; every other
   * table keeps the default wording (pinned above).
   */
  describe("a table that names its own verb", () => {
    const LINK_WARNING: string =
      "Only the links are removed: the devices themselves are not deleted.";

    test("offers the verb in place of Delete, once", async () => {
      const { container } = renderTable({
        bulkActionButtons: [
          ARCHIVE_ACTION,
          ModalTableBulkDefaultActions.Delete,
        ],
        deleteVerb: "Unlink",
        deleteIcon: IconProp.LinkSlash,
      });

      await selectRows(container, 1);
      await openBulkMenu();

      expect(menuItemLabels()).toEqual(
        expect.arrayContaining(["Archive", "Export CSV", "Unlink"]),
      );
      expect(menuItemLabels()).not.toContain("Delete");
      expect(
        menuItemLabels().filter((label: string) => {
          return label === "Unlink";
        }).length,
      ).toBe(1);
      expect(findMenuItem("Unlink")).not.toBeDisabled();
    });

    /*
     * The verb must still be recognised as the table's delete action when it
     * is added automatically, or a second, default Delete would sit next to
     * it.
     */
    test("uses the verb for the automatically added action too", async () => {
      const { container } = renderTable({
        deleteVerb: "Unlink",
      });

      await selectRows(container, 1);
      await openBulkMenu();

      expect(findMenuItem("Unlink")).toBeDefined();
      expect(findMenuItem("Delete")).toBeUndefined();
    });

    test("does not add the default action beside a page's own button with that verb", async () => {
      const { container } = renderTable({
        bulkActionButtons: [
          ARCHIVE_ACTION,
          {
            title: "Unlink",
            icon: IconProp.LinkSlash,
            buttonStyleType: ButtonStyleType.DANGER,
            onClick: async (): Promise<void> => {
              return Promise.resolve();
            },
          },
        ],
        deleteVerb: "Unlink",
      });

      await selectRows(container, 1);
      await openBulkMenu();

      expect(
        menuItemLabels().filter((label: string) => {
          return label === "Unlink" || label === "Delete";
        }),
      ).toEqual(["Unlink"]);
    });

    test("asks with the verb, and does not claim it cannot be undone", async () => {
      const { container } = renderTable({
        bulkActionButtons: [
          ARCHIVE_ACTION,
          ModalTableBulkDefaultActions.Delete,
        ],
        deleteVerb: "Unlink",
        deleteConfirmationWarning: LINK_WARNING,
      });

      await selectRows(container, 2);
      await openBulkMenu();

      fireEvent.click(findMenuItem("Unlink")!);

      await waitFor(() => {
        expect(confirmationText()).not.toBe("");
      });

      expect(confirmationText().trim()).toBe(
        "Are you sure you want to unlink 2 network devices?",
      );
      expect(confirmationText()).not.toContain("cannot be undone");
      /*
       * Only the table's own sentence: removing links is not deleting the
       * devices, so what goes with a deleted device is not said.
       */
      expect(consequenceText()).toBe(LINK_WARNING);
      expect(screen.getByText("Unlink 2 Network Devices")).toBeInTheDocument();
      expect(screen.queryByText("Delete 2 Network Devices")).toBeNull();
    });

    test("reports its results in the general words, not as deletes", async () => {
      const { container } = renderTable({
        deleteVerb: "Unlink",
      });

      await selectRows(container, 2);
      await openBulkMenu();
      fireEvent.click(findMenuItem("Unlink")!);
      await confirmDelete("Unlink");

      await waitFor(() => {
        expect(textOf("bulk-action-succeeded-count")).not.toBe("");
      });

      expect(textOf("bulk-action-succeeded-count")).toBe(
        "2 Network Devices succeeded",
      );
    });

    test("uses the singular for one row", async () => {
      const { container } = renderTable({
        deleteVerb: "Unlink",
      });

      await selectRows(container, 1);
      await openBulkMenu();

      fireEvent.click(findMenuItem("Unlink")!);

      await waitFor(() => {
        expect(confirmationText()).not.toBe("");
      });

      expect(confirmationText().trim()).toBe(
        "Are you sure you want to unlink 1 network device?",
      );
      expect(screen.getByText("Unlink 1 Network Device")).toBeInTheDocument();
    });

    test("still deletes exactly the selected rows once confirmed", async () => {
      const { container } = renderTable({
        deleteVerb: "Unlink",
      });

      await selectRows(container, 2);
      await openBulkMenu();

      fireEvent.click(findMenuItem("Unlink")!);

      expect(deletedIds).toEqual([]);

      await confirmDelete("Unlink");

      await waitFor(() => {
        expect(deletedIds.length).toBe(2);
      });

      expect(deletedIds.sort()).toEqual(["device-1", "device-2"]);
    });

    test("is still gated on the model's delete permission", async () => {
      permissionsForTest = [Permission.Viewer];

      const { container } = renderTable({
        deleteVerb: "Unlink",
      });

      await selectRows(container, 1);
      await openBulkMenu();

      const unlinkItem: HTMLElement | undefined = findMenuItem("Unlink");

      expect(unlinkItem).toBeDefined();
      // Locked, but still reachable from the keyboard: aria-disabled.
      expect(unlinkItem).toHaveAttribute("aria-disabled", "true");

      fireEvent.mouseEnter(unlinkItem!);

      /*
       * The reason follows the verb, but the permission it names is still the
       * delete one the action is gated on.
       */
      const tooltip: HTMLElement = screen.getByRole("tooltip");

      expect(tooltip).toHaveTextContent(
        "You do not have permission to unlink this Network Device.",
      );
      expect(tooltip).toHaveTextContent("Delete Network Device");
      expect(tooltip).not.toHaveTextContent("delete this Network Device");
    });

    test("a blank verb keeps the default wording", async () => {
      const { container } = renderTable({
        deleteVerb: "   ",
      });

      await selectRows(container, 2);
      await openBulkMenu();

      fireEvent.click(findMenuItem("Delete")!);

      await waitFor(() => {
        expect(confirmationText()).not.toBe("");
      });

      expect(confirmationText().trim()).toBe(
        "Are you sure you want to delete 2 network devices? This action cannot be undone.",
      );
    });
  });

  /*
   * A list can say more in the bulk Delete's dialog than one sentence: what
   * deleting the selected rows would change, read when the dialog opens (a
   * value's uses - UseArchivableValues), holding Delete while it reads; and
   * leave rows out of the run it already knows the server would refuse,
   * with why. And it hears when the run ends, to read its own counts again.
   */
  describe("a list's own words, refusals and end", () => {
    // Details that hold Delete until released.
    let releaseDelete: (isHeld: boolean) => void = (): void => {};

    const Details: React.FunctionComponent<{
      items: Array<NetworkDevice>;
      controls: BulkActionConfirmControls;
    }> = (props: {
      items: Array<NetworkDevice>;
      controls: BulkActionConfirmControls;
    }): React.ReactElement => {
      React.useEffect(() => {
        props.controls.setIsSubmitHeld(true);
        releaseDelete = props.controls.setIsSubmitHeld;
      }, []);

      return (
        <p data-testid="list-delete-details">
          {`Deleting ${props.items.length} also removes their links.`}
        </p>
      );
    };

    const withDetails: (
      items: Array<NetworkDevice>,
      controls: BulkActionConfirmControls,
    ) => React.ReactElement = (
      items: Array<NetworkDevice>,
      controls: BulkActionConfirmControls,
    ): React.ReactElement => {
      return <Details items={items} controls={controls} />;
    };

    const deleteButton: () => HTMLButtonElement | undefined = ():
      | HTMLButtonElement
      | undefined => {
      return Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[data-testid="modal-footer"] button',
        ),
      ).find((button: HTMLButtonElement) => {
        return (button.textContent || "").trim() === "Delete";
      });
    };

    test("its details are drawn after the names, and hold Delete until they let it go", async () => {
      await startBulkDelete({ deleteConfirmationDetails: withDetails });

      await waitFor(() => {
        expect(screen.getByTestId("list-delete-details")).toBeInTheDocument();
      });

      expect(screen.getByTestId("list-delete-details")).toHaveTextContent(
        "Deleting 2 also removes their links.",
      );

      // After the names of the rows: under the question, never inside it.
      expect(confirmationText()).not.toContain("removes their links");
      expect(
        screen
          .getByTestId("delete-confirmation-items")
          .compareDocumentPosition(screen.getByTestId("list-delete-details")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      await waitFor(() => {
        expect(deleteButton()).toBeDisabled();
      });

      // Nothing is deleted while it is held.
      fireEvent.click(deleteButton()!);
      expect(deletedIds).toEqual([]);

      act(() => {
        releaseDelete(false);
      });

      await waitFor(() => {
        expect(deleteButton()).toBeEnabled();
      });

      await confirmDelete();

      await waitFor(() => {
        expect(deletedIds.sort()).toEqual(["device-1", "device-2"]);
      });
    });

    /*
     * Its dialog said the run skips it, so the result lists it as skipped -
     * its own gray list, with why - never as a delete that failed.
     */
    test("a row the list knows the server would refuse is not sent, and is listed as skipped, with why", async () => {
      await startBulkDelete({
        getDeleteRefusal: (item: NetworkDevice): string | undefined => {
          return (item as unknown as Row)._id === "device-1"
            ? "Records still have it, so it can't be deleted. Archive it instead."
            : undefined;
        },
      });
      await confirmDelete();

      await waitFor(() => {
        expect(textOf("bulk-action-unchanged-count")).not.toBe("");
      });

      // Never sent: only the other row reached the delete.
      expect(deletedIds).toEqual(["device-2"]);
      expect(textOf("bulk-action-unchanged-count")).toBe(
        "1 Network Device skipped",
      );
      expect(textOf("bulk-action-succeeded-count")).toBe(
        "1 Network Device deleted",
      );
      expect(textOf("bulk-action-unchanged-items")).toContain("core-router-1");
      expect(
        screen.getByText(
          "Records still have it, so it can't be deleted. Archive it instead.",
        ),
      ).toBeInTheDocument();

      // Nothing failed.
      expect(screen.queryByTestId("bulk-action-failed-count")).toBeNull();
      expect(screen.queryByTestId("bulk-action-failed-items")).toBeNull();
    });

    test("several skipped are counted in the plural, and a row the table can never delete still fails", async () => {
      await startBulkDelete({
        getDeleteRefusal: (): string | undefined => {
          return "Records still have it, so it can't be deleted. Archive it instead.";
        },
      });
      await confirmDelete();

      await waitFor(() => {
        expect(textOf("bulk-action-unchanged-count")).toBe(
          "2 Network Devices skipped",
        );
      });

      expect(deletedIds).toEqual([]);
      expect(screen.queryByTestId("bulk-action-succeeded-count")).toBeNull();
    });

    test("the skipped words are in English and translated in every Dashboard locale", () => {
      const directory: string = path.resolve(
        __dirname,
        "../../../../../App/FeatureSet/Dashboard/src/Locales",
      );
      const read: (language: string) => Record<string, unknown> = (
        language: string,
      ): Record<string, unknown> => {
        return JSON.parse(
          fs.readFileSync(path.join(directory, `${language}.json`), "utf8"),
        ) as Record<string, unknown>;
      };

      const english: Record<string, unknown> = read("en");

      expect(english[BULK_SKIPPED_COUNT.other]).toBe(BULK_SKIPPED_COUNT.other);
      expect(english[`${BULK_SKIPPED_COUNT.other}_one`]).toBe(
        BULK_SKIPPED_COUNT.one,
      );

      const placeholders: (text: string) => Array<string> = (
        text: string,
      ): Array<string> => {
        return (text.match(SKIPPED_PLACEHOLDER) || []).sort();
      };

      for (const language of [
        "de",
        "fr",
        "es",
        "it",
        "pt",
        "nl",
        "da",
        "no",
        "sv",
        "ru",
        "ja",
        "ko",
        "zh-CN",
        "zh-TW",
        "hi",
        "fa",
      ]) {
        const locale: Record<string, unknown> = read(language);

        for (const [key, englishText] of [
          [BULK_SKIPPED_COUNT.other, BULK_SKIPPED_COUNT.other],
          [`${BULK_SKIPPED_COUNT.other}_one`, BULK_SKIPPED_COUNT.one],
        ] as Array<[string, string]>) {
          const translated: unknown = locale[key];

          expect({
            language,
            key,
            isText: typeof translated === "string",
          }).toEqual({ language, key, isText: true });
          expect({ language, key, same: translated === englishText }).toEqual({
            language,
            key,
            same: false,
          });
          expect(placeholders(translated as string)).toEqual(
            placeholders(englishText),
          );
        }
      }
    });

    test("the list hears once that the run is over, after the deletes", async () => {
      const ended: Array<Array<string>> = [];

      await startBulkDelete({
        onDeleteEnd: (): void => {
          ended.push([...deletedIds].sort());
        },
      });

      expect(ended).toEqual([]);

      await confirmDelete();

      await waitFor(() => {
        expect(ended).toEqual([["device-1", "device-2"]]);
      });
    });

    test("a row's own Delete never asks the bulk refusal: its dialog says why itself", async () => {
      const asked: Array<string> = [];

      const { container } = renderTable({
        getDeleteRefusal: (item: NetworkDevice): string | undefined => {
          asked.push(String((item as unknown as Row)._id));
          return "Refused";
        },
      });

      await waitFor(() => {
        expect(
          container.querySelectorAll('[data-testid="row-actions-more-button"]')
            .length,
        ).toBe(ROWS.length);
      });

      fireEvent.click(
        container.querySelector<HTMLElement>(
          '[data-testid="row-actions-more-button"]',
        )!,
      );

      // The row's ⋯ menu still offers Delete, unlocked: its dialog says why.
      await waitFor(() => {
        expect(findMenuItem("Delete")).toBeDefined();
      });
      expect(findMenuItem("Delete")).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(asked).toEqual([]);
    });
  });
});
