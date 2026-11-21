/** @timezone UTC */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import {
  loadAddressBlocking,
  readDestinationNames,
  readResponseAddressBlock,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseAddressBlocks";
import {
  getBlockByHandCommands,
  getEnforcedBlockTemplate,
  isRangeAroundAddress,
  writeAddressBlockLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseBlockStepModel";
import {
  BLOCK_LINE_BLOCKED,
  BLOCK_LINE_BLOCKED_BY,
  BLOCK_LINE_BLOCKED_BY_UNTIL_LIFTED,
  BLOCK_LINE_BLOCKED_UNTIL_LIFTED,
  BLOCK_LINE_CHALLENGED,
  BLOCK_LINE_CHALLENGED_BY,
  BLOCK_LINE_CHALLENGED_BY_UNTIL_LIFTED,
  BLOCK_LINE_CHALLENGED_UNTIL_LIFTED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseCopy";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../Models/DatabaseModels/SecurityBlockEnforcement";
import User from "../../../Models/DatabaseModels/User";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockEnforcementState } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { Translator } from "../../../Types/Translator";
import API from "../../../UI/Utils/API/API";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  ResponseAddressBlock,
  ResponseAddressBlocking,
  ResponsePlaybookRunState,
} from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

/*
 * WHAT A CASE'S BLOCK STEP READS OF THE BLOCKLIST, AND HOW IT SAYS IT
 * (#10342): where the blocklist is enforced; the active blocks that hold
 * the case's addresses, with where each holds; the line a block's step
 * draws; and the address filled into the places people block one by hand.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const NOW: Date = new Date("2026-11-21T12:00:00.000Z");
// The Dashboard's English, as useTranslator reads it.
const ENGLISH: Translator = dashboardTranslator("en");

function blockOf(data: {
  id: string;
  value: string;
  action?: SecurityBlockAction;
  expiresAt?: Date | null;
  state?: SecurityBlockState;
  createdByName?: string;
}): SecurityBlock {
  const block: SecurityBlock = new SecurityBlock();
  block._id = data.id;
  block.value = data.value;
  block.indicatorType = data.value.includes("/")
    ? SecurityBlockIndicatorType.IpRange
    : SecurityBlockIndicatorType.IpAddress;
  block.action = data.action || SecurityBlockAction.Block;
  block.state = data.state || SecurityBlockState.Active;
  block.expiresAt = (
    data.expiresAt === undefined
      ? new Date("2026-11-22T10:42:00.000Z")
      : data.expiresAt
  ) as Date;
  block.createdAt = new Date("2026-11-21T10:42:00.000Z");
  block.source = SecurityBlockSource.Playbook;

  if (data.createdByName) {
    const user: User = new User();
    user.name = data.createdByName as never;
    block.createdByUser = user;
  }

  return block;
}

function rowOf(data: {
  blockId: string;
  destination: string;
  state: SecurityBlockEnforcementState;
  appliedAt?: Date;
  lastConfirmedAt?: Date;
  error?: string;
}): SecurityBlockEnforcement {
  const row: SecurityBlockEnforcement = new SecurityBlockEnforcement();
  row.securityBlockId = new ObjectID(data.blockId);
  row.destinationName = data.destination;
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

const BLOCK_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const CONFIRMED: Date = new Date("2026-11-21T11:58:00.000Z");

describe("a block, as the step reads it", () => {
  test("held at two destinations: where, and since the first held it", () => {
    expect(
      readResponseAddressBlock({
        block: blockOf({
          id: BLOCK_ID,
          value: "35.205.11.131",
          createdByName: "Jane Doe",
        }),
        enforcements: [
          rowOf({
            blockId: BLOCK_ID,
            destination: "Cloudflare",
            state: SecurityBlockEnforcementState.Applied,
            appliedAt: new Date("2026-11-21T10:43:00.000Z"),
            lastConfirmedAt: CONFIRMED,
          }),
          rowOf({
            blockId: BLOCK_ID,
            destination: "AWS WAF",
            state: SecurityBlockEnforcementState.Applied,
            appliedAt: new Date("2026-11-21T10:42:30.000Z"),
            lastConfirmedAt: CONFIRMED,
          }),
        ],
        now: NOW,
      }),
    ).toEqual({
      id: BLOCK_ID,
      value: "35.205.11.131",
      action: SecurityBlockAction.Block,
      createdAt: new Date("2026-11-21T10:42:00.000Z"),
      expiresAt: new Date("2026-11-22T10:42:00.000Z"),
      createdByName: "Jane Doe",
      source: SecurityBlockSource.Playbook,
      enforcedAt: ["Cloudflare", "AWS WAF"],
      enforcedSince: new Date("2026-11-21T10:42:30.000Z"),
      pendingAt: [],
      notAppliedAt: [],
    });
  });

  test("applied but not confirmed lately does not hold; still pending is being applied; turned down says why", () => {
    const read: ResponseAddressBlock | null = readResponseAddressBlock({
      block: blockOf({ id: BLOCK_ID, value: "35.205.11.131" }),
      enforcements: [
        rowOf({
          blockId: BLOCK_ID,
          destination: "Cloudflare",
          state: SecurityBlockEnforcementState.Applied,
          appliedAt: new Date("2026-11-21T10:43:00.000Z"),
          // Last confirmed an hour ago: OneUptime cannot say it holds now.
          lastConfirmedAt: new Date("2026-11-21T11:00:00.000Z"),
        }),
        rowOf({
          blockId: BLOCK_ID,
          destination: "AWS WAF",
          state: SecurityBlockEnforcementState.Pending,
        }),
        rowOf({
          blockId: BLOCK_ID,
          destination: "Azure WAF",
          state: SecurityBlockEnforcementState.Failed,
          error: "Azure WAF cannot challenge.",
        }),
      ],
      now: NOW,
    });

    expect(read?.enforcedAt).toEqual([]);
    expect(read?.enforcedSince).toBeUndefined();
    expect(read?.pendingAt).toEqual(["AWS WAF"]);
    expect(read?.notAppliedAt).toEqual(
      expect.arrayContaining([
        { name: "Azure WAF", reason: "Azure WAF cannot challenge." },
      ]),
    );
    expect(
      read?.notAppliedAt.map((entry: { name: string }): string => {
        return entry.name;
      }),
    ).not.toContain("AWS WAF");
  });

  test("a challenge that stays until lifted", () => {
    const read: ResponseAddressBlock | null = readResponseAddressBlock({
      block: blockOf({
        id: BLOCK_ID,
        value: "35.205.11.131",
        action: SecurityBlockAction.Challenge,
        expiresAt: null,
      }),
      enforcements: [],
      now: NOW,
    });

    expect(read?.action).toBe(SecurityBlockAction.Challenge);
    expect(read?.expiresAt).toBeNull();
  });

  test("a row with no id or value is nothing to draw", () => {
    const block: SecurityBlock = blockOf({ id: BLOCK_ID, value: "" });

    expect(
      readResponseAddressBlock({ block, enforcements: [], now: NOW }),
    ).toBeNull();
  });
});

describe("where the blocklist is enforced", () => {
  test("by name, each once", () => {
    expect(
      readDestinationNames({
        destinations: [
          { key: "a", name: "Cloudflare", provider: "Cloudflare" },
          { key: "b", name: " AWS WAF ", provider: "AWS WAF" },
          { key: "c", name: "Cloudflare", provider: "Cloudflare" },
        ],
        cannotTell: false,
      }),
    ).toEqual(["Cloudflare", "AWS WAF"]);
  });

  test("none: nothing enforces it", () => {
    expect(readDestinationNames({ destinations: [], cannotTell: false })).toEqual(
      [],
    );
  });

  test("none listed and a kind could not be: OneUptime cannot tell, and the step is done by hand", () => {
    expect(
      readDestinationNames({ destinations: [], cannotTell: true }),
    ).toBeNull();
    expect(
      readDestinationNames({
        destinations: [{ key: "a", name: "Cloudflare", provider: "Cloudflare" }],
        cannotTell: true,
      }),
    ).toEqual(["Cloudflare"]);
  });
});

describe("the blocks that hold the case's addresses", () => {
  let destinations: Array<string>;

  beforeEach(() => {
    destinations = ["Cloudflare"];
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest.spyOn(API, "post").mockImplementation((async () => {
      return new HTTPResponse(
        200,
        {
          destinations: destinations.map((name: string) => {
            return { key: `Test:${name}`, name, provider: "Test" };
          }),
          cannotTell: false,
        },
        {},
      );
    }) as never);
    getListMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an IPv6 address is asked for as blocks are written; an expired block is left out; a range around one is read", async () => {
    const own: SecurityBlock = blockOf({ id: BLOCK_ID, value: "2001:db8::1" });
    const expired: SecurityBlock = blockOf({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000003",
      value: "35.205.11.131",
      expiresAt: new Date("2026-11-21T11:00:00.000Z"),
    });
    const range: SecurityBlock = blockOf({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
      value: "35.205.11.0/24",
    });

    getListMock.mockImplementation(async (args: unknown) => {
      const read: { modelType: unknown; query: Record<string, unknown> } =
        args as { modelType: unknown; query: Record<string, unknown> };

      if (read.modelType === SecurityBlock) {
        const data: Array<SecurityBlock> = read.query["indicatorType"]
          ? [range]
          : [own, expired];
        return { data, count: data.length };
      }

      const rows: Array<SecurityBlockEnforcement> = [
        rowOf({
          blockId: BLOCK_ID,
          destination: "Cloudflare",
          state: SecurityBlockEnforcementState.Applied,
          appliedAt: CONFIRMED,
          lastConfirmedAt: CONFIRMED,
        }),
      ];
      return { data: rows, count: rows.length };
    });

    const loaded: ResponseAddressBlocking | undefined =
      await loadAddressBlocking({
        addresses: ["2001:db8:0:0:0:0:0:1", "35.205.11.131"],
        runStates: { "35.205.11.131": ResponsePlaybookRunState.Waiting },
        now: NOW,
      });

    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: SecurityBlock,
        query: {
          projectId: new ObjectID(PROJECT_ID),
          state: SecurityBlockState.Active,
          value: new Includes(["2001:db8::1", "35.205.11.131"]),
        },
      }),
    );
    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: SecurityBlock,
        query: {
          projectId: new ObjectID(PROJECT_ID),
          state: SecurityBlockState.Active,
          indicatorType: SecurityBlockIndicatorType.IpRange,
        },
      }),
    );
    expect(loaded?.destinations).toEqual(["Cloudflare"]);
    expect(
      loaded?.blocks.map((block: ResponseAddressBlock): [string, Array<string>] => {
        return [block.value, block.enforcedAt];
      }),
    ).toEqual([
      ["2001:db8::1", ["Cloudflare"]],
      ["35.205.11.0/24", []],
    ]);
    expect(loaded?.runStates).toEqual({
      "35.205.11.131": ResponsePlaybookRunState.Waiting,
    });
  });

  test("no address to read for, or no project: nothing read", async () => {
    expect(
      await loadAddressBlocking({ addresses: [], runStates: {}, now: NOW }),
    ).toBeUndefined();
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("the line a block draws", () => {
  function line(overrides: Partial<ResponseAddressBlock>): ResponseAddressBlock {
    return {
      id: BLOCK_ID,
      value: "35.205.11.131",
      action: SecurityBlockAction.Block,
      createdAt: new Date("2026-11-21T10:42:00.000Z"),
      expiresAt: new Date("2026-11-22T10:42:00.000Z"),
      enforcedAt: ["Cloudflare"],
      enforcedSince: new Date("2026-11-21T10:42:30.000Z"),
      pendingAt: [],
      notAppliedAt: [],
      ...overrides,
    };
  }

  test.each([
    [SecurityBlockAction.Block, "Jane Doe", true, BLOCK_LINE_BLOCKED_BY],
    [SecurityBlockAction.Block, undefined, true, BLOCK_LINE_BLOCKED],
    [
      SecurityBlockAction.Block,
      "Jane Doe",
      false,
      BLOCK_LINE_BLOCKED_BY_UNTIL_LIFTED,
    ],
    [SecurityBlockAction.Block, undefined, false, BLOCK_LINE_BLOCKED_UNTIL_LIFTED],
    [SecurityBlockAction.Challenge, "Jane Doe", true, BLOCK_LINE_CHALLENGED_BY],
    [SecurityBlockAction.Challenge, undefined, true, BLOCK_LINE_CHALLENGED],
    [
      SecurityBlockAction.Challenge,
      "Jane Doe",
      false,
      BLOCK_LINE_CHALLENGED_BY_UNTIL_LIFTED,
    ],
    [
      SecurityBlockAction.Challenge,
      undefined,
      false,
      BLOCK_LINE_CHALLENGED_UNTIL_LIFTED,
    ],
  ])(
    "%s by %s, ending %s: %s",
    (
      action: SecurityBlockAction,
      name: string | undefined,
      ends: boolean,
      template: string,
    ) => {
      expect(
        getEnforcedBlockTemplate(
          line({
            action,
            createdByName: name,
            expiresAt: ends ? new Date("2026-11-22T10:42:00.000Z") : null,
          }),
        ),
      ).toBe(template);
    },
  );

  test("held: where, since when, by whom and until when", () => {
    expect(
      writeAddressBlockLine({
        block: line({
          enforcedAt: ["Cloudflare", "AWS WAF"],
          createdByName: "Jane Doe",
        }),
        translator: ENGLISH,
        now: NOW,
      }),
    ).toMatch(
      /^Blocked at Cloudflare and AWS WAF .+ by Jane Doe, until .+\.$/,
    );
  });

  test("being applied, and held nowhere", () => {
    expect(
      writeAddressBlockLine({
        block: line({ enforcedAt: [], pendingAt: ["Cloudflare"] }),
        translator: ENGLISH,
        now: NOW,
      }),
    ).toMatch(/^Asked .+: waiting for Cloudflare to apply the block\.$/);
    expect(
      writeAddressBlockLine({
        block: line({ enforcedAt: [] }),
        translator: ENGLISH,
        now: NOW,
      }),
    ).toMatch(
      /^On your Blocklist since .+, but no destination enforces it, so the address is not blocked anywhere\.$/,
    );
  });

  test("a range around the address, never the address itself", () => {
    expect(
      isRangeAroundAddress({
        block: line({ value: "35.205.11.0/24" }),
        address: "35.205.11.131",
      }),
    ).toBe(true);
    expect(
      isRangeAroundAddress({
        block: line({ value: "2001:db8::1" }),
        address: "2001:db8:0:0:0:0:0:1",
      }),
    ).toBe(false);
  });
});

describe("blocking it by hand", () => {
  test("an IPv4 address, in the AWS CLI's IP set as a /32, nginx and nftables", () => {
    const commands: ReturnType<typeof getBlockByHandCommands> =
      getBlockByHandCommands("35.205.11.131");

    expect(commands.awsCli).toContain("aws wafv2 update-ip-set");
    expect(commands.awsCli).toMatch(/ 35\.205\.11\.131\/32$/);
    expect(commands.nginx).toBe("deny 35.205.11.131;");
    expect(commands.nftables).toBe(
      "nft add element inet filter blocklist { 35.205.11.131 }",
    );
  });

  test("an IPv6 address, written as blocks are, into the IPv6 set", () => {
    const commands: ReturnType<typeof getBlockByHandCommands> =
      getBlockByHandCommands("2001:DB8:0:0:0:0:0:1");

    expect(commands.awsCli).toMatch(/ 2001:db8::1\/128$/);
    expect(commands.nginx).toBe("deny 2001:db8::1;");
    expect(commands.nftables).toBe(
      "nft add element inet filter blocklist6 { 2001:db8::1 }",
    );
  });
});
