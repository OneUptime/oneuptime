import { act, renderHook } from "@testing-library/react-native";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest as jestGlobal,
  test,
} from "@jest/globals";
import { useOverrideTeamLimits } from "./useOverrideTeamLimits";
import {
  clearAllProjectPermissions,
  recordProjectPermissions,
} from "../api/projectPermissions";
import * as keychain from "../storage/keychain";

/*
 * THE TEAMS SOMEONE'S OVERRIDES ARE KEPT TO, AS THE SERVER LAST SAID (#9883):
 * read from the rows the `project-permissions` header carries for the
 * project (api/projectPermissions), following them as each answer brings
 * them, and never for a master admin.
 */

const PROJECT: string = "project-1";

function holding(
  projectId: string,
  rows: Array<Record<string, unknown>>,
): void {
  recordProjectPermissions(projectId, {
    "project-permissions": JSON.stringify({
      _type: "UserTenantAccessPermission",
      projectId: { _type: "ObjectID", value: projectId },
      permissions: rows,
    }),
  });
}

function row(permission: string, teamId?: string): Record<string, unknown> {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    scope: "All",
    isBlockPermission: false,
    ...(teamId ? { teamId: { _type: "ObjectID", value: teamId } } : {}),
  };
}

const TEAM_SCOPED: Array<Record<string, unknown>> = [
  row("OnCallViewer"),
  row("ManageTeamOnCallDutyPolicyUserOverride", "team-payments"),
];

// A token whose payload says what `claims` say; the app never checks its signature.
function tokenWith(claims: Record<string, unknown>): string {
  const encode: (value: Record<string, unknown>) => string = (
    value: Record<string, unknown>,
  ): string => {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  };

  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

beforeEach(() => {
  clearAllProjectPermissions();
});

afterEach(() => {
  clearAllProjectPermissions();
  jestGlobal.restoreAllMocks();
});

describe("useOverrideTeamLimits", () => {
  test("for someone the team rule narrows: the team that gives it, for every write", async () => {
    holding(PROJECT, TEAM_SCOPED);

    const { result } = await renderHook(() => {
      return useOverrideTeamLimits(PROJECT);
    });

    for (const action of ["create", "update", "delete"] as const) {
      expect(result.current(action, true)).toEqual({
        teamIds: ["team-payments"],
      });
      expect(result.current(action, false)).toEqual({
        teamIds: ["team-payments"],
      });
    }
  });

  test("before the server has said anything about the project: not narrowed", async () => {
    const { result } = await renderHook(() => {
      return useOverrideTeamLimits(PROJECT);
    });

    expect(result.current("create", true)).toBeNull();
  });

  test("another project's rows say nothing about this one", async () => {
    holding("project-2", TEAM_SCOPED);

    const { result } = await renderHook(() => {
      return useOverrideTeamLimits(PROJECT);
    });

    expect(result.current("update", true)).toBeNull();
  });

  test("follows the rows as an answer about the project brings them", async () => {
    const { result } = await renderHook(() => {
      return useOverrideTeamLimits(PROJECT);
    });

    expect(result.current("update", true)).toBeNull();

    await act(async (): Promise<void> => {
      holding(PROJECT, TEAM_SCOPED);
    });

    expect(result.current("update", true)).toEqual({
      teamIds: ["team-payments"],
    });

    await act(async (): Promise<void> => {
      holding(PROJECT, [row("OnCallMember"), ...TEAM_SCOPED]);
    });

    expect(result.current("update", true)).toBeNull();
  });

  test("a master admin is never narrowed", async () => {
    jestGlobal
      .spyOn(keychain, "getCachedAccessToken")
      .mockReturnValue(tokenWith({ userId: "user-me", isMasterAdmin: true }));
    holding(PROJECT, TEAM_SCOPED);

    const { result } = await renderHook(() => {
      return useOverrideTeamLimits(PROJECT);
    });

    expect(result.current("create", true)).toBeNull();
    expect(result.current("delete", false)).toBeNull();
  });

  test("no project: not narrowed", async () => {
    holding(PROJECT, TEAM_SCOPED);

    const { result } = await renderHook(() => {
      return useOverrideTeamLimits(null);
    });

    expect(result.current("create", true)).toBeNull();
  });
});
