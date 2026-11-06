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
  CLOUD_AI_AGENT_KEY_NOTE,
  CLOUD_AI_AGENT_MAKING_KEY_TEXT,
  isCloudAiAgentKeyFailureRetryable,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetup";
import { getResourceAiAgentDescriptor } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { buildCloudAiAgentKey } from "../../../Types/CloudConnection/CloudAiAgentKey";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Let AI fix problems on a cloud account, drawn for real, with the key
 * made for the account's Cloud AI agent (POST /resource-ai-access/agent-key)
 * instead of the project's telemetry ingestion key:
 *
 *   - the key is asked for as the dialog opens, for this account, once per
 *     opening; while it is made the step says so, and no command is written
 *     until it is there;
 *   - the command (and the variables to run the agent elsewhere) hold it,
 *     with a line saying it is the agent's alone and works for a day;
 *   - a refusal (someone who may not set the agent up) is said where the
 *     command would be, alone: asking again never changes who may set the
 *     agent up. A failure that may pass (no answer, a server error) or an
 *     answer that is not this account's key is said there with Try again;
 *   - no ingestion key is asked for, picked or shown.
 *
 * The OneUptime address is an HTTPS one, as a real install's, so the
 * command is written.
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
const OTHER_ACCOUNT_ID: string = "30000000-0000-4000-8000-000000000002";
const KEY_ROUTE: string = "/resource-ai-access/agent-key";
const STATUS_ROUTE: string = "/resource-ai-access/status";

function keyOf(cloudAccountId: string, digit: string): string {
  return buildCloudAiAgentKey({
    cloudAccountId,
    secret: digit.repeat(64),
  });
}

type KeyAnswer = () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

let postSpy: jest.SpyInstance<any, any>;
let listSpy: jest.SpyInstance<any, any>;
let keyAnswers: Array<KeyAnswer> = [];

function answerKey(key: string): KeyAnswer {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      { agentKey: key, worksUntilConnectedBy: "2026-11-07T12:00:00.000Z" },
      {},
    );
  };
}

function keyPosts(): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(KEY_ROUTE);
    });
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/accounts/${CLOUD_ACCOUNT_ID}`);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  keyAnswers = [answerKey(keyOf(CLOUD_ACCOUNT_ID, "a"))];
  listSpy = getJestSpyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 10,
  });
  postSpy = getJestSpyOn(API, "post").mockImplementation(
    async (request: unknown): Promise<unknown> => {
      const url: string = String((request as JSONObject)["url"]);

      if (url.endsWith(KEY_ROUTE)) {
        const next: KeyAnswer | undefined =
          keyAnswers.length > 1 ? keyAnswers.shift() : keyAnswers[0];

        return next ? await next() : new HTTPResponse(200, {}, {});
      }

      if (url.endsWith(STATUS_ROUTE)) {
        return new HTTPResponse<JSONObject>(
          200,
          {
            resourceType: AiResourceType.AwsAccount,
            resourceId: CLOUD_ACCOUNT_ID,
            resourceName: "prod",
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
          ? "123456789012"
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

async function commandText(): Promise<string> {
  return (await screen.findByTestId("cloud-ai-agent-setup-command"))
    .textContent as string;
}

describe("the key the setup command holds", () => {
  test.each([CloudProvider.AWS, CloudProvider.Azure, CloudProvider.GCP])(
    "%s: made as the dialog opens, for this account, and the command holds it",
    async (provider: CloudProvider) => {
      openDialog(provider);

      const command: string = await commandText();

      expect(command).toContain(keyOf(CLOUD_ACCOUNT_ID, "a"));
      expect(keyPosts()).toHaveLength(1);
      expect(keyPosts()[0]!["data"]).toEqual({
        resourceType:
          provider === CloudProvider.AWS
            ? AiResourceType.AwsAccount
            : provider === CloudProvider.Azure
              ? AiResourceType.AzureSubscription
              : AiResourceType.GoogleCloudProject,
        resourceId: CLOUD_ACCOUNT_ID,
      });
      // What the key is, under the command.
      expect(
        screen.getByTestId("cloud-ai-agent-setup-key-note"),
      ).toHaveTextContent(CLOUD_AI_AGENT_KEY_NOTE);
      expect(CLOUD_AI_AGENT_KEY_NOTE).toBe(
        "The command holds a key made for this agent alone. Run it within a day, or open this dialog again for a new one.",
      );
    },
  );

  test("no ingestion key is asked for, picked or shown", async () => {
    openDialog();
    await commandText();

    expect(screen.queryByText(/Choose an ingestion key/)).toBeNull();
    expect(screen.queryByTestId("cloud-ai-agent-setup-key")).toBeNull();
    expect(
      listSpy.mock.calls.filter((call: Array<unknown>): boolean => {
        return (
          ((call[0] || {}) as { modelType?: { name?: string } }).modelType
            ?.name === "TelemetryIngestionKey"
        );
      }),
    ).toHaveLength(0);
    // Two steps: run it, and wait for it.
    expect(
      within(screen.getByTestId("setup-guide-steps")).getAllByRole("heading"),
    ).toHaveLength(2);
  });

  test("while the key is made: the step says so, and no command is written", async () => {
    let answer: (value: HTTPResponse<JSONObject>) => void = (): void => {
      // replaced below
    };

    keyAnswers = [
      (): Promise<HTTPResponse<JSONObject>> => {
        return new Promise(
          (resolve: (value: HTTPResponse<JSONObject>) => void) => {
            answer = resolve;
          },
        );
      },
    ];
    openDialog();

    const making: HTMLElement = await screen.findByTestId(
      "cloud-ai-agent-setup-making-key",
    );

    expect(making).toHaveTextContent(CLOUD_AI_AGENT_MAKING_KEY_TEXT);
    expect(making).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("cloud-ai-agent-setup-command")).toBeNull();
    expect(screen.queryByTestId("cloud-ai-agent-setup-key-note")).toBeNull();

    await act(async () => {
      answer(
        new HTTPResponse<JSONObject>(
          200,
          { agentKey: keyOf(CLOUD_ACCOUNT_ID, "b") },
          {},
        ),
      );
    });

    expect(await commandText()).toContain(keyOf(CLOUD_ACCOUNT_ID, "b"));
    expect(screen.queryByTestId("cloud-ai-agent-setup-making-key")).toBeNull();
  });

  test.each([400, 401, 403, 404, 422])(
    "a refusal (%s) is said where the command would be, alone: asking again never changes who may set the agent up",
    async (status: number) => {
      keyAnswers = [
        async (): Promise<HTTPErrorResponse> => {
          return new HTTPErrorResponse(
            status,
            {
              message:
                "You need permission to edit this AWS account to set up its Cloud AI agent.",
            },
            {},
          );
        },
        answerKey(keyOf(CLOUD_ACCOUNT_ID, "c")),
      ];
      openDialog();

      expect(
        await screen.findByTestId("cloud-ai-agent-setup-problem"),
      ).toHaveTextContent(
        "You need permission to edit this AWS account to set up its Cloud AI agent.",
      );
      expect(screen.queryByTestId("cloud-ai-agent-setup-command")).toBeNull();
      expect(
        screen.queryByTestId("cloud-ai-agent-setup-key-try-again"),
      ).toBeNull();
      expect(screen.queryByTestId("cloud-ai-agent-setup-key-note")).toBeNull();
      expect(keyPosts()).toHaveLength(1);
    },
  );

  test.each([500, 502, 503, 504, 408, 429])(
    "a failure that may pass (%s) is said where the command would be, and Try again asks once more",
    async (status: number) => {
      const failure: HTTPErrorResponse = new HTTPErrorResponse(
        status,
        { message: "OneUptime could not make the key just now." },
        {},
      );

      keyAnswers = [
        async (): Promise<HTTPErrorResponse> => {
          return failure;
        },
        answerKey(keyOf(CLOUD_ACCOUNT_ID, "c")),
      ];
      openDialog();

      // Said as every failed request is (a gateway's in words of its own).
      expect(
        await screen.findByTestId("cloud-ai-agent-setup-problem"),
      ).toHaveTextContent(API.getFriendlyMessage(failure));
      expect(screen.queryByTestId("cloud-ai-agent-setup-command")).toBeNull();

      fireEvent.click(screen.getByTestId("cloud-ai-agent-setup-key-try-again"));

      expect(await commandText()).toContain(keyOf(CLOUD_ACCOUNT_ID, "c"));
      expect(keyPosts()).toHaveLength(2);
      // Made, the problem and its Try again are gone.
      expect(screen.queryByTestId("cloud-ai-agent-setup-problem")).toBeNull();
      expect(
        screen.queryByTestId("cloud-ai-agent-setup-key-try-again"),
      ).toBeNull();
    },
  );

  test("which failures Try again is offered for: everything but a refusal", () => {
    // No answer at all: a network failure.
    expect(isCloudAiAgentKeyFailureRetryable(-1)).toBe(true);
    expect(isCloudAiAgentKeyFailureRetryable(0)).toBe(true);
    // A timeout, too many requests, a server or a gateway that failed.
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect({
        status,
        retry: isCloudAiAgentKeyFailureRetryable(status),
      }).toEqual({ status, retry: true });
    }
    // A refusal says the same every time.
    for (const status of [400, 401, 403, 404, 405, 409, 410, 422]) {
      expect({
        status,
        retry: isCloudAiAgentKeyFailureRetryable(status),
      }).toEqual({ status, retry: false });
    }
  });

  test("an answer that is not this account's key writes no command", async () => {
    keyAnswers = [answerKey(keyOf(OTHER_ACCOUNT_ID, "d"))];
    openDialog();

    expect(
      await screen.findByTestId("cloud-ai-agent-setup-problem"),
    ).toHaveTextContent(
      "OneUptime did not send a key for this agent. Try again.",
    );
    expect(screen.queryByTestId("cloud-ai-agent-setup-command")).toBeNull();
    expect(
      screen.getByTestId("cloud-ai-agent-setup-key-try-again"),
    ).toBeInTheDocument();
  });

  test("a network failure is said too, with Try again", async () => {
    keyAnswers = [
      async (): Promise<never> => {
        throw new Error("Network Error");
      },
    ];
    openDialog();

    expect(
      await screen.findByTestId("cloud-ai-agent-setup-problem"),
    ).toHaveTextContent("Network Error");
    expect(
      screen.getByTestId("cloud-ai-agent-setup-key-try-again"),
    ).toBeInTheDocument();
  });

  test("running it elsewhere: the agent's own key, and no ingestion key", async () => {
    openDialog();
    await commandText();

    fireEvent.click(screen.getByRole("button", { name: /More fields/ }));

    const dialog: HTMLElement = screen.getByTestId("cloud-ai-agent-setup");

    expect(dialog).toHaveTextContent(
      `ONEUPTIME_AI_AGENT_KEY=${keyOf(CLOUD_ACCOUNT_ID, "a")}`,
    );
    expect(dialog).not.toHaveTextContent("ONEUPTIME_TELEMETRY_INGESTION_KEY");
  });
});
