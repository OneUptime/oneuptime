import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import KubernetesAiAgentOverviewCard from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentOverviewCard";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * The cluster Overview's "AI agent" card sits next to "Agent Status" (the
 * telemetry collector) and answers, from the same status route the AI
 * agent page reads, whether OneUptime AI can reach the cluster: Connected,
 * Offline or Not installed. Clicking it opens AI → Agent. It never fails
 * the Overview: an unreadable or refused status shows a dash.
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
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

let postSpy: ReturnType<typeof jest.spyOn>;
let navigateSpy: ReturnType<typeof jest.spyOn>;

function serve(answer: () => Promise<unknown>): void {
  postSpy.mockImplementation(answer);
}

function renderCard(): void {
  render(<KubernetesAiAgentOverviewCard clusterId={CLUSTER_ID} />);
}

async function findStatusText(): Promise<string> {
  return (
    (
      await screen.findByTestId(
        "kubernetes-ai-agent-overview-status",
        {},
        { timeout: WAIT_TIMEOUT },
      )
    ).textContent || ""
  );
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}`);
  postSpy = jest.spyOn(API, "post");
  serve(async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      makeStatus() as unknown as JSONObject,
      {},
    );
  });
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {
      return undefined;
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Overview's AI agent card", () => {
  test("is titled AI agent — never a bare Agent next to Agent Status", async () => {
    renderCard();

    expect(screen.getByText("AI agent")).toBeInTheDocument();
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
    await findStatusText();
  });

  test("reads the cluster's status once from the AI access status route", async () => {
    renderCard();
    await findStatusText();

    expect(postSpy).toHaveBeenCalledTimes(1);
    const request: JSONObject = postSpy.mock.calls[0]![0] as JSONObject;
    expect(String(request["url"])).toMatch(
      /\/kubernetes-cluster\/ai-access\/status$/,
    );
    expect(request["data"]).toEqual({ clusterId: CLUSTER_ID.toString() });
  });

  test("Connected when the agent is online", async () => {
    renderCard();
    expect(await findStatusText()).toBe("Connected");
  });

  test("Offline when the agent stopped checking in", async () => {
    serve(async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(
        200,
        makeStatus({
          runner: { ...makeStatus().runner!, isOnline: false },
          aiAgent: {
            id: "99999999-0000-4000-8000-000000000009",
            isOnline: false,
            connectionStatus: "disconnected",
          },
        }) as unknown as JSONObject,
        {},
      );
    });
    renderCard();
    expect(await findStatusText()).toBe("Offline");
  });

  test("Not installed when nothing can reach the cluster", async () => {
    serve(async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(
        200,
        makeStatus({
          runner: null,
          aiAgent: null,
          accessMethod: "none",
        }) as unknown as JSONObject,
        {},
      );
    });
    renderCard();
    expect(await findStatusText()).toBe("Not installed");
  });

  test("Connected through the previous in-cluster Runner too", async () => {
    serve(async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(
        200,
        makeStatus({
          runner: {
            id: "55555555-0000-4000-8000-000000000005",
            name: "kubernetes-agent/prod-east",
            isOnline: true,
            canRunAiCommands: true,
          },
          aiAgent: null,
        }) as unknown as JSONObject,
        {},
      );
    });
    renderCard();
    expect(await findStatusText()).toBe("Connected");
  });

  test("a dash, not a failed Overview, when the status is refused or unreadable", async () => {
    for (const answer of [
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(403, { error: "No." }, {});
      },
      async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(200, { nope: true }, {});
      },
      async (): Promise<never> => {
        throw new Error("Network Error");
      },
    ]) {
      cleanup();
      serve(answer);
      renderCard();
      expect(
        await screen.findByText("—", {}, { timeout: WAIT_TIMEOUT }),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("kubernetes-ai-agent-overview-status"),
      ).not.toBeInTheDocument();
    }
  });

  test("opens AI → Agent when clicked", async () => {
    renderCard();
    await findStatusText();

    fireEvent.click(
      screen.getByRole("button", { name: "AI agent — open AI → Agent" }),
    );

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect((navigateSpy.mock.calls[0]![0] as Route).toString()).toBe(
      `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}/ai/agent`,
    );
  });
});

/*
 * Every other summary card on the Overview carries an (i) whose text lives
 * in the cluster metric descriptions; the card takes its text from the
 * Overview the same way rather than keeping a sentence of its own.
 */
describe("the card's (i)", () => {
  const TOOLTIP: string =
    "Whether OneUptime AI can reach this cluster through its Kubernetes AI agent.";

  test("has none until the Overview passes one", async () => {
    renderCard();
    await findStatusText();

    expect(
      screen.queryByRole("button", { name: "About AI agent" }),
    ).not.toBeInTheDocument();
  });

  test("shows the text it is given beside the title", async () => {
    render(
      <KubernetesAiAgentOverviewCard
        clusterId={CLUSTER_ID}
        tooltip={TOOLTIP}
      />,
    );
    await findStatusText();

    expect(
      screen.getByRole("button", { name: "About AI agent" }),
    ).toBeInTheDocument();
    // The card still opens AI → Agent, as its own control.
    expect(
      screen.getByRole("button", { name: "AI agent — open AI → Agent" }),
    ).toBeInTheDocument();
  });

  test("opening the (i) does not navigate away", async () => {
    render(
      <KubernetesAiAgentOverviewCard
        clusterId={CLUSTER_ID}
        tooltip={TOOLTIP}
      />,
    );
    await findStatusText();

    fireEvent.click(screen.getByRole("button", { name: "About AI agent" }));
    expect(navigateSpy).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "AI agent — open AI → Agent" }),
    );
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  test("a blank text adds no (i)", async () => {
    render(
      <KubernetesAiAgentOverviewCard clusterId={CLUSTER_ID} tooltip=" " />,
    );
    await findStatusText();

    expect(
      screen.queryByRole("button", { name: "About AI agent" }),
    ).not.toBeInTheDocument();
  });
});

describe("the Overview page", () => {
  // Beside the collector's status, in the same row of summary cards.
  test("shows the AI agent card right after Agent Status", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index.tsx",
      ),
      "utf8",
    );
    const agentStatusAt: number = source.indexOf('title="Agent Status"');
    const aiAgentCardAt: number = source.indexOf(
      "<KubernetesAiAgentOverviewCard clusterId={modelId} />",
    );
    expect(agentStatusAt).toBeGreaterThan(-1);
    expect(aiAgentCardAt).toBeGreaterThan(agentStatusAt);
    // Same grid: no closing </div> of the row between the two cards.
    const between: string = source.slice(agentStatusAt, aiAgentCardAt);
    expect(between).not.toMatch(/<\/div>\s*\n\s*<ResourceActivityCards/);
    expect(source.slice(aiAgentCardAt, aiAgentCardAt + 200)).toMatch(
      /\/>\s*\n\s*<\/div>/,
    );
  });

  /*
   * Six cards in the row: three per line on a laptop, all six in one line
   * on a wide screen — never five and one left alone on a second line.
   */
  test("lays the six summary cards out in full lines", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index.tsx",
      ),
      "utf8",
    );
    const rowAt: number = source.lastIndexOf(
      "<div className=",
      source.indexOf('title="Cluster Health"'),
    );
    const row: string = source.slice(rowAt, source.indexOf(">", rowAt) + 1);

    expect(row).toBe(
      '<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-5">',
    );
    const cards: string = source.slice(
      rowAt,
      source.indexOf("<ResourceActivityCards", rowAt),
    );
    expect(
      cards.split("<InfoCard").length -
        1 +
        (cards.split("<KubernetesAiAgentOverviewCard").length - 1),
    ).toBe(6);
  });
});
