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
 * Every Send Test button in the Dashboard - Test Rule, a summary's Send Test
 * Now, a Slack or Teams channel's or chat's Send Test, Send Test Email on an
 * SMTP config, Send Test SMS and Send Test Call on a Twilio config, and a
 * status page's Send Test Report - asks what the server asks before it sends
 * (Common/Server/API/TestSendAccess): on OneUptime Cloud the plan the
 * feature is sold on, and permission to create what is tested (for the test
 * report, to switch the page's reports on). For someone the dashboard knows
 * may not send, the button is locked, and its tooltip says in one plain
 * sentence what it takes - the plan first, as the server asks it first.
 * Someone it does not know about yet (the permissions or the plan not
 * loaded) keeps the button, and the server decides. A team's block row is
 * never a grant, and a block with no labels takes the permission away.
 */

let isMasterAdminForTest: boolean = false;
let billingEnabledForTest: boolean = false;
let currentPlanForTest: string | null = null;

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,priceMonthlyId1,priceYearlyId1,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH: "Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",
  SUBSCRIPTION_PLAN_SCALE: "Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,priceMonthlyId4,priceYearlyId4,-1,-1,4,14",
};

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

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };

  return mocked;
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): string => {
        return "7b000000-0000-4000-8000-000000000001";
      },
      getCurrentPlan: (): string | null => {
        return currentPlanForTest;
      },
    },
  };
});

import {
  getTestSendLock,
  TEST_SEND_LOCKED_TOOLTIPS,
  TEST_SEND_PLAN_TOOLTIP,
  TestSendLock,
  TestSendTarget,
  TestSendTargets,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TestSend/TestSendLock";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000001",
);
const LABEL_ID: ObjectID = new ObjectID("7b000000-0000-4000-8000-000000000002");

interface TargetCase {
  name: string;
  target: TestSendTarget;
  tooltip: string;
  // Who may send it, and who - though they may see it - may not.
  mayPermissions: Array<Permission>;
  mayNotPermissions: Array<Permission>;
  // The permissions the server's own create (or update) list names.
  serverPermissions: () => Array<Permission>;
  // A permission whose team block takes it away.
  blockable: Permission;
}

const TARGETS: Array<TargetCase> = [
  {
    name: "Test Rule, and a channel's or chat's Send Test",
    target: TestSendTargets.NotificationRule,
    tooltip: TEST_SEND_LOCKED_TOOLTIPS.notificationRule,
    mayPermissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    mayNotPermissions: [
      Permission.Viewer,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRule,
      Permission.EditWorkspaceNotificationRule,
    ],
    serverPermissions: (): Array<Permission> => {
      return new WorkspaceNotificationRule().getCreatePermissions();
    },
    blockable: Permission.CreateWorkspaceNotificationRule,
  },
  {
    name: "a summary's Send Test Now",
    target: TestSendTargets.Summary,
    tooltip: TEST_SEND_LOCKED_TOOLTIPS.summary,
    mayPermissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    mayNotPermissions: [
      Permission.Viewer,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.EditWorkspaceNotificationSummary,
    ],
    serverPermissions: (): Array<Permission> => {
      return new WorkspaceNotificationSummary().getCreatePermissions();
    },
    blockable: Permission.CreateWorkspaceNotificationSummary,
  },
  {
    name: "Send Test Email on an SMTP config",
    target: TestSendTargets.SmtpConfig,
    tooltip: TEST_SEND_LOCKED_TOOLTIPS.smtpConfig,
    mayPermissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectSMTPConfig,
    ],
    mayNotPermissions: [
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.ReadProjectSMTPConfig,
      Permission.EditProjectSMTPConfig,
    ],
    serverPermissions: (): Array<Permission> => {
      return new ProjectSmtpConfig().getCreatePermissions();
    },
    blockable: Permission.CreateProjectSMTPConfig,
  },
  {
    name: "Send Test SMS and Send Test Call on a Twilio config",
    target: TestSendTargets.TwilioConfig,
    tooltip: TEST_SEND_LOCKED_TOOLTIPS.twilioConfig,
    mayPermissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectCallSMSConfig,
    ],
    mayNotPermissions: [
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProjectCallSMSConfig,
      Permission.EditProjectCallSMSConfig,
    ],
    serverPermissions: (): Array<Permission> => {
      return new ProjectCallSMSConfig().getCreatePermissions();
    },
    blockable: Permission.CreateProjectCallSMSConfig,
  },
  {
    name: "a status page's Send Test Report",
    target: TestSendTargets.StatusPageReport,
    tooltip: TEST_SEND_LOCKED_TOOLTIPS.statusPageReport,
    mayPermissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditProjectStatusPage,
    ],
    mayNotPermissions: [
      Permission.Viewer,
      Permission.StatusPageViewer,
      Permission.ReadProjectStatusPage,
      Permission.CreateProjectStatusPage,
    ],
    serverPermissions: (): Array<Permission> => {
      return new StatusPage().getUpdatePermissions();
    },
    blockable: Permission.EditProjectStatusPage,
  },
];

// What the dashboard holds for someone signed in: these, and the automatic ones.
const lockFor: (
  target: TestSendTarget,
  permissions: Array<Permission>,
) => TestSendLock = (
  target: TestSendTarget,
  permissions: Array<Permission>,
): TestSendLock => {
  return getTestSendLock(target, {
    permissions: [Permission.CurrentUser, Permission.Public, ...permissions],
  });
};

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
  isMasterAdminForTest = false;
  billingEnabledForTest = false;
  currentPlanForTest = null;
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe.each(TARGETS)("$name: who may send it", (targetCase: TargetCase) => {
  test.each(targetCase.mayPermissions)(
    "%s: the button works",
    (permission: Permission) => {
      expect(lockFor(targetCase.target, [permission])).toEqual({
        isLocked: false,
      });
    },
  );

  test.each(targetCase.mayNotPermissions)(
    "%s: locked, and the tooltip says what it takes",
    (permission: Permission) => {
      expect(lockFor(targetCase.target, [permission])).toEqual({
        isLocked: true,
        tooltip: targetCase.tooltip,
      });
    },
  );

  test("the lock asks exactly the server's permission: every one the server accepts may send", () => {
    const serverPermissions: Array<Permission> = targetCase.serverPermissions();

    expect(serverPermissions.length).toBeGreaterThan(0);

    for (const permission of serverPermissions) {
      expect([
        permission,
        lockFor(targetCase.target, [permission]).isLocked,
      ]).toEqual([permission, false]);
    }
  });

  test("while the permissions are not loaded, nobody is told they may not: the server decides", () => {
    expect(getTestSendLock(targetCase.target, { permissions: [] })).toEqual({
      isLocked: false,
    });
  });

  test("a master admin may", () => {
    isMasterAdminForTest = true;

    expect(lockFor(targetCase.target, [])).toEqual({ isLocked: false });
  });

  test("a team's block of the whole table on what it takes: locked, as the server refuses", () => {
    storeSnapshot([
      row(Permission.ProjectOwner, false),
      row(targetCase.blockable, true),
    ]);

    expect(getTestSendLock(targetCase.target)).toEqual({
      isLocked: true,
      tooltip: targetCase.tooltip,
    });
  });

  test("a block row is no grant: someone who may only look, with a block on what it takes, is locked", () => {
    storeSnapshot([
      row(Permission.Viewer, false),
      row(targetCase.blockable, true, [LABEL_ID]),
    ]);

    expect(getTestSendLock(targetCase.target).isLocked).toBe(true);
  });

  test("a snapshot handed in is read the same way as the stored one", () => {
    expect(
      getTestSendLock(targetCase.target, {
        held: HeldPermissionsUtil.fromRows({
          rows: [
            row(Permission.ProjectOwner, false),
            row(targetCase.blockable, true),
          ],
          globalPermissions: [Permission.CurrentUser],
        }),
      }),
    ).toEqual({ isLocked: true, tooltip: targetCase.tooltip });
  });
});

describe("the plan, on OneUptime Cloud", () => {
  test.each(TARGETS)(
    "$name: below the plan it is sold on, locked with the plan's name, before any permission is asked",
    (targetCase: TargetCase) => {
      billingEnabledForTest = true;
      currentPlanForTest = PlanType.Free;

      const lock: TestSendLock = lockFor(targetCase.target, [
        Permission.ProjectOwner,
      ]);

      expect(lock).toEqual({
        isLocked: true,
        tooltip: "Sending a test needs the Growth plan.",
      });

      // A Viewer below the plan is told the plan, as the server tells them.
      expect(lockFor(targetCase.target, [Permission.Viewer]).tooltip).toBe(
        "Sending a test needs the Growth plan.",
      );
    },
  );

  test.each(TARGETS)(
    "$name: on the plan, the button works",
    (targetCase: TargetCase) => {
      billingEnabledForTest = true;

      for (const plan of [
        PlanType.Growth,
        PlanType.Scale,
        PlanType.Enterprise,
      ]) {
        currentPlanForTest = plan;

        expect(lockFor(targetCase.target, [Permission.ProjectOwner])).toEqual({
          isLocked: false,
        });
      }
    },
  );

  test.each(TARGETS)(
    "$name: while the plan is not known, nobody is told it is missing",
    (targetCase: TargetCase) => {
      billingEnabledForTest = true;
      currentPlanForTest = null;

      expect(lockFor(targetCase.target, [Permission.ProjectOwner])).toEqual({
        isLocked: false,
      });
    },
  );

  test.each(TARGETS)(
    "$name: with billing off (self-hosted) no plan is asked",
    (targetCase: TargetCase) => {
      billingEnabledForTest = false;
      currentPlanForTest = PlanType.Free;

      expect(lockFor(targetCase.target, [Permission.ProjectOwner])).toEqual({
        isLocked: false,
      });
    },
  );

  test("the plan each asks is the one the server asks", () => {
    expect(TestSendTargets.NotificationRule.getRequiredPlan()).toBe(
      new WorkspaceNotificationRule().getCreateBillingPlan(),
    );
    expect(TestSendTargets.Summary.getRequiredPlan()).toBe(
      new WorkspaceNotificationSummary().getCreateBillingPlan(),
    );
    expect(TestSendTargets.SmtpConfig.getRequiredPlan()).toBe(
      new ProjectSmtpConfig().getCreateBillingPlan(),
    );
    expect(TestSendTargets.TwilioConfig.getRequiredPlan()).toBe(
      new ProjectCallSMSConfig().getCreateBillingPlan(),
    );
    expect(TestSendTargets.StatusPageReport.getRequiredPlan()).toBe(
      new StatusPage().getColumnBillingAccessControl("isReportEnabled").update,
    );

    for (const targetCase of TARGETS) {
      expect(targetCase.target.getRequiredPlan()).toBe(PlanType.Growth);
    }
  });

  test("a master admin below the plan is locked too: the server holds them to it", () => {
    isMasterAdminForTest = true;
    billingEnabledForTest = true;
    currentPlanForTest = PlanType.Free;

    expect(
      getTestSendLock(TestSendTargets.NotificationRule, { permissions: [] })
        .isLocked,
    ).toBe(true);
  });
});

describe("the tooltips: one plain sentence each", () => {
  test("they say what it takes", () => {
    expect(TEST_SEND_LOCKED_TOOLTIPS).toEqual({
      notificationRule:
        "Sending a test needs permission to create notification rules.",
      summary: "Sending a test needs permission to create summaries.",
      smtpConfig: "Sending a test needs permission to create SMTP configs.",
      twilioConfig: "Sending a test needs permission to create Twilio configs.",
      statusPageReport:
        "Sending a test report needs permission to edit this status page.",
    });
    expect(TEST_SEND_PLAN_TOOLTIP).toBe(
      "Sending a test needs the {{planName}} plan.",
    );
  });

  const localesDir: string = path.join(DASHBOARD_SRC, "Locales");
  const locales: Array<string> = fs
    .readdirSync(localesDir)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  test("there are 17 locales", () => {
    expect(locales).toHaveLength(17);
  });

  test("every locale has every one, and every locale but English has them translated", () => {
    const keys: Array<string> = [
      ...Object.values(TEST_SEND_LOCKED_TOOLTIPS),
      TEST_SEND_PLAN_TOOLTIP,
    ];

    for (const file of locales) {
      const strings: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(localesDir, file), "utf8"),
      ) as Record<string, unknown>;

      for (const key of keys) {
        const value: unknown = strings[key];

        expect([file, key, typeof value]).toEqual([file, key, "string"]);

        if (file === "en.json") {
          expect(value).toBe(key);
        } else {
          expect([file, key, value === key]).toEqual([file, key, false]);
        }

        // The plan's name goes where each language puts it.
        if (key === TEST_SEND_PLAN_TOOLTIP) {
          expect([file, (value as string).includes("{{planName}}")]).toEqual([
            file,
            true,
          ]);
        }
      }
    }
  });
});

describe("every Send Test button in the Dashboard is locked by the lock", () => {
  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(path.join(DASHBOARD_SRC, file), "utf8");
  };

  // Each table's action: locked by its lock, with its tooltip.
  test.each([
    [
      "Components/Workspace/WorkspaceNotificationRulesTable.tsx",
      "Test Rule",
      "testRuleLock",
      "NotificationRule",
    ],
    [
      "Components/Workspace/WorkspaceSummaryTable.tsx",
      "Send Test Now",
      "testSummaryLock",
      "Summary",
    ],
    [
      "Components/CustomSMTP/CustomSMTPTable.tsx",
      "Send Test Email",
      "testEmailLock",
      "SmtpConfig",
    ],
    [
      "Components/CallSMS/CallSMSConfigTable.tsx",
      "Send Test SMS",
      "testSendLock",
      "TwilioConfig",
    ],
    [
      "Components/CallSMS/CallSMSConfigTable.tsx",
      "Send Test Call",
      "testSendLock",
      "TwilioConfig",
    ],
  ])(
    "%s: %s",
    (file: string, title: string, lockName: string, target: string) => {
      const source: string = read(file);

      expect(source).toContain(
        `getTestSendLock(\n    TestSendTargets.${target},`,
      );

      const action: string = source.slice(
        source.indexOf(`title: "${title}"`),
        source.indexOf("onClick:", source.indexOf(`title: "${title}"`)),
      );

      expect(action).toContain(`disabled: ${lockName}.isLocked,`);
      expect(action).toContain(`tooltip: ${lockName}.tooltip,`);
    },
  );

  test("a channel's or chat's Send Test button is locked by the rule's lock", () => {
    const source: string = read(
      "Components/Workspace/SendTestNotificationButton.tsx",
    );

    expect(source).toContain(
      "getTestSendLock(TestSendTargets.NotificationRule)",
    );
    expect(source).toContain(
      'disabled={status === "sending" || lock.isLocked}',
    );
    expect(source).toContain(
      "tooltip={lock.isLocked ? lock.tooltip : undefined}",
    );
  });

  test("a status page's Send Test Report is locked by the report's lock", () => {
    const source: string = read("Pages/StatusPages/View/Reports.tsx");

    expect(source).toContain("TestSendTargets.StatusPageReport");
    expect(source).toContain("disabled: testReportLock.isLocked,");
    expect(source).toContain("tooltip: testReportLock.tooltip,");
  });

  /*
   * Every Dashboard file that reaches a test route draws its button through
   * the lock - a new Send Test cannot skip it.
   */
  test("every file that reaches a test route uses the lock", () => {
    const TEST_ROUTES: Array<string> = [
      "/workspace-notification-rule/test/",
      "/workspace-notification-summary/test/",
      "/smtp-config/test",
      "/sms/test",
      "/call/test",
      "/test-email-report",
      "/slack/channels/test",
      "/microsoft-teams/channels/test",
      "/microsoft-teams/chats/test",
    ];

    const files: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          files.push(full);
        }
      }
    };

    walk(DASHBOARD_SRC);

    // A route named in a comment reaches nothing.
    const withoutComments: (source: string) => string = (
      source: string,
    ): string => {
      return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    };

    const reaching: Array<string> = files.filter((file: string): boolean => {
      const source: string = withoutComments(fs.readFileSync(file, "utf8"));

      return TEST_ROUTES.some((route: string): boolean => {
        return source.includes(route);
      });
    });

    expect(reaching.length).toBeGreaterThanOrEqual(8);

    for (const file of reaching) {
      const source: string = fs.readFileSync(file, "utf8");
      const relative: string = path.relative(DASHBOARD_SRC, file);

      // The lock itself, or the one button that holds it for channels.
      const usesLock: boolean =
        source.includes("getTestSendLock(") ||
        source.includes("<SendTestNotificationButton");

      expect([relative, usesLock]).toEqual([relative, true]);
    }
  });
});
