import LlmProviderService, {
  Service as LlmProviderServiceClass,
} from "../../../Server/Services/LlmProviderService";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import logger from "../../../Server/Utils/Logger";
import LlmProvider, {
  getHasAdditionalParamsSql,
} from "../../../Models/DatabaseModels/LlmProvider";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";

/*
 * WHO CHANGES WHERE AN LLM PROVIDER SENDS ITS SECRETS, AND WHAT THE OTHER
 * MEMBERS SEE OF ITS PARAMETERS.
 *
 * A provider's API key and Additional Parameters are sent to its Base URL
 * with every request - by every AI feature and by the provider's Test
 * button. So:
 *
 *   - its Base URL is changed only by who may read them: project owners and
 *     admins (LlmProvider.baseUrl's update list is the API key's read list).
 *     Anyone else who may change the provider is refused in plain words
 *     naming who may (LlmProviderService.onBeforeUpdate), and the update's
 *     column check refuses them as well when hooks are skipped;
 *   - the members who may change the provider still change everything else,
 *     and still replace its key and its parameters without reading them;
 *   - a new provider is given its Base URL by whoever creates it, with the
 *     key they give it themselves;
 *   - whether parameters are saved (hasAdditionalParams) is worked out by
 *     Postgres from the parameters on every read: never stored, so never
 *     written, by anyone (LlmProviderHasAdditionalParamsPostgres.test.ts
 *     runs the SQL).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000001",
);
const PROVIDER_ID: string = "c4000000-0000-4000-8000-000000000002";

const STORED_BASE_URL: string = "https://llm.example.com/v1";
const NEW_BASE_URL: string = "https://other.example.com/v1";

const REFUSAL: string =
  "Only Project Owner or Project Admin can change the Base URL of an LLM provider: its API key and Additional Parameters are sent to that address.";

// Who reads the API key: who may change the Base URL.
const SECRET_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

// Who may change a provider but not its Base URL.
const OTHER_WRITERS: Array<Permission> = [
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditProjectLlm,
];

// Who reads a provider: the model's own list.
const PROVIDER_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadProjectLlm,
];

function member(
  permissions: Array<Permission>,
  options: { userType?: UserType; blocked?: Array<Permission> } = {},
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    },
  );

  for (const permission of options.blocked || []) {
    rows.push({
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: true,
    } as UserPermission);
  }

  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: options.userType === UserType.API ? undefined : ObjectID.generate(),
    userType: options.userType || UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

/*
 * What a writer holds to change a provider: the permission itself, and for
 * the granular Edit permission the granular read beside it, since a write
 * reaches only rows its caller may read.
 */
function writer(permission: Permission): DatabaseCommonInteractionProps {
  return member(
    permission === Permission.EditProjectLlm
      ? [Permission.EditProjectLlm, Permission.ReadProjectLlm]
      : [permission],
  );
}

describe("LlmProviderService.mayChangeBaseUrl - who may change where the secrets go", () => {
  test.each(SECRET_READERS)(
    "a member holding %s may",
    (permission: Permission) => {
      expect(
        LlmProviderServiceClass.mayChangeBaseUrl(member([permission])),
      ).toBe(true);
    },
  );

  test.each([...OTHER_WRITERS, Permission.Viewer, Permission.ReadProjectLlm])(
    "a member holding %s may not",
    (permission: Permission) => {
      expect(
        LlmProviderServiceClass.mayChangeBaseUrl(member([permission])),
      ).toBe(false);
    },
  );

  test("a member holding every writer permission but the admins' may not", () => {
    expect(
      LlmProviderServiceClass.mayChangeBaseUrl(
        member([...OTHER_WRITERS, Permission.ReadProjectLlm]),
      ),
    ).toBe(false);
  });

  test("a project API key holding Project Admin may", () => {
    expect(
      LlmProviderServiceClass.mayChangeBaseUrl(
        member([Permission.ProjectAdmin], { userType: UserType.API }),
      ),
    ).toBe(true);
  });

  test("a project API key holding Settings Member may not", () => {
    expect(
      LlmProviderServiceClass.mayChangeBaseUrl(
        member([Permission.SettingsMember], { userType: UserType.API }),
      ),
    ).toBe(false);
  });

  test("an admin whose team blocks Project Admin may not", () => {
    expect(
      LlmProviderServiceClass.mayChangeBaseUrl(
        member([Permission.ProjectAdmin], {
          blocked: [Permission.ProjectAdmin],
        }),
      ),
    ).toBe(false);
  });

  test("OneUptime itself and server admins may", () => {
    expect(LlmProviderServiceClass.mayChangeBaseUrl({ isRoot: true })).toBe(
      true,
    );
    expect(
      LlmProviderServiceClass.mayChangeBaseUrl({ isMasterAdmin: true }),
    ).toBe(true);
  });

  test("the refusal names who may change it, from the column's own list", () => {
    expect(LlmProviderServiceClass.getBaseUrlRefusal()).toBe(REFUSAL);
  });
});

describe("LlmProvider.baseUrl - one list decides", () => {
  test("its update list is the API key's read list, and the Additional Parameters'", () => {
    const model: LlmProvider = new LlmProvider();

    const baseUrlUpdaters: Array<Permission> = [
      ...(model.getColumnAccessControlFor("baseUrl")?.update || []),
    ].sort();

    expect(baseUrlUpdaters).toEqual([...SECRET_READERS].sort());
    expect(baseUrlUpdaters).toEqual(
      [...(model.getColumnAccessControlFor("apiKey")?.read || [])].sort(),
    );
    expect(baseUrlUpdaters).toEqual(
      [
        ...(model.getColumnAccessControlFor("additionalParams")?.read || []),
      ].sort(),
    );
  });

  test("whoever creates providers still gives a new one its Base URL", () => {
    const model: LlmProvider = new LlmProvider();

    expect(
      [...(model.getColumnAccessControlFor("baseUrl")?.create || [])].sort(),
    ).toEqual([...model.getCreatePermissions()].sort());
  });

  test("whoever reads a provider reads its Base URL", () => {
    expect(
      [
        ...(new LlmProvider().getColumnAccessControlFor("baseUrl")?.read || []),
      ].sort(),
    ).toEqual([...PROVIDER_READERS].sort());
  });
});

describe("LlmProvider.hasAdditionalParams - worked out on every read, never stored", () => {
  function virtualColumn(): ColumnMetadataArgs | undefined {
    return getMetadataArgsStorage().columns.find(
      (candidate: ColumnMetadataArgs): boolean => {
        return (
          candidate.target === LlmProvider &&
          candidate.propertyName === "hasAdditionalParams"
        );
      },
    );
  }

  test("it is a virtual column: Postgres computes it, nothing inserts or updates it", () => {
    expect(virtualColumn()?.mode).toBe("virtual-property");
  });

  test("its query is the one definition of the rule", () => {
    const query: ((alias: string) => string) | undefined = (
      virtualColumn()?.options as
        | { query?: (alias: string) => string }
        | undefined
    )?.query;

    expect(query).toBeDefined();
    expect(query!(`"LlmProvider"`)).toBe(
      getHasAdditionalParamsSql(`"LlmProvider"`),
    );
  });

  test("the rule reads the parameters of the row it is asked about, and no other table", () => {
    const sql: string = getHasAdditionalParamsSql(`"provider_alias"`);

    expect(sql).toContain(`"provider_alias"."additionalParams"`);
    expect(sql).not.toMatch(/\bFROM\b/i);
    // Nothing saved, JSON null and the empty values are no parameters.
    for (const empty of ["'null'::jsonb", "'{}'::jsonb", "'[]'::jsonb"]) {
      expect(sql).toContain(empty);
    }
    expect(sql).toContain(`'""'::jsonb`);
    // A provider without parameters answers false, never null.
    expect(sql.startsWith("COALESCE(")).toBe(true);
    expect(sql.endsWith(", false)")).toBe(true);
  });

  test("the API documents it as read-only, read by whoever reads the provider", () => {
    const model: LlmProvider = new LlmProvider();
    const metadata: TableColumnMetadata = model.getTableColumnMetadata(
      "hasAdditionalParams",
    );

    expect(metadata.computed).toBe(true);
    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(
      [
        ...(model.getColumnAccessControlFor("hasAdditionalParams")?.read || []),
      ].sort(),
    ).toEqual([...PROVIDER_READERS].sort());
    expect(
      model.getColumnAccessControlFor("hasAdditionalParams")?.create,
    ).toEqual([]);
    expect(
      model.getColumnAccessControlFor("hasAdditionalParams")?.update,
    ).toEqual([]);
  });
});

describe("LlmProviderService - changing a provider through the write pipeline", () => {
  let providers: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    providers = useInMemoryTable(LlmProviderService, [
      {
        _id: PROVIDER_ID,
        projectId: PROJECT_ID.toString(),
        name: "Project provider",
        slug: "project-provider",
        llmType: "OpenAI",
        baseUrl: STORED_BASE_URL,
        isGlobalLlm: false,
        isDefault: false,
        additionalParams: { temperature: 0.2 },
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stored(column: string): unknown {
    return providers.get(PROVIDER_ID)?.[column];
  }

  async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }

    throw new Error("Expected the update to be refused, but it was allowed.");
  }

  test.each(OTHER_WRITERS)(
    "a member holding %s is refused a new Base URL, in plain words, and it stays",
    async (permission: Permission) => {
      const error: unknown = await refusalOf(
        LlmProviderService.updateOneById({
          id: new ObjectID(PROVIDER_ID),
          data: { baseUrl: NEW_BASE_URL } as never,
          props: writer(permission),
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as NotAuthorizedException).message).toBe(REFUSAL);
      expect(stored("baseUrl")).toBe(STORED_BASE_URL);
    },
  );

  test.each(OTHER_WRITERS)(
    "a member holding %s is refused clearing the Base URL too",
    async (permission: Permission) => {
      expect(
        await refusalOf(
          LlmProviderService.updateOneById({
            id: new ObjectID(PROVIDER_ID),
            data: { baseUrl: null } as never,
            props: writer(permission),
          }),
        ),
      ).toBeInstanceOf(NotAuthorizedException);

      expect(stored("baseUrl")).toBe(STORED_BASE_URL);
    },
  );

  test("an update that changes the Base URL with the name changes neither", async () => {
    expect(
      await refusalOf(
        LlmProviderService.updateOneById({
          id: new ObjectID(PROVIDER_ID),
          data: { name: "Renamed", baseUrl: NEW_BASE_URL } as never,
          props: writer(Permission.SettingsMember),
        }),
      ),
    ).toBeInstanceOf(NotAuthorizedException);

    expect(stored("name")).toBe("Project provider");
    expect(stored("baseUrl")).toBe(STORED_BASE_URL);
  });

  test("with the hooks skipped, the column check refuses it on its own", async () => {
    const props: DatabaseCommonInteractionProps = {
      ...writer(Permission.SettingsMember),
      ignoreHooks: true,
    };

    const error: unknown = await refusalOf(
      LlmProviderService.updateOneById({
        id: new ObjectID(PROVIDER_ID),
        data: { baseUrl: NEW_BASE_URL } as never,
        props: props,
      }),
    );

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect((error as ColumnWriteRefusedException).columnName).toBe("baseUrl");
    expect(stored("baseUrl")).toBe(STORED_BASE_URL);
  });

  test.each(SECRET_READERS)(
    "a member holding %s changes the Base URL",
    async (permission: Permission) => {
      await LlmProviderService.updateOneById({
        id: new ObjectID(PROVIDER_ID),
        data: { baseUrl: NEW_BASE_URL } as never,
        props: member([permission]),
      });

      expect(stored("baseUrl")).toBe(NEW_BASE_URL);
    },
  );

  test("a project owner clears it", async () => {
    await LlmProviderService.updateOneById({
      id: new ObjectID(PROVIDER_ID),
      data: { baseUrl: null } as never,
      props: member([Permission.ProjectOwner]),
    });

    expect(stored("baseUrl")).toBeNull();
  });

  test("OneUptime itself changes it", async () => {
    await LlmProviderService.updateOneById({
      id: new ObjectID(PROVIDER_ID),
      data: { baseUrl: NEW_BASE_URL } as never,
      props: { isRoot: true },
    });

    expect(stored("baseUrl")).toBe(NEW_BASE_URL);
  });

  test.each(OTHER_WRITERS)(
    "a member holding %s still renames the provider",
    async (permission: Permission) => {
      await LlmProviderService.updateOneById({
        id: new ObjectID(PROVIDER_ID),
        data: { name: "Renamed provider" } as never,
        props: writer(permission),
      });

      expect(stored("name")).toBe("Renamed provider");
      expect(stored("baseUrl")).toBe(STORED_BASE_URL);
    },
  );

  test.each(OTHER_WRITERS)(
    "a member holding %s still replaces the Additional Parameters without reading them",
    async (permission: Permission) => {
      await LlmProviderService.updateOneById({
        id: new ObjectID(PROVIDER_ID),
        data: { additionalParams: { top_p: 0.9 } } as never,
        props: writer(permission),
      });

      expect(stored("additionalParams")).toEqual({ top_p: 0.9 });
    },
  );

  test.each([Permission.ProjectOwner, Permission.SettingsMember])(
    "a member holding %s may not write whether parameters are saved",
    async (permission: Permission) => {
      const error: unknown = await refusalOf(
        LlmProviderService.updateOneById({
          id: new ObjectID(PROVIDER_ID),
          data: { hasAdditionalParams: false } as never,
          props: writer(permission),
        }),
      );

      expect(error).toBeInstanceOf(ColumnWriteRefusedException);
      expect((error as ColumnWriteRefusedException).columnName).toBe(
        "hasAdditionalParams",
      );
    },
  );

  test("a member who may create providers gives a new one its Base URL and its own key", async () => {
    const provider: LlmProvider = new LlmProvider();
    provider.name = "Second provider";
    provider.llmType = "OpenAI" as never;
    provider.projectId = PROJECT_ID;
    provider.isDefault = false;
    provider.baseUrl = NEW_BASE_URL;

    const created: LlmProvider = await LlmProviderService.create({
      data: provider,
      props: member([Permission.SettingsMember]),
    });

    expect(providers.get(created.id!.toString())?.["baseUrl"]).toBe(
      NEW_BASE_URL,
    );
    // The provider it was created beside keeps its own address.
    expect(stored("baseUrl")).toBe(STORED_BASE_URL);
  });
});
