import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import AuditLogService from "../../../../Server/Services/AuditLogService";
import SecurityBlockService from "../../../../Server/Services/SecurityBlockService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityBlockExpiry, {
  SECURITY_BLOCK_EXPIRY_BATCH_SIZE,
  SECURITY_BLOCK_EXPIRY_MAX_BATCHES,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockExpiry";
import SecurityBlocklistJobs from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import SecurityBlockTimeline from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockTimeline";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

// A block that could not be ended is logged; the tests read what was ended instead.
jest.mock("../../../../Server/Utils/Logger");

/*
 * THE EVERY-MINUTE END OF BLOCKS WHOSE TIME IS UP (#10338).
 *
 * The blocks are held in memory behind SecurityBlockService: findBy answers
 * the worker's query as the database would (active, due, the oldest expiry
 * first, a batch at a time), and the compare-and-set ends a block only if
 * it is still in the state and with the expiry it was read with, as the
 * single UPDATE ... WHERE does. Two workers can be made to read the same
 * block before either ends it.
 *
 * What is pinned: a due block is ended once, whoever else is ending it; a
 * block lifted or extended in the meantime is left alone and nothing is
 * said of it; each ended block is said once on its case's timeline and
 * recorded once in the audit log as OneUptime's own change; each project is
 * reconciled once a run; and one block that cannot be ended stops nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CASE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const NOW: Date = new Date("2026-11-20T10:42:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MINUTE);
}

function blockId(index: number): ObjectID {
  return new ObjectID(
    `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
  );
}

// ---------- The blocks, as the database holds them ----------

let blocks: Map<string, SecurityBlock>;
let reads: Array<JSONObject>;
let claims: Array<{ id: string; data: JSONObject; expectedData: JSONObject }>;
let audits: Array<JSONObject>;
let feedItems: Array<JSONObject>;
let queued: Array<string>;

// Blocks whose compare-and-set fails outright, as a write the database turns down.
let unwritable: Set<string>;

// Something done to the table after a read is answered, before the worker writes.
let afterRead: (() => void) | null;

// How many workers' reads to hold until all of them have read: two workers handed the same blocks.
let readersToMeet: number;
let readersWaiting: Array<() => void>;

function copyOfBlock(block: SecurityBlock): SecurityBlock {
  const copy: SecurityBlock = new SecurityBlock();
  Object.assign(copy, block);
  return copy;
}

interface BlockData {
  index: number;
  value?: string | undefined;
  expiresAt: Date | null;
  // How long before its expiry it was made; 24 hours unless the test says.
  madeFor?: number | undefined;
  state?: SecurityBlockState | undefined;
  hasCase?: boolean | undefined;
  projectId?: ObjectID | undefined;
}

function addBlock(data: BlockData): SecurityBlock {
  const block: SecurityBlock = new SecurityBlock();

  block._id = blockId(data.index).toString();
  block.projectId = data.projectId || PROJECT_ID;
  block.value = data.value || `35.205.11.${data.index % 250}`;
  block.action = SecurityBlockAction.Block;
  block.state = data.state || SecurityBlockState.Active;
  block.source = SecurityBlockSource.Person;
  block.expiresAt = data.expiresAt as Date;
  block.createdAt = new Date(
    (data.expiresAt || NOW).getTime() - (data.madeFor ?? 24 * HOUR),
  );

  if (data.hasCase) {
    block.securityCaseId = CASE_ID;
  }

  blocks.set(block.id!.toString(), block);

  return block;
}

function stored(index: number): SecurityBlock {
  return blocks.get(blockId(index).toString())!;
}

// The moment the worker's query asks for blocks due by: the one parameter of its expiresAt operator.
function dueBy(query: JSONObject): Date {
  const operator: FindOperator<unknown> = query[
    "expiresAt"
  ] as unknown as FindOperator<unknown>;

  return Object.values(operator.objectLiteralParameters || {})[0] as Date;
}

function claimedIds(): Array<string> {
  return claims.map((claim: { id: string }): string => {
    return claim.id;
  });
}

beforeEach(() => {
  blocks = new Map();
  reads = [];
  claims = [];
  audits = [];
  feedItems = [];
  queued = [];
  unwritable = new Set();
  afterRead = null;
  readersToMeet = 1;
  readersWaiting = [];

  jest.spyOn(SecurityBlockService, "findBy").mockImplementation((async (
    args: unknown,
  ): Promise<Array<SecurityBlock>> => {
    const findBy: JSONObject = args as JSONObject;
    const query: JSONObject = findBy["query"] as JSONObject;
    const due: Date = dueBy(query);
    reads.push(findBy);

    const answer: Array<SecurityBlock> = Array.from(blocks.values())
      .filter((block: SecurityBlock): boolean => {
        return (
          block.state === query["state"] &&
          Boolean(block.expiresAt) &&
          block.expiresAt!.getTime() <= due.getTime()
        );
      })
      .sort((left: SecurityBlock, right: SecurityBlock): number => {
        return left.expiresAt!.getTime() - right.expiresAt!.getTime();
      })
      .slice(
        findBy["skip"] as number,
        (findBy["skip"] as number) + (findBy["limit"] as number),
      )
      .map(copyOfBlock);

    afterRead?.();

    if (readersToMeet > 1) {
      await new Promise<void>((resolve: () => void): void => {
        readersWaiting.push(resolve);

        if (readersWaiting.length === readersToMeet) {
          readersToMeet = 1;

          for (const wake of readersWaiting) {
            wake();
          }
        }
      });
    }

    return answer;
  }) as never);

  // One UPDATE ... WHERE state = $expected AND expiresAt = $expected: true only when it changed the row.
  jest
    .spyOn(SecurityBlockService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown): Promise<boolean> => {
      const input: {
        id: ObjectID;
        data: JSONObject;
        expectedData: JSONObject;
      } = args as {
        id: ObjectID;
        data: JSONObject;
        expectedData: JSONObject;
      };

      claims.push({
        id: input.id.toString(),
        data: input.data,
        expectedData: input.expectedData,
      });

      if (unwritable.has(input.id.toString())) {
        throw new Error("could not serialize access due to concurrent update");
      }

      const block: SecurityBlock | undefined = blocks.get(input.id.toString());
      const expectedExpiry: Date = input.expectedData["expiresAt"] as Date;

      if (
        !block ||
        block.state !== input.expectedData["state"] ||
        !block.expiresAt ||
        block.expiresAt.getTime() !== expectedExpiry.getTime()
      ) {
        return false;
      }

      block.state = input.data["state"] as SecurityBlockState;

      return true;
    }) as never);

  jest.spyOn(AuditLogService, "recordUpdate").mockImplementation((async (
    args: unknown,
  ): Promise<void> => {
    audits.push(args as JSONObject);
  }) as never);

  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (args: unknown): Promise<void> => {
      feedItems.push(args as JSONObject);
    }) as never);

  jest
    .spyOn(SecurityBlocklistJobs, "queueReconcile")
    .mockImplementation((async (projectId: ObjectID): Promise<void> => {
      queued.push(projectId.toString());
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a block whose time is up", () => {
  test("is ended in one compare-and-set on the state and expiry it was read with", async () => {
    addBlock({ index: 1, expiresAt: at(-1), hasCase: true });

    expect(await SecurityBlockExpiry.expireDueBlocks(NOW)).toBe(1);

    expect(claims).toEqual([
      {
        id: blockId(1).toString(),
        data: { state: SecurityBlockState.Expired },
        expectedData: {
          state: SecurityBlockState.Active,
          expiresAt: at(-1),
        },
      },
    ]);
    expect(stored(1).state).toBe(SecurityBlockState.Expired);
  });

  test("is read with the active blocks due by now, the oldest expiry first, a batch at a time, as OneUptime", async () => {
    addBlock({ index: 1, expiresAt: at(-1) });

    await SecurityBlockExpiry.expireDueBlocks(NOW);

    expect(reads).toHaveLength(1);

    const read: JSONObject = reads[0]!;
    const query: JSONObject = read["query"] as JSONObject;

    expect(query["state"]).toBe(SecurityBlockState.Active);
    expect(dueBy(query)).toEqual(NOW);
    expect(
      (query["expiresAt"] as unknown as FindOperator<unknown>).getSql!(
        "expiresAt",
      ),
    ).toMatch(/^\(expiresAt <= :/);
    expect(read["sort"]).toEqual({ expiresAt: SortOrder.Ascending });
    expect(read["skip"]).toBe(0);
    expect(read["limit"]).toBe(SECURITY_BLOCK_EXPIRY_BATCH_SIZE);
    expect(read["props"]).toEqual({ isRoot: true });

    // What the timeline line and the audit log are written from.
    expect(read["select"]).toMatchObject({
      _id: true,
      projectId: true,
      value: true,
      state: true,
      expiresAt: true,
      createdAt: true,
      securityCaseId: true,
    });
  });

  test("is said on its case's timeline, with how long it was made for", async () => {
    addBlock({
      index: 1,
      value: "35.205.11.131",
      expiresAt: at(-1),
      hasCase: true,
    });
    addBlock({
      index: 2,
      value: "2001:db8::/48",
      expiresAt: at(-0.5),
      madeFor: 7 * 24 * HOUR,
      hasCase: true,
    });

    await SecurityBlockExpiry.expireDueBlocks(NOW);

    expect(
      feedItems.map((item: JSONObject): string => {
        return String(item["feedInfoInMarkdown"]);
      }),
    ).toEqual([
      "⏱️ The block on `35.205.11.131` expired after 24 hours.",
      "⏱️ The block on `2001:db8::/48` expired after 7 days.",
    ]);
    expect(feedItems[0]).toMatchObject({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      eventType: SecurityCaseFeedEventType.ResponseAction,
      displayColor: SecurityBlockTimeline.colors.ended,
      postedAt: NOW,
    });
  });

  test("is recorded in the audit log as OneUptime's own change, in its project", async () => {
    addBlock({ index: 1, expiresAt: at(-1), hasCase: true });

    await SecurityBlockExpiry.expireDueBlocks(NOW);

    expect(audits).toHaveLength(1);

    const audit: JSONObject = audits[0]!;
    expect(audit["model"]).toBeInstanceOf(SecurityBlock);
    expect((audit["before"] as unknown as SecurityBlock).id!.toString()).toBe(
      blockId(1).toString(),
    );

    // As it was before: what the audit log compares the change with.
    expect((audit["before"] as unknown as SecurityBlock).state).toBe(
      SecurityBlockState.Active,
    );
    expect(audit["updatedFields"]).toEqual({
      state: SecurityBlockState.Expired,
    });
    expect((audit["itemId"] as unknown as ObjectID).toString()).toBe(
      blockId(1).toString(),
    );
    expect(audit["props"]).toEqual({ isRoot: true, tenantId: PROJECT_ID });
  });

  test("made for no case ends without a timeline line, and is still audited and reconciled", async () => {
    addBlock({ index: 1, expiresAt: at(-1) });

    expect(await SecurityBlockExpiry.expireDueBlocks(NOW)).toBe(1);

    expect(stored(1).state).toBe(SecurityBlockState.Expired);
    expect(feedItems).toEqual([]);
    expect(audits).toHaveLength(1);
    expect(queued).toEqual([PROJECT_ID.toString()]);
  });

  test("has its project reconciled once, however many of its blocks ended, so every destination lets them go", async () => {
    addBlock({ index: 1, expiresAt: at(-3) });
    addBlock({ index: 2, expiresAt: at(-2), projectId: OTHER_PROJECT_ID });
    addBlock({ index: 3, expiresAt: at(-1) });
    addBlock({ index: 4, expiresAt: at(-0.5) });

    expect(await SecurityBlockExpiry.expireDueBlocks(NOW)).toBe(4);

    expect(queued).toEqual([
      PROJECT_ID.toString(),
      OTHER_PROJECT_ID.toString(),
    ]);
  });
});

describe("a block that is not due", () => {
  test("is left alone: one ending later, one already lifted, one kept until lifted", async () => {
    addBlock({ index: 1, expiresAt: at(1) });
    addBlock({ index: 2, expiresAt: at(-5), state: SecurityBlockState.Lifted });
    addBlock({ index: 3, expiresAt: null });

    expect(await SecurityBlockExpiry.expireDueBlocks(NOW)).toBe(0);

    expect(claims).toEqual([]);
    expect(stored(1).state).toBe(SecurityBlockState.Active);
    expect(stored(2).state).toBe(SecurityBlockState.Lifted);
    expect(stored(3).state).toBe(SecurityBlockState.Active);
    expect(reads).toHaveLength(1);
    expect(queued).toEqual([]);
  });

  test("due to the very minute is ended", async () => {
    addBlock({ index: 1, expiresAt: NOW });

    expect(await SecurityBlockExpiry.expireDueBlocks(NOW)).toBe(1);
  });
});

describe("a block changed while the worker ends it", () => {
  test("extended after it was read is left alone, with its new expiry: nothing said, nothing recorded, nothing reconciled", async () => {
    addBlock({ index: 1, expiresAt: at(-1), hasCase: true });
    afterRead = (): void => {
      stored(1).expiresAt = at(24 * 60);
    };

    expect(await SecurityBlockExpiry.expireDueBlocks(NOW)).toBe(0);

    expect(claims).toHaveLength(1);
    expect(stored(1).state).toBe(SecurityBlockState.Active);
    expect(stored(1).expiresAt).toEqual(at(24 * 60));
    expect(feedItems).toEqual([]);
    expect(audits).toEqual([]);
    expect(queued).toEqual([]);
  });

  test("lifted after it was read stays lifted, and is not said to have expired", async () => {
    addBlock({ index: 1, expiresAt: at(-1), hasCase: true });
    afterRead = (): void => {
      stored(1).state = SecurityBlockState.Lifted;
    };

    expect(await SecurityBlockExpiry.expireDueBlocks(NOW)).toBe(0);

    expect(stored(1).state).toBe(SecurityBlockState.Lifted);
    expect(feedItems).toEqual([]);
    expect(audits).toEqual([]);
  });

  test("handed to two workers at once is ended by one: one timeline line, one audit record, one reconcile", async () => {
    addBlock({
      index: 1,
      value: "35.205.11.131",
      expiresAt: at(-1),
      hasCase: true,
    });
    readersToMeet = 2;

    const ended: Array<number> = await Promise.all([
      SecurityBlockExpiry.expireDueBlocks(NOW),
      SecurityBlockExpiry.expireDueBlocks(NOW),
    ]);

    // Both read it as active, both tried to end it, and one did.
    expect(reads).toHaveLength(2);
    expect(claimedIds()).toEqual([
      blockId(1).toString(),
      blockId(1).toString(),
    ]);
    expect(
      [...ended].sort((left: number, right: number): number => {
        return left - right;
      }),
    ).toEqual([0, 1]);

    expect(stored(1).state).toBe(SecurityBlockState.Expired);
    expect(
      feedItems.map((item: JSONObject): string => {
        return String(item["feedInfoInMarkdown"]);
      }),
    ).toEqual(["⏱️ The block on `35.205.11.131` expired after 24 hours."]);
    expect(audits).toHaveLength(1);
    expect(queued).toEqual([PROJECT_ID.toString()]);
  });
});

describe("a run", () => {
  test("reads a batch at a time until a batch comes back short", async () => {
    for (let index: number = 1; index <= 150; index++) {
      addBlock({ index, expiresAt: at(-200 + index) });
    }

    expect(await SecurityBlockExpiry.expireDueBlocks(NOW)).toBe(150);

    expect(reads).toHaveLength(2);
    expect(new Set(claimedIds()).size).toBe(150);
  });

  test("ends the oldest first, and at most twenty batches of them: the rest wait for the next minute", async () => {
    const due: number =
      SECURITY_BLOCK_EXPIRY_BATCH_SIZE * SECURITY_BLOCK_EXPIRY_MAX_BATCHES + 50;

    for (let index: number = 1; index <= due; index++) {
      addBlock({ index, expiresAt: at(-10000 + index) });
    }

    expect(await SecurityBlockExpiry.expireDueBlocks(NOW)).toBe(2000);

    expect(reads).toHaveLength(SECURITY_BLOCK_EXPIRY_MAX_BATCHES);
    expect(stored(2000).state).toBe(SecurityBlockState.Expired);
    expect(stored(2001).state).toBe(SecurityBlockState.Active);
    expect(stored(due).state).toBe(SecurityBlockState.Active);

    // The next minute's run ends the rest.
    expect(await SecurityBlockExpiry.expireDueBlocks(at(1))).toBe(50);
  });

  test("looks at each block once, though a block it could not end comes back in every batch", async () => {
    for (
      let index: number = 1;
      index <= SECURITY_BLOCK_EXPIRY_BATCH_SIZE;
      index++
    ) {
      addBlock({ index, expiresAt: at(-200 + index) });
      unwritable.add(blockId(index).toString());
    }

    expect(await SecurityBlockExpiry.expireDueBlocks(NOW)).toBe(0);

    // The second batch was the first again: nothing fresh, so the run stopped.
    expect(reads).toHaveLength(2);
    expect(claims).toHaveLength(SECURITY_BLOCK_EXPIRY_BATCH_SIZE);
    expect(new Set(claimedIds()).size).toBe(SECURITY_BLOCK_EXPIRY_BATCH_SIZE);
    expect(queued).toEqual([]);
  });

  test("goes on past a block it could not end, and ends the rest", async () => {
    addBlock({ index: 1, expiresAt: at(-3), hasCase: true });
    addBlock({ index: 2, expiresAt: at(-2), hasCase: true });
    addBlock({ index: 3, expiresAt: at(-1), hasCase: true });
    unwritable.add(blockId(2).toString());

    expect(await SecurityBlockExpiry.expireDueBlocks(NOW)).toBe(2);

    expect(stored(1).state).toBe(SecurityBlockState.Expired);
    expect(stored(2).state).toBe(SecurityBlockState.Active);
    expect(stored(3).state).toBe(SecurityBlockState.Expired);
    expect(feedItems).toHaveLength(2);
    expect(audits).toHaveLength(2);
    expect(queued).toEqual([PROJECT_ID.toString()]);
  });
});

describe("expireBlock", () => {
  test("leaves a block read without its id, project or expiry alone, and writes nothing", async () => {
    const withoutExpiry: SecurityBlock = addBlock({
      index: 1,
      expiresAt: null,
    });
    const withoutProject: SecurityBlock = copyOfBlock(
      addBlock({ index: 2, expiresAt: at(-1) }),
    );
    withoutProject.projectId = undefined as unknown as ObjectID;
    const withoutId: SecurityBlock = copyOfBlock(
      addBlock({ index: 3, expiresAt: at(-1) }),
    );
    withoutId._id = undefined as unknown as string;

    for (const block of [withoutExpiry, withoutProject, withoutId]) {
      expect(await SecurityBlockExpiry.expireBlock({ block, now: NOW })).toBe(
        false,
      );
    }

    expect(claims).toEqual([]);
    expect(audits).toEqual([]);
    expect(feedItems).toEqual([]);
  });

  test("says whether this worker ended the block", async () => {
    const block: SecurityBlock = copyOfBlock(
      addBlock({ index: 1, expiresAt: at(-1) }),
    );

    expect(await SecurityBlockExpiry.expireBlock({ block, now: NOW })).toBe(
      true,
    );
    expect(await SecurityBlockExpiry.expireBlock({ block, now: NOW })).toBe(
      false,
    );
    expect(audits).toHaveLength(1);
  });
});
