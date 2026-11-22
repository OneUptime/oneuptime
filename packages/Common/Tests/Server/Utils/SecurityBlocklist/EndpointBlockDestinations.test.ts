import CrowdStrikeBlockDestination, {
  CROWDSTRIKE_IOC_COMMENT,
  getCrowdStrikeIocMarker,
} from "../../../../Server/Utils/SecurityBlocklist/Destinations/CrowdStrikeBlockDestination";
import MicrosoftDefenderBlockDestination, {
  getDefenderIndicatorMarker,
  toDefenderAddress,
} from "../../../../Server/Utils/SecurityBlocklist/Destinations/MicrosoftDefenderBlockDestination";
import {
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockSupport,
  SecurityBlockWriteResult,
  isSecurityBlockForDestination,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import CrowdStrikeFalconResponseClient, {
  CrowdStrikeIoc,
  CrowdStrikeIocSubmission,
  CrowdStrikeIocUpdate,
  CrowdStrikeIocWriteResult,
} from "../../../../Server/Utils/SecurityEvent/Response/CrowdStrikeFalconResponseClient";
import MicrosoftDefenderEndpointClient, {
  DefenderIndicator,
  DefenderIndicatorImportResult,
  DefenderIndicatorSubmission,
} from "../../../../Server/Utils/SecurityEvent/Response/MicrosoftDefenderEndpointClient";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockReach,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SECURITY_BLOCK_SAMPLE_VALUES } from "../../../../Types/SecurityBlocklist/SecurityBlockHolders";
import { describe, expect, test } from "@jest/globals";

/*
 * The blocklist on every machine (#10346): the Microsoft Defender and
 * CrowdStrike Falcon destinations, over clients that answer as the products
 * do - what each can hold and says of the rest, what it reads back as
 * OneUptime's (and nothing else), how it writes, removes and renews.
 */

const CONNECTION: ObjectID = new ObjectID(
  "11111111-1111-1111-1111-111111111111",
);
const OTHER_CONNECTION: string = "22222222-2222-2222-2222-222222222222";
const MARKER: string = getDefenderIndicatorMarker(CONNECTION.toString());
const SHA256: string =
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";
const MD5: string = "44d88612fea8a8f36de82e1278abb02f";

function entry(data: {
  indicatorType: SecurityBlockIndicatorType;
  value: string;
  action?: SecurityBlockAction;
  expiresAt?: Date | null;
}): SecurityBlockEntry {
  return {
    securityBlockId: ObjectID.generate(),
    indicatorType: data.indicatorType,
    value: data.value,
    action: data.action || SecurityBlockAction.Block,
    expiresAt:
      data.expiresAt === undefined
        ? new Date("2026-12-01T10:00:00Z")
        : data.expiresAt,
    comment: "OneUptime case CASE-7 until 2026-12-01 10:00 UTC",
  };
}

// ---------- Microsoft Defender ----------

interface FakeDefender {
  listed: Array<DefenderIndicator>;
  lists: number;
  imported: Array<Array<DefenderIndicatorSubmission>>;
  deleted: Array<Array<string>>;
  importAnswer: (
    submissions: Array<DefenderIndicatorSubmission>,
  ) => Array<DefenderIndicatorImportResult>;
  deleteFailures: Array<{ id: string; error: string }>;
}

function defender(fake: FakeDefender): MicrosoftDefenderBlockDestination {
  const client: Partial<MicrosoftDefenderEndpointClient> = {
    listIndicators: async (): Promise<Array<DefenderIndicator>> => {
      fake.lists++;
      return fake.listed;
    },
    importIndicators: async (
      submissions: Array<DefenderIndicatorSubmission>,
    ): Promise<Array<DefenderIndicatorImportResult>> => {
      fake.imported.push(submissions);
      return fake.importAnswer(submissions);
    },
    deleteIndicators: async (
      ids: Array<string>,
    ): Promise<Array<{ id: string; error: string }>> => {
      fake.deleted.push(ids);
      return fake.deleteFailures;
    },
  };

  return new MicrosoftDefenderBlockDestination({
    connectionId: CONNECTION,
    name: "Microsoft Defender",
    client: client as MicrosoftDefenderEndpointClient,
  });
}

function newFakeDefender(): FakeDefender {
  return {
    listed: [],
    lists: 0,
    imported: [],
    deleted: [],
    importAnswer: (
      submissions: Array<DefenderIndicatorSubmission>,
    ): Array<DefenderIndicatorImportResult> => {
      return submissions.map(
        (
          submission: DefenderIndicatorSubmission,
          index: number,
        ): DefenderIndicatorImportResult => {
          return {
            indicatorValue: submission.indicatorValue,
            id: String(100 + index),
            isFailed: false,
            failureReason: null,
          };
        },
      );
    },
    deleteFailures: [],
  };
}

function indicator(data: Partial<DefenderIndicator>): DefenderIndicator {
  return {
    id: "1",
    indicatorValue: "evil.example",
    indicatorType: "DomainName",
    action: "Block",
    application: "OneUptime",
    title: "OneUptime: evil.example",
    description: `OneUptime blocklist until lifted ${MARKER}`,
    expirationTime: null,
    ...data,
  };
}

describe("MicrosoftDefenderBlockDestination: what it holds", () => {
  test("is a destination on every machine, keyed by its connection, that quarantines files", () => {
    const destination: MicrosoftDefenderBlockDestination =
      defender(newFakeDefender());

    expect(destination.key).toBe(`MicrosoftDefender:${CONNECTION.toString()}`);
    expect(destination.provider).toBe(
      SecurityBlockDestinationProvider.MicrosoftDefender,
    );
    expect(destination.connectionId).toBe(CONNECTION);
    expect(destination.enforcesOnEveryMachine).toBe(true);
    expect(destination.quarantinesFiles).toBe(true);
  });

  test("blocks every kind but a range, and never challenges", () => {
    const destination: MicrosoftDefenderBlockDestination =
      defender(newFakeDefender());

    for (const indicatorType of Object.values(SecurityBlockIndicatorType)) {
      const support: SecurityBlockSupport = destination.supports({
        indicatorType,
        action: SecurityBlockAction.Block,
        value: SECURITY_BLOCK_SAMPLE_VALUES[indicatorType],
      });

      expect(support.isSupported).toBe(
        indicatorType !== SecurityBlockIndicatorType.IpRange,
      );
    }

    expect(
      destination.supports({
        indicatorType: SecurityBlockIndicatorType.IpRange,
        action: SecurityBlockAction.Block,
        value: "198.51.100.0/24",
      }),
    ).toEqual({
      isSupported: false,
      reason: "Microsoft Defender blocks one address at a time, never a range",
    });
    expect(
      destination.supports({
        indicatorType: SecurityBlockIndicatorType.IpAddress,
        action: SecurityBlockAction.Challenge,
        value: "198.51.100.7",
      }),
    ).toEqual({
      isSupported: false,
      reason: "Microsoft Defender cannot challenge, only block",
    });
    expect(
      destination.supports({
        indicatorType: SecurityBlockIndicatorType.FileMd5,
        action: SecurityBlockAction.BlockAndQuarantine,
        value: MD5,
      }).isSupported,
    ).toBe(true);
  });

  test("is asked to hold an address only when it is blocked everywhere", () => {
    const destination: MicrosoftDefenderBlockDestination =
      defender(newFakeDefender());

    expect(
      isSecurityBlockForDestination({
        destination,
        block: {
          indicatorType: SecurityBlockIndicatorType.IpAddress,
          reach: SecurityBlockReach.Edge,
        },
      }),
    ).toBe(false);
    expect(
      isSecurityBlockForDestination({
        destination,
        block: {
          indicatorType: SecurityBlockIndicatorType.IpAddress,
          reach: SecurityBlockReach.Everywhere,
        },
      }),
    ).toBe(true);
    // A domain is everywhere, whatever an old row says.
    expect(
      isSecurityBlockForDestination({
        destination,
        block: {
          indicatorType: SecurityBlockIndicatorType.Domain,
          reach: SecurityBlockReach.Edge,
        },
      }),
    ).toBe(true);
    // An edge destination is asked to hold every block it supports.
    expect(
      isSecurityBlockForDestination({
        destination: { enforcesOnEveryMachine: undefined },
        block: {
          indicatorType: SecurityBlockIndicatorType.IpAddress,
          reach: SecurityBlockReach.Everywhere,
        },
      }),
    ).toBe(true);
  });

  test("its capacity is the tenant's 15,000, the tenant's own included", async () => {
    expect(await defender(newFakeDefender()).capacity()).toEqual({
      limit: 15000,
      fullReason:
        "Microsoft Defender holds 15,000 indicators at most, the tenant's own included",
    });
  });
});

describe("MicrosoftDefenderBlockDestination: reading back", () => {
  test("capacity() and the readBack() after it read the tenant once; a read after a write reads again", async () => {
    const fake: FakeDefender = newFakeDefender();
    const destination: MicrosoftDefenderBlockDestination = defender(fake);

    await destination.capacity();
    await destination.readBack();

    expect(fake.lists).toBe(1);

    await destination.readBack();

    expect(fake.lists).toBe(2);

    await destination.capacity();
    await destination.apply([
      entry({
        indicatorType: SecurityBlockIndicatorType.Domain,
        value: "evil.example",
      }),
    ]);
    await destination.readBack();

    expect(fake.lists).toBe(4);
  });

  test("returns only this connection's indicators, never a person's or another project's", async () => {
    const fake: FakeDefender = newFakeDefender();
    fake.listed = [
      indicator({ id: "1", indicatorValue: "evil.example" }),
      indicator({
        id: "2",
        indicatorValue: "other.example",
        description: `OneUptime ${getDefenderIndicatorMarker(OTHER_CONNECTION)}`,
      }),
      indicator({
        id: "3",
        indicatorValue: "person.example",
        description: "Added by the SOC",
      }),
    ];

    const held: Array<SecurityBlockHeldItem> = await defender(fake).readBack();

    expect(held).toEqual([
      {
        value: "evil.example",
        action: SecurityBlockAction.Block,
        providerRef: "1",
        expiresAt: null,
      },
    ]);
  });

  test("reads a value back as blocks write it, and an action back as the block's", async () => {
    const fake: FakeDefender = newFakeDefender();
    const end: Date = new Date("2026-12-01T10:00:00Z");
    fake.listed = [
      indicator({
        id: "1",
        indicatorValue: "2001:db8:0:0:0:0:0:7",
        indicatorType: "IpAddress",
        expirationTime: end,
      }),
      indicator({
        id: "2",
        indicatorValue: SHA256.toUpperCase(),
        indicatorType: "FileSha256",
        action: "BlockAndRemediate",
      }),
      indicator({ id: "3", indicatorValue: "audit.example", action: "Audit" }),
    ];

    const held: Array<SecurityBlockHeldItem> = await defender(fake).readBack();

    expect(held[0]).toEqual({
      value: "2001:db8::7",
      action: SecurityBlockAction.Block,
      providerRef: "1",
      expiresAt: end,
    });
    expect(held[1]!.value).toBe(SHA256);
    expect(held[1]!.action).toBe(SecurityBlockAction.BlockAndQuarantine);
    // Set to something OneUptime never asks for: held as that, so no block wants it.
    expect(held[2]!.action as string).toBe("Audit");
  });
});

describe("MicrosoftDefenderBlockDestination: writing", () => {
  test("imports each entry as an indicator, an IPv6 address in all eight groups", async () => {
    const fake: FakeDefender = newFakeDefender();
    const destination: MicrosoftDefenderBlockDestination = defender(fake);

    const results: Array<SecurityBlockWriteResult> = await destination.apply([
      entry({
        indicatorType: SecurityBlockIndicatorType.IpAddress,
        value: "2001:db8::7",
      }),
      entry({
        indicatorType: SecurityBlockIndicatorType.Url,
        value: "https://evil.example/login",
        expiresAt: null,
      }),
      entry({
        indicatorType: SecurityBlockIndicatorType.FileSha1,
        value: "3395856ce81f2b7382dee72602f798b642f14140",
        action: SecurityBlockAction.BlockAndQuarantine,
      }),
    ]);

    expect(fake.imported[0]).toEqual([
      {
        indicatorValue: "2001:db8:0:0:0:0:0:7",
        indicatorType: "IpAddress",
        action: "Block",
        title: "OneUptime: 2001:db8::7",
        description: `OneUptime case CASE-7 until 2026-12-01 10:00 UTC ${MARKER}`,
        expirationTime: new Date("2026-12-01T10:00:00Z"),
      },
      {
        indicatorValue: "https://evil.example/login",
        indicatorType: "Url",
        action: "Block",
        title: "OneUptime: https://evil.example/login",
        description: `OneUptime case CASE-7 until 2026-12-01 10:00 UTC ${MARKER}`,
        expirationTime: null,
      },
      {
        indicatorValue: "3395856ce81f2b7382dee72602f798b642f14140",
        indicatorType: "FileSha1",
        action: "BlockAndRemediate",
        title: "OneUptime: 3395856ce81f2b7382dee72602f798b642f14140",
        description: `OneUptime case CASE-7 until 2026-12-01 10:00 UTC ${MARKER}`,
        expirationTime: new Date("2026-12-01T10:00:00Z"),
      },
    ]);
    expect(
      results.map((result: SecurityBlockWriteResult) => {
        return [result.value, result.isDone, result.providerRef];
      }),
    ).toEqual([
      ["2001:db8::7", true, "100"],
      ["https://evil.example/login", true, "101"],
      ["3395856ce81f2b7382dee72602f798b642f14140", true, "102"],
    ]);
  });

  test("an indicator Defender refuses is not done, with Defender's reason", async () => {
    const fake: FakeDefender = newFakeDefender();
    fake.importAnswer = (): Array<DefenderIndicatorImportResult> => {
      return [
        {
          indicatorValue: "evil.example",
          id: null,
          isFailed: true,
          failureReason: "Duplicate indicator",
        },
      ];
    };

    const results: Array<SecurityBlockWriteResult> = await defender(fake).apply(
      [
        entry({
          indicatorType: SecurityBlockIndicatorType.Domain,
          value: "evil.example",
        }),
      ],
    );

    expect(results).toEqual([
      {
        value: "evil.example",
        action: SecurityBlockAction.Block,
        isDone: false,
        error: "Microsoft Defender refused it: Duplicate indicator",
      },
    ]);
  });

  test("removes by the indicators' IDs, and says which it could not", async () => {
    const fake: FakeDefender = newFakeDefender();
    fake.deleteFailures = [{ id: "2", error: "HTTP 400" }];

    const results: Array<SecurityBlockWriteResult> = await defender(
      fake,
    ).remove([
      {
        value: "a.example",
        action: SecurityBlockAction.Block,
        providerRef: "1",
      },
      {
        value: "b.example",
        action: SecurityBlockAction.Block,
        providerRef: "2",
      },
      { value: "c.example", action: SecurityBlockAction.Block },
    ]);

    expect(fake.deleted).toEqual([["1", "2"]]);
    expect(
      results.map((result: SecurityBlockWriteResult) => {
        return [result.value, result.isDone];
      }),
    ).toEqual([
      ["a.example", true],
      ["b.example", false],
      ["c.example", false],
    ]);
    expect(results[1]!.error).toBe("HTTP 400");
  });

  test("a renewal deletes the old indicator and imports the block again with its new end", async () => {
    const fake: FakeDefender = newFakeDefender();
    const renewed: Date = new Date("2026-12-08T10:00:00Z");

    const results: Array<SecurityBlockWriteResult> = await defender(
      fake,
    ).moveEnds([
      {
        entry: entry({
          indicatorType: SecurityBlockIndicatorType.Domain,
          value: "evil.example",
          expiresAt: renewed,
        }),
        item: {
          value: "evil.example",
          action: SecurityBlockAction.Block,
          providerRef: "9",
          expiresAt: new Date("2026-12-01T10:00:00Z"),
        },
      },
    ]);

    expect(fake.deleted).toEqual([["9"]]);
    expect(fake.imported[0]![0]!.expirationTime).toEqual(renewed);
    expect(results[0]!.isDone).toBe(true);
  });

  test("an address goes to Defender in all eight groups, and an IPv4 one as it is", () => {
    expect(toDefenderAddress("2001:db8::7")).toBe("2001:db8:0:0:0:0:0:7");
    expect(toDefenderAddress("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(toDefenderAddress("198.51.100.7")).toBe("198.51.100.7");
    expect(toDefenderAddress("not an address")).toBe("not an address");
  });
});

// ---------- CrowdStrike Falcon ----------

interface FakeFalcon {
  listed: Array<CrowdStrikeIoc>;
  created: Array<Array<CrowdStrikeIocSubmission>>;
  updated: Array<Array<CrowdStrikeIocUpdate>>;
  deleted: Array<Array<string>>;
  comments: Array<string>;
  createAnswer: (
    submissions: Array<CrowdStrikeIocSubmission>,
  ) => Array<CrowdStrikeIocWriteResult>;
}

function newFakeFalcon(): FakeFalcon {
  return {
    listed: [],
    created: [],
    updated: [],
    deleted: [],
    comments: [],
    createAnswer: (
      submissions: Array<CrowdStrikeIocSubmission>,
    ): Array<CrowdStrikeIocWriteResult> => {
      return submissions.map(
        (
          submission: CrowdStrikeIocSubmission,
          index: number,
        ): CrowdStrikeIocWriteResult => {
          return {
            value: submission.value,
            id: `ioc-${index}`,
            isDone: true,
            error: null,
          };
        },
      );
    },
  };
}

function crowdStrike(fake: FakeFalcon): CrowdStrikeBlockDestination {
  const client: Partial<CrowdStrikeFalconResponseClient> = {
    listIocs: async (): Promise<Array<CrowdStrikeIoc>> => {
      return fake.listed;
    },
    createIocs: async (
      submissions: Array<CrowdStrikeIocSubmission>,
      comment: string,
    ): Promise<Array<CrowdStrikeIocWriteResult>> => {
      fake.created.push(submissions);
      fake.comments.push(comment);
      return fake.createAnswer(submissions);
    },
    updateIocs: async (
      updates: Array<CrowdStrikeIocUpdate>,
      comment: string,
    ): Promise<void> => {
      fake.updated.push(updates);
      fake.comments.push(comment);
    },
    deleteIocs: async (ids: Array<string>, comment: string): Promise<void> => {
      fake.deleted.push(ids);
      fake.comments.push(comment);
    },
  };

  return new CrowdStrikeBlockDestination({
    connectionId: CONNECTION,
    name: "CrowdStrike Falcon",
    client: client as CrowdStrikeFalconResponseClient,
  });
}

const FALCON_MARKER: string = getCrowdStrikeIocMarker(CONNECTION.toString());

function ioc(data: Partial<CrowdStrikeIoc>): CrowdStrikeIoc {
  return {
    id: "ioc-1",
    type: "sha256",
    value: SHA256,
    action: "prevent",
    description: `OneUptime blocklist ${FALCON_MARKER}Block]`,
    source: "OneUptime",
    expiration: new Date("2026-12-20T10:00:00Z"),
    isExpired: false,
    ...data,
  };
}

describe("CrowdStrikeBlockDestination: what it holds", () => {
  test("is a destination on every machine that blocks files, and leaves quarantine to Falcon's policy", () => {
    const destination: CrowdStrikeBlockDestination =
      crowdStrike(newFakeFalcon());

    expect(destination.key).toBe(`CrowdStrike:${CONNECTION.toString()}`);
    expect(destination.provider).toBe(
      SecurityBlockDestinationProvider.CrowdStrike,
    );
    expect(destination.enforcesOnEveryMachine).toBe(true);
    expect(destination.quarantinesFiles).toBe(false);
  });

  test("holds a SHA-256 or MD5 file, blocked or to be quarantined, and says why not of the rest", () => {
    const destination: CrowdStrikeBlockDestination =
      crowdStrike(newFakeFalcon());
    const support: (
      indicatorType: SecurityBlockIndicatorType,
      action?: SecurityBlockAction,
    ) => SecurityBlockSupport = (
      indicatorType: SecurityBlockIndicatorType,
      action: SecurityBlockAction = SecurityBlockAction.Block,
    ): SecurityBlockSupport => {
      return destination.supports({
        indicatorType,
        action,
        value: SECURITY_BLOCK_SAMPLE_VALUES[indicatorType],
      });
    };

    expect(support(SecurityBlockIndicatorType.FileSha256)).toEqual({
      isSupported: true,
    });
    expect(
      support(
        SecurityBlockIndicatorType.FileMd5,
        SecurityBlockAction.BlockAndQuarantine,
      ),
    ).toEqual({ isSupported: true });
    expect(
      support(
        SecurityBlockIndicatorType.FileMd5,
        SecurityBlockAction.Challenge,
      ),
    ).toEqual({
      isSupported: false,
      reason: "CrowdStrike Falcon cannot challenge, only block",
    });
    expect(support(SecurityBlockIndicatorType.FileSha1)).toEqual({
      isSupported: false,
      reason:
        "CrowdStrike Falcon blocks a file by its SHA-256 or MD5 hash, never its SHA-1",
    });
    expect(support(SecurityBlockIndicatorType.Url)).toEqual({
      isSupported: false,
      reason: "CrowdStrike Falcon has no URL indicators",
    });

    for (const indicatorType of [
      SecurityBlockIndicatorType.Domain,
      SecurityBlockIndicatorType.IpAddress,
      SecurityBlockIndicatorType.IpRange,
    ]) {
      expect(support(indicatorType)).toEqual({
        isSupported: false,
        reason:
          "CrowdStrike Falcon only detects a domain or an address on a computer, and never blocks it",
      });
    }
  });

  test("counts no limit", async () => {
    expect(await crowdStrike(newFakeFalcon()).capacity()).toEqual({
      limit: null,
    });
  });
});

describe("CrowdStrikeBlockDestination: reading back", () => {
  test("returns only this connection's IOCs, each with the action it was made for", async () => {
    const fake: FakeFalcon = newFakeFalcon();
    fake.listed = [
      ioc({ id: "a" }),
      ioc({
        id: "b",
        value: MD5.toUpperCase(),
        type: "md5",
        description: `case ${FALCON_MARKER}BlockAndQuarantine]`,
      }),
      ioc({
        id: "c",
        description: `${getCrowdStrikeIocMarker(OTHER_CONNECTION)}Block]`,
      }),
      ioc({ id: "d", description: "A person's own IOC" }),
    ];

    const held: Array<SecurityBlockHeldItem> =
      await crowdStrike(fake).readBack();

    expect(held).toEqual([
      {
        value: SHA256,
        action: SecurityBlockAction.Block,
        providerRef: "a",
        expiresAt: new Date("2026-12-20T10:00:00Z"),
      },
      {
        value: MD5,
        action: SecurityBlockAction.BlockAndQuarantine,
        providerRef: "b",
        expiresAt: new Date("2026-12-20T10:00:00Z"),
      },
    ]);
  });

  test("an IOC that no longer prevents is held, ended, and not in force", async () => {
    const fake: FakeFalcon = newFakeFalcon();
    fake.listed = [
      ioc({ id: "expired", isExpired: true, action: "no_action" }),
      ioc({ id: "detect", action: "detect" }),
      ioc({ id: "no-end", expiration: null }),
    ];

    const held: Array<SecurityBlockHeldItem> =
      await crowdStrike(fake).readBack();

    expect(held[0]).toEqual({
      value: SHA256,
      action: SecurityBlockAction.Block,
      providerRef: "expired",
      expiresAt: new Date(0),
      isPropagating: true,
    });
    expect(held[1]!.isPropagating).toBe(true);
    expect(held[1]!.expiresAt).toEqual(new Date(0));
    expect(held[2]).toEqual({
      value: SHA256,
      action: SecurityBlockAction.Block,
      providerRef: "no-end",
      expiresAt: null,
    });
  });
});

describe("CrowdStrikeBlockDestination: writing", () => {
  test("creates each file as an IOC, its action in its description, with OneUptime's comment", async () => {
    const fake: FakeFalcon = newFakeFalcon();

    const results: Array<SecurityBlockWriteResult> = await crowdStrike(
      fake,
    ).apply([
      entry({
        indicatorType: SecurityBlockIndicatorType.FileMd5,
        value: MD5,
        action: SecurityBlockAction.BlockAndQuarantine,
      }),
    ]);

    expect(fake.created[0]).toEqual([
      {
        type: "md5",
        value: MD5,
        description: `OneUptime case CASE-7 until 2026-12-01 10:00 UTC ${FALCON_MARKER}BlockAndQuarantine]`,
        expiration: new Date("2026-12-01T10:00:00Z"),
      },
    ]);
    expect(fake.comments).toEqual([CROWDSTRIKE_IOC_COMMENT]);
    expect(results).toEqual([
      {
        value: MD5,
        action: SecurityBlockAction.BlockAndQuarantine,
        isDone: true,
        providerRef: "ioc-0",
      },
    ]);
  });

  test("an IOC Falcon refuses is not done, with Falcon's reason", async () => {
    const fake: FakeFalcon = newFakeFalcon();
    fake.createAnswer = (): Array<CrowdStrikeIocWriteResult> => {
      return [{ value: SHA256, id: null, isDone: false, error: "Duplicate" }];
    };

    expect(
      await crowdStrike(fake).apply([
        entry({
          indicatorType: SecurityBlockIndicatorType.FileSha256,
          value: SHA256,
        }),
      ]),
    ).toEqual([
      {
        value: SHA256,
        action: SecurityBlockAction.Block,
        isDone: false,
        error: "CrowdStrike Falcon refused it: Duplicate",
      },
    ]);
  });

  test("removes by the IOCs' IDs; an item without one is not done", async () => {
    const fake: FakeFalcon = newFakeFalcon();

    const results: Array<SecurityBlockWriteResult> = await crowdStrike(
      fake,
    ).remove([
      { value: SHA256, action: SecurityBlockAction.Block, providerRef: "a" },
      { value: MD5, action: SecurityBlockAction.Block },
    ]);

    expect(fake.deleted).toEqual([["a"]]);
    expect(results[0]!.isDone).toBe(true);
    expect(results[1]!.isDone).toBe(false);
  });

  test("a renewal moves the IOC's expiration and sets it to prevent again", async () => {
    const fake: FakeFalcon = newFakeFalcon();
    const renewed: Date = new Date("2027-01-20T10:00:00Z");

    const results: Array<SecurityBlockWriteResult> = await crowdStrike(
      fake,
    ).moveEnds([
      {
        entry: entry({
          indicatorType: SecurityBlockIndicatorType.FileSha256,
          value: SHA256,
          expiresAt: renewed,
        }),
        item: {
          value: SHA256,
          action: SecurityBlockAction.Block,
          providerRef: "ioc-9",
          expiresAt: new Date(0),
          isPropagating: true,
        },
      },
      {
        entry: entry({
          indicatorType: SecurityBlockIndicatorType.FileMd5,
          value: MD5,
        }),
        item: { value: MD5, action: SecurityBlockAction.Block },
      },
    ]);

    expect(fake.updated).toEqual([
      [
        {
          id: "ioc-9",
          description: `OneUptime case CASE-7 until 2026-12-01 10:00 UTC ${FALCON_MARKER}Block]`,
          expiration: renewed,
        },
      ],
    ]);
    expect(results[0]!.isDone).toBe(true);
    expect(results[1]!.isDone).toBe(false);
  });
});
