import "@testing-library/jest-dom";
import {
  act,
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

/*
 * Rendering a real table several times over comfortably outruns the 1s
 * default when the whole suite is competing for the same box.
 */
configure({ asyncUtilTimeout: 15000 });

/*
 * THE COUNT BESIDE A LIST FOLLOWS EVERY CHANGE MADE FROM THE LIST (#6856).
 *
 * "When I bulk delete / resolve alerts, the count in the side menu is not
 * updated": Home > Active Alerts said "No active alerts", and the side menu
 * beside it still said "Active Alerts 4" - until the page was reloaded. The
 * count read its number when it was drawn, and nothing the list did asked it
 * to read again.
 *
 * Every change made from a list asks now, in one place each, so no page can
 * forget: the end of every bulk run, a row's Delete, a row action that
 * changed its row, a create or edit through the list's form, and the list's
 * Refresh. Drawn here as the page draws them: a side-menu count of the
 * records, beside the real list of them, both reading one store - so the
 * test sees the count the reader would.
 */

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
  ModalTableBulkDefaultActions,
  ModalType,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import CountModelSideMenuItem from "../../../../UI/Components/SideMenu/CountModelSideMenuItem";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "../../../../UI/Components/SideMenu/SideMenuCountRefresh";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  runBulkAction,
} from "../../../../UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "../../../../UI/Components/BulkUpdate/BulkUpdateForm";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionContext,
} from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Permission from "../../../../Types/Permission";
import IconProp from "../../../../Types/Icon/IconProp";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import Query from "../../../../Types/BaseDatabase/Query";
import Route from "../../../../Types/API/Route";
import { JSONObject } from "../../../../Types/JSON";

type Row = {
  _id: string;
  name: string;
  isActive: boolean;
};

// The store both the list and the count read: what the server holds.
let store: Array<Row> = [];

const seed: (count: number) => void = (count: number): void => {
  store = Array.from({ length: count }, (_value: unknown, index: number) => {
    return {
      _id: `device-${index + 1}`,
      name: `core-router-${index + 1}`,
      isActive: true,
    };
  });
};

const activeCount: () => number = (): number => {
  return store.filter((row: Row): boolean => {
    return row.isActive;
  }).length;
};

// Every count the side menu asked for.
let countRequests: number = 0;

// A page-specific bulk action, run as the page's own are (runBulkAction).
const RESOLVE_IN_BULK: BulkActionButtonSchema<NetworkDevice> = {
  title: "Resolve",
  icon: IconProp.CheckCircle,
  buttonStyleType: ButtonStyleType.NORMAL,
  onClick: async (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
  ): Promise<void> => {
    await runBulkAction<NetworkDevice>({
      actionProps: actionProps,
      step: async (item: NetworkDevice): Promise<BulkItemOutcome> => {
        const row: Row | undefined = store.find((candidate: Row) => {
          return candidate._id === (item as unknown as Row)._id;
        });

        if (row) {
          row.isActive = false;
        }

        return BULK_ITEM_CHANGED;
      },
    });
  },
};

type PageOptions = {
  deleteItem?: ((row: Row) => Promise<void>) | undefined;
  actionButtons?: Array<ActionButtonSchema<NetworkDevice>> | undefined;
  bulkButtons?:
    | Array<
        BulkActionButtonSchema<NetworkDevice> | ModalTableBulkDefaultActions
      >
    | undefined;
  isViewable?: boolean | undefined;
};

const makeTableProps: (
  options: PageOptions,
) => BaseModelTableProps<NetworkDevice> = (
  options: PageOptions,
): BaseModelTableProps<NetworkDevice> => {
  const callbacks: BaseTableCallbacks<NetworkDevice> = {
    deleteItem: async (item: NetworkDevice): Promise<void> => {
      const row: Row = item as unknown as Row;

      if (options.deleteItem) {
        await options.deleteItem(row);
      }

      store = store.filter((candidate: Row): boolean => {
        return candidate._id !== row._id;
      });
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
      const active: Array<Row> = store.filter((row: Row): boolean => {
        return row.isActive;
      });

      return {
        // A model's id is its _id: a row's Delete asks for it.
        data: active.map((row: Row) => {
          return { ...row, id: row._id };
        }) as unknown as Array<NetworkDevice>,
        count: active.length,
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
    showCreateEditModal: (modalProps: {
      onSuccess: (item: NetworkDevice) => Promise<void>;
      onClose: () => void;
      modalType: ModalType;
    }): React.ReactElement => {
      // The list's form, as far as the list can tell: saved, then onSuccess.
      return (
        <div data-testid="create-edit-modal">
          <button
            type="button"
            onClick={() => {
              const row: Row = {
                _id: `device-${store.length + 1}`,
                name: `core-router-${store.length + 1}`,
                isActive: true,
              };
              store = [...store, row];
              void modalProps.onSuccess(row as unknown as NetworkDevice);
            }}
          >
            Save Device
          </button>
        </div>
      );
    },
  } as unknown as BaseTableCallbacks<NetworkDevice>;

  return {
    modelType: NetworkDevice,
    id: "active-devices-table",
    name: "Active Devices",
    singularName: "Device",
    pluralName: "Devices",
    userPreferencesKey: "active-devices-side-menu-count-table",
    urlStateKey: "active-devices-side-menu-count-table",
    columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
    filters: [],
    cardProps: {
      title: "Active Devices",
      description: "Devices that need looking at",
    },
    isCreateable: true,
    isEditable: false,
    isDeleteable: true,
    isViewable: options.isViewable ?? false,
    showRefreshButton: true,
    actionButtons: options.actionButtons,
    callbacks: callbacks,
    bulkActions: {
      buttons: options.bulkButtons ?? [
        RESOLVE_IN_BULK,
        ModalTableBulkDefaultActions.Delete,
      ],
      deleteConcurrency: 4,
    },
  } as unknown as BaseModelTableProps<NetworkDevice>;
};

// The page: the side menu's count, and the list it opens.
const Page: (props: { options: PageOptions }) => React.ReactElement = (props: {
  options: PageOptions;
}): React.ReactElement => {
  return (
    <div>
      <nav data-testid="side-menu">
        <CountModelSideMenuItem<NetworkDevice>
          link={{
            title: "Active Devices",
            to: new Route("/dashboard/network-devices/active"),
          }}
          modelType={NetworkDevice}
          countQuery={{ name: "active" } as Query<NetworkDevice>}
        />
      </nav>
      <BaseModelTable<NetworkDevice> {...makeTableProps(props.options)} />
    </div>
  );
};

const renderPage: (
  options?: PageOptions,
) => Promise<ReturnType<typeof render>> = async (
  options?: PageOptions,
): Promise<ReturnType<typeof render>> => {
  const rendered: ReturnType<typeof render> = render(
    <Page options={options || {}} />,
  );

  await waitFor(() => {
    expect(rowNames()).toHaveLength(activeCount());
  });

  await waitFor(() => {
    expect(sideMenuCount()).toBe(activeCount() ? String(activeCount()) : "");
  });

  return rendered;
};

// The number beside "Active Devices" in the side menu: "" when there is none.
const sideMenuCount: () => string = (): string => {
  const badge: Element | null = screen
    .getByTestId("side-menu")
    .querySelector("span.rounded-full");

  return (badge?.textContent || "").trim();
};

// The names the list shows, in order.
const rowNames: () => Array<string> = (): Array<string> => {
  return Array.from(document.querySelectorAll("tbody tr"))
    .map((row: Element): string => {
      return (row.textContent || "").match(/core-router-\d+/)?.[0] || "";
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    });
};

const selectRows: (count: number) => Promise<void> = async (
  count: number,
): Promise<void> => {
  await waitFor(() => {
    expect(
      document.querySelectorAll('tbody input[type="checkbox"]').length,
    ).toBeGreaterThanOrEqual(count);
  });

  const boxes: Array<HTMLInputElement> = Array.from(
    document.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'),
  );

  for (let index: number = 0; index < count; index++) {
    fireEvent.click(boxes[index]!);
  }
};

const pickBulkAction: (label: string) => Promise<void> = async (
  label: string,
): Promise<void> => {
  await waitFor(() => {
    expect(screen.getByText("Bulk Actions")).toBeInTheDocument();
  });

  fireEvent.click(screen.getByText("Bulk Actions"));

  await waitFor(() => {
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]')).some(
        (item: Element) => {
          return (item.textContent || "").trim() === label;
        },
      ),
    ).toBe(true);
  });

  fireEvent.click(
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item: HTMLElement) => {
        return (item.textContent || "").trim() === label;
      },
    )!,
  );
};

// Presses the dialog footer's button with these words.
const pressInDialog: (label: string) => Promise<void> = async (
  label: string,
): Promise<void> => {
  let button: HTMLButtonElement | undefined = undefined;

  await waitFor(() => {
    button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="modal-footer"] button',
      ),
    ).find((candidate: HTMLButtonElement) => {
      return (
        (candidate.textContent || "").trim() === label && !candidate.disabled
      );
    });

    expect(button).toBeDefined();
  });

  fireEvent.click(button!);
};

// The run's result is on screen: its one button is Close.
const waitForResult: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[data-testid="modal-footer"] button',
        ),
      ).some((button: HTMLButtonElement) => {
        return (button.textContent || "").trim() === "Close" && !button.disabled;
      }),
    ).toBe(true);
  });
};

const isResultOnScreen: () => boolean = (): boolean => {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="modal-footer"] button',
    ),
  ).some((button: HTMLButtonElement) => {
    return (button.textContent || "").trim() === "Close";
  });
};

let sideMenuAsks: number = 0;
const onSideMenuAsk: () => void = (): void => {
  sideMenuAsks++;
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(
    window.history.state,
    "",
    "/dashboard/network-devices/active",
  );
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  seed(4);
  countRequests = 0;
  sideMenuAsks = 0;

  jest.spyOn(ModelAPI, "count").mockImplementation((async () => {
    countRequests++;
    return activeCount();
  }) as never);

  window.addEventListener(REFRESH_SIDEBAR_COUNT_EVENT, onSideMenuAsk);
});

afterEach(() => {
  window.removeEventListener(REFRESH_SIDEBAR_COUNT_EVENT, onSideMenuAsk);
  cleanup();
  jest.restoreAllMocks();
});

describe("bulk Delete", () => {
  test("deleting every row: the count leaves with them, while the result is still on screen (#6856)", async () => {
    await renderPage();
    expect(sideMenuCount()).toBe("4");

    await selectRows(4);
    await pickBulkAction("Delete");
    await pressInDialog("Delete");
    await waitForResult();

    // The reader is still looking at "4 Devices deleted".
    expect(isResultOnScreen()).toBe(true);
    await waitFor(() => {
      expect(sideMenuCount()).toBe("");
    });

    await pressInDialog("Close");

    await waitFor(() => {
      expect(rowNames()).toEqual([]);
    });
    expect(sideMenuCount()).toBe("");
  });

  test("deleting some rows: the count says how many are left", async () => {
    await renderPage();

    await selectRows(3);
    await pickBulkAction("Delete");
    await pressInDialog("Delete");
    await waitForResult();

    await waitFor(() => {
      expect(sideMenuCount()).toBe("1");
    });

    await pressInDialog("Close");

    await waitFor(() => {
      expect(rowNames()).toEqual(["core-router-4"]);
    });
    expect(sideMenuCount()).toBe("1");
  });

  test("one count for the whole run - not one per row - and none more when the result is closed", async () => {
    await renderPage();
    const before: number = countRequests;

    await selectRows(4);
    await pickBulkAction("Delete");
    await pressInDialog("Delete");
    await waitForResult();

    await waitFor(() => {
      expect(sideMenuCount()).toBe("");
    });
    expect(sideMenuAsks).toBe(1);
    expect(countRequests - before).toBe(1);

    await pressInDialog("Close");
    await waitFor(() => {
      expect(rowNames()).toEqual([]);
    });

    expect(sideMenuAsks).toBe(1);
    expect(countRequests - before).toBe(1);
  });

  test("a run where some rows fail: the count follows the ones that were deleted", async () => {
    await renderPage({
      deleteItem: async (row: Row): Promise<void> => {
        if (row._id === "device-2") {
          throw new Error("This device is still in use.");
        }
      },
    });

    await selectRows(2);
    await pickBulkAction("Delete");
    await pressInDialog("Delete");
    await waitForResult();

    await waitFor(() => {
      expect(sideMenuCount()).toBe("3");
    });
  });
});

describe("a bulk action of the page's own", () => {
  test("bulk resolving: the resolved rows leave the count", async () => {
    await renderPage();

    await selectRows(2);
    await pickBulkAction("Resolve");
    await waitForResult();

    await waitFor(() => {
      expect(sideMenuCount()).toBe("2");
    });

    await pressInDialog("Close");

    await waitFor(() => {
      expect(rowNames()).toEqual(["core-router-3", "core-router-4"]);
    });
  });
});

describe("a row's Delete", () => {
  test("the deleted row leaves the count", async () => {
    await renderPage();

    await waitFor(() => {
      expect(
        Array.from(document.querySelectorAll<HTMLButtonElement>("tbody button"))
          .filter((button: HTMLButtonElement) => {
            return (button.textContent || "").trim() === "Delete";
          }).length,
      ).toBe(4);
    });

    const rowDelete: HTMLButtonElement = Array.from(
      document.querySelectorAll<HTMLButtonElement>("tbody button"),
    ).find((button: HTMLButtonElement) => {
      return (button.textContent || "").trim() === "Delete";
    })!;

    fireEvent.click(rowDelete);
    await pressInDialog("Delete");

    await waitFor(() => {
      expect(rowNames()).toEqual([
        "core-router-2",
        "core-router-3",
        "core-router-4",
      ]);
    });
    await waitFor(() => {
      expect(sideMenuCount()).toBe("3");
    });
  });
});

describe("a row action that changed its row", () => {
  test("through the context the list hands it: the count follows", async () => {
    const resolveRow: ActionButtonSchema<NetworkDevice> = {
      title: "Resolve",
      icon: IconProp.CheckCircle,
      buttonStyleType: ButtonStyleType.OUTLINE,
      placement: ActionButtonPlacement.MoreMenu,
      onClick: async (
        item: NetworkDevice,
        onCompleteAction: () => void,
        _onError: (error: Error) => void,
        context?: RowActionContext,
      ): Promise<void> => {
        const row: Row | undefined = store.find((candidate: Row) => {
          return candidate._id === (item as unknown as Row)._id;
        });

        if (row) {
          row.isActive = false;
        }

        context?.refresh();
        onCompleteAction();
      },
    };

    await renderPage({ actionButtons: [resolveRow], isViewable: true });

    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-testid="row-actions-more-button"]')
          .length,
      ).toBe(4);
    });

    fireEvent.click(
      document.querySelector<HTMLElement>(
        '[data-testid="row-actions-more-button"]',
      )!,
    );

    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Resolve",
      }),
    );

    await waitFor(() => {
      expect(sideMenuCount()).toBe("3");
    });
    await waitFor(() => {
      expect(rowNames()).toEqual([
        "core-router-2",
        "core-router-3",
        "core-router-4",
      ]);
    });
  });
});

describe("the list's Refresh", () => {
  test("a change made elsewhere shows in the list and in the count together", async () => {
    await renderPage();

    // Resolved somewhere this page did not hear about.
    store[0]!.isActive = false;
    store[1]!.isActive = false;

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "More options" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Refresh",
      }),
    );

    await waitFor(() => {
      expect(rowNames()).toEqual(["core-router-3", "core-router-4"]);
    });
    await waitFor(() => {
      expect(sideMenuCount()).toBe("2");
    });
  });
});

describe("a create through the list's form", () => {
  test("the new record joins the count", async () => {
    await renderPage();

    await waitFor(() => {
      expect(
        Array.from(document.querySelectorAll<HTMLButtonElement>("button")).some(
          (button: HTMLButtonElement) => {
            return (button.textContent || "").includes("Create Device");
          },
        ),
      ).toBe(true);
    });

    fireEvent.click(
      Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button: HTMLButtonElement) => {
          return (button.textContent || "").includes("Create Device");
        },
      )!,
    );

    await act(async () => {
      fireEvent.click(await screen.findByText("Save Device"));
    });

    await waitFor(() => {
      expect(sideMenuCount()).toBe("5");
    });
    await waitFor(() => {
      expect(rowNames()).toHaveLength(5);
    });
  });
});

describe("reading the list is not a change", () => {
  test("drawing the list, paging through it and closing nothing asks the side menu nothing", async () => {
    await renderPage();

    expect(sideMenuAsks).toBe(0);
    // The count's own first read, and nothing else.
    expect(countRequests).toBe(1);
  });

  test("ticking rows and opening Bulk Actions asks nothing until something is done", async () => {
    await renderPage();

    await selectRows(2);
    await pickBulkAction("Delete");

    // The question is open; nothing deleted yet.
    expect(sideMenuAsks).toBe(0);
    expect(sideMenuCount()).toBe("4");
  });
});
