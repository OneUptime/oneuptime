import ThreatIntelFeedService from "../../../Server/Services/ThreatIntelFeedService";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ThreatIntelFeedService validates at save time so a feed that stores is
 * a feed the poller can use — a malformed TAXII URL or out-of-range
 * interval surfaces to the person configuring the feed, not as a
 * cron-side lastError an hour later. These tests drive the create/update
 * hooks directly, the DetectionRuleService test discipline.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<ThreatIntelFeed>,
  ) => Promise<OnCreate<ThreatIntelFeed>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<ThreatIntelFeed>,
  ) => Promise<OnUpdate<ThreatIntelFeed>>;
};

const service: HookCaller = ThreatIntelFeedService as unknown as HookCaller;

function buildFeed(
  options: {
    apiRootUrl?: string | undefined;
    collectionId?: string | undefined;
    apiToken?: string;
    basicAuthPassword?: string;
    pollIntervalInMinutes?: number;
    minimumConfidence?: number;
  } = {},
): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed.projectId = PROJECT_ID;
  feed.name = "Test Feed";
  feed.apiRootUrl =
    "apiRootUrl" in options
      ? (options.apiRootUrl as string)
      : "https://taxii.example.com/api1/";
  feed.collectionId =
    "collectionId" in options ? (options.collectionId as string) : "col-1";
  if (options.apiToken !== undefined) {
    feed.apiToken = options.apiToken;
  }
  if (options.basicAuthPassword !== undefined) {
    feed.basicAuthPassword = options.basicAuthPassword;
  }
  if (options.pollIntervalInMinutes !== undefined) {
    feed.pollIntervalInMinutes = options.pollIntervalInMinutes;
  }
  if (options.minimumConfidence !== undefined) {
    feed.minimumConfidence = options.minimumConfidence;
  }
  return feed;
}

function createBy(feed: ThreatIntelFeed): CreateBy<ThreatIntelFeed> {
  return {
    data: feed,
    props: { isRoot: true },
  } as CreateBy<ThreatIntelFeed>;
}

function updateBy(data: Partial<ThreatIntelFeed>): UpdateBy<ThreatIntelFeed> {
  return {
    query: { projectId: PROJECT_ID },
    data,
    props: { isRoot: true },
  } as unknown as UpdateBy<ThreatIntelFeed>;
}

describe("ThreatIntelFeedService.onBeforeCreate", () => {
  test("accepts a valid anonymous feed", async () => {
    await expect(
      service.onBeforeCreate(createBy(buildFeed())),
    ).resolves.toBeDefined();
  });

  test("accepts token-auth and basic-auth feeds, but not both together", async () => {
    await expect(
      service.onBeforeCreate(createBy(buildFeed({ apiToken: "tok" }))),
    ).resolves.toBeDefined();

    await expect(
      service.onBeforeCreate(
        createBy(buildFeed({ basicAuthPassword: "hunter2" })),
      ),
    ).resolves.toBeDefined();

    await expect(
      service.onBeforeCreate(
        createBy(buildFeed({ apiToken: "tok", basicAuthPassword: "hunter2" })),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("requires the API root URL and collection id", async () => {
    await expect(
      service.onBeforeCreate(createBy(buildFeed({ apiRootUrl: undefined }))),
    ).rejects.toThrow(BadDataException);

    await expect(
      service.onBeforeCreate(createBy(buildFeed({ collectionId: undefined }))),
    ).rejects.toThrow(BadDataException);
  });

  test("rejects non-http(s) or malformed TAXII roots at save time", async () => {
    await expect(
      service.onBeforeCreate(createBy(buildFeed({ apiRootUrl: "not a url" }))),
    ).rejects.toThrow(BadDataException);

    await expect(
      service.onBeforeCreate(
        createBy(buildFeed({ apiRootUrl: "ftp://taxii.example.com/" })),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("rejects collection ids that are not plain identifiers", async () => {
    await expect(
      service.onBeforeCreate(
        createBy(buildFeed({ collectionId: "a/../../etc" })),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("clamps poll interval to whole minutes between 1 and 1440", async () => {
    for (const bad of [0, -5, 2000, 1.5]) {
      await expect(
        service.onBeforeCreate(
          createBy(buildFeed({ pollIntervalInMinutes: bad })),
        ),
      ).rejects.toThrow(BadDataException);
    }

    await expect(
      service.onBeforeCreate(
        createBy(buildFeed({ pollIntervalInMinutes: 1440 })),
      ),
    ).resolves.toBeDefined();
  });

  test("clamps minimum confidence to whole numbers between 0 and 100", async () => {
    for (const bad of [-1, 101, 50.5]) {
      await expect(
        service.onBeforeCreate(createBy(buildFeed({ minimumConfidence: bad }))),
      ).rejects.toThrow(BadDataException);
    }

    await expect(
      service.onBeforeCreate(createBy(buildFeed({ minimumConfidence: 0 }))),
    ).resolves.toBeDefined();
    await expect(
      service.onBeforeCreate(createBy(buildFeed({ minimumConfidence: 100 }))),
    ).resolves.toBeDefined();
  });
});

describe("ThreatIntelFeedService.onBeforeUpdate", () => {
  test("validates only the fields present in the update", async () => {
    // No validated fields at all: passes.
    await expect(
      service.onBeforeUpdate(updateBy({ name: "renamed" })),
    ).resolves.toBeDefined();

    await expect(
      service.onBeforeUpdate(updateBy({ apiRootUrl: "not a url" })),
    ).rejects.toThrow(BadDataException);

    await expect(
      service.onBeforeUpdate(updateBy({ pollIntervalInMinutes: 0 })),
    ).rejects.toThrow(BadDataException);

    await expect(
      service.onBeforeUpdate(updateBy({ minimumConfidence: 500 })),
    ).rejects.toThrow(BadDataException);

    await expect(
      service.onBeforeUpdate(
        updateBy({ apiRootUrl: "https://new-taxii.example.com/root/" }),
      ),
    ).resolves.toBeDefined();
  });
});

describe("ThreatIntelFeedService — credential exclusivity on update", () => {
  type Spy = ReturnType<typeof getJestSpyOn>;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubStoredFeeds(
    options: {
      apiToken?: string;
      basicAuthPassword?: string;
    } = {},
  ): Spy {
    const stored: ThreatIntelFeed = new ThreatIntelFeed();
    stored._id = new ObjectID(
      "44444444-4444-4444-8444-444444444444",
    ).toString();
    if (options.apiToken) {
      stored.apiToken = options.apiToken;
    }
    if (options.basicAuthPassword) {
      stored.basicAuthPassword = options.basicAuthPassword;
    }

    return getJestSpyOn(ThreatIntelFeedService, "findBy").mockResolvedValue([
      stored,
    ] as never);
  }

  test("setting both credential kinds in one update is rejected", async () => {
    await expect(
      service.onBeforeUpdate(
        updateBy({ apiToken: "tok", basicAuthPassword: "hunter2" }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("setting a token while the row stores a basic-auth password is rejected", async () => {
    stubStoredFeeds({ basicAuthPassword: "hunter2" });

    await expect(
      service.onBeforeUpdate(updateBy({ apiToken: "tok" })),
    ).rejects.toThrow(BadDataException);
  });

  test("setting a basic-auth password while the row stores a token is rejected", async () => {
    stubStoredFeeds({ apiToken: "tok" });

    await expect(
      service.onBeforeUpdate(updateBy({ basicAuthPassword: "hunter2" })),
    ).rejects.toThrow(BadDataException);
  });

  test("switching auth by clearing the other kind in the same update passes without a lookup", async () => {
    const findSpy: Spy = stubStoredFeeds({ basicAuthPassword: "hunter2" });

    await expect(
      service.onBeforeUpdate(
        updateBy({
          apiToken: "tok",
          basicAuthPassword: null as unknown as string,
        }),
      ),
    ).resolves.toBeDefined();

    // Explicitly clearing the other kind needs no stored-state check.
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("an update touching no credentials never queries stored secrets", async () => {
    const findSpy: Spy = stubStoredFeeds({ apiToken: "tok" });

    await service.onBeforeUpdate(updateBy({ name: "renamed" }));

    expect(findSpy).not.toHaveBeenCalled();
  });
});

describe("ThreatIntelFeedService — repointing resets the poll position", () => {
  type Spy = ReturnType<typeof getJestSpyOn>;

  type SuccessHookCaller = {
    onUpdateSuccess: (
      onUpdate: OnUpdate<ThreatIntelFeed>,
      updatedItemIds: Array<ObjectID>,
    ) => Promise<OnUpdate<ThreatIntelFeed>>;
  };

  const successCaller: SuccessHookCaller =
    ThreatIntelFeedService as unknown as SuccessHookCaller;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("onBeforeUpdate flags apiRootUrl/collectionId changes; unrelated updates are not flagged", async () => {
    const repointed: OnUpdate<ThreatIntelFeed> = await service.onBeforeUpdate(
      updateBy({ collectionId: "col-2" }),
    );
    expect((repointed.carryForward as { repointed: boolean }).repointed).toBe(
      true,
    );

    const unrelated: OnUpdate<ThreatIntelFeed> = await service.onBeforeUpdate(
      updateBy({ name: "renamed" }),
    );
    expect((unrelated.carryForward as { repointed: boolean }).repointed).toBe(
      false,
    );
  });

  test("onUpdateSuccess clears cursor, page token and lastPolledAt for repointed feeds", async () => {
    const updateSpy: Spy = getJestSpyOn(
      ThreatIntelFeedService,
      "updateOneById",
    ).mockResolvedValue(undefined as never);

    const feedId: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );

    await successCaller.onUpdateSuccess(
      {
        updateBy: updateBy({ collectionId: "col-2" }),
        carryForward: { repointed: true },
      },
      [feedId],
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const call: { id: ObjectID; data: Record<string, unknown> } = updateSpy.mock
      .calls[0]![0] as { id: ObjectID; data: Record<string, unknown> };
    expect(call.id.toString()).toBe(feedId.toString());
    expect(call.data["cursor"]).toBeNull();
    expect(call.data["nextPageToken"]).toBeNull();
    expect(call.data["lastPolledAt"]).toBeNull();
  });

  test("onUpdateSuccess touches nothing when the update was not a repoint", async () => {
    const updateSpy: Spy = getJestSpyOn(
      ThreatIntelFeedService,
      "updateOneById",
    ).mockResolvedValue(undefined as never);

    await successCaller.onUpdateSuccess(
      {
        updateBy: updateBy({ name: "renamed" }),
        carryForward: { repointed: false },
      },
      [new ObjectID("55555555-5555-4555-8555-555555555555")],
    );

    expect(updateSpy).not.toHaveBeenCalled();
  });
});
