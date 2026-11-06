import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import CloudAiAgentSetupModal from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetupModal";
import {
  CLOUD_AI_AGENT_ORGANIZATION_KEY_NOTE,
  CLOUD_AI_AGENT_ORGANIZATION_MAKING_KEYS_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentOrganization";
import { getResourceAiAgentDescriptor } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { buildCloudAiAgentKey } from "../../../Types/CloudConnection/CloudAiAgentKey";
import {
  CloudOrganizationAccountView,
  CloudOrganizationView,
} from "../../../Types/CloudConnection/CloudOrganizationAgents";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { AWS_CLOUD_AI_AGENT_STACK_SET_NAME } from "../../../Types/ResourceAiAgent/CloudAiAgentNames";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Let AI fix problems on an AWS account of an AWS Organization, drawn for
 * real (CloudAiAgentSetupModal + CloudAiAgentOrganization):
 *
 *   - the organization is read as the dialog opens (POST /resource-ai-
 *     access/organization) - for AWS only - and "Which accounts?" is asked
 *     only for an account of one with more accounts than this one;
 *   - "Every account of the organization" asks once for every account's
 *     key (POST /resource-ai-access/organization-agent-keys), says so while
 *     they are made, and writes one command for the management account,
 *     with each account's own key in it and nothing written before they
 *     are there;
 *   - the accounts no key was made for are named; a refusal is said
 *     alone, a failure that may pass with Try again;
 *   - the last step lists every account and whether its agent connected.
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

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    HOST: "oneuptime.example.com",
    HTTP_PROTOCOL: "https",
  };
});

const CLOUD_ACCOUNT_ID: string = "30000000-0000-4000-8000-000000000001";
const CLOUD_MANAGEMENT: string = "30000000-0000-4000-8000-000000000010";
const CLOUD_SANDBOX: string = "30000000-0000-4000-8000-000000000011";
const CLOUD_LOCKED: string = "30000000-0000-4000-8000-000000000012";
const MANAGEMENT: string = "111111111111";
const ACCOUNT: string = "123456789012";

const KEY_ROUTE: string = "/resource-ai-access/agent-key";
const STATUS_ROUTE: string = "/resource-ai-access/status";
const ORGANIZATION_ROUTE: string = "/resource-ai-access/organization";
const ORGANIZATION_KEYS_ROUTE: string =
  "/resource-ai-access/organization-agent-keys";

function keyOf(cloudAccountId: string, digit: string): string {
  return buildCloudAiAgentKey({
    cloudAccountId,
    secret: digit.repeat(64),
  });
}

const ORGANIZATION: CloudOrganizationView = {
  isOrganization: true,
  managementAccountId: MANAGEMENT,
  accounts: [
    {
      cloudAccountId: CLOUD_MANAGEMENT,
      accountId: MANAGEMENT,
      name: "Management",
      isManagementAccount: true,
      agent: "connected",
      lastSeenAt: "2026-11-06T11:59:00.000Z",
    },
    {
      cloudAccountId: CLOUD_ACCOUNT_ID,
      accountId: ACCOUNT,
      name: "Payments",
      isManagementAccount: false,
      agent: "none",
      lastSeenAt: null,
    },
    {
      cloudAccountId: CLOUD_SANDBOX,
      accountId: "222222222222",
      name: "Sandbox",
      isManagementAccount: false,
      agent: "offline",
      lastSeenAt: "2026-11-05T11:59:00.000Z",
    },
  ],
  isTruncated: false,
};

const KEYS: JSONObject = {
  managementAccountId: MANAGEMENT,
  keys: [
    {
      cloudAccountId: CLOUD_MANAGEMENT,
      accountId: MANAGEMENT,
      name: "Management",
      agentKey: keyOf(CLOUD_MANAGEMENT, "1"),
      worksUntilConnectedBy: "2026-11-07T12:00:00.000Z",
    },
    {
      cloudAccountId: CLOUD_ACCOUNT_ID,
      accountId: ACCOUNT,
      name: "Payments",
      agentKey: keyOf(CLOUD_ACCOUNT_ID, "2"),
      worksUntilConnectedBy: "2026-11-07T12:00:00.000Z",
    },
    {
      cloudAccountId: CLOUD_SANDBOX,
      accountId: "222222222222",
      name: "Sandbox",
      agentKey: keyOf(CLOUD_SANDBOX, "3"),
      worksUntilConnectedBy: "2026-11-07T12:00:00.000Z",
    },
  ],
  skipped: [],
};

type Answer = () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

let postSpy: jest.SpyInstance<any, any>;
let organizationAnswer: JSONObject;
let organizationKeyAnswers: Array<Answer>;

function answer(data: JSONObject): Answer {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, data, {});
  };
}

function postsTo(route: string): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(route);
    });
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/accounts/${CLOUD_ACCOUNT_ID}`);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 10,
  });
  organizationAnswer = ORGANIZATION as unknown as JSONObject;
  organizationKeyAnswers = [answer(KEYS)];
  postSpy = getJestSpyOn(API, "post").mockImplementation(
    async (request: unknown): Promise<unknown> => {
      const url: string = String((request as JSONObject)["url"]);

      if (url.endsWith(ORGANIZATION_KEYS_ROUTE)) {
        const next: Answer | undefined =
          organizationKeyAnswers.length > 1
            ? organizationKeyAnswers.shift()
            : organizationKeyAnswers[0];

        return next ? await next() : new HTTPResponse(200, {}, {});
      }

      if (url.endsWith(ORGANIZATION_ROUTE)) {
        return new HTTPResponse<JSONObject>(200, organizationAnswer, {});
      }

      if (url.endsWith(KEY_ROUTE)) {
        return new HTTPResponse<JSONObject>(
          200,
          { agentKey: keyOf(CLOUD_ACCOUNT_ID, "a") },
          {},
        );
      }

      if (url.endsWith(STATUS_ROUTE)) {
        return new HTTPResponse<JSONObject>(
          200,
          {
            resourceType: AiResourceType.AwsAccount,
            resourceId: CLOUD_ACCOUNT_ID,
            resourceName: "Payments",
            isAiInvestigationEnabled: true,
            aiRemediationMode: "Disabled",
            aiCommandAllowlist: [],
            agent: null,
            gaps: [],
            isInvestigationReady: true,
            isRemediationReady: false,
          },
          {},
        );
      }

      return new HTTPResponse(200, {}, {});
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function openDialog(provider: CloudProvider = CloudProvider.AWS): void {
  const type: AiResourceType =
    provider === CloudProvider.AWS
      ? AiResourceType.AwsAccount
      : provider === CloudProvider.Azure
        ? AiResourceType.AzureSubscription
        : AiResourceType.GoogleCloudProject;

  render(
    <CloudAiAgentSetupModal
      descriptor={getResourceAiAgentDescriptor(type)}
      cloudAccountId={new ObjectID(CLOUD_ACCOUNT_ID)}
      provider={provider}
      accountId={
        provider === CloudProvider.AWS
          ? ACCOUNT
          : provider === CloudProvider.Azure
            ? "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"
            : "shop-prod-1234"
      }
      isAiLogReadEnabled={false}
      status={null}
      onClose={() => {
        // closed by the test's cleanup
      }}
    />,
  );
}

async function chooseEveryAccount(): Promise<void> {
  fireEvent.click(await screen.findByTestId("setup-guide-option-organization"));
}

async function organizationCommand(): Promise<string> {
  return (
    await screen.findByTestId("cloud-ai-agent-setup-organization-command")
  ).textContent as string;
}

describe("which accounts the agent is set up in", () => {
  test("an account of an organization is asked, and this account is the answer until another is chosen", async () => {
    openDialog();

    const scope: HTMLElement = await screen.findByTestId(
      "cloud-ai-agent-setup-scope",
    );

    expect(scope).toHaveTextContent("Which accounts?");
    expect(
      within(scope).getByTestId("setup-guide-option-account"),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(scope).getByTestId("setup-guide-option-account"),
    ).toHaveTextContent(`One agent, in AWS account ${ACCOUNT}.`);
    // Two short answers: what each agent is given is the command step's to say.
    expect(
      within(scope).getByTestId("setup-guide-option-organization"),
    ).toHaveTextContent(
      "An agent in each of its 3 accounts, from one command in the management account.",
    );

    // This account's own command, and no organization's keys asked for.
    expect(
      await screen.findByTestId("cloud-ai-agent-setup-command"),
    ).toHaveTextContent(keyOf(CLOUD_ACCOUNT_ID, "a"));
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "to let OneUptime AI fix problems here: it creates the agent's role",
    );
    expect(postsTo(ORGANIZATION_KEYS_ROUTE)).toHaveLength(0);
    expect(postsTo(ORGANIZATION_ROUTE)[0]!["data"]).toEqual({
      resourceType: AiResourceType.AwsAccount,
      resourceId: CLOUD_ACCOUNT_ID,
    });
  });

  test("an account outside any organization is not asked", async () => {
    organizationAnswer = {
      isOrganization: false,
      managementAccountId: null,
      accounts: [],
      isTruncated: false,
    };
    openDialog();

    await screen.findByTestId("cloud-ai-agent-setup-command");
    expect(screen.queryByTestId("cloud-ai-agent-setup-scope")).toBeNull();
  });

  test("an organization the reader sees only this account of is not asked", async () => {
    organizationAnswer = {
      ...ORGANIZATION,
      accounts: [ORGANIZATION.accounts[1]!],
    } as unknown as JSONObject;
    openDialog();

    await screen.findByTestId("cloud-ai-agent-setup-command");
    expect(screen.queryByTestId("cloud-ai-agent-setup-scope")).toBeNull();
  });

  test.each([CloudProvider.Azure, CloudProvider.GCP])(
    "%s: no organization is read, and nothing is asked",
    async (provider: CloudProvider) => {
      openDialog(provider);

      await screen.findByTestId("cloud-ai-agent-setup-command");
      expect(postsTo(ORGANIZATION_ROUTE)).toHaveLength(0);
      expect(screen.queryByTestId("cloud-ai-agent-setup-scope")).toBeNull();
    },
  );
});

describe("every account of the organization", () => {
  test("one command for the management account, each account with its own key", async () => {
    openDialog();
    await chooseEveryAccount();

    const command: string = await organizationCommand();

    for (const key of KEYS["keys"] as Array<JSONObject>) {
      expect(command.split(String(key["agentKey"])).length - 1).toBe(1);
    }
    expect(command).toContain(AWS_CLOUD_AI_AGENT_STACK_SET_NAME);
    expect(command).toContain(`if [ "$ACCOUNT" != ${MANAGEMENT} ]; then`);
    // The single account's command is not shown beside it.
    expect(screen.queryByTestId("cloud-ai-agent-setup-command")).toBeNull();
    expect(postsTo(ORGANIZATION_KEYS_ROUTE)).toHaveLength(1);
    expect(postsTo(ORGANIZATION_KEYS_ROUTE)[0]!["data"]).toEqual({
      resourceType: AiResourceType.AwsAccount,
      resourceId: CLOUD_ACCOUNT_ID,
    });

    // The dialog says what it does now: every account, each agent's role.
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Run one command in AWS CloudShell to let OneUptime AI fix problems in every account of the organization. Each account's agent connects on its own.",
    );

    const steps: HTMLElement = screen.getByTestId("setup-guide-steps");

    expect(steps).toHaveTextContent(
      `Run this in AWS CloudShell, in the management account ${MANAGEMENT}`,
    );
    // Who runs it, and what every account's agent is given.
    expect(steps).toHaveTextContent(
      "Run it as someone who may create StackSets and roles in the management account. Each account's agent gets the same least-privilege role and a key of its own.",
    );
    expect(steps).toHaveTextContent("Wait for them to connect");
    expect(
      screen.getByTestId("cloud-ai-agent-setup-organization-key-note"),
    ).toHaveTextContent(CLOUD_AI_AGENT_ORGANIZATION_KEY_NOTE);
    expect(
      screen.getByTestId("cloud-ai-agent-setup-organization-cost"),
    ).toHaveTextContent("in each account");
  });

  test("the keys are asked for once: back to this account and again keeps them", async () => {
    openDialog();
    await chooseEveryAccount();
    await organizationCommand();

    fireEvent.click(screen.getByTestId("setup-guide-option-account"));
    expect(
      await screen.findByTestId("cloud-ai-agent-setup-command"),
    ).toBeInTheDocument();

    await chooseEveryAccount();
    await organizationCommand();
    expect(postsTo(ORGANIZATION_KEYS_ROUTE)).toHaveLength(1);
  });

  test("while the keys are made, the step says so, and no command is written", async () => {
    let resolve: (value: HTTPResponse<JSONObject>) => void = (): void => {
      // replaced below
    };

    organizationKeyAnswers = [
      (): Promise<HTTPResponse<JSONObject>> => {
        return new Promise(
          (done: (value: HTTPResponse<JSONObject>) => void) => {
            resolve = done;
          },
        );
      },
    ];
    openDialog();
    await chooseEveryAccount();

    const making: HTMLElement = await screen.findByTestId(
      "cloud-ai-agent-setup-making-organization-keys",
    );

    expect(making).toHaveTextContent(
      CLOUD_AI_AGENT_ORGANIZATION_MAKING_KEYS_TEXT,
    );
    expect(making).toHaveAttribute("role", "status");
    expect(
      screen.queryByTestId("cloud-ai-agent-setup-organization-command"),
    ).toBeNull();

    await act(async () => {
      resolve(new HTTPResponse<JSONObject>(200, KEYS, {}));
    });

    expect(await organizationCommand()).toContain(keyOf(CLOUD_SANDBOX, "3"));
  });

  test("an account the command leaves out reads Skipped in the list, not Waiting", async () => {
    // Sandbox has no agent, and the command leaves it out.
    const view: CloudOrganizationView = {
      ...ORGANIZATION,
      accounts: ORGANIZATION.accounts.map(
        (
          account: CloudOrganizationAccountView,
        ): CloudOrganizationAccountView => {
          return account.cloudAccountId === CLOUD_SANDBOX
            ? { ...account, agent: "none", lastSeenAt: null }
            : account;
        },
      ),
    };

    organizationAnswer = view as unknown as JSONObject;
    organizationKeyAnswers = [
      answer({
        ...KEYS,
        keys: (KEYS["keys"] as Array<JSONObject>).slice(0, 2),
        skipped: [
          {
            cloudAccountId: CLOUD_SANDBOX,
            accountId: "222222222222",
            name: "Sandbox",
            reason: "You need permission to edit this AWS account.",
          },
        ],
      }),
    ];
    openDialog();
    await chooseEveryAccount();
    await organizationCommand();

    const sandbox: HTMLElement = screen
      .getAllByTestId("cloud-ai-agent-organization-accounts-account")
      .find((row: HTMLElement): boolean => {
        return row.getAttribute("data-account") === "222222222222";
      })!;

    expect(sandbox).toHaveAttribute("data-skipped", "true");
    expect(sandbox).toHaveTextContent("Skipped");
    expect(sandbox).not.toHaveTextContent("Waiting");
  });

  test("the accounts no key was made for are named, and left out of the command", async () => {
    organizationKeyAnswers = [
      answer({
        ...KEYS,
        keys: (KEYS["keys"] as Array<JSONObject>).slice(0, 2),
        skipped: [
          {
            cloudAccountId: CLOUD_LOCKED,
            accountId: "333333333333",
            name: "Locked",
            reason: "You need permission to edit this AWS account.",
          },
        ],
      }),
    ];
    openDialog();
    await chooseEveryAccount();

    const command: string = await organizationCommand();
    const skipped: HTMLElement = screen.getByTestId(
      "cloud-ai-agent-setup-organization-skipped",
    );

    expect(skipped).toHaveTextContent(
      "The command leaves out 1 account you may not edit: no key was made for its agent.",
    );
    expect(skipped).toHaveTextContent("Locked (333333333333)");
    expect(command).not.toContain("333333333333");
  });

  test("a refusal is said where the command would be, alone", async () => {
    organizationKeyAnswers = [
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(
          403,
          {
            message:
              "You need permission to change OneUptime AI's access to set up this AWS account's Cloud AI agent.",
          },
          {},
        );
      },
    ];
    openDialog();
    await chooseEveryAccount();

    expect(
      await screen.findByTestId("cloud-ai-agent-setup-organization-problem"),
    ).toHaveTextContent(
      "You need permission to change OneUptime AI's access to set up this AWS account's Cloud AI agent.",
    );
    expect(
      screen.queryByTestId("cloud-ai-agent-setup-organization-keys-try-again"),
    ).toBeNull();
    expect(
      screen.queryByTestId("cloud-ai-agent-setup-organization-command"),
    ).toBeNull();
  });

  test("a failure that may pass is said with Try again, which asks once more", async () => {
    organizationKeyAnswers = [
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(
          503,
          { message: "OneUptime could not make the keys just now." },
          {},
        );
      },
      answer(KEYS),
    ];
    openDialog();
    await chooseEveryAccount();

    await screen.findByTestId("cloud-ai-agent-setup-organization-problem");
    fireEvent.click(
      screen.getByTestId("cloud-ai-agent-setup-organization-keys-try-again"),
    );

    expect(await organizationCommand()).toContain(keyOf(CLOUD_MANAGEMENT, "1"));
    expect(postsTo(ORGANIZATION_KEYS_ROUTE)).toHaveLength(2);
  });

  test("an answer with no keys is said with Try again", async () => {
    organizationKeyAnswers = [answer({ keys: [] })];
    openDialog();
    await chooseEveryAccount();

    expect(
      await screen.findByTestId("cloud-ai-agent-setup-organization-problem"),
    ).toHaveTextContent(
      "OneUptime did not send the accounts' keys. Try again.",
    );
    expect(
      screen.getByTestId("cloud-ai-agent-setup-organization-keys-try-again"),
    ).toBeInTheDocument();
  });

  test("a key that is not its account's own is never written", async () => {
    organizationKeyAnswers = [
      answer({
        ...KEYS,
        keys: [
          ...(KEYS["keys"] as Array<JSONObject>).slice(0, 2),
          {
            ...(KEYS["keys"] as Array<JSONObject>)[2],
            // The management account's key, given as the sandbox's.
            agentKey: keyOf(CLOUD_MANAGEMENT, "9"),
          },
        ],
      }),
    ];
    openDialog();
    await chooseEveryAccount();

    const command: string = await organizationCommand();

    expect(command).not.toContain(keyOf(CLOUD_MANAGEMENT, "9"));
    expect(command).not.toContain("222222222222 ");
  });

  test("the last step lists each account and whether its agent connected", async () => {
    openDialog();
    await chooseEveryAccount();
    await organizationCommand();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-ai-agent-organization-accounts-account",
    );

    expect(
      rows.map((row: HTMLElement): [string | null, string | null] => {
        return [
          row.getAttribute("data-account"),
          row.getAttribute("data-state"),
        ];
      }),
    ).toEqual([
      [MANAGEMENT, "connected"],
      [ACCOUNT, "none"],
      ["222222222222", "offline"],
    ]);
    expect(rows[0]).toHaveTextContent("Management account");
    expect(rows[0]).toHaveTextContent("Connected");
    expect(rows[1]).toHaveTextContent("Waiting");
    expect(rows[2]).toHaveTextContent("Offline");
    // The account the dialog was opened on is marked, and only it.
    expect(
      screen.getAllByTestId(
        "cloud-ai-agent-organization-accounts-this-account",
      ),
    ).toHaveLength(1);
    expect(
      within(rows[1]!).getByTestId(
        "cloud-ai-agent-organization-accounts-this-account",
      ),
    ).toHaveTextContent("This account");
    // A short list shows whole: the dialog scrolls, not a frame inside it.
    expect(
      screen.getByTestId("cloud-ai-agent-organization-accounts-list"),
    ).toHaveAttribute("data-scrolls", "false");
    expect(
      screen.getByTestId("cloud-ai-agent-organization-accounts-summary"),
    ).toHaveTextContent("1 of 3 accounts connected");
    // Where to look while some have not.
    expect(
      screen.getByTestId("cloud-ai-agent-setup-organization-instances-command"),
    ).toHaveTextContent("list-stack-instances");
    expect(
      screen.getByTestId("cloud-ai-agent-setup-organization-instances-command"),
    ).toHaveTextContent(
      "When an account does not connect, its stack says why. Run this in the management account:",
    );
  });
});
