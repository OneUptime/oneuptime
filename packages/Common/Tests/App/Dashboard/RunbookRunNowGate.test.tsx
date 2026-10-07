import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import RunbookOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Index";
import {
  getRunbookRunGate,
  getRunbookRunLockedReason,
  RunbookRunCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookRunGate";
import Route from "../../../Types/API/Route";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import {
  RUNBOOK_RUN_PERMISSIONS,
  RUNBOOK_RUN_REFUSED_MESSAGE,
} from "../../../Types/Runbook/RunbookRunPermissions";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import { getJestSpyOn } from "../../Spy";

/*
 * RUN NOW, FOR THE ROLES THAT RUN RUNBOOKS.
 *
 * A runbook's page offered Run Now to everyone who could open it. A Runbook
 * Viewer or a Viewer clicked it and the server refused. Now the button is
 * locked for whoever holds none of the run permissions
 * (Types/Runbook/RunbookRunPermissions), saying why in the server's words
 * and what would let them - and only once the permission snapshot has
 * landed: before that nobody is told anything and the server decides. A
 * Runbook Member, who runs runbooks and builds none, keeps the button.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUNBOOK_ID: ObjectID = ObjectID.generate();

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
];

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

interface CardButton {
  title: string;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  onClick?: (() => void) | undefined;
}

let lastCardProps: { buttons?: Array<CardButton> } | null = null;

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: {
      cardProps: { buttons?: Array<CardButton> };
    }): ReactElement => {
      lastCardProps = props.cardProps;
      return <div data-testid="runbook-overview" />;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 0 };
      },
      count: async () => {
        return 0;
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async () => {
        return { data: {} };
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

interface Row {
  permission: Permission;
  isBlockPermission?: boolean | undefined;
}

function grant(rows: Array<Row>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);

  const all: Array<Row> = rows.length
    ? [
        ...BASE_PERMISSIONS.map((permission: Permission): Row => {
          return { permission };
        }),
        ...rows,
      ]
    : [];

  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(
    all
      .filter((row: Row): boolean => {
        return !row.isBlockPermission;
      })
      .map((row: Row): Permission => {
        return row.permission;
      }),
  );
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(
    (all.length
      ? {
          projectId: PROJECT_ID,
          userId: ObjectID.generate(),
          permissions: all.map((row: Row) => {
            return {
              permission: row.permission,
              labelIds: [],
              isBlockPermission: Boolean(row.isBlockPermission),
              _type: "UserPermission",
            };
          }),
          _type: "UserTenantAccessPermission",
        }
      : null) as unknown as ReturnType<
      typeof PermissionUtil.getProjectPermissions
    >,
  );
}

function roles(...permissions: Array<Permission>): Array<Row> {
  return permissions.map((permission: Permission): Row => {
    return { permission };
  });
}

function lockedReason(): string {
  return `${RunbookRunCopy.runRefused} You need one of these permissions: ${PermissionHelper.getPermissionTitles(
    [...RUNBOOK_RUN_PERMISSIONS],
  ).join(", ")}.`;
}

async function openRunbook(): Promise<CardButton> {
  render(
    <RunbookOverview
      pageRoute={new Route("/runbooks/view")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  await waitFor(() => {
    expect(lastCardProps).not.toBeNull();
  });

  const buttons: Array<CardButton> = (lastCardProps!.buttons || []).filter(
    (button: CardButton): boolean => {
      return button.title === "Run Now";
    },
  );

  expect(buttons).toHaveLength(1);

  return buttons[0]!;
}

beforeEach(() => {
  jest.restoreAllMocks();
  lastCardProps = null;
  PermissionGate.clearPermissionPropsCache();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    RUNBOOK_ID,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the gate", () => {
  it("opens with the server's own refusal, word for word", () => {
    expect(RunbookRunCopy.runRefused).toBe(RUNBOOK_RUN_REFUSED_MESSAGE);
  });

  it.each([...RUNBOOK_RUN_PERMISSIONS])(
    "lets %s run",
    (permission: Permission) => {
      expect(
        getRunbookRunGate({ permissions: [...BASE_PERMISSIONS, permission] }),
      ).toEqual({ isAllowed: true });
    },
  );

  it.each([
    Permission.RunbookViewer,
    Permission.Viewer,
    Permission.ReadRunbook,
    Permission.EditRunbookExecution,
    Permission.IncidentMember,
  ])("tells %s what it takes", (permission: Permission) => {
    expect(
      getRunbookRunLockedReason(
        getRunbookRunGate({ permissions: [...BASE_PERMISSIONS, permission] }),
      ),
    ).toBe(lockedReason());
  });

  it("allows a run exactly when the server's rule would", () => {
    const sets: Array<Array<Permission>> = [
      [Permission.ProjectOwner],
      [Permission.ProjectAdmin],
      [Permission.ProjectMember],
      [Permission.Viewer],
      [Permission.RunbookAdmin],
      [Permission.RunbookMember],
      [Permission.RunbookViewer],
      [Permission.CreateRunbookExecution],
      [Permission.EditRunbookExecution],
      [Permission.Viewer, Permission.RunbookMember],
      [Permission.RunbookViewer, Permission.ReadRunbook],
      [Permission.BillingAdmin],
    ];

    for (const permissions of sets) {
      PermissionGate.clearPermissionPropsCache();

      expect({
        permissions,
        allowed: getRunbookRunGate({
          permissions: [...BASE_PERMISSIONS, ...permissions],
        }).isAllowed,
      }).toEqual({
        permissions,
        allowed: HeldPermissionsUtil.holdsAnyOf(
          HeldPermissionsUtil.fromPermissions(permissions),
          RUNBOOK_RUN_PERMISSIONS,
        ),
      });
    }
  });

  it("a team's block on Runbook Member takes the button away, naming the block", () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);

    const reason: string | undefined = getRunbookRunLockedReason(
      getRunbookRunGate({
        held: {
          allowed: [Permission.RunbookMember],
          allowedProjectWide: [Permission.RunbookMember],
          blocked: [Permission.RunbookMember],
          blockedForSomeLabels: [],
        },
      }),
    );

    expect(reason).toContain(RunbookRunCopy.runRefused);
    expect(reason).toContain("Runbook Member");
  });

  it("every Dashboard language has the sentence, translated", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      );
      const value: string | undefined = locale[RunbookRunCopy.runRefused];

      expect([file, typeof value]).toEqual([file, "string"]);
      expect([file, value!.trim().length > 0]).toEqual([file, true]);

      if (file === "en.json") {
        expect(value).toBe(RunbookRunCopy.runRefused);
      } else {
        expect([file, value === RunbookRunCopy.runRefused]).toEqual([
          file,
          false,
        ]);
      }
    }
  });
});

describe("a runbook's page", () => {
  it.each([Permission.RunbookViewer, Permission.Viewer])(
    "%s sees Run Now locked, saying why and who may",
    async (permission: Permission) => {
      grant(roles(permission));

      const runNow: CardButton = await openRunbook();

      expect(runNow.disabled).toBe(true);
      expect(runNow.tooltip).toBe(lockedReason());
    },
  );

  it.each([
    Permission.RunbookMember,
    Permission.RunbookAdmin,
    Permission.ProjectMember,
    Permission.ProjectOwner,
    Permission.CreateRunbookExecution,
  ])("%s gets Run Now as before", async (permission: Permission) => {
    grant(roles(permission));

    const runNow: CardButton = await openRunbook();

    expect(runNow.disabled).toBe(false);
    expect(runNow.tooltip).toBeUndefined();
  });

  it("a Runbook Member a team blocks from running sees it locked", async () => {
    grant([
      { permission: Permission.RunbookMember },
      { permission: Permission.RunbookMember, isBlockPermission: true },
    ]);

    const runNow: CardButton = await openRunbook();

    expect(runNow.disabled).toBe(true);
    expect(runNow.tooltip).toContain(RunbookRunCopy.runRefused);
  });

  it("before the permission snapshot lands nothing is locked: the server decides", async () => {
    grant([]);

    const runNow: CardButton = await openRunbook();

    expect(runNow.disabled).toBe(false);
    expect(runNow.tooltip).toBeUndefined();
  });
});
