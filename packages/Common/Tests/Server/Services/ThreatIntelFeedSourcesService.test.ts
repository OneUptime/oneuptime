import ThreatIntelFeedService from "../../../Server/Services/ThreatIntelFeedService";
import SecurityEventConnectionService from "../../../Server/Services/SecurityEventConnectionService";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import DataSourceEgressGuard from "../../../Server/Utils/DataSource/EgressGuard";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../Types/Exception/EgressGuardException";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import ThreatIntelFeedType from "../../../Types/SecurityEvent/ThreatIntelFeedType";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A feed that saves is a feed its source can poll: a list feed has an https
 * address OneUptime may reach and is polled at most every 15 minutes, a
 * Google SecOps feed reads through a Google SecOps connection of its own
 * project, and neither holds a TAXII field. A TAXII feed is checked as it
 * always was (ThreatIntelFeedService.test.ts). The project check and the
 * egress guard are stubbed at their boundaries; each is tested on its own.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444445",
);
const FEED_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const LIST_URL: string = "https://check.torproject.org/torbulkexitlist";

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<ThreatIntelFeed>,
  ) => Promise<OnCreate<ThreatIntelFeed>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<ThreatIntelFeed>,
  ) => Promise<OnUpdate<ThreatIntelFeed>>;
};

const service: HookCaller = ThreatIntelFeedService as unknown as HookCaller;

function listFeed(changes: Partial<ThreatIntelFeed> = {}): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed.projectId = PROJECT_ID;
  feed.name = "Tor exit nodes";
  feed.feedType = ThreatIntelFeedType.List;
  feed.listUrl = LIST_URL;
  feed.indicatorConfidence = 30;
  feed.pollIntervalInMinutes = 60;
  Object.assign(feed, changes);
  return feed;
}

function secOpsFeed(changes: Partial<ThreatIntelFeed> = {}): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed.projectId = PROJECT_ID;
  feed.name = "Google SecOps IOCs";
  feed.feedType = ThreatIntelFeedType.GoogleSecOps;
  feed.securityEventConnectionId = CONNECTION_ID;
  Object.assign(feed, changes);
  return feed;
}

function createBy(feed: ThreatIntelFeed): CreateBy<ThreatIntelFeed> {
  return {
    data: feed,
    props: { isRoot: true, tenantId: PROJECT_ID },
  } as CreateBy<ThreatIntelFeed>;
}

function updateBy(data: Partial<ThreatIntelFeed>): UpdateBy<ThreatIntelFeed> {
  return {
    query: { _id: FEED_ID },
    data,
    props: { isRoot: true, tenantId: PROJECT_ID },
  } as unknown as UpdateBy<ThreatIntelFeed>;
}

function connection(
  options: {
    projectId?: ObjectID;
    provider?: SecurityEventConnectorProvider;
  } = {},
): SecurityEventConnection {
  const found: SecurityEventConnection = new SecurityEventConnection();
  found._id = CONNECTION_ID.toString();
  found.projectId = options.projectId || PROJECT_ID;
  found.provider =
    options.provider || SecurityEventConnectorProvider.GoogleSecOps;
  return found;
}

function storedFeed(feed: ThreatIntelFeed): Spy {
  feed._id = FEED_ID.toString();
  return getJestSpyOn(ThreatIntelFeedService, "findBy").mockResolvedValue([
    feed,
  ] as never);
}

let egressSpy: Spy;
let connectionSpy: Spy;

beforeEach(() => {
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined as never,
  );
  egressSpy = getJestSpyOn(
    DataSourceEgressGuard,
    "assertUrlAllowed",
  ).mockResolvedValue({ url: new URL(LIST_URL), addresses: [] } as never);
  connectionSpy = getJestSpyOn(
    SecurityEventConnectionService,
    "findOneById",
  ).mockResolvedValue(connection() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a feed's source", () => {
  test("is a TAXII collection when none is given, as every feed was", async () => {
    const feed: ThreatIntelFeed = new ThreatIntelFeed();
    feed.projectId = PROJECT_ID;
    feed.name = "OpenCTI";
    feed.apiRootUrl = "https://taxii.example.com/api1/";
    feed.collectionId = "col-1";

    const created: OnCreate<ThreatIntelFeed> = await service.onBeforeCreate(
      createBy(feed),
    );

    expect(created.createBy.data.feedType).toBe(ThreatIntelFeedType.Taxii);
  });

  test("must be one OneUptime reads", async () => {
    await expect(
      service.onBeforeCreate(
        createBy(listFeed({ feedType: "rss" as ThreatIntelFeedType })),
      ),
    ).rejects.toThrow(
      "Source must be a TAXII collection (taxii), a list of indicators (list) or Google SecOps (google-secops).",
    );
  });

  test("cannot be changed once the feed is saved; sent back as it is, it is no change", async () => {
    storedFeed(secOpsFeed());

    await expect(
      service.onBeforeUpdate(updateBy({ feedType: ThreatIntelFeedType.List })),
    ).rejects.toThrow("A feed's source cannot be changed.");

    await expect(
      service.onBeforeUpdate(
        updateBy({ feedType: ThreatIntelFeedType.GoogleSecOps, name: "IOCs" }),
      ),
    ).resolves.toBeDefined();

    await expect(
      service.onBeforeUpdate(
        updateBy({ feedType: "rss" as ThreatIntelFeedType }),
      ),
    ).rejects.toThrow("Source must be a TAXII collection");
  });
});

describe("a list feed", () => {
  test("saves with an https address OneUptime may reach", async () => {
    await expect(
      service.onBeforeCreate(createBy(listFeed())),
    ).resolves.toBeDefined();

    expect(egressSpy).toHaveBeenCalledWith(LIST_URL, {
      targetLabel: "Threat intel list",
    });
  });

  test("needs its address", async () => {
    await expect(
      service.onBeforeCreate(createBy(listFeed({ listUrl: undefined }))),
    ).rejects.toThrow("List URL is required.");
  });

  test.each([
    ["http://lists.example.com/c2.txt", "List URL must start with https://."],
    [
      "https://user:pw@lists.example.com/c2.txt",
      "must not hold a user name or password",
    ],
  ])("refuses %s", async (url: string, message: string) => {
    await expect(
      service.onBeforeCreate(createBy(listFeed({ listUrl: url }))),
    ).rejects.toThrow(message);
  });

  test("refuses an address the egress guard refuses, as a form error", async () => {
    egressSpy.mockRejectedValue(
      new EgressGuardException(
        "Threat intel list host 10.0.0.5 is not allowed.",
        EgressFailureReason.InvalidTarget,
      ) as never,
    );

    await expect(
      service.onBeforeCreate(
        createBy(listFeed({ listUrl: "https://10.0.0.5/list.txt" })),
      ),
    ).rejects.toThrow("Threat intel list host 10.0.0.5 is not allowed.");
  });

  test("is polled at most every 15 minutes", async () => {
    await expect(
      service.onBeforeCreate(createBy(listFeed({ pollIntervalInMinutes: 5 }))),
    ).rejects.toThrow("polled at most every 15 minutes");

    await expect(
      service.onBeforeCreate(createBy(listFeed({ pollIntervalInMinutes: 15 }))),
    ).resolves.toBeDefined();
  });

  test("gives its indicators a confidence from 1 to 100, or none", async () => {
    for (const bad of [0, 101, 50.5, -3]) {
      await expect(
        service.onBeforeCreate(
          createBy(listFeed({ indicatorConfidence: bad })),
        ),
      ).rejects.toThrow("Confidence must be a whole number between 1 and 100.");
    }

    await expect(
      service.onBeforeCreate(
        createBy(listFeed({ indicatorConfidence: undefined })),
      ),
    ).resolves.toBeDefined();
  });

  test.each([
    ["apiRootUrl", "https://taxii.example.com/api1/", "TAXII API root URL"],
    ["collectionId", "col-1", "Collection ID"],
    ["apiToken", "secret", "API token"],
    ["basicAuthPassword", "hunter2", "Basic auth password"],
  ])(
    "holds no TAXII field: %s",
    async (key: string, value: string, title: string) => {
      await expect(
        service.onBeforeCreate(createBy(listFeed({ [key]: value }))),
      ).rejects.toThrow(
        `${title} is for a TAXII collection. A list feed does not use it`,
      );
    },
  );

  test("an update of its address is checked against the list rules, and the egress guard", async () => {
    storedFeed(listFeed());

    await expect(
      service.onBeforeUpdate(
        updateBy({ listUrl: "https://lists.example.com/new.txt" }),
      ),
    ).resolves.toBeDefined();
    expect(egressSpy).toHaveBeenCalledWith(
      "https://lists.example.com/new.txt",
      { targetLabel: "Threat intel list" },
    );

    await expect(
      service.onBeforeUpdate(updateBy({ listUrl: null as unknown as string })),
    ).rejects.toThrow("List URL is required.");
  });

  test("an update of its poll interval below 15 minutes is refused; a TAXII feed may poll every minute", async () => {
    storedFeed(listFeed());

    await expect(
      service.onBeforeUpdate(updateBy({ pollIntervalInMinutes: 5 })),
    ).rejects.toThrow("polled at most every 15 minutes");

    jest.restoreAllMocks();
    getJestSpyOn(ThreatIntelFeedService, "findBy").mockResolvedValue([
      Object.assign(new ThreatIntelFeed(), {
        _id: FEED_ID.toString(),
        projectId: PROJECT_ID,
        feedType: ThreatIntelFeedType.Taxii,
        apiRootUrl: "https://taxii.example.com/api1/",
        collectionId: "col-1",
      }),
    ] as never);

    await expect(
      service.onBeforeUpdate(updateBy({ pollIntervalInMinutes: 1 })),
    ).resolves.toBeDefined();
  });

  test("repointing it to another list starts its cursor again", async () => {
    storedFeed(listFeed());

    const updated: OnUpdate<ThreatIntelFeed> = await service.onBeforeUpdate(
      updateBy({ listUrl: "https://lists.example.com/new.txt" }),
    );

    expect((updated.carryForward as { repointed: boolean }).repointed).toBe(
      true,
    );
  });

  test("its address sent back as it is resolves nothing and keeps its cursor", async () => {
    storedFeed(listFeed());

    const sentBack: OnUpdate<ThreatIntelFeed> = await service.onBeforeUpdate(
      updateBy({
        name: "Tor",
        listUrl: LIST_URL,
        apiRootUrl: null as unknown as string,
      }),
    );

    expect((sentBack.carryForward as { repointed: boolean }).repointed).toBe(
      false,
    );
    expect(egressSpy).not.toHaveBeenCalled();
  });

  test("a TAXII field given to it on an update is refused", async () => {
    storedFeed(listFeed());

    await expect(
      service.onBeforeUpdate(
        updateBy({ apiRootUrl: "https://taxii.example.com/api1/" }),
      ),
    ).rejects.toThrow("TAXII API root URL is for a TAXII collection.");
  });

  test("renaming it or turning it off reads nothing", async () => {
    const findSpy: Spy = storedFeed(listFeed());

    await service.onBeforeUpdate(updateBy({ name: "Tor", isEnabled: false }));
    await service.onBeforeUpdate(updateBy({ pollIntervalInMinutes: 120 }));

    expect(findSpy).not.toHaveBeenCalled();
  });
});

describe("a Google SecOps feed", () => {
  test("saves with a Google SecOps connection of its project", async () => {
    await expect(
      service.onBeforeCreate(createBy(secOpsFeed())),
    ).resolves.toBeDefined();

    const args: { id: ObjectID; props: unknown } = connectionSpy.mock
      .calls[0]![0] as { id: ObjectID; props: unknown };

    expect(args.id.toString()).toBe(CONNECTION_ID.toString());
    expect(args.props).toEqual({ isRoot: true });
  });

  test("needs its connection", async () => {
    await expect(
      service.onBeforeCreate(
        createBy(secOpsFeed({ securityEventConnectionId: undefined })),
      ),
    ).rejects.toThrow(
      "Choose the Google SecOps connection this feed reads through.",
    );
  });

  test("refuses a connection to another product, another project's, or none at all", async () => {
    for (const found of [
      connection({ provider: SecurityEventConnectorProvider.OktaSystemLog }),
      connection({ projectId: OTHER_PROJECT_ID }),
      null,
    ]) {
      connectionSpy.mockResolvedValue(found as never);

      await expect(
        service.onBeforeCreate(createBy(secOpsFeed())),
      ).rejects.toThrow(
        "Choose a Google SecOps connection of this project. Connect Google SecOps under Security Events > Connections first.",
      );
    }
  });

  test("the connection is read under either of its names, as an Edit form's dropdown sends it", async () => {
    storedFeed(secOpsFeed());

    const moved: OnUpdate<ThreatIntelFeed> = await service.onBeforeUpdate(
      updateBy({
        securityEventConnection: {
          _id: OTHER_CONNECTION_ID.toString(),
        } as unknown as SecurityEventConnection,
      }),
    );

    expect((moved.carryForward as { repointed: boolean }).repointed).toBe(true);
    expect(
      (connectionSpy.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(OTHER_CONNECTION_ID.toString());

    const created: ThreatIntelFeed = secOpsFeed({
      securityEventConnectionId: undefined,
    });
    created.securityEventConnection = {
      _id: CONNECTION_ID.toString(),
    } as unknown as SecurityEventConnection;

    await expect(
      service.onBeforeCreate(createBy(created)),
    ).resolves.toBeDefined();
  });

  test("holds no list address and no TAXII field", async () => {
    await expect(
      service.onBeforeCreate(createBy(secOpsFeed({ listUrl: LIST_URL }))),
    ).rejects.toThrow("List URL is for a list feed.");

    await expect(
      service.onBeforeCreate(createBy(secOpsFeed({ apiToken: "secret" }))),
    ).rejects.toThrow(
      "API token is for a TAXII collection. A Google SecOps feed does not use it",
    );
  });

  test("an update to another connection is checked; clearing it is refused", async () => {
    storedFeed(secOpsFeed());

    // Sent back as it is: no change, nothing looked up, no repoint.
    const sentBack: OnUpdate<ThreatIntelFeed> = await service.onBeforeUpdate(
      updateBy({ securityEventConnectionId: CONNECTION_ID }),
    );
    expect((sentBack.carryForward as { repointed: boolean }).repointed).toBe(
      false,
    );
    expect(connectionSpy).not.toHaveBeenCalled();

    const moved: OnUpdate<ThreatIntelFeed> = await service.onBeforeUpdate(
      updateBy({ securityEventConnectionId: OTHER_CONNECTION_ID }),
    );
    expect((moved.carryForward as { repointed: boolean }).repointed).toBe(true);

    connectionSpy.mockResolvedValue(
      connection({
        provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
      }) as never,
    );

    await expect(
      service.onBeforeUpdate(
        updateBy({ securityEventConnectionId: OTHER_CONNECTION_ID }),
      ),
    ).rejects.toThrow("Choose a Google SecOps connection of this project.");

    await expect(
      service.onBeforeUpdate(
        updateBy({ securityEventConnectionId: null as unknown as ObjectID }),
      ),
    ).rejects.toThrow(
      "Choose the Google SecOps connection this feed reads through.",
    );
  });
});

describe("a TAXII feed's collection", () => {
  test("may be changed but not cleared", async () => {
    getJestSpyOn(ThreatIntelFeedService, "findBy").mockResolvedValue([
      Object.assign(new ThreatIntelFeed(), {
        _id: FEED_ID.toString(),
        projectId: PROJECT_ID,
        feedType: ThreatIntelFeedType.Taxii,
        apiRootUrl: "https://taxii.example.com/api1/",
        collectionId: "col-1",
      }),
    ] as never);

    await expect(
      service.onBeforeUpdate(
        updateBy({ collectionId: null as unknown as string }),
      ),
    ).rejects.toThrow("Collection ID is required.");

    await expect(
      service.onBeforeUpdate(
        updateBy({ apiRootUrl: null as unknown as string }),
      ),
    ).rejects.toThrow("TAXII API root URL is required.");

    await expect(
      service.onBeforeUpdate(updateBy({ apiRootUrl: "" })),
    ).rejects.toThrow("TAXII API root must be a valid URL");
  });

  test("an error is a BadDataException, the words a form shows", async () => {
    await expect(
      service.onBeforeCreate(createBy(listFeed({ listUrl: undefined }))),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});
