/** @timezone UTC */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityProtectedAddressSource } from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import {
  SecurityAttackCampaign,
  SecurityAttackCampaignsResult,
} from "../../../Types/SecurityEvent/SecurityAttackCampaign";
import {
  SecurityAttackNetwork,
  SecurityAttackNetworkKind,
  SecurityAttackNetworksResult,
} from "../../../Types/SecurityEvent/SecurityAttackNetwork";
import {
  SecurityCampaignAddressStanding,
  SecurityNetworkChallengeCheck,
  SecurityNetworkChallengeStanding,
  SecurityNetworkUncheckedReason,
} from "../../../Types/SecurityEvent/SecurityCampaignContainment";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast from "../../../UI/Utils/Toast";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import SecurityAttackCampaigns, {
  SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityAttackCampaigns";
import { SECURITY_CAMPAIGN_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Campaigns/CampaignContainmentCopy";

/*
 * THE CAMPAIGNS PAGE'S ACTIONS, AS A PERSON MEETS THEM (#10354):
 *
 *   - by address: each row a person may block has a box; Block Addresses
 *     opens one dialog that lists what it blocks and what it leaves out,
 *     with why, and blocks them all with one press;
 *   - Group by network: one row per network, and Challenge This Network,
 *     which says what it will do and for how long - or why not - and asks a
 *     Security Admin to say they know when OneUptime cannot check who is in
 *     the network.
 *
 * The server is stubbed at the calls the page makes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10354000-0000-4000-8000-0000000000d1",
);

const getAttackCampaignsMock: MockFunction = getJestMockFunction();
const getAttackNetworksMock: MockFunction = getJestMockFunction();
const checkCampaignAddressesMock: MockFunction = getJestMockFunction();
const blockCampaignAddressesMock: MockFunction = getJestMockFunction();
const checkNetworkChallengeMock: MockFunction = getJestMockFunction();
const challengeNetworkMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        getAttackCampaigns: (...args: Array<unknown>) => {
          return getAttackCampaignsMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Campaigns/CampaignContainmentApi",
  () => {
    return {
      __esModule: true,
      getAttackNetworks: (...args: Array<unknown>) => {
        return getAttackNetworksMock(...args);
      },
      checkCampaignAddresses: (...args: Array<unknown>) => {
        return checkCampaignAddressesMock(...args);
      },
      blockCampaignAddresses: (...args: Array<unknown>) => {
        return blockCampaignAddressesMock(...args);
      },
      checkNetworkChallenge: (...args: Array<unknown>) => {
        return checkNetworkChallengeMock(...args);
      },
      challengeNetwork: (...args: Array<unknown>) => {
        return challengeNetworkMock(...args);
      },
    };
  },
);

function campaign(
  sourceIp: string,
  overrides: Partial<SecurityAttackCampaign> = {},
): SecurityAttackCampaign {
  return {
    sourceIp,
    requestCount: 40,
    rejectedCount: 40,
    reachedAppCount: 0,
    erroredCount: 0,
    reachedDatabaseCount: 0,
    worstOutcome: SecurityEventRequestOutcome.Rejected,
    maxSeverityId: 3,
    attackKinds: [],
    userAgents: ["zgrab/0.x"],
    targetCount: 1,
    sampleTargets: ["/.env"],
    firstSeen: "2026-11-22T10:00:00.000Z",
    lastSeen: "2026-11-22T11:00:00.000Z",
    ...overrides,
  };
}

function campaigns(): SecurityAttackCampaignsResult {
  return {
    campaigns: [
      campaign("35.205.11.131"),
      campaign("203.0.113.10"),
      // Private: never blocked from the page.
      campaign("10.0.4.12"),
      // Already challenged.
      campaign("198.51.100.7", {
        block: {
          value: "198.51.100.0/24",
          action: SecurityBlockAction.Challenge,
          expiresAt: "2026-11-24T10:42:00.000Z",
        },
      }),
    ],
    startTime: "2026-11-16T12:00:00.000Z",
    endTime: "2026-11-23T12:00:00.000Z",
    isTruncated: false,
  };
}

function network(
  overrides: Partial<SecurityAttackNetwork> = {},
): SecurityAttackNetwork {
  return {
    network: "AS14061",
    kind: SecurityAttackNetworkKind.Asn,
    asnName: "DIGITALOCEAN-ASN",
    addressCount: 12,
    addresses: ["203.0.113.7", "203.0.113.9"],
    ranges: [
      { range: "203.0.113.0/24", addressCount: 10, requestCount: 300 },
      { range: "198.51.100.0/24", addressCount: 2, requestCount: 20 },
    ],
    requestCount: 320,
    rejectedCount: 320,
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
    ...overrides,
  };
}

function networks(): SecurityAttackNetworksResult {
  return {
    networks: [
      network(),
      network({
        network: "10.0.4.0/24",
        kind: SecurityAttackNetworkKind.Range,
        asnName: undefined,
        addressCount: 1,
        addresses: ["10.0.4.12"],
        ranges: [{ range: "10.0.4.0/24", addressCount: 1, requestCount: 3 }],
      }),
    ],
    startTime: "2026-11-16T12:00:00.000Z",
    endTime: "2026-11-23T12:00:00.000Z",
    isTruncated: false,
  };
}

function challengeCheck(
  overrides: Partial<SecurityNetworkChallengeCheck>,
): SecurityNetworkChallengeCheck {
  return {
    value: "203.0.113.0/24",
    kind: SecurityAttackNetworkKind.Range,
    standing: SecurityNetworkChallengeStanding.Challengeable,
    holders: ["Cloudflare"],
    isAdmin: false,
    repeat: null,
    suggestedDuration: SecurityBlockDuration.OneDay,
    ...overrides,
  };
}

let isAdmin: boolean;

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  isAdmin = false;
  getJestSpyOn(PermissionGate, "check").mockReturnValue({
    isAllowed: true,
  } as never);
  getJestSpyOn(PermissionGate, "holdsAnyOf").mockImplementation((() => {
    return isAdmin;
  }) as never);
  getJestSpyOn(Toast, "success").mockImplementation((() => {
    return undefined;
  }) as never);

  for (const mock of [
    getAttackCampaignsMock,
    getAttackNetworksMock,
    checkCampaignAddressesMock,
    blockCampaignAddressesMock,
    checkNetworkChallengeMock,
    challengeNetworkMock,
  ]) {
    mock.mockReset();
  }

  getAttackCampaignsMock.mockResolvedValue(campaigns() as never);
  getAttackNetworksMock.mockResolvedValue(networks() as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderPage(): void {
  render(
    <MemoryRouter>
      <SecurityAttackCampaigns />
    </MemoryRouter>,
  );
}

function rowOf(address: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .getAllByTestId(SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID)
    .find((candidate: HTMLElement): boolean => {
      return candidate.textContent?.includes(address) || false;
    });

  if (!row) {
    throw new Error(`No row for ${address}.`);
  }

  return row;
}

describe("Block Addresses", () => {
  test("only a public address no block holds can be selected, and a held one says so", async () => {
    renderPage();

    await screen.findAllByTestId(SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID);

    expect(
      within(rowOf("35.205.11.131")).queryByTestId(
        SECURITY_CAMPAIGN_TEST_IDS.selectRow,
      ),
    ).not.toBeNull();
    expect(
      within(rowOf("10.0.4.12")).queryByTestId(
        SECURITY_CAMPAIGN_TEST_IDS.selectRow,
      ),
    ).toBeNull();
    expect(
      within(rowOf("198.51.100.7")).queryByTestId(
        SECURITY_CAMPAIGN_TEST_IDS.selectRow,
      ),
    ).toBeNull();
    expect(
      within(rowOf("198.51.100.7")).getByTestId(
        SECURITY_CAMPAIGN_TEST_IDS.rowBlock,
      ),
    ).toHaveTextContent("Challenged until");
    expect(
      screen.getByText("Select addresses to block them in one go."),
    ).toBeInTheDocument();
  });

  test("blocks the selected campaigns in one dialog and one press, leaving out - and naming - a protected one", async () => {
    checkCampaignAddressesMock.mockResolvedValue({
      addresses: [
        {
          typed: "35.205.11.131",
          value: "35.205.11.131",
          standing: SecurityCampaignAddressStanding.Blockable,
        },
        {
          typed: "203.0.113.10",
          value: "203.0.113.10",
          standing: SecurityCampaignAddressStanding.Protected,
          protection: {
            source: SecurityProtectedAddressSource.Host,
            protectedValue: "203.0.113.10",
            name: "web-3",
          },
        },
      ],
    } as never);
    blockCampaignAddressesMock.mockResolvedValue({
      addresses: [
        {
          typed: "35.205.11.131",
          value: "35.205.11.131",
          standing: SecurityCampaignAddressStanding.Blocked,
        },
      ],
    } as never);

    renderPage();
    await screen.findAllByTestId(SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID);

    // Select every address that can be blocked: the two public ones.
    fireEvent.click(screen.getByTestId(SECURITY_CAMPAIGN_TEST_IDS.selectAll));

    expect(
      screen.getByTestId(SECURITY_CAMPAIGN_TEST_IDS.selectionBar),
    ).toHaveTextContent("2 addresses selected");

    fireEvent.click(
      screen.getByTestId(SECURITY_CAMPAIGN_TEST_IDS.blockAddresses),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog");

    await waitFor(() => {
      expect(checkCampaignAddressesMock).toHaveBeenCalledWith([
        "35.205.11.131",
        "203.0.113.10",
      ]);
    });

    await within(dialog).findByText("1 address is left out:");
    expect(dialog).toHaveTextContent("web-3");
    expect(dialog).toHaveTextContent("Blocks 1 address for 24 hours.");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Block Addresses" }),
    );

    await waitFor(() => {
      expect(blockCampaignAddressesMock).toHaveBeenCalledTimes(1);
    });
    expect(blockCampaignAddressesMock).toHaveBeenCalledWith({
      values: ["35.205.11.131"],
      action: SecurityBlockAction.Block,
      duration: SecurityBlockDuration.OneDay,
      reason: undefined,
    });
    await waitFor(() => {
      expect(Toast.success).toHaveBeenCalledWith("Blocked 1 address.");
    });
    // The page reads the campaigns again, with the block on its row.
    expect(getAttackCampaignsMock).toHaveBeenCalledTimes(2);
  });

  test("with every selected address left out, nothing can be pressed", async () => {
    checkCampaignAddressesMock.mockResolvedValue({
      addresses: [
        {
          typed: "35.205.11.131",
          value: "35.205.11.131",
          standing: SecurityCampaignAddressStanding.SignedIn,
          users: [
            {
              name: "alice@example.com",
              source: "IdentityProvider",
              lastSeenAt: null,
            },
          ],
        },
      ],
    } as never);

    renderPage();
    await screen.findAllByTestId(SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID);

    fireEvent.click(
      within(rowOf("35.205.11.131")).getByTestId(
        SECURITY_CAMPAIGN_TEST_IDS.selectRow,
      ),
    );
    fireEvent.click(
      screen.getByTestId(SECURITY_CAMPAIGN_TEST_IDS.blockAddresses),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog");

    await within(dialog).findByText(
      "alice@example.com signed in from it in the last 30 days.",
    );
    expect(dialog).toHaveTextContent(
      "Every selected address is left out, so nothing will be blocked.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Block Addresses" }),
    ).toBeDisabled();
  });
});

describe("Group by network and Challenge This Network", () => {
  async function groupByNetwork(): Promise<void> {
    renderPage();
    await screen.findAllByTestId(SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID);

    fireEvent.click(
      screen.getByTestId(SECURITY_CAMPAIGN_TEST_IDS.groupByNetwork),
    );

    await screen.findAllByTestId(SECURITY_CAMPAIGN_TEST_IDS.networkRow);
  }

  function networkRowOf(name: string): HTMLElement {
    return screen
      .getAllByTestId(SECURITY_CAMPAIGN_TEST_IDS.networkRow)
      .find((row: HTMLElement): boolean => {
        return row.getAttribute("data-network") === name;
      })!;
  }

  test("is a toggle that turns the rows into networks, an ASN's naming its ranges", async () => {
    await groupByNetwork();

    expect(getAttackNetworksMock).toHaveBeenCalledTimes(1);

    const asn: HTMLElement = networkRowOf("AS14061");
    expect(asn).toHaveTextContent("DIGITALOCEAN-ASN");
    expect(asn).toHaveTextContent("12 addresses");
    expect(asn).toHaveTextContent(
      "Sent from 2 ranges: 203.0.113.0/24 and 198.51.100.0/24",
    );
    expect(
      within(asn).queryByTestId(SECURITY_CAMPAIGN_TEST_IDS.challengeNetwork),
    ).not.toBeNull();
    // A private range is never challenged from the page.
    expect(
      within(networkRowOf("10.0.4.0/24")).queryByTestId(
        SECURITY_CAMPAIGN_TEST_IDS.challengeNetwork,
      ),
    ).toBeNull();
  });

  test("says what it will do and for how long, and challenges the range a Security Member may", async () => {
    checkNetworkChallengeMock.mockResolvedValue(challengeCheck({}) as never);
    challengeNetworkMock.mockResolvedValue({
      value: "203.0.113.0/24",
      expiresAt: new Date("2026-11-24T12:00:00.000Z"),
      holders: ["Cloudflare"],
    } as never);

    await groupByNetwork();
    fireEvent.click(
      within(networkRowOf("AS14061")).getByTestId(
        SECURITY_CAMPAIGN_TEST_IDS.challengeNetwork,
      ),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog");

    // Anyone but a Security Admin starts on the ASN's largest range.
    await waitFor(() => {
      expect(checkNetworkChallengeMock).toHaveBeenCalled();
    });
    expect(
      (checkNetworkChallengeMock.mock.calls[0]![0] as { value: string }).value,
    ).toBe("203.0.113.0/24");

    await within(dialog).findByText(
      "Every request from 203.0.113.0/24 is asked to pass a challenge at Cloudflare for 24 hours. People pass it; scripts and API clients do not.",
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Challenge This Network" }),
    );

    await waitFor(() => {
      expect(challengeNetworkMock).toHaveBeenCalledTimes(1);
    });
    expect(challengeNetworkMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        value: "203.0.113.0/24",
        duration: SecurityBlockDuration.OneDay,
        acknowledgesUnchecked: false,
      }),
    );
  });

  test("a network a signed-in user is in is refused, naming who, and nothing can be pressed", async () => {
    checkNetworkChallengeMock.mockResolvedValue(
      challengeCheck({
        standing: SecurityNetworkChallengeStanding.SignedIn,
        users: [
          { name: "bob@example.com", source: "Requests", lastSeenAt: null },
        ],
      }) as never,
    );

    await groupByNetwork();
    fireEvent.click(
      within(networkRowOf("AS14061")).getByTestId(
        SECURITY_CAMPAIGN_TEST_IDS.challengeNetwork,
      ),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog");

    await within(dialog).findByText(
      "OneUptime will not challenge 203.0.113.0/24: bob@example.com signed in from it in the last 30 days.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Challenge This Network" }),
    ).toBeDisabled();
  });

  test("a whole ASN OneUptime cannot check is a Security Admin's to challenge once they say they know", async () => {
    isAdmin = true;
    checkNetworkChallengeMock.mockResolvedValue(
      challengeCheck({
        value: "AS14061",
        kind: SecurityAttackNetworkKind.Asn,
        standing: SecurityNetworkChallengeStanding.Unchecked,
        uncheckedReason: SecurityNetworkUncheckedReason.Asn,
        seenAddressCount: 12,
        isAdmin: true,
      }) as never,
    );
    challengeNetworkMock.mockResolvedValue({
      value: "AS14061",
      expiresAt: new Date("2026-11-24T12:00:00.000Z"),
      holders: ["Cloudflare"],
    } as never);

    await groupByNetwork();
    fireEvent.click(
      within(networkRowOf("AS14061")).getByTestId(
        SECURITY_CAMPAIGN_TEST_IDS.challengeNetwork,
      ),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog");

    // A Security Admin starts on the whole ASN.
    await waitFor(() => {
      expect(
        (checkNetworkChallengeMock.mock.calls[0]![0] as { value: string })
          .value,
      ).toBe("AS14061");
    });
    await within(dialog).findByText(
      "OneUptime cannot tell who uses AS14061: it knows only the 12 addresses it saw attack from it. Your own servers and your users may be in it too.",
    );

    const press: HTMLElement = within(dialog).getByRole("button", {
      name: "Challenge This Network",
    });
    expect(press).toBeDisabled();

    fireEvent.click(
      within(dialog).getByTestId(SECURITY_CAMPAIGN_TEST_IDS.acknowledge),
    );

    await waitFor(() => {
      expect(press).not.toBeDisabled();
    });
    fireEvent.click(press);

    await waitFor(() => {
      expect(challengeNetworkMock).toHaveBeenCalledTimes(1);
    });
    expect(challengeNetworkMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        value: "AS14061",
        acknowledgesUnchecked: true,
      }),
    );
  });
});
