import SecurityBlockService, {
  SecurityBlockOutcome,
  SecurityBlockOutcomeStatus,
} from "../../../../Server/Services/SecurityBlockService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import logger from "../../../../Server/Utils/Logger";
import SecurityRepeatOffenders from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityRepeatOffenders";
import SecuritySignedInAddresses, {
  SecuritySignedInAddressCheck,
  SecuritySignedInAddressState,
  SecuritySignedInManyCheck,
  SecuritySignedInSource,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecuritySignedInAddresses";
import SecurityBlockDestination from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityProtectedAddresses from "../../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import TestSecurityBlockDestination from "../../../../Server/Utils/SecurityBlocklist/TestSecurityBlockDestination";
import SecurityCampaignContainment, {
  readCampaignValues,
} from "../../../../Server/Utils/SecurityEvent/SecurityCampaignContainment";
import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockSource,
  SecurityBlockState,
  SECURITY_BLOCK_MESSAGES,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityProtectedAddressSource } from "../../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import { SecurityAttackCampaign } from "../../../../Types/SecurityEvent/SecurityAttackCampaign";
import { SecurityAttackNetworkKind } from "../../../../Types/SecurityEvent/SecurityAttackNetwork";
import {
  SecurityCampaignAddressCheck,
  SecurityCampaignAddressStanding,
  SecurityCampaignAddressesCheck,
  SecurityCampaignOfCaseAddress,
  SecurityNetworkChallengeCheck,
  SecurityNetworkChallengeStanding,
  SecurityNetworkUncheckedReason,
  maySecurityNetworkBeChallenged,
} from "../../../../Types/SecurityEvent/SecurityCampaignContainment";
import SecurityEventRequestOutcome from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * CONTAINING A CAMPAIGN (#10354), as Campaigns' actions do it:
 *
 *   - Block Addresses blocks every selected address in one go, as the
 *     person, leaving out - and naming - the project's own and protected
 *     addresses, those already blocked, those a signed-in user used lately
 *     and those OneUptime could not check;
 *   - Challenge This Network: the largest-range guard and an ASN take a
 *     Security Admin; a signed-in user in the network refuses it, naming
 *     who; one OneUptime cannot check (CannotTell, or an ASN) is a Security
 *     Admin's to challenge knowingly; and where it would hold is said;
 *   - the campaign of a case's address: its public addresses, each once.
 *
 * What lies past it - the Blocklist's service, the signed-in check, the
 * destinations, the events - stands in for itself; the Blocklist's own
 * rules are SecurityBlockService's suite's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-11-23T12:00:00.000Z");
const START: Date = new Date("2026-11-16T12:00:00.000Z");

function caller(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

const MEMBER: DatabaseCommonInteractionProps = caller([
  Permission.SecurityMember,
]);
const ADMIN: DatabaseCommonInteractionProps = caller([
  Permission.SecurityAdmin,
]);

function noneSignedIn(): SecuritySignedInManyCheck {
  return {
    state: SecuritySignedInAddressState.SignedIn,
    usersByAddress: new Map(),
  };
}

function signedInAt(address: string, name: string): SecuritySignedInManyCheck {
  return {
    state: SecuritySignedInAddressState.SignedIn,
    usersByAddress: new Map([
      [
        address,
        [
          {
            name,
            source: SecuritySignedInSource.IdentityProvider,
            lastSeenAt: new Date("2026-11-20T09:00:00.000Z"),
          },
        ],
      ],
    ]),
  };
}

function blockRow(value: string, action?: SecurityBlockAction): SecurityBlock {
  const block: SecurityBlock = new SecurityBlock();
  block.id = ObjectID.generate();
  block.value = value;
  block.action = action || SecurityBlockAction.Block;
  block.state = SecurityBlockState.Active;
  block.expiresAt = new Date("2026-11-24T12:00:00.000Z");
  return block;
}

// Every address the Blocklist is asked to check stands as the map says: free unless named.
function stubBlocklistCheck(
  standing: Record<string, "covered" | "protected" | "unread" | undefined> = {},
): void {
  getJestSpyOn(SecurityBlockService, "check").mockImplementation((async (data: {
    value: string;
  }) => {
    const value: string = data.value;
    const kind: string | undefined = standing[value];

    return {
      value: {
        indicatorType: SecurityBlockIndicatorType.IpAddress,
        value,
      },
      problem: null,
      coveredBy:
        kind === "covered"
          ? blockRow(`${value.split(".").slice(0, 3).join(".")}.0/24`)
          : null,
      protection:
        kind === "protected"
          ? {
              protection: {
                source: SecurityProtectedAddressSource.CloudResource,
                protectedValue: value,
                name: "prod-alb",
              },
              unreadSources: [],
            }
          : {
              protection: null,
              unreadSources:
                kind === "unread"
                  ? [SecurityProtectedAddressSource.CloudResource]
                  : [],
            },
    };
  }) as never);
}

function testDestination(options?: {
  holdsNetworksByAsn?: boolean | undefined;
  canChallenge?: boolean | undefined;
}): void {
  class Destination extends TestSecurityBlockDestination {
    public override supports(entry: {
      indicatorType: SecurityBlockIndicatorType;
      action: SecurityBlockAction;
      value: string;
    }): ReturnType<SecurityBlockDestination["supports"]> {
      if (
        entry.indicatorType === SecurityBlockIndicatorType.Asn &&
        !options?.holdsNetworksByAsn
      ) {
        return {
          isSupported: false,
          reason: "Test edge holds addresses and ranges only",
        };
      }

      return super.supports(entry);
    }
  }

  SecurityBlockDestinations.setSourcesForTests([
    {
      provider: SecurityBlockDestinationProvider.Test,
      findForProject: async (): Promise<Array<SecurityBlockDestination>> => {
        return [
          new Destination({
            name: "Cloudflare",
            canChallenge: options?.canChallenge ?? true,
          }),
        ];
      },
    },
  ]);
}

function campaign(
  sourceIp: string,
  asn?: string | undefined,
): SecurityAttackCampaign {
  return {
    sourceIp,
    ...(asn ? { asn } : {}),
    requestCount: 12,
    rejectedCount: 12,
    reachedAppCount: 0,
    erroredCount: 0,
    reachedDatabaseCount: 0,
    worstOutcome: SecurityEventRequestOutcome.Rejected,
    maxSeverityId: 3,
    attackKinds: [],
    userAgents: [],
    targetCount: 1,
    sampleTargets: [],
    firstSeen: "",
    lastSeen: "",
  };
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  getJestSpyOn(SecurityProtectedAddresses, "asSeenBy").mockImplementation(
    ((data: { protection: unknown }) => {
      return data.protection;
    }) as never,
  );
  getJestSpyOn(SecurityRepeatOffenders, "read").mockImplementation(
    (async (data: { value: string }) => {
      return {
        value: data.value,
        since: START,
        blocks: [],
        offenceCount: 0,
        last: null,
      };
    }) as never,
  );
});

afterEach(() => {
  SecurityBlockDestinations.resetSourcesForTests();
  jest.restoreAllMocks();
});

describe("Block Addresses: what each selected address would meet", () => {
  test("blocks every free address and leaves out - naming - the protected, the covered, the signed-in user's and the unchecked", async () => {
    stubBlocklistCheck({
      "203.0.113.10": "protected",
      "198.51.100.7": "covered",
      "192.0.2.99": "unread",
    });
    getJestSpyOn(SecuritySignedInAddresses, "checkMany").mockResolvedValue(
      signedInAt("192.0.2.5", "alice@example.com") as never,
    );

    const check: SecurityCampaignAddressesCheck =
      await SecurityCampaignContainment.checkAddresses({
        projectId: PROJECT_ID,
        values: [
          "35.205.11.131",
          "203.0.113.10",
          "198.51.100.7",
          "192.0.2.5",
          "192.0.2.99",
        ],
        props: MEMBER,
        now: NOW,
      });

    const standings: Record<string, SecurityCampaignAddressStanding> = {};

    for (const address of check.addresses) {
      standings[address.typed] = address.standing;
    }

    expect(standings).toEqual({
      "35.205.11.131": SecurityCampaignAddressStanding.Blockable,
      "203.0.113.10": SecurityCampaignAddressStanding.Protected,
      "198.51.100.7": SecurityCampaignAddressStanding.AlreadyBlocked,
      "192.0.2.5": SecurityCampaignAddressStanding.SignedIn,
      "192.0.2.99": SecurityCampaignAddressStanding.CannotTell,
    });

    const protectedOne: SecurityCampaignAddressCheck = check.addresses[1]!;
    expect(protectedOne.protection?.name).toBe("prod-alb");
    expect(protectedOne.problem).toContain("prod-alb");
    expect(check.addresses[2]!.coveredBy).toBe("198.51.100.0/24");
    expect(check.addresses[3]!.users?.[0]?.name).toBe("alice@example.com");
    expect(check.signedInUnknownReason).toBeUndefined();
  });

  test("asks whether a signed-in user used them once, for them all, over the last 30 days", async () => {
    stubBlocklistCheck();
    const checkMany: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecuritySignedInAddresses,
      "checkMany",
    ).mockResolvedValue(noneSignedIn() as never);

    await SecurityCampaignContainment.checkAddresses({
      projectId: PROJECT_ID,
      values: ["35.205.11.131", "35.205.11.132"],
      props: MEMBER,
      now: NOW,
    });

    expect(checkMany).toHaveBeenCalledTimes(1);
    const asked: {
      addresses: Array<{ value: string; since: Date }>;
    } = checkMany.mock.calls[0]![0] as never;
    expect(
      asked.addresses.map((entry: { value: string }): string => {
        return entry.value;
      }),
    ).toEqual(["35.205.11.131", "35.205.11.132"]);
    expect(asked.addresses[0]!.since.toISOString()).toBe(
      "2026-10-24T12:00:00.000Z",
    );
  });

  test("when OneUptime cannot tell who signed in, it says why and leaves nothing out for it", async () => {
    stubBlocklistCheck();
    getJestSpyOn(SecuritySignedInAddresses, "checkMany").mockResolvedValue({
      state: SecuritySignedInAddressState.CannotTell,
      reason: "Your scrub rule Hide IPs hides client addresses in your logs.",
    } as never);

    const check: SecurityCampaignAddressesCheck =
      await SecurityCampaignContainment.checkAddresses({
        projectId: PROJECT_ID,
        values: ["35.205.11.131"],
        props: MEMBER,
        now: NOW,
      });

    expect(check.addresses[0]!.standing).toBe(
      SecurityCampaignAddressStanding.Blockable,
    );
    expect(check.signedInUnknownReason).toContain("Hide IPs");
  });

  test("a range is no address Block Addresses blocks", async () => {
    stubBlocklistCheck();
    getJestSpyOn(SecuritySignedInAddresses, "checkMany").mockResolvedValue(
      noneSignedIn() as never,
    );

    const check: SecurityCampaignAddressesCheck =
      await SecurityCampaignContainment.checkAddresses({
        projectId: PROJECT_ID,
        values: ["35.205.11.0/24", "AS14061"],
        props: MEMBER,
        now: NOW,
      });

    expect(
      check.addresses.map((address: SecurityCampaignAddressCheck) => {
        return address.standing;
      }),
    ).toEqual([
      SecurityCampaignAddressStanding.Refused,
      SecurityCampaignAddressStanding.Refused,
    ]);
  });
});

describe("Block Addresses: blocking several campaigns at once", () => {
  test("blocks every selected address in one go, as the person, and leaves out the protected and the signed-in user's", async () => {
    getJestSpyOn(SecuritySignedInAddresses, "checkMany").mockResolvedValue(
      signedInAt("192.0.2.5", "alice@example.com") as never,
    );
    const blocked: Array<{ value: string; props: unknown; action: unknown }> =
      [];
    getJestSpyOn(SecurityBlockService, "block").mockImplementation(
      (async (data: {
        value: string;
        props: DatabaseCommonInteractionProps;
        action: SecurityBlockAction;
        duration: SecurityBlockDuration;
      }): Promise<SecurityBlockOutcome> => {
        blocked.push({
          value: data.value,
          props: data.props,
          action: data.action,
        });

        if (data.value === "203.0.113.10") {
          return {
            status: SecurityBlockOutcomeStatus.Protected,
            protection: {
              source: SecurityProtectedAddressSource.CloudResource,
              protectedValue: "203.0.113.10",
              name: "prod-alb",
            },
            message: "203.0.113.10 is the address of load balancer prod-alb.",
          };
        }

        if (data.value === "198.51.100.7") {
          return {
            status: SecurityBlockOutcomeStatus.AlreadyBlocked,
            block: blockRow("198.51.100.0/24"),
            message:
              "198.51.100.7 is already blocked: 198.51.100.0/24 covers it.",
          };
        }

        return {
          status: SecurityBlockOutcomeStatus.Blocked,
          block: blockRow(data.value),
        };
      }) as never,
    );

    const outcome: SecurityCampaignAddressesCheck =
      await SecurityCampaignContainment.blockAddresses({
        projectId: PROJECT_ID,
        values: [
          "35.205.11.131",
          "35.205.11.132",
          "203.0.113.10",
          "198.51.100.7",
          "192.0.2.5",
        ],
        action: SecurityBlockAction.Block,
        duration: SecurityBlockDuration.OneDay,
        props: MEMBER,
        now: NOW,
      });

    // One action, every address through the Blocklist as the person - never the signed-in user's.
    expect(
      blocked.map((entry: { value: string }): string => {
        return entry.value;
      }),
    ).toEqual([
      "35.205.11.131",
      "35.205.11.132",
      "203.0.113.10",
      "198.51.100.7",
    ]);
    for (const entry of blocked) {
      expect(entry.props).toBe(MEMBER);
      expect(entry.action).toBe(SecurityBlockAction.Block);
    }

    expect(
      outcome.addresses.map((address: SecurityCampaignAddressCheck) => {
        return [address.typed, address.standing];
      }),
    ).toEqual([
      ["35.205.11.131", SecurityCampaignAddressStanding.Blocked],
      ["35.205.11.132", SecurityCampaignAddressStanding.Blocked],
      ["203.0.113.10", SecurityCampaignAddressStanding.Protected],
      ["198.51.100.7", SecurityCampaignAddressStanding.AlreadyBlocked],
      ["192.0.2.5", SecurityCampaignAddressStanding.SignedIn],
    ]);
    expect(outcome.addresses[2]!.protection?.name).toBe("prod-alb");
    expect(outcome.addresses[3]!.coveredBy).toBe("198.51.100.0/24");
    expect(outcome.addresses[4]!.users?.[0]?.name).toBe("alice@example.com");
  });

  test("a block the Blocklist could not check reads as one OneUptime could not tell about", async () => {
    getJestSpyOn(SecuritySignedInAddresses, "checkMany").mockResolvedValue(
      noneSignedIn() as never,
    );
    getJestSpyOn(SecurityBlockService, "block").mockResolvedValue({
      status: SecurityBlockOutcomeStatus.Refused,
      message: SECURITY_BLOCK_MESSAGES.checkFailed({ value: "35.205.11.131" }),
    } as never);

    const outcome: SecurityCampaignAddressesCheck =
      await SecurityCampaignContainment.blockAddresses({
        projectId: PROJECT_ID,
        values: ["35.205.11.131"],
        action: SecurityBlockAction.Challenge,
        duration: SecurityBlockDuration.OneHour,
        props: MEMBER,
        now: NOW,
      });

    expect(outcome.addresses[0]!.standing).toBe(
      SecurityCampaignAddressStanding.CannotTell,
    );
  });

  test("each value is asked about once, at most a page of them", () => {
    expect(
      readCampaignValues(
        [
          "35.205.11.131",
          " 35.205.11.131 ",
          "2001:DB8::1",
          "2001:db8::1",
          5,
          "",
        ],
        100,
      ),
    ).toEqual(["35.205.11.131", "2001:DB8::1"]);

    const many: Array<string> = [];

    for (let index: number = 0; index < 150; index++) {
      many.push(`35.205.${Math.floor(index / 200)}.${index}`);
    }

    expect(readCampaignValues(many, 100)).toHaveLength(100);
    expect(readCampaignValues("35.205.11.131", 100)).toEqual([]);
  });
});

describe("Challenge This Network", () => {
  beforeEach(() => {
    getJestSpyOn(SecurityBlockService, "findCoveringBlock").mockResolvedValue(
      null as never,
    );
    getJestSpyOn(
      SecurityProtectedAddresses,
      "findProtection",
    ).mockResolvedValue({
      protection: null,
      unreadSources: [],
    } as never);
  });

  function signedInCheck(
    state: SecuritySignedInAddressState,
    extra?: Partial<SecuritySignedInAddressCheck>,
  ): void {
    getJestSpyOn(SecuritySignedInAddresses, "check").mockImplementation(
      (async (data: { value: string }) => {
        return {
          state,
          value: data.value,
          since: START,
          ...(state === SecuritySignedInAddressState.SignedIn
            ? {
                users: [
                  {
                    name: "bob@example.com",
                    source: SecuritySignedInSource.Requests,
                    lastSeenAt: new Date("2026-11-22T09:00:00.000Z"),
                  },
                ],
              }
            : {}),
          ...(state === SecuritySignedInAddressState.CannotTell
            ? {
                reason:
                  "Your scrub rule Hide IPs hides client addresses in your traces, so OneUptime cannot tell.",
              }
            : {}),
          ...extra,
        };
      }) as never,
    );
  }

  async function check(
    value: string,
    props: DatabaseCommonInteractionProps,
  ): Promise<SecurityNetworkChallengeCheck> {
    return await SecurityCampaignContainment.checkNetwork({
      projectId: PROJECT_ID,
      value,
      props,
      startTime: START,
      endTime: NOW,
      now: NOW,
    });
  }

  test("a /24 nobody signed in from is anyone's who may block, at the edges that challenge, for 24 hours", async () => {
    testDestination();
    signedInCheck(SecuritySignedInAddressState.None);

    const result: SecurityNetworkChallengeCheck = await check(
      "203.0.113.77/24",
      MEMBER,
    );

    expect(result.value).toBe("203.0.113.0/24");
    expect(result.kind).toBe(SecurityAttackNetworkKind.Range);
    expect(result.standing).toBe(
      SecurityNetworkChallengeStanding.Challengeable,
    );
    expect(result.holders).toEqual(["Cloudflare"]);
    expect(result.suggestedDuration).toBe(SecurityBlockDuration.OneDay);
    expect(maySecurityNetworkBeChallenged(result)).toBe(true);
  });

  describe("the largest-range guard", () => {
    test("a range wider than a /24 takes a Security Admin", async () => {
      testDestination();
      signedInCheck(SecuritySignedInAddressState.None);

      const member: SecurityNetworkChallengeCheck = await check(
        "203.0.0.0/16",
        MEMBER,
      );
      expect(member.standing).toBe(
        SecurityNetworkChallengeStanding.NeedsSecurityAdmin,
      );
      expect(member.problem).toContain("/24");
      expect(maySecurityNetworkBeChallenged(member)).toBe(false);

      const admin: SecurityNetworkChallengeCheck = await check(
        "203.0.0.0/16",
        ADMIN,
      );
      expect(admin.standing).toBe(
        SecurityNetworkChallengeStanding.Challengeable,
      );
    });

    test("an IPv6 range wider than a /48 takes a Security Admin; a /48 does not", async () => {
      testDestination();
      signedInCheck(SecuritySignedInAddressState.None);

      expect((await check("2001:db8::/32", MEMBER)).standing).toBe(
        SecurityNetworkChallengeStanding.NeedsSecurityAdmin,
      );
      expect((await check("2001:db8:1::/48", MEMBER)).standing).toBe(
        SecurityNetworkChallengeStanding.Challengeable,
      );
    });

    test("nobody challenges a range wider than the widest", async () => {
      testDestination();
      signedInCheck(SecuritySignedInAddressState.None);

      const result: SecurityNetworkChallengeCheck = await check(
        "10.0.0.0/7",
        ADMIN,
      );

      expect(result.standing).toBe(SecurityNetworkChallengeStanding.Refused);
    });
  });

  test("a network that holds a signed-in user's address is refused, naming who", async () => {
    testDestination();
    signedInCheck(SecuritySignedInAddressState.SignedIn);

    const result: SecurityNetworkChallengeCheck = await check(
      "203.0.113.0/24",
      ADMIN,
    );

    expect(result.standing).toBe(SecurityNetworkChallengeStanding.SignedIn);
    expect(result.users?.[0]?.name).toBe("bob@example.com");
    expect(result.problem).toContain("bob@example.com");
    // Not even a Security Admin challenges it.
    expect(maySecurityNetworkBeChallenged(result)).toBe(false);
  });

  test("CannotTell fails toward a person: only a Security Admin challenges it, knowingly", async () => {
    testDestination();
    signedInCheck(SecuritySignedInAddressState.CannotTell);

    const member: SecurityNetworkChallengeCheck = await check(
      "203.0.113.0/24",
      MEMBER,
    );
    expect(member.standing).toBe(SecurityNetworkChallengeStanding.Unchecked);
    expect(member.uncheckedReason).toBe(
      SecurityNetworkUncheckedReason.SignedInCheck,
    );
    expect(member.uncheckedReasonText).toContain("Hide IPs");
    expect(maySecurityNetworkBeChallenged(member)).toBe(false);

    const admin: SecurityNetworkChallengeCheck = await check(
      "203.0.113.0/24",
      ADMIN,
    );
    expect(admin.standing).toBe(SecurityNetworkChallengeStanding.Unchecked);
    expect(maySecurityNetworkBeChallenged(admin)).toBe(true);
  });

  test("a network holding one of the project's own addresses is refused, saying what it is", async () => {
    testDestination();
    signedInCheck(SecuritySignedInAddressState.None);
    getJestSpyOn(
      SecurityProtectedAddresses,
      "findProtection",
    ).mockResolvedValue({
      protection: {
        source: SecurityProtectedAddressSource.Host,
        protectedValue: "203.0.113.20",
        name: "web-3",
      },
      unreadSources: [],
    } as never);

    const result: SecurityNetworkChallengeCheck = await check(
      "203.0.113.0/24",
      ADMIN,
    );

    expect(result.standing).toBe(SecurityNetworkChallengeStanding.Protected);
    expect(result.protection?.name).toBe("web-3");
    expect(maySecurityNetworkBeChallenged(result)).toBe(false);
  });

  test("a network a block already covers says so", async () => {
    testDestination();
    signedInCheck(SecuritySignedInAddressState.None);
    getJestSpyOn(SecurityBlockService, "findCoveringBlock").mockResolvedValue(
      blockRow("203.0.0.0/16", SecurityBlockAction.Challenge) as never,
    );

    const result: SecurityNetworkChallengeCheck = await check(
      "203.0.113.0/24",
      MEMBER,
    );

    expect(result.standing).toBe(
      SecurityNetworkChallengeStanding.AlreadyCovered,
    );
    expect(result.coveredBy).toEqual({
      value: "203.0.0.0/16",
      action: SecurityBlockAction.Challenge,
      expiresAt: "2026-11-24T12:00:00.000Z",
    });
  });

  test("with no edge that challenges, it says what to connect", async () => {
    testDestination({ canChallenge: false });
    signedInCheck(SecuritySignedInAddressState.None);

    const result: SecurityNetworkChallengeCheck = await check(
      "203.0.113.0/24",
      ADMIN,
    );

    expect(result.standing).toBe(SecurityNetworkChallengeStanding.NotHeld);
    expect(result.holders).toEqual([]);
  });

  test("a network challenged twice before is offered 7 days, with when", async () => {
    testDestination();
    signedInCheck(SecuritySignedInAddressState.None);
    getJestSpyOn(SecurityRepeatOffenders, "read").mockResolvedValue({
      value: "203.0.113.0/24",
      since: START,
      blocks: [],
      offenceCount: 2,
      last: {
        securityBlockId: "b",
        value: "203.0.113.0/24",
        action: SecurityBlockAction.Challenge,
        source: SecurityBlockSource.Person,
        state: SecurityBlockState.Expired,
        createdAt: new Date("2026-11-12T09:00:00.000Z"),
        securityCaseId: null,
        caseNumber: null,
      },
    } as never);

    const result: SecurityNetworkChallengeCheck = await check(
      "203.0.113.0/24",
      MEMBER,
    );

    expect(result.repeat?.offenceCount).toBe(2);
    expect(result.suggestedDuration).toBe(SecurityBlockDuration.SevenDays);
  });

  describe("a whole network by its ASN", () => {
    beforeEach(() => {
      getJestSpyOn(
        SecurityEventService,
        "findAttackCampaigns",
      ).mockResolvedValue([
        campaign("203.0.113.7", "AS14061"),
        campaign("198.51.100.9", "AS14061"),
        campaign("192.0.2.1", "AS64500"),
      ] as never);
      getJestSpyOn(SecurityBlockService, "findBy").mockResolvedValue(
        [] as never,
      );
    });

    test("is a Security Admin's alone", async () => {
      testDestination({ holdsNetworksByAsn: true });
      getJestSpyOn(SecuritySignedInAddresses, "checkMany").mockResolvedValue(
        noneSignedIn() as never,
      );

      const result: SecurityNetworkChallengeCheck = await check(
        "AS14061",
        MEMBER,
      );

      expect(result.kind).toBe(SecurityAttackNetworkKind.Asn);
      expect(result.standing).toBe(
        SecurityNetworkChallengeStanding.NeedsSecurityAdmin,
      );
      expect(result.seenAddressCount).toBe(2);
    });

    test("is never checked whole: a Security Admin challenges it knowingly, at the edges that hold one", async () => {
      testDestination({ holdsNetworksByAsn: true });
      const checkMany: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        SecuritySignedInAddresses,
        "checkMany",
      ).mockResolvedValue(noneSignedIn() as never);

      const result: SecurityNetworkChallengeCheck = await check(
        "as14061",
        ADMIN,
      );

      expect(result.value).toBe("AS14061");
      expect(result.standing).toBe(SecurityNetworkChallengeStanding.Unchecked);
      expect(result.uncheckedReason).toBe(SecurityNetworkUncheckedReason.Asn);
      expect(result.holders).toEqual(["Cloudflare"]);
      expect(maySecurityNetworkBeChallenged(result)).toBe(true);

      // What OneUptime knows of who is in it: the addresses it saw attack from it.
      const asked: { addresses: Array<{ value: string }> } = checkMany.mock
        .calls[0]![0] as never;
      expect(
        asked.addresses.map((entry: { value: string }): string => {
          return entry.value;
        }),
      ).toEqual(["203.0.113.7", "198.51.100.9"]);
    });

    test("one of its addresses a signed-in user used refuses it, naming who", async () => {
      testDestination({ holdsNetworksByAsn: true });
      getJestSpyOn(SecuritySignedInAddresses, "checkMany").mockResolvedValue(
        signedInAt("198.51.100.9", "carol@example.com") as never,
      );

      const result: SecurityNetworkChallengeCheck = await check(
        "AS14061",
        ADMIN,
      );

      expect(result.standing).toBe(SecurityNetworkChallengeStanding.SignedIn);
      expect(result.users?.[0]?.name).toBe("carol@example.com");
    });

    test("with nothing that holds an ASN connected, it says to turn on Cloudflare's blocking", async () => {
      testDestination({ holdsNetworksByAsn: false });
      getJestSpyOn(SecuritySignedInAddresses, "checkMany").mockResolvedValue(
        noneSignedIn() as never,
      );

      const result: SecurityNetworkChallengeCheck = await check(
        "AS14061",
        ADMIN,
      );

      expect(result.standing).toBe(SecurityNetworkChallengeStanding.NotHeld);
      expect(result.problem).toContain("Cloudflare");
    });
  });

  describe("challenging it", () => {
    test("challenges a range as the person, for the length asked, through the Blocklist", async () => {
      testDestination();
      signedInCheck(SecuritySignedInAddressState.None);
      const block: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        SecurityBlockService,
        "block",
      ).mockResolvedValue({
        status: SecurityBlockOutcomeStatus.Blocked,
        block: blockRow("203.0.113.0/24", SecurityBlockAction.Challenge),
      } as never);

      await SecurityCampaignContainment.challengeNetwork({
        projectId: PROJECT_ID,
        request: {
          value: "203.0.113.0/24",
          duration: SecurityBlockDuration.OneDay,
          reason: "Rotating scanner",
          acknowledgesUnchecked: false,
        },
        props: MEMBER,
        startTime: START,
        endTime: NOW,
        now: NOW,
      });

      expect(block).toHaveBeenCalledTimes(1);
      const asked: {
        value: string;
        action: SecurityBlockAction;
        duration: SecurityBlockDuration;
        reason: string;
        props: unknown;
        acknowledgesUncheckedNetwork: boolean;
      } = block.mock.calls[0]![0] as never;
      expect(asked.value).toBe("203.0.113.0/24");
      expect(asked.action).toBe(SecurityBlockAction.Challenge);
      expect(asked.duration).toBe(SecurityBlockDuration.OneDay);
      expect(asked.reason).toBe("Rotating scanner");
      expect(asked.props).toBe(MEMBER);
      expect(asked.acknowledgesUncheckedNetwork).toBe(false);
    });

    test("refuses a network a signed-in user is in, naming who, and blocks nothing", async () => {
      testDestination();
      signedInCheck(SecuritySignedInAddressState.SignedIn);
      const block: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        SecurityBlockService,
        "block",
      );

      await expect(
        SecurityCampaignContainment.challengeNetwork({
          projectId: PROJECT_ID,
          request: {
            value: "203.0.113.0/24",
            duration: SecurityBlockDuration.OneDay,
            acknowledgesUnchecked: true,
          },
          props: ADMIN,
          startTime: START,
          endTime: NOW,
          now: NOW,
        }),
      ).rejects.toThrow("bob@example.com");
      expect(block).not.toHaveBeenCalled();
    });

    test("refuses one OneUptime cannot check unless a Security Admin says they know", async () => {
      testDestination();
      signedInCheck(SecuritySignedInAddressState.CannotTell);
      const block: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        SecurityBlockService,
        "block",
      ).mockResolvedValue({
        status: SecurityBlockOutcomeStatus.Blocked,
        block: blockRow("203.0.113.0/24", SecurityBlockAction.Challenge),
      } as never);

      const request: {
        value: string;
        duration: SecurityBlockDuration;
        acknowledgesUnchecked: boolean;
      } = {
        value: "203.0.113.0/24",
        duration: SecurityBlockDuration.OneDay,
        acknowledgesUnchecked: true,
      };

      // A Security Member, knowingly or not, is refused.
      await expect(
        SecurityCampaignContainment.challengeNetwork({
          projectId: PROJECT_ID,
          request,
          props: MEMBER,
          startTime: START,
          endTime: NOW,
          now: NOW,
        }),
      ).rejects.toThrow("Security Admin");

      // A Security Admin who did not say they know is refused.
      await expect(
        SecurityCampaignContainment.challengeNetwork({
          projectId: PROJECT_ID,
          request: { ...request, acknowledgesUnchecked: false },
          props: ADMIN,
          startTime: START,
          endTime: NOW,
          now: NOW,
        }),
      ).rejects.toThrow("Confirm");
      expect(block).not.toHaveBeenCalled();

      await SecurityCampaignContainment.challengeNetwork({
        projectId: PROJECT_ID,
        request,
        props: ADMIN,
        startTime: START,
        endTime: NOW,
        now: NOW,
      });

      expect(block).toHaveBeenCalledTimes(1);
      expect(
        (block.mock.calls[0]![0] as { acknowledgesUncheckedNetwork: boolean })
          .acknowledgesUncheckedNetwork,
      ).toBe(true);
    });

    test("an ASN is challenged as an ASN, the Blocklist told the Security Admin knows it is unchecked", async () => {
      testDestination({ holdsNetworksByAsn: true });
      getJestSpyOn(
        SecurityEventService,
        "findAttackCampaigns",
      ).mockResolvedValue([campaign("203.0.113.7", "AS14061")] as never);
      getJestSpyOn(SecurityBlockService, "findBy").mockResolvedValue(
        [] as never,
      );
      getJestSpyOn(SecuritySignedInAddresses, "checkMany").mockResolvedValue(
        noneSignedIn() as never,
      );
      const block: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        SecurityBlockService,
        "block",
      ).mockResolvedValue({
        status: SecurityBlockOutcomeStatus.Blocked,
        block: blockRow("AS14061", SecurityBlockAction.Challenge),
      } as never);

      await SecurityCampaignContainment.challengeNetwork({
        projectId: PROJECT_ID,
        request: {
          value: "AS14061",
          duration: SecurityBlockDuration.OneDay,
          acknowledgesUnchecked: true,
        },
        props: ADMIN,
        startTime: START,
        endTime: NOW,
        now: NOW,
      });

      const asked: {
        value: string;
        action: SecurityBlockAction;
        acknowledgesUncheckedNetwork: boolean;
      } = block.mock.calls[0]![0] as never;
      expect(asked.value).toBe("AS14061");
      expect(asked.action).toBe(SecurityBlockAction.Challenge);
      expect(asked.acknowledgesUncheckedNetwork).toBe(true);
    });

    test("a block the Blocklist refuses after the check is said, not swallowed", async () => {
      testDestination();
      signedInCheck(SecuritySignedInAddressState.None);
      getJestSpyOn(SecurityBlockService, "block").mockResolvedValue({
        status: SecurityBlockOutcomeStatus.Refused,
        message:
          "OneUptime could not check whether 203.0.113.0/24 is one of your own addresses, so it did not block it. Try again in a minute.",
      } as never);

      await expect(
        SecurityCampaignContainment.challengeNetwork({
          projectId: PROJECT_ID,
          request: {
            value: "203.0.113.0/24",
            duration: SecurityBlockDuration.OneDay,
            acknowledgesUnchecked: false,
          },
          props: MEMBER,
          startTime: START,
          endTime: NOW,
          now: NOW,
        }),
      ).rejects.toThrow("Try again in a minute");
    });
  });
});

describe("the campaign of a case's address", () => {
  function caseWith(addresses: Array<string>): void {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase.id = CASE_ID;
    securityCase.entities = addresses.map((value: string) => {
      return { type: SecurityEntityType.IpAddress, value };
    }) as never;
    getJestSpyOn(SecurityCaseService, "findOneBy").mockResolvedValue(
      securityCase as never,
    );
  }

  test("reads the other addresses that sent the same requests with the same tools, public ones each once, with what a block of each would meet", async () => {
    caseWith(["35.205.11.131"]);
    stubBlocklistCheck({ "203.0.113.10": "protected" });
    getJestSpyOn(SecuritySignedInAddresses, "checkMany").mockResolvedValue(
      noneSignedIn() as never,
    );
    const read: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventService,
      "findCampaignOfAddress",
    ).mockResolvedValue({
      userAgents: ["zgrab/0.x"],
      targetCount: 3,
      addresses: [
        {
          address: "203.0.113.10",
          requestCount: 30,
          sharedTargetCount: 3,
          lastSeen: "2026-11-23T10:00:00.000Z",
        },
        {
          address: "2001:DB8::5",
          requestCount: 4,
          sharedTargetCount: 1,
          lastSeen: "2026-11-23T09:00:00.000Z",
        },
        {
          address: "2001:db8::5",
          requestCount: 6,
          sharedTargetCount: 2,
          lastSeen: "2026-11-23T11:00:00.000Z",
        },
        // Private: never reaches the app from the internet.
        {
          address: "10.0.4.12",
          requestCount: 90,
          sharedTargetCount: 3,
          lastSeen: "2026-11-23T11:00:00.000Z",
        },
      ],
    } as never);

    const campaignOf: SecurityCampaignOfCaseAddress =
      await SecurityCampaignContainment.findCampaignOfCaseAddress({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        address: "35.205.11.131",
        props: MEMBER,
        now: NOW,
      });

    const asked: { spellings: Array<string>; startTime: Date; endTime: Date } =
      read.mock.calls[0]![0] as never;
    expect(asked.spellings).toContain("35.205.11.131");
    expect(asked.startTime.toISOString()).toBe("2026-11-16T12:00:00.000Z");

    expect(campaignOf.address).toBe("35.205.11.131");
    expect(campaignOf.userAgents).toEqual(["zgrab/0.x"]);
    expect(
      campaignOf.addresses.map(
        (
          address: SecurityCampaignOfCaseAddress["addresses"][number],
        ): Array<unknown> => {
          return [address.value, address.standing, address.requestCount];
        },
      ),
    ).toEqual([
      ["203.0.113.10", SecurityCampaignAddressStanding.Protected, 30],
      ["2001:db8::5", SecurityCampaignAddressStanding.Blockable, 10],
    ]);
    expect(campaignOf.isTruncated).toBe(false);
  });

  test("refuses an address that is none of the case's, or a private one", async () => {
    caseWith(["35.205.11.131", "10.0.4.12"]);

    await expect(
      SecurityCampaignContainment.findCampaignOfCaseAddress({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        address: "35.205.11.132",
        props: MEMBER,
        now: NOW,
      }),
    ).rejects.toThrow("public addresses");

    await expect(
      SecurityCampaignContainment.findCampaignOfCaseAddress({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        address: "10.0.4.12",
        props: MEMBER,
        now: NOW,
      }),
    ).rejects.toThrow("public addresses");
  });

  test("a case the person cannot read is not found", async () => {
    getJestSpyOn(SecurityCaseService, "findOneBy").mockResolvedValue(
      null as never,
    );

    await expect(
      SecurityCampaignContainment.readCaseAddress({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        address: "35.205.11.131",
        props: MEMBER,
      }),
    ).rejects.toThrow("not found");
  });
});
