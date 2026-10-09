import LlmProviderService, {
  Service as LlmProviderServiceClass,
} from "../../../Server/Services/LlmProviderService";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";

/*
 * WHETHER AN LLM PROVIDER HAS ADDITIONAL PARAMETERS (hasAdditionalParams).
 *
 * The Additional Parameters are read by the project's owners and admins
 * alone, like the API key. The other members who read the provider see
 * whether any are saved, from a column OneUptime writes from the parameters
 * themselves:
 *
 *   - on every create, and on every update that writes the parameters, once
 *     the write has passed its permission checks (onCreatePermitted /
 *     onUpdatePermitted);
 *   - by one rule (LlmProviderService.hasAdditionalParams), which the
 *     migration that added the column asks of the stored parameters too;
 *   - never by a caller: an update that sends it is refused, and the value a
 *     create carries is replaced (the column is computed, so a create is not
 *     refused for it).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000001",
);
const PROVIDER_ID: string = "c4000000-0000-4000-8000-000000000002";

interface LlmProviderHookAccess {
  onCreatePermitted(onCreate: OnCreate<LlmProvider>): Promise<void>;
  onUpdatePermitted(updateBy: UpdateBy<LlmProvider>): Promise<void>;
}

const hooks: LlmProviderHookAccess =
  LlmProviderService as unknown as LlmProviderHookAccess;

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
            } as UserPermission;
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function onCreateOf(provider: LlmProvider): OnCreate<LlmProvider> {
  return {
    createBy: {
      data: provider,
      props: { isRoot: true },
    } as CreateBy<LlmProvider>,
    carryForward: null,
  };
}

function updateByOf(data: Record<string, unknown>): UpdateBy<LlmProvider> {
  return {
    query: {},
    data: data as never,
    props: { isRoot: true },
  } as unknown as UpdateBy<LlmProvider>;
}

describe("LlmProviderService.hasAdditionalParams - what counts as parameters", () => {
  test.each([
    ["nothing", undefined, false],
    ["null", null, false],
    ["an empty object", {}, false],
    ["an object with an entry", { temperature: 0.2 }, true],
    ["an empty list", [], false],
    ["a list with an entry", [1], true],
    ["empty text", "", false],
    ["blank text", " \t\n ", false],
    ["text", '{"top_p": 0.9}', true],
    ["zero", 0, true],
    ["false", false, true],
    ["true", true, true],
  ])("%s: %s", (_label: string, value: unknown, expected: boolean) => {
    expect(LlmProviderServiceClass.hasAdditionalParams(value)).toBe(expected);
  });
});

describe("LlmProviderService - recording it on a create", () => {
  test("a create with parameters records that they are saved", async () => {
    const provider: LlmProvider = new LlmProvider();
    provider.additionalParams = { temperature: 0.2 };

    const onCreate: OnCreate<LlmProvider> = onCreateOf(provider);
    await hooks.onCreatePermitted(onCreate);

    expect(onCreate.createBy.data.hasAdditionalParams).toBe(true);
  });

  test("a create without parameters records that none are", async () => {
    const onCreate: OnCreate<LlmProvider> = onCreateOf(new LlmProvider());
    await hooks.onCreatePermitted(onCreate);

    expect(onCreate.createBy.data.hasAdditionalParams).toBe(false);
  });

  test("the parameters decide, whatever the create carried", async () => {
    const provider: LlmProvider = new LlmProvider();
    provider.hasAdditionalParams = true;
    provider.additionalParams = {};

    const onCreate: OnCreate<LlmProvider> = onCreateOf(provider);
    await hooks.onCreatePermitted(onCreate);

    expect(onCreate.createBy.data.hasAdditionalParams).toBe(false);
  });
});

describe("LlmProviderService - recording it on an update", () => {
  test.each([
    ["new parameters", { temperature: 0.2 }, true],
    ["parameters cleared", null, false],
    ["an empty object", {}, false],
  ])(
    "an update that writes %s records it",
    async (_label: string, value: unknown, expected: boolean) => {
      const updateBy: UpdateBy<LlmProvider> = updateByOf({
        additionalParams: value,
      });

      await hooks.onUpdatePermitted(updateBy);

      expect(
        (updateBy.data as Record<string, unknown>)["hasAdditionalParams"],
      ).toBe(expected);
    },
  );

  test("an update that leaves the parameters leaves it", async () => {
    const updateBy: UpdateBy<LlmProvider> = updateByOf({ name: "Renamed" });

    await hooks.onUpdatePermitted(updateBy);

    expect(
      "hasAdditionalParams" in (updateBy.data as Record<string, unknown>),
    ).toBe(false);
  });
});

describe("LlmProviderService - through the write pipeline", () => {
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
        isGlobalLlm: false,
        isDefault: false,
        additionalParams: { temperature: 0.2 },
        hasAdditionalParams: true,
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

  test("a settings member who may not read the parameters may replace them, and it follows", async () => {
    await LlmProviderService.updateOneById({
      id: new ObjectID(PROVIDER_ID),
      data: { additionalParams: { top_p: 0.9 } } as never,
      props: member([Permission.SettingsMember]),
    });

    expect(stored("additionalParams")).toEqual({ top_p: 0.9 });
    expect(stored("hasAdditionalParams")).toBe(true);
  });

  test("clearing the parameters records that none are saved", async () => {
    await LlmProviderService.updateOneById({
      id: new ObjectID(PROVIDER_ID),
      data: { additionalParams: null } as never,
      props: member([Permission.SettingsMember]),
    });

    expect(stored("hasAdditionalParams")).toBe(false);
  });

  test("renaming the provider leaves it as it was", async () => {
    await LlmProviderService.updateOneById({
      id: new ObjectID(PROVIDER_ID),
      data: { name: "Renamed provider" } as never,
      props: member([Permission.SettingsMember]),
    });

    expect(stored("name")).toBe("Renamed provider");
    expect(stored("hasAdditionalParams")).toBe(true);
  });

  test.each([
    ["no parameters", undefined, false],
    ["parameters", { top_p: 0.9 }, true],
  ])(
    "a provider created with %s records it, whatever the create says",
    async (_label: string, parameters: unknown, expected: boolean) => {
      const provider: LlmProvider = new LlmProvider();
      provider.name = "Second provider";
      provider.llmType = "OpenAI" as never;
      provider.projectId = PROJECT_ID;
      provider.isDefault = false;
      provider.hasAdditionalParams = !expected;

      if (parameters !== undefined) {
        provider.additionalParams = parameters as never;
      }

      const created: LlmProvider = await LlmProviderService.create({
        data: provider,
        props: member([Permission.SettingsMember]),
      });

      expect(
        providers.get(created.id!.toString())?.["hasAdditionalParams"],
      ).toBe(expected);
    },
  );

  test.each([Permission.ProjectOwner, Permission.SettingsMember])(
    "a member holding %s may not set it",
    async (permission: Permission) => {
      await expect(
        LlmProviderService.updateOneById({
          id: new ObjectID(PROVIDER_ID),
          data: { hasAdditionalParams: false } as never,
          props: member([permission]),
        }),
      ).rejects.toBeInstanceOf(ColumnWriteRefusedException);

      expect(stored("hasAdditionalParams")).toBe(true);
    },
  );
});
