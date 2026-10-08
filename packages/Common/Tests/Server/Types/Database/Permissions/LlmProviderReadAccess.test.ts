import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnAccessControl from "../../../../../Types/Database/AccessControl/ColumnAccessControl";
import Exception from "../../../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";

/*
 * AN LLM PROVIDER IS READ BY ITS PROJECT'S OWN MEMBERS ONLY.
 *
 * A provider's base URL, model, parameters and price are its project's
 * configuration. Its read list names the project's members who may see the
 * project's settings - and not Permission.Public, which every caller holds,
 * signed in or not: with it, a read that named a project in its tenant
 * header passed the "is anyone logged in" check and every column check. The
 * shared global providers are listed to signed-in members by their own
 * route (LlmProviderAPI's global-llms: name, description and price only).
 *
 * Driven through the real permission layer, no stubs.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

// The project's members who may read its settings: the model's own list.
const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadProjectLlm,
];

// Every column a reader sees, the API key aside.
const CONFIGURATION_SELECT: Record<string, boolean> = {
  name: true,
  description: true,
  llmType: true,
  modelName: true,
  baseUrl: true,
  additionalParams: true,
  isDefault: true,
  costPerMillionTokensInUSDCents: true,
};

function member(data: {
  permissions: Array<Permission>;
  userType?: UserType | undefined;
}): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: data.userType === UserType.API ? undefined : ObjectID.generate(),
    userType: data.userType || UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: data.permissions.map(
          (permission: Permission): UserPermission => {
            return {
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            } as UserPermission;
          },
        ),
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

async function read(
  props: DatabaseCommonInteractionProps,
  select: Record<string, boolean> = CONFIGURATION_SELECT,
): Promise<unknown> {
  return await ModelPermission.checkReadQueryPermission(
    LlmProvider,
    {},
    select as never,
    props,
  );
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the read to be refused, but it was allowed.");
}

describe("LlmProvider - who may read it", () => {
  test("its read list names its project's readers, and not Public", () => {
    const readers: Array<Permission> = new LlmProvider().getReadPermissions();

    expect(readers).not.toContain(Permission.Public);
    expect([...readers].sort()).toEqual([...READERS].sort());
  });

  test("no column is read by Public, and each reads with the table's readers", () => {
    const model: LlmProvider = new LlmProvider();

    for (const column of Object.keys(model.getColumnAccessControlForAllColumns())) {
      const access: ColumnAccessControl | undefined =
        model.getColumnAccessControlFor(column) || undefined;

      expect({ column: column, read: access?.read || [] }).not.toEqual(
        expect.objectContaining({
          read: expect.arrayContaining([Permission.Public]),
        }),
      );
    }

    for (const column of Object.keys(CONFIGURATION_SELECT)) {
      expect([
        ...(model.getColumnAccessControlFor(column)?.read || []),
      ].sort()).toEqual([...READERS].sort());
    }
  });

  test("the API key is read by the project's owners and admins alone", () => {
    expect(
      [...(new LlmProvider().getColumnAccessControlFor("apiKey")?.read || [])].sort(),
    ).toEqual([Permission.ProjectAdmin, Permission.ProjectOwner].sort());
  });

  test("no row is readable by Public on a condition", () => {
    expect(
      new LlmProvider().doesPermissionHaveConditions(Permission.Public),
    ).toBeNull();
  });
});

describe("LlmProvider - reading it through the permission layer", () => {
  test.each([
    ["with no tenant", {}],
    ["naming a project", { tenantId: PROJECT_ID }],
    [
      "naming a project as an explicit visitor",
      { tenantId: PROJECT_ID, userType: UserType.Public },
    ],
  ])(
    "a caller who is not signed in (%s) is asked to sign in, and reads nothing",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      const error: unknown = await rejectionOf(read(props));

      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect((error as Exception).code).toBe(401);
    },
  );

  test("a member of the project who may not read its settings is refused", async () => {
    const error: unknown = await rejectionOf(
      read(member({ permissions: [Permission.ReadProjectIncident] })),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
  });

  test("a project API key that may not read its settings is refused", async () => {
    const error: unknown = await rejectionOf(
      read(
        member({
          permissions: [Permission.ReadProjectIncident],
          userType: UserType.API,
        }),
      ),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
  });

  test.each(READERS)(
    "a member holding %s reads the project's providers, and only the project's",
    async (permission: Permission) => {
      const result: { query: Record<string, unknown> } = (await read(
        member({ permissions: [permission] }),
      )) as { query: Record<string, unknown> };

      // Pinned to the caller's project, whatever shape the scope takes.
      expect(result.query["projectId"]).toBeDefined();
      expect(JSON.stringify(result.query["projectId"])).toContain(
        PROJECT_ID.toString(),
      );
    },
  );

  test.each(
    READERS.filter((permission: Permission): boolean => {
      return (
        permission !== Permission.ProjectOwner &&
        permission !== Permission.ProjectAdmin
      );
    }),
  )(
    "a member holding %s still may not read the API key",
    async (permission: Permission) => {
      const error: unknown = await rejectionOf(
        read(member({ permissions: [permission] }), { apiKey: true }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
    },
  );
});
