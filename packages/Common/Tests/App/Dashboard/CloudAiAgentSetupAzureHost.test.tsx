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
import { estimateCloudAiAgentMonthlyCost } from "../../../Types/CloudConnection/CloudAiAgentCost";
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
 * Let AI fix problems on an Azure subscription -> More fields -> Where the
 * agent runs (#6212): a Container App, as before, or a small VM of its own
 * for a subscription that cannot use Container Apps. The choice writes its
 * host's command, says what that host costs, names itself on the folded
 * line once it is not the default, and points the logs line at the VM.
 * Google Cloud's picker is its own and is left as it was.
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
const SUBSCRIPTION_ID: string = "0b1f6471-1bf0-4dda-aec3-111122223333";
const KEY_ROUTE: string = "/resource-ai-access/agent-key";
const STATUS_ROUTE: string = "/resource-ai-access/status";

const KEY: string = buildCloudAiAgentKey({
  cloudAccountId: CLOUD_ACCOUNT_ID,
  secret: "b".repeat(64),
});

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
  getJestSpyOn(API, "post").mockImplementation(
    async (request: unknown): Promise<unknown> => {
      const url: string = String((request as JSONObject)["url"]);

      if (url.endsWith(KEY_ROUTE)) {
        return new HTTPResponse<JSONObject>(200, { agentKey: KEY }, {});
      }

      if (url.endsWith(STATUS_ROUTE)) {
        return new HTTPResponse<JSONObject>(
          200,
          {
            resourceType: AiResourceType.AzureSubscription,
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
      descriptor={getResourceAiAgentDescriptor(
        AiResourceType.AzureSubscription,
      )}
      cloudAccountId={new ObjectID(CLOUD_ACCOUNT_ID)}
      provider={CloudProvider.Azure}
      accountId={SUBSCRIPTION_ID}
      isAiLogReadEnabled={false}
      status={null}
      onClose={() => {
        // closed by the test's cleanup
      }}
    />,
  );
}

async function pick(host: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`cloud-ai-agent-setup-host-${host}`));
  });
}

function commandText(): string {
  return screen.getByTestId("cloud-ai-agent-setup-command")
    .textContent as string;
}

const CONTAINER_USD: number = estimateCloudAiAgentMonthlyCost(
  CloudProvider.Azure,
).usd;
const VM_USD: number = estimateCloudAiAgentMonthlyCost(
  CloudProvider.Azure,
  undefined,
  "virtual-machine",
).usd;

describe("where the Azure agent runs, under More fields", () => {
  test("a Container App by default: its command, its cost, nothing on the folded line", async () => {
    openDialog();
    await screen.findByTestId("cloud-ai-agent-setup-command");

    const picker: HTMLElement = screen.getByTestId(
      "cloud-ai-agent-setup-azure-host",
    );

    expect(picker).toHaveTextContent("Where the agent runs");
    expect(
      screen.getByTestId("cloud-ai-agent-setup-host-container-apps"),
    ).toBeChecked();
    expect(
      screen.getByTestId("cloud-ai-agent-setup-host-virtual-machine"),
    ).not.toBeChecked();
    expect(commandText()).toContain("az containerapp create");
    expect(commandText()).not.toContain("az vm create");
    expect(screen.getByTestId("cloud-ai-agent-setup-cost")).toHaveTextContent(
      `It runs one small always-on container in your account: about $${CONTAINER_USD} a month`,
    );
    // Each host says what it costs.
    expect(picker).toHaveTextContent(
      `One Container App with one replica always on: about $${CONTAINER_USD} a month.`,
    );
    expect(picker).toHaveTextContent(
      `One Standard_B1s VM in a network of its own that lets nothing in: about $${VM_USD} a month. For a subscription that cannot use Container Apps.`,
    );
    expect(
      screen.getByTestId("cloud-ai-agent-setup-more-fields"),
    ).not.toHaveTextContent("Runs on");
    // Google Cloud's picker is not Azure's.
    expect(screen.queryByTestId("cloud-ai-agent-setup-host")).toBeNull();
  });

  test("a small VM: the VM's command, its cost, its logs, and the folded line names it", async () => {
    openDialog();
    await screen.findByTestId("cloud-ai-agent-setup-command");
    await pick("virtual-machine");

    expect(
      screen.getByTestId("cloud-ai-agent-setup-host-virtual-machine"),
    ).toBeChecked();
    expect(commandText()).toContain("az vm create");
    expect(commandText()).not.toContain("az containerapp create");
    expect(commandText()).toContain(KEY);
    expect(screen.getByTestId("cloud-ai-agent-setup-cost")).toHaveTextContent(
      `It runs on one small always-on VM in your subscription: about $${VM_USD} a month at list prices, billed by your cloud.`,
    );
    expect(
      screen.getByTestId("cloud-ai-agent-setup-logs-command"),
    ).toHaveTextContent("az vm run-command invoke");

    const folded: HTMLElement = screen.getByTestId(
      "cloud-ai-agent-setup-more-fields",
    );

    expect(folded).toHaveTextContent("Runs on");
    expect(folded).toHaveTextContent("A small VM");
    // The VM's start script says where it runs, and so do the variables for running it elsewhere.
    expect(
      screen.getAllByText(/ONEUPTIME_AI_AZURE_HOST=virtual-machine/),
    ).toHaveLength(2);
  });

  test("back to a Container App: the Container App's command and logs again", async () => {
    openDialog();
    await screen.findByTestId("cloud-ai-agent-setup-command");
    await pick("virtual-machine");
    await pick("container-apps");

    expect(commandText()).toContain("az containerapp create");
    expect(
      screen.getByTestId("cloud-ai-agent-setup-logs-command"),
    ).toHaveTextContent("az containerapp logs show");
    expect(screen.queryByText(/ONEUPTIME_AI_AZURE_HOST=/)).toBeNull();
  });
});
