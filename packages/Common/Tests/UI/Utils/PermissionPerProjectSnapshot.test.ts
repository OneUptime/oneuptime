import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TWO PROJECTS OPEN IN TWO TABS NEVER SWAP EACH OTHER'S ROLE (#5306's
 * follow-up).
 *
 * Every tab open on the Dashboard's address shares the browser's storage.
 * The permission snapshot of "the current project" was kept there under one
 * name for every project ("project_permissions", its hash under
 * "project-permissions-hash"), so a person who was Project Owner in one
 * project and Viewer in another, with both open side by side, saw each
 * tab's buttons follow whichever tab's answer had come back last: the
 * Owner's tab locked Create, and the Viewer's offered it.
 *
 * Each project's snapshot is now kept under names that end in its id, and a
 * tab reads the snapshot of the project it shows - the one its address
 * names, else the one it was showing (TabProject, which
 * ProjectUtil.getCurrentProjectId reads for every request's tenantid). A
 * tab here is the address and the session storage jsdom gives the page:
 * the tests move the address from one project to the other as the person
 * moves from one tab to the other, while localStorage - shared, as in a
 * browser - keeps what every tab left in it.
 */

let isMasterAdminForTest: boolean = false;

jest.mock("../../../UI/Utils/User", () => {
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

import PermissionUtil, {
  GLOBAL_PERMISSIONS_HASH_STORAGE_KEY,
  GLOBAL_PERMISSIONS_STORAGE_KEY,
  PROJECT_PERMISSIONS_HASH_STORAGE_KEY_PREFIX,
  PROJECT_PERMISSIONS_STORAGE_KEY_PREFIX,
  getProjectPermissionsHashStorageKey,
  getProjectPermissionsStorageKey,
  toPermissionsProjectId,
} from "../../../UI/Utils/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TabProject, {
  CURRENT_PROJECT_ID_STORAGE_KEY,
  LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
} from "../../../UI/Utils/TabProject";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import SessionStorage from "../../../UI/Utils/SessionStorage";
import Label from "../../../Models/DatabaseModels/Label";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  keepProjectPermissionsInTab,
  showProjectInTab,
} from "../../Helpers/TabProjectPermissions";

// The person is Project Owner in the first project and Viewer in the second.
const OWNED_PROJECT_ID: string = "5f000000-0000-4000-8000-000000000001";
const VIEWED_PROJECT_ID: string = "5f000000-0000-4000-8000-000000000002";
const THIRD_PROJECT_ID: string = "5f000000-0000-4000-8000-000000000003";

const OWNED_HASH: string = "hash-of-the-owned-project";
const VIEWED_HASH: string = "hash-of-the-viewed-project";

// The names every project shared before, left in place and never read.
const SHARED_SNAPSHOT_KEY: string = "project_permissions";
const SHARED_HASH_KEY: string = "project-permissions-hash";

type RowFunction = (permission: Permission) => UserPermission;

const row: RowFunction = (permission: Permission): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
  };
};

type SnapshotFunction = (
  projectId: string,
  permissions: Array<Permission>,
) => UserTenantAccessPermission;

const snapshot: SnapshotFunction = (
  projectId: string,
  permissions: Array<Permission>,
): UserTenantAccessPermission => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(projectId),
    permissions: permissions.map(row),
  };
};

const OWNER_SNAPSHOT: () => UserTenantAccessPermission =
  (): UserTenantAccessPermission => {
    return snapshot(OWNED_PROJECT_ID, [
      Permission.ProjectOwner,
      Permission.ProjectUser,
    ]);
  };

const VIEWER_SNAPSHOT: () => UserTenantAccessPermission =
  (): UserTenantAccessPermission => {
    return snapshot(VIEWED_PROJECT_ID, [
      Permission.Viewer,
      Permission.ProjectUser,
    ]);
  };

/*
 * The person moves to the tab that shows `projectId`: its address, and its
 * own session storage (a tab's session storage is its own, so the other
 * tab's is not there).
 */
type OpenTabFunction = (projectId: string, page?: string) => void;

const openTab: OpenTabFunction = (
  projectId: string,
  page: string = "settings/labels",
): void => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", `/dashboard/${projectId}/${page}`);
};

type HeldInTabFunction = () => Array<Permission>;

const heldInTab: HeldInTabFunction = (): Array<Permission> => {
  return [...(PermissionUtil.getProjectPermissions()?.permissions || [])].map(
    (permissionRow: UserPermission): Permission => {
      return permissionRow.permission;
    },
  );
};

type CreateLabelFunction = () => PermissionGateResult;

// The Labels page's Create Label button, as its table asks for it.
const createLabel: CreateLabelFunction = (): PermissionGateResult => {
  return PermissionGate.check(new Label(), ModelAction.Create);
};

beforeEach(() => {
  isMasterAdminForTest = false;
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  PermissionGate.clearPermissionPropsCache();
  jest.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  jest.restoreAllMocks();
});

describe("the names a project's snapshot is kept under", () => {
  test("end in the project's id, one pair per project", () => {
    expect(getProjectPermissionsStorageKey(OWNED_PROJECT_ID)).toBe(
      `project_permissions:${OWNED_PROJECT_ID}`,
    );
    expect(getProjectPermissionsHashStorageKey(OWNED_PROJECT_ID)).toBe(
      `project-permissions-hash:${OWNED_PROJECT_ID}`,
    );
    expect(getProjectPermissionsStorageKey(VIEWED_PROJECT_ID)).not.toBe(
      getProjectPermissionsStorageKey(OWNED_PROJECT_ID),
    );
    expect(PROJECT_PERMISSIONS_STORAGE_KEY_PREFIX).toBe("project_permissions:");
    expect(PROJECT_PERMISSIONS_HASH_STORAGE_KEY_PREFIX).toBe(
      "project-permissions-hash:",
    );
  });

  test("are never the names every project shared", () => {
    for (const id of [OWNED_PROJECT_ID, VIEWED_PROJECT_ID]) {
      expect(getProjectPermissionsStorageKey(id)).not.toBe(SHARED_SNAPSHOT_KEY);
      expect(getProjectPermissionsHashStorageKey(id)).not.toBe(SHARED_HASH_KEY);
    }
  });

  test("read an id as the API writes it: trimmed and in lower case, from text or an ObjectID", () => {
    const upper: string = ` ${OWNED_PROJECT_ID.toUpperCase()} `;

    expect(toPermissionsProjectId(upper)).toBe(OWNED_PROJECT_ID);
    expect(toPermissionsProjectId(new ObjectID(OWNED_PROJECT_ID))).toBe(
      OWNED_PROJECT_ID,
    );
    expect(getProjectPermissionsStorageKey(upper)).toBe(
      getProjectPermissionsStorageKey(OWNED_PROJECT_ID),
    );
  });

  test("are no name at all for what is not a project's id", () => {
    for (const notAnId of [
      undefined,
      null,
      "",
      "   ",
      ":projectId",
      "undefined",
      "null",
      "project-1",
      `${OWNED_PROJECT_ID}x`,
    ]) {
      expect([notAnId, getProjectPermissionsStorageKey(notAnId)]).toEqual([
        notAnId,
        null,
      ]);
      expect([notAnId, getProjectPermissionsHashStorageKey(notAnId)]).toEqual([
        notAnId,
        null,
      ]);
    }
  });

  test("the test helper shows a project in the tab as the Dashboard does", () => {
    showProjectInTab(THIRD_PROJECT_ID);

    expect(TabProject.getProjectId()?.toString()).toBe(THIRD_PROJECT_ID);
    expect(ProjectUtil.getCurrentProjectId()?.toString()).toBe(
      THIRD_PROJECT_ID,
    );
  });
});

describe("two projects open in two tabs", () => {
  test("each tab reads the snapshot of the project it shows, whichever tab's answer came last", () => {
    openTab(OWNED_PROJECT_ID);
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());

    openTab(VIEWED_PROJECT_ID);
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());

    // Back in the first tab, after the second tab's answer.
    openTab(OWNED_PROJECT_ID);
    expect(heldInTab()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectUser,
    ]);

    openTab(VIEWED_PROJECT_ID);
    expect(heldInTab()).toEqual([Permission.Viewer, Permission.ProjectUser]);
  });

  test("the Owner's tab offers Create Label and the Viewer's locks it, however often each tab's answers come back", () => {
    for (let round: number = 0; round < 3; round++) {
      openTab(OWNED_PROJECT_ID);
      PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());

      openTab(VIEWED_PROJECT_ID);
      PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());

      openTab(OWNED_PROJECT_ID);
      expect(createLabel()).toEqual({ isAllowed: true });

      openTab(VIEWED_PROJECT_ID);
      const viewerGate: PermissionGateResult = createLabel();
      expect(viewerGate.isAllowed).toBe(false);
      expect(viewerGate.disabledReason).toContain(
        "You do not have permission to create this Label.",
      );
      expect(viewerGate.disabledReason).toContain("Create Label");

      // The Owner's tab answers again: the Viewer's tab is still locked.
      openTab(OWNED_PROJECT_ID);
      PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());
      openTab(VIEWED_PROJECT_ID);
      expect(createLabel().isAllowed).toBe(false);
    }
  });

  test("a project's answer read in another tab - a page that reads several projects - leaves this tab's role alone", () => {
    openTab(VIEWED_PROJECT_ID, "home");
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());

    // My On-Call Policies asks every project of the person in turn.
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());
    PermissionUtil.setProjectPermissions(
      snapshot(THIRD_PROJECT_ID, [Permission.ProjectAdmin]),
    );

    expect(heldInTab()).toEqual([Permission.Viewer, Permission.ProjectUser]);
    expect(createLabel().isAllowed).toBe(false);
    expect(
      PermissionUtil.getProjectPermissions(THIRD_PROJECT_ID)?.permissions.map(
        (permissionRow: UserPermission) => {
          return permissionRow.permission;
        },
      ),
    ).toEqual([Permission.ProjectAdmin]);
  });

  test("a snapshot is kept for the project it names, not the tab that received it", () => {
    openTab(OWNED_PROJECT_ID);
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());

    expect(PermissionUtil.getProjectPermissions()).toBeNull();
    expect(
      PermissionUtil.getProjectPermissions(VIEWED_PROJECT_ID)?.projectId,
    ).toEqual(new ObjectID(VIEWED_PROJECT_ID));
    expect(
      localStorage.getItem(getProjectPermissionsStorageKey(VIEWED_PROJECT_ID)!),
    ).not.toBeNull();
    expect(
      localStorage.getItem(getProjectPermissionsStorageKey(OWNED_PROJECT_ID)!),
    ).toBeNull();
  });

  test("a tab with the project's id in capitals reads the same snapshot", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());

    openTab(OWNED_PROJECT_ID.toUpperCase());

    expect(heldInTab()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectUser,
    ]);
  });

  test("the person's global permissions stay one snapshot for every tab, on purpose: they are the person's own", () => {
    openTab(OWNED_PROJECT_ID);
    PermissionUtil.setGlobalPermissions({
      _type: "UserGlobalAccessPermission",
      globalPermissions: [Permission.CurrentUser],
      projectIds: [
        new ObjectID(OWNED_PROJECT_ID),
        new ObjectID(VIEWED_PROJECT_ID),
      ],
    });
    PermissionUtil.setGlobalPermissionsHash("global-hash");

    openTab(VIEWED_PROJECT_ID);

    expect(PermissionUtil.getGlobalPermissions()?.globalPermissions).toEqual([
      Permission.CurrentUser,
    ]);
    expect(PermissionUtil.getGlobalPermissionsHash()).toBe("global-hash");
    expect(GLOBAL_PERMISSIONS_STORAGE_KEY).toBe("global_permissions");
    expect(GLOBAL_PERMISSIONS_HASH_STORAGE_KEY).toBe("global-permissions-hash");
  });

  test("a master admin's tab allows everything, whatever either snapshot says", () => {
    isMasterAdminForTest = true;
    openTab(VIEWED_PROJECT_ID);
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());

    expect(createLabel()).toEqual({ isAllowed: true });
  });
});

describe("the project a tab shows", () => {
  test("is the one its address names, before the one it was showing", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());

    openTab(VIEWED_PROJECT_ID);
    window.sessionStorage.setItem(
      CURRENT_PROJECT_ID_STORAGE_KEY,
      OWNED_PROJECT_ID,
    );

    expect(PermissionUtil.getTabProjectId()).toBe(VIEWED_PROJECT_ID);
    expect(heldInTab()).toEqual([Permission.Viewer, Permission.ProjectUser]);
  });

  test("on a page with no project in its address, is the one the tab was showing", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());

    window.history.replaceState(null, "", "/dashboard/user-settings/profile");
    showProjectInTab(VIEWED_PROJECT_ID);
    localStorage.setItem(
      LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
      OWNED_PROJECT_ID,
    );

    expect(heldInTab()).toEqual([Permission.Viewer, Permission.ProjectUser]);
  });

  test("in a new tab that has picked no project yet, is the one last opened in this browser - the one its requests name", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());

    window.history.replaceState(null, "", "/dashboard");
    localStorage.setItem(
      LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
      OWNED_PROJECT_ID,
    );

    expect(PermissionUtil.getTabProjectId()).toBe(OWNED_PROJECT_ID);
    expect(heldInTab()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectUser,
    ]);
  });

  test("a tab that shows no project reads no project snapshot - not one another tab left", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());
    window.history.replaceState(null, "", "/dashboard/welcome");

    expect(PermissionUtil.getTabProjectId()).toBeNull();
    expect(PermissionUtil.getProjectPermissions()).toBeNull();
    expect(createLabel()).toEqual({ isAllowed: false });
  });

  test("a route's placeholder names no project", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());
    window.history.replaceState(null, "", "/dashboard/:projectId/home");

    expect(PermissionUtil.getProjectPermissions()).toBeNull();
  });

  test("is the project every request of the tab names in its tenantid header, wherever the tab is", () => {
    type TabFunction = () => void;

    const tabs: Array<[string, TabFunction]> = [
      [
        "a project's page",
        (): void => {
          window.history.replaceState(
            null,
            "",
            `/dashboard/${VIEWED_PROJECT_ID}/home`,
          );
        },
      ],
      [
        "a page of no project, after the tab showed one",
        (): void => {
          window.history.replaceState(null, "", "/dashboard/user-settings");
          showProjectInTab(OWNED_PROJECT_ID);
        },
      ],
      [
        "a new tab that has picked no project yet",
        (): void => {
          window.history.replaceState(null, "", "/dashboard");
          localStorage.setItem(
            LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
            THIRD_PROJECT_ID,
          );
        },
      ],
      [
        "a tab with no project at all",
        (): void => {
          window.history.replaceState(null, "", "/dashboard/welcome");
        },
      ],
    ];

    for (const [where, open] of tabs) {
      localStorage.clear();
      sessionStorage.clear();
      open();

      expect([where, PermissionUtil.getTabProjectId()]).toEqual([
        where,
        ModelAPI.getCommonHeaders()["tenantid"] || null,
      ]);
      expect([where, PermissionUtil.getTabProjectId()]).toEqual([
        where,
        ProjectUtil.getCurrentProjectId()?.toString() || null,
      ]);
    }
  });

  test("a project read as text is read the same", () => {
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());

    jest
      .spyOn(TabProject, "getProjectId")
      .mockReturnValue(VIEWED_PROJECT_ID as unknown as ObjectID);

    expect(PermissionUtil.getTabProjectId()).toBe(VIEWED_PROJECT_ID);
  });

  test("a tab whose project cannot be read (blocked session storage) reads no snapshot, and does not throw", () => {
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());
    window.history.replaceState(null, "", "/dashboard/user-settings");

    jest.spyOn(SessionStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: The operation is insecure.");
    });

    expect(PermissionUtil.getTabProjectId()).toBeNull();
    expect(PermissionUtil.getProjectPermissions()).toBeNull();
    expect(PermissionGate.hasPermissionSnapshot()).toBe(false);
  });
});

describe("switching projects in one tab", () => {
  test("shows the new project's snapshot at once when this browser keeps one - never the old project's", () => {
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());

    openTab(OWNED_PROJECT_ID);
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());
    expect(createLabel().isAllowed).toBe(true);

    // The project picker sends the tab to the other project's address.
    window.history.replaceState(
      null,
      "",
      `/dashboard/${VIEWED_PROJECT_ID}/home`,
    );
    showProjectInTab(VIEWED_PROJECT_ID);

    expect(createLabel().isAllowed).toBe(false);
    expect(createLabel().disabledReason).toContain("Create Label");
  });

  test("with no snapshot of the new project yet, offers nothing until its first answer - it never borrows the old project's", () => {
    openTab(OWNED_PROJECT_ID);
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());

    window.history.replaceState(
      null,
      "",
      `/dashboard/${VIEWED_PROJECT_ID}/home`,
    );

    expect(PermissionUtil.getProjectPermissions()).toBeNull();
    expect(PermissionGate.hasPermissionSnapshot()).toBe(false);
    // Hidden, not locked: there is nothing honest to say yet.
    expect(createLabel()).toEqual({ isAllowed: false });

    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());

    expect(createLabel().isAllowed).toBe(false);
    expect(createLabel().disabledReason).toContain("Create Label");
  });

  test("going back to the first project reads its snapshot again, unchanged", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());

    openTab(VIEWED_PROJECT_ID);
    expect(createLabel().isAllowed).toBe(false);

    openTab(OWNED_PROJECT_ID);
    expect(createLabel().isAllowed).toBe(true);
  });
});

describe("the names every project shared before", () => {
  test("a snapshot left under the old name is never read, in any tab", () => {
    localStorage.setItem(
      SHARED_SNAPSHOT_KEY,
      JSON.stringify({
        _type: "UserTenantAccessPermission",
        projectId: VIEWED_PROJECT_ID,
        permissions: [row(Permission.ProjectOwner)],
      }),
    );
    localStorage.setItem(SHARED_HASH_KEY, "old-shared-hash");

    openTab(VIEWED_PROJECT_ID);

    expect(PermissionUtil.getProjectPermissions()).toBeNull();
    expect(PermissionUtil.getProjectPermissionsHash(VIEWED_PROJECT_ID)).toBe(
      null,
    );
    // An Owner snapshot under the old name does not unlock the Viewer's tab.
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT());
    expect(createLabel().isAllowed).toBe(false);
  });

  test("are left where they are, untouched, so a tab still running the version before keeps working until it reloads", () => {
    const oldSnapshot: string = JSON.stringify({
      projectId: OWNED_PROJECT_ID,
      permissions: [row(Permission.ProjectOwner)],
    });

    localStorage.setItem(SHARED_SNAPSHOT_KEY, oldSnapshot);
    localStorage.setItem(SHARED_HASH_KEY, "old-shared-hash");

    openTab(VIEWED_PROJECT_ID);
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT(), {
      hash: VIEWED_HASH,
    });
    PermissionUtil.clearProjectPermissions();
    PermissionUtil.clearProjectPermissions(OWNED_PROJECT_ID);

    expect(localStorage.getItem(SHARED_SNAPSHOT_KEY)).toBe(oldSnapshot);
    expect(localStorage.getItem(SHARED_HASH_KEY)).toBe("old-shared-hash");
  });

  test("nothing writes them any more", () => {
    openTab(OWNED_PROJECT_ID);
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT(), {
      hash: OWNED_HASH,
    });
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT(), {
      hash: VIEWED_HASH,
    });

    expect(localStorage.getItem(SHARED_SNAPSHOT_KEY)).toBeNull();
    expect(localStorage.getItem(SHARED_HASH_KEY)).toBeNull();
  });
});

describe("what is kept, and what is not", () => {
  test("a snapshot kept under one project's name that names another project is not read", () => {
    localStorage.setItem(
      getProjectPermissionsStorageKey(OWNED_PROJECT_ID)!,
      JSON.stringify({
        _type: "UserTenantAccessPermission",
        projectId: VIEWED_PROJECT_ID,
        permissions: [row(Permission.ProjectOwner)],
      }),
    );

    openTab(OWNED_PROJECT_ID);

    expect(PermissionUtil.getProjectPermissions()).toBeNull();
  });

  test("a snapshot that names no project is not kept: there is no telling whose it is", () => {
    openTab(OWNED_PROJECT_ID);

    PermissionUtil.setProjectPermissions({
      _type: "UserTenantAccessPermission",
      permissions: [row(Permission.ProjectOwner)],
    } as unknown as UserTenantAccessPermission);

    expect(Object.keys(LocalStorage.getAllItems())).toEqual([]);
    expect(PermissionUtil.getProjectPermissions()).toBeNull();
  });

  test("a stored value that is not a snapshot reads as none", () => {
    openTab(OWNED_PROJECT_ID);

    for (const stored of ["true", "42", '"text"', "[]", "{not json"]) {
      localStorage.setItem(
        getProjectPermissionsStorageKey(OWNED_PROJECT_ID)!,
        stored,
      );

      expect([stored, PermissionUtil.getProjectPermissions()]).toEqual([
        stored,
        null,
      ]);
    }
  });

  test("a snapshot is read back as it was kept: its rows, its blocks, its project", () => {
    const kept: UserTenantAccessPermission = snapshot(OWNED_PROJECT_ID, [
      Permission.ProjectOwner,
    ]);
    kept.permissions.push({
      _type: "UserPermission",
      permission: Permission.CreateProjectLabel,
      labelIds: [new ObjectID(THIRD_PROJECT_ID)],
      isBlockPermission: true,
    });

    PermissionUtil.setProjectPermissions(kept);
    openTab(OWNED_PROJECT_ID);

    const read: UserTenantAccessPermission | null =
      PermissionUtil.getProjectPermissions();

    expect(read?._type).toBe("UserTenantAccessPermission");
    expect(read?.projectId?.toString()).toBe(OWNED_PROJECT_ID);
    expect(read?.permissions).toHaveLength(2);
    expect(read?.permissions[1]?.isBlockPermission).toBe(true);
    expect(read?.permissions[1]?.labelIds?.[0]?.toString()).toBe(
      THIRD_PROJECT_ID,
    );
  });

  test("the test helper keeps a snapshot for the tab that shows its project", () => {
    keepProjectPermissionsInTab(VIEWER_SNAPSHOT());

    expect(PermissionUtil.getTabProjectId()).toBe(VIEWED_PROJECT_ID);
    expect(heldInTab()).toEqual([Permission.Viewer, Permission.ProjectUser]);
  });
});

describe("a project's hash", () => {
  test("is kept with its snapshot, under the project's own name", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT(), {
      hash: OWNED_HASH,
    });
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT(), {
      hash: VIEWED_HASH,
    });

    expect(PermissionUtil.getProjectPermissionsHash(OWNED_PROJECT_ID)).toBe(
      OWNED_HASH,
    );
    expect(PermissionUtil.getProjectPermissionsHash(VIEWED_PROJECT_ID)).toBe(
      VIEWED_HASH,
    );
    expect(
      localStorage.getItem(
        getProjectPermissionsHashStorageKey(VIEWED_PROJECT_ID)!,
      ),
    ).toBe(VIEWED_HASH);
  });

  test("is not sent for a project whose snapshot is not kept: the server must send it", () => {
    localStorage.setItem(
      getProjectPermissionsHashStorageKey(OWNED_PROJECT_ID)!,
      OWNED_HASH,
    );

    expect(PermissionUtil.getProjectPermissionsHash(OWNED_PROJECT_ID)).toBe(
      null,
    );
  });

  test("a snapshot kept without one forgets the hash kept before, so the server sends it again", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT(), {
      hash: OWNED_HASH,
    });
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());

    expect(PermissionUtil.getProjectPermissionsHash(OWNED_PROJECT_ID)).toBe(
      null,
    );
    expect(PermissionUtil.getProjectPermissions(OWNED_PROJECT_ID)).not.toBe(
      null,
    );
  });

  test("is no answer for what is not a project", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT(), {
      hash: OWNED_HASH,
    });

    expect(PermissionUtil.getProjectPermissionsHash(null)).toBeNull();
    expect(PermissionUtil.getProjectPermissionsHash(undefined)).toBeNull();
    expect(PermissionUtil.getProjectPermissionsHash("")).toBeNull();
  });
});

describe("forgetting a project's snapshot", () => {
  test("forgets that project's snapshot and hash, never another tab's project", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT(), {
      hash: OWNED_HASH,
    });
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT(), {
      hash: VIEWED_HASH,
    });

    PermissionUtil.clearProjectPermissions(OWNED_PROJECT_ID);

    expect(PermissionUtil.getProjectPermissions(OWNED_PROJECT_ID)).toBeNull();
    expect(
      localStorage.getItem(
        getProjectPermissionsHashStorageKey(OWNED_PROJECT_ID)!,
      ),
    ).toBeNull();
    expect(PermissionUtil.getProjectPermissions(VIEWED_PROJECT_ID)).not.toBe(
      null,
    );
    expect(PermissionUtil.getProjectPermissionsHash(VIEWED_PROJECT_ID)).toBe(
      VIEWED_HASH,
    );
  });

  test("by default, forgets the project this tab shows", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT(), {
      hash: OWNED_HASH,
    });
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT(), {
      hash: VIEWED_HASH,
    });

    openTab(VIEWED_PROJECT_ID);
    PermissionUtil.clearProjectPermissions();

    expect(PermissionUtil.getProjectPermissions(VIEWED_PROJECT_ID)).toBeNull();
    expect(PermissionUtil.getProjectPermissions(OWNED_PROJECT_ID)).not.toBe(
      null,
    );
  });

  test("in a tab that shows no project, forgets nothing", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());
    window.history.replaceState(null, "", "/dashboard/welcome");

    PermissionUtil.clearProjectPermissions();

    expect(PermissionUtil.getProjectPermissions(OWNED_PROJECT_ID)).not.toBe(
      null,
    );
  });
});

describe("a storage that refuses (a private window, blocked or full site data)", () => {
  test("a snapshot that cannot be read reads as none, and nothing throws", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT());
    openTab(OWNED_PROJECT_ID);

    jest.spyOn(LocalStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(PermissionUtil.getProjectPermissions()).toBeNull();
    expect(PermissionUtil.getGlobalPermissions()).toBeNull();
    expect(PermissionUtil.getProjectPermissionsHash(OWNED_PROJECT_ID)).toBe(
      null,
    );
    expect(PermissionUtil.getGlobalPermissionsHash()).toBeNull();
    expect(createLabel()).toEqual({ isAllowed: false });
  });

  test("a full storage makes room by forgetting the other projects' snapshots, and keeps this one", () => {
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT(), {
      hash: VIEWED_HASH,
    });
    PermissionUtil.setProjectPermissions(
      snapshot(THIRD_PROJECT_ID, [Permission.ProjectAdmin]),
    );
    localStorage.setItem("user_id", "kept");

    const realSetItem: typeof LocalStorage.setItem = LocalStorage.setItem;
    let refusals: number = 0;

    jest
      .spyOn(LocalStorage, "setItem")
      .mockImplementation((key: string, value: unknown): void => {
        // Full until the other projects' snapshots are gone.
        if (
          refusals < 5 &&
          localStorage.getItem(
            getProjectPermissionsStorageKey(VIEWED_PROJECT_ID)!,
          ) !== null
        ) {
          refusals++;
          throw new Error("QuotaExceededError");
        }

        realSetItem(key, value as never);
      });

    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT(), {
      hash: OWNED_HASH,
    });

    expect(refusals).toBe(1);
    expect(PermissionUtil.getProjectPermissions(OWNED_PROJECT_ID)).not.toBe(
      null,
    );
    expect(PermissionUtil.getProjectPermissionsHash(OWNED_PROJECT_ID)).toBe(
      OWNED_HASH,
    );
    expect(PermissionUtil.getProjectPermissions(VIEWED_PROJECT_ID)).toBeNull();
    expect(PermissionUtil.getProjectPermissions(THIRD_PROJECT_ID)).toBeNull();
    expect(
      localStorage.getItem(
        getProjectPermissionsHashStorageKey(VIEWED_PROJECT_ID)!,
      ),
    ).toBeNull();
    // Only permission snapshots make room.
    expect(localStorage.getItem("user_id")).toBe("kept");
  });

  test("a snapshot that cannot be kept at all leaves nothing stale for its project, and does not throw", () => {
    PermissionUtil.setProjectPermissions(
      snapshot(OWNED_PROJECT_ID, [Permission.ProjectAdmin]),
      { hash: "an-older-hash" },
    );

    jest.spyOn(LocalStorage, "setItem").mockImplementation((): void => {
      throw new Error("QuotaExceededError");
    });

    expect(() => {
      PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT(), {
        hash: OWNED_HASH,
      });
    }).not.toThrow();

    expect(PermissionUtil.getProjectPermissions(OWNED_PROJECT_ID)).toBeNull();
    expect(
      localStorage.getItem(
        getProjectPermissionsHashStorageKey(OWNED_PROJECT_ID)!,
      ),
    ).toBeNull();
  });

  test("the global snapshot and its hash are kept as well as storage allows, and never throw", () => {
    jest.spyOn(LocalStorage, "setItem").mockImplementation((): void => {
      throw new Error("QuotaExceededError");
    });

    expect(() => {
      PermissionUtil.setGlobalPermissions({
        _type: "UserGlobalAccessPermission",
        globalPermissions: [Permission.CurrentUser],
        projectIds: [],
      });
      PermissionUtil.setGlobalPermissionsHash("global-hash");
    }).not.toThrow();
  });
});

describe("Danger Zone's delete of a project", () => {
  test("leaves the snapshot of a project another tab shows", () => {
    PermissionUtil.setProjectPermissions(OWNER_SNAPSHOT(), {
      hash: OWNED_HASH,
    });
    PermissionUtil.setProjectPermissions(VIEWER_SNAPSHOT(), {
      hash: VIEWED_HASH,
    });

    openTab(OWNED_PROJECT_ID, "settings/danger-zone");
    expect(
      PermissionGate.check(new Project(), ModelAction.Delete).isAllowed,
    ).toBe(true);

    // What the page does once the delete went through.
    PermissionUtil.clearProjectPermissions(new ObjectID(OWNED_PROJECT_ID));

    openTab(VIEWED_PROJECT_ID);
    expect(heldInTab()).toEqual([Permission.Viewer, Permission.ProjectUser]);
    expect(PermissionUtil.getProjectPermissionsHash(VIEWED_PROJECT_ID)).toBe(
      VIEWED_HASH,
    );
  });
});
