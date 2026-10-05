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
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import KubernetesAiAgentStatusSummaryCard, {
  KUBERNETES_AI_ACCESS_STATUS_ROUTE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatusSummaryCard";
import { AI_AGENT_STATUS_SUMMARY_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummaryCard";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * The "AI agent" card at the bottom of the cluster Overview, wired to the
 * server: it reads the cluster's status from the route the cluster's AI
 * agent page reads — POST /kubernetes-cluster/ai-access/status with
 * { clusterId }, which only needs read access to the cluster — once per
 * cluster and again on the Overview's refresh, and draws the Kubernetes AI
 * agent's connection, the "Investigate with kubectl" switch and the fixes
 * mode. A refused, failed or unreadable answer never fails the Overview.
 */

const WAIT_TIMEOUT: number = 20000;
const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);

function makeStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-east",
    clusterIdentifier: "prod-east",
    runner: {
      id: "99999999-0000-4000-8000-000000000009",
      name: KUBERNETES_AI_AGENT_DISPLAY_NAME,
      kind: "ai_agent",
      isOnline: true,
      canRunAiCommands: true,
    },
    accessMethod: "in_cluster",
    aiAgent: {
      id: "99999999-0000-4000-8000-000000000009",
      isOnline: true,
      connectionStatus: "connected",
    },
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Automatic,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

let postSpy: ReturnType<typeof jest.spyOn>;

function serve(answer: () => Promise<unknown>): void {
  postSpy.mockImplementation(answer);
}

function serveStatus(status: KubernetesClusterAiAccessStatus): void {
  serve(async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      status as unknown as JSONObject,
      {},
    );
  });
}

async function findBadge(
  row: "connection" | "investigation" | "fixes",
): Promise<string> {
  return (
    (
      await screen.findByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-${row}-badge`,
        {},
        { timeout: WAIT_TIMEOUT },
      )
    ).textContent || ""
  );
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function renderCard(props: { refreshToken?: number } = {}): RenderResult {
  return render(
    <KubernetesAiAgentStatusSummaryCard
      clusterId={CLUSTER_ID}
      refreshToken={props.refreshToken}
    />,
  );
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}`);
  postSpy = jest.spyOn(API, "post");
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the cluster Overview's AI agent card", () => {
  test("reads the cluster's status, once, from the route its AI agent page reads", async () => {
    serveStatus(makeStatus());
    renderCard();
    await findBadge("connection");

    expect(postSpy).toHaveBeenCalledTimes(1);
    const request: JSONObject = postSpy.mock.calls[0]![0] as JSONObject;
    expect(String(request["url"])).toMatch(
      new RegExp(`${KUBERNETES_AI_ACCESS_STATUS_ROUTE}$`),
    );
    expect(request["data"]).toEqual({ clusterId: CLUSTER_ID.toString() });
  });

  // The route the card names is the one the server serves.
  test("names the route the server serves the status on", () => {
    expect(KUBERNETES_AI_ACCESS_STATUS_ROUTE).toBe(
      "/kubernetes-cluster/ai-access/status",
    );
    expect(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../Server/API/KubernetesClusterAiAccessAPI.ts",
        ),
        "utf8",
      ),
    ).toContain(`"${KUBERNETES_AI_ACCESS_STATUS_ROUTE}"`);
  });

  test("shows the agent's connection, investigation with kubectl and the fixes mode", async () => {
    serveStatus(makeStatus());
    renderCard();

    expect(await findBadge("connection")).toBe("Connected");
    expect(await findBadge("investigation")).toBe("On");
    expect(await findBadge("fixes")).toBe("Automatic");
    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-value`),
    ).toHaveTextContent(
      `The ${KUBERNETES_AI_AGENT_DISPLAY_NAME} is connected.`,
    );
    expect(
      screen.getByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-investigation-value`,
      ),
    ).toHaveTextContent("AI may run read-only kubectl on this cluster");
  });

  /*
   * The Kubernetes AI agent's version, drawn with the shared AgentVersion
   * (the chart's kind of agent, so an outdated one gets the chart upgrade),
   * where the AI agent page draws it: right after when it was last seen.
   */
  test("draws the agent's version with AgentVersion, after when it was last seen", async () => {
    serveStatus(
      makeStatus({
        aiAgent: {
          id: "99999999-0000-4000-8000-000000000009",
          isOnline: true,
          connectionStatus: "connected",
          lastAliveAt: new Date().toISOString(),
          agentVersion: "14.1.0",
        },
      }),
    );
    renderCard();
    await findBadge("connection");

    const details: HTMLElement = screen.getByTestId(
      `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-details`,
    );
    expect(details.textContent).toMatch(/^last seen .+ · agent 14\.1\.0$/);
    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-agent-version`),
    ).toHaveTextContent("agent 14.1.0");
  });

  test("an agent that never said its version: no version, and no empty place", async () => {
    serveStatus(
      makeStatus({
        aiAgent: {
          id: "99999999-0000-4000-8000-000000000009",
          isOnline: true,
          connectionStatus: "connected",
          lastAliveAt: new Date().toISOString(),
        },
      }),
    );
    renderCard();
    await findBadge("connection");

    expect(
      screen.queryByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-agent-version`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-details`,
      ).textContent,
    ).toMatch(/^last seen [^·]+$/);
  });

  test("is described as the cluster's AI agent page is", async () => {
    serveStatus(makeStatus());
    renderCard();
    await findBadge("connection");

    expect(
      screen.getByText(
        "Whether OneUptime AI can reach this cluster, and what it may do there.",
      ),
    ).toBeInTheDocument();
  });

  test("links to the cluster's AI → Agent page", async () => {
    serveStatus(makeStatus());
    renderCard();
    await findBadge("connection");

    expect(
      screen.getByRole("link", { name: "Open the AI agent page" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}/ai/agent`,
    );
  });

  test("a cluster still on the chart's previous in-cluster Runner reads as connected, and says so", async () => {
    serveStatus(
      makeStatus({
        runner: {
          id: "55555555-0000-4000-8000-000000000005",
          name: "kubernetes-agent/prod-east",
          isOnline: true,
          canRunAiCommands: true,
        },
        aiAgent: null,
      }),
    );
    renderCard();

    expect(await findBadge("connection")).toBe("Connected");
    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-value`),
    ).toHaveTextContent("Upgrade the Kubernetes agent chart");
  });

  test("nothing installed: Not installed, and what needs attention", async () => {
    serveStatus(
      makeStatus({
        runner: null,
        aiAgent: null,
        accessMethod: "none",
        isInvestigationReady: false,
        remediationMode: KubernetesAiRemediationMode.Disabled,
        gaps: [
          {
            code: "ai_agent_not_connected",
            title: "No agent",
            description: "No agent",
            nextStep: "Install it",
            blocks: "both",
          },
        ],
      }),
    );
    renderCard();

    expect(await findBadge("connection")).toBe("Not installed");
    expect(await findBadge("fixes")).toBe("Off");
    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-attention-title`),
    ).toHaveTextContent("OneUptime AI can't investigate this cluster");
  });

  test.each<[string, () => Promise<unknown>]>([
    [
      "refused",
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(403, { error: "No." }, {});
      },
    ],
    [
      "unreachable",
      async (): Promise<never> => {
        throw new Error("Network Error");
      },
    ],
    [
      "not a status",
      async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(200, { nope: true }, {});
      },
    ],
  ])(
    "a status that is %s: the card says it could not load it and links on",
    async (_label: string, answer: () => Promise<unknown>) => {
      serve(answer);
      renderCard();

      expect(
        await screen.findByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`,
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Open the AI agent page" }),
      ).toBeInTheDocument();
    },
  );

  test("reads the status again when the Overview refreshes, and keeps it when a refresh fails", async () => {
    serveStatus(makeStatus());
    const view: RenderResult = renderCard({ refreshToken: 1 });
    expect(await findBadge("fixes")).toBe("Automatic");

    serveStatus(
      makeStatus({ remediationMode: KubernetesAiRemediationMode.Disabled }),
    );
    view.rerender(
      <KubernetesAiAgentStatusSummaryCard
        clusterId={CLUSTER_ID}
        refreshToken={2}
      />,
    );
    await settle();
    expect(await findBadge("fixes")).toBe("Off");

    serve(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(500, { error: "Boom." }, {});
    });
    view.rerender(
      <KubernetesAiAgentStatusSummaryCard
        clusterId={CLUSTER_ID}
        refreshToken={3}
      />,
    );
    await settle();

    expect(postSpy).toHaveBeenCalledTimes(3);
    expect(await findBadge("fixes")).toBe("Off");
  });

  test("the same refresh signal reads nothing again", async () => {
    serveStatus(makeStatus());
    const view: RenderResult = renderCard({ refreshToken: 1 });
    await findBadge("connection");

    view.rerender(
      <KubernetesAiAgentStatusSummaryCard
        clusterId={CLUSTER_ID}
        refreshToken={1}
      />,
    );
    await settle();

    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});

/*
 * On the cluster Overview the status is read once, for this card and the
 * summary row's "AI agent" card, and handed to both: this card shows that
 * read and reads nothing itself.
 */
describe("handed the Overview's read", () => {
  test("shows that status and reads nothing itself", async () => {
    render(
      <KubernetesAiAgentStatusSummaryCard
        clusterId={CLUSTER_ID}
        read={{ status: makeStatus(), isLoading: false }}
      />,
    );

    expect(await findBadge("connection")).toBe("Connected");
    expect(await findBadge("investigation")).toBe("On");
    expect(await findBadge("fixes")).toBe("Automatic");
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("a loader while the Overview's read is out", () => {
    render(
      <KubernetesAiAgentStatusSummaryCard
        clusterId={CLUSTER_ID}
        read={{ status: null, isLoading: true }}
      />,
    );

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("says it could not load the status when the Overview's read found none", () => {
    render(
      <KubernetesAiAgentStatusSummaryCard
        clusterId={CLUSTER_ID}
        read={{ status: null, isLoading: false }}
      />,
    );

    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`),
    ).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("follows the read when the Overview reads again, and ignores its own refresh signal", async () => {
    const view: RenderResult = render(
      <KubernetesAiAgentStatusSummaryCard
        clusterId={CLUSTER_ID}
        refreshToken={1}
        read={{ status: makeStatus(), isLoading: false }}
      />,
    );
    expect(await findBadge("fixes")).toBe("Automatic");

    view.rerender(
      <KubernetesAiAgentStatusSummaryCard
        clusterId={CLUSTER_ID}
        refreshToken={2}
        read={{
          status: makeStatus({
            remediationMode: KubernetesAiRemediationMode.Disabled,
          }),
          isLoading: false,
        }}
      />,
    );
    await settle();

    expect(await findBadge("fixes")).toBe("Off");
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("reads for itself once nothing is handed to it any more", async () => {
    serveStatus(makeStatus());
    const view: RenderResult = render(
      <KubernetesAiAgentStatusSummaryCard
        clusterId={CLUSTER_ID}
        read={{ status: null, isLoading: true }}
      />,
    );
    await settle();
    expect(postSpy).not.toHaveBeenCalled();

    view.rerender(
      <KubernetesAiAgentStatusSummaryCard clusterId={CLUSTER_ID} />,
    );

    expect(await findBadge("connection")).toBe("Connected");
    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});
