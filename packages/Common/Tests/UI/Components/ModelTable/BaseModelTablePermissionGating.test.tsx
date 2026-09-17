import "@testing-library/jest-dom";
import {
  cleanup,
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
 * What a table offers a viewer who is not allowed to change anything.
 *
 * It used to offer nothing: no Create button in the header, no Edit or Delete
 * in the rows, and - because the whole Actions column was dropped when no row
 * action survived - not even a column where those buttons would have been. To
 * the person looking at the screen that is indistinguishable from a product
 * that cannot do those things at all, which is why the bug report that
 * prompted this said the permissions problem "only surfaces after clicking
 * Create" (issue #3306).
 *
 * Now every one of those affordances stays where it is, locked, and says which
 * permission is missing. Three things have to hold for that to be true and all
 * three are asserted here:
 *
 *   1. the button is rendered rather than removed;
 *   2. it does not act when clicked;
 *   3. hovering it produces the sentence naming the permission.
 *
 * The exceptions matter as much as the rule. `isCreateable` / `isEditable` /
 * `isDeleteable` are the table author saying "this surface has no such action"
 * - nothing to do with permission - and must still hide. View still hides
 * without read permission, because a locked "View X" on a row confirms a
 * record the viewer is not allowed to know exists.
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
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

type Row = {
  _id: string;
  name: string;
  description: string;
};

const ROWS: Array<Row> = [
  { _id: "monitor-1", name: "Checkout API", description: "Payments" },
  { _id: "monitor-2", name: "Billing Worker", description: "Invoices" },
];

const COLUMNS: Array<unknown> = [
  { field: { name: true }, title: "Name", type: FieldType.Text },
  {
    field: { description: true },
    title: "Description",
    type: FieldType.LongText,
  },
];

/*
 * Restated rather than imported from the component, so that a change to the
 * wording has to be made deliberately here too. This sentence is the entire
 * user-facing payload of the feature.
 */
const CREATE_DENIED_MESSAGE: string =
  "You do not have permission to create this Monitor.";
const UPDATE_DENIED_MESSAGE: string =
  "You do not have permission to update this Monitor.";
const DELETE_DENIED_MESSAGE: string =
  "You do not have permission to delete this Monitor.";

type TableOptions = {
  isCreateable?: boolean | undefined;
  isEditable?: boolean | undefined;
  isDeleteable?: boolean | undefined;
  isViewable?: boolean | undefined;
  bulkActionButtons?: Array<unknown> | undefined;
};

describe("BaseModelTable permission gating", () => {
  let showCreateEditModalCalls: number = 0;

  type MakePropsFunction = (
    options: TableOptions,
  ) => BaseModelTableProps<Monitor>;

  const makeProps: MakePropsFunction = (
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
      id: "monitors-table",
      name: "Monitors",
      singularName: "Monitor",
      pluralName: "Monitors",
      userPreferencesKey: "monitors-permission-table",
      urlStateKey: "monitors-permission-table",
      columns: COLUMNS,
      filters: [],
      cardProps: { title: "Monitors", description: "All monitors" },
      isCreateable: options.isCreateable ?? true,
      isEditable: options.isEditable ?? true,
      isDeleteable: options.isDeleteable ?? true,
      isViewable: options.isViewable ?? false,
      callbacks: callbacks,
      ...(options.bulkActionButtons
        ? { bulkActions: { buttons: options.bulkActionButtons } }
        : {}),
    } as unknown as BaseModelTableProps<Monitor>;
  };

  type RenderTableFunction = (
    options?: TableOptions | undefined,
  ) => ReturnType<typeof render>;

  const renderTable: RenderTableFunction = (
    options?: TableOptions | undefined,
  ): ReturnType<typeof render> => {
    return render(<BaseModelTable<Monitor> {...makeProps(options || {})} />);
  };

  type FindButtonFunction = (label: string) => HTMLButtonElement | null;

  /*
   * The rendered label carries the model noun ("Create Monitor"), and row
   * actions render as plain buttons, so one prefix match covers both.
   */
  const findButton: FindButtonFunction = (
    label: string,
  ): HTMLButtonElement | null => {
    const buttons: Array<HTMLButtonElement> = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    );

    return (
      buttons.find((button: HTMLButtonElement) => {
        return (button.textContent || "").trim().startsWith(label);
      }) || null
    );
  };

  beforeEach(() => {
    isMasterAdminForTest = false;
    permissionsForTest = [];
    showCreateEditModalCalls = 0;
    PermissionGate.clearPermissionPropsCache();
    window.history.replaceState(
      window.history.state,
      "",
      "/dashboard/monitors",
    );
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("the header Create button", () => {
    test("works when the viewer may create", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      renderTable();

      await waitFor(() => {
        expect(findButton("Create Monitor")).not.toBeNull();
      });

      const button: HTMLButtonElement = findButton("Create Monitor")!;

      expect(button).not.toBeDisabled();

      fireEvent.click(button);

      await waitFor(() => {
        expect(showCreateEditModalCalls).toBeGreaterThan(0);
      });
    });

    /*
     * The report that prompted all of this: a Viewer-only user. Viewer grants
     * read on Monitor and nothing else, so the snapshot is unambiguously
     * loaded and unambiguously insufficient.
     */
    test("is shown LOCKED, not removed, when the viewer may not create", async () => {
      permissionsForTest = [Permission.Viewer];

      renderTable();

      await waitFor(() => {
        expect(findButton("Create Monitor")).not.toBeNull();
      });

      expect(findButton("Create Monitor")).toBeDisabled();
    });

    test("explains itself on hover", async () => {
      permissionsForTest = [Permission.Viewer];

      const { container } = renderTable();

      await waitFor(() => {
        expect(findButton("Create Monitor")).not.toBeNull();
      });

      /*
       * A disabled button dispatches no pointer events, so the hoverable
       * element is the wrapper Button puts around it.
       */
      const wrapper: HTMLElement = findButton("Create Monitor")!
        .parentElement as HTMLElement;

      fireEvent.mouseEnter(wrapper);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        CREATE_DENIED_MESSAGE,
      );
      expect(screen.getByRole("tooltip")).toHaveTextContent("Create Monitor");
      expect(container).toBeTruthy();
    });

    test("does not open the create modal when clicked while locked", async () => {
      permissionsForTest = [Permission.Viewer];

      renderTable();

      await waitFor(() => {
        expect(findButton("Create Monitor")).not.toBeNull();
      });

      fireEvent.click(findButton("Create Monitor")!);

      expect(showCreateEditModalCalls).toBe(0);
    });

    /*
     * isCreateable is the table author saying this surface does not create
     * anything - several tables set it precisely because they route to a
     * dedicated create page instead. Flipping those to a permanently locked
     * button would be a worse bug than the one being fixed.
     */
    test("stays hidden when the table itself is not creatable", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      renderTable({ isCreateable: false });

      await waitFor(() => {
        expect(screen.getByText("Monitors")).toBeInTheDocument();
      });

      expect(findButton("Create Monitor")).toBeNull();
    });

    /*
     * The snapshot arrives on an API response header. Until it does, telling
     * a project owner they need permissions they own would be worse than the
     * button briefly not being there.
     */
    test("stays hidden while the permission snapshot has not loaded", async () => {
      permissionsForTest = [];

      renderTable();

      await waitFor(() => {
        expect(screen.getByText("Monitors")).toBeInTheDocument();
      });

      expect(findButton("Create Monitor")).toBeNull();
    });

    test("works for a master admin regardless of the snapshot", async () => {
      isMasterAdminForTest = true;
      permissionsForTest = [];

      renderTable();

      await waitFor(() => {
        expect(findButton("Create Monitor")).not.toBeNull();
      });

      expect(findButton("Create Monitor")).not.toBeDisabled();
    });
  });

  describe("row Edit and Delete", () => {
    test("both work when the viewer may edit and delete", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      renderTable();

      await waitFor(() => {
        expect(findButton("Edit")).not.toBeNull();
      });

      expect(findButton("Edit")).not.toBeDisabled();
      expect(findButton("Delete")).not.toBeDisabled();
    });

    /*
     * The Actions column used to be dropped entirely when no row action
     * survived its permission check - so there was not even a cell for a
     * locked button to live in. It now follows the table author's intent.
     */
    test("keeps the Actions column so the locked buttons have somewhere to render", async () => {
      permissionsForTest = [Permission.Viewer];

      renderTable();

      await waitFor(() => {
        expect(screen.getByText("Actions")).toBeInTheDocument();
      });
    });

    test("are shown LOCKED when the viewer may not edit or delete", async () => {
      permissionsForTest = [Permission.Viewer];

      renderTable();

      await waitFor(() => {
        expect(findButton("Edit")).not.toBeNull();
      });

      expect(findButton("Edit")).toBeDisabled();
      expect(findButton("Delete")).toBeDisabled();
    });

    test("the locked Edit explains itself on hover", async () => {
      permissionsForTest = [Permission.Viewer];

      renderTable();

      await waitFor(() => {
        expect(findButton("Edit")).not.toBeNull();
      });

      fireEvent.mouseEnter(findButton("Edit")!.parentElement as HTMLElement);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        UPDATE_DENIED_MESSAGE,
      );
    });

    test("the locked Delete explains itself on hover", async () => {
      permissionsForTest = [Permission.Viewer];

      renderTable();

      await waitFor(() => {
        expect(findButton("Delete")).not.toBeNull();
      });

      fireEvent.mouseEnter(findButton("Delete")!.parentElement as HTMLElement);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        DELETE_DENIED_MESSAGE,
      );
    });

    test("a locked Delete does not open the confirmation dialog", async () => {
      permissionsForTest = [Permission.Viewer];

      renderTable();

      await waitFor(() => {
        expect(findButton("Delete")).not.toBeNull();
      });

      fireEvent.click(findButton("Delete")!);

      /*
       * The confirm dialog restates the action in its own heading, so its
       * absence is what proves the click did nothing.
       */
      expect(screen.queryByText("Confirm Delete")).toBeNull();
    });

    test("stay hidden when the table itself is not editable or deleteable", async () => {
      permissionsForTest = [Permission.Viewer];

      renderTable({ isEditable: false, isDeleteable: false });

      await waitFor(() => {
        expect(screen.getByText("Monitors")).toBeInTheDocument();
      });

      expect(findButton("Edit")).toBeNull();
      expect(findButton("Delete")).toBeNull();
    });

    /*
     * Read is the one operation that keeps hiding. A locked "View Monitor" on
     * a row is itself a disclosure: it confirms a record exists to somebody
     * who is not allowed to see it.
     */
    test("View is hidden, not locked, without read permission", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      /*
       * ProjectAdmin can read monitors, so the button is present here - the
       * point of the pairing below is that it disappears entirely rather than
       * turning into a locked button when read is missing.
       */
      renderTable({
        isViewable: true,
        isEditable: false,
        isDeleteable: false,
      });

      await waitFor(() => {
        expect(findButton("View Monitor")).not.toBeNull();
      });

      cleanup();

      permissionsForTest = [Permission.User];

      renderTable({
        isViewable: true,
        isEditable: false,
        isDeleteable: false,
      });

      await waitFor(() => {
        expect(screen.getByText("Monitors")).toBeInTheDocument();
      });

      expect(findButton("View Monitor")).toBeNull();
    });
  });

  describe("the bulk Delete action", () => {
    const ARCHIVE_ACTION: unknown = {
      title: "Archive",
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: async (): Promise<void> => {
        return Promise.resolve();
      },
    };

    type OpenBulkMenuFunction = (container: HTMLElement) => Promise<void>;

    /*
     * Selecting a row reveals the bulk bar, whose actions live behind a "Bulk
     * Actions" dropdown - so getting to the Delete item takes both steps.
     */
    const openBulkMenu: OpenBulkMenuFunction = async (
      container: HTMLElement,
    ): Promise<void> => {
      await waitFor(() => {
        expect(
          container.querySelectorAll('input[type="checkbox"]:not([disabled])')
            .length,
        ).toBeGreaterThan(0);
      });

      const checkboxes: NodeListOf<HTMLInputElement> =
        container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

      fireEvent.click(checkboxes[0]!);

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

    test("is offered as a locked menu item when the viewer may not delete", async () => {
      permissionsForTest = [Permission.Viewer];

      const { container } = renderTable({
        bulkActionButtons: [ARCHIVE_ACTION],
      });

      await openBulkMenu(container);

      const deleteItem: HTMLElement | undefined = findMenuItem("Delete");

      expect(deleteItem).toBeDefined();
      expect(deleteItem).toBeDisabled();
    });

    test("the locked bulk Delete explains itself on hover", async () => {
      permissionsForTest = [Permission.Viewer];

      const { container } = renderTable({
        bulkActionButtons: [ARCHIVE_ACTION],
      });

      await openBulkMenu(container);

      fireEvent.mouseEnter(
        findMenuItem("Delete")!.parentElement as HTMLElement,
      );

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        DELETE_DENIED_MESSAGE,
      );
    });

    /*
     * The row checkboxes only exist because the table has bulk actions at all.
     * Auto-injecting a locked Delete into a table that has none would grow a
     * selection column onto screens that have never had one.
     */
    test("is not auto-injected into a table that has no other bulk actions", async () => {
      permissionsForTest = [Permission.Viewer];

      const { container } = renderTable();

      await waitFor(() => {
        expect(screen.getByText("Monitors")).toBeInTheDocument();
      });

      expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(
        0,
      );
    });

    /*
     * When the gate refused, the default Delete used to be left in the array
     * as its raw enum string and handed to the bulk bar as if it were a button
     * schema - which renders as a menu item with no label at all.
     */
    test("never leaks the raw default-action enum into the menu", async () => {
      permissionsForTest = [Permission.Viewer];

      const { container } = renderTable({
        bulkActionButtons: [ARCHIVE_ACTION],
      });

      await openBulkMenu(container);

      for (const item of Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      )) {
        expect((item.textContent || "").trim()).not.toBe("");
      }
    });

    test("works when the viewer may delete", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      const { container } = renderTable({
        bulkActionButtons: [ARCHIVE_ACTION],
      });

      await openBulkMenu(container);

      const deleteItem: HTMLElement | undefined = findMenuItem("Delete");

      expect(deleteItem).toBeDefined();
      expect(deleteItem).not.toBeDisabled();
    });
  });
});
