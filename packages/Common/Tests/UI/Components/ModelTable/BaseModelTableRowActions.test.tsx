import "@testing-library/jest-dom";
import {
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
 * The Actions column of every ModelTable in the product.
 *
 * It used to render each row action as its own button - "Show ID", "View
 * Monitor", "Edit", "Delete" side by side on every row. It now renders one
 * button and a ⋯ menu with the rest: View when the table is viewable, and
 * Show ID never on the row at all. These tests hold ModelTable to that, and to
 * every action still working from inside the menu.
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
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

type Row = {
  _id: string;
  name: string;
};

const ROWS: Array<Row> = [
  { _id: "monitor-1", name: "Checkout API" },
  { _id: "monitor-2", name: "Billing Worker" },
];

const COLUMNS: Array<unknown> = [
  { field: { name: true }, title: "Name", type: FieldType.Text },
];

type TableOptions = {
  isEditable?: boolean;
  isDeleteable?: boolean;
  isViewable?: boolean;
  showViewIdButton?: boolean;
  deleteButtonText?: string;
  viewButtonText?: string;
  actionButtons?: Array<ActionButtonSchema<Monitor>>;
};

describe("BaseModelTable row actions", () => {
  let showCreateEditModalCalls: number = 0;

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
      getList: async (data: {
        skip: number;
        limit: number;
      }): Promise<ListResult<Monitor>> => {
        return {
          data: ROWS as unknown as Array<Monitor>,
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
        showCreateEditModalCalls++;
        return <div data-testid="create-edit-modal" />;
      },
    } as unknown as BaseTableCallbacks<Monitor>;

    return {
      modelType: Monitor,
      id: "monitors-row-actions-table",
      name: "Monitors",
      singularName: "Monitor",
      pluralName: "Monitors",
      userPreferencesKey: "monitors-row-actions-table",
      urlStateKey: "monitors-row-actions-table",
      columns: COLUMNS,
      filters: [],
      cardProps: { title: "Monitors", description: "All monitors" },
      isCreateable: false,
      isEditable: options.isEditable ?? false,
      isDeleteable: options.isDeleteable ?? false,
      isViewable: options.isViewable ?? false,
      showViewIdButton: options.showViewIdButton ?? false,
      deleteButtonText: options.deleteButtonText,
      viewButtonText: options.viewButtonText,
      actionButtons: options.actionButtons,
      viewPageRoute: undefined,
      callbacks: callbacks,
    } as unknown as BaseModelTableProps<Monitor>;
  };

  const renderTable: (options: TableOptions) => void = (
    options: TableOptions,
  ): void => {
    render(<BaseModelTable<Monitor> {...makeProps(options)} />);
  };

  const waitForRows: () => Promise<Array<HTMLElement>> = async (): Promise<
    Array<HTMLElement>
  > => {
    await waitFor(() => {
      expect(screen.getAllByTestId("row-actions")).toHaveLength(ROWS.length);
    });

    return screen.getAllByTestId("row-actions");
  };

  const rowButtonLabels: (rowActions: HTMLElement) => Array<string> = (
    rowActions: HTMLElement,
  ): Array<string> => {
    return within(rowActions)
      .getAllByRole("button")
      .map((button: HTMLElement) => {
        return (
          button.getAttribute("aria-label") ||
          (button.textContent || "").trim()
        );
      });
  };

  const openMenuIn: (rowActions: HTMLElement) => HTMLElement = (
    rowActions: HTMLElement,
  ): HTMLElement => {
    fireEvent.click(within(rowActions).getByTestId("row-actions-more-button"));
    return screen.getByRole("menu");
  };

  const menuLabels: (menu: HTMLElement) => Array<string> = (
    menu: HTMLElement,
  ): Array<string> => {
    return within(menu)
      .getAllByRole("menuitem")
      .map((item: HTMLElement) => {
        return (item.textContent || "").trim();
      });
  };

  beforeEach(() => {
    permissionsForTest = [Permission.ProjectAdmin];
    showCreateEditModalCalls = 0;
  });

  afterEach(() => {
    cleanup();
  });

  test("a viewable table shows View on the row and folds Show ID, Edit and Delete into the menu", async () => {
    renderTable({
      isViewable: true,
      isEditable: true,
      isDeleteable: true,
      showViewIdButton: true,
    });

    const rows: Array<HTMLElement> = await waitForRows();

    expect(rows).toHaveLength(2);

    for (const rowActions of rows) {
      expect(rowButtonLabels(rowActions)).toEqual([
        "View Monitor",
        "More actions",
      ]);
    }

    expect(menuLabels(openMenuIn(rows[0]!))).toEqual([
      "Show ID",
      "Edit",
      "Delete",
    ]);
  });

  /*
   * The table from the original request: a members list whose rows should
   * show "View User" and nothing else, with "Remove from Project" behind ⋯.
   */
  test("a custom delete label moves into the menu while View stays on the row", async () => {
    renderTable({
      isViewable: true,
      isDeleteable: true,
      deleteButtonText: "Remove from Project",
    });

    const rows: Array<HTMLElement> = await waitForRows();

    expect(rowButtonLabels(rows[0]!)).toEqual(["View Monitor", "More actions"]);
    expect(within(rows[0]!).queryByText("Remove from Project")).toBeNull();
    expect(menuLabels(openMenuIn(rows[0]!))).toEqual(["Remove from Project"]);
  });

  test("a table whose only action is Show ID shows just the ⋯ menu", async () => {
    renderTable({ showViewIdButton: true });

    const rows: Array<HTMLElement> = await waitForRows();

    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(rowButtonLabels(rows[0]!)).toEqual(["More actions"]);
    expect(screen.queryByRole("button", { name: "Show ID" })).toBeNull();
    expect(menuLabels(openMenuIn(rows[0]!))).toEqual(["Show ID"]);
  });

  test("Show ID from the menu opens the ID dialog for that row", async () => {
    renderTable({ isViewable: true, showViewIdButton: true });

    const rows: Array<HTMLElement> = await waitForRows();

    fireEvent.click(
      within(openMenuIn(rows[1]!)).getByRole("menuitem", { name: "Show ID" }),
    );

    await waitFor(() => {
      expect(screen.getByText("monitor-2")).toBeInTheDocument();
    });
    expect(screen.queryByText("monitor-1")).toBeNull();
  });

  test("without View, Edit is the row button and Delete is in the menu", async () => {
    renderTable({ isEditable: true, isDeleteable: true });

    const rows: Array<HTMLElement> = await waitForRows();

    expect(rowButtonLabels(rows[0]!)).toEqual(["Edit", "More actions"]);
    expect(menuLabels(openMenuIn(rows[0]!))).toEqual(["Delete"]);
  });

  test("Edit from the menu opens the edit form", async () => {
    renderTable({ isViewable: true, isEditable: true });

    const rows: Array<HTMLElement> = await waitForRows();

    fireEvent.click(
      within(openMenuIn(rows[0]!)).getByRole("menuitem", { name: "Edit" }),
    );

    await waitFor(() => {
      expect(showCreateEditModalCalls).toBeGreaterThan(0);
    });
  });

  test("Delete from the menu asks for confirmation", async () => {
    renderTable({ isViewable: true, isDeleteable: true });

    const rows: Array<HTMLElement> = await waitForRows();

    fireEvent.click(
      within(openMenuIn(rows[0]!)).getByRole("menuitem", { name: /Delete/ }),
    );

    await waitFor(() => {
      expect(screen.getByText("Delete Monitor")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Are you sure you want to delete "Checkout API"\?/),
    ).toBeInTheDocument();
  });

  test("the destructive Delete is drawn in red in the menu", async () => {
    renderTable({ isViewable: true, isEditable: true, isDeleteable: true });

    const rows: Array<HTMLElement> = await waitForRows();
    const menu: HTMLElement = openMenuIn(rows[0]!);

    expect(within(menu).getByRole("menuitem", { name: /Delete/ })).toHaveClass(
      "text-red-600",
    );
    expect(within(menu).getByRole("menuitem", { name: "Edit" })).not.toHaveClass(
      "text-red-600",
    );
  });

  test("a table's own actions go in the menu behind View", async () => {
    const onSendTest: jest.Mock<ActionButtonSchema<Monitor>["onClick"]> =
      jest.fn<ActionButtonSchema<Monitor>["onClick"]>();

    renderTable({
      isViewable: true,
      isDeleteable: true,
      actionButtons: [
        {
          title: "Send Test",
          buttonStyleType: ButtonStyleType.NORMAL,
          onClick: onSendTest,
        },
      ],
    });

    const rows: Array<HTMLElement> = await waitForRows();

    expect(rowButtonLabels(rows[1]!)).toEqual(["View Monitor", "More actions"]);

    const menu: HTMLElement = openMenuIn(rows[1]!);

    expect(menuLabels(menu)).toEqual(["Send Test", "Delete"]);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Send Test" }));

    expect(onSendTest).toHaveBeenCalledTimes(1);
    expect(
      (onSendTest.mock.calls[0]?.[0] as unknown as Row | undefined)?._id,
    ).toBe("monitor-2");
  });

  test("a table can keep one of its own actions on the row by marking it Primary", async () => {
    renderTable({
      isViewable: true,
      actionButtons: [
        {
          title: "Verify",
          buttonStyleType: ButtonStyleType.OUTLINE,
          placement: ActionButtonPlacement.Primary,
          onClick: () => {
            return undefined;
          },
        },
      ],
    });

    const rows: Array<HTMLElement> = await waitForRows();

    expect(rowButtonLabels(rows[0]!)).toEqual(["Verify", "More actions"]);
    expect(menuLabels(openMenuIn(rows[0]!))).toEqual(["View Monitor"]);
  });

  test("an action shown only for some rows only reaches those rows", async () => {
    renderTable({
      isViewable: true,
      actionButtons: [
        {
          title: "Retry Checkout",
          buttonStyleType: ButtonStyleType.OUTLINE,
          isVisible: (item: Monitor) => {
            return (item as unknown as Row)._id === "monitor-1";
          },
          onClick: () => {
            return undefined;
          },
        },
      ],
    });

    const rows: Array<HTMLElement> = await waitForRows();

    expect(rowButtonLabels(rows[0]!)).toEqual(["View Monitor", "More actions"]);
    expect(rowButtonLabels(rows[1]!)).toEqual(["View Monitor"]);
  });

  test("a viewer who may not edit or delete still finds both in the menu, locked", async () => {
    permissionsForTest = [Permission.Viewer];

    renderTable({ isViewable: true, isEditable: true, isDeleteable: true });

    const rows: Array<HTMLElement> = await waitForRows();
    const menu: HTMLElement = openMenuIn(rows[0]!);

    expect(within(menu).getByRole("menuitem", { name: "Edit" })).toBeDisabled();
    expect(
      within(menu).getByRole("menuitem", { name: /Delete/ }),
    ).toBeDisabled();
  });
});
