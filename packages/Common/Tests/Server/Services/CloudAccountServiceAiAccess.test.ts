import CloudAccountService, {
  getCloudAccountAiResourceType,
} from "../../../Server/Services/CloudAccountService";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import ResourceAiAccessSettings from "../../../Server/Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import ResourceAiDeleteCleanup, {
  ResourceAiDeleteCarryForward,
} from "../../../Server/Utils/AI/ResourceAccess/ResourceAiDeleteCleanup";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  CLOUD_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A cloud account's OneUptime AI access goes through the rules every
 * resource an AI agent serves shares — once its cloud says which AI
 * resource type it is (one table for the three clouds):
 *
 * - a create or an update that writes an AI setting is checked for the
 *   account's own type (ResourceAiAccessSettings); one that writes none is
 *   not read at all; one reaching accounts of two clouds is refused;
 * - a delete settles the rounds and removes the agents of every cloud's
 *   type (ResourceAiDeleteCleanup), each with its own carry-forward.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ACCOUNT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface Hooks {
  onBeforeCreate: (
    createBy: CreateBy<CloudAccount>,
  ) => Promise<OnCreate<CloudAccount>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<CloudAccount>,
  ) => Promise<OnUpdate<CloudAccount>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<CloudAccount>,
    ids: Array<ObjectID>,
  ) => Promise<OnUpdate<CloudAccount>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<CloudAccount>,
  ) => Promise<OnDelete<CloudAccount>>;
  onDeleteSuccess: (
    onDelete: OnDelete<CloudAccount>,
    ids: Array<ObjectID>,
  ) => Promise<OnDelete<CloudAccount>>;
}

const hooks: Hooks = CloudAccountService as unknown as Hooks;

function account(provider: string): CloudAccount {
  const row: CloudAccount = new CloudAccount();
  row._id = ACCOUNT_ID.toString();
  row.provider = provider as never;
  return row;
}

function updateBy(data: Record<string, unknown>): UpdateBy<CloudAccount> {
  return {
    query: { _id: ACCOUNT_ID.toString(), projectId: PROJECT_ID },
    data,
    limit: 1,
    skip: 0,
    props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
  } as unknown as UpdateBy<CloudAccount>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which AI resource type an account is", () => {
  test("its cloud decides", () => {
    expect(getCloudAccountAiResourceType("aws")).toBe(
      AiResourceType.AwsAccount,
    );
    expect(getCloudAccountAiResourceType("azure")).toBe(
      AiResourceType.AzureSubscription,
    );
    expect(getCloudAccountAiResourceType("gcp")).toBe(
      AiResourceType.GoogleCloudProject,
    );
    expect(getCloudAccountAiResourceType("oracle")).toBeNull();
    expect(getCloudAccountAiResourceType(undefined)).toBeNull();
  });
});

describe("an update of an account", () => {
  test("that writes no AI setting is not read, and nothing is checked", async () => {
    const find: jest.SpiedFunction<typeof CloudAccountService.findBy> = jest
      .spyOn(CloudAccountService, "findBy")
      .mockResolvedValue([]);
    const check: jest.SpiedFunction<
      typeof ResourceAiAccessSettings.checkUpdate
    > = jest.spyOn(ResourceAiAccessSettings, "checkUpdate");

    const result: OnUpdate<CloudAccount> = await hooks.onBeforeUpdate(
      updateBy({ description: "prod" }),
    );

    expect(find).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(result.carryForward).toBeNull();
  });

  test.each([
    ["aws", AiResourceType.AwsAccount],
    ["azure", AiResourceType.AzureSubscription],
    ["gcp", AiResourceType.GoogleCloudProject],
  ])(
    "that writes an AI setting on a %s account is checked as a %s",
    async (provider: string, type: AiResourceType) => {
      jest
        .spyOn(CloudAccountService, "findBy")
        .mockResolvedValue([account(provider)]);
      const check: jest.SpiedFunction<
        typeof ResourceAiAccessSettings.checkUpdate
      > = jest
        .spyOn(ResourceAiAccessSettings, "checkUpdate")
        .mockResolvedValue(null);

      const written: UpdateBy<CloudAccount> = updateBy({
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
      });

      await hooks.onBeforeUpdate(written);

      expect(check).toHaveBeenCalledTimes(1);
      expect(check.mock.calls[0]![0].resourceType).toBe(type);
      expect(check.mock.calls[0]![0].updateBy).toBe(written);
    },
  );

  test("the account's rows are read as root, by the update's own query", async () => {
    const find: jest.SpiedFunction<typeof CloudAccountService.findBy> = jest
      .spyOn(CloudAccountService, "findBy")
      .mockResolvedValue([account("aws")]);
    jest.spyOn(ResourceAiAccessSettings, "checkUpdate").mockResolvedValue(null);

    const written: UpdateBy<CloudAccount> = updateBy({
      aiCommandAllowlist: [],
    });

    await hooks.onBeforeUpdate(written);

    expect(find.mock.calls[0]![0].query).toBe(written.query);
    expect(find.mock.calls[0]![0].props).toEqual({ isRoot: true });
  });

  test("the log switch and the server-only columns are checked too", async () => {
    for (const data of [
      { isAiLogReadEnabled: true },
      { aiAccessLastError: "x" },
      { isAiInvestigationEnabled: false },
    ]) {
      jest.restoreAllMocks();
      jest
        .spyOn(CloudAccountService, "findBy")
        .mockResolvedValue([account("gcp")]);
      const check: jest.SpiedFunction<
        typeof ResourceAiAccessSettings.checkUpdate
      > = jest
        .spyOn(ResourceAiAccessSettings, "checkUpdate")
        .mockResolvedValue(null);

      await hooks.onBeforeUpdate(updateBy(data));

      expect(check).toHaveBeenCalledTimes(1);
    }
  });

  test("that reaches accounts of two clouds is refused", async () => {
    jest
      .spyOn(CloudAccountService, "findBy")
      .mockResolvedValue([account("aws"), account("azure")]);
    const check: jest.SpiedFunction<
      typeof ResourceAiAccessSettings.checkUpdate
    > = jest.spyOn(ResourceAiAccessSettings, "checkUpdate");

    await expect(
      hooks.onBeforeUpdate(
        updateBy({ aiRemediationMode: ResourceAiRemediationMode.Disabled }),
      ),
    ).rejects.toThrow(BadDataException);
    expect(check).not.toHaveBeenCalled();
  });

  test("a refusal of the rules stops the update", async () => {
    jest
      .spyOn(CloudAccountService, "findBy")
      .mockResolvedValue([account("aws")]);
    jest
      .spyOn(ResourceAiAccessSettings, "checkUpdate")
      .mockRejectedValue(new BadDataException("not allowed"));

    await expect(
      hooks.onBeforeUpdate(
        updateBy({
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        }),
      ),
    ).rejects.toThrow("not allowed");
  });

  test("after a write, the account is marked AI-configured, without a feed", async () => {
    const after: jest.SpiedFunction<
      typeof ResourceAiAccessSettings.afterUpdate
    > = jest.spyOn(ResourceAiAccessSettings, "afterUpdate").mockResolvedValue();
    const onUpdate: OnUpdate<CloudAccount> = {
      updateBy: updateBy({ aiRemediationMode: "Automatic" }),
      carryForward: null,
    };

    await hooks.onUpdateSuccess(onUpdate, [ACCOUNT_ID]);

    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0]![0].updatedItemIds).toEqual([ACCOUNT_ID]);
    await expect(
      after.mock.calls[0]![0].createFeedItem(undefined as never),
    ).resolves.toBeUndefined();
  });
});

describe("a create of an account", () => {
  test("is checked as its cloud's type", async () => {
    const check: jest.SpiedFunction<
      typeof ResourceAiAccessSettings.checkCreate
    > = jest.spyOn(ResourceAiAccessSettings, "checkCreate").mockReturnValue();

    const row: CloudAccount = account("azure");
    row.projectId = PROJECT_ID;

    await hooks.onBeforeCreate({
      data: row,
      props: { isRoot: true },
    } as unknown as CreateBy<CloudAccount>);

    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0]![0].resourceType).toBe(
      AiResourceType.AzureSubscription,
    );
  });
});

describe("a delete of an account", () => {
  test("cleans up the rounds and agents of every cloud's type, each on its own", async () => {
    const before: jest.SpiedFunction<
      typeof ResourceAiDeleteCleanup.beforeDelete
    > = jest
      .spyOn(ResourceAiDeleteCleanup, "beforeDelete")
      .mockImplementation(
        async (data: {
          resourceType: AiResourceType;
        }): Promise<ResourceAiDeleteCarryForward> => {
          return {
            resourceType: data.resourceType,
            inFlightRounds: [],
            resourceNames: {},
          };
        },
      );
    const after: jest.SpiedFunction<
      typeof ResourceAiDeleteCleanup.afterDelete
    > = jest.spyOn(ResourceAiDeleteCleanup, "afterDelete").mockResolvedValue();

    const deleteBy: DeleteBy<CloudAccount> = {
      query: { _id: ACCOUNT_ID.toString() },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    } as unknown as DeleteBy<CloudAccount>;

    const onDelete: OnDelete<CloudAccount> =
      await hooks.onBeforeDelete(deleteBy);

    expect(
      before.mock.calls.map((call: Array<{ resourceType: AiResourceType }>) => {
        return call[0]!.resourceType;
      }),
    ).toEqual([...CLOUD_AI_RESOURCE_TYPES]);

    await hooks.onDeleteSuccess(onDelete, [ACCOUNT_ID]);

    expect(after).toHaveBeenCalledTimes(3);

    for (const [index, type] of CLOUD_AI_RESOURCE_TYPES.entries()) {
      const call: {
        resourceType: AiResourceType;
        onDelete: OnDelete<CloudAccount>;
        deletedItemIds: Array<ObjectID>;
      } = after.mock.calls[index]![0] as never;

      expect(call.resourceType).toBe(type);
      // Each cloud's cleanup gets its own carry-forward.
      expect(
        (call.onDelete.carryForward as ResourceAiDeleteCarryForward)
          .resourceType,
      ).toBe(type);
      expect(call.deletedItemIds).toEqual([ACCOUNT_ID]);
    }
  });

  test("a delete without the carry-forward cleans nothing up", async () => {
    const after: jest.SpiedFunction<
      typeof ResourceAiDeleteCleanup.afterDelete
    > = jest.spyOn(ResourceAiDeleteCleanup, "afterDelete").mockResolvedValue();

    await hooks.onDeleteSuccess(
      {
        deleteBy: {} as never,
        carryForward: null,
      },
      [ACCOUNT_ID],
    );

    expect(after).not.toHaveBeenCalled();
  });
});
