import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  CLOUD_AI_AGENT_ORGANIZATION_SKIPPED,
  CLOUD_AI_AGENT_ORGANIZATION_STATE_WORDS,
  canSetUpCloudAiAgentOrganization,
  getCloudAiAgentOrganizationSetupOptions,
  isEveryCloudOrganizationAgentConnected,
  readCloudOrganizationKeysForSetup,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentOrganization";
import CloudAiAgentOrganizationAccounts from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentOrganizationAccounts";
import {
  CloudAiAgentSetupChoices,
  getDefaultCloudAiAgentSetupChoices,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetup";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { buildCloudAiAgentKey } from "../../../Types/CloudConnection/CloudAiAgentKey";
import {
  CloudAiAgentOrganizationSetupOptions,
  describeCloudAiAgentOrganizationSetupProblem,
  getCloudAiAgentChangeOperations,
} from "../../../Types/CloudConnection/CloudAiAgentSetupCommands";
import {
  CloudOrganizationAccountView,
  CloudOrganizationKeys,
  CloudOrganizationView,
  NOT_AN_ORGANIZATION,
} from "../../../Types/CloudConnection/CloudOrganizationAgents";
import { CLOUD_AI_DEFAULT_REQUIRED_TAG } from "../../../Types/ResourceAiAgent/ResourceAiAccess";

/*
 * App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentOrganization
 * and its accounts list: when Let AI fix problems asks which accounts, the
 * keys it writes the organization's command from (each account's own, of
 * the organization it shows), the command's options from the dialog's
 * choices, and the list of accounts with their agents.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

afterEach(() => {
  cleanup();
});

const CLOUD_MANAGEMENT: string = "30000000-0000-4000-8000-000000000010";
const CLOUD_A: string = "30000000-0000-4000-8000-000000000011";
const CLOUD_STRANGER: string = "30000000-0000-4000-8000-000000000099";

function keyOf(cloudAccountId: string, digit: string): string {
  return buildCloudAiAgentKey({ cloudAccountId, secret: digit.repeat(64) });
}

const VIEW: CloudOrganizationView = {
  isOrganization: true,
  managementAccountId: "111111111111",
  accounts: [
    {
      cloudAccountId: CLOUD_MANAGEMENT,
      accountId: "111111111111",
      name: "Management",
      isManagementAccount: true,
      agent: "connected",
      lastSeenAt: "2026-11-06T11:59:00.000Z",
    },
    {
      cloudAccountId: CLOUD_A,
      accountId: "222222222222",
      name: "Payments",
      isManagementAccount: false,
      agent: "none",
      lastSeenAt: null,
    },
  ],
  isTruncated: false,
};

const KEYS: CloudOrganizationKeys = {
  managementAccountId: "111111111111",
  keys: [
    {
      cloudAccountId: CLOUD_MANAGEMENT,
      accountId: "111111111111",
      name: "Management",
      agentKey: keyOf(CLOUD_MANAGEMENT, "1"),
      worksUntilConnectedBy: "2026-11-07T12:00:00.000Z",
    },
    {
      cloudAccountId: CLOUD_A,
      accountId: "222222222222",
      name: "Payments",
      agentKey: keyOf(CLOUD_A, "2"),
      worksUntilConnectedBy: "2026-11-07T12:00:00.000Z",
    },
  ],
  skipped: [],
};

describe("canSetUpCloudAiAgentOrganization", () => {
  test("an AWS account of an organization the reader sees more of", () => {
    expect(
      canSetUpCloudAiAgentOrganization({
        provider: CloudProvider.AWS,
        view: VIEW,
      }),
    ).toBe(true);
  });

  test.each([
    ["not read yet", CloudProvider.AWS, null],
    ["no organization", CloudProvider.AWS, NOT_AN_ORGANIZATION],
    [
      "only this account",
      CloudProvider.AWS,
      { ...VIEW, accounts: [VIEW.accounts[1]!] },
    ],
    [
      "no management account",
      CloudProvider.AWS,
      { ...VIEW, managementAccountId: null },
    ],
    ["Azure", CloudProvider.Azure, VIEW],
    ["Google Cloud", CloudProvider.GCP, VIEW],
  ])(
    "%s: not asked",
    (
      _name: string,
      provider: CloudProvider,
      view: CloudOrganizationView | null,
    ) => {
      expect(canSetUpCloudAiAgentOrganization({ provider, view })).toBe(false);
    },
  );
});

describe("readCloudOrganizationKeysForSetup", () => {
  test("each account's own key, of the organization shown", () => {
    expect(
      readCloudOrganizationKeysForSetup({ keys: KEYS, view: VIEW }),
    ).toEqual(KEYS);
  });

  test("a key made for another account, or for an account the dialog does not show, is left out", () => {
    const keys: CloudOrganizationKeys = {
      ...KEYS,
      keys: [
        { ...KEYS.keys[0]!, agentKey: keyOf(CLOUD_A, "7") },
        KEYS.keys[1]!,
        {
          cloudAccountId: CLOUD_STRANGER,
          accountId: "999999999999",
          name: "Stranger",
          agentKey: keyOf(CLOUD_STRANGER, "8"),
          worksUntilConnectedBy: "",
        },
        { ...KEYS.keys[1]!, agentKey: "not-a-key" },
      ],
    };

    expect(
      readCloudOrganizationKeysForSetup({ keys, view: VIEW })?.keys,
    ).toEqual([KEYS.keys[1]]);
  });

  test("no keys: none", () => {
    expect(
      readCloudOrganizationKeysForSetup({ keys: null, view: VIEW }),
    ).toBeNull();
  });
});

describe("getCloudAiAgentOrganizationSetupOptions", () => {
  const defaults: CloudAiAgentSetupChoices = getDefaultCloudAiAgentSetupChoices(
    { provider: CloudProvider.AWS },
  );

  test("the defaults: ask first, every change, every account with its key", () => {
    const options: CloudAiAgentOrganizationSetupOptions =
      getCloudAiAgentOrganizationSetupOptions({
        choices: defaults,
        oneuptimeUrl: "https://oneuptime.example.com",
        keys: KEYS,
      });

    expect(options).toEqual({
      oneuptimeUrl: "https://oneuptime.example.com",
      fixesMode: "RequireApproval",
      requiredTag: null,
      managementAccountId: "111111111111",
      accounts: [
        {
          accountId: "111111111111",
          cloudAccountId: CLOUD_MANAGEMENT,
          agentKey: keyOf(CLOUD_MANAGEMENT, "1"),
        },
        {
          accountId: "222222222222",
          cloudAccountId: CLOUD_A,
          agentKey: keyOf(CLOUD_A, "2"),
        },
      ],
    });
    expect(describeCloudAiAgentOrganizationSetupProblem(options)).toBeNull();
  });

  test("the choices of More fields reach every account's agent", () => {
    const some: Array<string> = getCloudAiAgentChangeOperations(
      CloudProvider.AWS,
    ).slice(0, 2);
    const options: CloudAiAgentOrganizationSetupOptions =
      getCloudAiAgentOrganizationSetupOptions({
        choices: {
          ...defaults,
          fixSafeProblemsAlone: true,
          enabledOperations: some,
          protectedTargetsText: "*prod-db*\n*billing*",
          onlyTaggedResources: true,
        },
        oneuptimeUrl: "https://oneuptime.example.com",
        keys: KEYS,
      });

    expect(options.fixesMode).toBe("Automatic");
    expect(options.enabledOperations).toEqual(some);
    expect(options.protectedTargets).toEqual(["*prod-db*", "*billing*"]);
    expect(options.requiredTag).toBe(CLOUD_AI_DEFAULT_REQUIRED_TAG);
    expect(describeCloudAiAgentOrganizationSetupProblem(options)).toBeNull();
  });
});

describe("isEveryCloudOrganizationAgentConnected", () => {
  test("every account connected, and at least one", () => {
    expect(isEveryCloudOrganizationAgentConnected(VIEW)).toBe(false);
    expect(
      isEveryCloudOrganizationAgentConnected({
        ...VIEW,
        accounts: VIEW.accounts.map(
          (
            account: CloudOrganizationAccountView,
          ): CloudOrganizationAccountView => {
            return { ...account, agent: "connected" };
          },
        ),
      }),
    ).toBe(true);
    expect(isEveryCloudOrganizationAgentConnected(NOT_AN_ORGANIZATION)).toBe(
      false,
    );
    expect(isEveryCloudOrganizationAgentConnected(null)).toBe(false);
  });
});

describe("the words", () => {
  test("each agent state, and the accounts left out in both numbers", () => {
    expect(CLOUD_AI_AGENT_ORGANIZATION_STATE_WORDS).toEqual({
      connected: "Connected",
      offline: "Offline",
      none: "Waiting",
    });
    expect(CLOUD_AI_AGENT_ORGANIZATION_SKIPPED.one).toContain(
      "{{count}} account ",
    );
    expect(CLOUD_AI_AGENT_ORGANIZATION_SKIPPED.other).toContain(
      "{{count}} accounts ",
    );
  });
});

describe("CloudAiAgentOrganizationAccounts", () => {
  test("how many are connected, then each account, the management account marked", () => {
    render(<CloudAiAgentOrganizationAccounts view={VIEW} />);

    const summary: HTMLElement = screen.getByTestId(
      "cloud-ai-agent-organization-accounts-summary",
    );

    expect(summary).toHaveTextContent("1 of 2 accounts connected");
    expect(summary).toHaveAttribute("data-state", "waiting");
    expect(summary).toHaveAttribute("role", "status");
    expect(
      screen.getAllByTestId("cloud-ai-agent-organization-accounts-management"),
    ).toHaveLength(1);
    // Account ids read left to right in every language.
    expect(screen.getByText("222222222222")).toHaveAttribute("dir", "ltr");
    expect(
      screen.queryByTestId("cloud-ai-agent-organization-accounts-truncated"),
    ).toBeNull();
  });

  test("each name keeps its own direction and takes two lines before it is cut", () => {
    render(<CloudAiAgentOrganizationAccounts view={VIEW} />);

    const names: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-ai-agent-organization-accounts-name",
    );

    expect(
      names.map((name: HTMLElement): string => {
        return name.textContent || "";
      }),
    ).toEqual(["Management", "Payments"]);

    for (const name of names) {
      // dir=auto: a Latin name on a right-to-left page is cut at its end.
      expect(name).toHaveAttribute("dir", "auto");
      expect(name).toHaveClass("line-clamp-2");
      expect(name).toHaveClass("break-words");
      expect(name).toHaveClass("min-w-0");
      expect(name).not.toHaveClass("truncate");
      // The whole name on hover, when two lines cut it.
      expect(name).toHaveAttribute("title", name.textContent || "");
      // Its line is a flex row, so a short name keeps to the reading start.
      expect(name.parentElement).toHaveClass("flex");
    }
  });

  test("every agent connected: said so", () => {
    render(
      <CloudAiAgentOrganizationAccounts
        view={{
          ...VIEW,
          accounts: VIEW.accounts.map(
            (
              account: CloudOrganizationAccountView,
            ): CloudOrganizationAccountView => {
              return { ...account, agent: "connected" };
            },
          ),
        }}
      />,
    );

    const summary: HTMLElement = screen.getByTestId(
      "cloud-ai-agent-organization-accounts-summary",
    );

    expect(summary).toHaveAttribute("data-state", "connected");
    expect(summary).toHaveTextContent("2 of 2 accounts connected");
    expect(summary).toHaveTextContent(
      "Every account's agent is connected. Running the command again with other choices updates them all.",
    );
  });

  test("more accounts than listed: said with how many are", () => {
    render(
      <CloudAiAgentOrganizationAccounts
        view={{ ...VIEW, isTruncated: true }}
      />,
    );

    expect(
      screen.getByTestId("cloud-ai-agent-organization-accounts-truncated"),
    ).toHaveTextContent(
      "The organization has more accounts than this list shows: the first 2.",
    );
  });
});
