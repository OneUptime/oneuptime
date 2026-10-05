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
  waitFor,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, useState } from "react";
import {
  MemoryRouter,
  NavigateFunction,
  Route as PageRoute,
  Routes,
  useNavigate,
} from "react-router-dom";
import AiActivityInsightsPage from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsPage";
import {
  getAttentionTarget,
  getPreventiveInsightRoute,
  getSubjectRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsView";
import {
  AI_INSIGHTS_EMPTY_TITLE,
  AI_INSIGHTS_PAGE_TITLE,
  getAiInsightsEmptyDescription,
  getAiInsightsPageSubtitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import KubernetesClusterAIInsights, {
  KUBERNETES_AI_INSIGHTS_NOUN,
  loadKubernetesAgentHint,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI/Insights";
import { loadResourceAgentHint } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiInsightsPage";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import CephClusterAiInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/AI/Insights";
import DatabaseServerAiInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/AI/Insights";
import DockerHostAiInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/AI/Insights";
import DockerSwarmClusterAiInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/AI/Insights";
import HostAiInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/AI/Insights";
import PodmanHostAiInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/AI/Insights";
import ProxmoxClusterAiInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/AI/Insights";
import VMwareVCenterAiInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/AI/Insights";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  AiActivityAttentionItem,
  AiActivityAttentionKind,
  AiActivityAttentionSeverity,
  AiActivityInsights,
} from "../../../Types/AI/AiActivityInsights";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  ALERT_ID,
  INCIDENT_ID,
  INSIGHT_ID,
  ONE_OFF_PROBLEM_KEY,
  PREVENTIVE_INSIGHT_TITLE,
  RECURRING_PROBLEM_KEY,
  RECURRING_PROBLEM_TITLE,
  REPORT_FINDING,
  TLDR_FINDING,
  makeEmptyInsights,
  makeInsights,
  toBody,
} from "./AiActivityInsightsFixtures";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

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

/*
 * The AI Insights pages (AI → Insights) render for real on their real
 * routes — a Kubernetes cluster's, and each resource AI agent's resource
 * through its thin page — with the insights and access status routes
 * stubbed. They answer "what has OneUptime AI learned here, and what
 * deserves my attention?": what needs attention with a link to act on it,
 * the window at a glance, the problems AI investigated grouped by what
 * raised them with what it found, the hotspots, how fixes went and the
 * open preventive insights — and point at AI Logs for everything AI did.
 */

const WAIT_TIMEOUT: number = 20000;

const CLUSTER_ID: string = "44444444-0000-4000-8000-000000000004";
const OTHER_CLUSTER_ID: string = "44444444-0000-4000-8000-0000000000ff";
const RESOURCE_ID: string = "55555555-0000-4000-8000-000000000005";
const OTHER_RESOURCE_ID: string = "55555555-0000-4000-8000-0000000000ff";

const K8S_INSIGHTS_ROUTE: string = "/kubernetes-cluster/ai-access/insights";
const K8S_STATUS_ROUTE: string = "/kubernetes-cluster/ai-access/status";
const RESOURCE_INSIGHTS_ROUTE: string = "/resource-ai-access/insights";
const RESOURCE_STATUS_ROUTE: string = "/resource-ai-access/status";

const K8S_NOT_READY_HINT: string =
  "OneUptime AI can't run kubectl on this cluster right now.";
const K8S_AUTOMATIC_OFF_HINT: string =
  "Automatic investigation is off for new incidents and alerts in this project.";

const INCIDENT_HREF: string = `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`;
const ALERT_HREF: string = `/dashboard/${PROJECT_ID}/alerts/${ALERT_ID}`;
const INSIGHT_HREF: string = `/dashboard/${PROJECT_ID}/ai/insights/${INSIGHT_ID}`;

const THIN_PAGES: Record<
  AiResourceType,
  FunctionComponent<PageComponentProps>
> = {
  [AiResourceType.DockerHost]: DockerHostAiInsights,
  [AiResourceType.PodmanHost]: PodmanHostAiInsights,
  [AiResourceType.DockerSwarmCluster]: DockerSwarmClusterAiInsights,
  [AiResourceType.ProxmoxCluster]: ProxmoxClusterAiInsights,
  [AiResourceType.VMwareVCenter]: VMwareVCenterAiInsights,
  [AiResourceType.CephCluster]: CephClusterAiInsights,
  [AiResourceType.DatabaseServer]: DatabaseServerAiInsights,
  [AiResourceType.Host]: HostAiInsights,
};

const CEPH: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
  AiResourceType.CephCluster,
);

function makeK8sStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID,
    clusterName: "prod-east",
    clusterIdentifier: "prod-east",
    runner: {
      id: "88888888-0000-4000-8000-000000000008",
      name: "Kubernetes AI agent",
      kind: "ai_agent",
      isOnline: true,
      canRunAiCommands: true,
    },
    accessMethod: "in_cluster",
    aiAgent: null,
    automaticInvestigation: { incidents: true, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    gaps: [],
    evaluatedAt: "2026-09-30T10:00:30.000Z",
    ...overrides,
  };
}

function makeResourceStatus(
  type: AiResourceType,
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: type,
    resourceId: RESOURCE_ID,
    resourceName: "prod-01",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    agent: null,
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: false,
    ...overrides,
  };
}

type Answer = () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

function ok(body: unknown): Answer {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, body as JSONObject, {});
  };
}

function httpError(statusCode: number, message: string): Answer {
  return async (): Promise<HTTPErrorResponse> => {
    return new HTTPErrorResponse(statusCode, { message }, {});
  };
}

function rejects(error: Error): Answer {
  return async (): Promise<HTTPErrorResponse> => {
    throw error;
  };
}

let postSpy: ReturnType<typeof jest.spyOn>;
let insightsAnswers: Array<Answer> = [];
let statusAnswer: Answer = ok(makeK8sStatus());

function serve(insights: Answer | Array<Answer>, status?: Answer): void {
  insightsAnswers = Array.isArray(insights) ? [...insights] : [insights];
  if (status) {
    statusAnswer = status;
  }
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

let navigate: NavigateFunction | undefined;

function NavigationProbe(): React.ReactElement {
  navigate = useNavigate();
  return <></>;
}

function pathFor(page: PageMap, id: string): string {
  return RouteMap[page]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", id);
}

function clusterPath(page: PageMap, clusterId: string = CLUSTER_ID): string {
  return pathFor(page, clusterId);
}

const K8S_LOGS_HREF: string = clusterPath(
  PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS,
);
const K8S_AGENT_HREF: string = clusterPath(
  PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT,
);

function openClusterInsightsPage(): void {
  const path: string = clusterPath(PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS);
  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
      <NavigationProbe />
      <Routes>
        <PageRoute
          path={String(RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS])}
          element={
            <KubernetesClusterAIInsights
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS] as Route
              }
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function openResourceInsightsPage(type: AiResourceType): void {
  const descriptor: ResourceAiAgentDescriptor =
    getResourceAiAgentDescriptor(type);
  const Page: FunctionComponent<PageComponentProps> = THIN_PAGES[type];
  const path: string = pathFor(descriptor.insightsPage, RESOURCE_ID);
  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
      <NavigationProbe />
      <Routes>
        <PageRoute
          path={String(RouteMap[descriptor.insightsPage])}
          element={
            <Page
              pageRoute={RouteMap[descriptor.insightsPage] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function findText(text: string | RegExp): Promise<HTMLElement> {
  return await screen.findByText(text, {}, { timeout: WAIT_TIMEOUT });
}

async function findTestId(testId: string): Promise<HTMLElement> {
  return await screen.findByTestId(testId, {}, { timeout: WAIT_TIMEOUT });
}

function hrefOf(element: HTMLElement): string {
  const anchor: HTMLAnchorElement | null = element.closest("a");
  if (!anchor) {
    throw new Error(`"${element.textContent}" is not inside a link.`);
  }
  return anchor.getAttribute("href") || "";
}

async function waitForStatusRequest(route: string): Promise<void> {
  await waitFor(
    () => {
      expect(postsTo(route)).toHaveLength(1);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();

  insightsAnswers = [ok(toBody(makeInsights()))];
  statusAnswer = ok(makeK8sStatus());

  postSpy = jest.spyOn(API, "post");
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);
      if (
        url.endsWith(K8S_INSIGHTS_ROUTE) ||
        url.endsWith(RESOURCE_INSIGHTS_ROUTE)
      ) {
        const answer: Answer =
          insightsAnswers.length > 1
            ? insightsAnswers.shift()!
            : insightsAnswers[0]!;
        return await answer();
      }
      if (
        url.endsWith(K8S_STATUS_ROUTE) ||
        url.endsWith(RESOURCE_STATUS_ROUTE)
      ) {
        return await statusAnswer();
      }
      throw new Error(`Unexpected request to ${url}`);
    },
  );
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the cluster's AI Insights page", () => {
  test("is titled AI Insights, says what it is about, and points at AI Logs", async () => {
    openClusterInsightsPage();

    const heading: HTMLElement = screen.getByTestId("ai-insights-page-heading");
    expect(
      within(heading).getByText(AI_INSIGHTS_PAGE_TITLE),
    ).toBeInTheDocument();
    expect(
      within(heading).getByText(
        "What OneUptime AI has learned about this cluster in the last 30 days, and what deserves your attention.",
      ),
    ).toBeInTheDocument();
    expect(hrefOf(screen.getByTestId("ai-insights-logs-link"))).toBe(
      K8S_LOGS_HREF,
    );
    expect(screen.getByTestId("ai-insights-logs-link")).toHaveTextContent(
      "See everything AI did in AI Logs",
    );
    expect(await findText("Needs attention")).toBeInTheDocument();
  });

  test("asks the insights and status routes about this cluster", async () => {
    openClusterInsightsPage();
    await findText("Needs attention");

    expect(postsTo(K8S_INSIGHTS_ROUTE)).toHaveLength(1);
    expect(postsTo(K8S_INSIGHTS_ROUTE)[0]!["data"]).toEqual({
      clusterId: CLUSTER_ID,
    });
    expect(String(postsTo(K8S_INSIGHTS_ROUTE)[0]!["url"])).toContain(
      "/api/kubernetes-cluster/ai-access/insights",
    );
    await waitForStatusRequest(K8S_STATUS_ROUTE);
    expect(postsTo(K8S_STATUS_ROUTE)[0]!["data"]).toEqual({
      clusterId: CLUSTER_ID,
    });
    // Never the resource routes.
    expect(postsTo(RESOURCE_INSIGHTS_ROUTE)).toHaveLength(0);
  });

  test("shows a loader, with the heading, until the insights arrive", async () => {
    let answer: (() => void) | undefined;
    serve(async (): Promise<HTTPResponse<JSONObject>> => {
      await new Promise<void>((resolve: () => void) => {
        answer = resolve;
      });
      return new HTTPResponse<JSONObject>(200, toBody(makeInsights()), {});
    });
    openClusterInsightsPage();

    expect(screen.getByTestId("ai-insights-loading")).toBeInTheDocument();
    expect(screen.getByText(AI_INSIGHTS_PAGE_TITLE)).toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    await waitFor(
      () => {
        expect(answer).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    await act(async () => {
      answer!();
      await Promise.resolve();
    });

    expect(await findText("Needs attention")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-insights-loading")).not.toBeInTheDocument();
  });

  describe("with AI activity", () => {
    test("lists what needs attention, most important first, each with where to act", async () => {
      openClusterInsightsPage();

      const list: HTMLElement = await findTestId("ai-insights-attention");
      const items: Array<HTMLElement> = within(list).getAllByTestId(
        "ai-insights-attention-item",
      );
      expect(
        items.map((item: HTMLElement): string => {
          return `${item.getAttribute("data-kind")}/${item.getAttribute("data-severity")}`;
        }),
      ).toEqual([
        "FixesFailed/High",
        "RecurringProblem/High",
        "PreventiveInsight/High",
        "InvestigationsFailed/Medium",
        "CommandsTimedOut/Medium",
        "Hotspot/Low",
      ]);

      expect(items[0]).toHaveTextContent(
        "1 fix OneUptime AI applied did not resolve the problem it was for.",
      );
      expect(hrefOf(within(items[0]!).getByText("Open incident"))).toBe(
        INCIDENT_HREF,
      );
      expect(
        within(items[0]!).getByRole("img", { name: "Needs attention now" }),
      ).toBeInTheDocument();

      expect(items[1]).toHaveTextContent(
        `${RECURRING_PROBLEM_TITLE} keeps coming back: OneUptime AI investigated it 5 times in the last 30 days. 3 of those were in the last 7 days.`,
      );
      expect(hrefOf(within(items[1]!).getByText("Open incident"))).toBe(
        INCIDENT_HREF,
      );

      expect(items[2]).toHaveTextContent(
        `An open preventive insight: ${PREVENTIVE_INSIGHT_TITLE}`,
      );
      expect(hrefOf(within(items[2]!).getByText("Open insight"))).toBe(
        INSIGHT_HREF,
      );

      expect(items[3]).toHaveTextContent(
        "1 investigation failed or timed out in the last 30 days.",
      );
      expect(hrefOf(within(items[3]!).getByText("Open AI Logs"))).toBe(
        K8S_LOGS_HREF,
      );
      expect(
        within(items[3]!).getByRole("img", { name: "Worth a look" }),
      ).toBeInTheDocument();

      expect(items[4]).toHaveTextContent(
        "1 command OneUptime AI sent was never picked up by the agent.",
      );
      expect(
        hrefOf(within(items[4]!).getByText("Open the AI agent page")),
      ).toBe(K8S_AGENT_HREF);

      expect(items[5]).toHaveTextContent(
        "Namespace: checkout shows up in 5 of the 8 investigations here.",
      );
      // A hotspot has nowhere to go.
      expect(within(items[5]!).queryByRole("link")).not.toBeInTheDocument();
      expect(
        within(items[5]!).getByRole("img", { name: "Good to know" }),
      ).toBeInTheDocument();
    });

    test("sums up the window, with what failed", async () => {
      openClusterInsightsPage();

      const summary: HTMLElement = await findTestId("ai-insights-summary");
      expect(screen.getByText("Last 30 days")).toBeInTheDocument();

      const stat: (name: string) => HTMLElement = (
        name: string,
      ): HTMLElement => {
        return within(summary).getByTestId(`ai-insights-stat-${name}`);
      };
      expect(stat("investigations")).toHaveTextContent(
        "Investigations81 failed or timed out",
      );
      expect(stat("problems")).toHaveTextContent("Problems21 recurring");
      expect(stat("fixes")).toHaveTextContent("Fixes41 verified");
      expect(stat("commands")).toHaveTextContent(
        "Commands372 failed, 1 never ran",
      );
    });

    test("draws a day-by-day trend of the window and compares the last two weeks", async () => {
      openClusterInsightsPage();

      const trend: HTMLElement = await findTestId("ai-insights-trend");
      const days: Array<HTMLElement> = within(trend).getAllByTestId(
        "ai-insights-trend-day",
      );
      expect(days).toHaveLength(30);
      expect(days[0]).toHaveAttribute("data-date", "2026-09-01");
      expect(days[29]).toHaveAttribute("data-date", "2026-09-30");
      expect(days[29]).toHaveAttribute("data-investigations", "2");
      expect(days[29]).toHaveAttribute(
        "title",
        "2026-09-30: 2 investigations, 1 failed, 1 fixes",
      );
      expect(
        within(trend).getByRole("img", {
          name: "5 investigations in the last 7 days (2 the 7 days before).",
        }),
      ).toBeInTheDocument();
      expect(
        within(trend).getByTestId("ai-insights-trend-weeks"),
      ).toHaveTextContent(
        "5 investigations in the last 7 days (2 the 7 days before).",
      );
      expect(
        within(trend).getByText("Investigations per day"),
      ).toBeInTheDocument();
    });

    test("groups what AI investigated into problems, with what it found and how it went", async () => {
      openClusterInsightsPage();

      expect(
        await findText("Problems OneUptime AI investigated"),
      ).toBeInTheDocument();
      const problems: Array<HTMLElement> = screen.getAllByTestId(
        "ai-insights-problem",
      );
      expect(
        problems.map((problem: HTMLElement): string | null => {
          return problem.getAttribute("data-problem-key");
        }),
      ).toEqual([RECURRING_PROBLEM_KEY, ONE_OFF_PROBLEM_KEY]);

      const recurring: HTMLElement = problems[0]!;
      expect(hrefOf(within(recurring).getByText(RECURRING_PROBLEM_TITLE))).toBe(
        INCIDENT_HREF,
      );
      expect(
        within(recurring).getByText(
          /^Investigated 5 times · 4 incidents and alerts · last seen /,
        ),
      ).toBeInTheDocument();
      expect(
        within(recurring).getByTestId("ai-insights-recurring"),
      ).toHaveTextContent("Recurring");
      expect(
        within(
          within(recurring).getByTestId("ai-insights-problem-objects"),
        ).getByText("Namespace: checkout ×5"),
      ).toBeInTheDocument();
      expect(
        within(recurring).getByText("Pod: web-7d9f-2xk"),
      ).toBeInTheDocument();
      expect(
        within(recurring).getByTestId("ai-insights-problem-finding"),
      ).toHaveTextContent(`Latest finding: ${TLDR_FINDING}`);
      expect(
        within(recurring).queryByText("(from the investigation's report)"),
      ).not.toBeInTheDocument();
      expect(
        within(recurring).getByTestId("ai-insights-problem-fixes"),
      ).toHaveTextContent(
        "3 fixes proposed · 2 applied · 1 verified · 1 did not help · 1 waiting for approval",
      );
      expect(
        within(recurring).getByTestId("ai-insights-problem-verdicts"),
      ).toHaveTextContent(
        "your team confirmed 2 findings · your team rejected 1 finding · 2 findings matched the root cause recorded later",
      );

      const oneOff: HTMLElement = problems[1]!;
      expect(hrefOf(within(oneOff).getByText("Disk almost full"))).toBe(
        ALERT_HREF,
      );
      expect(
        within(oneOff).getByText(/^Investigated 1 time · last seen /),
      ).toBeInTheDocument();
      expect(
        within(oneOff).queryByTestId("ai-insights-recurring"),
      ).not.toBeInTheDocument();
      // Its TL;DR call failed: the finding is what its report said.
      expect(
        within(oneOff).getByTestId("ai-insights-problem-finding"),
      ).toHaveTextContent(REPORT_FINDING);
      expect(
        within(oneOff).getByText("(from the investigation's report)"),
      ).toBeInTheDocument();
      expect(
        within(oneOff).queryByText("No finding recorded for this problem yet."),
      ).not.toBeInTheDocument();
      expect(
        within(oneOff).queryByTestId("ai-insights-problem-fixes"),
      ).not.toBeInTheDocument();
      expect(
        within(oneOff).queryByTestId("ai-insights-problem-verdicts"),
      ).not.toBeInTheDocument();
    });

    test("says so when a problem has no finding yet", async () => {
      const insights: AiActivityInsights = makeInsights();
      delete insights.problems[1]!.latestFinding;
      serve(ok(toBody(insights)));
      openClusterInsightsPage();

      const problems: Array<HTMLElement> = await screen.findAllByTestId(
        "ai-insights-problem",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(
        within(problems[1]!).getByText(
          "No finding recorded for this problem yet.",
        ),
      ).toBeInTheDocument();
    });

    test("names the hotspots, how often they showed up and in how many problems", async () => {
      openClusterInsightsPage();

      expect(await findText("Hotspots")).toBeInTheDocument();
      expect(
        screen.getByText(
          "The parts of this cluster that keep showing up in what OneUptime AI investigated.",
        ),
      ).toBeInTheDocument();
      const hotspots: Array<HTMLElement> = screen.getAllByTestId(
        "ai-insights-hotspot",
      );
      expect(hotspots).toHaveLength(2);
      expect(
        within(hotspots[0]!).getByText("Namespace: checkout"),
      ).toBeInTheDocument();
      expect(
        within(hotspots[0]!).getByText(
          /^5 investigations · 1 problem · last seen /,
        ),
      ).toBeInTheDocument();
      expect(
        within(hotspots[1]!).getByText(/^2 investigations · 2 problems/),
      ).toBeInTheDocument();
    });

    test("shows where fixes ended up and whether they helped", async () => {
      openClusterInsightsPage();

      const fixes: HTMLElement = await findTestId("ai-insights-fixes");
      expect(within(fixes).getByRole("progressbar")).toBeInTheDocument();
      for (const label of [
        "Applied automatically",
        "Applied after approval",
        "Waiting for approval",
        "Dismissed",
      ]) {
        expect(
          within(fixes).getByText(new RegExp(`^${label}`)),
        ).toBeInTheDocument();
      }
      expect(within(fixes).queryByText(/^Planning/)).not.toBeInTheDocument();
      expect(
        within(fixes).getByTestId("ai-insights-fix-verification"),
      ).toHaveTextContent(
        "Verification: 1 resolved the problem, 1 did not, 0 still being checked.",
      );
    });

    test("links the open preventive insights filed against the cluster", async () => {
      openClusterInsightsPage();

      expect(await findText("Preventive insights")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Open findings OneUptime AI's detectors filed against this cluster's own telemetry, before anything paged.",
        ),
      ).toBeInTheDocument();
      const insights: Array<HTMLElement> = screen.getAllByTestId(
        "ai-insights-preventive",
      );
      expect(insights).toHaveLength(1);
      expect(
        hrefOf(within(insights[0]!).getByText(PREVENTIVE_INSIGHT_TITLE)),
      ).toBe(INSIGHT_HREF);
      expect(within(insights[0]!).getByText("High")).toBeInTheDocument();
      expect(
        within(insights[0]!).getByText(/^seen 3 times · last seen /),
      ).toBeInTheDocument();
    });

    test("never shows the AI Logs lists: those are on AI → Logs", async () => {
      openClusterInsightsPage();
      await findText("Needs attention");

      expect(
        screen.queryByTestId("ai-logs-investigation"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("ai-logs-fix")).not.toBeInTheDocument();
      expect(
        screen.queryByText("No summary was recorded."),
      ).not.toBeInTheDocument();
    });

    test("says when the numbers cover only the newest of the activity", async () => {
      serve(ok(toBody(makeInsights({ isPartial: true }))));
      openClusterInsightsPage();

      expect(await findTestId("ai-insights-partial")).toHaveTextContent(
        "There was more AI activity here than these insights read: they cover the newest of it.",
      );
      cleanup();

      serve(ok(toBody(makeInsights())));
      openClusterInsightsPage();
      await findText("Needs attention");
      expect(
        screen.queryByTestId("ai-insights-partial"),
      ).not.toBeInTheDocument();
    });

    test("says plainly when nothing needs attention, and leaves out empty cards", async () => {
      serve(
        ok(
          toBody(
            makeInsights({
              attention: [],
              problems: [],
              hotspots: [],
              preventiveInsights: [],
              fixOutcomes: makeEmptyInsights().fixOutcomes,
            }),
          ),
        ),
      );
      openClusterInsightsPage();

      expect(
        await findTestId("ai-insights-nothing-needs-attention"),
      ).toHaveTextContent("Nothing here needs your attention right now.");
      expect(
        screen.queryByTestId("ai-insights-attention"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("ai-insights-no-problems")).toHaveTextContent(
        "No incident or alert here was investigated in the last 30 days.",
      );
      expect(screen.getByTestId("ai-insights-no-hotspots")).toHaveTextContent(
        "Nothing has shown up in more than one investigation yet.",
      );
      // No fixes and no preventive insights: no cards for them at all.
      expect(screen.queryByTestId("ai-insights-fixes")).not.toBeInTheDocument();
      expect(screen.queryByText("Preventive insights")).not.toBeInTheDocument();
      // The window still has activity: no empty state.
      expect(screen.queryByTestId("ai-insights-empty")).not.toBeInTheDocument();
      expect(screen.getByTestId("ai-insights-summary")).toBeInTheDocument();
    });

    // An icon is a <div>: inside a <p> it is invalid markup React warns about.
    test("never puts a block inside a paragraph", async () => {
      openClusterInsightsPage();
      await findText("Needs attention");
      expect(document.querySelectorAll("p div, p p, p ul")).toHaveLength(0);
      cleanup();

      serve(ok(toBody(makeInsights({ attention: [] }))));
      openClusterInsightsPage();
      await findTestId("ai-insights-nothing-needs-attention");
      expect(document.querySelectorAll("p div, p p, p ul")).toHaveLength(0);
      cleanup();

      serve(
        ok(toBody(makeEmptyInsights())),
        ok(makeK8sStatus({ isInvestigationReady: false })),
      );
      openClusterInsightsPage();
      await findTestId("ai-insights-agent-hint");
      expect(document.querySelectorAll("p div, p p, p ul")).toHaveLength(0);
    });

    test("renders server text as text, never as markup", async () => {
      const insights: AiActivityInsights = makeInsights();
      insights.problems[0]!.title = "<img src='x' onerror='window.pwned=1'>";
      insights.problems[0]!.latestFinding!.text =
        "<script>window.pwned=1</script>";
      insights.hotspots[0]!.value = "<b>checkout</b>";
      insights.preventiveInsights[0]!.title =
        "<a href='javascript:alert(1)'>x</a>";
      serve(ok(toBody(insights)));
      openClusterInsightsPage();

      expect(
        await findText("<img src='x' onerror='window.pwned=1'>"),
      ).toBeInTheDocument();
      expect(
        screen.getAllByTestId("ai-insights-problem-finding")[0],
      ).toHaveTextContent("<script>window.pwned=1</script>");
      expect(
        screen.getByText("Namespace: <b>checkout</b>"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("<a href='javascript:alert(1)'>x</a>"),
      ).toBeInTheDocument();
      expect(document.querySelector("img[src='x']")).toBeNull();
      expect(document.querySelector("b")).toBeNull();
      expect(document.querySelector("a[href^='javascript:']")).toBeNull();
      expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    });
  });

  describe("without AI activity", () => {
    test("shows one empty state, pointing at AI Logs for anything older", async () => {
      serve(ok(toBody(makeEmptyInsights())));
      openClusterInsightsPage();

      const empty: HTMLElement = await findTestId("ai-insights-empty");
      expect(
        within(empty).getByText(AI_INSIGHTS_EMPTY_TITLE),
      ).toBeInTheDocument();
      expect(
        within(empty).getByText(
          getAiInsightsEmptyDescription(KUBERNETES_AI_INSIGHTS_NOUN),
        ),
      ).toBeInTheDocument();
      expect(
        within(empty).getByText("Anything older is on the AI Logs page."),
      ).toBeInTheDocument();
      expect(hrefOf(within(empty).getByText("Open AI Logs"))).toBe(
        K8S_LOGS_HREF,
      );
      expect(
        document.getElementById("kubernetes-ai-insights-empty"),
      ).not.toBeNull();
      // No row of zeros.
      expect(
        screen.queryByTestId("ai-insights-summary"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    });

    test("points at the AI agent page when AI cannot run kubectl here", async () => {
      serve(
        ok(toBody(makeEmptyInsights())),
        ok(makeK8sStatus({ isInvestigationReady: false })),
      );
      openClusterInsightsPage();

      const hint: HTMLElement = await findTestId("ai-insights-agent-hint");
      expect(hint).toHaveTextContent(K8S_NOT_READY_HINT);
      expect(hrefOf(within(hint).getByText("Open the AI agent page"))).toBe(
        K8S_AGENT_HREF,
      );
      expect(
        within(screen.getByTestId("ai-insights-empty")).getByTestId(
          "ai-insights-agent-hint",
        ),
      ).toBe(hint);
    });

    test("says when automatic investigation is off", async () => {
      serve(
        ok(toBody(makeEmptyInsights())),
        ok(
          makeK8sStatus({
            automaticInvestigation: { incidents: false, alerts: false },
          }),
        ),
      );
      openClusterInsightsPage();

      expect(await findTestId("ai-insights-agent-hint")).toHaveTextContent(
        K8S_AUTOMATIC_OFF_HINT,
      );
    });

    test("no pointer when AI is ready, or when its status cannot be read", async () => {
      serve(ok(toBody(makeEmptyInsights())));
      openClusterInsightsPage();
      await findTestId("ai-insights-empty");
      await waitForStatusRequest(K8S_STATUS_ROUTE);
      expect(
        screen.queryByTestId("ai-insights-agent-hint"),
      ).not.toBeInTheDocument();
      cleanup();
      postSpy.mockClear();

      serve(ok(toBody(makeEmptyInsights())), httpError(500, "status is down"));
      openClusterInsightsPage();
      await findTestId("ai-insights-empty");
      await waitForStatusRequest(K8S_STATUS_ROUTE);
      expect(
        screen.queryByTestId("ai-insights-agent-hint"),
      ).not.toBeInTheDocument();
      cleanup();
      postSpy.mockClear();

      serve(ok(toBody(makeEmptyInsights())), rejects(new Error("offline")));
      openClusterInsightsPage();
      await findTestId("ai-insights-empty");
      await waitForStatusRequest(K8S_STATUS_ROUTE);
      expect(
        screen.queryByTestId("ai-insights-agent-hint"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("ai-insights-error")).not.toBeInTheDocument();
    });
  });

  test("the pointer sits above the insights when there is activity but AI is not ready", async () => {
    serve(
      ok(toBody(makeInsights())),
      ok(makeK8sStatus({ isInvestigationReady: false })),
    );
    openClusterInsightsPage();

    const hint: HTMLElement = await findTestId("ai-insights-agent-hint");
    const attention: HTMLElement = await findText("Needs attention");
    expect(
      hint.compareDocumentPosition(attention) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  describe("when the insights cannot be loaded", () => {
    test("shows the server's error and loads again on retry", async () => {
      serve([
        httpError(500, "The insights service is unavailable."),
        ok(toBody(makeInsights())),
      ]);
      openClusterInsightsPage();

      expect(
        await findText("The insights service is unavailable."),
      ).toBeInTheDocument();
      fireEvent.click(
        within(screen.getByTestId("ai-insights-error")).getByTestId(
          "refresh-button",
        ),
      );

      expect(await findText("Needs attention")).toBeInTheDocument();
      expect(postsTo(K8S_INSIGHTS_ROUTE)).toHaveLength(2);
      expect(screen.queryByTestId("ai-insights-error")).not.toBeInTheDocument();
    });

    test("explains a refusal to read the cluster", async () => {
      serve(
        httpError(
          403,
          "You do not have permission to read this Kubernetes cluster.",
        ),
      );
      openClusterInsightsPage();

      expect(
        await findText(
          "You do not have permission to read this Kubernetes cluster.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("ai-insights-empty")).not.toBeInTheDocument();
    });

    test("explains a body it cannot read", async () => {
      serve(ok({ investigations: [], fixes: [] }));
      openClusterInsightsPage();

      expect(
        await findText(
          "The server returned AI insights this page cannot read.",
        ),
      ).toBeInTheDocument();
    });

    test("shows a network failure's message", async () => {
      serve(rejects(new Error("Network Error")));
      openClusterInsightsPage();

      expect(await findText("Network Error")).toBeInTheDocument();
      expect(screen.getByTestId("ai-insights-error")).toBeInTheDocument();
    });
  });

  test("drops a late answer about the cluster the user navigated away from", async () => {
    let answerFirst: (() => void) | undefined;
    postSpy.mockImplementation(
      async (
        request: unknown,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = String((request as JSONObject)["url"]);
        if (url.endsWith(K8S_STATUS_ROUTE)) {
          return new HTTPResponse<JSONObject>(
            200,
            makeK8sStatus() as unknown as JSONObject,
            {},
          );
        }
        const clusterId: unknown = (
          (request as JSONObject)["data"] as JSONObject
        )["clusterId"];
        if (clusterId === CLUSTER_ID) {
          await new Promise<void>((resolve: () => void) => {
            answerFirst = resolve;
          });
          return new HTTPResponse<JSONObject>(200, toBody(makeInsights()), {});
        }
        return new HTTPResponse<JSONObject>(
          200,
          toBody(makeEmptyInsights()),
          {},
        );
      },
    );
    openClusterInsightsPage();

    await waitFor(
      () => {
        expect(answerFirst).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    act(() => {
      navigate!(
        clusterPath(
          PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS,
          OTHER_CLUSTER_ID,
        ),
      );
    });

    expect(await findTestId("ai-insights-empty")).toBeInTheDocument();
    expect(
      postsTo(K8S_INSIGHTS_ROUTE).map((request: JSONObject): unknown => {
        return (request["data"] as JSONObject)["clusterId"];
      }),
    ).toEqual([CLUSTER_ID, OTHER_CLUSTER_ID]);
    // The other cluster's links.
    expect(hrefOf(screen.getByText("Open AI Logs"))).toBe(
      clusterPath(PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS, OTHER_CLUSTER_ID),
    );

    await act(async () => {
      answerFirst!();
      await Promise.resolve();
    });

    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-insights-empty")).toBeInTheDocument();
  });
});

describe("the cluster's agent pointer, on its own", () => {
  test("says why AI cannot work on the cluster, or nothing", async () => {
    serve(ok({}), ok(makeK8sStatus({ isInvestigationReady: false })));
    expect(await loadKubernetesAgentHint(CLUSTER_ID)).toBe(K8S_NOT_READY_HINT);

    serve(ok({}), ok(makeK8sStatus()));
    expect(await loadKubernetesAgentHint(CLUSTER_ID)).toBeNull();

    serve(ok({}), httpError(403, "no"));
    expect(await loadKubernetesAgentHint(CLUSTER_ID)).toBeNull();

    serve(ok({}), ok("not a status"));
    expect(await loadKubernetesAgentHint(CLUSTER_ID)).toBeNull();

    expect(
      postsTo(K8S_STATUS_ROUTE).map((request: JSONObject): unknown => {
        return request["data"];
      }),
    ).toEqual([
      { clusterId: CLUSTER_ID },
      { clusterId: CLUSTER_ID },
      { clusterId: CLUSTER_ID },
      { clusterId: CLUSTER_ID },
    ]);
  });
});

describe("every resource with a resource AI agent", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: its thin page asks about this resource and links to its own AI pages",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      statusAnswer = ok(makeResourceStatus(type));
      openResourceInsightsPage(type);

      expect(await findText("Needs attention")).toBeInTheDocument();
      expect(postsTo(RESOURCE_INSIGHTS_ROUTE)).toHaveLength(1);
      expect(postsTo(RESOURCE_INSIGHTS_ROUTE)[0]!["data"]).toEqual({
        resourceType: type,
        resourceId: RESOURCE_ID,
      });
      expect(String(postsTo(RESOURCE_INSIGHTS_ROUTE)[0]!["url"])).toContain(
        "/api/resource-ai-access/insights",
      );
      await waitForStatusRequest(RESOURCE_STATUS_ROUTE);
      expect(postsTo(RESOURCE_STATUS_ROUTE)[0]!["data"]).toEqual({
        resourceType: type,
        resourceId: RESOURCE_ID,
      });
      // Never the cluster's routes.
      expect(postsTo(K8S_INSIGHTS_ROUTE)).toHaveLength(0);

      expect(
        screen.getByText(getAiInsightsPageSubtitle(descriptor.noun)),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          `The parts of this ${descriptor.noun} that keep showing up in what OneUptime AI investigated.`,
        ),
      ).toBeInTheDocument();

      const logsHref: string = pathFor(descriptor.logsPage, RESOURCE_ID);
      const agentHref: string = pathFor(descriptor.agentPage, RESOURCE_ID);
      expect(logsHref).toMatch(/\/ai\/logs$/);
      expect(agentHref).toMatch(/\/ai\/agent$/);
      expect(hrefOf(screen.getByTestId("ai-insights-logs-link"))).toBe(
        logsHref,
      );
      expect(hrefOf(screen.getByText("Open the AI agent page"))).toBe(
        agentHref,
      );
      expect(hrefOf(screen.getByText("Open AI Logs"))).toBe(logsHref);
      expect(hrefOf(screen.getByText(RECURRING_PROBLEM_TITLE))).toBe(
        INCIDENT_HREF,
      );
      expect(screen.getAllByTestId("ai-insights-problem")).toHaveLength(2);
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: one empty state, pointing at the AI agent page when AI cannot run commands there",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      serve(
        ok(toBody(makeEmptyInsights())),
        ok(makeResourceStatus(type, { isInvestigationReady: false })),
      );
      openResourceInsightsPage(type);

      const empty: HTMLElement = await findTestId("ai-insights-empty");
      expect(
        within(empty).getByText(getAiInsightsEmptyDescription(descriptor.noun)),
      ).toBeInTheDocument();
      expect(
        document.getElementById(`${descriptor.commandsTableId}-insights-empty`),
      ).not.toBeNull();
      expect(hrefOf(within(empty).getByText("Open AI Logs"))).toBe(
        pathFor(descriptor.logsPage, RESOURCE_ID),
      );

      const hint: HTMLElement = await findTestId("ai-insights-agent-hint");
      expect(hint).toHaveTextContent(
        `OneUptime AI can't run commands on this ${descriptor.noun} right now.`,
      );
      expect(hrefOf(within(hint).getByText("Open the AI agent page"))).toBe(
        pathFor(descriptor.agentPage, RESOURCE_ID),
      );
    },
  );

  test("drops a late answer about the resource the user navigated away from", async () => {
    let answerFirst: (() => void) | undefined;
    postSpy.mockImplementation(
      async (
        request: unknown,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = String((request as JSONObject)["url"]);
        if (url.endsWith(RESOURCE_STATUS_ROUTE)) {
          return new HTTPResponse<JSONObject>(
            200,
            makeResourceStatus(
              AiResourceType.CephCluster,
            ) as unknown as JSONObject,
            {},
          );
        }
        const resourceId: unknown = (
          (request as JSONObject)["data"] as JSONObject
        )["resourceId"];
        if (resourceId === RESOURCE_ID) {
          await new Promise<void>((resolve: () => void) => {
            answerFirst = resolve;
          });
          return new HTTPResponse<JSONObject>(200, toBody(makeInsights()), {});
        }
        return new HTTPResponse<JSONObject>(
          200,
          toBody(makeEmptyInsights()),
          {},
        );
      },
    );
    openResourceInsightsPage(AiResourceType.CephCluster);

    await waitFor(
      () => {
        expect(answerFirst).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    act(() => {
      navigate!(pathFor(CEPH.insightsPage, OTHER_RESOURCE_ID));
    });

    expect(await findTestId("ai-insights-empty")).toBeInTheDocument();
    expect(
      postsTo(RESOURCE_INSIGHTS_ROUTE).map((request: JSONObject): unknown => {
        return (request["data"] as JSONObject)["resourceId"];
      }),
    ).toEqual([RESOURCE_ID, OTHER_RESOURCE_ID]);

    await act(async () => {
      answerFirst!();
      await Promise.resolve();
    });

    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });

  test("the resource's agent pointer says why AI cannot run commands there, or nothing", async () => {
    serve(
      ok({}),
      ok(
        makeResourceStatus(AiResourceType.CephCluster, {
          isInvestigationReady: false,
        }),
      ),
    );
    expect(await loadResourceAgentHint(CEPH, RESOURCE_ID)).toBe(
      "OneUptime AI can't run commands on this Ceph cluster right now.",
    );

    serve(ok({}), ok(makeResourceStatus(AiResourceType.CephCluster)));
    expect(await loadResourceAgentHint(CEPH, RESOURCE_ID)).toBeNull();

    serve(ok({}), httpError(404, "not found"));
    expect(await loadResourceAgentHint(CEPH, RESOURCE_ID)).toBeNull();

    expect(postsTo(RESOURCE_STATUS_ROUTE)[0]!["data"]).toEqual({
      resourceType: AiResourceType.CephCluster,
      resourceId: RESOURCE_ID,
    });
  });
});

describe("the page, given any scope", () => {
  const LOGS: Route = new Route("/dashboard/p/some-scope/1/ai/logs");
  const AGENT: Route = new Route("/dashboard/p/some-scope/1/ai/agent");

  function Harness(props: {
    loadAgentHint?: (() => Promise<string | null>) | undefined;
  }): React.ReactElement {
    const [renders, setRenders] = useState<number>(0);
    const [scope, setScope] = useState<string>("scope-1");

    return (
      <>
        <button
          onClick={() => {
            setRenders(renders + 1);
          }}
        >
          re-render
        </button>
        <button
          onClick={() => {
            setScope("scope-2");
          }}
        >
          another scope
        </button>
        <AiActivityInsightsPage
          noun="widget"
          insightsRoute={RESOURCE_INSIGHTS_ROUTE}
          // A fresh body and callback every render, as callers write them.
          requestBody={{ scope, renders }}
          requestKey={scope}
          logsRoute={LOGS}
          agentRoute={AGENT}
          loadAgentHint={props.loadAgentHint}
          emptyStateId="widget-insights-empty"
        />
      </>
    );
  }

  function openHarness(
    loadAgentHint?: (() => Promise<string | null>) | undefined,
  ): void {
    render(
      <MemoryRouter>
        <Harness loadAgentHint={loadAgentHint} />
      </MemoryRouter>,
    );
  }

  test("reloads for another scope, never for a re-render", async () => {
    openHarness();
    await findText("Needs attention");

    fireEvent.click(screen.getByText("re-render"));
    fireEvent.click(screen.getByText("re-render"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(postsTo(RESOURCE_INSIGHTS_ROUTE)).toHaveLength(1);
    expect(postsTo(RESOURCE_INSIGHTS_ROUTE)[0]!["data"]).toEqual({
      scope: "scope-1",
      renders: 0,
    });

    fireEvent.click(screen.getByText("another scope"));
    await waitFor(
      () => {
        expect(postsTo(RESOURCE_INSIGHTS_ROUTE)).toHaveLength(2);
      },
      { timeout: WAIT_TIMEOUT },
    );
    // The body as it is when the scope changes.
    expect(postsTo(RESOURCE_INSIGHTS_ROUTE)[1]!["data"]).toEqual({
      scope: "scope-2",
      renders: 2,
    });
  });

  test("words everything with the noun it is given, and links to the routes it is given", async () => {
    serve(ok(toBody(makeEmptyInsights())));
    openHarness();

    expect(
      await findText(getAiInsightsEmptyDescription("widget")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(getAiInsightsPageSubtitle("widget")),
    ).toBeInTheDocument();
    expect(hrefOf(screen.getByText("Open AI Logs"))).toBe(LOGS.toString());
    expect(hrefOf(screen.getByTestId("ai-insights-logs-link"))).toBe(
      LOGS.toString(),
    );
    expect(document.getElementById("widget-insights-empty")).not.toBeNull();
  });

  test("works without an agent pointer, and a pointer that fails is left out", async () => {
    openHarness(undefined);
    expect(await findText("Needs attention")).toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-insights-agent-hint"),
    ).not.toBeInTheDocument();
    cleanup();

    let failingCalls: number = 0;
    const failing: () => Promise<string | null> = async (): Promise<
      string | null
    > => {
      failingCalls++;
      throw new Error("status route is down");
    };
    openHarness(failing);
    expect(await findText("Needs attention")).toBeInTheDocument();
    await waitFor(
      () => {
        expect(failingCalls).toBe(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(
      screen.queryByTestId("ai-insights-agent-hint"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-insights-error")).not.toBeInTheDocument();
  });

  test("a pointer it is given links to the agent route it is given", async () => {
    openHarness(async (): Promise<string | null> => {
      return "AI cannot reach this widget.";
    });

    const hint: HTMLElement = await findTestId("ai-insights-agent-hint");
    expect(hint).toHaveTextContent("AI cannot reach this widget.");
    expect(hrefOf(within(hint).getByText("Open the AI agent page"))).toBe(
      AGENT.toString(),
    );
  });
});

describe("where attention items link", () => {
  const LOGS: Route = new Route("/logs");
  const AGENT: Route = new Route("/agent");

  function target(
    item: Partial<AiActivityAttentionItem> & { kind: AiActivityAttentionKind },
  ): { route: string; label: string } | null {
    const found: { route: Route; label: string } | null = getAttentionTarget(
      {
        severity: AiActivityAttentionSeverity.Medium,
        count: 1,
        ...item,
      },
      { logsRoute: LOGS, agentRoute: AGENT },
    );
    return found ? { route: found.route.toString(), label: found.label } : null;
  }

  beforeEach(() => {
    goTo(clusterPath(PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS));
  });

  test("an incident or alert to act on is linked first", () => {
    expect(
      target({
        kind: AiActivityAttentionKind.FixesFailed,
        subject: { kind: "incident", id: INCIDENT_ID },
      }),
    ).toEqual({ route: INCIDENT_HREF, label: "Open incident" });
    expect(
      target({
        kind: AiActivityAttentionKind.FixesAwaitingApproval,
        subject: { kind: "alert", id: ALERT_ID },
      }),
    ).toEqual({ route: ALERT_HREF, label: "Open alert" });
    // Even for commands, an incident to act on wins.
    expect(
      target({
        kind: AiActivityAttentionKind.CommandsTimedOut,
        subject: { kind: "incident", id: INCIDENT_ID },
      }),
    ).toEqual({ route: INCIDENT_HREF, label: "Open incident" });
  });

  test("a preventive insight links to the insight, or nowhere without one", () => {
    expect(
      target({
        kind: AiActivityAttentionKind.PreventiveInsight,
        insightId: INSIGHT_ID,
        subject: { kind: "incident", id: INCIDENT_ID },
      }),
    ).toEqual({ route: INSIGHT_HREF, label: "Open insight" });
    expect(target({ kind: AiActivityAttentionKind.PreventiveInsight })).toBe(
      null,
    );
  });

  test("commands the agent never ran link to the AI agent page", () => {
    expect(target({ kind: AiActivityAttentionKind.CommandsTimedOut })).toEqual({
      route: "/agent",
      label: "Open the AI agent page",
    });
  });

  test("a hotspot links nowhere; everything else to AI Logs", () => {
    expect(target({ kind: AiActivityAttentionKind.Hotspot })).toBeNull();
    for (const kind of [
      AiActivityAttentionKind.FixesFailed,
      AiActivityAttentionKind.RecurringProblem,
      AiActivityAttentionKind.FixesAwaitingApproval,
      AiActivityAttentionKind.InvestigationsFailed,
      AiActivityAttentionKind.FindingsRejected,
    ]) {
      expect(target({ kind })).toEqual({
        route: "/logs",
        label: "Open AI Logs",
      });
    }
  });

  test("incidents, alerts and insights link to their own pages in this project", () => {
    expect(
      getSubjectRoute({ kind: "incident", id: INCIDENT_ID }).toString(),
    ).toBe(INCIDENT_HREF);
    expect(getSubjectRoute({ kind: "alert", id: ALERT_ID }).toString()).toBe(
      ALERT_HREF,
    );
    expect(getPreventiveInsightRoute(INSIGHT_ID).toString()).toBe(INSIGHT_HREF);
  });
});
