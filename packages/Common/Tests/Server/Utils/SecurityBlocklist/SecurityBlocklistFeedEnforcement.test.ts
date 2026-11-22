import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityBlocklistFeed from "../../../../Models/DatabaseModels/SecurityBlocklistFeed";
import SecurityBlockEnforcementService from "../../../../Server/Services/SecurityBlockEnforcementService";
import SecurityBlockService from "../../../../Server/Services/SecurityBlockService";
import SecurityBlocklistFeedFetchService, {
  SecurityBlocklistFeedFetchRecord,
} from "../../../../Server/Services/SecurityBlocklistFeedFetchService";
import SecurityBlockCloudWafService from "../../../../Server/Services/SecurityBlockCloudWafService";
import SecurityBlocklistFeedService from "../../../../Server/Services/SecurityBlocklistFeedService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityBlockDestinations from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityBlocklistFeedDestination, {
  getSecurityBlocklistFeedDestinationKey,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistFeedDestination";
import SecurityBlocklistFeedProtection from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistFeedProtection";
import SecurityBlocklistFeedServe, {
  SecurityBlocklistFeedFetchAnswer,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistFeedServe";
import SecurityBlocklistJobs from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import SecurityBlocklistReconciler, {
  isConfirmedBeforeBlock,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import SecurityProtectedAddresses from "../../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import HashedString from "../../../../Types/HashedString";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockSource,
  SecurityBlockState,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS,
  SecurityBlockDestinationProvider,
  SecurityBlockEnforcementState,
  SecurityBlockEnforcementView,
  getSecurityBlockEnforcementSummary,
  getSecurityBlockEnforcementView,
  isSecurityBlockEnforced,
} from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityBlocklistFeedFamily } from "../../../../Types/SecurityBlocklist/SecurityBlocklistFeed";
import {
  SecurityAddressProtection,
  SecurityProtectedAddressSource,
} from "../../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import InMemoryLocks from "../../TestingUtils/InMemoryLocks";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A BLOCK IS ENFORCED AT A FEED ONLY ONCE A FIREWALL FETCHED A LIST THAT
 * HOLDS IT, AND ONLY WHILE IT KEEPS FETCHING (#10345).
 *
 * A firewall's fetches are answered here by the feed's own serve path
 * (SecurityBlocklistFeedServe: the list, the bookkeeping of what the
 * firewall now holds), and the blocklist is reconciled by the real
 * reconciler through the real feed destination, each at a moment the test
 * names. The project's blocks, the feed, its fetch log and the blocks'
 * enforcement rows are held in memory behind the services that read and
 * write them.
 *
 * What is pinned: a block is Pending at a feed until a fetch made after it
 * returns it, Applied from that fetch - its appliedAt the fetch, so the
 * page says how long after the block the firewall had it - and no longer
 * enforced ten minutes after the firewall stops fetching; a lifted block is
 * Removing until a fetch without it; a value the firewall still holds from
 * an earlier block of it does not count for a new one; a 304 and a Cisco
 * MD5 of the same list confirm, a different MD5 does not; a challenge, the
 * other family and a protected address are never Applied there.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const FEED_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const SECRET: string =
  "4f1c0e5d8a7b6c3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e";
const FEED_NAME: string = "Palo Alto feed";

const NOW: Date = new Date("2026-11-21T10:00:00.000Z");
const MINUTE: number = 60 * 1000;

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MINUTE);
}

function blockId(index: number): ObjectID {
  return new ObjectID(
    `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
  );
}

function sameId(left: unknown, right: unknown): boolean {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

let blocks: Map<string, SecurityBlock>;
let rows: Map<string, SecurityBlockEnforcement>;
let feed: SecurityBlocklistFeed;
let fetches: Array<SecurityBlocklistFeedFetchRecord>;
let protections: Array<SecurityAddressProtection>;
let reconcilesQueued: number;
let locks: InMemoryLocks;

// A row as a read hands it back: a copy of its own, so a test changes the table only through the service.
function copy<T>(model: T): T {
  const made: T = Object.create(
    Object.getPrototypeOf(model as unknown as Record<string, unknown>),
  ) as T;
  Object.assign(made as unknown as Record<string, unknown>, model);
  return made;
}

function addBlock(data: {
  index: number;
  value: string;
  createdAt: Date;
  action?: SecurityBlockAction | undefined;
}): SecurityBlock {
  const read: SecurityBlockValue = readSecurityBlockValue(data.value)!;
  const block: SecurityBlock = new SecurityBlock();

  block._id = blockId(data.index).toString();
  block.projectId = PROJECT_ID;
  block.value = read.value;
  block.indicatorType = read.indicatorType;
  block.action = data.action || SecurityBlockAction.Block;
  block.state = SecurityBlockState.Active;
  block.source = SecurityBlockSource.Person;
  block.createdAt = data.createdAt;
  block.expiresAt = new Date(data.createdAt.getTime() + 24 * 60 * MINUTE);

  blocks.set(block.id!.toString(), block);

  return block;
}

function lift(index: number): void {
  blocks.get(blockId(index).toString())!.state = SecurityBlockState.Lifted;
}

function rowOf(index: number): SecurityBlockEnforcement | undefined {
  return Array.from(rows.values()).find(
    (row: SecurityBlockEnforcement): boolean => {
      return sameId(row.securityBlockId, blockId(index));
    },
  );
}

function viewOf(index: number, now: Date): SecurityBlockEnforcementView | null {
  const row: SecurityBlockEnforcement | undefined = rowOf(index);
  return row ? getSecurityBlockEnforcementView(row, now) : null;
}

function isEnforced(index: number, now: Date): boolean {
  const row: SecurityBlockEnforcement | undefined = rowOf(index);
  return row ? isSecurityBlockEnforced([row], now) : false;
}

// A firewall fetches the feed at `minutes`: the route's answer, and its bookkeeping, done.
async function fetchFeed(
  minutes: number,
  options?: {
    file?: string | undefined;
    ifNoneMatch?: string | undefined;
  },
): Promise<SecurityBlocklistFeedFetchAnswer> {
  const answer: SecurityBlocklistFeedFetchAnswer =
    await SecurityBlocklistFeedServe.answer({
      feedId: FEED_ID.toString(),
      pathSecret: null,
      fileName: options?.file || "blocklist.txt",
      comments: undefined,
      authorization: `Bearer ${SECRET}`,
      ifNoneMatch: options?.ifNoneMatch,
      userAgent: "PAN-OS",
      clientIp: "203.0.113.50",
      isHead: false,
      now: at(minutes),
    });

  if ((answer.status === 200 || answer.status === 304) && answer.bookkeeping) {
    await SecurityBlocklistFeedServe.runBookkeeping(answer.bookkeeping);
  }

  return answer;
}

function bodyOf(answer: SecurityBlocklistFeedFetchAnswer): string {
  expect(answer.status).toBe(200);
  return (answer as { body: string }).body;
}

async function reconcile(minutes: number): Promise<void> {
  await SecurityBlocklistReconciler.reconcileProject({
    projectId: PROJECT_ID,
    now: at(minutes),
  });
}

beforeEach(() => {
  blocks = new Map();
  rows = new Map();
  fetches = [];
  protections = [];
  reconcilesQueued = 0;

  feed = new SecurityBlocklistFeed();
  feed._id = FEED_ID.toString();
  feed.projectId = PROJECT_ID;
  feed.name = FEED_NAME;
  feed.family = SecurityBlocklistFeedFamily.Both;
  feed.secret = new HashedString(
    SecurityBlocklistFeedService.hashSecret(SECRET),
    true,
  );

  locks = new InMemoryLocks();
  locks.install();

  SecurityBlockDestinations.resetSourcesForTests();
  SecurityBlocklistFeedProtection.clearCache();

  // ---------- The blocks ----------

  jest.spyOn(SecurityBlockService, "findBy").mockImplementation((async (
    args: unknown,
  ): Promise<Array<SecurityBlock>> => {
    const findBy: { query: JSONObject; limit: number } = args as {
      query: JSONObject;
      limit: number;
    };

    return Array.from(blocks.values())
      .filter((block: SecurityBlock): boolean => {
        return (
          sameId(block.projectId, findBy.query["projectId"]) &&
          (findBy.query["state"] === undefined ||
            block.state === findBy.query["state"])
        );
      })
      .sort((left: SecurityBlock, right: SecurityBlock): number => {
        return left.createdAt!.getTime() - right.createdAt!.getTime();
      })
      .slice(0, findBy.limit)
      .map(copy);
  }) as never);

  jest.spyOn(SecurityBlockService, "findByIds").mockImplementation((async (
    args: unknown,
  ): Promise<Array<SecurityBlock>> => {
    const data: { ids: Array<ObjectID> } = args as { ids: Array<ObjectID> };

    return data.ids
      .map((id: ObjectID): SecurityBlock | undefined => {
        return blocks.get(id.toString());
      })
      .filter((block: SecurityBlock | undefined): block is SecurityBlock => {
        return Boolean(block);
      })
      .map(copy);
  }) as never);

  // ---------- Their enforcement rows ----------

  jest
    .spyOn(SecurityBlockEnforcementService, "findForReconcile")
    .mockImplementation((async (): Promise<Array<SecurityBlockEnforcement>> => {
      return Array.from(rows.values()).map(copy);
    }) as never);

  jest
    .spyOn(SecurityBlockEnforcementService, "create")
    .mockImplementation((async (
      args: unknown,
    ): Promise<SecurityBlockEnforcement> => {
      const row: SecurityBlockEnforcement = copy(
        (args as { data: SecurityBlockEnforcement }).data,
      );
      row._id = `eeeeeeee-eeee-4eee-8eee-${String(rows.size + 1).padStart(12, "0")}`;
      rows.set(row._id, row);
      return copy(row);
    }) as never);

  jest
    .spyOn(SecurityBlockEnforcementService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown): Promise<void> => {
      const data: { id: ObjectID; data: JSONObject } = args as {
        id: ObjectID;
        data: JSONObject;
      };
      Object.assign(rows.get(data.id.toString())!, data.data);
    }) as never);

  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined as never);

  // ---------- The feed, as the database holds it ----------

  jest
    .spyOn(SecurityBlocklistFeedService, "findForProject")
    .mockImplementation((async (): Promise<Array<SecurityBlocklistFeed>> => {
      return [copy(feed)];
    }) as never);

  jest
    .spyOn(SecurityBlocklistFeedService, "findForServe")
    .mockImplementation((async (
      id: ObjectID,
    ): Promise<SecurityBlocklistFeed | null> => {
      return sameId(id, feed.id) ? copy(feed) : null;
    }) as never);

  jest
    .spyOn(SecurityBlocklistFeedService, "findOneById")
    .mockImplementation((async (
      args: unknown,
    ): Promise<SecurityBlocklistFeed | null> => {
      return sameId((args as { id: ObjectID }).id, feed.id) ? copy(feed) : null;
    }) as never);

  jest
    .spyOn(SecurityBlocklistFeedService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown): Promise<void> => {
      Object.assign(feed, (args as { data: JSONObject }).data);
    }) as never);

  jest
    .spyOn(SecurityBlocklistFeedService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown): Promise<boolean> => {
      const data: { data: JSONObject; expectedData: JSONObject } = args as {
        data: JSONObject;
        expectedData: JSONObject;
      };

      for (const [column, expected] of Object.entries(data.expectedData)) {
        const actual: unknown = (feed as unknown as JSONObject)[column];
        const asTime: (value: unknown) => number | null = (
          value: unknown,
        ): number | null => {
          return value ? new Date(value as Date).getTime() : null;
        };

        if (asTime(actual) !== asTime(expected)) {
          return false;
        }
      }

      Object.assign(feed, data.data);
      return true;
    }) as never);

  jest
    .spyOn(SecurityBlocklistFeedFetchService, "record")
    .mockImplementation((async (
      record: SecurityBlocklistFeedFetchRecord,
    ): Promise<void> => {
      fetches.push(record);
    }) as never);

  // ---------- What the project protects ----------

  jest
    .spyOn(SecurityProtectedAddresses, "readAllProtections")
    .mockImplementation((async () => {
      return { protections: [], unreadSources: [], incompleteSources: [] };
    }) as never);

  jest
    .spyOn(SecurityProtectedAddresses, "readProtectedEntities")
    .mockImplementation((async () => {
      return { protections: protections, isComplete: true };
    }) as never);

  jest
    .spyOn(SecurityBlocklistJobs, "queueReconcile")
    .mockImplementation((async (): Promise<void> => {
      reconcilesQueued++;
    }) as never);
});

afterEach(() => {
  SecurityBlockDestinations.resetSourcesForTests();
  jest.restoreAllMocks();
});

describe("the feeds are a kind of destination every server has", () => {
  test("a project's feeds are found as destinations, keyed by feed, named as people named them", async () => {
    expect(SecurityBlockDestinations.hasSources()).toBe(true);
    // The project has picked no AWS WAF web ACL (#10344): its feeds are all it has.
    jest
      .spyOn(SecurityBlockCloudWafService, "findForProject")
      .mockResolvedValue([] as never);

    const found: Awaited<
      ReturnType<typeof SecurityBlockDestinations.findForProject>
    > = await SecurityBlockDestinations.findForProject(PROJECT_ID);

    expect(found.failedProviders).toEqual([]);
    expect(found.destinations).toHaveLength(1);
    expect(found.destinations[0]).toBeInstanceOf(
      SecurityBlocklistFeedDestination,
    );
    expect(found.destinations[0]!.key).toBe(
      getSecurityBlocklistFeedDestinationKey(FEED_ID),
    );
    expect(found.destinations[0]!.provider).toBe(
      SecurityBlockDestinationProvider.Feed,
    );
    expect(found.destinations[0]!.name).toBe(FEED_NAME);
    expect(found.destinations[0]!.connectionId?.toString()).toBe(
      FEED_ID.toString(),
    );
  });
});

describe("a block is enforced at a feed once a firewall fetched it", () => {
  test("Pending until a fetch after the block returns it; Applied from that fetch", async () => {
    addBlock({ index: 1, value: "35.205.11.131", createdAt: at(0) });

    // Nothing has fetched the feed: the block is asked for, and held nowhere.
    await reconcile(1);
    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Pending);
    expect(isEnforced(1, at(1))).toBe(false);

    // The firewall fetches the list at minute 2: it holds the block now.
    expect(bodyOf(await fetchFeed(2))).toBe("35.205.11.131\n");
    expect(feed.servedValues).toEqual(["35.205.11.131"]);
    expect(feed.servedConfirmedAt).toEqual(at(2));
    // Its blocks' rows are told at once, not at the next pass.
    expect(reconcilesQueued).toBe(1);

    await reconcile(2.5);

    const row: SecurityBlockEnforcement = rowOf(1)!;
    expect(row.state).toBe(SecurityBlockEnforcementState.Applied);
    // From the fetch, not from when the reconciler looked: "fetched 2 minutes after the block".
    expect(row.appliedAt).toEqual(at(2));
    expect(row.lastConfirmedAt).toEqual(at(2));
    expect(row.destinationName).toBe(FEED_NAME);
    expect(row.provider).toBe(SecurityBlockDestinationProvider.Feed);
    expect(viewOf(1, at(3))).toBe(SecurityBlockEnforcementView.Enforced);
    expect(getSecurityBlockEnforcementSummary([row], at(3)).enforcedAt).toEqual(
      [FEED_NAME],
    );
  });

  test("a fetch made before the block does not count for it, nor does the reconciler's own read", async () => {
    addBlock({ index: 1, value: "35.205.11.131", createdAt: at(0) });
    await fetchFeed(1);
    await reconcile(1);
    expect(isEnforced(1, at(1))).toBe(true);

    // A block made after the firewall's last fetch, read again and again: still Pending.
    addBlock({ index: 2, value: "198.51.100.7", createdAt: at(2) });

    await reconcile(3);
    await reconcile(4);
    expect(rowOf(2)!.state).toBe(SecurityBlockEnforcementState.Pending);
    expect(isEnforced(2, at(4))).toBe(false);

    await fetchFeed(5);
    await reconcile(5);
    expect(rowOf(2)!.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(rowOf(2)!.appliedAt).toEqual(at(5));
  });

  test("a missed fetch: ten minutes after the firewall last fetched the list, its blocks are no longer enforced there", async () => {
    addBlock({ index: 1, value: "35.205.11.131", createdAt: at(0) });

    await fetchFeed(1);
    await reconcile(1);
    expect(isEnforced(1, at(1))).toBe(true);

    // The firewall fetches every five minutes...
    await fetchFeed(6);
    await reconcile(6);
    expect(isEnforced(1, at(15.9))).toBe(true);

    // ...and then stops. The reconciler keeps reading the feed, which says what was fetched last.
    await reconcile(11);
    await reconcile(16);
    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(rowOf(1)!.lastConfirmedAt).toEqual(at(6));

    const tenMinutesAfter: Date = new Date(
      at(6).getTime() + SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS,
    );

    expect(isEnforced(1, tenMinutesAfter)).toBe(true);
    expect(isEnforced(1, new Date(tenMinutesAfter.getTime() + 1))).toBe(false);
    expect(viewOf(1, at(17))).toBe(SecurityBlockEnforcementView.Unconfirmed);

    // It reads the feed again: enforced again.
    await fetchFeed(20);
    await reconcile(20);
    expect(rowOf(1)!.lastConfirmedAt).toEqual(at(20));
    expect(isEnforced(1, at(21))).toBe(true);
  });

  test("a firewall told the list has not changed (304) holds it: the fetch confirms its blocks", async () => {
    addBlock({ index: 1, value: "35.205.11.131", createdAt: at(0) });

    const first: SecurityBlocklistFeedFetchAnswer = await fetchFeed(1);
    const etag: string = (first as { etag: string }).etag;

    const second: SecurityBlocklistFeedFetchAnswer = await fetchFeed(9, {
      ifNoneMatch: etag,
    });

    expect(second.status).toBe(304);
    expect(feed.servedConfirmedAt).toEqual(at(9));
    expect(
      fetches.map((made: SecurityBlocklistFeedFetchRecord): number => {
        return made.statusCode;
      }),
    ).toEqual([200, 304]);
    expect(fetches[1]!.isChanged).toBe(false);

    await reconcile(9);
    expect(rowOf(1)!.lastConfirmedAt).toEqual(at(9));
    expect(isEnforced(1, at(18))).toBe(true);
  });

  test("Cisco's MD5 confirms what it holds only when it is the MD5 of the list it last fetched", async () => {
    addBlock({ index: 1, value: "35.205.11.131", createdAt: at(0) });
    await fetchFeed(1);

    // The same list: Cisco keeps its copy, which holds the block.
    const same: SecurityBlocklistFeedFetchAnswer = await fetchFeed(6, {
      file: "blocklist.txt.md5",
    });
    expect(bodyOf(same)).toMatch(/^[0-9a-f]{32}$/);
    expect(feed.servedConfirmedAt).toEqual(at(6));

    // A block is added: the MD5 changes, and asking for it confirms nothing until Cisco fetches the list.
    addBlock({ index: 2, value: "198.51.100.7", createdAt: at(7) });
    await fetchFeed(8, { file: "blocklist.txt.md5" });
    expect(feed.servedConfirmedAt).toEqual(at(6));
    expect(feed.servedValues).toEqual(["35.205.11.131"]);
    expect(fetches[2]!.isChanged).toBe(true);

    await reconcile(8);
    expect(rowOf(2)!.state).toBe(SecurityBlockEnforcementState.Pending);

    await fetchFeed(9);
    await reconcile(9);
    expect(rowOf(2)!.state).toBe(SecurityBlockEnforcementState.Applied);
  });
});

describe("expired, lifted and protected addresses are never served", () => {
  test("a lifted block leaves the very next list, and its row is Removing until a fetch without it", async () => {
    addBlock({ index: 1, value: "35.205.11.131", createdAt: at(0) });
    addBlock({ index: 2, value: "198.51.100.7", createdAt: at(0) });
    await fetchFeed(1);
    await reconcile(1);

    lift(1);
    await reconcile(2);
    // The firewall still holds what it fetched at minute 1.
    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Removing);

    expect(bodyOf(await fetchFeed(3))).toBe("198.51.100.7\n");
    await reconcile(3);
    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Removed);
    expect(rowOf(2)!.state).toBe(SecurityBlockEnforcementState.Applied);
  });

  test("a block past its end is gone from the next list, before the expiry worker marks it", async () => {
    const block: SecurityBlock = addBlock({
      index: 1,
      value: "35.205.11.131",
      createdAt: at(0),
    });
    block.expiresAt = at(5);
    addBlock({ index: 2, value: "198.51.100.7", createdAt: at(0) });

    expect(bodyOf(await fetchFeed(4))).toBe("35.205.11.131\n198.51.100.7\n");
    expect(bodyOf(await fetchFeed(5))).toBe("198.51.100.7\n");
  });

  test("an address protected after it was blocked is never served, so never enforced there", async () => {
    addBlock({ index: 1, value: "35.205.11.131", createdAt: at(0) });
    addBlock({ index: 2, value: "198.51.100.0/24", createdAt: at(0) });

    protections = [
      {
        source: SecurityProtectedAddressSource.ProtectedEntity,
        protectedValue: "35.205.11.131",
        name: "office",
      },
      // A host of the project, inside the blocked range.
      {
        source: SecurityProtectedAddressSource.ProtectedEntity,
        protectedValue: "198.51.100.20",
        name: "web-3",
      },
    ];

    // Nothing left to serve: the documentation address, which is no block.
    expect(bodyOf(await fetchFeed(1))).toBe("192.0.2.1\n");
    expect(feed.servedValues).toEqual([]);

    await reconcile(1);
    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Pending);
    expect(rowOf(2)!.state).toBe(SecurityBlockEnforcementState.Pending);
    expect(isEnforced(1, at(1))).toBe(false);
  });

  test("when what protects an address cannot be read, nothing new is served: the firewall keeps its list", async () => {
    addBlock({ index: 1, value: "35.205.11.131", createdAt: at(0) });

    jest
      .spyOn(SecurityProtectedAddresses, "readAllProtections")
      .mockImplementation((async () => {
        return {
          protections: [],
          unreadSources: [SecurityProtectedAddressSource.Host],
          incompleteSources: [],
        };
      }) as never);

    const answer: SecurityBlocklistFeedFetchAnswer = await fetchFeed(1);

    expect(answer).toEqual({ status: 503, retryAfterSeconds: 60 });
    expect(feed.servedConfirmedAt).toBeUndefined();
    expect(fetches).toEqual([]);
  });
});

describe("what a feed cannot hold says why", () => {
  test("a challenge is Not applied: a firewall cannot challenge", async () => {
    addBlock({
      index: 1,
      value: "35.205.11.131",
      createdAt: at(0),
      action: SecurityBlockAction.Challenge,
    });

    await reconcile(1);
    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Failed);
    expect(rowOf(1)!.error).toBe(`Not applied: ${FEED_NAME} cannot challenge`);
    expect(bodyOf(await fetchFeed(2))).toBe("192.0.2.1\n");
  });

  test("a feed of IPv4 says it serves IPv4 only, and never serves the other family", async () => {
    feed.family = SecurityBlocklistFeedFamily.IPv4;
    addBlock({ index: 1, value: "2001:db8::9", createdAt: at(0) });
    addBlock({ index: 2, value: "35.205.11.131", createdAt: at(0) });

    expect(bodyOf(await fetchFeed(1))).toBe("35.205.11.131\n");
    await reconcile(1);
    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Failed);
    expect(rowOf(1)!.error).toBe(`Not applied: ${FEED_NAME} serves IPv4 only`);
    expect(rowOf(2)!.state).toBe(SecurityBlockEnforcementState.Applied);
  });
});

describe("a value the firewall holds from an earlier block of it", () => {
  test("does not count for a new block of the same value until a fetch made after it", async () => {
    addBlock({ index: 1, value: "35.205.11.131", createdAt: at(0) });
    await fetchFeed(1);
    await reconcile(1);

    // Lifted and blocked again before the firewall fetched again.
    lift(1);
    addBlock({ index: 2, value: "35.205.11.131", createdAt: at(2) });
    await reconcile(3);

    expect(rowOf(2)!.state).toBe(SecurityBlockEnforcementState.Pending);
    expect(isEnforced(2, at(3))).toBe(false);

    await fetchFeed(4);
    await reconcile(4);
    expect(rowOf(2)!.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(rowOf(2)!.appliedAt).toEqual(at(4));
  });

  test("the reconciler's rule: a confirmation older than the block says nothing of it", () => {
    const block: SecurityBlock = new SecurityBlock();
    block.createdAt = at(2);

    expect(isConfirmedBeforeBlock({ confirmedAt: at(1) }, block)).toBe(true);
    expect(isConfirmedBeforeBlock({ confirmedAt: at(2) }, block)).toBe(false);
    expect(isConfirmedBeforeBlock({ confirmedAt: at(3) }, block)).toBe(false);
    // A destination read now says nothing of when it was seen.
    expect(isConfirmedBeforeBlock({}, block)).toBe(false);
  });
});

describe("the fetch log", () => {
  test("records every fetch: when, from where, with what, how the secret came, and whether the list changed", async () => {
    addBlock({ index: 1, value: "35.205.11.131", createdAt: at(0) });

    await fetchFeed(1);
    await fetchFeed(2);
    addBlock({ index: 2, value: "198.51.100.7", createdAt: at(3) });
    await fetchFeed(4);

    expect(fetches).toEqual([
      {
        projectId: PROJECT_ID,
        feedId: FEED_ID,
        fetchedAt: at(1),
        sourceIp: "203.0.113.50",
        userAgent: "PAN-OS",
        file: "blocklist.txt",
        authMethod: "Bearer",
        usedPreviousSecret: false,
        statusCode: 200,
        isChanged: true,
        entryCount: 1,
      },
      expect.objectContaining({
        fetchedAt: at(2),
        statusCode: 200,
        isChanged: false,
        entryCount: 1,
      }),
      expect.objectContaining({
        fetchedAt: at(4),
        isChanged: true,
        entryCount: 2,
      }),
    ]);
    expect(feed.lastFetchedAt).toEqual(at(4));
    expect(feed.lastFetchSourceIp).toBe("203.0.113.50");
    expect(feed.lastFetchUserAgent).toBe("PAN-OS");
    expect(feed.servedCount).toBe(2);
  });

  test("a firewall that reads the feed again is told again if it stops again", async () => {
    feed.stoppedReadingToldAt = at(-1);

    await fetchFeed(1);

    expect(feed.stoppedReadingToldAt).toBeNull();
  });
});
