import { REMOVED_PERMISSIONS as RETIRED_SERVICE_TELEMETRY_LINK_PERMISSIONS } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809176500000-RemoveServiceTelemetryLinkPermissions";
import { REMOVED_PERMISSIONS } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809178100000-RemovePermissionsTeamsCannotBeGiven";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import {
  getCustomRolePermissionProblem,
  getTenantPermissionProblem,
  PermissionHolder,
} from "../../../Types/Team/CustomRole";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT A TEAM AND AN API KEY MAY BE GIVEN (#8281).
 *
 * Only what the permission pickers offer: the tenant permissions
 * (isAssignableToTenant). TeamPermissionService and ApiKeyPermissionService
 * refuse every other value with getTenantPermissionProblem's words, as
 * CustomRolePermissionService refuses it in a role
 * (getCustomRolePermissionProblem), and the migration
 * RemovePermissionsTeamsCannotBeGiven took every one of them from the teams,
 * keys and roles that held one.
 */

const ALL_VALUES: Array<string> = Object.values(Permission) as Array<string>;

const TENANT_VALUES: Array<string> = PermissionHelper.getTenantPermissionProps()
  .map((props: PermissionProps): string => {
    return props.permission;
  })
  .sort();

// Every permission that no picker offers, today.
const NOT_FOR_TEAMS: Array<string> = ALL_VALUES.filter(
  (permission: string): boolean => {
    return !TENANT_VALUES.includes(permission);
  },
).sort();

const TEAM_PICK_ONE: string =
  "Pick one of the permissions Add Permission lists on the team's page.";
const API_KEY_PICK_ONE: string =
  "Pick one of the permissions Add Permission lists on the API key's page.";

describe("PermissionHelper: what may be given to a team or an API key", () => {
  test("the permissions no picker offers are OneUptime's own, Customer Support and the retired four", () => {
    expect(NOT_FOR_TEAMS).toEqual(
      [
        "AuthenticatedRequest",
        "CreateServiceTelemetryService",
        "CurrentUser",
        "CustomerSupport",
        "DeleteServiceTelemetryService",
        "EditServiceTelemetryService",
        "Public",
        "ReadServiceTelemetryService",
        "UnAuthorizedSsoUser",
        "User",
      ].sort(),
    );
  });

  test("getTenantPermissionValues is every tenant permission, once each", () => {
    const values: Set<string> = PermissionHelper.getTenantPermissionValues();

    expect(Array.from(values).sort()).toEqual(TENANT_VALUES);
    expect(values.size).toBe(TENANT_VALUES.length);
    expect(values.size).toBeGreaterThan(1000);
  });

  test("a fresh set on every call: a caller changing it changes no other", () => {
    const first: Set<string> = PermissionHelper.getTenantPermissionValues();
    first.add(Permission.CustomerSupport);

    expect(
      PermissionHelper.getTenantPermissionValues().has(
        Permission.CustomerSupport,
      ),
    ).toBe(false);
    expect(
      PermissionHelper.isAssignableToTenant(Permission.CustomerSupport),
    ).toBe(false);
  });

  test("every permission a picker offers may be given", () => {
    for (const permission of TENANT_VALUES) {
      expect({
        permission,
        assignable: PermissionHelper.isAssignableToTenant(permission),
      }).toEqual({ permission, assignable: true });
    }
  });

  test.each(
    NOT_FOR_TEAMS.map((permission: string) => {
      return [permission];
    }),
  )("%s may not be given", (permission: string) => {
    expect(PermissionHelper.isAssignableToTenant(permission)).toBe(false);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty value", ""],
    ["a number", 7],
    ["a list holding a permission", [Permission.ProjectOwner]],
    ["an object", { permission: Permission.ProjectOwner }],
    ["a value in another case", "projectowner"],
    ["a value with spaces around it", " ProjectOwner "],
    ["no permission at all", "NotAPermission"],
    ["a permission's title rather than its value", "Project Owner"],
  ])("%s may not be given", (_label: string, value: unknown) => {
    expect(PermissionHelper.isAssignableToTenant(value)).toBe(false);
  });
});

describe("getTenantPermissionProblem", () => {
  test("every permission a picker offers: no problem, for a team and for an API key", () => {
    for (const permission of TENANT_VALUES) {
      expect({
        permission,
        team: getTenantPermissionProblem({
          permission,
          holder: PermissionHolder.Team,
        }),
        apiKey: getTenantPermissionProblem({
          permission,
          holder: PermissionHolder.ApiKey,
        }),
      }).toEqual({ permission, team: null, apiKey: null });
    }
  });

  test.each([
    [Permission.CustomerSupport, "Customer Support"],
    [Permission.CurrentUser, "Logged in User"],
    [Permission.User, "User"],
    [Permission.Public, "Public"],
    [Permission.ReadServiceTelemetryService, "Read Service Telemetry Link"],
    [Permission.CreateServiceTelemetryService, "Create Service Telemetry Link"],
    // No props, so no title: its value stands for it.
    [Permission.AuthenticatedRequest, "AuthenticatedRequest"],
    [Permission.UnAuthorizedSsoUser, "UnAuthorizedSsoUser"],
  ])(
    "%s can't be given, named by its title (%s)",
    (permission: Permission, title: string) => {
      expect(
        getTenantPermissionProblem({
          permission,
          holder: PermissionHolder.Team,
        }),
      ).toBe(`${title} can't be given to a team. ${TEAM_PICK_ONE}`);
      expect(
        getTenantPermissionProblem({
          permission,
          holder: PermissionHolder.ApiKey,
        }),
      ).toBe(`${title} can't be given to an API key. ${API_KEY_PICK_ONE}`);
    },
  );

  test("every permission no picker offers has a problem, for both", () => {
    for (const permission of NOT_FOR_TEAMS) {
      for (const holder of [PermissionHolder.Team, PermissionHolder.ApiKey]) {
        expect({
          permission,
          holder,
          problem: getTenantPermissionProblem({ permission, holder }),
        }).toEqual({ permission, holder, problem: expect.any(String) });
      }
    }
  });

  test("a value that is no permission is said to be none, as it was sent", () => {
    expect(
      getTenantPermissionProblem({
        permission: "ProjectOwnr",
        holder: PermissionHolder.Team,
      }),
    ).toBe(`OneUptime has no permission called ProjectOwnr. ${TEAM_PICK_ONE}`);
    expect(
      getTenantPermissionProblem({
        permission: "projectowner",
        holder: PermissionHolder.ApiKey,
      }),
    ).toBe(
      `OneUptime has no permission called projectowner. ${API_KEY_PICK_ONE}`,
    );
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty value", ""],
    ["only spaces", "   "],
    ["a number", 7],
    ["a list", [Permission.ProjectOwner]],
    ["an object", { permission: Permission.ProjectOwner }],
    ["true", true],
  ])("%s: asked to pick a permission", (_label: string, value: unknown) => {
    for (const holder of [PermissionHolder.Team, PermissionHolder.ApiKey]) {
      expect(getTenantPermissionProblem({ permission: value, holder })).toBe(
        "Pick a permission.",
      );
    }
  });

  test("every problem is a sentence: a capital first, a full stop last", () => {
    const values: Array<unknown> = [
      ...NOT_FOR_TEAMS,
      "NotAPermission",
      "projectowner",
      "",
      null,
      42,
    ];

    for (const value of values) {
      for (const holder of [PermissionHolder.Team, PermissionHolder.ApiKey]) {
        const problem: string | null = getTenantPermissionProblem({
          permission: value,
          holder,
        });

        expect(problem).toMatch(/^[A-Z].*\.$/);
      }
    }
  });

  test("a team and a custom role refuse the same permissions", () => {
    for (const permission of [...NOT_FOR_TEAMS, ...TENANT_VALUES]) {
      const forTeam: boolean =
        getTenantPermissionProblem({
          permission,
          holder: PermissionHolder.Team,
        }) === null;
      const forRole: boolean =
        getCustomRolePermissionProblem({ permission }) === null;

      // A role never holds Project Owner, which a team may be given.
      if (permission === Permission.ProjectOwner) {
        expect({ permission, forTeam, forRole }).toEqual({
          permission,
          forTeam: true,
          forRole: false,
        });
        continue;
      }

      expect({ permission, forRole }).toEqual({
        permission,
        forRole: forTeam,
      });
    }
  });
});

describe("every permission no team may hold was taken from the teams that held it", () => {
  /*
   * A permission that stops being offered can still be held by a team, a
   * key or a role that was given it before. Whoever retires one writes a
   * migration that takes it away, as these two did, and adds it here.
   */
  const TAKEN_AWAY_BY_A_MIGRATION: Set<string> = new Set<string>([
    ...RETIRED_SERVICE_TELEMETRY_LINK_PERMISSIONS,
    ...REMOVED_PERMISSIONS,
  ]);

  test.each(
    NOT_FOR_TEAMS.map((permission: string) => {
      return [permission];
    }),
  )("%s is removed by a migration", (permission: string) => {
    expect(TAKEN_AWAY_BY_A_MIGRATION.has(permission)).toBe(true);
  });

  test("RemovePermissionsTeamsCannotBeGiven takes every one of them, the retired four again too", () => {
    expect([...REMOVED_PERMISSIONS].sort()).toEqual(NOT_FOR_TEAMS);
  });

  test("and no permission a team may still be given", () => {
    for (const permission of REMOVED_PERMISSIONS) {
      expect({
        permission,
        offered: PermissionHelper.isAssignableToTenant(permission),
      }).toEqual({ permission, offered: false });
    }
  });
});

/*
 * OneUptime's own writes are trusted with what they write (root), and the
 * project's first teams are written without hooks: they are seeded only
 * with what a team may be given, so no new project starts with a row the
 * migration would take away.
 */
describe("a new project's first teams", () => {
  const PROJECT_SERVICE: string = path.join(
    __dirname,
    "../../../Server/Services/ProjectService.ts",
  );
  const SEEDED_PERMISSION: RegExp =
    /\b\w+Permissions\.permission = Permission\.(\w+);/g;

  test("are given Project Owner, Project Admin and Project Member, each a team may hold", () => {
    const seeded: Array<string> = [
      ...fs.readFileSync(PROJECT_SERVICE, "utf8").matchAll(SEEDED_PERMISSION),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(seeded).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ]);

    for (const permission of seeded) {
      expect({
        permission,
        assignable: PermissionHelper.isAssignableToTenant(permission),
      }).toEqual({ permission, assignable: true });
    }
  });
});
