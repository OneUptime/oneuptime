import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityBlockService from "../../../../Server/Services/SecurityBlockService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import SecurityRepeatOffenderNetworks, {
  MAX_ADDRESSES_PER_READ,
  MAX_ASNS_PER_ADDRESS,
  buildAddressAsnsStatement,
  getAddressSpellingsToRead,
  readAddressAsnRows,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityRepeatOffenderNetworks";
import SecurityRepeatOffenders from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityRepeatOffenders";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityRepeatOffenderBlock,
  SecurityRepeatOffenderRecord,
  getSecurityRepeatOffenderHoldingNetwork,
  summarizeSecurityRepeatOffender,
} from "../../../../Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockSource,
  SecurityBlockState,
  readSecurityBlockIndicator,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SECURITY_ATTACK_NETWORK_ASN_ATTRIBUTE } from "../../../../Types/SecurityEvent/SecurityAttackNetwork";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A CASE'S REPEAT-OFFENDER LINE COUNTS AN ASN CHALLENGE THAT HELD ITS
 * ADDRESS (#10895).
 *
 * Challenge This Network holds a whole network by its ASN, and every
 * address in it with it - but OneUptime knows an address's ASN only from
 * what Cloudflare's firewall events carry. Pinned here:
 *
 *   - the read of the networks each address's events named: one query for
 *     every address, each in every spelling an event holds it in, values
 *     bound and never written into the SQL, and a read that fails reading
 *     as no network;
 *   - the record of an address counting its networks' blocks and
 *     challenges in the window - never a lifted one, never another
 *     network's, never one for a network asked about - beside its own
 *     blocks and its ranges', the latest first, the last naming the
 *     network that held it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10895000-0000-4000-8000-000000000001",
);
const ADDRESS: string = "203.0.113.7";
const NOW: Date = new Date("2026-11-24T10:00:00.000Z");
const SINCE: Date = new Date("2026-10-25T10:00:00.000Z");

afterEach(() => {
  jest.restoreAllMocks();
});

function paramsOf(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("the read of the networks an address's events named", () => {
  function statementFor(spellings: Array<string>): Statement {
    return buildAddressAsnsStatement({
      projectId: PROJECT_ID,
      spellings,
      since: SINCE,
      until: NOW,
    });
  }

  test("reads each spelling's ASNs from the project's events of the window, only where an event named one", () => {
    const statement: Statement = statementFor([ADDRESS, `::ffff:${ADDRESS}`]);
    const asText: string = JSON.stringify(statement.query_params);

    expect(statement.query).toContain("SELECT principalIp AS address, ");
    expect(statement.query).toContain(
      `groupUniqArray(${MAX_ASNS_PER_ADDRESS})(attributes[`,
    );
    expect(statement.query).toContain("principalIp IN ");
    expect(statement.query).toContain("] != ''");
    expect(statement.query).toContain("GROUP BY address");
    expect(statement.query).toContain("LIMIT ");
    expect(paramsOf(statement)).toContainEqual([ADDRESS, `::ffff:${ADDRESS}`]);
    expect(asText).toContain(SECURITY_ATTACK_NETWORK_ASN_ATTRIBUTE);
    expect(asText).toContain(PROJECT_ID.toString());
    // Bounded in time: the record's window.
    expect(asText).toContain("2026-10-25");
    expect(asText).toContain("2026-11-24");
    // One row a spelling at most.
    expect(paramsOf(statement)).toContain(2);
  });

  test("never writes a value into the query itself", () => {
    const statement: Statement = statementFor([
      "203.0.113.7'); DROP TABLE SecurityEvent; --",
    ]);

    expect(statement.query).not.toContain("DROP TABLE");
  });

  test("reads every address asked about once, in every spelling, and nothing that is no single address", () => {
    const spellingsOf: Map<string, Array<string>> = getAddressSpellingsToRead([
      ADDRESS,
      ` ${ADDRESS} `,
      "2001:db8:0:0:0:0:0:7",
      "203.0.113.0/24",
      "AS14061",
      "evil.example",
      "",
    ]);

    expect(Array.from(spellingsOf.keys())).toEqual([ADDRESS, "2001:db8::7"]);
    expect(spellingsOf.get(ADDRESS)).toEqual(
      expect.arrayContaining([ADDRESS, `::ffff:${ADDRESS}`]),
    );
    // Cloudflare writes an IPv6 client compressed; a case keeps it written out.
    expect(spellingsOf.get("2001:db8::7")).toEqual(
      expect.arrayContaining(["2001:db8::7", "2001:db8:0:0:0:0:0:7"]),
    );
  });

  test(`reads at most ${MAX_ADDRESSES_PER_READ} addresses`, () => {
    const addresses: Array<string> = [];

    for (let index: number = 0; index < 80; index++) {
      addresses.push(`198.51.100.${index}`);
    }

    expect(getAddressSpellingsToRead(addresses).size).toBe(
      MAX_ADDRESSES_PER_READ,
    );
  });

  test("adds up the spellings an event held an address in, each network once, as blocks write an ASN", () => {
    const spellingsOf: Map<string, Array<string>> = getAddressSpellingsToRead([
      ADDRESS,
      "2001:db8::7",
      "198.51.100.9",
    ]);

    const asnsOf: Map<string, Array<string>> = readAddressAsnRows({
      spellingsOf,
      rows: [
        { address: ADDRESS, asns: ["14061"] },
        { address: `::ffff:${ADDRESS}`, asns: ["14061", "AS16509"] },
        { address: "2001:db8:0:0:0:0:0:7", asns: ["AS13335"] },
        // An ASN that is none, and a spelling nobody asked about.
        { address: "198.51.100.9", asns: ["not-an-asn", "0"] },
        { address: "192.0.2.1", asns: ["64500"] },
      ],
    });

    expect(asnsOf.get(ADDRESS)).toEqual(["AS14061", "AS16509"]);
    expect(asnsOf.get("2001:db8::7")).toEqual(["AS13335"]);
    // None of its events named a network: no entry.
    expect(asnsOf.has("198.51.100.9")).toBe(false);
    expect(asnsOf.has("192.0.2.1")).toBe(false);
  });

  test(`keeps at most ${MAX_ASNS_PER_ADDRESS} networks an address`, () => {
    const asnsOf: Map<string, Array<string>> = readAddressAsnRows({
      spellingsOf: getAddressSpellingsToRead([ADDRESS]),
      rows: [
        {
          address: ADDRESS,
          asns: ["1", "2", "3", "4", "5", "6", "7"],
        },
      ],
    });

    expect(asnsOf.get(ADDRESS)).toHaveLength(MAX_ASNS_PER_ADDRESS);
  });

  test("reads them in one query for every address, and names them by the address as blocks write it", async () => {
    const executeQuery: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityEventService, "executeQuery")
      .mockResolvedValue({
        json: async (): Promise<JSONObject> => {
          return {
            data: [
              { address: ADDRESS, asns: ["14061"] },
              { address: "2001:db8::7", asns: ["13335"] },
            ],
          } as unknown as JSONObject;
        },
      } as never);

    const asnsOf: Map<
      string,
      Array<string>
    > = await SecurityRepeatOffenderNetworks.readAsns({
      projectId: PROJECT_ID,
      addresses: [ADDRESS, "2001:db8:0:0:0:0:0:7", "198.51.100.9"],
      since: SINCE,
      until: NOW,
    });

    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(asnsOf).toEqual(
      new Map([
        [ADDRESS, ["AS14061"]],
        ["2001:db8::7", ["AS13335"]],
      ]),
    );
  });

  test("asks nothing for no address", async () => {
    const executeQuery: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityEventService,
      "executeQuery",
    );

    expect(
      await SecurityRepeatOffenderNetworks.readAsns({
        projectId: PROJECT_ID,
        addresses: ["203.0.113.0/24", "AS14061"],
        since: SINCE,
        until: NOW,
      }),
    ).toEqual(new Map());
    expect(executeQuery).not.toHaveBeenCalled();
  });

  test("a read that fails reads as no network: the record counts the address's own blocks", async () => {
    jest
      .spyOn(SecurityEventService, "executeQuery")
      .mockRejectedValue(new Error("ClickHouse is down") as never);

    expect(
      await SecurityRepeatOffenderNetworks.readAsns({
        projectId: PROJECT_ID,
        addresses: [ADDRESS],
        since: SINCE,
        until: NOW,
      }),
    ).toEqual(new Map());
  });
});

/*
 * The blocklist, held in memory and read the way Postgres would answer
 * SecurityBlockService.findBy: the project's blocks of the window, of a
 * value or one of several, of a kind.
 */
describe("the record of an address, with the networks it sent from", () => {
  let blocks: Array<SecurityBlock>;
  let queries: Array<JSONObject>;

  function block(data: {
    index: number;
    value: string;
    action?: SecurityBlockAction;
    state?: SecurityBlockState;
    createdAt: Date;
    caseNumber?: string;
    projectId?: ObjectID;
  }): SecurityBlock {
    const made: SecurityBlock = new SecurityBlock(
      new ObjectID(
        `10895bbb-bbbb-4bbb-8bbb-${String(data.index).padStart(12, "0")}`,
      ),
    );
    made.projectId = data.projectId || PROJECT_ID;
    made.value = data.value;
    made.indicatorType = readSecurityBlockIndicator(data.value)!.indicatorType;
    made.action = data.action || SecurityBlockAction.Block;
    made.source = SecurityBlockSource.Person;
    made.state = data.state || SecurityBlockState.Expired;
    made.createdAt = data.createdAt;

    if (data.caseNumber) {
      const securityCase: SecurityCase = new SecurityCase();
      securityCase.caseNumberWithPrefix = data.caseNumber;
      made.securityCase = securityCase;
      made.securityCaseId = ObjectID.generate();
    }

    return made;
  }

  function matches(made: SecurityBlock, query: JSONObject): boolean {
    if (made.projectId?.toString() !== String(query["projectId"])) {
      return false;
    }

    const value: unknown = query["value"];

    if (value instanceof Includes) {
      if (!value.values.includes(made.value || "")) {
        return false;
      }
    } else if (typeof value === "string" && made.value !== value) {
      return false;
    }

    if (
      query["indicatorType"] !== undefined &&
      made.indicatorType !== query["indicatorType"]
    ) {
      return false;
    }

    // QueryHelper.greaterThanEqualTo: a raw condition, its date its one parameter.
    const createdAt:
      | { objectLiteralParameters?: Record<string, unknown> }
      | undefined = query["createdAt"] as
      | { objectLiteralParameters?: Record<string, unknown> }
      | undefined;
    const since: unknown = Object.values(
      createdAt?.objectLiteralParameters || {},
    )[0];

    if (!(since instanceof Date)) {
      throw new Error("Every read of the blocklist is held to its window.");
    }

    return made.createdAt!.getTime() >= since.getTime();
  }

  beforeEach(() => {
    blocks = [];
    queries = [];
    jest
      .spyOn(SecurityBlockService, "findBy")
      .mockImplementation((async (args: { query: JSONObject }) => {
        queries.push(args.query);

        return blocks.filter((made: SecurityBlock): boolean => {
          return matches(made, args.query);
        });
      }) as never);
  });

  async function readRecord(
    asns?: Array<string>,
    value: string = ADDRESS,
  ): Promise<SecurityRepeatOffenderRecord> {
    return await SecurityRepeatOffenders.read({
      projectId: PROJECT_ID,
      value,
      now: NOW,
      ...(asns ? { asns } : {}),
    });
  }

  function valuesOf(record: SecurityRepeatOffenderRecord): Array<string> {
    return record.blocks.map((made: SecurityRepeatOffenderBlock): string => {
      return made.value;
    });
  }

  test("counts a challenge of the network its events named, and the last names the network that held it", async () => {
    blocks = [
      block({
        index: 1,
        value: "AS14061",
        action: SecurityBlockAction.Challenge,
        state: SecurityBlockState.Expired,
        createdAt: new Date("2026-11-12T10:00:00.000Z"),
        caseNumber: "CASE-812",
      }),
    ];

    const record: SecurityRepeatOffenderRecord = await readRecord(["AS14061"]);

    expect(record.offenceCount).toBe(1);
    expect(record.last?.value).toBe("AS14061");
    expect(record.last?.action).toBe(SecurityBlockAction.Challenge);
    expect(record.last?.caseNumber).toBe("CASE-812");
    expect(
      getSecurityRepeatOffenderHoldingNetwork(
        summarizeSecurityRepeatOffender(record),
      ),
    ).toBe("AS14061");
  });

  test("without the networks it sent from, a network's challenge is none of the address's", async () => {
    blocks = [
      block({
        index: 1,
        value: "AS14061",
        action: SecurityBlockAction.Challenge,
        createdAt: new Date("2026-11-12T10:00:00.000Z"),
      }),
    ];

    const record: SecurityRepeatOffenderRecord = await readRecord();

    expect(record.offenceCount).toBe(0);
    expect(record.last).toBeNull();
    // ...and no read of networks is asked for.
    expect(
      queries.some((query: JSONObject): boolean => {
        return query["indicatorType"] === SecurityBlockIndicatorType.Asn;
      }),
    ).toBe(false);
  });

  test("adds them up with the address's own blocks and its ranges', the latest first", async () => {
    blocks = [
      block({
        index: 1,
        value: ADDRESS,
        createdAt: new Date("2026-11-02T10:00:00.000Z"),
        caseNumber: "CASE-700",
      }),
      block({
        index: 2,
        value: "203.0.113.0/24",
        action: SecurityBlockAction.Challenge,
        createdAt: new Date("2026-11-08T10:00:00.000Z"),
      }),
      block({
        index: 3,
        value: "AS14061",
        action: SecurityBlockAction.Challenge,
        createdAt: new Date("2026-11-20T10:00:00.000Z"),
        caseNumber: "CASE-900",
      }),
    ];

    const record: SecurityRepeatOffenderRecord = await readRecord(["AS14061"]);

    expect(valuesOf(record)).toEqual(["AS14061", "203.0.113.0/24", ADDRESS]);
    expect(record.offenceCount).toBe(3);
    expect(record.last?.caseNumber).toBe("CASE-900");
  });

  test("never counts another network's, nor one lifted, nor one older than the window", async () => {
    blocks = [
      // Another network: the address's events never named it.
      block({
        index: 1,
        value: "AS16509",
        action: SecurityBlockAction.Challenge,
        createdAt: new Date("2026-11-20T10:00:00.000Z"),
      }),
      // Lifted on purpose: listed, never an offence.
      block({
        index: 2,
        value: "AS14061",
        action: SecurityBlockAction.Challenge,
        state: SecurityBlockState.Lifted,
        createdAt: new Date("2026-11-21T10:00:00.000Z"),
      }),
      // Before the 30 days.
      block({
        index: 3,
        value: "AS14061",
        action: SecurityBlockAction.Challenge,
        createdAt: new Date("2026-10-01T10:00:00.000Z"),
      }),
      // Another project's.
      block({
        index: 4,
        value: "AS14061",
        action: SecurityBlockAction.Challenge,
        createdAt: new Date("2026-11-22T10:00:00.000Z"),
        projectId: new ObjectID("10895000-0000-4000-8000-000000000099"),
      }),
    ];

    const record: SecurityRepeatOffenderRecord = await readRecord(["AS14061"]);

    expect(valuesOf(record)).toEqual(["AS14061"]);
    expect(record.blocks[0]?.state).toBe(SecurityBlockState.Lifted);
    expect(record.offenceCount).toBe(0);
    expect(record.last).toBeNull();
  });

  test("a network blocked rather than challenged counts too, and says it was blocked", async () => {
    blocks = [
      block({
        index: 1,
        value: "AS14061",
        action: SecurityBlockAction.Block,
        createdAt: new Date("2026-11-20T10:00:00.000Z"),
      }),
    ];

    const record: SecurityRepeatOffenderRecord = await readRecord(["AS14061"]);

    expect(record.offenceCount).toBe(1);
    expect(record.last?.action).toBe(SecurityBlockAction.Block);
  });

  test("reads the networks however they are written, each once, and only what is an ASN", async () => {
    blocks = [
      block({
        index: 1,
        value: "AS14061",
        action: SecurityBlockAction.Challenge,
        createdAt: new Date("2026-11-20T10:00:00.000Z"),
      }),
    ];

    const record: SecurityRepeatOffenderRecord = await readRecord([
      "as14061",
      "AS 14061",
      "14061",
      "not-an-asn",
    ]);

    expect(record.offenceCount).toBe(1);

    const asnQuery: JSONObject | undefined = queries.find(
      (query: JSONObject): boolean => {
        return query["indicatorType"] === SecurityBlockIndicatorType.Asn;
      },
    );

    // "14061" alone is no ASN as blocks write one, and "not-an-asn" none at all.
    expect((asnQuery?.["value"] as Includes).values).toEqual(["AS14061"]);
  });

  test("a network asked about reads no networks of its own: its record is its blocks, its ranges' and its addresses'", async () => {
    blocks = [
      block({
        index: 1,
        value: "AS14061",
        action: SecurityBlockAction.Challenge,
        createdAt: new Date("2026-11-20T10:00:00.000Z"),
      }),
    ];

    const record: SecurityRepeatOffenderRecord = await readRecord(
      ["AS14061"],
      "203.0.113.0/24",
    );

    expect(record.offenceCount).toBe(0);
    expect(
      queries.some((query: JSONObject): boolean => {
        return query["indicatorType"] === SecurityBlockIndicatorType.Asn;
      }),
    ).toBe(false);
  });

  test("the network's block is read once, whatever else reads it back", async () => {
    blocks = [
      block({
        index: 1,
        value: "AS14061",
        action: SecurityBlockAction.Challenge,
        createdAt: new Date("2026-11-20T10:00:00.000Z"),
      }),
      block({
        index: 2,
        value: ADDRESS,
        createdAt: new Date("2026-11-10T10:00:00.000Z"),
      }),
    ];

    const record: SecurityRepeatOffenderRecord = await readRecord([
      "AS14061",
      "AS14061",
    ]);

    expect(valuesOf(record)).toEqual(["AS14061", ADDRESS]);
    expect(record.offenceCount).toBe(2);
  });
});
