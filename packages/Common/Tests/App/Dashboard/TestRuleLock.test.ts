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
 * keeps the button, and the server decides.
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
import Permission from "../../../Types/Permission";

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
