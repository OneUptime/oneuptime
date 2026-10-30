import CloudAccountService, {
  getCloudAccountAiResourceType,
} from "../../../Server/Services/CloudAccountService";
import CloudAccountFeedService from "../../../Server/Services/CloudAccountFeedService";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import UserService from "../../../Server/Services/UserService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import { CloudAccountFeedEventType } from "../../../Models/DatabaseModels/CloudAccountFeed";
import URL from "../../../Types/API/URL";
import { Blue500, Gray500, Yellow500 } from "../../../Types/BrandColors";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
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
 *   not read at all; one reaching accounts of two clouds is refused; the
 *   rows judged are the rows the update writes, read the way every hook
 *   reads them (findRowsAndHoldUpdateToThem, UpdateChecksReadHeldRows);
 * - a delete settles the rounds and removes the agents of every cloud's
 *   type (ResourceAiDeleteCleanup), each with its own carry-forward;
 * - what a person changed, and who, goes on the account's own feed
 *   (CloudAccountFeed), the log switch included - log lines can hold
 *   customer data, so letting AI read them is never unrecorded.
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
  onCreateSuccess: (
    onCreate: OnCreate<CloudAccount>,
    createdItem: CloudAccount,
  ) => Promise<CloudAccount>;
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

const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

function updateBy(
  data: Record<string, unknown>,
  props: Record<string, unknown> = { tenantId: PROJECT_ID, userId: USER_ID },
): UpdateBy<CloudAccount> {
  return {
    query: { _id: ACCOUNT_ID.toString(), projectId: PROJECT_ID },
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<CloudAccount>;
}

// An account as the update's held read returns it.
function heldAccount(
  provider: string,
  isAiLogReadEnabled: boolean,
): CloudAccount {
  const row: CloudAccount = account(provider);
  row.projectId = PROJECT_ID;
  row.isAiLogReadEnabled = isAiLogReadEnabled;
  return row;
}

// What onUpdateSuccess wrote to the account's feed.
function feedWrites(spy: ReturnType<typeof jest.spyOn>): Array<{
  cloudAccountId: ObjectID;
  projectId: ObjectID;
  cloudAccountFeedEventType: CloudAccountFeedEventType;
  displayColor: unknown;
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string;
  userId?: ObjectID;
}> {
  return spy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as never;
  });
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
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(CloudAccountService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([]);
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(CloudAccountService, "findBy")
      .mockResolvedValue([]);
    const check: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ResourceAiAccessSettings,
      "checkUpdate",
    );

    const result: OnUpdate<CloudAccount> = await hooks.onBeforeUpdate(
      updateBy({ description: "prod" }),
    );

    expect(find).not.toHaveBeenCalled();
    expect(findBy).not.toHaveBeenCalled();
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
        .spyOn(CloudAccountService, "findRowsAndHoldUpdateToThem")
        .mockResolvedValue([account(provider)]);
      const check: ReturnType<typeof jest.spyOn> = jest
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

  test("the account's rows are the update's own, read and held through the update itself", async () => {
    const held: ReturnType<typeof jest.spyOn> = jest
      .spyOn(CloudAccountService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([account("aws")]);
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      CloudAccountService,
      "findBy",
    );
    jest.spyOn(ResourceAiAccessSettings, "checkUpdate").mockResolvedValue(null);

    const written: UpdateBy<CloudAccount> = updateBy({
      aiCommandAllowlist: [],
    });

    await hooks.onBeforeUpdate(written);

    /*
     * The hold reads the rows the caller may write in the update's own
     * window and narrows the update to them; a read of its query as root
     * would judge rows of other projects, or rows the update never writes.
     */
    expect(held).toHaveBeenCalledTimes(1);
    expect(held.mock.calls[0]![0]).toBe(written);
    expect(held.mock.calls[0]![1]).toEqual({
      _id: true,
      projectId: true,
      provider: true,
      isAiLogReadEnabled: true,
    });
    expect(findBy).not.toHaveBeenCalled();
  });

  test("the log switch and the server-only columns are checked too", async () => {
    for (const data of [
      { isAiLogReadEnabled: true },
      { aiAccessLastError: "x" },
      { isAiInvestigationEnabled: false },
    ]) {
      jest.restoreAllMocks();
      jest
        .spyOn(CloudAccountService, "findRowsAndHoldUpdateToThem")
        .mockResolvedValue([account("gcp")]);
      const check: ReturnType<typeof jest.spyOn> = jest
        .spyOn(ResourceAiAccessSettings, "checkUpdate")
        .mockResolvedValue(null);

      await hooks.onBeforeUpdate(updateBy(data));

      expect(check).toHaveBeenCalledTimes(1);
    }
  });

  test("that reaches accounts of two clouds is refused", async () => {
    jest
      .spyOn(CloudAccountService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([account("aws"), account("azure")]);
    const check: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ResourceAiAccessSettings,
      "checkUpdate",
    );

    await expect(
      hooks.onBeforeUpdate(
        updateBy({ aiRemediationMode: ResourceAiRemediationMode.Disabled }),
      ),
    ).rejects.toThrow(BadDataException);
    expect(check).not.toHaveBeenCalled();
  });

  test("a refusal of the rules stops the update", async () => {
    jest
      .spyOn(CloudAccountService, "findRowsAndHoldUpdateToThem")
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

  test("the shared rules' carry-forward reaches their success hook as they wrote it", async () => {
    jest
      .spyOn(CloudAccountService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([heldAccount("aws", false)]);
    const shared: Record<string, unknown> = {
      resourceType: AiResourceType.AwsAccount,
      previousResourceAiAccessSettings: {},
    };
    jest
      .spyOn(ResourceAiAccessSettings, "checkUpdate")
      .mockResolvedValue(shared as never);
    const after: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ResourceAiAccessSettings, "afterUpdate")
      .mockResolvedValue();

    const onUpdate: OnUpdate<CloudAccount> = await hooks.onBeforeUpdate(
      updateBy({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
    );

    await hooks.onUpdateSuccess(onUpdate, [ACCOUNT_ID]);

    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0]![0].onUpdate.carryForward).toBe(shared);
    expect(after.mock.calls[0]![0].updatedItemIds).toEqual([ACCOUNT_ID]);
  });

  test("after a write, the change goes on the account's own feed, as an update, under its link", async () => {
    const after: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ResourceAiAccessSettings, "afterUpdate")
      .mockResolvedValue();
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(CloudAccountFeedService, "createCloudAccountFeedItem")
      .mockResolvedValue();
    const link: ReturnType<typeof jest.spyOn> = jest
      .spyOn(CloudAccountService, "getCloudAccountMarkdownLink")
      .mockResolvedValue(mdText`[AWS account prod](https://x.example)`);
    const onUpdate: OnUpdate<CloudAccount> = {
      updateBy: updateBy({ aiRemediationMode: "Automatic" }),
      carryForward: null,
    };

    await hooks.onUpdateSuccess(onUpdate, [ACCOUNT_ID]);

    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0]![0].updatedItemIds).toEqual([ACCOUNT_ID]);

    // The shared writer names the account by the account's own link.
    await expect(
      after.mock.calls[0]![0].getResourceMarkdownLink(PROJECT_ID, ACCOUNT_ID),
    ).resolves.toEqual(mdText`[AWS account prod](https://x.example)`);
    expect(link.mock.calls[0]).toEqual([PROJECT_ID, ACCOUNT_ID]);

    await after.mock.calls[0]![0].createFeedItem({
      resourceId: ACCOUNT_ID,
      projectId: PROJECT_ID,
      displayColor: Yellow500,
      feedInfoInMarkdown: "changed",
      moreInformationInMarkdown: "by",
      userId: USER_ID,
    });

    expect(feedWrites(feed)).toEqual([
      {
        cloudAccountId: ACCOUNT_ID,
        projectId: PROJECT_ID,
        cloudAccountFeedEventType:
          CloudAccountFeedEventType.CloudAccountUpdated,
        displayColor: Yellow500,
        feedInfoInMarkdown: "changed",
        moreInformationInMarkdown: "by",
        userId: USER_ID,
      },
    ]);
  });
});

describe("the log switch on an account's feed", () => {
  function stubWrite(isOnBefore: boolean): {
    feed: ReturnType<typeof jest.spyOn>;
  } {
    jest
      .spyOn(CloudAccountService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([heldAccount("gcp", isOnBefore)]);
    jest.spyOn(ResourceAiAccessSettings, "checkUpdate").mockResolvedValue(null);
    jest.spyOn(ResourceAiAccessSettings, "afterUpdate").mockResolvedValue();
    jest
      .spyOn(CloudAccountService, "getCloudAccountMarkdownLink")
      .mockResolvedValue(
        mdText`[Google Cloud project shop](https://x.example)`,
      );
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue(mdText`[Ada](https://x.example/user)`);

    return {
      feed: jest
        .spyOn(CloudAccountFeedService, "createCloudAccountFeedItem")
        .mockResolvedValue(),
    };
  }

  test("turned on by a person: one yellow entry naming them, the account and what it now reads", async () => {
    const { feed } = stubWrite(false);

    const onUpdate: OnUpdate<CloudAccount> = await hooks.onBeforeUpdate(
      updateBy({ isAiLogReadEnabled: true }),
    );
    await hooks.onUpdateSuccess(onUpdate, [ACCOUNT_ID]);

    const writes: ReturnType<typeof feedWrites> = feedWrites(feed);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.cloudAccountId).toBe(ACCOUNT_ID);
    expect(writes[0]!.projectId).toBe(PROJECT_ID);
    expect(writes[0]!.cloudAccountFeedEventType).toBe(
      CloudAccountFeedEventType.CloudAccountUpdated,
    );
    expect(writes[0]!.displayColor).toBe(Yellow500);
    expect(writes[0]!.userId).toBe(USER_ID);
    expect(writes[0]!.feedInfoInMarkdown).toContain(
      "**[Ada](https://x.example/user)** changed what OneUptime AI may do on [Google Cloud project shop](https://x.example)",
    );
    expect(writes[0]!.feedInfoInMarkdown).toContain(
      "- Reading the account's log lines during investigations turned **on**",
    );
    expect(writes[0]!.moreInformationInMarkdown).toContain(
      "Log lines can hold customer data.",
    );
  });

  test("turned off: one grey entry", async () => {
    const { feed } = stubWrite(true);

    const onUpdate: OnUpdate<CloudAccount> = await hooks.onBeforeUpdate(
      updateBy({ isAiLogReadEnabled: false }),
    );
    await hooks.onUpdateSuccess(onUpdate, [ACCOUNT_ID]);

    const writes: ReturnType<typeof feedWrites> = feedWrites(feed);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.displayColor).toBe(Gray500);
    expect(writes[0]!.feedInfoInMarkdown).toContain("turned **off**");
    expect(writes[0]!.moreInformationInMarkdown).toBe(
      "Investigations no longer read this account's log lines.",
    );
  });

  test("a save that leaves the switch where it stood records nothing", async () => {
    const { feed } = stubWrite(true);

    const onUpdate: OnUpdate<CloudAccount> = await hooks.onBeforeUpdate(
      updateBy({ isAiLogReadEnabled: true }),
    );
    await hooks.onUpdateSuccess(onUpdate, [ACCOUNT_ID]);

    expect(feed).not.toHaveBeenCalled();
  });

  test("a write with no user is an API key's", async () => {
    const { feed } = stubWrite(false);

    const onUpdate: OnUpdate<CloudAccount> = await hooks.onBeforeUpdate(
      updateBy({ isAiLogReadEnabled: true }, { tenantId: PROJECT_ID }),
    );
    await hooks.onUpdateSuccess(onUpdate, [ACCOUNT_ID]);

    const writes: ReturnType<typeof feedWrites> = feedWrites(feed);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.feedInfoInMarkdown).toContain(
      "🤖 An API key changed what OneUptime AI may do on",
    );
    expect(writes[0]!).not.toHaveProperty("userId");
  });

  test("a user who cannot be read is 'A user', never left out", async () => {
    const { feed } = stubWrite(false);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue(mdText``);

    const onUpdate: OnUpdate<CloudAccount> = await hooks.onBeforeUpdate(
      updateBy({ isAiLogReadEnabled: true }),
    );
    await hooks.onUpdateSuccess(onUpdate, [ACCOUNT_ID]);

    expect(feedWrites(feed)[0]!.feedInfoInMarkdown).toContain(
      "🤖 **A user** changed what OneUptime AI may do on",
    );
  });

  test("OneUptime's own writes carry nothing for the switch", async () => {
    stubWrite(false);

    const onUpdate: OnUpdate<CloudAccount> = await hooks.onBeforeUpdate(
      updateBy({ isAiLogReadEnabled: true }, { isRoot: true }),
    );

    expect(onUpdate.carryForward).toBeNull();
  });

  test("an account the update did not reach records nothing", async () => {
    const { feed } = stubWrite(false);

    const onUpdate: OnUpdate<CloudAccount> = await hooks.onBeforeUpdate(
      updateBy({ isAiLogReadEnabled: true }),
    );
    await hooks.onUpdateSuccess(onUpdate, [ObjectID.generate()]);

    expect(feed).not.toHaveBeenCalled();
  });

  test("a feed write that throws never fails the update it describes", async () => {
    const { feed } = stubWrite(false);
    feed.mockRejectedValue(new Error("database down"));

    const onUpdate: OnUpdate<CloudAccount> = await hooks.onBeforeUpdate(
      updateBy({ isAiLogReadEnabled: true }),
    );

    await expect(hooks.onUpdateSuccess(onUpdate, [ACCOUNT_ID])).resolves.toBe(
      onUpdate,
    );
  });
});

describe("how an account's feed starts", () => {
  function created(data: {
    connectionId?: ObjectID | undefined;
    createdByUserId?: ObjectID | undefined;
  }): CloudAccount {
    const row: CloudAccount = account("aws");
    row.id = ACCOUNT_ID;
    row.projectId = PROJECT_ID;

    if (data.connectionId) {
      row.cloudConnectionId = data.connectionId;
    }

    if (data.createdByUserId) {
      row.createdByUserId = data.createdByUserId;
    }

    return row;
  }

  function onCreate(
    props: Record<string, unknown> = { isRoot: true },
  ): OnCreate<CloudAccount> {
    return {
      createBy: { data: new CloudAccount(), props },
      carryForward: null,
    } as unknown as OnCreate<CloudAccount>;
  }

  function stubFeed(): ReturnType<typeof jest.spyOn> {
    jest
      .spyOn(CloudAccountService, "getCloudAccountMarkdownLink")
      .mockResolvedValue(mdText`[AWS account prod](https://x.example)`);

    return jest
      .spyOn(CloudAccountFeedService, "createCloudAccountFeedItem")
      .mockResolvedValue();
  }

  test("found by a cloud connection: the connection that first read it, by name", async () => {
    const feed: ReturnType<typeof jest.spyOn> = stubFeed();
    const connectionId: ObjectID = ObjectID.generate();
    const lookup: ReturnType<typeof jest.spyOn> = jest
      .spyOn(CloudConnectionService, "findOneById")
      .mockResolvedValue({ name: " prod-read " } as never);

    const row: CloudAccount = created({ connectionId });

    await expect(hooks.onCreateSuccess(onCreate(), row)).resolves.toBe(row);

    expect(lookup.mock.calls[0]![0]).toEqual({
      id: connectionId,
      select: { name: true },
      props: { isRoot: true },
    });
    expect(feedWrites(feed)).toEqual([
      {
        cloudAccountId: ACCOUNT_ID,
        projectId: PROJECT_ID,
        cloudAccountFeedEventType:
          CloudAccountFeedEventType.CloudAccountCreated,
        displayColor: Blue500,
        feedInfoInMarkdown:
          "☁️ OneUptime found [AWS account prod](https://x.example) when the cloud connection **prod-read** first read it.",
      },
    ]);
  });

  test("a connection whose name cannot be read is still named as a connection", async () => {
    const feed: ReturnType<typeof jest.spyOn> = stubFeed();
    jest.spyOn(CloudConnectionService, "findOneById").mockResolvedValue(null);

    await hooks.onCreateSuccess(
      onCreate(),
      created({ connectionId: ObjectID.generate() }),
    );

    expect(feedWrites(feed)[0]!.feedInfoInMarkdown).toBe(
      "☁️ OneUptime found [AWS account prod](https://x.example) when a cloud connection first read it.",
    );
  });

  test("added by a person: who added it, credited on the entry", async () => {
    const feed: ReturnType<typeof jest.spyOn> = stubFeed();
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue(mdText`[Ada](https://x.example/user)`);

    await hooks.onCreateSuccess(
      onCreate({ tenantId: PROJECT_ID, userId: USER_ID }),
      created({ connectionId: ObjectID.generate() }),
    );

    const writes: ReturnType<typeof feedWrites> = feedWrites(feed);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.feedInfoInMarkdown).toBe(
      "☁️ **[Ada](https://x.example/user)** added [AWS account prod](https://x.example).",
    );
    expect(writes[0]!.userId).toBe(USER_ID);
  });

  test("the row's own creator counts as the person, too", async () => {
    const feed: ReturnType<typeof jest.spyOn> = stubFeed();
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue(mdText``);

    await hooks.onCreateSuccess(
      onCreate(),
      created({ createdByUserId: USER_ID }),
    );

    expect(feedWrites(feed)[0]!.feedInfoInMarkdown).toBe(
      "☁️ **A user** added [AWS account prod](https://x.example).",
    );
    expect(feedWrites(feed)[0]!.userId).toBe(USER_ID);
  });

  test("neither a connection nor a person: it was added", async () => {
    const feed: ReturnType<typeof jest.spyOn> = stubFeed();

    await hooks.onCreateSuccess(onCreate(), created({}));

    expect(feedWrites(feed)[0]!.feedInfoInMarkdown).toBe(
      "☁️ [AWS account prod](https://x.example) was added.",
    );
  });

  test("a failure on the way never fails the create", async () => {
    jest
      .spyOn(CloudAccountService, "getCloudAccountMarkdownLink")
      .mockRejectedValue(new Error("database down"));
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(CloudAccountFeedService, "createCloudAccountFeedItem")
      .mockResolvedValue();

    const row: CloudAccount = created({});

    await expect(hooks.onCreateSuccess(onCreate(), row)).resolves.toBe(row);
    expect(feed).not.toHaveBeenCalled();
  });
});

describe("how a feed entry names an account", () => {
  function stubAccount(row: Record<string, unknown> | null): void {
    jest
      .spyOn(CloudAccountService, "findOneById")
      .mockResolvedValue(row as never);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.example/dashboard"));
  }

  test.each([
    ["aws", "AWS account"],
    ["azure", "Azure subscription"],
    ["gcp", "Google Cloud project"],
  ])(
    "a %s account by its cloud's noun and its name, linked to its Overview",
    async (provider: string, noun: string) => {
      stubAccount({ provider, name: " prod ", accountId: "123456789012" });

      const link: string = (
        await CloudAccountService.getCloudAccountMarkdownLink(
          PROJECT_ID,
          ACCOUNT_ID,
        )
      ).toString();

      expect(link).toBe(
        `[${noun} prod](https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/cloud/accounts/${ACCOUNT_ID.toString()})`,
      );
    },
  );

  test("an account without a name by its id", async () => {
    stubAccount({ provider: "aws", name: "", accountId: "123456789012" });

    expect(
      (
        await CloudAccountService.getCloudAccountMarkdownLink(
          PROJECT_ID,
          ACCOUNT_ID,
        )
      ).toString(),
    ).toContain("[AWS account 123456789012](");
  });

  test("a name that holds Markdown is written as text", async () => {
    stubAccount({ provider: "aws", name: "[x](javascript:y)", accountId: "1" });

    const link: string = (
      await CloudAccountService.getCloudAccountMarkdownLink(
        PROJECT_ID,
        ACCOUNT_ID,
      )
    ).toString();

    // Escaped where it sits: the name cannot close the link's words or open a link of its own.
    expect(link).toBe(
      mdText`[AWS account ${"[x](javascript:y)"}](${`https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/cloud/accounts/${ACCOUNT_ID.toString()}`})`.toString(),
    );
    expect(link).not.toContain("[x](javascript:y)");
  });

  test("an account that is gone still gets a link, by the cloud's word", async () => {
    stubAccount(null);

    expect(
      (
        await CloudAccountService.getCloudAccountMarkdownLink(
          PROJECT_ID,
          ACCOUNT_ID,
        )
      ).toString(),
    ).toBe(
      `[Cloud account](https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/cloud/accounts/${ACCOUNT_ID.toString()})`,
    );
  });
});

describe("a create of an account", () => {
  test("is checked as its cloud's type", async () => {
    const check: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ResourceAiAccessSettings, "checkCreate")
      .mockReturnValue();

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
    const before: ReturnType<typeof jest.spyOn> = jest
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
    const after: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ResourceAiDeleteCleanup, "afterDelete")
      .mockResolvedValue();

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
    const after: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ResourceAiDeleteCleanup, "afterDelete")
      .mockResolvedValue();

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
