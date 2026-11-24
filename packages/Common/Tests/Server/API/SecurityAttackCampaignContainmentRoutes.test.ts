import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * CAMPAIGNS' ACTIONS, THROUGH THEIR ROUTES (#10354):
 *
 *   POST /security-event/attack-campaigns            grouped by network on asking
 *   POST /security-event/attack-campaigns/block-check, /block
 *   POST /security-event/attack-campaigns/network-check, /network-challenge
 *   POST /security-event/attack-campaigns/of-case-address
 *
 * Who may: whoever reads security events reads the page; whoever may block
 * takes its actions - Security Viewer and a member with no Security role do
 * not. While Security Events is switched off on the server, every route
 * that blocks or challenges is refused before anything is read, so no
 * block or challenge is placed (as #10678 holds automatic response); the
 * page's read is left alone, as reads are.
 *
 * The routes hand their work to SecurityCampaignContainment, whose suite
 * holds what it does; here, what each route reads of the request, as whom,
 * and what it answers.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityAttackCampaignAPI, {
  BLOCK_REFUSED_MESSAGE,
  SECURITY_ATTACK_CAMPAIGNS_ROUTE,
  SECURITY_CAMPAIGNS_BLOCK_CHECK_ROUTE,
  SECURITY_CAMPAIGNS_BLOCK_ROUTE,
  SECURITY_CAMPAIGNS_NETWORK_CHALLENGE_ROUTE,
  SECURITY_CAMPAIGNS_NETWORK_CHECK_ROUTE,
  SECURITY_CAMPAIGNS_OF_CASE_ADDRESS_ROUTE,
  findCampaignRowBlock,
  readCampaignDuration,
} from "../../../Server/API/SecurityAttackCampaignAPI";
import SecurityBlockService from "../../../Server/Services/SecurityBlockService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityCampaignContainment from "../../../Server/Utils/SecurityEvent/SecurityCampaignContainment";
import ServerProductRoutes from "../../../Server/Utils/ServerProducts/ServerProductRoutes";
import ServerProducts from "../../../Server/Utils/ServerProducts/ServerProducts";
import TelemetryReadAccess from "../../../Server/Utils/Telemetry/TelemetryReadAccess";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../Types/Product/ServerProductOffReason";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityAttackCampaign } from "../../../Types/SecurityEvent/SecurityAttackCampaign";
import {
  SecurityAttackCampaignGrouping,
  SecurityAttackNetwork,
  SecurityAttackNetworkKind,
} from "../../../Types/SecurityEvent/SecurityAttackNetwork";
import { SecurityCampaignAddressStanding } from "../../../Types/SecurityEvent/SecurityCampaignContainment";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { customDomainCaller } from "./CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import { getJestSpyOn } from "../../Spy";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10354000-0000-4000-8000-0000000000aa",
);
const CASE_ID: string = "10354000-0000-4000-8000-0000000000bb";

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

let props: DatabaseCommonInteractionProps;

function caller(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

// The routes that block or challenge, or read only to do so.
const ACTION_ROUTES: Array<string> = [
  SECURITY_CAMPAIGNS_BLOCK_CHECK_ROUTE,
  SECURITY_CAMPAIGNS_BLOCK_ROUTE,
  SECURITY_CAMPAIGNS_NETWORK_CHECK_ROUTE,
  SECURITY_CAMPAIGNS_NETWORK_CHALLENGE_ROUTE,
  SECURITY_CAMPAIGNS_OF_CASE_ADDRESS_ROUTE,
];

/*
 * A request as Express runs it past its route: the product refusals first
 * (what the route stands behind), then its handler - the handler only when
 * no refusal stopped it.
 */
async function call(
  uri: string,
  body: JSONObject = {},
): Promise<{ refusal: Exception | null }> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    headers: {},
    body,
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    setHeader: jest.fn(),
  } as unknown as ExpressResponse;
  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "post",
    uri,
  );

  for (const middleware of route.middlewares) {
    if (!ServerProductRoutes.isRefusal(middleware)) {
      continue;
    }

    const next: MockedFn = jest.fn();
    await middleware(req, res, next as unknown as NextFunction);

    const refused: Exception | undefined = next.mock.calls[0]?.[0] as
      | Exception
      | undefined;

    if (refused) {
      return { refusal: refused };
    }
  }

  const next: MockedFn = jest.fn();
  await route.handlerFunction(req, res, next as unknown as NextFunction);

  return {
    refusal: (next.mock.calls[0]?.[0] as Exception | undefined) || null,
  };
}

function answered(): JSONObject {
  const calls: Array<Array<unknown>> = sendJsonObjectResponseMock.mock.calls;
  return calls[calls.length - 1]![2] as JSONObject;
}

function campaign(
  sourceIp: string,
  asn?: string | undefined,
): SecurityAttackCampaign {
  return {
    sourceIp,
    ...(asn ? { asn } : {}),
    requestCount: 9,
    rejectedCount: 9,
    reachedAppCount: 0,
    erroredCount: 0,
    reachedDatabaseCount: 0,
    worstOutcome: SecurityEventRequestOutcome.Rejected,
    maxSeverityId: 3,
    attackKinds: [],
    userAgents: [],
    targetCount: 1,
    sampleTargets: [],
    firstSeen: "2026-11-22T10:00:00.000Z",
    lastSeen: "2026-11-22T11:00:00.000Z",
  };
}

function activeBlock(value: string): SecurityBlock {
  const block: SecurityBlock = new SecurityBlock();
  block.id = ObjectID.generate();
  block.value = value;
  block.action = SecurityBlockAction.Challenge;
  block.state = SecurityBlockState.Active;
  block.expiresAt = new Date("2099-01-01T00:00:00.000Z");
  return block;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityAttackCampaignAPI().getRouter();
});

beforeEach(() => {
  jest.clearAllMocks();
  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
  getJestSpyOn(TelemetryReadAccess, "getServiceFilter").mockResolvedValue(
    {} as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("while Security Events is switched off on the server", () => {
  beforeEach(() => {
    getJestSpyOn(ServerProducts, "getOff").mockResolvedValue({
      [ProductKey.SecurityEvents]: ServerProductOffReason.SwitchedOff,
    } as never);
    props = caller([Permission.SecurityAdmin]);
  });

  test.each(ACTION_ROUTES)(
    "%s is refused before anything is read, and no block or challenge is placed",
    async (uri: string) => {
      const blockAddresses: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        SecurityCampaignContainment,
        "blockAddresses",
      );
      const challenge: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        SecurityCampaignContainment,
        "challengeNetwork",
      );
      const block: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        SecurityBlockService,
        "block",
      );

      const { refusal } = await call(uri, {
        values: ["35.205.11.131"],
        value: "203.0.113.0/24",
        securityCaseId: CASE_ID,
        address: "35.205.11.131",
      });

      expect(refusal?.message).toContain("Security Events");
      expect(blockAddresses).not.toHaveBeenCalled();
      expect(challenge).not.toHaveBeenCalled();
      expect(block).not.toHaveBeenCalled();
    },
  );

  test("the page's read is left alone: it only reads", () => {
    expect(
      mockRouter
        .match("post", SECURITY_ATTACK_CAMPAIGNS_ROUTE)
        .middlewares.some(ServerProductRoutes.isRefusal),
    ).toBe(false);

    for (const uri of ACTION_ROUTES) {
      expect(
        mockRouter
          .match("post", uri)
          .middlewares.some(ServerProductRoutes.isRefusal),
      ).toBe(true);
    }
  });
});

describe("who may take Campaigns' actions", () => {
  test.each([
    ["Security Viewer", Permission.SecurityViewer],
    ["Project Member", Permission.ProjectMember],
  ])(
    "a %s may not block or challenge, and nothing is checked or blocked",
    async (_who: string, permission: Permission) => {
      props = caller([permission]);
      const blockAddresses: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        SecurityCampaignContainment,
        "blockAddresses",
      );

      for (const uri of ACTION_ROUTES) {
        const { refusal } = await call(uri, { values: ["35.205.11.131"] });

        expect(refusal).toBeInstanceOf(NotAuthorizedException);
      }

      expect(blockAddresses).not.toHaveBeenCalled();
    },
  );

  test("a Security Viewer refused Block Addresses is told what it takes", async () => {
    props = caller([Permission.SecurityViewer]);

    const { refusal } = await call(SECURITY_CAMPAIGNS_BLOCK_ROUTE, {
      values: ["35.205.11.131"],
    });

    expect(refusal?.message).toBe(BLOCK_REFUSED_MESSAGE);
  });
});

describe("Block Addresses", () => {
  beforeEach(() => {
    props = caller([Permission.SecurityMember]);
  });

  test("blocks every selected address in one call, as the person, for 24 hours unless asked", async () => {
    const blockAddresses: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityCampaignContainment,
      "blockAddresses",
    ).mockResolvedValue({
      addresses: [
        {
          typed: "35.205.11.131",
          value: "35.205.11.131",
          standing: SecurityCampaignAddressStanding.Blocked,
        },
        {
          typed: "203.0.113.10",
          value: "203.0.113.10",
          standing: SecurityCampaignAddressStanding.Protected,
        },
      ],
    } as never);

    const { refusal } = await call(SECURITY_CAMPAIGNS_BLOCK_ROUTE, {
      values: ["35.205.11.131", "203.0.113.10", "35.205.11.131"],
      reason: "  Scanner rotating through our login  ",
    });

    expect(refusal).toBeNull();
    expect(blockAddresses).toHaveBeenCalledTimes(1);

    const asked: {
      projectId: ObjectID;
      values: Array<string>;
      action: SecurityBlockAction;
      duration: SecurityBlockDuration;
      reason: string;
      props: unknown;
    } = blockAddresses.mock.calls[0]![0] as never;
    expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(asked.values).toEqual(["35.205.11.131", "203.0.113.10"]);
    expect(asked.action).toBe(SecurityBlockAction.Block);
    expect(asked.duration).toBe(SecurityBlockDuration.OneDay);
    expect(asked.reason).toBe("Scanner rotating through our login");
    expect(asked.props).toBe(props);

    expect(
      (answered()["addresses"] as Array<JSONObject>).map(
        (address: JSONObject): unknown => {
          return address["standing"];
        },
      ),
    ).toEqual([
      SecurityCampaignAddressStanding.Blocked,
      SecurityCampaignAddressStanding.Protected,
    ]);
  });

  test("Challenge Instead and a length are carried through", async () => {
    const blockAddresses: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityCampaignContainment,
      "blockAddresses",
    ).mockResolvedValue({ addresses: [] } as never);

    await call(SECURITY_CAMPAIGNS_BLOCK_ROUTE, {
      values: ["35.205.11.131"],
      action: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.SevenDays,
    });

    const asked: {
      action: SecurityBlockAction;
      duration: SecurityBlockDuration;
    } = blockAddresses.mock.calls[0]![0] as never;
    expect(asked.action).toBe(SecurityBlockAction.Challenge);
    expect(asked.duration).toBe(SecurityBlockDuration.SevenDays);
  });

  test("never keeps a campaign until someone lifts it, and asks for addresses", async () => {
    const blockAddresses: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityCampaignContainment,
      "blockAddresses",
    );

    const untilLifted: { refusal: Exception | null } = await call(
      SECURITY_CAMPAIGNS_BLOCK_ROUTE,
      {
        values: ["35.205.11.131"],
        duration: SecurityBlockDuration.UntilLifted,
      },
    );
    expect(untilLifted.refusal?.message).toContain("1 hour, 24 hours");

    const none: { refusal: Exception | null } = await call(
      SECURITY_CAMPAIGNS_BLOCK_ROUTE,
      { values: [] },
    );
    expect(none.refusal?.message).toBe("Choose the addresses to block.");
    expect(blockAddresses).not.toHaveBeenCalled();
  });

  test("its check asks the same of the same addresses, blocking nothing", async () => {
    const checkAddresses: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityCampaignContainment,
      "checkAddresses",
    ).mockResolvedValue({ addresses: [] } as never);
    const blockAddresses: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityCampaignContainment,
      "blockAddresses",
    );

    await call(SECURITY_CAMPAIGNS_BLOCK_CHECK_ROUTE, {
      values: ["35.205.11.131", "35.205.11.132"],
    });

    expect(
      (checkAddresses.mock.calls[0]![0] as { values: Array<string> }).values,
    ).toEqual(["35.205.11.131", "35.205.11.132"]);
    expect(blockAddresses).not.toHaveBeenCalled();
  });
});

describe("Challenge This Network", () => {
  beforeEach(() => {
    props = caller([Permission.SecurityAdmin]);
  });

  test("challenges the network asked, saying it knows it is unchecked only when the person did", async () => {
    const challenge: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityCampaignContainment,
      "challengeNetwork",
    ).mockResolvedValue({
      check: { value: "AS14061", holders: ["Cloudflare"] },
      block: activeBlock("AS14061"),
    } as never);

    const { refusal } = await call(SECURITY_CAMPAIGNS_NETWORK_CHALLENGE_ROUTE, {
      value: "AS14061",
      acknowledgesUnchecked: true,
    });

    expect(refusal).toBeNull();

    const asked: {
      request: {
        value: string;
        duration: SecurityBlockDuration;
        acknowledgesUnchecked: boolean;
      };
      props: unknown;
    } = challenge.mock.calls[0]![0] as never;
    expect(asked.request).toEqual({
      value: "AS14061",
      duration: SecurityBlockDuration.OneDay,
      reason: undefined,
      acknowledgesUnchecked: true,
    });
    expect(asked.props).toBe(props);
    expect(answered()["value"]).toBe("AS14061");
    expect(answered()["holders"]).toEqual(["Cloudflare"]);

    // Anything but true is no acknowledgement.
    await call(SECURITY_CAMPAIGNS_NETWORK_CHALLENGE_ROUTE, {
      value: "AS14061",
      acknowledgesUnchecked: "yes",
    });
    expect(
      (
        challenge.mock.calls[1]![0] as {
          request: { acknowledgesUnchecked: boolean };
        }
      ).request.acknowledgesUnchecked,
    ).toBe(false);
  });

  test("a network must be named", async () => {
    const { refusal } = await call(SECURITY_CAMPAIGNS_NETWORK_CHECK_ROUTE, {});

    expect(refusal?.message).toContain("Name the network to challenge");
  });
});

describe("the page's read, grouped by network", () => {
  test("groups the window's addresses by ASN where the events carry one, else by /24, with the block that holds each", async () => {
    props = caller([Permission.SecurityViewer]);
    const read: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventService,
      "findAttackCampaigns",
    ).mockResolvedValue([
      campaign("203.0.113.7", "AS14061"),
      campaign("198.51.100.9", "AS14061"),
      campaign("192.0.2.4"),
      campaign("192.0.2.5"),
    ] as never);
    getJestSpyOn(SecurityBlockService, "findActiveBlocks").mockResolvedValue([
      activeBlock("192.0.2.0/24"),
    ] as never);

    const { refusal } = await call(SECURITY_ATTACK_CAMPAIGNS_ROUTE, {
      groupBy: SecurityAttackCampaignGrouping.Network,
    });

    expect(refusal).toBeNull();
    // The window's most serious addresses, more than the page's 100.
    expect((read.mock.calls[0]![0] as { limit: number }).limit).toBe(2000);

    const networks: Array<SecurityAttackNetwork> = answered()[
      "networks"
    ] as unknown as Array<SecurityAttackNetwork>;
    expect(
      networks.map((network: SecurityAttackNetwork): Array<unknown> => {
        return [network.network, network.kind, network.addressCount];
      }),
    ).toEqual([
      // As many requests and addresses each: by their names.
      ["192.0.2.0/24", SecurityAttackNetworkKind.Range, 2],
      ["AS14061", SecurityAttackNetworkKind.Asn, 2],
    ]);
    expect(networks[0]!.block?.value).toBe("192.0.2.0/24");
    expect(networks[1]!.block).toBeUndefined();
  });

  test("by address, each row says the block that holds it - its own, a range's or its ASN's", async () => {
    props = caller([Permission.SecurityViewer]);
    getJestSpyOn(SecurityEventService, "findAttackCampaigns").mockResolvedValue(
      [
        campaign("203.0.113.7", "AS14061"),
        campaign("192.0.2.4"),
        campaign("35.205.11.131"),
      ] as never,
    );
    getJestSpyOn(SecurityBlockService, "findActiveBlocks").mockResolvedValue([
      activeBlock("AS14061"),
      activeBlock("192.0.2.0/24"),
    ] as never);

    await call(SECURITY_ATTACK_CAMPAIGNS_ROUTE, {});

    const campaigns: Array<SecurityAttackCampaign> = answered()[
      "campaigns"
    ] as unknown as Array<SecurityAttackCampaign>;
    expect(
      campaigns.map((row: SecurityAttackCampaign): unknown => {
        return row.block?.value || null;
      }),
    ).toEqual(["AS14061", "192.0.2.0/24", null]);
  });

  test("a reader who may not read the Blocklist sees no block", async () => {
    props = caller([Permission.ReadSecurityEvent]);
    getJestSpyOn(SecurityEventService, "findAttackCampaigns").mockResolvedValue(
      [campaign("192.0.2.4")] as never,
    );
    const blocks: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityBlockService,
      "findActiveBlocks",
    );

    await call(SECURITY_ATTACK_CAMPAIGNS_ROUTE, {});

    expect(blocks).not.toHaveBeenCalled();
    expect(
      (answered()["campaigns"] as unknown as Array<SecurityAttackCampaign>)[0]!
        .block,
    ).toBeUndefined();
  });
});

describe("what the routes read of a request", () => {
  test("a length is one that ends by itself, 24 hours unless asked", () => {
    expect(readCampaignDuration(undefined)).toBe(SecurityBlockDuration.OneDay);
    expect(readCampaignDuration(SecurityBlockDuration.OneHour)).toBe(
      SecurityBlockDuration.OneHour,
    );
    expect(() => {
      return readCampaignDuration(SecurityBlockDuration.UntilLifted);
    }).toThrow();
    expect(() => {
      return readCampaignDuration("forever");
    }).toThrow();
  });

  test("a row's block: its own, the narrowest range around it, else its ASN's", () => {
    const blocks: Array<SecurityBlock> = [
      activeBlock("203.0.0.0/16"),
      activeBlock("203.0.113.0/24"),
      activeBlock("AS14061"),
    ];

    expect(findCampaignRowBlock({ value: "203.0.113.7", blocks })?.value).toBe(
      "203.0.113.0/24",
    );
    expect(
      findCampaignRowBlock({ value: "198.51.100.1", asn: "AS14061", blocks })
        ?.value,
    ).toBe("AS14061");
    expect(findCampaignRowBlock({ value: "AS14061", blocks })?.value).toBe(
      "AS14061",
    );
    expect(findCampaignRowBlock({ value: "192.0.2.1", blocks })).toBeNull();
  });
});
