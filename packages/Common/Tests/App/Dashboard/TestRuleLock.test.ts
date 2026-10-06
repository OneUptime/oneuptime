import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Test Rule" on a Slack or Microsoft Teams notification rule posts a test
 * message into the rule's channels. The server asks the permission a
 * channel's own Send Test asks - could create a notification rule
 * (WorkspaceNotificationRuleAPI, WorkspaceNotificationRuleTestSend.test.ts) -
 * so the rule's row asks it too: someone the dashboard knows may not gets
 * the button locked, saying what it takes, rather than a dialog whose Test
 * is refused. Someone it does not know yet (the permissions not loaded)
 * keeps the button, and the server decides. A team block on creating rules
 * counts as the server counts it: a block of the whole table locks the
 * button, and a block row is never a grant.
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

import {
  getTestRuleLock,
  TEST_RULE_LOCKED_TOOLTIP,
  TestRuleLock,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/TestRuleLock";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

// What the dashboard holds for someone signed in: these, and the automatic ones.
const lockFor: (permissions: Array<Permission>) => TestRuleLock = (
  permissions: Array<Permission>,
): TestRuleLock => {
  return getTestRuleLock({
    permissions: [Permission.CurrentUser, Permission.Public, ...permissions],
  });
};

beforeEach(() => {
  isMasterAdminForTest = false;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Test Rule's lock", () => {
  test.each([
    ["Project Owner", Permission.ProjectOwner],
    ["Project Admin", Permission.ProjectAdmin],
    ["Project Member", Permission.ProjectMember],
    ["Settings Admin", Permission.SettingsAdmin],
    ["Settings Member", Permission.SettingsMember],
    [
      "Create Workspace Notification Rule",
      Permission.CreateWorkspaceNotificationRule,
    ],
  ])(
    "%s may send a test: the button works",
    (_role: string, permission: Permission) => {
      expect(lockFor([permission])).toEqual({ isLocked: false });
    },
  );

  test.each([
    ["Viewer", Permission.Viewer],
    ["Settings Viewer", Permission.SettingsViewer],
    [
      "Read Workspace Notification Rule",
      Permission.ReadWorkspaceNotificationRule,
    ],
    [
      "Edit Workspace Notification Rule",
      Permission.EditWorkspaceNotificationRule,
    ],
  ])(
    "%s may not: the button is locked and says what it takes",
    (_role: string, permission: Permission) => {
      expect(lockFor([permission])).toEqual({
        isLocked: true,
        tooltip: TEST_RULE_LOCKED_TOOLTIP,
      });
    },
  );

  test("the tooltip says it plainly", () => {
    expect(TEST_RULE_LOCKED_TOOLTIP).toBe(
      "Sending a test needs permission to create notification rules.",
    );
  });

  test("the lock asks exactly the server's permission: every one that may create a rule may send a test", () => {
    const createPermissions: Array<Permission> =
      new WorkspaceNotificationRule().getCreatePermissions();

    expect(createPermissions.length).toBeGreaterThan(0);

    for (const permission of createPermissions) {
      expect([permission, lockFor([permission]).isLocked]).toEqual([
        permission,
        false,
      ]);
    }
  });

  test("while the permissions are not loaded, nobody is told they may not: the server decides", () => {
    expect(getTestRuleLock({ permissions: [] })).toEqual({ isLocked: false });
  });

  test("a master admin may", () => {
    isMasterAdminForTest = true;

    expect(lockFor([])).toEqual({ isLocked: false });
  });
});

describe("Test Rule's lock, from the permissions the dashboard stores", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "7b000000-0000-4000-8000-000000000001",
  );
  const LABEL_ID: ObjectID = new ObjectID(
    "7b000000-0000-4000-8000-000000000002",
  );

  const row: (
    permission: Permission,
    isBlockPermission: boolean,
    labelIds?: Array<ObjectID>,
  ) => UserPermission = (
    permission: Permission,
    isBlockPermission: boolean,
    labelIds?: Array<ObjectID>,
  ): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: labelIds || [],
      isBlockPermission: isBlockPermission,
    };
  };

  // What the API's permission headers leave in storage for this project.
  const storeSnapshot: (rows: Array<UserPermission>) => void = (
    rows: Array<UserPermission>,
  ): void => {
    PermissionUtil.setGlobalPermissions({
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.CurrentUser],
    });

    PermissionUtil.setProjectPermissions({
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: rows,
    });
  };

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("a Project Member: the button works", () => {
    storeSnapshot([row(Permission.ProjectMember, false)]);

    expect(getTestRuleLock()).toEqual({ isLocked: false });
  });

  test("a Project Member whose team blocks creating rules: locked, as the server refuses the send", () => {
    storeSnapshot([
      row(Permission.ProjectMember, false),
      row(Permission.CreateWorkspaceNotificationRule, true),
    ]);

    expect(getTestRuleLock()).toEqual({
      isLocked: true,
      tooltip: TEST_RULE_LOCKED_TOOLTIP,
    });
  });

  test.each(new WorkspaceNotificationRule().getCreatePermissions())(
    "a block of the whole table on %s, one of the permissions that create a rule: locked",
    (blocked: Permission) => {
      storeSnapshot([row(Permission.ProjectAdmin, false), row(blocked, true)]);

      expect(getTestRuleLock().isLocked).toBe(true);
    },
  );

  test("a block with labels blocks those labels' records, not the table: the button works, as the server sends", () => {
    storeSnapshot([
      row(Permission.ProjectMember, false),
      row(Permission.CreateWorkspaceNotificationRule, true, [LABEL_ID]),
    ]);

    expect(getTestRuleLock()).toEqual({ isLocked: false });
  });

  test("a block row is no grant: a Viewer whose team has one on creating rules is locked", () => {
    storeSnapshot([
      row(Permission.Viewer, false),
      row(Permission.CreateWorkspaceNotificationRule, true, [LABEL_ID]),
    ]);

    expect(getTestRuleLock()).toEqual({
      isLocked: true,
      tooltip: TEST_RULE_LOCKED_TOOLTIP,
    });
  });

  test("a block on something other than creating rules does not lock it", () => {
    storeSnapshot([
      row(Permission.ProjectMember, false),
      row(Permission.DeleteWorkspaceNotificationRule, true),
    ]);

    expect(getTestRuleLock()).toEqual({ isLocked: false });
  });

  test("a master admin is never blocked", () => {
    isMasterAdminForTest = true;

    storeSnapshot([
      row(Permission.Viewer, false),
      row(Permission.CreateWorkspaceNotificationRule, true),
    ]);

    expect(getTestRuleLock()).toEqual({ isLocked: false });
  });

  test("nothing stored yet - the permissions not loaded: the button works, and the server decides", () => {
    expect(getTestRuleLock()).toEqual({ isLocked: false });
  });

  test("a snapshot handed in is read the same way as the stored one", () => {
    expect(
      getTestRuleLock({
        permissions: [Permission.CurrentUser, Permission.ProjectMember],
        projectPermissions: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [row(Permission.CreateWorkspaceNotificationRule, true)],
        },
      }),
    ).toEqual({ isLocked: true, tooltip: TEST_RULE_LOCKED_TOOLTIP });
  });
});

describe("the rules table's Test Rule action", () => {
  const table: string = fs.readFileSync(
    path.join(
      DASHBOARD_SRC,
      "Components/Workspace/WorkspaceNotificationRulesTable.tsx",
    ),
    "utf8",
  );

  test("is locked by the lock, with its tooltip", () => {
    expect(table).toContain(
      "const testRuleLock: TestRuleLock = getTestRuleLock();",
    );

    const action: string = table.slice(
      table.indexOf('title: "Test Rule"'),
      table.indexOf("onClick:", table.indexOf('title: "Test Rule"')),
    );

    expect(action).toContain("disabled: testRuleLock.isLocked,");
    expect(action).toContain("tooltip: testRuleLock.tooltip,");
  });
});

describe("the tooltip in every Dashboard language", () => {
  const localesDir: string = path.join(DASHBOARD_SRC, "Locales");
  const locales: Array<string> = fs
    .readdirSync(localesDir)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  test("there are 17 locales", () => {
    expect(locales).toHaveLength(17);
  });

  test("every locale has it, and every one but English has it translated", () => {
    for (const file of locales) {
      const strings: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(localesDir, file), "utf8"),
      ) as Record<string, unknown>;
      const value: unknown = strings[TEST_RULE_LOCKED_TOOLTIP];

      expect([file, typeof value]).toEqual([file, "string"]);

      if (file === "en.json") {
        expect(value).toBe(TEST_RULE_LOCKED_TOOLTIP);
      } else {
        expect([file, value === TEST_RULE_LOCKED_TOOLTIP]).toEqual([
          file,
          false,
        ]);
      }
    }
  });
});
