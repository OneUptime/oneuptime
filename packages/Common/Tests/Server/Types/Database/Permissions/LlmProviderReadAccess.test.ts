import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import ColumnWriteRefusedException from "../../../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { ColumnAccessControl } from "../../../../../Types/BaseDatabase/AccessControl";
import Exception from "../../../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";

/*
 * AN LLM PROVIDER IS READ BY ITS PROJECT'S OWN MEMBERS ONLY, AND WHAT IT SENDS
 * THE PROVIDER BESIDES ITS ADDRESS AND MODEL BY THE PROJECT'S OWNERS AND
 * ADMINS ALONE.
 *
 * A provider's base URL, model and price are its project's configuration.
 * Its read list names the project's members who may see the project's
 * settings - and not Permission.Public, which every caller holds, signed in
 * or not: with it, a read that named a project in its tenant header passed
 * the "is anyone logged in" check and every column check. The shared global
 * providers are listed to signed-in members by their own route
 * (LlmProviderAPI's global-llms: name, description and price only).
 *
 * The API key and the Additional Parameters are sent to the provider with
 * every request, and the parameters can carry a token or a header just like
 * the key, so both are read by the project's owners and admins alone - and
 * the Base URL they are sent to is changed by them alone. The members who
 * read the provider but not its parameters read whether any are saved
 * (hasAdditionalParams), which Postgres works out from the parameters on
 * every read and no caller may write.
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

// Who reads what the provider is sent besides its address and model.
const SECRET_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

// Every reader who is not a secret reader.
const OTHER_READERS: Array<Permission> = READERS.filter(
  (permission: Permission): boolean => {
    return !SECRET_READERS.includes(permission);
  },
);

// The columns the provider sends besides its address and model.
const SECRET_COLUMNS: Array<string> = ["apiKey", "additionalParams"];

// Every column a reader sees: the configuration, less the secrets.
const CONFIGURATION_SELECT: Record<string, boolean> = {
  name: true,
  description: true,
  llmType: true,
  modelName: true,
  baseUrl: true,
  hasAdditionalParams: true,
  isDefault: true,
  costPerMillionTokensInUSDCents: true,
};

// Who may change a provider: the model's own update list for its parameters.
const WRITERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditProjectLlm,
];

/*
 * What a writer holds to change a provider: the permission itself, and for
 * the granular Edit permission the granular read beside it, since a write
 * reaches only rows its caller may read.
 */
function writerPermissions(permission: Permission): Array<Permission> {
  return permission === Permission.EditProjectLlm
    ? [Permission.EditProjectLlm, Permission.ReadProjectLlm]
    : [permission];
}

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

async function update(
  props: DatabaseCommonInteractionProps,
  data: Record<string, unknown>,
): Promise<unknown> {
  return await ModelPermission.checkUpdateQueryPermissions(
    LlmProvider,
    {},
    data as never,
    props,
  );
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the request to be refused, but it was allowed.");
}

function readListOf(column: string): Array<Permission> {
  return [
    ...(new LlmProvider().getColumnAccessControlFor(column)?.read || []),
  ].sort();
}

describe("LlmProvider - who may read it", () => {
  test("its read list names its project's readers, and not Public", () => {
    const readers: Array<Permission> = new LlmProvider().getReadPermissions();

    expect(readers).not.toContain(Permission.Public);
    expect([...readers].sort()).toEqual([...READERS].sort());
  });

  test("no column is read by Public; the configuration reads with the table's readers", () => {
    const model: LlmProvider = new LlmProvider();

    for (const column of Object.keys(
      model.getColumnAccessControlForAllColumns(),
    )) {
      const access: ColumnAccessControl | undefined =
        model.getColumnAccessControlFor(column) || undefined;

      expect({ column: column, read: access?.read || [] }).not.toEqual(
        expect.objectContaining({
          read: expect.arrayContaining([Permission.Public]),
        }),
      );
    }

    for (const column of Object.keys(CONFIGURATION_SELECT)) {
      expect({ column: column, read: readListOf(column) }).toEqual({
        column: column,
        read: [...READERS].sort(),
      });
    }
  });

  test.each(SECRET_COLUMNS)(
    "%s is read by the project's owners and admins alone",
    (column: string) => {
      expect(readListOf(column)).toEqual([...SECRET_READERS].sort());
    },
  );

  /*
   * Whoever may change the provider may still replace its parameters, the
   * way they may replace its key, without reading either.
   */
  test("the Additional Parameters are written by everyone who may change the provider", () => {
    expect(
      [
        ...(new LlmProvider().getColumnAccessControlFor("additionalParams")
          ?.update || []),
      ].sort(),
    ).toEqual([...WRITERS].sort());
  });

  /*
   * The API key and the parameters go to the Base URL with every request, so
   * it is changed only by who may read them.
   */
  test("the Base URL is changed by the project's owners and admins alone", () => {
    expect(
      [
        ...(new LlmProvider().getColumnAccessControlFor("baseUrl")?.update ||
          []),
      ].sort(),
    ).toEqual([...SECRET_READERS].sort());
  });

  test("whether parameters are saved is written by no caller: Postgres works it out", () => {
    const access: ColumnAccessControl | undefined =
      new LlmProvider().getColumnAccessControlFor("hasAdditionalParams") ||
      undefined;

    expect(access?.create).toEqual([]);
    expect(access?.update).toEqual([]);
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

  test.each(SECRET_COLUMNS)(
    "a caller who is not signed in is asked to sign in for %s too",
    async (column: string) => {
      const error: unknown = await rejectionOf(
        read({ tenantId: PROJECT_ID }, { [column]: true }),
      );

      expect(error).toBeInstanceOf(NotAuthenticatedException);
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

  test.each(SECRET_READERS)(
    "a member holding %s reads the API key and the Additional Parameters",
    async (permission: Permission) => {
      await expect(
        read(member({ permissions: [permission] }), {
          ...CONFIGURATION_SELECT,
          apiKey: true,
          additionalParams: true,
        }),
      ).resolves.toBeDefined();
    },
  );

  test.each(OTHER_READERS)(
    "a member holding %s still may not read the API key",
    async (permission: Permission) => {
      const error: unknown = await rejectionOf(
        read(member({ permissions: [permission] }), { apiKey: true }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Exception).message).toContain(
        "You do not have permissions to select on - apiKey.",
      );
    },
  );

  test.each(OTHER_READERS)(
    "a member holding %s may not read the Additional Parameters",
    async (permission: Permission) => {
      const error: unknown = await rejectionOf(
        read(member({ permissions: [permission] }), {
          additionalParams: true,
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Exception).message).toContain(
        "You do not have permissions to select on - additionalParams.",
      );
    },
  );

  test.each(OTHER_READERS)(
    "a member holding %s reads whether Additional Parameters are saved",
    async (permission: Permission) => {
      await expect(
        read(member({ permissions: [permission] }), {
          hasAdditionalParams: true,
        }),
      ).resolves.toBeDefined();
    },
  );

  test("a project API key holding Viewer reads the configuration but not the parameters", async () => {
    const apiKey: DatabaseCommonInteractionProps = member({
      permissions: [Permission.Viewer],
      userType: UserType.API,
    });

    await expect(read(apiKey)).resolves.toBeDefined();

    expect(
      await rejectionOf(read(apiKey, { additionalParams: true })),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  /*
   * Every reader against every column of the provider they may ask for:
   * configuration columns for all of them, the key and the parameters for
   * the project's owners and admins alone.
   */
  describe("the read matrix", () => {
    const cases: Array<[Permission, string, boolean]> = [];

    for (const permission of READERS) {
      for (const column of Object.keys(CONFIGURATION_SELECT)) {
        cases.push([permission, column, true]);
      }

      for (const column of SECRET_COLUMNS) {
        cases.push([permission, column, SECRET_READERS.includes(permission)]);
      }
    }

    test.each(cases)(
      "%s reading %s is allowed: %s",
      async (permission: Permission, column: string, allowed: boolean) => {
        const attempt: Promise<unknown> = read(
          member({ permissions: [permission] }),
          { [column]: true },
        );

        if (allowed) {
          await expect(attempt).resolves.toBeDefined();
          return;
        }

        expect(await rejectionOf(attempt)).toBeInstanceOf(
          NotAuthorizedException,
        );
      },
    );
  });
});

describe("LlmProvider - changing it through the permission layer", () => {
  test.each(
    WRITERS.filter((permission: Permission): boolean => {
      return !SECRET_READERS.includes(permission);
    }),
  )(
    "a member holding %s may replace the Additional Parameters without reading them",
    async (permission: Permission) => {
      await expect(
        update(member({ permissions: writerPermissions(permission) }), {
          additionalParams: { temperature: 0.2 },
        }),
      ).resolves.toBeDefined();
    },
  );

  test.each(WRITERS)(
    "a member holding %s may not set whether parameters are saved",
    async (permission: Permission) => {
      const error: unknown = await rejectionOf(
        update(member({ permissions: writerPermissions(permission) }), {
          hasAdditionalParams: true,
        }),
      );

      expect(error).toBeInstanceOf(ColumnWriteRefusedException);
      expect((error as ColumnWriteRefusedException).columnName).toBe(
        "hasAdditionalParams",
      );
    },
  );

  test.each(
    OTHER_READERS.filter((permission: Permission): boolean => {
      return !WRITERS.includes(permission);
    }),
  )(
    "a member holding only %s may not change the provider at all",
    async (permission: Permission) => {
      expect(
        await rejectionOf(
          update(member({ permissions: [permission] }), {
            additionalParams: { temperature: 0.2 },
          }),
        ),
      ).toBeInstanceOf(NotAuthorizedException);
    },
  );

  test.each(
    WRITERS.filter((permission: Permission): boolean => {
      return !SECRET_READERS.includes(permission);
    }),
  )(
    "a member holding %s may not change the Base URL the secrets are sent to",
    async (permission: Permission) => {
      const error: unknown = await rejectionOf(
        update(member({ permissions: writerPermissions(permission) }), {
          baseUrl: "https://other.example.com/v1",
        }),
      );

      expect(error).toBeInstanceOf(ColumnWriteRefusedException);
      expect((error as ColumnWriteRefusedException).columnName).toBe(
        "baseUrl",
      );
    },
  );

  test.each(SECRET_READERS)(
    "a member holding %s changes the Base URL",
    async (permission: Permission) => {
      await expect(
        update(member({ permissions: [permission] }), {
          baseUrl: "https://other.example.com/v1",
        }),
      ).resolves.toBeDefined();
    },
  );

  test.each(
    WRITERS.filter((permission: Permission): boolean => {
      return !SECRET_READERS.includes(permission);
    }),
  )(
    "a member holding %s still changes the rest of the provider",
    async (permission: Permission) => {
      await expect(
        update(member({ permissions: writerPermissions(permission) }), {
          name: "Renamed",
          modelName: "gpt-4o",
          apiKey: "sk-replaced",
        }),
      ).resolves.toBeDefined();
    },
  );

  test("a member who may create providers gives a new one its Base URL", () => {
    const provider: LlmProvider = new LlmProvider();
    provider.name = "Provider";
    provider.baseUrl = "https://llm.example.com/v1";
    provider.apiKey = "sk-their-own";

    expect(() => {
      ModelPermission.checkCreatePermissions(
        LlmProvider,
        provider,
        member({ permissions: [Permission.SettingsMember] }),
      );
    }).not.toThrow();
  });

  /*
   * Postgres computes it on every read (a virtual column), so a create
   * carrying it (an export taken by an owner, say) is not refused for it,
   * and nothing a create or an update carries is ever written to it
   * (LlmProviderServiceSecrets.test.ts).
   */
  test("a create that names whether parameters are saved is not refused for it", () => {
    const provider: LlmProvider = new LlmProvider();
    provider.name = "Provider";
    provider.hasAdditionalParams = true;

    expect(() => {
      ModelPermission.checkCreatePermissions(
        LlmProvider,
        provider,
        member({ permissions: [Permission.SettingsMember] }),
      );
    }).not.toThrow();
  });

  test("a create with Additional Parameters is allowed for a member who may create providers", () => {
    const provider: LlmProvider = new LlmProvider();
    provider.name = "Provider";
    provider.additionalParams = { temperature: 0.2 };

    expect(() => {
      ModelPermission.checkCreatePermissions(
        LlmProvider,
        provider,
        member({ permissions: [Permission.SettingsMember] }),
      );
    }).not.toThrow();
  });
});
