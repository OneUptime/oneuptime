import { describe, expect, test } from "@jest/globals";
import {
  GLOBAL_OVERRIDE_LIMITED_REASON,
  GLOBAL_OVERRIDE_NOT_ALLOWED_REASON,
  USER_OVERRIDE_CREATE_PERMISSIONS,
  getGlobalOverrideAccess,
  getGlobalOverrideLockReason,
  readProjectPermissionRows,
  type GlobalOverrideAccess,
  type ProjectPermissionRow,
} from "./globalOverrideAccess";

/*
 * WHO MAY ARRANGE COVER FOR EVERY POLICY FROM THE APP (issue #5617).
 *
 * Cover arranged in the app names no policy, so it applies to every
 * on-call policy in the project, and the server takes a permission to add
 * user overrides over the whole project for it. These are the shapes a
 * person's permission rows come in, and what the cover sheet makes of
 * each. Common's GlobalUserOverrideAccessMobileParity runs this copy beside
 * the server's rule over thousands of generated rows; this suite names the
 * cases a reader cares about.
 */

const PROJECT: string = "0d518000-0000-4000-8000-000000000001";
const OTHER_PROJECT: string = "0d518000-0000-4000-8000-000000000009";
const TEAM_A_LABEL: string = "0d518000-0000-4000-8000-0000000000a3";

function row(
  permission: string,
  data: {
    scope?: "All" | "Owned" | "Labels";
    labelIds?: Array<string>;
    isBlock?: boolean;
  } = {},
): ProjectPermissionRow {
  return {
    permission: permission,
    labelIds: data.labelIds || [],
    scope: data.scope,
    isBlockPermission: Boolean(data.isBlock),
  };
}

function accessOf(
  rows: Array<ProjectPermissionRow> | null,
  isMasterAdmin: boolean = false,
): GlobalOverrideAccess {
  return getGlobalOverrideAccess({ rows, isMasterAdmin });
}

describe("who may arrange cover for every policy", () => {
  test("someone holding a role over the whole project may, whichever role adds overrides", () => {
    for (const permission of USER_OVERRIDE_CREATE_PERMISSIONS) {
      expect({
        permission,
        access: accessOf([row(permission, { scope: "All" })]),
      }).toEqual({ permission, access: "allowed" });
    }
  });

  test("a legacy row with no scope and no labels reaches the whole project", () => {
    expect(accessOf([row("OnCallMember")])).toBe("allowed");
  });

  test("a role limited to the team's label covers only some policies", () => {
    expect(
      accessOf([
        row("OnCallMember", { scope: "Labels", labelIds: [TEAM_A_LABEL] }),
      ]),
    ).toBe("limited");
  });

  test("a row stored as All with labels is limited to them, as the server reads it", () => {
    expect(
      accessOf([
        row("OnCallMember", { scope: "All", labelIds: [TEAM_A_LABEL] }),
      ]),
    ).toBe("limited");
  });

  test("a role limited to what the team owns covers only some policies", () => {
    expect(accessOf([row("OnCallMember", { scope: "Owned" })])).toBe("limited");
  });

  test("a project owner or admin reaches the whole project whatever scope their row carries", () => {
    for (const permission of ["ProjectOwner", "ProjectAdmin"]) {
      expect(accessOf([row(permission, { scope: "Owned" })])).toBe("allowed");
      expect(
        accessOf([row(permission, { scope: "All", labelIds: [TEAM_A_LABEL] })]),
      ).toBe("allowed");
    }
  });

  test("one row over the whole project beside a narrower one is enough", () => {
    expect(
      accessOf([
        row("OnCallMember", { scope: "Labels", labelIds: [TEAM_A_LABEL] }),
        row("CreateOnCallDutyPolicyUserOverride", { scope: "All" }),
      ]),
    ).toBe("allowed");
  });

  test("a team's block for some labels takes cover for every policy away: it would reach those policies too", () => {
    expect(
      accessOf([
        row("OnCallMember", { scope: "All" }),
        row("CreateOnCallDutyPolicyUserOverride", {
          isBlock: true,
          labelIds: [TEAM_A_LABEL],
        }),
      ]),
    ).toBe("limited");
  });

  test("a block with no labels takes adding overrides away outright", () => {
    expect(
      accessOf([
        row("ProjectAdmin", { scope: "All" }),
        row("OnCallMember", { isBlock: true }),
      ]),
    ).toBe("not-allowed");
  });

  test("someone who only reads overrides may not add any", () => {
    expect(accessOf([row("Viewer", { scope: "All" })])).toBe("not-allowed");
    expect(accessOf([])).toBe("not-allowed");
  });

  test("a block alone grants nothing", () => {
    expect(
      accessOf([row("OnCallMember", { isBlock: true, labelIds: ["x"] })]),
    ).toBe("not-allowed");
  });

  test("rows for other permissions change nothing", () => {
    expect(
      accessOf([
        row("OnCallMember", { scope: "All" }),
        row("Viewer", { isBlock: true }),
        row("ReadOnCallDutyPolicyUserOverride", {
          isBlock: true,
          labelIds: [TEAM_A_LABEL],
        }),
      ]),
    ).toBe("allowed");
  });

  test("a master admin may, whatever their rows say", () => {
    expect(
      accessOf(
        [row("OnCallMember", { scope: "Labels", labelIds: [TEAM_A_LABEL] })],
        true,
      ),
    ).toBe("allowed");
    expect(accessOf(null, true)).toBe("allowed");
  });

  test("before the server has said anything, nothing is known", () => {
    expect(accessOf(null)).toBe("unknown");
  });
});

describe("why the sheet says it cannot arrange cover", () => {
  test("each answer has its own reason, and the ones that allow it have none", () => {
    expect(getGlobalOverrideLockReason("limited")).toBe(
      GLOBAL_OVERRIDE_LIMITED_REASON,
    );
    expect(getGlobalOverrideLockReason("not-allowed")).toBe(
      GLOBAL_OVERRIDE_NOT_ALLOWED_REASON,
    );
    expect(getGlobalOverrideLockReason("allowed")).toBeNull();
    expect(getGlobalOverrideLockReason("unknown")).toBeNull();
  });

  test("the limited reason says where the override goes instead", () => {
    expect(GLOBAL_OVERRIDE_LIMITED_REASON).toContain(
      "applies to every on-call policy",
    );
    expect(GLOBAL_OVERRIDE_LIMITED_REASON).toContain(
      "policy's own User Overrides page",
    );
  });
});

/*
 * The header as the server writes it: JSON.stringify of
 * JSONFunctions.serialize(UserTenantAccessPermission), ids as ObjectID JSON.
 */
function header(data: {
  projectId?: unknown;
  permissions: Array<Record<string, unknown>>;
}): string {
  return JSON.stringify({
    _type: "UserTenantAccessPermission",
    projectId:
      data.projectId === undefined
        ? { _type: "ObjectID", value: PROJECT }
        : data.projectId,
    permissions: data.permissions,
  });
}

describe("reading the project-permissions header", () => {
  test("reads each row's permission, labels, scope and whether it blocks", () => {
    expect(
      readProjectPermissionRows(
        header({
          permissions: [
            {
              _type: "UserPermission",
              permission: "OnCallMember",
              labelIds: [{ _type: "ObjectID", value: TEAM_A_LABEL }],
              scope: "Labels",
              isBlockPermission: false,
              teamId: { _type: "ObjectID", value: "team-a" },
            },
            {
              _type: "UserPermission",
              permission: "CreateOnCallDutyPolicyUserOverride",
              labelIds: [],
              isBlockPermission: true,
            },
          ],
        }),
        PROJECT,
      ),
    ).toEqual([
      {
        permission: "OnCallMember",
        labelIds: [{ _type: "ObjectID", value: TEAM_A_LABEL }],
        scope: "Labels",
        isBlockPermission: false,
      },
      {
        permission: "CreateOnCallDutyPolicyUserOverride",
        labelIds: [],
        scope: undefined,
        isBlockPermission: true,
      },
    ]);
  });

  test("a row the server wrote without the block flag grants, as the server reads it", () => {
    const rows: Array<ProjectPermissionRow> | null = readProjectPermissionRows(
      header({ permissions: [{ permission: "OnCallMember" }] }),
      PROJECT,
    );

    expect(rows).toEqual([
      {
        permission: "OnCallMember",
        labelIds: [],
        scope: undefined,
        isBlockPermission: false,
      },
    ]);
    expect(accessOf(rows)).toBe("allowed");
  });

  test("a snapshot of another project is not read as this one's", () => {
    expect(
      readProjectPermissionRows(
        header({
          projectId: { _type: "ObjectID", value: OTHER_PROJECT },
          permissions: [{ permission: "OnCallMember" }],
        }),
        PROJECT,
      ),
    ).toBeNull();

    // Its id written as a plain string, in another case, still names it.
    expect(
      readProjectPermissionRows(
        header({
          projectId: PROJECT.toUpperCase(),
          permissions: [{ permission: "OnCallMember" }],
        }),
        PROJECT,
      ),
    ).toHaveLength(1);
  });

  test("anything that is not a snapshot reads as none", () => {
    for (const value of [
      undefined,
      null,
      "",
      "not json",
      "[]",
      "42",
      JSON.stringify({ permissions: "OnCallMember" }),
    ]) {
      expect({
        value,
        rows: readProjectPermissionRows(value, PROJECT),
      }).toEqual({ value, rows: null });
    }
  });

  test("rows it cannot read are left out, and the rest kept", () => {
    expect(
      readProjectPermissionRows(
        header({
          permissions: [
            null as unknown as Record<string, unknown>,
            { permission: 7 },
            { permission: "" },
            { permission: "OnCallAdmin", labelIds: "not a list" },
          ],
        }),
        PROJECT,
      ),
    ).toEqual([
      {
        permission: "OnCallAdmin",
        labelIds: [],
        scope: undefined,
        isBlockPermission: false,
      },
    ]);
  });
});
