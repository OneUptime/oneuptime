import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import Queue, { QueueName } from "../../../../Server/Infrastructure/Queue";
import SecurityBlockEnforcementService from "../../../../Server/Services/SecurityBlockEnforcementService";
import SecurityBlockService from "../../../../Server/Services/SecurityBlockService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityBlockDestination, {
  SecurityBlockCapacity,
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockSupport,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations, {
  SecurityBlockDestinationSource,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityBlocklistJobs, {
  SECURITY_BLOCKLIST_RECONCILE_JOB,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import SecurityBlocklistReconciler, {
  SECURITY_BLOCKLIST_CONFIRMATION_REFRESH_IN_MS,
  SECURITY_BLOCKLIST_FIRST_RETRY_IN_MS,
  SECURITY_BLOCKLIST_LONGEST_RETRY_IN_MS,
  SECURITY_BLOCKLIST_MAX_PROJECTS_PER_PASS,
  SecurityBlocklistDestinationPlan,
  SecurityBlocklistPassResult,
  describeSecurityBlockHeldBack,
  findSecurityBlocksHeldBack,
  getHeldItemKey,
  getSecurityBlockEntryComment,
  getSecurityBlocklistRetryDelayInMs,
  planSecurityBlocklistDestination,
  toSecurityBlockProtectionEntries,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import SecurityBlocklistFeedProtection, {
  SecurityBlocklistFeedProtectionCheck,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistFeedProtection";
import { SecurityBlocklistFeedEntry } from "../../../../Types/SecurityBlocklist/SecurityBlocklistFeed";
import { SecurityProtectedAddressSource } from "../../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import TestSecurityBlockDestination from "../../../../Server/Utils/SecurityBlocklist/TestSecurityBlockDestination";
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
  SecurityBlockDestinationProvider,
  SecurityBlockEnforcementState,
} from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import InMemoryLocks from "../../TestingUtils/InMemoryLocks";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// A destination that is down is logged as it is reported; the tests read the rows instead.
jest.mock("../../../../Server/Utils/Logger");

/*
 * THE RECONCILER KEEPS THE BLOCKLIST TRUE AT EVERY DESTINATION (#10338).
 *
 * Driven here against the test destination (TestSecurityBlockDestination),
 * which behaves as a provider does and misbehaves as providers do: it
 * refuses a value, goes down, fills up, cannot challenge, matches IPv4
 * only, has an item removed behind OneUptime's back, holds the customer's
 * own items. The project's blocks and their enforcement rows are held in
 * memory behind the services the reconciler reads and writes, and each
 * pass is made at a moment the test names, so "a minute later" is a
 * minute later and nothing waits on a clock.
 *
 * What is pinned: a block is Applied only once a read-back shows it, every
 * block a destination cannot hold says why on its row, a refused or failed
 * write is tried again later and later, nothing of the customer's is ever
 * touched, a pass that changes nothing writes nothing, and a case's
 * timeline hears each thing once.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CASE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const CASE_NUMBER: string = "CASE-42";

const NOW: Date = new Date("2026-11-20T10:42:00.000Z");
const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

const LOCK_NAMESPACE: string = "SecurityBlocklistReconciler";

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

// ---------- The project's blocks and their rows, as the database holds them ----------

let blocks: Map<string, SecurityBlock>;
let rows: Map<string, SecurityBlockEnforcement>;
let rowsCreated: number;
let rowWrites: Array<{ id: string; data: JSONObject }>;
let feedItems: Array<JSONObject>;
let locks: InMemoryLocks;

function copyOfBlock(block: SecurityBlock): SecurityBlock {
  const copy: SecurityBlock = new SecurityBlock();
  Object.assign(copy, block);
  return copy;
}

function copyOfRow(row: SecurityBlockEnforcement): SecurityBlockEnforcement {
  const copy: SecurityBlockEnforcement = new SecurityBlockEnforcement();
  Object.assign(copy, row);
  return copy;
}

interface BlockData {
  index: number;
  value: string;
  action?: SecurityBlockAction | undefined;
  state?: SecurityBlockState | undefined;
  createdAt?: Date | undefined;
  expiresAt?: Date | null | undefined;
  hasCase?: boolean | undefined;
  projectId?: ObjectID | undefined;
}

// A block as the blocklist's service left it: Active for a day unless the test says.
function addBlock(data: BlockData): SecurityBlock {
  const read: SecurityBlockValue = readSecurityBlockValue(data.value)!;
  const block: SecurityBlock = new SecurityBlock();

  block._id = blockId(data.index).toString();
  block.projectId = data.projectId || PROJECT_ID;
  block.value = read.value;
  block.indicatorType = read.indicatorType;
  block.action = data.action || SecurityBlockAction.Block;
  block.state = data.state || SecurityBlockState.Active;
  block.source = SecurityBlockSource.Person;
  block.createdAt = data.createdAt || at(data.index);
  block.expiresAt = (
    data.expiresAt === undefined
      ? new Date((data.createdAt || at(data.index)).getTime() + DAY)
      : data.expiresAt
  ) as Date;

  if (data.hasCase) {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase._id = CASE_ID.toString();
    securityCase.caseNumberWithPrefix = CASE_NUMBER;
    block.securityCaseId = CASE_ID;
    block.securityCase = securityCase;
  }

  blocks.set(block.id!.toString(), block);

  return block;
}

function setState(index: number, state: SecurityBlockState): void {
  blocks.get(blockId(index).toString())!.state = state;
}

// The row of a block at a destination, as the database holds it now.
function rowOf(
  index: number,
  destination: SecurityBlockDestination,
): SecurityBlockEnforcement | undefined {
  return Array.from(rows.values()).find(
    (row: SecurityBlockEnforcement): boolean => {
      return (
        sameId(row.securityBlockId, blockId(index)) &&
        row.destinationKey === destination.key
      );
    },
  );
}

function stateOf(
  index: number,
  destination: SecurityBlockDestination,
): SecurityBlockEnforcementState | undefined {
  return rowOf(index, destination)?.state as
    | SecurityBlockEnforcementState
    | undefined;
}

// What a row says went wrong, or null: a column never written reads as null, as the database reads it.
function errorOf(
  index: number,
  destination: SecurityBlockDestination,
): string | null {
  return rowOf(index, destination)?.error || null;
}

// When a row is to be tried again, or null when it waits for nothing.
function retryAtOf(
  index: number,
  destination: SecurityBlockDestination,
): Date | null {
  return rowOf(index, destination)?.retryAt || null;
}

function enforceAt(...destinations: Array<SecurityBlockDestination>): void {
  SecurityBlockDestinations.setSourcesForTests([
    {
      provider: SecurityBlockDestinationProvider.Test,
      findForProject: async (): Promise<Array<SecurityBlockDestination>> => {
        return destinations;
      },
    },
  ]);
}

async function pass(
  minutes: number,
  projectId: ObjectID = PROJECT_ID,
): Promise<SecurityBlocklistPassResult> {
  return await SecurityBlocklistReconciler.reconcileProject({
    projectId,
    now: at(minutes),
  });
}

// The lines a case's timeline was given, by what they say.
function timelineLines(): Array<string> {
  return feedItems.map((item: JSONObject): string => {
    return String(item["feedInfoInMarkdown"] || "");
  });
}

function linesSaying(text: string): Array<string> {
  return timelineLines().filter((line: string): boolean => {
    return line.includes(text);
  });
}

beforeEach(() => {
  blocks = new Map();
  rows = new Map();
  rowsCreated = 0;
  rowWrites = [];
  feedItems = [];

  locks = new InMemoryLocks();
  locks.install();

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
      .map(copyOfBlock);
  }) as never);

  jest.spyOn(SecurityBlockService, "findByIds").mockImplementation((async (
    args: unknown,
  ): Promise<Array<SecurityBlock>> => {
    const data: { projectId: ObjectID; ids: Array<ObjectID> } = args as {
      projectId: ObjectID;
      ids: Array<ObjectID>;
    };

    return data.ids
      .map((id: ObjectID): SecurityBlock | undefined => {
        return blocks.get(id.toString());
      })
      .filter((block: SecurityBlock | undefined): block is SecurityBlock => {
        return Boolean(block && sameId(block.projectId, data.projectId));
      })
      .map(copyOfBlock);
  }) as never);

  jest
    .spyOn(SecurityBlockEnforcementService, "findForReconcile")
    .mockImplementation((async (
      args: unknown,
    ): Promise<Array<SecurityBlockEnforcement>> => {
      const data: { projectId: ObjectID; activeBlockIds: Array<ObjectID> } =
        args as { projectId: ObjectID; activeBlockIds: Array<ObjectID> };

      return Array.from(rows.values())
        .filter((row: SecurityBlockEnforcement): boolean => {
          if (!sameId(row.projectId, data.projectId)) {
            return false;
          }

          return (
            row.state !== SecurityBlockEnforcementState.Removed ||
            data.activeBlockIds.some((id: ObjectID): boolean => {
              return sameId(id, row.securityBlockId);
            })
          );
        })
        .map(copyOfRow);
    }) as never);

  jest
    .spyOn(SecurityBlockEnforcementService, "create")
    .mockImplementation((async (
      args: unknown,
    ): Promise<SecurityBlockEnforcement> => {
      const data: SecurityBlockEnforcement = (
        args as { data: SecurityBlockEnforcement; props: JSONObject }
      ).data;

      // OneUptime's own bookkeeping: written as root.
      expect((args as { props: JSONObject }).props).toEqual({ isRoot: true });

      rowsCreated++;
      const row: SecurityBlockEnforcement = copyOfRow(data);
      row._id = `eeeeeeee-eeee-4eee-8eee-${String(rowsCreated).padStart(12, "0")}`;
      rows.set(row._id, row);

      return copyOfRow(row);
    }) as never);

  jest
    .spyOn(SecurityBlockEnforcementService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown): Promise<void> => {
      const data: { id: ObjectID; data: JSONObject } = args as {
        id: ObjectID;
        data: JSONObject;
      };

      rowWrites.push({ id: data.id.toString(), data: data.data });

      const row: SecurityBlockEnforcement | undefined = rows.get(
        data.id.toString(),
      );

      if (row) {
        Object.assign(row, data.data);
      }
    }) as never);

  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (args: unknown): Promise<void> => {
      feedItems.push(args as JSONObject);
    }) as never);
});

afterEach(() => {
  SecurityBlockDestinations.resetSourcesForTests();
  jest.restoreAllMocks();
});

describe("a block made", () => {
  test("is applied, and its row is Applied once a read-back shows it, with when and the provider's reference", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });

    const result: SecurityBlocklistPassResult = await pass(2);

    expect(result).toEqual({ destinations: 1, skipped: 0, failed: 0 });
    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.131"]);

    const row: SecurityBlockEnforcement = rowOf(1, destination)!;
    expect(row.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(row.appliedAt).toEqual(at(2));
    expect(row.lastConfirmedAt).toEqual(at(2));
    expect(row.providerRef).toBe("test-item-1");
    expect(row.destinationKey).toBe(destination.key);
    expect(row.destinationName).toBe("Test destination");
    expect(row.provider).toBe(SecurityBlockDestinationProvider.Test);
    expect(row.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(row.failedAttempts).toBe(0);
    expect(errorOf(1, destination)).toBeNull();
    expect(retryAtOf(1, destination)).toBeNull();

    // Read, then written, then read back: what apply says is a request, the read-back the fact.
    expect(
      destination.calls.map((made: { call: string }): string => {
        return made.call;
      }),
    ).toEqual(["capacity", "readBack", "apply", "readBack"]);
  });

  test("goes to the destination with the case it was made for and when it ends, where the provider keeps a comment", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });
    addBlock({ index: 2, value: "35.205.11.0/24", expiresAt: null });

    const applied: Array<Array<SecurityBlockEntry>> = [];
    const original: typeof destination.apply =
      destination.apply.bind(destination);
    jest
      .spyOn(destination, "apply")
      .mockImplementation(async (entries: Array<SecurityBlockEntry>) => {
        applied.push(entries);
        return await original(entries);
      });

    await pass(3);

    expect(applied).toHaveLength(1);
    expect(
      applied[0]!.map((entry: SecurityBlockEntry): JSONObject => {
        return {
          value: entry.value,
          action: entry.action,
          indicatorType: entry.indicatorType,
          comment: entry.comment,
          expiresAt: entry.expiresAt ? entry.expiresAt.toISOString() : null,
        };
      }),
    ).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        indicatorType: "IpAddress",
        comment: "OneUptime case CASE-42 until 2026-11-21 10:43 UTC",
        expiresAt: "2026-11-21T10:43:00.000Z",
      },
      {
        value: "35.205.11.0/24",
        action: SecurityBlockAction.Block,
        indicatorType: "IpRange",
        comment: "OneUptime blocklist until lifted",
        expiresAt: null,
      },
    ]);
  });

  test("is told to its case's timeline once, when a destination first holds it", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });

    await pass(2);
    await pass(3);
    await pass(10);

    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]!["securityCaseId"]).toEqual(CASE_ID);
    expect(feedItems[0]!["projectId"]).toEqual(PROJECT_ID);
    expect(feedItems[0]!["eventType"]).toBe(
      SecurityCaseFeedEventType.ResponseAction,
    );
    expect(String(feedItems[0]!["feedInfoInMarkdown"])).toBe(
      "🛡️ The block on `35.205.11.131` is enforced at Test destination.",
    );
  });

  test("with no case says nothing to any timeline", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(2);

    expect(rowOf(1, destination)!.state).toBe(
      SecurityBlockEnforcementState.Applied,
    );
    expect(feedItems).toEqual([]);
  });

  test("is applied at every destination, each with a row of its own", async () => {
    const first: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({
        key: "Test:first",
        name: "First edge",
      });
    const second: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({
        key: "Test:second",
        name: "Second edge",
      });
    enforceAt(first, second);
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });

    const result: SecurityBlocklistPassResult = await pass(2);

    expect(result.destinations).toBe(2);
    expect(first.getOneUptimeValues()).toEqual(["35.205.11.131"]);
    expect(second.getOneUptimeValues()).toEqual(["35.205.11.131"]);
    expect(rowOf(1, first)!.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(rowOf(1, first)!.destinationName).toBe("First edge");
    expect(rowOf(1, second)!.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(linesSaying("is enforced at")).toEqual([
      "🛡️ The block on `35.205.11.131` is enforced at First edge.",
      "🛡️ The block on `35.205.11.131` is enforced at Second edge.",
    ]);
  });

  test("of another project is left to that project's pass", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({
      index: 1,
      value: "35.205.11.131",
      projectId: OTHER_PROJECT_ID,
    });

    const result: SecurityBlocklistPassResult = await pass(2);

    // No block, no row: nothing for this project to keep at the destination.
    expect(result.skipped).toBe(1);
    expect(destination.calls).toEqual([]);
    expect(rows.size).toBe(0);
  });
});

describe("a block that ends", () => {
  test("lifted, it is removed from the destination and its row is Removed", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });
    addBlock({ index: 2, value: "35.205.11.132" });

    await pass(5);
    setState(1, SecurityBlockState.Lifted);
    await pass(6);

    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.132"]);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Removed);
    expect(errorOf(1, destination)).toBeNull();
    expect(stateOf(2, destination)).toBe(SecurityBlockEnforcementState.Applied);

    expect(
      destination.calls
        .filter((made: { call: string }): boolean => {
          return made.call === "remove";
        })
        .map((made: { values: Array<string> }): Array<string> => {
          return made.values;
        }),
    ).toEqual([["35.205.11.131"]]);
  });

  test("past its expiry, it is removed even before the expiry worker marks it Expired", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131", expiresAt: at(60) });

    await pass(5);
    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.131"]);

    // Still Active in the table: only its time is up.
    await pass(61);

    expect(blocks.get(blockId(1).toString())!.state).toBe(
      SecurityBlockState.Active,
    );
    expect(destination.getOneUptimeValues()).toEqual([]);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Removed);
  });

  test("once removed, it leaves the destination alone on every pass after", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(5);
    setState(1, SecurityBlockState.Lifted);
    await pass(6);

    const callsBefore: number = destination.calls.length;
    const result: SecurityBlocklistPassResult = await pass(7);

    expect(result.skipped).toBe(1);
    expect(destination.calls).toHaveLength(callsBefore);
  });

  test("whose value an active block now holds goes Removed, and the item stays for the active block", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(5);
    const providerRef: string | undefined = rowOf(1, destination)!.providerRef;

    // Lifted, then blocked again: a new block of the same value.
    setState(1, SecurityBlockState.Lifted);
    addBlock({ index: 2, value: "35.205.11.131", createdAt: at(6) });

    await pass(7);

    expect(destination.countCalls("remove")).toBe(0);
    expect(destination.countCalls("apply")).toBe(1);
    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.131"]);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Removed);
    expect(stateOf(2, destination)).toBe(SecurityBlockEnforcementState.Applied);
    expect(rowOf(2, destination)!.providerRef).toBe(providerRef);
  });

  test("while the destination is down, its row says it is being removed, and it is removed once the destination answers", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(5);
    setState(1, SecurityBlockState.Lifted);
    destination.failNextCalls("readBack", 1, "The test destination is down.");

    await pass(6);

    // Held at the provider still, and wanted gone: Removing, never Applied.
    expect(stateOf(1, destination)).toBe(
      SecurityBlockEnforcementState.Removing,
    );
    expect(errorOf(1, destination)).toBe(
      "Could not read Test destination: The test destination is down.",
    );
    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.131"]);

    await pass(7);

    expect(destination.getOneUptimeValues()).toEqual([]);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Removed);
  });
});

describe("drift", () => {
  test("an item removed at the provider is put back on the next pass, and stays Applied without a second timeline line", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });

    await pass(5);
    const appliedAt: Date | undefined = rowOf(1, destination)!.appliedAt;

    destination.removeAtProvider("35.205.11.131", SecurityBlockAction.Block);
    expect(destination.getOneUptimeValues()).toEqual([]);

    await pass(6);

    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.131"]);
    expect(destination.countCalls("apply")).toBe(2);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Applied);
    // Held since it was first applied, under the provider's reference for the item put back.
    expect(rowOf(1, destination)!.appliedAt).toEqual(appliedAt);
    expect(rowOf(1, destination)!.providerRef).toBe("test-item-2");
    expect(linesSaying("is enforced at")).toHaveLength(1);
  });

  test("an item OneUptime added that no active block wants is taken away", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    destination.addOneUptimeItem({
      value: "198.51.100.9",
      action: SecurityBlockAction.Block,
    });
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(5);

    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.131"]);
  });

  test("the customer's own items are never removed, never reported and never given a row", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    destination.addCustomerItem("198.51.100.0/24", SecurityBlockAction.Block);
    destination.addCustomerItem("203.0.113.9", SecurityBlockAction.Challenge);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(5);
    setState(1, SecurityBlockState.Lifted);
    await pass(6);

    expect(destination.getCustomerValues()).toEqual([
      "198.51.100.0/24",
      "203.0.113.9",
    ]);
    expect(destination.getOneUptimeValues()).toEqual([]);
    expect(rows.size).toBe(1);

    const removed: Array<string> = destination.calls
      .filter((made: { call: string }): boolean => {
        return made.call === "remove";
      })
      .flatMap((made: { values: Array<string> }): Array<string> => {
        return made.values;
      });
    expect(removed).toEqual(["35.205.11.131"]);
  });
});

describe("a destination that cannot hold a block", () => {
  test("a Challenge where it cannot challenge, and an IPv6 block where it matches IPv4 only, say why and are never sent", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ canChallenge: false, ipv4Only: true });
    enforceAt(destination);
    addBlock({
      index: 1,
      value: "35.205.11.131",
      action: SecurityBlockAction.Challenge,
      hasCase: true,
    });
    addBlock({ index: 2, value: "2001:db8::7", hasCase: true });
    addBlock({ index: 3, value: "35.205.11.132" });

    await pass(5);
    await pass(6);

    expect(
      destination.calls
        .filter((made: { call: string }): boolean => {
          return made.call === "apply";
        })
        .map((made: { values: Array<string> }): Array<string> => {
          return made.values;
        }),
    ).toEqual([["35.205.11.132"]]);

    expect(rowOf(1, destination)!.state).toBe(
      SecurityBlockEnforcementState.Failed,
    );
    expect(errorOf(1, destination)).toBe(
      "Not applied: Test destination cannot challenge",
    );
    expect(errorOf(2, destination)).toBe(
      "Not applied: Test destination matches IPv4 only",
    );

    // Nothing to retry: a destination that cannot hold it will not later.
    expect(rowOf(1, destination)!.failedAttempts).toBe(0);
    expect(retryAtOf(1, destination)).toBeNull();
    expect(stateOf(3, destination)).toBe(SecurityBlockEnforcementState.Applied);

    // Said to the case once, however many passes find it so.
    expect(linesSaying("is not enforced at")).toEqual([
      "⚠️ The block on `35.205.11.131` is not enforced at Test destination. Not applied: Test destination cannot challenge",
      "⚠️ The block on `2001:db8::7` is not enforced at Test destination. Not applied: Test destination matches IPv4 only",
    ]);
  });

  test("a held item for a block it can no longer hold is taken away", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({
      index: 1,
      value: "35.205.11.131",
      action: SecurityBlockAction.Challenge,
    });

    await pass(5);
    expect(
      destination.getOneUptimeValues(SecurityBlockAction.Challenge),
    ).toEqual(["35.205.11.131"]);

    destination.canChallenge = false;
    await pass(6);

    expect(destination.getOneUptimeValues()).toEqual([]);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Failed);
  });
});

describe("a full destination", () => {
  test("holds the oldest blocks, and the newest says it does not fit, in the destination's words", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({
        capacity: 2,
        fullReason: "the test list is full (2)",
      });
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });
    addBlock({ index: 2, value: "35.205.11.132" });
    addBlock({ index: 3, value: "35.205.11.133", hasCase: true });

    await pass(5);

    expect(destination.getOneUptimeValues()).toEqual([
      "35.205.11.131",
      "35.205.11.132",
    ]);
    expect(stateOf(3, destination)).toBe(SecurityBlockEnforcementState.Failed);
    expect(errorOf(3, destination)).toBe(
      "Not applied: the test list is full (2)",
    );
    expect(linesSaying("is not enforced at")).toEqual([
      "⚠️ The block on `35.205.11.133` is not enforced at Test destination. Not applied: the test list is full (2)",
    ]);
  });

  test("names itself full when it gives no words of its own", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ capacity: 2 });
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });
    addBlock({ index: 2, value: "35.205.11.132" });
    addBlock({ index: 3, value: "35.205.11.133" });

    await pass(5);

    expect(errorOf(3, destination)).toBe(
      "Not applied: Test destination is full (2)",
    );
  });

  test("takes the waiting block once a held one ends", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ capacity: 2 });
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });
    addBlock({ index: 2, value: "35.205.11.132" });
    addBlock({ index: 3, value: "35.205.11.133", hasCase: true });

    await pass(5);
    setState(1, SecurityBlockState.Lifted);
    await pass(6);

    expect(destination.getOneUptimeValues()).toEqual([
      "35.205.11.132",
      "35.205.11.133",
    ]);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Removed);
    expect(stateOf(3, destination)).toBe(SecurityBlockEnforcementState.Applied);
    expect(errorOf(3, destination)).toBeNull();
    expect(linesSaying("is enforced at")).toEqual([
      "🛡️ The block on `35.205.11.133` is enforced at Test destination.",
    ]);
  });

  test("never trades a block it holds for an older one", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ capacity: 2 });
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });
    addBlock({ index: 2, value: "35.205.11.132" });
    addBlock({ index: 3, value: "35.205.11.133" });

    // The oldest is turned down at first, so the newest gets in while it waits.
    destination.refuseValue("35.205.11.131", "not now");

    await pass(5);
    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.132"]);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Failed);
    expect(stateOf(3, destination)).toBe(SecurityBlockEnforcementState.Failed);

    // Before the oldest's retry: the room it left goes to the newest.
    await pass(5.5);
    expect(destination.getOneUptimeValues()).toEqual([
      "35.205.11.132",
      "35.205.11.133",
    ]);

    // The oldest's retry finds the destination full: the newest keeps its place.
    destination.stopRefusing("35.205.11.131");
    await pass(7);

    expect(destination.getOneUptimeValues()).toEqual([
      "35.205.11.132",
      "35.205.11.133",
    ]);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Failed);
    expect(errorOf(1, destination)).toBe(
      "Not applied: Test destination is full (2)",
    );
    expect(stateOf(3, destination)).toBe(SecurityBlockEnforcementState.Applied);
    expect(destination.countCalls("remove")).toBe(0);
  });
});

describe("a provider that refuses a block", () => {
  test("is Failed with the provider's words, tried again a minute later, then twice as long after, and Applied once it takes it", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });
    destination.refuseValue("35.205.11.131", "the provider said no");

    await pass(10);

    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Failed);
    expect(errorOf(1, destination)).toBe("Not applied: the provider said no");
    expect(rowOf(1, destination)!.failedAttempts).toBe(1);
    expect(retryAtOf(1, destination)).toEqual(at(11));

    // Before its retry, with nothing else to do: the destination is not read.
    const callsBefore: number = destination.calls.length;
    const waiting: SecurityBlocklistPassResult = await pass(10.5);
    expect(waiting.skipped).toBe(1);
    expect(destination.calls).toHaveLength(callsBefore);

    // Due: tried again, refused again, and the next wait is twice as long.
    await pass(11);
    expect(destination.countCalls("apply")).toBe(2);
    expect(rowOf(1, destination)!.failedAttempts).toBe(2);
    expect(retryAtOf(1, destination)).toEqual(at(13));

    destination.stopRefusing("35.205.11.131");
    await pass(13);

    const row: SecurityBlockEnforcement = rowOf(1, destination)!;
    expect(row.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(row.failedAttempts).toBe(0);
    expect(retryAtOf(1, destination)).toBeNull();
    expect(errorOf(1, destination)).toBeNull();
    expect(row.appliedAt).toEqual(at(13));

    // The case heard it was not enforced once, and that it is once.
    expect(linesSaying("is not enforced at")).toEqual([
      "⚠️ The block on `35.205.11.131` is not enforced at Test destination. Not applied: the provider said no",
    ]);
    expect(linesSaying("is enforced at")).toEqual([
      "🛡️ The block on `35.205.11.131` is enforced at Test destination.",
    ]);
  });

  test("names the destination when the provider gives no words", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });

    jest.spyOn(destination, "apply").mockResolvedValue([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        isDone: false,
      },
    ]);

    await pass(10);

    expect(errorOf(1, destination)).toBe(
      "Not applied: Test destination refused it",
    );
  });

  test("waits a minute, then two, four and eight, and never longer than half an hour", () => {
    expect(SECURITY_BLOCKLIST_FIRST_RETRY_IN_MS).toBe(MINUTE);
    expect(SECURITY_BLOCKLIST_LONGEST_RETRY_IN_MS).toBe(30 * MINUTE);
    expect(
      [0, 1, 2, 3, 4, 5, 6, 10, 50].map((attempts: number): number => {
        return getSecurityBlocklistRetryDelayInMs(attempts) / MINUTE;
      }),
    ).toEqual([1, 1, 2, 4, 8, 16, 30, 30, 30]);
  });
});

describe("a destination that is down", () => {
  test("has every row say it could not be read, waits its retry, and is left alone until then", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });
    addBlock({ index: 2, value: "35.205.11.132", hasCase: true });
    destination.failNextCalls("readBack", 1, "Test destination is down.");

    const failed: SecurityBlocklistPassResult = await pass(10);

    expect(failed).toEqual({ destinations: 1, skipped: 0, failed: 1 });

    // A row for each block, though none was ever applied: each says why it is not.
    for (const index of [1, 2]) {
      const row: SecurityBlockEnforcement = rowOf(index, destination)!;
      expect(row.state).toBe(SecurityBlockEnforcementState.Pending);
      expect(errorOf(index, destination)).toBe(
        "Could not read Test destination: Test destination is down.",
      );
      expect(row.failedAttempts).toBe(1);
      expect(retryAtOf(index, destination)).toEqual(at(11));
    }

    // An outage is no block turned down: the case hears nothing of it.
    expect(feedItems).toEqual([]);

    const callsBefore: number = destination.calls.length;
    const waiting: SecurityBlocklistPassResult = await pass(10.5);

    expect(waiting.skipped).toBe(1);
    expect(destination.calls).toHaveLength(callsBefore);
  });

  test("is tried at once for a block made while it waits", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });
    destination.failNextCalls("readBack", 1, "Test destination is down.");

    await pass(10);
    addBlock({ index: 2, value: "35.205.11.132", createdAt: at(10.2) });
    await pass(10.4);

    expect(destination.getOneUptimeValues()).toEqual([
      "35.205.11.131",
      "35.205.11.132",
    ]);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Applied);
    expect(errorOf(1, destination)).toBeNull();
    expect(rowOf(1, destination)!.failedAttempts).toBe(0);
    expect(stateOf(2, destination)).toBe(SecurityBlockEnforcementState.Applied);
  });

  test("recovers once its retry is due, and backs off longer each time it is still down", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });
    destination.failNextCalls("capacity", 2, "Test destination is down.");

    await pass(10);
    expect(retryAtOf(1, destination)).toEqual(at(11));

    await pass(11);
    expect(rowOf(1, destination)!.failedAttempts).toBe(2);
    expect(retryAtOf(1, destination)).toEqual(at(13));

    await pass(13);

    const row: SecurityBlockEnforcement = rowOf(1, destination)!;
    expect(row.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(errorOf(1, destination)).toBeNull();
    expect(retryAtOf(1, destination)).toBeNull();
    expect(row.failedAttempts).toBe(0);
  });

  test("a block it held before stays Applied while it cannot be read, but is not confirmed again", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(10);
    destination.failNextCalls("readBack", 1, "Test destination is down.");
    await pass(20);

    const row: SecurityBlockEnforcement = rowOf(1, destination)!;
    expect(row.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(row.lastConfirmedAt).toEqual(at(10));
    expect(errorOf(1, destination)).toBe(
      "Could not read Test destination: Test destination is down.",
    );
  });

  test("a write that fails leaves the rows saying so, and nothing Applied that was not read back", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });
    destination.failNextCalls("apply", 1, "The write timed out.");

    const result: SecurityBlocklistPassResult = await pass(10);

    expect(result.failed).toBe(1);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Pending);
    expect(errorOf(1, destination)).toBe(
      "Could not write to Test destination: The write timed out.",
    );
  });

  test("a read-back that fails after a write leaves the block Pending, saying so, until a read shows it", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });

    // The first read works, the one after the write does not.
    const original: typeof destination.readBack =
      destination.readBack.bind(destination);
    let reads: number = 0;
    jest.spyOn(destination, "readBack").mockImplementation(async () => {
      reads++;

      if (reads === 2) {
        throw new Error("The read timed out.");
      }

      return await original();
    });

    await pass(10);

    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Pending);
    expect(errorOf(1, destination)).toBe(
      "Could not read Test destination back: The read timed out.",
    );
    expect(retryAtOf(1, destination)).toEqual(at(11));

    await pass(11);

    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Applied);
    expect(errorOf(1, destination)).toBeNull();
  });
});

describe("a destination the project no longer has", () => {
  test("has its rows Removed, saying it no longer enforces the blocklist", async () => {
    const kept: TestSecurityBlockDestination = new TestSecurityBlockDestination(
      { key: "Test:kept", name: "Kept edge" },
    );
    const gone: TestSecurityBlockDestination = new TestSecurityBlockDestination(
      { key: "Test:gone", name: "Gone edge" },
    );
    enforceAt(kept, gone);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(5);
    expect(stateOf(1, gone)).toBe(SecurityBlockEnforcementState.Applied);

    enforceAt(kept);
    await pass(6);

    expect(stateOf(1, kept)).toBe(SecurityBlockEnforcementState.Applied);
    expect(stateOf(1, gone)).toBe(SecurityBlockEnforcementState.Removed);
    expect(errorOf(1, gone)).toBe(
      "Gone edge no longer enforces the blocklist.",
    );
  });

  test("but not while its kind could not be listed: it may be there still", async () => {
    const kept: TestSecurityBlockDestination = new TestSecurityBlockDestination(
      { key: "Test:kept", name: "Kept edge" },
    );
    const unlisted: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({
        key: "Test:unlisted",
        name: "Unlisted edge",
      });
    enforceAt(kept, unlisted);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(5);

    const failingSource: SecurityBlockDestinationSource = {
      provider: SecurityBlockDestinationProvider.Test,
      findForProject: async (): Promise<Array<SecurityBlockDestination>> => {
        throw new Error("The connections could not be read.");
      },
    };

    SecurityBlockDestinations.setSourcesForTests([
      {
        provider: SecurityBlockDestinationProvider.Test,
        findForProject: async (): Promise<Array<SecurityBlockDestination>> => {
          return [kept];
        },
      },
      failingSource,
    ]);

    await pass(6);

    expect(stateOf(1, unlisted)).toBe(SecurityBlockEnforcementState.Applied);
    expect(errorOf(1, unlisted)).toBeNull();
  });

  test("that comes back has its blocks applied there again", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(5);
    enforceAt();
    await pass(6);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Removed);

    destination.removeAtProvider("35.205.11.131", SecurityBlockAction.Block);
    enforceAt(destination);
    await pass(7);

    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.131"]);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Applied);
    expect(errorOf(1, destination)).toBeNull();
  });
});

describe("a destination another pass holds", () => {
  test("is left to that pass: nothing is read, written or recorded", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ key: "Test:busy" });
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });
    locks.busy.add("Test:busy");

    const result: SecurityBlocklistPassResult = await pass(5);

    expect(result.skipped).toBe(1);
    expect(destination.calls).toEqual([]);
    expect(rows.size).toBe(0);
  });

  test("is locked by its lock key, shared by destinations of one account, and given back after the pass", async () => {
    const zoneA: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({
        key: "Test:account:zone-a",
        lockKey: "Test:account",
      });
    const zoneB: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({
        key: "Test:account:zone-b",
        lockKey: "Test:account",
      });
    enforceAt(zoneA, zoneB);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(5);

    expect(locks.eventsOf("lock")).toEqual([
      `lock:${LOCK_NAMESPACE}/Test:account`,
      `lock:${LOCK_NAMESPACE}/Test:account`,
    ]);
    expect(locks.eventsOf("release")).toHaveLength(2);
    expect(locks.isHeld("Test:account", LOCK_NAMESPACE)).toBe(false);
    expect(stateOf(1, zoneA)).toBe(SecurityBlockEnforcementState.Applied);
    expect(stateOf(1, zoneB)).toBe(SecurityBlockEnforcementState.Applied);
  });

  test("given back even when the pass over it fails", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ key: "Test:failing" });
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });
    destination.failNextCalls("readBack", 1);

    await pass(5);

    expect(locks.isHeld("Test:failing", LOCK_NAMESPACE)).toBe(false);
  });
});

describe("what a read-back says", () => {
  test("an item still on its way to every edge is Pending, and Applied once it is in force", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });
    destination.setPropagating("35.205.11.131", true);

    await pass(5);

    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Pending);
    expect(rowOf(1, destination)!.providerRef).toBe("test-item-1");
    expect(rowOf(1, destination)!.appliedAt).toBeUndefined();
    expect(feedItems).toEqual([]);

    destination.setPropagating("35.205.11.131", false);
    await pass(6);

    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Applied);
    expect(rowOf(1, destination)!.appliedAt).toEqual(at(6));
    expect(destination.countCalls("apply")).toBe(1);
    expect(linesSaying("is enforced at")).toHaveLength(1);
  });

  test("the moment the provider was seen holding an item is when it was confirmed", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    destination.addOneUptimeItem({
      value: "35.205.11.131",
      action: SecurityBlockAction.Block,
      confirmedAt: at(3),
    });
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(5);

    // Already held: nothing to write, only to record.
    expect(destination.countCalls("apply")).toBe(0);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Applied);
    expect(rowOf(1, destination)!.appliedAt).toEqual(at(3));
    expect(rowOf(1, destination)!.lastConfirmedAt).toEqual(at(3));
  });

  test("a value written another way by the provider is the same block", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    destination.addOneUptimeItem({
      value: "2001:DB8:0:0:0:0:0:7/128",
      action: SecurityBlockAction.Block,
    });
    addBlock({ index: 1, value: "2001:db8::7" });

    await pass(5);

    expect(destination.countCalls("apply")).toBe(0);
    expect(destination.countCalls("remove")).toBe(0);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Applied);
  });
});

describe("a pass that changes nothing", () => {
  test("writes nothing, and a confirmation is written again only once it is a few minutes old", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(10);
    const writesAfterFirst: number = rowWrites.length;

    await pass(11);
    await pass(12);

    expect(rowWrites).toHaveLength(writesAfterFirst);
    expect(rowOf(1, destination)!.lastConfirmedAt).toEqual(at(10));

    const refreshAt: number =
      10 + SECURITY_BLOCKLIST_CONFIRMATION_REFRESH_IN_MS / MINUTE;
    await pass(refreshAt);

    expect(rowWrites).toHaveLength(writesAfterFirst + 1);
    expect(rowWrites[rowWrites.length - 1]!.data).toEqual({
      lastConfirmedAt: at(refreshAt),
    });
    expect(rowOf(1, destination)!.lastConfirmedAt).toEqual(at(refreshAt));
  });

  test("with no destination at all, reads blocks and writes nothing", async () => {
    enforceAt();
    addBlock({ index: 1, value: "35.205.11.131" });

    const result: SecurityBlocklistPassResult = await pass(5);

    expect(result).toEqual({ destinations: 0, skipped: 0, failed: 0 });
    expect(rows.size).toBe(0);
    expect(feedItems).toEqual([]);
  });
});

describe("the every-minute pass", () => {
  let projectLookups: Array<JSONObject>;
  let projectsWithWork: Array<ObjectID>;
  let jobs: Array<Array<unknown>>;
  let failingJobs: number;

  beforeEach(() => {
    projectLookups = [];
    projectsWithWork = [];
    jobs = [];
    failingJobs = 0;

    jest
      .spyOn(SecurityBlockService, "findProjectIdsWithWork")
      .mockImplementation((async (args: unknown): Promise<Array<ObjectID>> => {
        projectLookups.push(args as JSONObject);
        return projectsWithWork;
      }) as never);

    jest.spyOn(Queue, "addJob").mockImplementation((async (
      ...args: Array<unknown>
    ): Promise<void> => {
      jobs.push(args);

      if (failingJobs > 0) {
        failingJobs--;
        throw new Error("Redis client is not connected");
      }
    }) as never);
  });

  test("queues nothing, and reads nothing, while no kind of destination exists", async () => {
    // Every server has AWS WAF and the feeds (#10344, #10345), so a server with no kind of destination is one a test makes.
    SecurityBlockDestinations.setSourcesForTests([]);
    projectsWithWork = [PROJECT_ID];

    expect(SecurityBlockDestinations.hasSources()).toBe(false);
    expect(await SecurityBlocklistReconciler.queueDueProjects()).toBe(0);
    expect(projectLookups).toEqual([]);
    expect(jobs).toEqual([]);

    // Nor does a change to a block: there is nothing to apply it at.
    await SecurityBlocklistJobs.queueReconcile(PROJECT_ID);
    expect(jobs).toEqual([]);
  });

  test("queues one reconcile per project with something to keep, deduplicated per project", async () => {
    enforceAt(new TestSecurityBlockDestination());
    projectsWithWork = [PROJECT_ID, OTHER_PROJECT_ID];

    expect(await SecurityBlocklistReconciler.queueDueProjects()).toBe(2);
    expect(projectLookups).toEqual([
      { limit: SECURITY_BLOCKLIST_MAX_PROJECTS_PER_PASS },
    ]);
    expect(jobs).toHaveLength(2);

    [PROJECT_ID, OTHER_PROJECT_ID].forEach(
      (projectId: ObjectID, index: number): void => {
        const [queueName, jobId, jobName, data, options] = jobs[index] as [
          QueueName,
          string,
          string,
          JSONObject,
          JSONObject,
        ];

        expect(queueName).toBe(QueueName.Worker);
        expect(
          jobId.startsWith(
            `security-blocklist-reconcile-${projectId.toString()}-`,
          ),
        ).toBe(true);
        expect(jobName).toBe(SECURITY_BLOCKLIST_RECONCILE_JOB);
        expect(data).toEqual({ projectId: projectId.toString() });

        // One runs and one waits, whatever the number of changes: a burst of blocks is one pass.
        expect(options).toEqual({
          deduplication: {
            id: `security-blocklist-reconcile-${projectId.toString()}`,
            keepLastIfActive: true,
          },
          removeWhenDone: true,
          skipExistenceCheck: true,
        });
      },
    );

    // Each job its own id, so a finished one never stands in for the next.
    expect(jobs[0]![1]).not.toBe(jobs[1]![1]);
  });

  test("a project whose reconcile cannot be queued is left to the next pass, and the others are queued", async () => {
    enforceAt(new TestSecurityBlockDestination());
    projectsWithWork = [PROJECT_ID, OTHER_PROJECT_ID];
    failingJobs = 1;

    expect(await SecurityBlocklistReconciler.queueDueProjects()).toBe(2);
    expect(jobs).toHaveLength(2);
    expect((jobs[1]![3] as JSONObject)["projectId"]).toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });

  test("a reconcile that cannot be queued is never thrown: the block stands, and the next pass reconciles it", async () => {
    enforceAt(new TestSecurityBlockDestination());
    failingJobs = 1;

    await expect(
      SecurityBlocklistJobs.queueReconcile(PROJECT_ID),
    ).resolves.toBeUndefined();
    expect(jobs).toHaveLength(1);
  });
});

// ---------- The rules, without a destination ----------

// A destination's supports(), as the plan asks it.
function supportsAll(): Pick<SecurityBlockDestination, "supports"> {
  return {
    supports: (): SecurityBlockSupport => {
      return { isSupported: true };
    },
  };
}

function planBlock(
  index: number,
  value: string,
  action: SecurityBlockAction = SecurityBlockAction.Block,
): SecurityBlock {
  const read: SecurityBlockValue = readSecurityBlockValue(value)!;
  const block: SecurityBlock = new SecurityBlock();
  block._id = blockId(index).toString();
  block.value = read.value;
  block.indicatorType = read.indicatorType;
  block.action = action;
  block.state = SecurityBlockState.Active;
  block.createdAt = at(index);
  block.expiresAt = at(index + 60);
  return block;
}

function held(
  value: string,
  action: SecurityBlockAction = SecurityBlockAction.Block,
): SecurityBlockHeldItem {
  return { value, action };
}

function plan(data: {
  blocks: Array<SecurityBlock>;
  held?: Array<SecurityBlockHeldItem> | undefined;
  capacity?: SecurityBlockCapacity | undefined;
  rowsByBlock?: Map<string, SecurityBlockEnforcement> | undefined;
  destination?: Pick<SecurityBlockDestination, "supports"> | undefined;
  now?: Date | undefined;
}): SecurityBlocklistDestinationPlan {
  return planSecurityBlocklistDestination({
    destination: data.destination || supportsAll(),
    blocks: data.blocks,
    rowsByBlock: data.rowsByBlock || new Map(),
    held: data.held || [],
    capacity: data.capacity || { limit: null },
    now: data.now || NOW,
  });
}

function addedValues(result: SecurityBlocklistDestinationPlan): Array<string> {
  return result.toAdd.map((entry: SecurityBlockEntry): string => {
    return entry.value;
  });
}

describe("planSecurityBlocklistDestination", () => {
  test("adds what is not held, removes what no block wants, and leaves what is held alone", () => {
    const result: SecurityBlocklistDestinationPlan = plan({
      blocks: [planBlock(1, "35.205.11.131"), planBlock(2, "35.205.11.132")],
      held: [held("35.205.11.132"), held("198.51.100.9")],
    });

    expect(addedValues(result)).toEqual(["35.205.11.131"]);
    expect(result.toRemove).toEqual([held("198.51.100.9")]);
    expect(result.unsupported.size).toBe(0);
    expect(result.overflow.size).toBe(0);
    expect(result.waiting.size).toBe(0);
  });

  test("a held item of the other action is not the block: a Challenge does not stand for a Block", () => {
    const result: SecurityBlocklistDestinationPlan = plan({
      blocks: [planBlock(1, "35.205.11.131", SecurityBlockAction.Block)],
      held: [held("35.205.11.131", SecurityBlockAction.Challenge)],
    });

    expect(addedValues(result)).toEqual(["35.205.11.131"]);
    expect(result.toRemove).toEqual([
      held("35.205.11.131", SecurityBlockAction.Challenge),
    ]);
  });

  test("the room left is the limit less the blocks it holds; the rest, in the blocks' order, do not fit", () => {
    const result: SecurityBlocklistDestinationPlan = plan({
      blocks: [
        planBlock(1, "35.205.11.131"),
        planBlock(2, "35.205.11.132"),
        planBlock(3, "35.205.11.133"),
        planBlock(4, "35.205.11.134"),
      ],
      held: [held("35.205.11.133")],
      capacity: { limit: 3 },
    });

    expect(addedValues(result)).toEqual(["35.205.11.131", "35.205.11.132"]);
    expect(Array.from(result.overflow)).toEqual([blockId(4).toString()]);
  });

  test("a destination holding more than its limit adds nothing, and removes none of the blocks it holds", () => {
    const result: SecurityBlocklistDestinationPlan = plan({
      blocks: [
        planBlock(1, "35.205.11.131"),
        planBlock(2, "35.205.11.132"),
        planBlock(3, "35.205.11.133"),
      ],
      held: [held("35.205.11.131"), held("35.205.11.132")],
      capacity: { limit: 1 },
    });

    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual([]);
    expect(Array.from(result.overflow)).toEqual([blockId(3).toString()]);
  });

  test("a block the destination cannot hold is named with why, never added, and its held item is removed", () => {
    const result: SecurityBlocklistDestinationPlan = plan({
      blocks: [
        planBlock(1, "35.205.11.131", SecurityBlockAction.Challenge),
        planBlock(2, "35.205.11.132"),
      ],
      held: [held("35.205.11.131", SecurityBlockAction.Challenge)],
      destination: {
        supports: (entry: {
          action: SecurityBlockAction;
        }): SecurityBlockSupport => {
          return entry.action === SecurityBlockAction.Challenge
            ? { isSupported: false, reason: "It cannot challenge" }
            : { isSupported: true };
        },
      },
    });

    expect(addedValues(result)).toEqual(["35.205.11.132"]);
    expect(result.unsupported.get(blockId(1).toString())).toBe(
      "It cannot challenge",
    );
    expect(result.toRemove).toEqual([
      held("35.205.11.131", SecurityBlockAction.Challenge),
    ]);
  });

  test("a block refused by the provider waits for its retry, and is a candidate again once it is due", () => {
    const row: SecurityBlockEnforcement = new SecurityBlockEnforcement();
    row.state = SecurityBlockEnforcementState.Failed;
    row.retryAt = at(1);

    const rowsByBlock: Map<string, SecurityBlockEnforcement> = new Map([
      [blockId(1).toString(), row],
    ]);
    const blocksToPlan: Array<SecurityBlock> = [planBlock(1, "35.205.11.131")];

    const before: SecurityBlocklistDestinationPlan = plan({
      blocks: blocksToPlan,
      rowsByBlock,
      now: at(0.5),
    });
    expect(before.toAdd).toEqual([]);
    expect(Array.from(before.waiting)).toEqual([blockId(1).toString()]);

    const due: SecurityBlocklistDestinationPlan = plan({
      blocks: blocksToPlan,
      rowsByBlock,
      now: at(1),
    });
    expect(addedValues(due)).toEqual(["35.205.11.131"]);
    expect(due.waiting.size).toBe(0);
  });

  test("a block Pending after an outage is not held back: only a refusal waits", () => {
    const row: SecurityBlockEnforcement = new SecurityBlockEnforcement();
    row.state = SecurityBlockEnforcementState.Pending;
    row.retryAt = at(5);

    const result: SecurityBlocklistDestinationPlan = plan({
      blocks: [planBlock(1, "35.205.11.131")],
      rowsByBlock: new Map([[blockId(1).toString(), row]]),
      now: at(1),
    });

    expect(addedValues(result)).toEqual(["35.205.11.131"]);
  });
});

describe("getHeldItemKey", () => {
  test("keys an item by its action and its value as blocks are written, however the provider wrote it", () => {
    expect(getHeldItemKey("35.205.11.131", SecurityBlockAction.Block)).toBe(
      "Block|35.205.11.131",
    );
    expect(getHeldItemKey("35.205.11.131/32", SecurityBlockAction.Block)).toBe(
      "Block|35.205.11.131",
    );
    expect(
      getHeldItemKey("2001:DB8:0:0:0:0:0:7/128", SecurityBlockAction.Challenge),
    ).toBe("Challenge|2001:db8::7");
    expect(
      getHeldItemKey("::ffff:35.205.11.131", SecurityBlockAction.Block),
    ).toBe("Block|35.205.11.131");
    expect(getHeldItemKey("35.205.11.77/24", SecurityBlockAction.Block)).toBe(
      "Block|35.205.11.0/24",
    );
  });

  test("keys a value that is no address as written, trimmed and lowercased, so it never matches a block", () => {
    expect(getHeldItemKey("  Evil.Example  ", SecurityBlockAction.Block)).toBe(
      "Block|evil.example",
    );
  });
});

describe("getSecurityBlockEntryComment", () => {
  test("names the case and when the block ends, in UTC to the minute", () => {
    const block: SecurityBlock = planBlock(1, "35.205.11.131");
    const securityCase: SecurityCase = new SecurityCase();
    securityCase.caseNumberWithPrefix = "CASE-123";
    block.securityCase = securityCase;
    block.expiresAt = new Date("2026-11-21T10:42:37.000Z");

    expect(getSecurityBlockEntryComment(block)).toBe(
      "OneUptime case CASE-123 until 2026-11-21 10:42 UTC",
    );
  });

  test("names the blocklist for a block made for no case, and says when a block has no end", () => {
    const block: SecurityBlock = planBlock(1, "35.205.11.131");
    block.expiresAt = new Date("2026-12-01T00:00:00.000Z");

    expect(getSecurityBlockEntryComment(block)).toBe(
      "OneUptime blocklist until 2026-12-01 00:00 UTC",
    );

    block.expiresAt = null as unknown as Date;
    expect(getSecurityBlockEntryComment(block)).toBe(
      "OneUptime blocklist until lifted",
    );
  });
});

/*
 * A provider whose lists are replaced whole - an AWS WAF IP set (#10344),
 * and as they come an Azure WAF custom rule or a Cloud Armor rule - takes a
 * pass's removals and additions in one call (update), so each list is
 * written once a pass however many blocks ended and began in it.
 */
describe("a destination that takes a pass's changes in one call", () => {
  test("is given what ended and what began together, and its rows are written as remove and apply would write them", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ batchesWrites: true });
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(1);

    expect(destination.countCalls("update")).toBe(1);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Applied);

    setState(1, SecurityBlockState.Lifted);
    addBlock({ index: 2, value: "35.205.11.132" });

    await pass(2);

    expect(
      destination.calls
        .filter((made: { call: string }): boolean => {
          return made.call === "update";
        })
        .map((made: { values: Array<string> }): Array<string> => {
          return made.values;
        }),
    ).toEqual([["+35.205.11.131"], ["-35.205.11.131", "+35.205.11.132"]]);
    // Never the two calls of a destination that writes item by item.
    expect(destination.countCalls("apply")).toBe(0);
    expect(destination.countCalls("remove")).toBe(0);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Removed);
    expect(stateOf(2, destination)).toBe(SecurityBlockEnforcementState.Applied);
    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.132"]);
  });

  test("a pass with nothing to change does not call it", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ batchesWrites: true });
    enforceAt(destination);
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(1);
    await pass(2);

    expect(destination.countCalls("update")).toBe(1);
    expect(destination.countCalls("readBack")).toBeGreaterThanOrEqual(3);
  });

  test("one that fails is the destination failing: each row says so, and waits its retry", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ batchesWrites: true });
    enforceAt(destination);
    destination.failNextCalls("update", 1, "The provider is down.");
    addBlock({ index: 1, value: "35.205.11.131" });

    const result: SecurityBlocklistPassResult = await pass(1);

    expect(result.failed).toBe(1);
    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Pending);
    expect(errorOf(1, destination)).toBe(
      "Could not write to Test destination: The provider is down.",
    );
    expect(retryAtOf(1, destination)).toEqual(
      new Date(at(1).getTime() + SECURITY_BLOCKLIST_FIRST_RETRY_IN_MS),
    );
  });

  test("an entry it turns down says why, as one apply turned down would", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ batchesWrites: true });
    enforceAt(destination);
    destination.refuseValue("35.205.11.131", "the list is locked");
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(1);

    expect(stateOf(1, destination)).toBe(SecurityBlockEnforcementState.Failed);
    expect(errorOf(1, destination)).toBe("Not applied: the list is locked");
  });
});

describe("the destinations a project has in production", () => {
  test("are Cloudflare's lists and rules (#10343), AWS WAF's web ACLs (#10344) and the blocklist feeds (#10345), and never the test destination", () => {
    SecurityBlockDestinations.resetSourcesForTests();

    expect(SecurityBlockDestinations.hasSources()).toBe(true);
    expect(
      SecurityBlockDestinations.getSources().map(
        (source: SecurityBlockDestinationSource): string => {
          return source.provider;
        },
      ),
    ).toEqual([
      SecurityBlockDestinationProvider.Cloudflare,
      SecurityBlockDestinationProvider.AwsWaf,
      SecurityBlockDestinationProvider.Feed,
    ]);
  });
});

describe("a challenge where a destination cannot challenge (#10350)", () => {
  function policyChallenge(index: number, value: string): SecurityBlock {
    const block: SecurityBlock = addBlock({
      index,
      value,
      action: SecurityBlockAction.Challenge,
    });
    block.source = SecurityBlockSource.AutomaticResponse;
    block.challengeFallsBackToBlock = true;
    return block;
  }

  test("an automatic response policy's is held there as a block, for the same time", async () => {
    const edge: TestSecurityBlockDestination = new TestSecurityBlockDestination(
      { key: "Test:edge", name: "Cloudflare", canChallenge: true },
    );
    const feed: TestSecurityBlockDestination = new TestSecurityBlockDestination(
      { key: "Test:feed", name: "Palo Alto feed", canChallenge: false },
    );
    enforceAt(edge, feed);
    policyChallenge(1, "35.205.11.131");

    await pass(2);

    expect(edge.getOneUptimeValues(SecurityBlockAction.Challenge)).toEqual([
      "35.205.11.131",
    ]);
    expect(feed.getOneUptimeValues(SecurityBlockAction.Block)).toEqual([
      "35.205.11.131",
    ]);
    expect(feed.getOneUptimeValues(SecurityBlockAction.Challenge)).toEqual([]);
    expect(stateOf(1, edge)).toBe(SecurityBlockEnforcementState.Applied);
    expect(stateOf(1, feed)).toBe(SecurityBlockEnforcementState.Applied);

    // Read back as the block it is there, a second pass changes nothing.
    await pass(3);

    expect(feed.getOneUptimeValues(SecurityBlockAction.Block)).toEqual([
      "35.205.11.131",
    ]);
    expect(stateOf(1, feed)).toBe(SecurityBlockEnforcementState.Applied);
  });

  test("once it ends, the block it was held as is taken away", async () => {
    const feed: TestSecurityBlockDestination = new TestSecurityBlockDestination(
      { key: "Test:feed", name: "Palo Alto feed", canChallenge: false },
    );
    enforceAt(feed);
    policyChallenge(1, "35.205.11.131");

    await pass(2);
    setState(1, SecurityBlockState.Lifted);
    await pass(3);

    expect(feed.getOneUptimeValues()).toEqual([]);
    expect(stateOf(1, feed)).toBe(SecurityBlockEnforcementState.Removed);
  });

  test("a person's challenge is never turned into a block behind their back: it is not applied there, saying why", async () => {
    const feed: TestSecurityBlockDestination = new TestSecurityBlockDestination(
      { key: "Test:feed", name: "Palo Alto feed", canChallenge: false },
    );
    enforceAt(feed);
    addBlock({
      index: 1,
      value: "35.205.11.131",
      action: SecurityBlockAction.Challenge,
    });

    await pass(2);

    expect(feed.getOneUptimeValues()).toEqual([]);
    expect(stateOf(1, feed)).toBe(SecurityBlockEnforcementState.Failed);
    expect(errorOf(1, feed)).toBe(
      "Not applied: Palo Alto feed cannot challenge",
    );
  });

  test("the plan asks each destination for the action it holds", () => {
    const block: SecurityBlock = policyChallenge(1, "35.205.11.131");
    const plan: SecurityBlocklistDestinationPlan =
      planSecurityBlocklistDestination({
        destination: new TestSecurityBlockDestination({ canChallenge: false }),
        blocks: [block],
        rowsByBlock: new Map(),
        held: [],
        capacity: { limit: null },
        now: NOW,
      });

    expect(
      plan.toAdd.map((entry: SecurityBlockEntry) => {
        return entry.action;
      }),
    ).toEqual([SecurityBlockAction.Block]);
    expect(plan.unsupported.size).toBe(0);
  });
});

describe("a block whose address became protected after it was made (#10640)", () => {
  let withheld: Array<string>;
  let isReadable: boolean;

  beforeEach(() => {
    withheld = [];
    isReadable = true;
    jest
      .spyOn(SecurityBlocklistFeedProtection, "check")
      .mockImplementation(
        async (data: {
          entries: ReadonlyArray<SecurityBlocklistFeedEntry>;
        }): Promise<SecurityBlocklistFeedProtectionCheck> => {
          if (!isReadable) {
            return { isReadable: false, served: [], withheld: [] };
          }

          return {
            isReadable: true,
            served: data.entries.filter((entry: SecurityBlocklistFeedEntry) => {
              return !withheld.includes(entry.value);
            }),
            withheld: data.entries
              .filter((entry: SecurityBlocklistFeedEntry) => {
                return withheld.includes(entry.value);
              })
              .map((entry: SecurityBlocklistFeedEntry) => {
                return {
                  entry,
                  protection: {
                    source: SecurityProtectedAddressSource.Host,
                    protectedValue: entry.value,
                    name: "web-3",
                  },
                };
              }),
          };
        },
      );
  });

  test("is held back everywhere: taken off where it is held, its row and its case saying why, never naming the record", async () => {
    const edge: TestSecurityBlockDestination = new TestSecurityBlockDestination(
      { key: "Test:edge", name: "Cloudflare" },
    );
    enforceAt(edge);
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });
    addBlock({ index: 2, value: "35.205.11.132", hasCase: true });

    await pass(2);
    expect(edge.getOneUptimeValues().sort()).toEqual([
      "35.205.11.131",
      "35.205.11.132",
    ]);

    // A host comes up on the first address.
    withheld = ["35.205.11.131"];
    await pass(3);

    expect(edge.getOneUptimeValues()).toEqual(["35.205.11.132"]);
    expect(stateOf(1, edge)).toBe(SecurityBlockEnforcementState.Failed);
    expect(errorOf(1, edge)).toBe(
      "Held back: 35.205.11.131 is protected now, so OneUptime took the block off. 35.205.11.131 is one of your project's own addresses.",
    );
    expect(errorOf(1, edge)).not.toContain("web-3");
    expect(stateOf(2, edge)).toBe(SecurityBlockEnforcementState.Applied);
    expect(
      linesSaying("is not enforced at Cloudflare. Held back"),
    ).toHaveLength(1);

    // Said once: a pass that finds the same changes nothing.
    await pass(4);
    expect(linesSaying("Held back")).toHaveLength(1);
  });

  test("stays held back while what the project protects cannot be read, and nothing new is", async () => {
    const edge: TestSecurityBlockDestination = new TestSecurityBlockDestination(
      { key: "Test:edge", name: "Cloudflare" },
    );
    enforceAt(edge);
    addBlock({ index: 1, value: "35.205.11.131" });
    addBlock({ index: 2, value: "35.205.11.132" });

    withheld = ["35.205.11.131"];
    await pass(2);
    expect(edge.getOneUptimeValues()).toEqual(["35.205.11.132"]);

    isReadable = false;
    await pass(3);

    expect(edge.getOneUptimeValues()).toEqual(["35.205.11.132"]);
    expect(errorOf(1, edge)).toContain("Held back: ");
    expect(stateOf(2, edge)).toBe(SecurityBlockEnforcementState.Applied);
  });

  test("is held again once the address is no longer protected", async () => {
    const edge: TestSecurityBlockDestination = new TestSecurityBlockDestination(
      { key: "Test:edge", name: "Cloudflare" },
    );
    enforceAt(edge);
    addBlock({ index: 1, value: "35.205.11.131" });

    withheld = ["35.205.11.131"];
    await pass(2);
    expect(edge.getOneUptimeValues()).toEqual([]);

    withheld = [];
    await pass(3);

    expect(edge.getOneUptimeValues()).toEqual(["35.205.11.131"]);
    expect(stateOf(1, edge)).toBe(SecurityBlockEnforcementState.Applied);
    expect(errorOf(1, edge)).toBeNull();
  });

  test("names the block by id, one active block a value", () => {
    const one: SecurityBlock = addBlock({ index: 1, value: "35.205.11.131" });

    expect(
      findSecurityBlocksHeldBack({
        blocks: [one],
        check: { isReadable: false, withheld: [] },
      }),
    ).toBeNull();
    expect(toSecurityBlockProtectionEntries([one, one])).toHaveLength(1);
    expect(
      describeSecurityBlockHeldBack({
        value: "35.205.11.0/24",
        protection: {
          source: SecurityProtectedAddressSource.Edge,
          protectedValue: "35.205.11.0/24",
          name: "Cloudflare",
        },
      }),
    ).toContain("Cloudflare");
  });
});
