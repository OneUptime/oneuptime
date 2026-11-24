import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * THE MOBILE APP'S COPY OF THE TEAM RULE FOR USER OVERRIDES SAYS WHAT THE
 * DASHBOARD'S SAYS, CASE FOR CASE (issue #9883, after #9733).
 *
 * Someone who manages user overrides through Manage On-Call Policy User
 * Overrides for Own Team may name only the people of the teams that give
 * it to them; the server refuses anybody else (UserOverrideTeamAccess,
 * enforced in OnCallDutyPolicyUserOverrideService). The Dashboard keeps its
 * pickers to those teams and locks the overrides naming anybody else
 * (UserOverrideTeamLimit); the app does the same on the phone. The app is
 * built without Common's runtime code, so it keeps its own copy of the rule
 * (MobileApp/src/oncall/overrideTeamAccess, which reads rows with
 * ./globalOverrideAccess) and reads the person's rows from the
 * `project-permissions` header each answer carries. A copy drifts, and a
 * drift is silent: the phone would hide somebody the save would let
 * through, or lock an override the server lets them change.
 *
 * So this suite compiles the app's two files as they are, runs them in a
 * fresh context, and asks them and the Dashboard's rule the same questions:
 * whom an add, an edit and a delete - global, and on a policy - are kept
 * to, over thousands of generated permission rows each written into a
 * header as the server writes it (UserAuthorization: JSON.stringify of
 * JSONFunctions.serialize) and read back by the app; which overrides are
 * locked, over generated teams and people; the line above a picker's list;
 * and the server's words. Any answer that differs fails here, whichever
 * side moved.
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
  UserOverrideTeamLimit,
  getUserOverrideTeamHint,
  getUserOverrideTeamLimit,
  getUserOverrideTeamLock,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideTeamLimit";
import { USER_OVERRIDE_TEAM_PICKER_EMPTY_TEXT } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import {
  USER_OVERRIDE_TEAM_AWAY_REFUSAL,
  USER_OVERRIDE_TEAM_COVER_REFUSAL,
  USER_OVERRIDE_TEAM_DELETE_REFUSAL,
  USER_OVERRIDE_TEAM_EDIT_REFUSAL,
  USER_OVERRIDE_TEAM_PERMISSION,
  USER_OVERRIDE_TEAM_PICKER_HINT,
} from "../../../Types/OnCallDutyPolicy/UserOverrideTeamAccess";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { ModelAction } from "../../../UI/Utils/PermissionGate";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const MOBILE_ONCALL_FOLDER: string = path.join(
  REPOSITORY_ROOT,
  "packages/MobileApp/src/oncall",
);

type MobileAction = "create" | "update" | "delete";

interface MobileRow {
  permission: string;
  teamId?: string | null;
}

interface MobileRule {
  USER_OVERRIDE_TEAM_PERMISSION: string;
  USER_OVERRIDE_CREATE_PERMISSIONS: ReadonlyArray<string>;
  USER_OVERRIDE_UPDATE_PERMISSIONS: ReadonlyArray<string>;
  USER_OVERRIDE_DELETE_PERMISSIONS: ReadonlyArray<string>;
  OVERRIDE_TEAM_AWAY_REFUSAL: string;
  OVERRIDE_TEAM_COVER_REFUSAL: string;
  OVERRIDE_TEAM_EDIT_REFUSAL: string;
  OVERRIDE_TEAM_DELETE_REFUSAL: string;
  OVERRIDE_TEAM_PICKER_HINT: string;
  OVERRIDE_TEAM_PICKER_EMPTY_TEXT: string;
  getOverrideTeamLimit: (data: {
    rows: ReadonlyArray<MobileRow> | null;
    isMasterAdmin: boolean;
    action: MobileAction;
    isGlobal: boolean;
  }) => { teamIds: Array<string> } | null;
  getOverrideTeamLock: (data: {
    action: "update" | "delete";
    limit: { teamIds: Array<string> } | null;
    memberIds: ReadonlySet<string> | null;
    people: {
      awayUserId: string | null | undefined;
      coverUserId: string | null | undefined;
    };
  }) => string | null;
  getOverrideTeamHint: (teamNames: ReadonlyArray<string>) => string | null;
  readProjectPermissionRows: (
    header: unknown,
    projectId: string,
  ) => Array<MobileRow> | null;
}

// An import of another file in the same folder: "./globalOverrideAccess".
const SIBLING_FILE: RegExp = new RegExp("^\\./[A-Za-z]+$");

/*
 * One of the app's files compiled to CommonJS as it is and run in a fresh
 * context. It may import only another file of the app's src/oncall, loaded
 * the same way - nothing of Common's, which the app is built without.
 */
function loadMobileModule(
  fileName: string,
  loaded: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const known: Record<string, unknown> | undefined = loaded.get(fileName);

  if (known) {
    return known;
  }

  const source: string = fs.readFileSync(
    path.join(MOBILE_ONCALL_FOLDER, fileName),
    "utf8",
  );

  const compiled: string = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: fileName,
  }).outputText;

  const moduleObject: { exports: Record<string, unknown> } = { exports: {} };
  loaded.set(fileName, moduleObject.exports);

  vm.runInNewContext(compiled, {
    module: moduleObject,
    exports: moduleObject.exports,
    require: (specifier: string): Record<string, unknown> => {
      if (!SIBLING_FILE.test(specifier)) {
        throw new Error(
          `The app's ${fileName} imports ${specifier}: it may import only another file of src/oncall, so this suite can run it as it is.`,
        );
      }

      return loadMobileModule(`${specifier.slice(2)}.ts`, loaded);
    },
  });

  return moduleObject.exports;
}

function loadMobileRule(): MobileRule {
  const loaded: Map<string, Record<string, unknown>> = new Map<
    string,
    Record<string, unknown>
  >();

  return {
    ...loadMobileModule("globalOverrideAccess.ts", loaded),
    ...loadMobileModule("overrideTeamAccess.ts", loaded),
  } as unknown as MobileRule;
}

const MOBILE: MobileRule = loadMobileRule();

const MODEL: OnCallDutyPolicyUserOverride = new OnCallDutyPolicyUserOverride();

// What the server attaches to every person, everywhere (AccessTokenService).
const GLOBAL_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const PROJECT_ID: string = "9883aaaa-0000-4000-8000-000000000001";
const LABELS: Array<string> = [
  "9883aaaa-0000-4000-8000-0000000000e1",
  "9883aaaa-0000-4000-8000-0000000000e2",
];
const PAYMENTS: string = "9883aaaa-0000-4000-8000-0000000000f1";
const MOBILE_TEAM: string = "9883aaaa-0000-4000-8000-0000000000f2";
const EVERYONE: string = "9883aaaa-0000-4000-8000-0000000000f3";

const ACTIONS: Array<{
  mobile: MobileAction;
  dashboard: ModelAction.Create | ModelAction.Update | ModelAction.Delete;
}> = [
  { mobile: "create", dashboard: ModelAction.Create },
  { mobile: "update", dashboard: ModelAction.Update },
  { mobile: "delete", dashboard: ModelAction.Delete },
];

/*
 * Every permission an override's writes take, and some that do not: roles
 * no scope narrows (Settings, Billing), roles that only read, and the
 * override's own read permission. The team permission is drawn three
 * times as often, so the sweep meets it given by one team, two, or none.
 */
const PERMISSIONS: Array<Permission> = [
  ...Array.from(
    new Set<Permission>([
      ...(MODEL.getCreatePermissions() || []),
      ...(MODEL.getUpdatePermissions() || []),
      ...(MODEL.getDeletePermissions() || []),
      Permission.Viewer,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
      Permission.SettingsAdmin,
      Permission.BillingViewer,
    ]),
  ),
  USER_OVERRIDE_TEAM_PERMISSION,
  USER_OVERRIDE_TEAM_PERMISSION,
];

const SCOPES: Array<PermissionScope | undefined> = [
  PermissionScope.All,
  PermissionScope.Owned,
  PermissionScope.Labels,
  undefined,
];

const TEAMS: Array<string | undefined> = [
  PAYMENTS,
  MOBILE_TEAM,
  EVERYONE,
  undefined,
];

function row(
  permission: Permission,
  data: {
    scope?: PermissionScope | undefined;
    labelIds?: Array<string>;
    isBlock?: boolean;
    teamId?: string | undefined;
  } = {},
): UserPermission {
  const result: UserPermission = {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isBlockPermission: Boolean(data.isBlock),
  };

  if (data.scope) {
    result.scope = data.scope;
  }

  if (data.teamId) {
    result.teamId = new ObjectID(data.teamId);
  }

  return result;
}

function generatedRows(random: SeededRandom): Array<UserPermission> {
  const count: number = random(6);
  const rows: Array<UserPermission> = [];

  for (let index: number = 0; index < count; index++) {
    rows.push(
      row(PERMISSIONS[random(PERMISSIONS.length)]!, {
        scope: SCOPES[random(SCOPES.length)],
        labelIds: LABELS.slice(0, random(3)),
        isBlock: random(10) < 2,
        teamId: TEAMS[random(TEAMS.length)],
      }),
    );
  }

  return rows;
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

// The Dashboard's answer, from the rows as the server reads them.
function dashboardLimit(
  rows: Array<UserPermission>,
  action: ModelAction.Create | ModelAction.Update | ModelAction.Delete,
  isGlobal: boolean,
): UserOverrideTeamLimit | null {
  return getUserOverrideTeamLimit({
    action: action,
    isGlobal: isGlobal,
    held: HeldPermissionsUtil.fromRows({
      rows: rows,
      globalPermissions: GLOBAL_PERMISSIONS,
    }),
    grants: HeldPermissionsUtil.getTeamGrants(
      rows,
      USER_OVERRIDE_TEAM_PERMISSION,
    ),
  });
}

// The app's answer, from the header the server writes about the rows.
function appLimit(
  rows: Array<UserPermission>,
  action: MobileAction,
  isGlobal: boolean,
): { teamIds: Array<string> } | null {
  return MOBILE.getOverrideTeamLimit({
    rows: MOBILE.readProjectPermissionRows(headerOf(rows), PROJECT_ID),
    isMasterAdmin: false,
    action: action,
    isGlobal: isGlobal,
  });
}

function describeRows(rows: Array<UserPermission>): string {
  return JSON.stringify(
    rows.map((candidate: UserPermission) => {
      return {
        permission: candidate.permission,
        scope: candidate.scope,
        labels: candidate.labelIds.length,
        isBlock: candidate.isBlockPermission,
        team: candidate.teamId?.toString(),
      };
    }),
  );
}

describe("the app's copy of the team rule for user overrides", () => {
  test("names the table's permissions and the team permission, and imports nothing of Common's", () => {
    expect(MOBILE.USER_OVERRIDE_TEAM_PERMISSION).toBe(
      String(USER_OVERRIDE_TEAM_PERMISSION),
    );
    expect([...MOBILE.USER_OVERRIDE_CREATE_PERMISSIONS].sort()).toEqual(
      [...(MODEL.getCreatePermissions() || [])].map(String).sort(),
    );
    expect([...MOBILE.USER_OVERRIDE_UPDATE_PERMISSIONS].sort()).toEqual(
      [...(MODEL.getUpdatePermissions() || [])].map(String).sort(),
    );
    expect([...MOBILE.USER_OVERRIDE_DELETE_PERMISSIONS].sort()).toEqual(
      [...(MODEL.getDeletePermissions() || [])].map(String).sort(),
    );
  });

  test("says the server's words, and the Dashboard's", () => {
    expect({
      away: MOBILE.OVERRIDE_TEAM_AWAY_REFUSAL,
      cover: MOBILE.OVERRIDE_TEAM_COVER_REFUSAL,
      edit: MOBILE.OVERRIDE_TEAM_EDIT_REFUSAL,
      delete: MOBILE.OVERRIDE_TEAM_DELETE_REFUSAL,
      hint: MOBILE.OVERRIDE_TEAM_PICKER_HINT,
      empty: MOBILE.OVERRIDE_TEAM_PICKER_EMPTY_TEXT,
    }).toEqual({
      away: USER_OVERRIDE_TEAM_AWAY_REFUSAL,
      cover: USER_OVERRIDE_TEAM_COVER_REFUSAL,
      edit: USER_OVERRIDE_TEAM_EDIT_REFUSAL,
      delete: USER_OVERRIDE_TEAM_DELETE_REFUSAL,
      hint: USER_OVERRIDE_TEAM_PICKER_HINT,
      empty: USER_OVERRIDE_TEAM_PICKER_EMPTY_TEXT,
    });
  });

  test("keeps the writes to the same teams as the Dashboard for the shapes the issue is about", () => {
    const cases: Array<{ name: string; rows: Array<UserPermission> }> = [
      {
        name: "the team permission alone, through Payments",
        rows: [
          row(Permission.OnCallViewer, { teamId: EVERYONE }),
          row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: PAYMENTS }),
        ],
      },
      {
        name: "given by two teams",
        rows: [
          row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: MOBILE_TEAM }),
          row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: PAYMENTS }),
        ],
      },
      {
        name: "beside On-Call Member over the whole project",
        rows: [
          row(Permission.OnCallMember, { teamId: EVERYONE }),
          row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: PAYMENTS }),
        ],
      },
      {
        name: "beside On-Call Member limited to a label",
        rows: [
          row(Permission.OnCallMember, {
            scope: PermissionScope.Labels,
            labelIds: [LABELS[0]!],
            teamId: EVERYONE,
          }),
          row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: PAYMENTS }),
        ],
      },
      {
        name: "a team's grant limited to a label beside another's over the whole project",
        rows: [
          row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: PAYMENTS }),
          row(USER_OVERRIDE_TEAM_PERMISSION, {
            scope: PermissionScope.Labels,
            labelIds: [LABELS[1]!],
            teamId: MOBILE_TEAM,
          }),
        ],
      },
      {
        name: "beside Edit On-Call Policy User Override over the whole project",
        rows: [
          row(Permission.EditOnCallDutyPolicyUserOverride, {
            teamId: EVERYONE,
          }),
          row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: PAYMENTS }),
        ],
      },
      {
        name: "held through no team, as an API key holds it",
        rows: [row(USER_OVERRIDE_TEAM_PERMISSION)],
      },
      {
        name: "blocked outright on one team",
        rows: [
          row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: PAYMENTS }),
          row(USER_OVERRIDE_TEAM_PERMISSION, {
            teamId: MOBILE_TEAM,
            isBlock: true,
          }),
        ],
      },
    ];

    for (const candidate of cases) {
      for (const action of ACTIONS) {
        for (const isGlobal of [true, false]) {
          expect({
            name: candidate.name,
            action: action.mobile,
            isGlobal,
            app: appLimit(candidate.rows, action.mobile, isGlobal),
          }).toEqual({
            name: candidate.name,
            action: action.mobile,
            isGlobal,
            app: dashboardLimit(candidate.rows, action.dashboard, isGlobal),
          });
        }
      }
    }

    // And the answers themselves, so a rule both sides broke alike still fails.
    expect(
      cases.map((candidate: { rows: Array<UserPermission> }) => {
        return [
          dashboardLimit(candidate.rows, ModelAction.Update, true),
          dashboardLimit(candidate.rows, ModelAction.Update, false),
        ];
      }),
    ).toEqual([
      [{ teamIds: [PAYMENTS] }, { teamIds: [PAYMENTS] }],
      [
        { teamIds: [MOBILE_TEAM, PAYMENTS] },
        { teamIds: [MOBILE_TEAM, PAYMENTS] },
      ],
      [null, null],
      [{ teamIds: [PAYMENTS] }, null],
      [{ teamIds: [PAYMENTS] }, { teamIds: [PAYMENTS, MOBILE_TEAM] }],
      [null, null],
      [{ teamIds: [] }, { teamIds: [] }],
      [null, null],
    ]);
  });

  test("keeps the writes to the same teams as the Dashboard for 20,000 generated sets of rows, read from the header the server writes", () => {
    const random: SeededRandom = seededRandom(20261120);
    const seen: Set<string> = new Set<string>();
    const differences: Array<string> = [];

    for (let index: number = 0; index < 20000; index++) {
      const rows: Array<UserPermission> = generatedRows(random);

      for (const action of ACTIONS) {
        for (const isGlobal of [true, false]) {
          const expected: UserOverrideTeamLimit | null = dashboardLimit(
            rows,
            action.dashboard,
            isGlobal,
          );
          const actual: { teamIds: Array<string> } | null = appLimit(
            rows,
            action.mobile,
            isGlobal,
          );

          seen.add(
            expected ? `teams:${Math.min(expected.teamIds.length, 2)}` : "none",
          );

          if (
            JSON.stringify(actual) !== JSON.stringify(expected) &&
            differences.length < 5
          ) {
            differences.push(
              `${describeRows(rows)}, ${action.mobile}, ${
                isGlobal ? "global" : "on a policy"
              }: the Dashboard says ${JSON.stringify(
                expected,
              )}, the app ${JSON.stringify(actual)}`,
            );
          }
        }
      }
    }

    expect(differences).toEqual([]);
    // The sweep reached every kind of answer, so it compared something.
    expect([...seen].sort()).toEqual(["none", "teams:0", "teams:1", "teams:2"]);
  });

  test("a master admin is kept to no team, as on the Dashboard", () => {
    const rows: Array<UserPermission> = [
      row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: PAYMENTS }),
    ];

    isMasterAdminForTest = true;

    try {
      expect(dashboardLimit(rows, ModelAction.Create, true)).toBeNull();
    } finally {
      isMasterAdminForTest = false;
    }

    expect(
      MOBILE.getOverrideTeamLimit({
        rows: MOBILE.readProjectPermissionRows(headerOf(rows), PROJECT_ID),
        isMasterAdmin: true,
        action: "create",
        isGlobal: true,
      }),
    ).toBeNull();
  });

  test("locks the same overrides as the Dashboard, with the same words, for 20,000 generated teams and people", () => {
    const random: SeededRandom = seededRandom(98832026);
    const people: Array<string | null> = [
      "9883aaaa-0000-4000-8000-0000000000c1",
      "9883aaaa-0000-4000-8000-0000000000c2",
      "9883AAAA-0000-4000-8000-0000000000C3",
      " 9883aaaa-0000-4000-8000-0000000000c4 ",
      "",
      null,
    ];
    const seen: Set<string> = new Set<string>();
    const differences: Array<string> = [];

    for (let index: number = 0; index < 20000; index++) {
      const limit: { teamIds: Array<string> } | null =
        random(4) === 0 ? null : { teamIds: [PAYMENTS] };
      const memberIds: Set<string> | null =
        random(5) === 0
          ? null
          : new Set<string>(
              people
                .filter((): boolean => {
                  return random(2) === 0;
                })
                .map((id: string | null): string => {
                  return (id || "").trim().toLowerCase();
                })
                .filter((id: string): boolean => {
                  return Boolean(id);
                }),
            );
      const awayUserId: string | null = people[random(people.length)]!;
      const coverUserId: string | null = people[random(people.length)]!;

      for (const action of ["update", "delete"] as const) {
        const expected: string | null = getUserOverrideTeamLock({
          action: action === "update" ? ModelAction.Update : ModelAction.Delete,
          limit: limit,
          memberIds: memberIds,
          people: { awayUserId, coverUserId },
        });
        const actual: string | null = MOBILE.getOverrideTeamLock({
          action: action,
          limit: limit,
          memberIds: memberIds,
          people: { awayUserId, coverUserId },
        });

        seen.add(expected || "open");

        if (actual !== expected && differences.length < 5) {
          differences.push(
            `${action} of ${JSON.stringify({
              limit,
              memberIds: memberIds ? [...memberIds] : null,
              awayUserId,
              coverUserId,
            })}: the Dashboard says ${expected}, the app ${actual}`,
          );
        }
      }
    }

    expect(differences).toEqual([]);
    expect([...seen].sort()).toEqual(
      [
        "open",
        USER_OVERRIDE_TEAM_EDIT_REFUSAL,
        USER_OVERRIDE_TEAM_DELETE_REFUSAL,
      ].sort(),
    );
  });

  test("writes the line above a picker's list as the Dashboard writes it in English", () => {
    const english: ReturnType<typeof createTranslator> = createTranslator(
      undefined,
      "en",
    );

    for (const teamNames of [
      [],
      ["Payments"],
      ["Mobile", "Payments"],
      ["Mobile", "Payments", "Site Reliability"],
      ["Pay$&ments"],
    ]) {
      expect({
        teamNames,
        app: MOBILE.getOverrideTeamHint(teamNames),
      }).toEqual({
        teamNames,
        app: getUserOverrideTeamHint({
          translator: english,
          teamNames: teamNames,
        }),
      });
    }
  });

  test("reads each row's team from the header as the server writes it", () => {
    const rows: Array<UserPermission> = [
      row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: PAYMENTS }),
      row(Permission.OnCallViewer),
    ];

    expect(
      MOBILE.readProjectPermissionRows(headerOf(rows), PROJECT_ID)?.map(
        (candidate: MobileRow): string | null | undefined => {
          return candidate.teamId;
        },
      ),
    ).toEqual([PAYMENTS, undefined]);
  });
});
