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

/*
 * "We have some items in the More menu that don't have an icon. Can you
 * please add icons to them as well? Please audit the entire app, check
 * everything, and add icons to this More menu. It is basically the actions
 * column More menu of the model table."
 *
 * The screenshot: a row with Edit on it, and its ⋯ menu holding "Show ID" -
 * a bare label - above a red "Delete" with its bin. These render the real
 * BaseModelTable and hold every menu it draws to one rule: every item has an
 * icon. That is the row's ⋯ menu (its own Show ID, View, Edit and Delete, and
 * whatever a page adds), the ⋯ menu in the card header (Documentation, Watch
 * Demo, Help, Refresh, Filter, Columns and a page's own buttons) and the Bulk
 * Actions menu. The source scan in App/Tests/MoreMenuItemIconsGuard.test.ts
 * holds every page's own actions to the same rule.
 */

configure({ asyncUtilTimeout: 15000 });

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
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import { BulkActionButtonSchema } from "../../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { CardButtonSchema } from "../../../../UI/Components/Card/Card";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import Route from "../../../../Types/API/Route";
import IconProp from "../../../../Types/Icon/IconProp";
import { JSONObject } from "../../../../Types/JSON";
import {
  getGlyphOfIcon,
  getGlyphOfMenuItem,
  getMenuItem,
  getMenuItemIconSummaries,
  getMenuItemsWithoutAnIcon,
  MenuItemIconSummary,
} from "../MenuItemIcons";

type Row = {
  _id: string;
  name: string;
};

const ROWS: Array<Row> = [
  { _id: "monitor-1", name: "Checkout API" },
  { _id: "monitor-2", name: "Billing Worker" },
];

type TableOptions = {
  isCreateable?: boolean;
  isEditable?: boolean;
  isDeleteable?: boolean;
  isViewable?: boolean;
  showViewIdButton?: boolean;
  deleteButtonText?: string;
  viewButtonText?: string;
  editButtonText?: string;
  actionButtons?: Array<ActionButtonSchema<Monitor>>;
  getDeleteDisabledReason?: (item: Monitor) => string | undefined;
  cardButtons?: Array<CardButtonSchema>;
  documentationLink?: Route;
  videoLink?: Route;
  helpContent?: { title: string; markdown: string };
  showRefreshButton?: boolean;
  filters?: Array<Filter<Monitor>>;
  columnCount?: 1 | 2;
  bulkActions?: {
    buttons: Array<
      BulkActionButtonSchema<Monitor> | ModalTableBulkDefaultActions
    >;
    deleteVerb?: string;
    deleteIcon?: IconProp;
  };
};

const NAME_FILTER: Filter<Monitor> = {
  title: "Name",
  type: FieldType.Text,
  field: { name: true },
} as unknown as Filter<Monitor>;

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
      return <div data-testid="create-edit-modal" />;
    },
  } as unknown as BaseTableCallbacks<Monitor>;

  const columns: Array<unknown> = [
    { field: { name: true }, title: "Name", type: FieldType.Text },
  ];

  if (options.columnCount === 2) {
    columns.push({
      field: { description: true },
      title: "Description",
      type: FieldType.Text,
    });
  }

  return {
    modelType: Monitor,
    id: "monitors-menu-icons-table",
    name: "Monitors",
    singularName: "Monitor",
    pluralName: "Monitors",
    userPreferencesKey: "monitors-menu-icons-table",
    urlStateKey: "monitors-menu-icons-table",
    columns: columns,
    filters: options.filters || [],
    cardProps: {
      title: "Monitors",
      description: "All monitors",
      buttons: options.cardButtons,
    },
    isCreateable: options.isCreateable ?? false,
    isEditable: options.isEditable ?? false,
    isDeleteable: options.isDeleteable ?? false,
    isViewable: options.isViewable ?? false,
    showViewIdButton: options.showViewIdButton ?? false,
    deleteButtonText: options.deleteButtonText,
    viewButtonText: options.viewButtonText,
    editButtonText: options.editButtonText,
    actionButtons: options.actionButtons,
    getDeleteDisabledReason: options.getDeleteDisabledReason,
    documentationLink: options.documentationLink,
    videoLink: options.videoLink,
    helpContent: options.helpContent,
    showRefreshButton: options.showRefreshButton,
    bulkActions: options.bulkActions,
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

const openRowMenu: (rowActions: HTMLElement) => HTMLElement = (
  rowActions: HTMLElement,
): HTMLElement => {
  fireEvent.click(within(rowActions).getByTestId("row-actions-more-button"));
  return screen.getByRole("menu");
};

const openHeaderMenu: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "More options" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "More options" }));

    return screen.getByRole("menu");
  };

const expectGlyph: (
  menu: HTMLElement,
  label: string,
  icon: IconProp,
) => void = (menu: HTMLElement, label: string, icon: IconProp): void => {
  expect([label, getGlyphOfMenuItem(getMenuItem(menu, label))]).toEqual([
    label,
    getGlyphOfIcon(icon),
  ]);
};

const SEND_TEST: ActionButtonSchema<Monitor> = {
  title: "Send Test",
  icon: IconProp.Play,
  buttonStyleType: ButtonStyleType.OUTLINE,
  onClick: (_item: Monitor, onCompleteAction: VoidFunction) => {
    onCompleteAction();
  },
};

const REVIEW: ActionButtonSchema<Monitor> = {
  title: "Review Results",
  icon: IconProp.List,
  buttonStyleType: ButtonStyleType.NORMAL,
  placement: ActionButtonPlacement.Primary,
  onClick: (_item: Monitor, onCompleteAction: VoidFunction) => {
    onCompleteAction();
  },
};

describe("Every item in a table's menus has an icon", () => {
  beforeEach(() => {
    permissionsForTest = [Permission.ProjectAdmin];
    TableFilterUrlState.clear("monitors-menu-icons-table");
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  describe("the row's ⋯ menu", () => {
    test("the screenshot: Edit on the row, and Show ID and Delete in the menu, each with its icon", async () => {
      renderTable({
        isEditable: true,
        isDeleteable: true,
        showViewIdButton: true,
      });

      const rows: Array<HTMLElement> = await waitForRows();

      const editButton: HTMLElement = within(rows[0]!).getByRole("button", {
        name: "Edit",
      });

      // The row's one button is its label; the icons are the menu's.
      expect(editButton.querySelector("svg")).toBeNull();

      const menu: HTMLElement = openRowMenu(rows[0]!);

      expect(getMenuItemIconSummaries(menu)).toEqual([
        { label: "Show ID", kind: "icon" },
        { label: "Delete", kind: "icon" },
      ]);
      expectGlyph(menu, "Show ID", IconProp.Identification);
      expectGlyph(menu, "Delete", IconProp.Trash);
    });

    test("Show ID, Edit and Delete each wear their own icon beside a View button", async () => {
      renderTable({
        isViewable: true,
        isEditable: true,
        isDeleteable: true,
        showViewIdButton: true,
      });

      const rows: Array<HTMLElement> = await waitForRows();
      const menu: HTMLElement = openRowMenu(rows[1]!);

      expect(
        getMenuItemIconSummaries(menu).map((summary: MenuItemIconSummary) => {
          return summary.label;
        }),
      ).toEqual(["Show ID", "Edit", "Delete"]);
      expectGlyph(menu, "Show ID", IconProp.Identification);
      expectGlyph(menu, "Edit", IconProp.Edit);
      expectGlyph(menu, "Delete", IconProp.Trash);
    });

    test("View wears the eye when one of the table's own actions takes the row", async () => {
      renderTable({
        isViewable: true,
        isEditable: true,
        actionButtons: [REVIEW],
      });

      const rows: Array<HTMLElement> = await waitForRows();

      expect(
        within(rows[0]!).getByRole("button", { name: "Review Results" }),
      ).toBeInTheDocument();

      const menu: HTMLElement = openRowMenu(rows[0]!);

      expectGlyph(menu, "View Monitor", IconProp.Eye);
      expectGlyph(menu, "Edit", IconProp.Edit);
      expect(getMenuItemsWithoutAnIcon(menu)).toEqual([]);
    });

    test("a renamed View, Edit and Delete keep their icons", async () => {
      renderTable({
        isViewable: true,
        isEditable: true,
        isDeleteable: true,
        viewButtonText: "View Timeline",
        editButtonText: "Edit Rule",
        deleteButtonText: "Remove from Project",
        actionButtons: [REVIEW],
      });

      const menu: HTMLElement = openRowMenu((await waitForRows())[0]!);

      expectGlyph(menu, "View Timeline", IconProp.Eye);
      expectGlyph(menu, "Edit Rule", IconProp.Edit);
      expectGlyph(menu, "Remove from Project", IconProp.Trash);
    });

    test("a table that unlinks rather than deletes shows its unlink icon on the row's item too", async () => {
      renderTable({
        isViewable: true,
        isDeleteable: true,
        deleteButtonText: "Unlink",
        bulkActions: {
          buttons: [ModalTableBulkDefaultActions.Delete],
          deleteVerb: "Unlink",
          deleteIcon: IconProp.LinkSlash,
        },
      });

      const menu: HTMLElement = openRowMenu((await waitForRows())[0]!);

      expectGlyph(menu, "Unlink", IconProp.LinkSlash);
    });

    test("a Delete locked for one row stays in its menu with its bin", async () => {
      renderTable({
        isViewable: true,
        isDeleteable: true,
        getDeleteDisabledReason: (item: Monitor): string | undefined => {
          return (item as unknown as Row)._id === "monitor-1"
            ? "A built-in monitor cannot be deleted."
            : undefined;
        },
      });

      const menu: HTMLElement = openRowMenu((await waitForRows())[0]!);
      const deleteItem: HTMLElement = getMenuItem(menu, "Delete");

      expect(deleteItem).toHaveAttribute("aria-disabled", "true");
      expect(getGlyphOfMenuItem(deleteItem)).toBe(
        getGlyphOfIcon(IconProp.Trash),
      );
    });

    /*
     * The status message and error actions wear a circle with a "!". Show ID
     * once wore a circle with an "i" in some menus, and side by side the two
     * read as the same icon.
     */
    test("Show ID can be told apart from View Status Message beside it", async () => {
      renderTable({
        isViewable: true,
        showViewIdButton: true,
        viewButtonText: "View Timeline",
        actionButtons: [
          {
            title: "View Status Message",
            icon: IconProp.Error,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: (_item: Monitor, onCompleteAction: VoidFunction) => {
              onCompleteAction();
            },
          },
        ],
      });

      const menu: HTMLElement = openRowMenu((await waitForRows())[0]!);
      const showId: string = getGlyphOfMenuItem(getMenuItem(menu, "Show ID"));
      const statusMessage: string = getGlyphOfMenuItem(
        getMenuItem(menu, "View Status Message"),
      );

      expect(showId).toBe(getGlyphOfIcon(IconProp.Identification));
      expect(statusMessage).toBe(getGlyphOfIcon(IconProp.Error));
      expect(showId).not.toBe(statusMessage);
      expect(showId).not.toBe(getGlyphOfIcon(IconProp.Info));
    });

    test("a page's own actions show the icons they were given", async () => {
      renderTable({
        isViewable: true,
        isEditable: true,
        isDeleteable: true,
        showViewIdButton: true,
        actionButtons: [SEND_TEST],
      });

      const menu: HTMLElement = openRowMenu((await waitForRows())[0]!);

      expectGlyph(menu, "Send Test", IconProp.Play);
      expect(getMenuItemsWithoutAnIcon(menu)).toEqual([]);
    });

    /*
     * Which actions end up in the menu is decided per table and per row, so
     * this walks through the combinations the tables in the product use.
     */
    const COMBINATIONS: Array<{ name: string; options: TableOptions }> = [
      {
        name: "Show ID alone",
        options: { showViewIdButton: true },
      },
      {
        name: "Show ID and Delete",
        options: { showViewIdButton: true, isDeleteable: true },
      },
      {
        name: "Edit and Delete",
        options: { isEditable: true, isDeleteable: true },
      },
      {
        name: "View, Edit, Delete and Show ID",
        options: {
          isViewable: true,
          isEditable: true,
          isDeleteable: true,
          showViewIdButton: true,
        },
      },
      {
        name: "a page's own Primary action with everything else",
        options: {
          isViewable: true,
          isEditable: true,
          isDeleteable: true,
          showViewIdButton: true,
          actionButtons: [REVIEW, SEND_TEST],
        },
      },
      {
        name: "Show ID placed in the menu next to a page's own action",
        options: {
          showViewIdButton: true,
          actionButtons: [SEND_TEST],
        },
      },
    ];

    for (const combination of COMBINATIONS) {
      test(`no item is without an icon: ${combination.name}`, async () => {
        renderTable(combination.options);

        const rows: Array<HTMLElement> = await waitForRows();

        for (const rowActions of rows) {
          const trigger: HTMLElement | null = within(rowActions).queryByTestId(
            "row-actions-more-button",
          );

          if (!trigger) {
            continue;
          }

          const menu: HTMLElement = openRowMenu(rowActions);

          expect(getMenuItemsWithoutAnIcon(menu)).toEqual([]);

          // Close it again before the next row's.
          fireEvent.keyDown(menu, { key: "Escape" });
        }
      });
    }
  });

  describe("the card header's ⋯ menu", () => {
    test("Documentation, Watch Demo, Help, Refresh, Filter and Columns each have their icon", async () => {
      renderTable({
        isViewable: true,
        documentationLink: Route.fromString("/docs/monitor/monitor-secrets"),
        videoLink: Route.fromString("/videos/monitors"),
        helpContent: { title: "Monitors", markdown: "What a monitor is." },
        showRefreshButton: true,
        filters: [NAME_FILTER],
        columnCount: 2,
      });

      await waitForRows();

      const menu: HTMLElement = await openHeaderMenu();

      expect(getMenuItemsWithoutAnIcon(menu)).toEqual([]);
      expectGlyph(menu, "View Documentation", IconProp.Book);
      expectGlyph(menu, "Watch Demo", IconProp.Play);
      expectGlyph(menu, "Help", IconProp.Help);
      expectGlyph(menu, "Refresh", IconProp.Refresh);
      expectGlyph(menu, "Filter", IconProp.Filter);
      expectGlyph(menu, "Columns", IconProp.TableCells);
    });

    /*
     * A page's own header buttons that are not its main call to action go in
     * the same menu - "Add in Bulk" on the status page subscriber tables went
     * in as a bare label, its icon hidden from the compiler by a cast.
     */
    test("a page's own header buttons keep their icons in the menu", async () => {
      renderTable({
        isCreateable: true,
        isViewable: true,
        showRefreshButton: true,
        cardButtons: [
          {
            title: "Add in Bulk",
            buttonStyle: ButtonStyleType.OUTLINE,
            icon: IconProp.UserGroup,
            onClick: () => {},
          },
          {
            title: "Import from CSV",
            buttonStyle: ButtonStyleType.OUTLINE,
            icon: IconProp.Upload,
            onClick: () => {},
          },
        ],
      });

      await waitForRows();

      // Create is the header's main button; the rest are in the menu.
      expect(
        screen.getByRole("button", { name: "Create Monitor" }),
      ).toBeInTheDocument();

      const menu: HTMLElement = await openHeaderMenu();

      expect(getMenuItemsWithoutAnIcon(menu)).toEqual([]);
      expectGlyph(menu, "Add in Bulk", IconProp.UserGroup);
      expectGlyph(menu, "Import from CSV", IconProp.Upload);
      expectGlyph(menu, "Refresh", IconProp.Refresh);
    });
  });

  describe("the Bulk Actions menu", () => {
    test("a page's bulk actions, the table's Delete and Export CSV each have their icon", async () => {
      const archive: BulkActionButtonSchema<Monitor> = {
        title: "Archive",
        icon: IconProp.Archive,
        buttonStyleType: ButtonStyleType.NORMAL,
        onClick: async (): Promise<void> => {
          return Promise.resolve();
        },
      };

      const { container } = render(
        <BaseModelTable<Monitor>
          {...makeProps({
            isViewable: true,
            bulkActions: {
              buttons: [archive, ModalTableBulkDefaultActions.Delete],
            },
          })}
        />,
      );

      await waitFor(() => {
        expect(
          container.querySelectorAll('input[type="checkbox"]').length,
        ).toBeGreaterThan(ROWS.length);
      });

      const checkboxes: Array<HTMLInputElement> = Array.from(
        container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      );

      fireEvent.click(checkboxes[checkboxes.length - 1]!);

      await waitFor(() => {
        expect(screen.getByText("Bulk Actions")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Bulk Actions"));

      const menu: HTMLElement = await waitFor(() => {
        return screen.getByRole("menu");
      });

      expect(getMenuItemsWithoutAnIcon(menu)).toEqual([]);
      expectGlyph(menu, "Archive", IconProp.Archive);
      expectGlyph(menu, "Export CSV", IconProp.Download);
      expectGlyph(menu, "Delete", IconProp.Trash);
    });
  });
});
