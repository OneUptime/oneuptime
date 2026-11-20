import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";

/*
 * A SAVED VIEW'S RENAME AND DELETE, WITH THE KEYBOARD ALONE (#6922).
 *
 * Every list with saved views offers them under Saved Views. A view's
 * Rename and Delete were a pencil and a trash can drawn inside the view's
 * own menu item, as icons with a click: no keyboard could reach them, no
 * screen reader could name them, and they were controls inside a control.
 * They are menu items of their own now, beside the view (MoreMenuItem's
 * actions), which the menu's arrow keys reach after the view and a screen
 * reader names with it: "Rename view Errors". The control that opens the
 * menu is a real button, and Clear saved view, which sat inside it, sits
 * beside it. And the dialogs they open are drawn beside the control, so
 * the focus comes back to Saved Views when they close.
 *
 * These drive the real control with userEvent's keyboard alone; the API is
 * a stand-in that holds the views as a server would.
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

// The button that opens the saved views' menu, by the name it is read by.
function savedViewsButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Saved view: |^Saved Views$/ });
}

// Tab from where the focus is until it reaches `target`, as a keyboard does.
async function tabTo(
  user: ReturnType<typeof userEvent.setup>,
  target: () => HTMLElement,
  shift: boolean = false,
): Promise<void> {
  for (let step: number = 0; step < 25; step++) {
    if (document.activeElement === target()) {
      return;
    }

    await user.tab({ shift: shift });
  }

  throw new Error("Tab never reached the control it was looking for.");
}

// The menu's rows, as a screen reader reads them: each menu item's name.
function menuItemNames(): Array<string> {
  return screen.getAllByRole("menuitem").map((item: HTMLElement): string => {
    return (item.getAttribute("aria-label") || item.textContent || "").trim();
  });
}

async function openMenuFromTheKeyboard(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await tabTo(user, savedViewsButton);
  await user.keyboard("{Enter}");

  await waitFor(() => {
    expect(screen.getByRole("menu")).toBeInTheDocument();
  }, WAIT);
}

// Down until the focus is on the menu item called `name`.
async function arrowTo(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> {
  for (let step: number = 0; step < 12; step++) {
    const focused: Element | null = document.activeElement;

    if (
      focused &&
      (
        focused.getAttribute("aria-label") ||
        focused.textContent ||
        ""
      ).trim() === name
    ) {
      return;
    }

    await user.keyboard("{ArrowDown}");
  }

  throw new Error(`The arrow keys never reached ${name}.`);
}

describe("A saved view's rename and delete, with the keyboard alone (#6922)", () => {
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

  test("the control is a real button, named for a screen reader, with Clear beside it, not in it", async () => {
    render(control({ viewInUse: aView(ERRORS_VIEW_ID, "Errors") }));

    await waitFor(() => {
      expect(savedViewsButton()).toHaveTextContent("Errors");
    }, WAIT);

    const trigger: HTMLElement = savedViewsButton();
    const clear: HTMLElement = screen.getByRole("button", {
      name: "Clear saved view",
    });

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAccessibleName("Saved view: Errors");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Side by side: no button inside another.
    expect(trigger).not.toContainElement(clear);
    expect(clear).not.toContainElement(trigger);
    expect(document.querySelectorAll("button button")).toHaveLength(0);
    expect(document.querySelectorAll('[role="button"] button')).toHaveLength(0);
  });

  test("with no view in use it is one button, Saved Views", async () => {
    render(control({ viewInUse: null }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Saved Views" }),
      ).toBeInTheDocument();
    }, WAIT);

    expect(screen.getByRole("button", { name: "Saved Views" }).tagName).toBe(
      "BUTTON",
    );
    expect(
      screen.queryByRole("button", { name: "Clear saved view" }),
    ).toBeNull();
  });

  test("each view's row is the view, Rename view and Delete view, each a menu item named with the view", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(control({ viewInUse: aView(ERRORS_VIEW_ID, "Errors") }));
    await waitFor(() => {
      expect(savedViewsButton()).toHaveTextContent("Errors");
    }, WAIT);
    await openMenuFromTheKeyboard(user);

    expect(menuItemNames()).toEqual([
      "Errors",
      "Rename view Errors",
      "Delete view Errors",
      "Offline monitors",
      "Rename view Offline monitors",
      "Delete view Offline monitors",
      "Save as New View",
    ]);

    // Real buttons, beside the view's own: none inside another, no icon alone.
    const rename: HTMLElement = screen.getByRole("menuitem", {
      name: "Rename view Errors",
    });
    const view: HTMLElement = screen.getByRole("menuitem", { name: "Errors" });

    expect(rename.tagName).toBe("BUTTON");
    expect(rename).toHaveAttribute("data-testid", "table-view-rename");
    expect(view).not.toContainElement(rename);
    expect(
      screen.getByRole("menuitem", { name: "Delete view Errors" }).tagName,
    ).toBe("BUTTON");
    expect(
      screen.getByRole("menu").querySelectorAll("button button"),
    ).toHaveLength(0);
    expect(
      screen.getByRole("menu").querySelectorAll("svg[data-testid]"),
    ).toHaveLength(0);
  });

  test("rename the view in use: Tab, Enter, the arrows, Enter, a new name, Enter - and the chip says it", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(control({ viewInUse: aView(ERRORS_VIEW_ID, "Errors") }));
    await waitFor(() => {
      expect(savedViewsButton()).toHaveTextContent("Errors");
    }, WAIT);

    await openMenuFromTheKeyboard(user);
    // The menu opens on its first row, the view itself.
    expect(screen.getByRole("menuitem", { name: "Errors" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("menuitem", { name: "Rename view Errors" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);
    const name: HTMLElement = await within(dialog).findByPlaceholderText(
      "Name of the view",
      {},
      WAIT,
    );

    await waitFor(() => {
      expect(name).toHaveValue("Errors");
    }, WAIT);
    await waitFor(() => {
      expect(name).toHaveFocus();
    }, WAIT);

    // Keys alone: to the end of the name, rub it out, type the new one.
    await user.keyboard("{End}{Backspace>6/}");
    expect(name).toHaveValue("");
    await user.keyboard("Errors this week");
    await tabTo(user, () => {
      return within(dialog).getByTestId("modal-footer-submit-button");
    });
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    }, WAIT);
    await waitFor(() => {
      expect(savedViewsButton()).toHaveAccessibleName(
        "Saved view: Errors this week",
      );
    }, WAIT);

    // The view was not applied again, only renamed, and the focus is home.
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(savedViewsButton()).toHaveFocus();
    }, WAIT);
  });

  test("delete the view in use: the dialog starts on Cancel, and Delete leaves the view", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
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
      expect(savedViewsButton()).toHaveTextContent("Errors");
    }, WAIT);

    await openMenuFromTheKeyboard(user);
    await arrowTo(user, "Delete view Errors");
    await user.keyboard("{Enter}");

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    // A delete starts on the least destructive choice (#7360).
    expect(
      within(dialog).getByTestId("modal-footer-close-button"),
    ).toHaveFocus();
    expect(dialog).toHaveTextContent("Are you sure you want to delete Errors?");

    await tabTo(user, () => {
      return within(dialog).getByTestId("modal-footer-submit-button");
    });
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    }, WAIT);
    expect(deleteItemMock).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith(null);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Saved Views" }),
      ).toBeInTheDocument();
    }, WAIT);
  });

  test("delete another view from the keyboard: the view in use stays", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
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
      expect(savedViewsButton()).toHaveTextContent("Errors");
    }, WAIT);

    await openMenuFromTheKeyboard(user);
    await arrowTo(user, "Delete view Offline monitors");
    await user.keyboard("{Enter}");

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    expect(dialog).toHaveTextContent(
      "Are you sure you want to delete Offline monitors?",
    );
    await tabTo(user, () => {
      return within(dialog).getByTestId("modal-footer-submit-button");
    });
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    }, WAIT);
    expect(deleteItemMock).toHaveBeenCalledTimes(1);
    expect(onViewChange).not.toHaveBeenCalled();
    expect(savedViewsButton()).toHaveAccessibleName("Saved view: Errors");
    await waitFor(() => {
      expect(savedViewsButton()).toHaveFocus();
    }, WAIT);
  });

  test("Escape in the rename dialog gives the focus back to Saved Views, renaming nothing", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(control({ viewInUse: aView(ERRORS_VIEW_ID, "Errors") }));
    await waitFor(() => {
      expect(savedViewsButton()).toHaveTextContent("Errors");
    }, WAIT);

    await openMenuFromTheKeyboard(user);
    await arrowTo(user, "Rename view Offline monitors");
    await user.keyboard("{Enter}");

    await screen.findByRole("dialog", {}, WAIT);
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    }, WAIT);
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(savedViewsButton()).toHaveFocus();
    }, WAIT);
  });

  test("Enter on a view's own row still applies it", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
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
      expect(savedViewsButton()).toHaveTextContent("Errors");
    }, WAIT);

    await openMenuFromTheKeyboard(user);
    await arrowTo(user, "Offline monitors");
    await user.keyboard("{Enter}");

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect((onViewChange.mock.calls[0]![0] as TableView).id?.toString()).toBe(
      OFFLINE_VIEW_ID,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Clear saved view is reached with Tab after the chip, and Enter clears", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
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
      expect(savedViewsButton()).toHaveTextContent("Errors");
    }, WAIT);

    await tabTo(user, savedViewsButton);
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Clear saved view" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(onViewChange).toHaveBeenCalledWith(null);
  });
});
