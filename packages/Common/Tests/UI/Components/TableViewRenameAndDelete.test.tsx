import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";

/*
 * A TABLE'S SAVED VIEW IN USE, RENAMED OR DELETED FROM ITS OWN MENU.
 *
 * The chip over a table names the saved view in use. It named the copy that
 * was picked from the menu, so renaming that view - Edit, a new name, Save
 * Changes - read the list again and left the chip on the old name until the
 * view was picked again: the edit was saved and did not show (issue #6766,
 * "When I click on edit and save, the new changes do not reflect"). And
 * deleting the view in use left the chip naming a view that no longer
 * existed.
 *
 * The chip now names the view as the list last read has it, and deleting the
 * view in use leaves it, as Clear saved view does. These drive the real
 * control, its edit form and its delete dialog; the API is a stand-in that
 * holds the views as a server would.
 */

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

jest.mock("../../../UI/Utils/Translation", () => {
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

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
      },
      deleteItem: (...args: Array<unknown>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

const PROJECT_ID: string = "e6c4b9a0-1a2b-4c3d-8e5f-6a7b8c9d0e1f";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: () => {
            return PROJECT_ID;
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return {
          toString: () => {
            return "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f";
          },
        };
      },
      isMasterAdmin: (): boolean => {
        return false;
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

import TableViewElement from "../../../UI/Components/ModelTable/TableView";
import TableView from "../../../Models/DatabaseModels/TableView";
import Monitor from "../../../Models/DatabaseModels/Monitor";

// Generous: these drive the real form and dialogs, on a CI box that may be busy.
const WAIT: { timeout: number } = { timeout: 20000 };

const ERRORS_VIEW_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165101";
const OFFLINE_VIEW_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165102";

// The views as the server holds them, by id.
let storedViews: Map<string, string> = new Map<string, string>();

function aView(id: string, name: string): TableView {
  const view: TableView = new TableView();
  view.id = new ObjectID(id);
  view.name = name;
  view.query = {};
  view.sort = {};
  view.itemsOnPage = 10;
  return view;
}

function storedViewList(): Array<TableView> {
  return Array.from(storedViews.entries()).map(
    ([id, name]: [string, string]) => {
      return aView(id, name);
    },
  );
}

interface ControlProps {
  viewInUse: TableView | null;
  onViewChange?: ((view: TableView | null) => void) | undefined;
}

function control(props: ControlProps): ReactElement {
  return (
    <TableViewElement<Monitor>
      tableId="all-monitors-table"
      onViewChange={(view: TableView | null) => {
        props.onViewChange?.(view);
      }}
      // A filter applied, so the control always has something to offer.
      currentQuery={{ isDisabled: true } as any}
      currentSortOrder={null}
      currentSortBy={null}
      currentItemsOnPage={10}
      tableView={props.viewInUse}
    />
  );
}

// The chip: the name it shows, and the name its tooltip says.
function chip(): HTMLElement {
  return screen.getByTitle(/^Saved view: /);
}

async function openMenu(): Promise<void> {
  fireEvent.click(chip());

  await waitFor(() => {
    expect(screen.getAllByTestId("table-view-rename").length).toBeGreaterThan(
      0,
    );
  }, WAIT);
}

// The rename icon of the view called name, in the open menu.
function renameIconOf(name: string): HTMLElement {
  return renameOrDeleteIconOf(name, "table-view-rename");
}

function deleteIconOf(name: string): HTMLElement {
  return renameOrDeleteIconOf(name, "table-view-delete");
}

function renameOrDeleteIconOf(name: string, testId: string): HTMLElement {
  const names: Array<string> = storedViewList().map((view: TableView) => {
    return view.name || "";
  });

  return screen.getAllByTestId(testId)[names.indexOf(name)]!;
}

async function renameView(from: string, to: string): Promise<void> {
  await openMenu();
  fireEvent.click(renameIconOf(from));

  const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

  await waitFor(() => {
    expect(within(dialog).getByPlaceholderText("Name of the view")).toHaveValue(
      from,
    );
  }, WAIT);

  fireEvent.change(within(dialog).getByPlaceholderText("Name of the view"), {
    target: { value: to },
  });
  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  }, WAIT);
}

async function deleteView(name: string): Promise<void> {
  await openMenu();
  fireEvent.click(deleteIconOf(name));

  const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);
  fireEvent.click(within(dialog).getByText("Delete"));

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  }, WAIT);
}

describe("A saved view in use, renamed or deleted from its menu (issue #6766)", () => {
  beforeEach(() => {
    storedViews = new Map<string, string>([
      [ERRORS_VIEW_ID, "Errors"],
      [OFFLINE_VIEW_ID, "Offline monitors"],
    ]);

    getListMock.mockReset();
    getListMock.mockImplementation(async () => {
      const data: Array<TableView> = storedViewList();
      return { data: data, count: data.length, skip: 0, limit: 10 };
    });

    getItemMock.mockReset();
    getItemMock.mockImplementation(async (request: unknown) => {
      const id: string = (request as { id: ObjectID }).id.toString();
      return aView(id, storedViews.get(id) || "");
    });

    // A rename writes the name it carries.
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockImplementation(async (request: unknown) => {
      const model: TableView = (request as { model: TableView }).model;
      storedViews.set(model.id!.toString(), model.name || "");
      return { data: {} };
    });

    deleteItemMock.mockReset();
    deleteItemMock.mockImplementation(async (request: unknown) => {
      storedViews.delete((request as { id: ObjectID }).id.toString());
    });
  });

  test("renaming the view in use shows its new name on the chip at once", async () => {
    render(control({ viewInUse: aView(ERRORS_VIEW_ID, "Errors") }));

    await waitFor(() => {
      expect(chip()).toHaveTextContent("Errors");
    }, WAIT);

    await renameView("Errors", "Errors this week");

    await waitFor(() => {
      expect(chip()).toHaveTextContent("Errors this week");
    }, WAIT);
    expect(chip()).toHaveAttribute("title", "Saved view: Errors this week");

    // Saved to the view in use, under the name typed.
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    const saved: TableView = (
      createOrUpdateMock.mock.calls[0]![0] as { model: TableView }
    ).model;
    expect(saved.id?.toString()).toBe(ERRORS_VIEW_ID);
    expect(saved.name).toBe("Errors this week");
  });

  test("renaming another view leaves the chip on the view in use", async () => {
    render(control({ viewInUse: aView(ERRORS_VIEW_ID, "Errors") }));

    await waitFor(() => {
      expect(chip()).toHaveTextContent("Errors");
    }, WAIT);

    await renameView("Offline monitors", "Down monitors");

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    }, WAIT);
    expect(chip()).toHaveAttribute("title", "Saved view: Errors");
  });

  test("deleting the view in use leaves it, as Clear saved view does", async () => {
    const onViewChange: MockFunction = getJestMockFunction();

    render(
      control({
        viewInUse: aView(ERRORS_VIEW_ID, "Errors"),
        onViewChange: (view: TableView | null) => {
          onViewChange(view);
        },
      }),
    );

    await waitFor(() => {
      expect(chip()).toHaveTextContent("Errors");
    }, WAIT);

    await deleteView("Errors");

    expect(deleteItemMock).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith(null);

    await waitFor(() => {
      expect(screen.queryByTitle(/^Saved view: /)).toBeNull();
    }, WAIT);
    expect(screen.getByText("Saved Views")).toBeInTheDocument();
  });

  test("picking a view by its name still applies it", async () => {
    const onViewChange: MockFunction = getJestMockFunction();

    render(
      control({
        viewInUse: aView(ERRORS_VIEW_ID, "Errors"),
        onViewChange: (view: TableView | null) => {
          onViewChange(view);
        },
      }),
    );

    await waitFor(() => {
      expect(chip()).toHaveTextContent("Errors");
    }, WAIT);

    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Offline monitors" }));

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect((onViewChange.mock.calls[0]![0] as TableView).id?.toString()).toBe(
      OFFLINE_VIEW_ID,
    );
    await waitFor(() => {
      expect(chip()).toHaveAttribute("title", "Saved view: Offline monitors");
    }, WAIT);
  });

  test("deleting another view keeps the view in use", async () => {
    const onViewChange: MockFunction = getJestMockFunction();

    render(
      control({
        viewInUse: aView(ERRORS_VIEW_ID, "Errors"),
        onViewChange: (view: TableView | null) => {
          onViewChange(view);
        },
      }),
    );

    await waitFor(() => {
      expect(chip()).toHaveTextContent("Errors");
    }, WAIT);

    await deleteView("Offline monitors");

    await act(async () => {
      await Promise.resolve();
    });

    expect(deleteItemMock).toHaveBeenCalledTimes(1);
    expect(onViewChange).not.toHaveBeenCalled();
    expect(chip()).toHaveAttribute("title", "Saved view: Errors");
  });
});
