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
 * A table's buttons read the permission snapshot by the rule the server
 * follows. The snapshot is the real one here - the rows the API's response
 * headers leave in storage, allow and block alike - so these tests see what
 * a member of several teams sees:
 *
 *   - a team's block row is never a grant;
 *   - a block with no labels takes the permission away, whatever another
 *     team allows, and the locked button says which team block refuses it;
 *   - a block with labels only restricts the labelled records, which the
 *     server leaves out of the list, so the buttons stay;
 *   - "Edit All Operational Resources" edits a monitor, unless it is blocked.
 */

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
import PermissionUtil from "../../../../UI/Utils/Permission";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Permission, { UserPermission } from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

type Row = {
  _id: string;
  name: string;
};

const ROWS: Array<Row> = [{ _id: "monitor-1", name: "Checkout API" }];

const LABEL: ObjectID = new ObjectID("6f1d6c39-0a8e-4f4a-9e43-0d8d4fb0a004");

type RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
) => UserPermission;

const row: RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelled ? [LABEL] : [],
    isBlockPermission: Boolean(options?.isBlock),
  };
};

// What every signed-in member holds, whatever their teams say.
const GLOBAL_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

type GivenSnapshotFunction = (rows: Array<UserPermission>) => void;

// The snapshot as API.ts stores it from the response headers.
const givenSnapshot: GivenSnapshotFunction = (
  rows: Array<UserPermission>,
): void => {
  const projectId: ObjectID = ObjectID.generate();

  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: GLOBAL_PERMISSIONS,
    projectIds: [projectId],
  });
  PermissionUtil.setProjectPermissions({
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: rows,
  });
};

const containing: (text: string) => RegExp = (text: string): RegExp => {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
};

type BlockedSentenceFunction = (permission: Permission) => string;

const blockedSentence: BlockedSentenceFunction = (
  permission: Permission,
): string => {
  return `A team you are on blocks ${PermissionGate.getPermissionTitles([
    permission,
  ]).join(", ")}.`;
};

describe("BaseModelTable with block rows in the snapshot", () => {
  const props: BaseModelTableProps<Monitor> = {
    modelType: Monitor,
    id: "monitors-block-rows-table",
    name: "Monitors",
    singularName: "Monitor",
    pluralName: "Monitors",
    userPreferencesKey: "monitors-block-rows-table",
    urlStateKey: "monitors-block-rows-table",
    columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
    filters: [],
    cardProps: { title: "Monitors", description: "All monitors" },
    isCreateable: true,
    isEditable: true,
    isDeleteable: true,
    isViewable: false,
    callbacks: {
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
    } as unknown as BaseTableCallbacks<Monitor>,
  } as unknown as BaseModelTableProps<Monitor>;

  type FindButtonFunction = (label: string) => HTMLButtonElement | null;

  const findButton: FindButtonFunction = (
    label: string,
  ): HTMLButtonElement | null => {
    return (
      Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button: HTMLButtonElement) => {
          return (button.textContent || "").trim().startsWith(label);
        },
      ) || null
    );
  };

  const openRowActionsMenu: () => void = (): void => {
    const trigger: HTMLElement | null = document.querySelector(
      '[data-testid="row-actions-more-button"]',
    );

    if (!trigger) {
      throw new Error("The row has no ⋯ actions menu to open.");
    }

    fireEvent.click(trigger);
  };

  type RenderTableFunction = () => Promise<void>;

  const renderTable: RenderTableFunction = async (): Promise<void> => {
    render(<BaseModelTable<Monitor> {...props} />);

    await waitFor(() => {
      expect(findButton("Edit")).not.toBeNull();
    });
  };

  // One team edits and deletes monitors.
  const EDITOR_ROWS: Array<UserPermission> = [
    row(Permission.ReadProjectMonitor),
    row(Permission.CreateProjectMonitor),
    row(Permission.EditProjectMonitor),
    row(Permission.DeleteProjectMonitor),
  ];

  beforeEach(() => {
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
    window.localStorage.clear();
  });

  test("a member whose teams allow it may edit and delete", async () => {
    givenSnapshot(EDITOR_ROWS);

    await renderTable();

    expect(findButton("Edit")).not.toBeDisabled();
    expect(findButton("Create Monitor")).not.toBeDisabled();

    openRowActionsMenu();

    expect(findButton("Delete")).not.toHaveAttribute("aria-disabled", "true");
  });

  test("another team's block with no labels locks Delete, and says which block", async () => {
    givenSnapshot([
      ...EDITOR_ROWS,
      row(Permission.DeleteProjectMonitor, { isBlock: true }),
    ]);

    await renderTable();

    // Editing is untouched by a block on deleting.
    expect(findButton("Edit")).not.toBeDisabled();

    openRowActionsMenu();

    expect(findButton("Delete")).toHaveAttribute("aria-disabled", "true");
    expect(findButton("Delete")).toHaveAccessibleDescription(
      containing(blockedSentence(Permission.DeleteProjectMonitor)),
    );
  });

  test("a block with labels leaves the buttons alone: it restricts labelled monitors, which the list leaves out", async () => {
    givenSnapshot([
      ...EDITOR_ROWS,
      row(Permission.DeleteProjectMonitor, { isBlock: true, labelled: true }),
      row(Permission.EditProjectMonitor, { isBlock: true, labelled: true }),
    ]);

    await renderTable();

    expect(findButton("Edit")).not.toBeDisabled();

    openRowActionsMenu();

    expect(findButton("Delete")).not.toHaveAttribute("aria-disabled", "true");
  });

  test("a block row is never a grant: a member whose only rows are blocks may change nothing", async () => {
    givenSnapshot([
      row(Permission.ReadProjectMonitor),
      row(Permission.CreateProjectMonitor, { isBlock: true }),
      row(Permission.EditProjectMonitor, { isBlock: true, labelled: true }),
    ]);

    await renderTable();

    expect(findButton("Create Monitor")).toBeDisabled();
    expect(findButton("Edit")).toBeDisabled();

    fireEvent.mouseEnter(
      findButton("Create Monitor")!.parentElement as HTMLElement,
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      blockedSentence(Permission.CreateProjectMonitor),
    );
  });

  test("Edit All Operational Resources edits a monitor", async () => {
    givenSnapshot([
      row(Permission.ReadAllOperationalResources),
      row(Permission.EditAllOperationalResources),
    ]);

    await renderTable();

    expect(findButton("Edit")).not.toBeDisabled();
    expect(findButton("Create Monitor")).toBeDisabled();
  });

  test("a block with no labels on the wildcard takes it away", async () => {
    givenSnapshot([
      row(Permission.ReadAllOperationalResources),
      row(Permission.EditAllOperationalResources),
      row(Permission.EditAllOperationalResources, { isBlock: true }),
    ]);

    await renderTable();

    expect(findButton("Edit")).toBeDisabled();
  });

  test("a block on the monitor's own permission refuses the wildcard holder too", async () => {
    givenSnapshot([
      row(Permission.ReadAllOperationalResources),
      row(Permission.EditAllOperationalResources),
      row(Permission.EditProjectMonitor, { isBlock: true }),
    ]);

    await renderTable();

    expect(findButton("Edit")).toBeDisabled();

    fireEvent.mouseEnter(findButton("Edit")!.parentElement as HTMLElement);

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      blockedSentence(Permission.EditProjectMonitor),
    );
  });
});
