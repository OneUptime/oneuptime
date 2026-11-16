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
} from "@testing-library/react";
import * as React from "react";
import CloudAiAgentSetupModal from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetupModal";
import { getResourceAiAgentDescriptor } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { buildCloudAiAgentKey } from "../../../Types/CloudConnection/CloudAiAgentKey";
import { getCloudAiAgentMaxProtectedTargets } from "../../../Types/CloudConnection/CloudAiAgentSetupCommands";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  FIELD_ERROR_COLOR_CLASS_NAME,
  FIELD_ERROR_TEST_ID,
} from "../../../UI/Components/Forms/Fields/FieldError";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Let AI fix problems -> More fields -> Resources AI must never change, with
 * a pattern the agent cannot read or more patterns than it takes: the
 * command and the variables to run the agent elsewhere go away, because
 * neither may be written from them. The reason is said under the box that
 * holds it, where it can be fixed - a field's error line (FieldError) the
 * box names (aria-invalid, aria-describedby) - and still in step 1, where
 * the command was. The box sits under More fields, so a reader typing there
 * saw no word of why the command went away (#6212).
 *
 * The reason does not wait for the agent's key: the box is checked as it is
 * typed in, whatever step 1 is doing.
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
const AWS_ACCOUNT_ID: string = "123456789012";
const KEY_ROUTE: string = "/resource-ai-access/agent-key";
const STATUS_ROUTE: string = "/resource-ai-access/status";
const ERROR_TEST_ID: string = "cloud-ai-agent-setup-protected-error";
const BOX_TEST_ID: string = "cloud-ai-agent-setup-protected";
const UNREADABLE_REASON: string =
  "prod db is not a pattern the agent can read: write a resource's id, with * for any run of characters, and no spaces or quotes.";

const KEY: string = buildCloudAiAgentKey({
  cloudAccountId: CLOUD_ACCOUNT_ID,
  secret: "a".repeat(64),
});

// How the key route answers: at once with the key, or never (still being made).
let keyAnswer: "key" | "pending" = "key";

beforeEach(() => {
  keyAnswer = "key";
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
  getJestSpyOn(API, "post").mockImplementation(
    async (request: unknown): Promise<unknown> => {
      const url: string = String((request as JSONObject)["url"]);

      if (url.endsWith(KEY_ROUTE)) {
        if (keyAnswer === "pending") {
          return new Promise<never>(() => {
            // never answered: the key is still being made
          });
        }

        return new HTTPResponse<JSONObject>(200, { agentKey: KEY }, {});
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

function openDialog(): void {
  render(
    <CloudAiAgentSetupModal
      descriptor={getResourceAiAgentDescriptor(AiResourceType.AwsAccount)}
      cloudAccountId={new ObjectID(CLOUD_ACCOUNT_ID)}
      provider={CloudProvider.AWS}
      accountId={AWS_ACCOUNT_ID}
      isAiLogReadEnabled={false}
      status={null}
      onClose={() => {
        // closed by the test's cleanup
      }}
    />,
  );
}

function protectedBox(): HTMLTextAreaElement {
  return screen.getByTestId(BOX_TEST_ID) as HTMLTextAreaElement;
}

async function type(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(protectedBox(), { target: { value: text } });
  });
}

describe("a protected resource the agent cannot take, said under its box", () => {
  test("a fresh dialog: no error line, and the box is not marked", async () => {
    openDialog();
    await screen.findByTestId("cloud-ai-agent-setup-command");

    expect(screen.queryByTestId(ERROR_TEST_ID)).toBeNull();
    expect(protectedBox()).not.toHaveAttribute("aria-invalid");
    expect(protectedBox()).not.toHaveAttribute("aria-describedby");
  });

  test("a pattern the agent cannot read: its reason under the box, which names the line - and step 1 still says it", async () => {
    openDialog();
    await screen.findByTestId("cloud-ai-agent-setup-command");
    await type("*prod-db*\nprod db");

    const line: HTMLElement = screen.getByTestId(ERROR_TEST_ID);

    expect(line).toHaveTextContent(UNREADABLE_REASON);
    // The box says it is in error, and which line says why.
    expect(protectedBox()).toHaveAttribute("aria-invalid", "true");
    expect(protectedBox().getAttribute("aria-describedby")).toBe(line.id);
    expect(line.id).not.toBe("");
    // Right under the box, inside the same field.
    expect(line.previousElementSibling).toBe(protectedBox());
    // Step 1 says it too, where the command was: neither is written.
    expect(
      screen.getByTestId("cloud-ai-agent-setup-problem"),
    ).toHaveTextContent(UNREADABLE_REASON);
    expect(screen.queryByTestId("cloud-ai-agent-setup-command")).toBeNull();
    expect(screen.queryByText(/ONEUPTIME_AI_PROTECTED_TARGETS=/)).toBeNull();
  });

  test("drawn as a field's error is: FieldError's red, said politely as it is typed", async () => {
    openDialog();
    await screen.findByTestId("cloud-ai-agent-setup-command");
    await type("prod db");

    const line: HTMLElement = screen.getByTestId(ERROR_TEST_ID);

    expect(line.tagName).toBe("P");
    expect(line.className).toContain(FIELD_ERROR_COLOR_CLASS_NAME);
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).not.toHaveAttribute("role");
    // Its own test id, not the one every form field's error line shares.
    expect(screen.queryByTestId(FIELD_ERROR_TEST_ID)).toBeNull();
    // The box is drawn in error, as the shared text area draws one.
    expect(protectedBox().className).toContain("border-red-300");
    expect(protectedBox().className).not.toContain("border-gray-300");
  });

  test("more patterns than the agent takes: how many it takes, under the box", async () => {
    const most: number = getCloudAiAgentMaxProtectedTargets(
      CloudProvider.AWS,
      AWS_ACCOUNT_ID,
    );

    openDialog();
    await screen.findByTestId("cloud-ai-agent-setup-command");
    await type(
      Array.from({ length: most + 1 }, (_: unknown, index: number): string => {
        return `*prod-${index}*`;
      }).join("\n"),
    );

    const reason: string = `List at most ${most} protected resources, with * patterns to cover several.`;

    expect(screen.getByTestId(ERROR_TEST_ID)).toHaveTextContent(reason);
    expect(
      screen.getByTestId("cloud-ai-agent-setup-problem"),
    ).toHaveTextContent(reason);
    expect(protectedBox()).toHaveAttribute("aria-invalid", "true");
  });

  test("as many as it takes is no error", async () => {
    const most: number = getCloudAiAgentMaxProtectedTargets(
      CloudProvider.AWS,
      AWS_ACCOUNT_ID,
    );

    openDialog();
    await screen.findByTestId("cloud-ai-agent-setup-command");
    await type(
      Array.from({ length: most }, (_: unknown, index: number): string => {
        return `*prod-${index}*`;
      }).join("\n"),
    );

    expect(screen.queryByTestId(ERROR_TEST_ID)).toBeNull();
    expect(
      screen.getByTestId("cloud-ai-agent-setup-command"),
    ).toBeInTheDocument();
  });

  test("fixed: the line goes, the box is no longer marked, and the command comes back with the patterns", async () => {
    openDialog();
    await screen.findByTestId("cloud-ai-agent-setup-command");
    await type("prod db");

    expect(screen.getByTestId(ERROR_TEST_ID)).toBeInTheDocument();

    await type("*prod-db*");

    expect(screen.queryByTestId(ERROR_TEST_ID)).toBeNull();
    expect(protectedBox()).not.toHaveAttribute("aria-invalid");
    expect(protectedBox()).not.toHaveAttribute("aria-describedby");
    expect(protectedBox().className).toContain("border-gray-300");
    expect(
      (await screen.findByTestId("cloud-ai-agent-setup-command")).textContent,
    ).toContain("*prod-db*");
    expect(
      screen.getByText(/ONEUPTIME_AI_PROTECTED_TARGETS=\*prod-db\*/),
    ).toBeInTheDocument();
  });

  test("said while the key is still being made: the box is checked as it is typed in, whatever step 1 is doing", async () => {
    keyAnswer = "pending";
    openDialog();
    await screen.findByTestId("cloud-ai-agent-setup-making-key");
    await type("prod db");

    expect(screen.getByTestId(ERROR_TEST_ID)).toHaveTextContent(
      UNREADABLE_REASON,
    );
    // Step 1 still says what it is doing: making the key.
    expect(
      screen.getByTestId("cloud-ai-agent-setup-making-key"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-ai-agent-setup-problem")).toBeNull();
  });
});
