import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import GlobalUserOverrideAccess from "../../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MOBILE APP'S COPY OF WHO MAY ADD A GLOBAL USER OVERRIDE SAYS WHAT THE
 * SERVER'S SAYS, CASE FOR CASE.
 *
 * Cover arranged in the app is a global override, which since issue #5617
 * takes a permission to add overrides over the whole project
 * (GlobalUserOverrideAccess, enforced in OnCallDutyPolicyUserOverrideService).
 * The app is built without Common's runtime code, so it keeps its own copy of
 * the rule (MobileApp/src/oncall/globalOverrideAccess) and reads the person's
 * rows from the `project-permissions` header each answer carries. A copy
 * drifts, and every drift is silent: the sheet would offer cover the server
 * refuses, or lock it for someone the server lets add it.
 *
 * So this suite compiles the app's file as it is, runs it in a fresh context,
 * and asks it and the server's rule about thousands of generated rows - every
 * permission that adds an override and some that do not, every scope, with
 * labels and without, allows and blocks - each written into a header as the
 * server writes it (UserAuthorization: JSON.stringify of
 * JSONFunctions.serialize) and read back by the app. Any answer that differs
 * fails here, whichever side moved.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const MOBILE_RULE_FILE: string = path.join(
  REPOSITORY_ROOT,
  "packages/MobileApp/src/oncall/globalOverrideAccess.ts",
);

type MobileAccess = "allowed" | "limited" | "not-allowed" | "unknown";

interface MobileRow {
  permission: string;
  labelIds?: ReadonlyArray<unknown> | null;
  scope?: string | null;
  isBlockPermission?: boolean | null;
}

interface MobileRule {
  USER_OVERRIDE_CREATE_PERMISSIONS: ReadonlyArray<string>;
  getGlobalOverrideAccess: (data: {
    rows: ReadonlyArray<MobileRow> | null;
    isMasterAdmin: boolean;
  }) => MobileAccess;
  readProjectPermissionRows: (
    header: unknown,
    projectId: string,
  ) => Array<MobileRow> | null;
}

// The app's file compiled to CommonJS as it is and run in a fresh context.
function loadMobileRule(): MobileRule {
  const source: string = fs.readFileSync(MOBILE_RULE_FILE, "utf8");

  const compiled: string = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: "globalOverrideAccess.ts",
  }).outputText;

  const moduleObject: { exports: Record<string, unknown> } = { exports: {} };

  vm.runInNewContext(compiled, {
    module: moduleObject,
    exports: moduleObject.exports,
    require: (specifier: string): never => {
      throw new Error(
        `The app's globalOverrideAccess.ts imports ${specifier}: it must import nothing, so this suite can run it as it is.`,
      );
    },
  });

  return moduleObject.exports as unknown as MobileRule;
}

const MOBILE: MobileRule = loadMobileRule();

const MODEL: OnCallDutyPolicyUserOverride = new OnCallDutyPolicyUserOverride();
const CREATE_PERMISSIONS: Array<Permission> =
  MODEL.getCreatePermissions() || [];

// What the server attaches to every person, everywhere (AccessTokenService).
const GLOBAL_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const PROJECT_ID: string = "0d520000-0000-4000-8000-000000000001";
const LABELS: Array<string> = [
  "0d520000-0000-4000-8000-0000000000e1",
  "0d520000-0000-4000-8000-0000000000e2",
];
const TEAM_ID: string = "0d520000-0000-4000-8000-0000000000f1";

/*
 * Every permission that adds an override, and some that do not: roles no
 * scope narrows (Settings, Billing), roles that only read, and the
 * override's own read and delete permissions.
 */
const PERMISSIONS: Array<Permission> = [
  ...CREATE_PERMISSIONS,
  Permission.Viewer,
  Permission.OnCallViewer,
  Permission.ReadOnCallDutyPolicyUserOverride,
  Permission.DeleteOnCallDutyPolicyUserOverride,
  Permission.SettingsAdmin,
  Permission.BillingViewer,
];

const SCOPES: Array<PermissionScope | undefined> = [
  PermissionScope.All,
  PermissionScope.Owned,
  PermissionScope.Labels,
  undefined,
];

// The server's answer, in the app's words.
function serverAccess(rows: Array<UserPermission>): MobileAccess {
  const held: HeldPermissions = HeldPermissionsUtil.fromRows({
    rows,
    globalPermissions: GLOBAL_PERMISSIONS,
  });

  if (GlobalUserOverrideAccess.mayChange(held, CREATE_PERMISSIONS)) {
    return "allowed";
  }

  // The table's own create check (TablePermission, PermissionGate.check).
  const mayAddAny: boolean = HeldPermissionsUtil.holdsModelPermission(held, {
    isOperationalResource: MODEL.isOperationalResource,
    operation: "create",
    modelPermissions: CREATE_PERMISSIONS,
  });

  return mayAddAny ? "limited" : "not-allowed";
}

// The header the server writes about `rows` (UserAuthorization).
function headerOf(rows: Array<UserPermission>): string {
  const snapshot: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: rows,
  };

  return JSON.stringify(
    JSONFunctions.serialize(snapshot as unknown as JSONObject),
  );
}

function appAccess(rows: Array<UserPermission>): MobileAccess {
  return MOBILE.getGlobalOverrideAccess({
    rows: MOBILE.readProjectPermissionRows(headerOf(rows), PROJECT_ID),
    isMasterAdmin: false,
  });
}

function row(
  permission: Permission,
  data: {
    scope?: PermissionScope | undefined;
    labelIds?: Array<string>;
    isBlock?: boolean;
  } = {},
): UserPermission {
  const result: UserPermission = {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isBlockPermission: Boolean(data.isBlock),
    teamId: new ObjectID(TEAM_ID),
  };

  if (data.scope) {
    result.scope = data.scope;
  }

  return result;
}

function generatedRows(random: SeededRandom): Array<UserPermission> {
  const count: number = random(5);
  const rows: Array<UserPermission> = [];

  for (let index: number = 0; index < count; index++) {
    const labelCount: number = random(3);

    rows.push(
      row(PERMISSIONS[random(PERMISSIONS.length)]!, {
        scope: SCOPES[random(SCOPES.length)],
        labelIds: LABELS.slice(0, labelCount),
        isBlock: random(10) < 3,
      }),
    );
  }

  return rows;
}

describe("the app's copy of who may add a global user override", () => {
  test("names the permissions the override's table lets add one, and imports nothing", () => {
    expect([...MOBILE.USER_OVERRIDE_CREATE_PERMISSIONS].sort()).toEqual(
      [...CREATE_PERMISSIONS].map(String).sort(),
    );
  });

  test("answers as the server does for the shapes the issue is about", () => {
    const cases: Array<{ name: string; rows: Array<UserPermission> }> = [
      {
        name: "On-Call Member over the whole project",
        rows: [row(Permission.OnCallMember, { scope: PermissionScope.All })],
      },
      {
        name: "On-Call Member limited to the team's label",
        rows: [
          row(Permission.OnCallMember, {
            scope: PermissionScope.Labels,
            labelIds: [LABELS[0]!],
          }),
        ],
      },
      {
        name: "On-Call Member limited to what the team owns",
        rows: [row(Permission.OnCallMember, { scope: PermissionScope.Owned })],
      },
      {
        name: "a block for some labels beside a role over the whole project",
        rows: [
          row(Permission.OnCallAdmin, { scope: PermissionScope.All }),
          row(Permission.CreateOnCallDutyPolicyUserOverride, {
            isBlock: true,
            labelIds: [LABELS[1]!],
          }),
        ],
      },
      {
        name: "only reads",
        rows: [row(Permission.Viewer, { scope: PermissionScope.All })],
      },
      {
        name: "a Project Admin stored as Owned",
        rows: [row(Permission.ProjectAdmin, { scope: PermissionScope.Owned })],
      },
    ];

    for (const candidate of cases) {
      expect({ name: candidate.name, app: appAccess(candidate.rows) }).toEqual({
        name: candidate.name,
        app: serverAccess(candidate.rows),
      });
    }

    // And the answers themselves, so a rule both sides broke alike still fails.
    expect(
      cases.map((candidate: { name: string; rows: Array<UserPermission> }) => {
        return serverAccess(candidate.rows);
      }),
    ).toEqual([
      "allowed",
      "limited",
      "limited",
      "limited",
      "not-allowed",
      "allowed",
    ]);
  });

  test("answers as the server does for 20,000 generated sets of rows, read from the header the server writes", () => {
    const random: SeededRandom = seededRandom(20261103);
    const seen: Set<MobileAccess> = new Set<MobileAccess>();
    const differences: Array<string> = [];

    for (let index: number = 0; index < 20000; index++) {
      const rows: Array<UserPermission> = generatedRows(random);
      const expected: MobileAccess = serverAccess(rows);
      const actual: MobileAccess = appAccess(rows);

      seen.add(expected);

      if (actual !== expected && differences.length < 5) {
        differences.push(
          `${JSON.stringify(
            rows.map((candidate: UserPermission) => {
              return {
                permission: candidate.permission,
                scope: candidate.scope,
                labels: candidate.labelIds.length,
                isBlock: candidate.isBlockPermission,
              };
            }),
          )}: the server says ${expected}, the app ${actual}`,
        );
      }
    }

    expect(differences).toEqual([]);
    // The sweep reached every answer, so it compared something.
    expect([...seen].sort()).toEqual(["allowed", "limited", "not-allowed"]);
  });

  test("a master admin may add one whatever the rows say, as the server lets them", () => {
    expect(
      MOBILE.getGlobalOverrideAccess({
        rows: MOBILE.readProjectPermissionRows(
          headerOf([row(Permission.Viewer)]),
          PROJECT_ID,
        ),
        isMasterAdmin: true,
      }),
    ).toBe("allowed");
  });

  test("reads the header's rows for its own project only", () => {
    const header: string = headerOf([row(Permission.OnCallMember)]);

    expect(MOBILE.readProjectPermissionRows(header, PROJECT_ID)).toHaveLength(
      1,
    );
    expect(
      MOBILE.readProjectPermissionRows(
        header,
        "0d520000-0000-4000-8000-000000000009",
      ),
    ).toBeNull();
  });
});
