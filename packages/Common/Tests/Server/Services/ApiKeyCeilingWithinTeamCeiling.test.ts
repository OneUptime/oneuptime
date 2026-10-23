import Label from "../../../Models/DatabaseModels/Label";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { getApiKeyCopyLabels } from "../../../Types/Team/CustomRoleCopyPlan";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * PUTTING A PERMISSION INTO A ROLE GIVEN TO API KEYS IS GIVING IT TO THEM.
 *
 * A custom role is given to teams and to API keys, and a permission put into
 * it - or changed in it - reaches every one of them. The role's own service
 * holds the change to the grant ceiling of team permissions
 * (TeamPermissionService.assertCanGrantPermission). That is enough for the
 * keys only if the ceiling of a key's own permissions
 * (ApiKeyPermissionService.assertCallerCanGrantPermission) is never stricter
 * for what a key's copy holds - the role's permission, with its labels for
 * the scope Labels, and none of a permission limited to what is owned.
 *
 * Held here over every shape of caller and grant a seed draws: whatever the
 * team ceiling lets someone put into a role, the key ceiling lets them give
 * a key with the role. If either ceiling changes so that this breaks, the
 * role's service must hold role changes to the key ceiling as well
 * (CustomRolePermissionService).
 */

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

const PROJECT: ObjectID = new ObjectID("9a000000-0000-4000-8000-000000000001");
const LABELS: Array<ObjectID> = [1, 2, 3].map((index: number): ObjectID => {
  return new ObjectID(`9b000000-0000-4000-8000-00000000000${index}`);
});
const PERMISSIONS: Array<Permission> = [
  Permission.IncidentMember,
  Permission.MonitorViewer,
  Permission.AlertAdmin,
  Permission.ProjectAdmin,
  Permission.ProjectOwner,
];
const SCOPES: Array<PermissionScope | undefined> = [
  PermissionScope.All,
  PermissionScope.Owned,
  PermissionScope.Labels,
  undefined,
];

const pick: <T>(items: ReadonlyArray<T>, random: SeededRandom) => T = <T>(
  items: ReadonlyArray<T>,
  random: SeededRandom,
): T => {
  return items[random(items.length)]!;
};

const someLabels: (random: SeededRandom) => Array<ObjectID> = (
  random: SeededRandom,
): Array<ObjectID> => {
  return LABELS.filter((): boolean => {
    return random() < 0.5;
  });
};

const propsHolding: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: new ObjectID("9c000000-0000-4000-8000-000000000001"),
    tenantId: PROJECT,
    ...ON_HIGHEST_PLAN,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT],
      globalPermissions: [Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT,
        permissions: rows,
      },
    },
  };
};

// A caller as a project could hold them: allows and blocks, of any scope and labels.
const generateCaller: (random: SeededRandom) => Array<UserPermission> = (
  random: SeededRandom,
): Array<UserPermission> => {
  const rows: Array<UserPermission> = [];
  const count: number = 1 + random(4);

  for (let index: number = 0; index < count; index++) {
    const scope: PermissionScope | undefined = pick(SCOPES, random);
    rows.push({
      _type: "UserPermission",
      permission: pick(PERMISSIONS, random),
      scope: scope,
      labelIds:
        scope === PermissionScope.Labels || (!scope && random() < 0.5)
          ? someLabels(random)
          : [],
      isBlockPermission: random() < 0.2,
    });
  }

  return rows;
};

const passes: (work: () => void) => boolean = (work: () => void): boolean => {
  try {
    work();
    return true;
  } catch (err) {
    if (err instanceof NotAuthorizedException) {
      return false;
    }

    throw err;
  }
};

describe("the key ceiling is never stricter than the team ceiling for a role's permission", () => {
  test("whatever someone may put into a role, they may give a key with the role", () => {
    const random: SeededRandom = seededRandom(57721);
    let passedTeam: number = 0;
    let refusedTeam: number = 0;

    for (let run: number = 0; run < 4000; run++) {
      const props: DatabaseCommonInteractionProps = propsHolding(
        generateCaller(random),
      );
      const permission: Permission = pick(
        PERMISSIONS.filter((candidate: Permission): boolean => {
          // A role never holds Project Owner.
          return candidate !== Permission.ProjectOwner;
        }),
        random,
      );
      const scope: PermissionScope = pick(
        [PermissionScope.All, PermissionScope.Owned, PermissionScope.Labels],
        random,
      );
      const labelIds: Array<ObjectID> =
        scope === PermissionScope.Labels
          ? [pick(LABELS, random), ...someLabels(random)]
          : [];

      const teamAllows: boolean = passes(() => {
        TeamPermissionService.assertCanGrantPermission({
          permission: permission,
          labelIds: labelIds,
          scope: scope,
          props: props,
        });
      });

      if (!teamAllows) {
        refusedTeam += 1;
        continue;
      }

      passedTeam += 1;

      const keyLabels: Array<string> | null = getApiKeyCopyLabels({
        id: "row",
        customRoleId: "role",
        permission: permission,
        scope: scope,
        labelIds: labelIds.map((labelId: ObjectID): string => {
          return labelId.toString();
        }),
      });

      // Limited to what is owned: no key holds a copy of it.
      if (keyLabels === null) {
        continue;
      }

      const keyAllows: boolean = passes(() => {
        ApiKeyPermissionService.assertCallerCanGrantPermission({
          permission: permission,
          labels: keyLabels.map((labelId: string): Label => {
            return new Label(new ObjectID(labelId));
          }),
          projectId: PROJECT,
          props: props,
        });
      });

      expect({ run, permission, scope, labelIds, keyAllows }).toEqual({
        run,
        permission,
        scope,
        labelIds,
        keyAllows: true,
      });
    }

    // The sweep weighed both answers, not one of them only.
    expect(passedTeam).toBeGreaterThan(200);
    expect(refusedTeam).toBeGreaterThan(200);
  });
});
