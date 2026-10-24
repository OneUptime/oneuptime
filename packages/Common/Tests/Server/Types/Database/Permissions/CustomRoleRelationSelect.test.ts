import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import ApiKeyCustomRole from "../../../../../Models/DatabaseModels/ApiKeyCustomRole";
import TeamCustomRole from "../../../../../Models/DatabaseModels/TeamCustomRole";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * THE ROWS THAT GIVE A CUSTOM ROLE, read with the role through the relation.
 *
 * A team's and an API key's Custom Roles cards say "Incident Responder - 6
 * permissions" from the row that gives the role, selecting
 *
 *   customRole: { name, permissionCount }
 *
 * and the role's API Keys card names each key from its row:
 *
 *   apiKey: { name }
 *
 * QueryPermission.checkRelationQueryPermission throws on the first inner
 * column not flagged canReadOnRelationQuery, failing the whole read - so a
 * card selecting permissionCount without the flag drew nothing at all, for
 * every caller. These are the selects the cards send, copied as literals so
 * a change to a card without its model surfaces here; and a column left
 * unflagged is still refused.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function checkRelationSelect<TModel extends BaseModel>(
  modelType: { new (): TModel },
  select: Select<TModel>,
  permissions: Array<Permission>,
): void {
  QueryPermission.checkRelationQueryPermission(
    modelType,
    {} as Query<TModel>,
    select,
    makeProps(permissions),
  );
}

// Components/Team/TeamCustomRoleTable and Components/ApiKey/ApiKeyCustomRoleTable.
const ROLE_LINE_SELECT: Record<string, unknown> = {
  _id: true,
  customRoleId: true,
  customRole: {
    name: true,
    permissionCount: true,
  },
};

// Components/CustomRole/CustomRoleApiKeysTable.
const KEY_LINE_SELECT: Select<ApiKeyCustomRole> = {
  _id: true,
  apiKeyId: true,
  apiKey: {
    name: true,
  },
} as Select<ApiKeyCustomRole>;

describe("the selects of the Custom Roles cards", () => {
  it("a team's roles, with how many permissions each holds", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectTeam,
    ]) {
      expect(() => {
        return checkRelationSelect(
          TeamCustomRole,
          ROLE_LINE_SELECT as Select<TeamCustomRole>,
          [permission],
        );
      }).not.toThrow();
    }
  });

  it("an API key's roles, with how many permissions each holds", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ]) {
      expect(() => {
        return checkRelationSelect(
          ApiKeyCustomRole,
          ROLE_LINE_SELECT as Select<ApiKeyCustomRole>,
          [permission],
        );
      }).not.toThrow();
    }
  });

  it("the API keys a role is given to, by name", () => {
    expect(() => {
      return checkRelationSelect(ApiKeyCustomRole, KEY_LINE_SELECT, [
        Permission.ReadProjectApiKey,
      ]);
    }).not.toThrow();
  });

  it("a column of the role not flagged for relation reads is still refused", () => {
    for (const modelType of [TeamCustomRole, ApiKeyCustomRole]) {
      expect(() => {
        return checkRelationSelect(
          modelType as { new (): BaseModel },
          {
            customRole: {
              name: true,
              description: true,
            },
          } as unknown as Select<BaseModel>,
          [Permission.ProjectOwner],
        );
      }).toThrow(/description/);
    }
  });

  it("a column of the key not flagged for relation reads is still refused", () => {
    expect(() => {
      return checkRelationSelect(
        ApiKeyCustomRole,
        {
          apiKey: {
            name: true,
            apiKey: true,
          },
        } as unknown as Select<ApiKeyCustomRole>,
        [Permission.ProjectOwner],
      );
    }).toThrow(/apiKey/);
  });
});
