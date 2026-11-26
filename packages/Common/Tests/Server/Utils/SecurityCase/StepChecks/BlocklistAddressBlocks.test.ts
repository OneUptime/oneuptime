import SecurityBlock from "../../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityBlockEnforcementService from "../../../../../Server/Services/SecurityBlockEnforcementService";
import SecurityBlockService from "../../../../../Server/Services/SecurityBlockService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import AddressBlocks, {
  ADDRESS_BLOCK_SOURCES,
  AddressBlockEvidence,
  getEnforcedAddressBlocks,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AddressBlocks";
import SecurityBlocklistAddressBlockSource, {
  HELD_BLOCK_FACTS_READERS,
  HeldBlockFactsReader,
  doesBlockHoldAddress,
  getHeldBlockEvidence,
  readHeldBlockFacts,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/BlocklistAddressBlocks";
import { JSONObject } from "../../../../../Types/JSON";
import { SecurityCaseStepCheckSentence } from "../../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockState,
  readSecurityBlockValue,
} from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS,
  SecurityBlockDestinationProvider,
  SecurityBlockEnforcementState,
} from "../../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  ResponseLinkKind,
  readResponseLink,
} from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  CHECK_BLOCK_CHALLENGED_AT,
  CHECK_BLOCK_CLOUDFLARE_CHALLENGED,
  CHECK_BLOCK_CLOUDFLARE_STOPPED,
  CHECK_BLOCK_ENFORCED_AT,
  CHECK_BLOCK_NOT_ENFORCED,
  CHECK_BLOCK_RANGE_CHALLENGED_AT,
  CHECK_BLOCK_RANGE_ENFORCED_AT,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE PROJECT'S BLOCKLIST AS A SOURCE OF AN ADDRESS'S BLOCKS (#10562).
 *
 * The block step of a case's Response Plan is Checked by OneUptime once a
 * destination holds a block of the address and read it back. The source
 * reads the project's active blocks - the address's own, or a range that
 * holds it - and their enforcement rows, held here in memory behind the
 * two services it reads, as the database would answer them.
 *
 * Pinned: one piece of evidence per destination that holds a block,
 * naming it, since when and when it last confirmed it, linking to the
 * Blocklist; a lifted or expired block, or one of another address, is no
 * evidence; a block nothing holds is said as one, never as the address
 * blocked; and a read that fails throws.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ADDRESS: string = "35.205.11.131";
const RANGE: string = "35.205.11.0/24";
const NOW: Date = new Date("2026-11-21T10:42:00.000Z");
const MINUTE: number = 60 * 1000;

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MINUTE);
}

function blockId(index: number): ObjectID {
  return new ObjectID(
    `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
  );
}

function makeBlock(data: {
  index: number;
  value: string;
  action?: SecurityBlockAction;
  state?: SecurityBlockState;
  expiresAt?: Date | null;
  createdAt?: Date;
}): SecurityBlock {
  const block: SecurityBlock = new SecurityBlock(blockId(data.index));
  block.projectId = PROJECT_ID;
  block.value = data.value;
  block.indicatorType = data.value.includes("/")
    ? SecurityBlockIndicatorType.IpRange
    : SecurityBlockIndicatorType.IpAddress;
  block.action = data.action || SecurityBlockAction.Block;
  block.state = data.state || SecurityBlockState.Active;
  block.expiresAt =
    data.expiresAt === null
      ? (undefined as unknown as Date)
      : data.expiresAt || at(24 * 60);
  block.createdAt = data.createdAt || at(-30);
  return block;
}

function makeRow(data: {
  blockIndex: number;
  destination: string;
  state: SecurityBlockEnforcementState;
  appliedAt?: Date | undefined;
  lastConfirmedAt?: Date | undefined;
  error?: string | undefined;
}): SecurityBlockEnforcement {
  const row: SecurityBlockEnforcement = new SecurityBlockEnforcement();
  row.projectId = PROJECT_ID;
  row.securityBlockId = blockId(data.blockIndex);
  row.destinationName = data.destination;
  row.destinationKey = `Test:${data.destination}`;
  row.state = data.state;

  if (data.appliedAt) {
    row.appliedAt = data.appliedAt;
  }

  if (data.lastConfirmedAt) {
    row.lastConfirmedAt = data.lastConfirmedAt;
  }

  if (data.error) {
    row.error = data.error;
  }

  return row;
}

// ---------- The blocklist, as the database holds it ----------

let blocks: Array<SecurityBlock>;
let rows: Array<SecurityBlockEnforcement>;
let blockReads: Array<Record<string, unknown>>;
let failingRead: "blocks" | "rows" | null;

function matchesQuery(
  block: SecurityBlock,
  query: Record<string, unknown>,
): boolean {
  if (String(query["projectId"]) !== PROJECT_ID.toString()) {
    return false;
  }

  if (query["state"] !== undefined && block.state !== query["state"]) {
    return false;
  }

  if (query["value"] !== undefined && block.value !== query["value"]) {
    return false;
  }

  return !(
    query["indicatorType"] !== undefined &&
    block.indicatorType !== query["indicatorType"]
  );
}

beforeEach(() => {
  blocks = [];
  rows = [];
  blockReads = [];
  failingRead = null;

  jest
    .spyOn(SecurityBlockService, "findBy")
    .mockImplementation(async (findBy: unknown): Promise<any> => {
      const query: Record<string, unknown> = (
        findBy as { query: Record<string, unknown> }
      ).query;

      blockReads.push(query);

      if (failingRead === "blocks") {
        throw new Error("the database is down");
      }

      return blocks.filter((block: SecurityBlock): boolean => {
        return matchesQuery(block, query);
      });
    });

  jest
    .spyOn(SecurityBlockEnforcementService, "findForBlocks")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        securityBlockIds: Array<ObjectID>;
      }): Promise<Array<SecurityBlockEnforcement>> => {
        if (failingRead === "rows") {
          throw new Error("the database is down");
        }

        const wanted: Set<string> = new Set(
          data.securityBlockIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        );

        return rows.filter((row: SecurityBlockEnforcement): boolean => {
          return wanted.has(row.securityBlockId!.toString());
        });
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function read(
  address: string = ADDRESS,
): Promise<Array<AddressBlockEvidence>> {
  return await SecurityBlocklistAddressBlockSource.readBlocks({
    projectId: PROJECT_ID,
    address,
    now: NOW,
  });
}

describe("the source is the project's Blocklist", () => {
  test("is named for the logs and plugged into the step's sources", () => {
    expect(SecurityBlocklistAddressBlockSource.name).toBe("Security blocklist");
    expect(ADDRESS_BLOCK_SOURCES).toContain(
      SecurityBlocklistAddressBlockSource,
    );
  });

  test("reads the address's own active block and every active range, nothing else", async () => {
    await read();

    expect(blockReads).toHaveLength(2);
    expect(blockReads).toContainEqual({
      projectId: PROJECT_ID,
      state: SecurityBlockState.Active,
      value: ADDRESS,
    });
    expect(blockReads).toContainEqual({
      projectId: PROJECT_ID,
      state: SecurityBlockState.Active,
      indicatorType: SecurityBlockIndicatorType.IpRange,
    });
  });

  test("an address the Blocklist holds nothing of has no evidence, and no enforcement is read", async () => {
    const forBlocks: unknown = jest.spyOn(
      SecurityBlockEnforcementService,
      "findForBlocks",
    );

    expect(await read()).toEqual([]);
    expect(forBlocks).not.toHaveBeenCalled();
  });

  test("a value that is no address reads nothing", async () => {
    expect(await read("not-an-address")).toEqual([]);
    expect(blockReads).toHaveLength(0);
  });
});

describe("a block a destination holds", () => {
  test("of the address, enforced and confirmed: one piece of evidence, naming the destination, since when and when it last confirmed it", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    rows.push(
      makeRow({
        blockIndex: 1,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-20),
        lastConfirmedAt: at(-1),
      }),
    );

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(evidence).toEqual([
      {
        destination: "Cloudflare",
        appliedAt: at(-20),
        sentence: {
          template: CHECK_BLOCK_ENFORCED_AT,
          values: { address: ADDRESS, destination: "Cloudflare" },
          times: {
            since: at(-20).toISOString(),
            confirmed: at(-1).toISOString(),
          },
        },
        link: { kind: ResponseLinkKind.OpenBlocklist, value: ADDRESS },
      },
    ]);
    expect(getEnforcedAddressBlocks(evidence)).toHaveLength(1);
  });

  test("held on every machine alone - by Microsoft Defender - is not held at the edge: said as not enforced (#10346)", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    const defender: SecurityBlockEnforcement = makeRow({
      blockIndex: 1,
      destination: "Microsoft Defender",
      state: SecurityBlockEnforcementState.Applied,
      appliedAt: at(-20),
      lastConfirmedAt: at(-1),
    });
    defender.provider = SecurityBlockDestinationProvider.MicrosoftDefender;
    rows.push(defender);

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(getEnforcedAddressBlocks(evidence)).toHaveLength(0);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.isNotEnforced).toBe(true);
    expect(evidence[0]!.isApplying).toBe(false);
  });

  test("held at two destinations: one piece of evidence each", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    rows.push(
      makeRow({
        blockIndex: 1,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-20),
        lastConfirmedAt: at(-1),
      }),
      makeRow({
        blockIndex: 1,
        destination: "AWS WAF (prod-alb)",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-19),
        lastConfirmedAt: at(-2),
      }),
    );

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(
      evidence.map((item: AddressBlockEvidence): string => {
        return item.destination;
      }),
    ).toEqual(["Cloudflare", "AWS WAF (prod-alb)"]);
  });

  test("a range that holds the address: evidence that names the range", async () => {
    blocks.push(makeBlock({ index: 2, value: RANGE }));
    rows.push(
      makeRow({
        blockIndex: 2,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-60),
        lastConfirmedAt: at(-3),
      }),
    );

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.sentence).toEqual({
      template: CHECK_BLOCK_RANGE_ENFORCED_AT,
      values: { address: ADDRESS, destination: "Cloudflare", range: RANGE },
      times: {
        since: at(-60).toISOString(),
        confirmed: at(-3).toISOString(),
      },
    });
    expect(evidence[0]!.link).toEqual({
      kind: ResponseLinkKind.OpenBlocklist,
      value: RANGE,
    });
  });

  test("a range that does not hold the address is no evidence of it", async () => {
    blocks.push(makeBlock({ index: 3, value: "35.205.12.0/24" }));
    rows.push(
      makeRow({
        blockIndex: 3,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-60),
        lastConfirmedAt: at(-3),
      }),
    );

    expect(await read()).toEqual([]);
  });

  test("an IPv6 address inside a /48 the Blocklist holds", async () => {
    blocks.push(makeBlock({ index: 4, value: "2001:db8:1::/48" }));
    rows.push(
      makeRow({
        blockIndex: 4,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-60),
        lastConfirmedAt: at(-3),
      }),
    );

    const evidence: Array<AddressBlockEvidence> = await read("2001:db8:1:2::7");

    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.sentence.values["range"]).toBe("2001:db8:1::/48");
  });

  test("a challenge says challenged, for the address and for a range", async () => {
    blocks.push(
      makeBlock({
        index: 1,
        value: ADDRESS,
        action: SecurityBlockAction.Challenge,
      }),
      makeBlock({
        index: 2,
        value: RANGE,
        action: SecurityBlockAction.Challenge,
      }),
    );
    rows.push(
      makeRow({
        blockIndex: 1,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-10),
        lastConfirmedAt: at(-1),
      }),
      makeRow({
        blockIndex: 2,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-20),
        lastConfirmedAt: at(-1),
      }),
    );

    const templates: Array<unknown> = (await read()).map(
      (item: AddressBlockEvidence): unknown => {
        return item.sentence.template;
      },
    );

    expect(templates).toEqual([
      CHECK_BLOCK_CHALLENGED_AT,
      CHECK_BLOCK_RANGE_CHALLENGED_AT,
    ]);
  });
});

describe("a block that holds nothing", () => {
  test("lifted: the Blocklist answers only active blocks, so it is no evidence", async () => {
    blocks.push(
      makeBlock({ index: 1, value: ADDRESS, state: SecurityBlockState.Lifted }),
    );
    rows.push(
      makeRow({
        blockIndex: 1,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Removed,
        appliedAt: at(-60),
        lastConfirmedAt: at(-30),
      }),
    );

    expect(await read()).toEqual([]);
  });

  test("past its expiry, before the expiry worker marks it: no evidence", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS, expiresAt: at(-1) }));
    rows.push(
      makeRow({
        blockIndex: 1,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-60),
        lastConfirmedAt: at(-2),
      }),
    );

    expect(await read()).toEqual([]);
  });

  test("a block until someone lifts it holds for as long as it is active", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS, expiresAt: null }));
    rows.push(
      makeRow({
        blockIndex: 1,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-60),
        lastConfirmedAt: at(-2),
      }),
    );

    expect(getEnforcedAddressBlocks(await read())).toHaveLength(1);
  });

  test("recorded, and enforced nowhere - no destination at all: said as not enforced, never as blocked", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS, createdAt: at(-5) }));

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(evidence).toEqual([
      {
        destination: "",
        appliedAt: at(-5),
        sentence: {
          template: CHECK_BLOCK_NOT_ENFORCED,
          values: { value: ADDRESS },
        },
        link: { kind: ResponseLinkKind.OpenBlocklist, value: ADDRESS },
        isNotEnforced: true,
        isApplying: false,
      },
    ]);
    expect(getEnforcedAddressBlocks(evidence)).toEqual([]);
  });

  test("still being applied: not enforced, and applying, so the step looks again soon", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    rows.push(
      makeRow({
        blockIndex: 1,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Pending,
      }),
    );

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.isNotEnforced).toBe(true);
    expect(evidence[0]!.isApplying).toBe(true);
  });

  test("turned down by every destination: not enforced, and not applying", async () => {
    blocks.push(
      makeBlock({
        index: 1,
        value: ADDRESS,
        action: SecurityBlockAction.Challenge,
      }),
    );
    rows.push(
      makeRow({
        blockIndex: 1,
        destination: "Azure WAF",
        state: SecurityBlockEnforcementState.Failed,
        error: "Azure WAF cannot challenge",
      }),
    );

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(evidence[0]!.isNotEnforced).toBe(true);
    expect(evidence[0]!.isApplying).toBe(false);
  });

  test("applied, but its confirmation gone stale: the destination stopped answering, so it is not known to hold", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    rows.push(
      makeRow({
        blockIndex: 1,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-120),
        lastConfirmedAt: new Date(
          NOW.getTime() - SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS - MINUTE,
        ),
      }),
    );

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(getEnforcedAddressBlocks(evidence)).toEqual([]);
    expect(evidence[0]!.isNotEnforced).toBe(true);
  });

  test("held at one destination and turned down at another: the one that holds it is the evidence", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    rows.push(
      makeRow({
        blockIndex: 1,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-20),
        lastConfirmedAt: at(-1),
      }),
      makeRow({
        blockIndex: 1,
        destination: "Azure WAF",
        state: SecurityBlockEnforcementState.Failed,
        error: "Azure WAF is full",
      }),
    );

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.destination).toBe("Cloudflare");
    expect(evidence[0]!.isNotEnforced).toBeUndefined();
  });
});

describe("a read that fails", () => {
  test("of the blocks throws: the step then says OneUptime could not check it, never 'not blocked'", async () => {
    failingRead = "blocks";

    await expect(read()).rejects.toThrow("the database is down");
  });

  test("of where they are enforced throws too", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    failingRead = "rows";

    await expect(read()).rejects.toThrow("the database is down");
  });

  test("throws through AddressBlocks, which reads every source", async () => {
    failingRead = "blocks";

    await expect(
      AddressBlocks.read({ projectId: PROJECT_ID, address: ADDRESS, now: NOW }),
    ).rejects.toThrow("the database is down");
  });
});

describe("the pieces", () => {
  test("whether a block holds an address: itself, a range around it, never another", () => {
    const address: ReturnType<typeof readSecurityBlockValue> =
      readSecurityBlockValue(ADDRESS)!;

    expect(doesBlockHoldAddress(ADDRESS, address)).toBe(true);
    expect(doesBlockHoldAddress(RANGE, address)).toBe(true);
    expect(doesBlockHoldAddress("35.205.0.0/16", address)).toBe(true);
    expect(doesBlockHoldAddress("35.205.11.132", address)).toBe(false);
    expect(doesBlockHoldAddress("35.205.12.0/24", address)).toBe(false);
    expect(doesBlockHoldAddress("", address)).toBe(false);
    expect(doesBlockHoldAddress(undefined, address)).toBe(false);
  });

  test("a held block's evidence falls back to when it was confirmed, then made, for a destination that did not say when it applied it", () => {
    const evidence: AddressBlockEvidence = getHeldBlockEvidence({
      address: ADDRESS,
      block: { value: ADDRESS, action: SecurityBlockAction.Block },
      row: {
        destinationName: " Cloudflare ",
        lastConfirmedAt: at(-2),
      },
    });

    expect(evidence.destination).toBe("Cloudflare");
    expect(evidence.appliedAt).toEqual(at(-2));
  });

  test("the link to the Blocklist reads back as stored, and nothing but an address or a range is kept", () => {
    expect(
      readResponseLink({ kind: ResponseLinkKind.OpenBlocklist, value: RANGE }),
    ).toEqual({ kind: ResponseLinkKind.OpenBlocklist, value: RANGE });
    expect(
      readResponseLink({
        kind: ResponseLinkKind.OpenBlocklist,
        value: "2001:db8::/48",
      }),
    ).toEqual({ kind: ResponseLinkKind.OpenBlocklist, value: "2001:db8::/48" });

    for (const value of [
      "",
      "javascript:alert(1)",
      "https://evil.example/",
      "35.205.11.131<script>",
      "a".repeat(80),
      42,
    ]) {
      expect(
        readResponseLink({ kind: ResponseLinkKind.OpenBlocklist, value }),
      ).toBeNull();
    }
  });
});

/*
 * What a destination adds of its own to a block it holds (#10343):
 * Cloudflare, how many of the address's requests its rule stopped since
 * the block, counted from the firewall events the connection imports.
 */
describe("what a destination holding the block adds of its own", () => {
  function eventCount(rowsRead: Array<JSONObject>): never {
    return {
      json: async (): Promise<JSONObject> => {
        return { data: rowsRead } as unknown as JSONObject;
      },
    } as never;
  }

  function cloudflareRow(blockIndex: number): SecurityBlockEnforcement {
    const row: SecurityBlockEnforcement = makeRow({
      blockIndex,
      destination: "Cloudflare",
      state: SecurityBlockEnforcementState.Applied,
      appliedAt: at(-20),
      lastConfirmedAt: at(-1),
    });
    row.provider = SecurityBlockDestinationProvider.Cloudflare;
    row.destinationKey = "Cloudflare:connection-1";
    row.providerRef = "item-1";
    return row;
  }

  test("Cloudflare is the destination that does", () => {
    expect(Object.keys(HELD_BLOCK_FACTS_READERS)).toEqual([
      SecurityBlockDestinationProvider.Cloudflare,
    ]);
  });

  test("held at Cloudflare: how many of the address's requests its rule stopped since the block", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    rows.push(cloudflareRow(1));
    jest
      .spyOn(SecurityEventService, "executeQuery")
      .mockResolvedValue(
        eventCount([{ requests: "312", maxSampleInterval: "1" }]),
      );

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.sentence.template).toBe(CHECK_BLOCK_ENFORCED_AT);
    expect(evidence[0]!.facts).toEqual([
      {
        template: CHECK_BLOCK_CLOUDFLARE_STOPPED,
        values: { address: ADDRESS },
        times: { time: at(-20).toISOString() },
        count: 312,
      },
    ]);
  });

  test("a challenge held at Cloudflare says how many it challenged", async () => {
    blocks.push(
      makeBlock({
        index: 1,
        value: ADDRESS,
        action: SecurityBlockAction.Challenge,
      }),
    );
    rows.push(cloudflareRow(1));
    jest
      .spyOn(SecurityEventService, "executeQuery")
      .mockResolvedValue(
        eventCount([{ requests: "4", maxSampleInterval: "1" }]),
      );

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(evidence[0]!.facts?.[0]?.template).toBe(
      CHECK_BLOCK_CLOUDFLARE_CHALLENGED,
    );
  });

  test("nothing stopped since: no fact, and the evidence is as the Blocklist says it", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    rows.push(cloudflareRow(1));
    jest
      .spyOn(SecurityEventService, "executeQuery")
      .mockResolvedValue(eventCount([]));

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(evidence[0]!.facts).toBeUndefined();
    expect(getEnforcedAddressBlocks(evidence)).toHaveLength(1);
  });

  test("a count that cannot be read leaves the fact out, never the evidence", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    rows.push(cloudflareRow(1));
    jest
      .spyOn(SecurityEventService, "executeQuery")
      .mockRejectedValue(new Error("ClickHouse is down"));

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.sentence.template).toBe(CHECK_BLOCK_ENFORCED_AT);
    expect(evidence[0]!.facts).toBeUndefined();
  });

  test("a destination with nothing of its own reads nothing more", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    rows.push(
      makeRow({
        blockIndex: 1,
        destination: "AWS WAF",
        state: SecurityBlockEnforcementState.Applied,
        appliedAt: at(-20),
        lastConfirmedAt: at(-1),
      }),
    );
    const query: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityEventService,
      "executeQuery",
    );

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(query).not.toHaveBeenCalled();
    expect(evidence[0]!.facts).toBeUndefined();
  });

  test("a block nothing holds is asked nothing of", async () => {
    blocks.push(makeBlock({ index: 1, value: ADDRESS }));
    const pending: SecurityBlockEnforcement = cloudflareRow(1);
    pending.state = SecurityBlockEnforcementState.Pending;
    rows.push(pending);
    const query: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityEventService,
      "executeQuery",
    );

    const evidence: Array<AddressBlockEvidence> = await read();

    expect(query).not.toHaveBeenCalled();
    expect(evidence[0]!.isNotEnforced).toBe(true);
  });

  test("each reader is handed the block's action, the row and when the block was applied there", async () => {
    const fact: SecurityCaseStepCheckSentence = {
      template: "a fact",
      values: {},
    };
    const reader: HeldBlockFactsReader = jest.fn<HeldBlockFactsReader>(
      async () => {
        return [fact];
      },
    );
    const block: SecurityBlock = makeBlock({
      index: 1,
      value: ADDRESS,
      action: SecurityBlockAction.Challenge,
    });
    const row: SecurityBlockEnforcement = cloudflareRow(1);

    const facts: Array<SecurityCaseStepCheckSentence> =
      await readHeldBlockFacts({
        projectId: PROJECT_ID,
        address: ADDRESS,
        block,
        row,
        evidence: getHeldBlockEvidence({ address: ADDRESS, block, row }),
        now: NOW,
        readers: { [SecurityBlockDestinationProvider.Cloudflare]: reader },
      });

    expect(facts).toEqual([fact]);
    expect(reader).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      address: ADDRESS,
      action: SecurityBlockAction.Challenge,
      row,
      appliedAt: at(-20),
      now: NOW,
    });
  });
});
