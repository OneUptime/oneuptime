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
  AiInsightTarget,
  AiInsightsRoutes,
  getInsightNote,
  getInsightTarget,
  getMonitorRoute,
  getOtherPreventiveInsights,
  getOtherProblems,
  getPreventiveInsightRoute,
  getServiceRoute,
  getSubjectRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsView";
import {
  AI_INSIGHTS_EMPTY_TITLE,
  AI_INSIGHTS_PAGE_TITLE,
  getAiInsightsEmptyDescription,
  getAiInsightsPageSubtitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  PROJECT_AI_OFF_NOTICE_TEST_ID,
  PROJECT_AI_PROVIDER_NOTICE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import KubernetesClusterAIInsights, {
  KUBERNETES_AI_INSIGHTS_NOUN,
  KUBERNETES_OBJECT_PAGES,
  getKubernetesObjectRoute,
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
import Project from "../../../Models/DatabaseModels/Project";
import {
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
  AiActivityInsights,
  AiActivityPreventiveInsight,
  AiActivityProblem,
} from "../../../Types/AI/AiActivityInsights";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
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
import Timezone from "../../../Types/Timezone";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  ALERT_ID,
  INCIDENT_ID,
  INSIGHT_ID,
  NEXT_STEP,
  ONE_OFF_PROBLEM_KEY,
  PREVENTIVE_INSIGHT_TITLE,
  RECURRING_PROBLEM_KEY,
  RECURRING_PROBLEM_TITLE,
  REPORT_FINDING,
  SECOND_INCIDENT_ID,
  SECOND_INSIGHT_ID,
  SECOND_PREVENTIVE_INSIGHT_TITLE,
  STOPPED_INCIDENT_ID,
  STOPPED_PROBLEM_KEY,
  STOPPED_PROBLEM_TITLE,
  TLDR_FINDING,
  insightOfKind,
  makeEmptyInsights,
  makeInsights,
  makeQuietInsights,
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
 * through its thin page — with the insights, access status and AI readiness
 * reads stubbed. They answer "what is worth knowing about my system?", not
 * "what did AI do?": the problem that keeps coming back, getting worse, at
 * the same time of night, with what AI found and what it suggests and the
 * incidents behind it; the node behind most of the trouble, linked to its
 * own page; the fix that did not help, the one waiting, the one AI applied
 * on its own; the risk spotted before anything paged; the problem that
 * stopped. What AI did is a footnote at the end, and everything it did is on
 * AI Logs.
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
const PROVIDERS_ROUTE: string = "/ai-chat/providers";

const K8S_NOT_READY_HINT: string =
  "OneUptime AI can't run kubectl on this cluster right now.";
const K8S_AUTOMATIC_OFF_HINT: string =
  "Automatic investigation is off for new incidents and alerts in this project.";

const INCIDENT_HREF: string = `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`;
const SECOND_INCIDENT_HREF: string = `/dashboard/${PROJECT_ID}/incidents/${SECOND_INCIDENT_ID}`;
const STOPPED_INCIDENT_HREF: string = `/dashboard/${PROJECT_ID}/incidents/${STOPPED_INCIDENT_ID}`;
const ALERT_HREF: string = `/dashboard/${PROJECT_ID}/alerts/${ALERT_ID}`;
const INSIGHT_HREF: string = `/dashboard/${PROJECT_ID}/ai/insights/${INSIGHT_ID}`;
const SECOND_INSIGHT_HREF: string = `/dashboard/${PROJECT_ID}/ai/insights/${SECOND_INSIGHT_ID}`;

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

const USABLE_PROVIDER: JSONObject = {
  isAIEnabledForProject: true,
  defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
  providers: [
    {
      id: "9d9d9d9d-0000-4000-8000-000000000001",
      name: "OneUptime AI",
      isGlobal: true,
      isDefault: false,
    },
  ],
};

const NO_PROVIDER: JSONObject = {
  isAIEnabledForProject: true,
  defaultProviderId: null,
  providers: [],
};

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
let providersAnswer: Answer = ok(USABLE_PROVIDER);
// Project.enableAi, as the AI readiness read finds it.
let isAiOn: boolean = true;

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

function pathFor(page: PageMap, id: string, subId?: string): string {
  return RouteMap[page]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", id)
    .replace(":subModelId", subId || ":subModelId");
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
const NODE_3_HREF: string = pathFor(
  PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL,
  CLUSTER_ID,
  "node-3",
);
const NAMESPACE_HREF: string = pathFor(
  PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL,
  CLUSTER_ID,
  "checkout",
);
const POD_HREF: string = pathFor(
  PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL,
  CLUSTER_ID,
  "web-7d9f-2xk",
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

// The links inside an element, as "text → href".
function linksIn(element: HTMLElement): Array<string> {
  return Array.from(element.querySelectorAll("a")).map(
    (anchor: HTMLAnchorElement): string => {
      return `${anchor.textContent?.trim()} → ${anchor.getAttribute("href")}`;
    },
  );
}

async function findInsightItems(): Promise<Array<HTMLElement>> {
  const list: HTMLElement = await findTestId("ai-insights-insights");
  return within(list).getAllByTestId("ai-insights-insight");
}

async function findInsight(kind: AiActivityInsightKind): Promise<HTMLElement> {
  const items: Array<HTMLElement> = await findInsightItems();
  const item: HTMLElement | undefined = items.find(
    (candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-kind") === kind;
    },
  );

  if (!item) {
    throw new Error(`No ${kind} insight on the page.`);
  }

  return item;
}

async function waitForStatusRequest(route: string): Promise<void> {
  await waitFor(
    () => {
      expect(postsTo(route)).toHaveLength(1);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

function follows(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();

  insightsAnswers = [ok(toBody(makeInsights()))];
  statusAnswer = ok(makeK8sStatus());
  providersAnswer = ok(USABLE_PROVIDER);
  isAiOn = true;

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
      if (url.endsWith(PROVIDERS_ROUTE)) {
        return await providersAnswer();
      }
      throw new Error(`Unexpected request to ${url}`);
    },
  );
  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<Project> => {
      return Object.assign(new Project(), {
        _id: PROJECT_ID,
        enableAi: isAiOn,
      });
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  // Times in UTC, on a 24-hour clock, whatever machine runs the suite.
  jest
    .spyOn(OneUptimeDate, "getCurrentTimezone")
    .mockReturnValue("UTC" as Timezone);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the cluster's AI Insights page", () => {
  test("is titled AI Insights, promises what is worth knowing, and points at AI Logs", async () => {
    openClusterInsightsPage();

    const heading: HTMLElement = screen.getByTestId("ai-insights-page-heading");
    expect(
      within(heading).getByText(AI_INSIGHTS_PAGE_TITLE),
    ).toBeInTheDocument();
    expect(
      within(heading).getByText(
        "What OneUptime AI found out about this cluster in the last 30 days: what keeps going wrong and why, and what to do about it.",
      ),
    ).toBeInTheDocument();
    expect(hrefOf(screen.getByTestId("ai-insights-logs-link"))).toBe(
      K8S_LOGS_HREF,
    );
    expect(screen.getByTestId("ai-insights-logs-link")).toHaveTextContent(
      "See everything AI did in AI Logs",
    );

    // What it found comes first, under its own heading; what AI did, last.
    await findTestId("ai-insights-insights");
    const cardHeadings: Array<string> = screen
      .getAllByTestId("card-details-heading")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });
    expect(cardHeadings).toEqual([
      "What OneUptime AI found",
      "Other problems",
      "Where problems happen",
      "Also spotted before anything paged",
      "What OneUptime AI did here",
    ]);
  });

  test("asks the insights and status routes about this cluster", async () => {
    openClusterInsightsPage();
    await findTestId("ai-insights-insights");

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
    expect(
      screen.queryByTestId("ai-insights-insights"),
    ).not.toBeInTheDocument();
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

    expect(await findTestId("ai-insights-insights")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-insights-loading")).not.toBeInTheDocument();
  });

  describe("what OneUptime AI found", () => {
    test("leads with what is worth knowing, most important first, each in one line", async () => {
      openClusterInsightsPage();

      const items: Array<HTMLElement> = await findInsightItems();

      expect(
        items.map((item: HTMLElement): string => {
          return `${item.getAttribute("data-kind")}/${item.getAttribute("data-tone")}`;
        }),
      ).toEqual([
        "RecurringProblem/Critical",
        "FixesDidNotHelp/Critical",
        "RiskSpotted/Critical",
        "FixesAwaitingApproval/Warning",
        "Hotspot/Pattern",
        "FixedAutomatically/Positive",
        "ProblemStopped/Positive",
      ]);
      expect(
        items.map((item: HTMLElement): string => {
          return within(item).getByTestId("ai-insights-insight-headline")
            .textContent as string;
        }),
      ).toEqual([
        `${RECURRING_PROBLEM_TITLE} keeps coming back`,
        "A fix did not solve the problem it was for",
        `Spotted before anything paged: ${PREVENTIVE_INSIGHT_TITLE}`,
        "A fix is waiting for your approval",
        "Node node-3 is behind 2 different problems",
        "OneUptime AI applied a fix on its own",
        `${STOPPED_PROBLEM_TITLE} has stopped`,
      ]);
      // Each tone says what it means to a screen reader.
      expect(
        items.map((item: HTMLElement): string | null => {
          return within(item)
            .getByTestId("ai-insights-insight-icon")
            .getAttribute("aria-label");
        }),
      ).toEqual([
        "Needs attention now",
        "Needs attention now",
        "Needs attention now",
        "Worth acting on",
        "Worth knowing",
        "Good news",
        "Good news",
      ]);
      expect(
        screen.getByText(
          "The most important first, each with what is behind it and what to do next.",
        ),
      ).toBeInTheDocument();
    });

    test("the problem that keeps coming back: getting worse, how often, when, what AI found and suggests, where, and what is behind it", async () => {
      openClusterInsightsPage();

      const item: HTMLElement = await findInsight(
        AiActivityInsightKind.RecurringProblem,
      );

      expect(within(item).getByTestId("ai-insights-badge")).toHaveTextContent(
        "Getting worse",
      );
      expect(
        within(item).getByTestId("ai-insights-insight-facts"),
      ).toHaveTextContent(
        "It happened 12 times in the last 30 days. 5 of them were in the last 7 days, up from 2 the 7 days before. That is 12 of the 20 incidents and alerts on this cluster in the last 30 days.",
      );
      expect(
        within(item).getByTestId("ai-insights-time-of-day"),
      ).toHaveTextContent(
        "It usually starts between 01:00 and 04:00 (UTC): on 9 of the 10 days it happened.",
      );

      // The investigation's own words, under labels that say whose they are.
      expect(within(item).getByTestId("ai-insights-finding")).toHaveTextContent(
        `What OneUptime AI found${TLDR_FINDING}`,
      );
      expect(
        within(item).getByTestId("ai-insights-next-step"),
      ).toHaveTextContent(`What it suggests${NEXT_STEP}`);
      expect(
        within(item).queryByText("(from the investigation's report)"),
      ).not.toBeInTheDocument();

      // Where: each part linked to its own page in the cluster.
      expect(
        linksIn(within(item).getByTestId("ai-insights-insight-objects")),
      ).toEqual([
        `Namespace: checkout → ${NAMESPACE_HREF}`,
        `Pod: web-7d9f-2xk → ${POD_HREF}`,
      ]);

      // What is behind it: the newest incidents, and how many more.
      const evidence: HTMLElement = within(item).getByTestId(
        "ai-insights-evidence",
      );
      expect(evidence).toHaveTextContent("Behind it:");
      expect(linksIn(evidence)).toEqual([
        `Incident #42 → ${INCIDENT_HREF}`,
        `Incident #40 → ${SECOND_INCIDENT_HREF}`,
      ]);
      expect(
        within(evidence).getByTestId("ai-insights-evidence-more"),
      ).toHaveTextContent("and 10 more");

      // How its fixes went, and what people said of its findings.
      expect(
        within(item).getByTestId("ai-insights-insight-fixes"),
      ).toHaveTextContent(
        "3 fixes proposed · 2 applied · 1 verified · 1 did not help · 1 waiting for approval",
      );
      expect(
        within(item).getByTestId("ai-insights-insight-verdicts"),
      ).toHaveTextContent(
        "your team confirmed 2 findings · your team rejected 1 finding · 2 findings matched the root cause recorded later",
      );

      // One next step: the newest incident behind it.
      expect(
        linksIn(within(item).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Open incident → ${INCIDENT_HREF}`]);
    });

    test("a problem that started this week is new, and says when it started", async () => {
      const insights: AiActivityInsights = makeInsights();
      insights.insights[0] = {
        ...insights.insights[0]!,
        count: 4,
        total: 20,
        recentCount: 4,
        previousCount: 0,
        firstSeenAt: "2026-09-28T01:10:00.000Z",
      };
      serve(ok(toBody(insights)));
      openClusterInsightsPage();

      const item: HTMLElement = await findInsight(
        AiActivityInsightKind.RecurringProblem,
      );

      expect(within(item).getByTestId("ai-insights-badge")).toHaveTextContent(
        "New this week",
      );
      expect(
        within(item).getByTestId("ai-insights-insight-facts"),
      ).toHaveTextContent(/^It happened 4 times in the last 30 days\. It started /);
    });

    test("the part behind most of the trouble links to its own page in the cluster", async () => {
      openClusterInsightsPage();

      const item: HTMLElement = await findInsight(AiActivityInsightKind.Hotspot);

      expect(
        within(item).getByTestId("ai-insights-insight-facts"),
      ).toHaveTextContent(
        "It was part of 14 of the 20 incidents and alerts on this cluster in the last 30 days. Problems that share one place often share one cause: look there first.",
      );
      expect(
        linksIn(within(item).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Open node → ${NODE_3_HREF}`]);
      expect(linksIn(within(item).getByTestId("ai-insights-evidence"))).toEqual(
        [
          `Alert #812 → ${ALERT_HREF}`,
          `Incident #42 → ${INCIDENT_HREF}`,
          `Incident #40 → ${SECOND_INCIDENT_HREF}`,
        ],
      );
      expect(
        within(item).getByTestId("ai-insights-evidence-more"),
      ).toHaveTextContent("and 11 more");
    });

    test("the fixes: the one that did not help, the one waiting, the one AI applied on its own", async () => {
      openClusterInsightsPage();

      const didNotHelp: HTMLElement = await findInsight(
        AiActivityInsightKind.FixesDidNotHelp,
      );
      expect(
        within(didNotHelp).getByTestId("ai-insights-insight-facts"),
      ).toHaveTextContent(
        "OneUptime AI checked after it was applied: the problem was still there. That is 1 of the 4 fixes applied in the last 30 days.",
      );
      expect(
        linksIn(within(didNotHelp).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Open incident → ${INCIDENT_HREF}`]);
      // Behind it is the one incident: nothing more to count.
      expect(
        within(didNotHelp).queryByTestId("ai-insights-evidence-more"),
      ).not.toBeInTheDocument();

      const waiting: HTMLElement = await findInsight(
        AiActivityInsightKind.FixesAwaitingApproval,
      );
      expect(
        within(waiting).getByTestId("ai-insights-insight-facts"),
      ).toHaveTextContent(
        "OneUptime AI has it ready: it runs as soon as someone approves it.",
      );
      expect(
        linksIn(within(waiting).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Review the fix → ${INCIDENT_HREF}`]);

      const automatic: HTMLElement = await findInsight(
        AiActivityInsightKind.FixedAutomatically,
      );
      expect(
        within(automatic).getByTestId("ai-insights-insight-facts"),
      ).toHaveTextContent(
        "It checked afterwards: the problem was gone. Nobody had to approve it first.",
      );
      expect(
        linksIn(within(automatic).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Open AI Logs → ${K8S_LOGS_HREF}`]);
    });

    test("a risk spotted before anything paged links to the finding", async () => {
      openClusterInsightsPage();

      const item: HTMLElement = await findInsight(
        AiActivityInsightKind.RiskSpotted,
      );

      expect(
        within(item).getByTestId("ai-insights-insight-facts"),
      ).toHaveTextContent(
        /^Seen 3 times so far, last .+ ago\. OneUptime AI's watch on the telemetry found it; nothing has paged anyone for it yet\.$/,
      );
      expect(
        linksIn(within(item).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Open insight → ${INSIGHT_HREF}`]);
    });

    test("a problem that stopped: since when, and the incident to look back at", async () => {
      openClusterInsightsPage();

      const item: HTMLElement = await findInsight(
        AiActivityInsightKind.ProblemStopped,
      );

      expect(
        within(item).getByTestId("ai-insights-insight-facts"),
      ).toHaveTextContent(
        "It happened 6 times, and not once since the fix on 12 Sep. OneUptime AI checked the fix afterwards: the problem was gone.",
      );
      expect(
        linksIn(within(item).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Open incident → ${STOPPED_INCIDENT_HREF}`]);
      // Only a problem that keeps coming back wears a badge.
      expect(
        within(item).queryByTestId("ai-insights-badge"),
      ).not.toBeInTheDocument();
    });

    test("says plainly when nothing stands out, and still shows what AI looked into", async () => {
      serve(ok(toBody(makeQuietInsights())));
      openClusterInsightsPage();

      const quiet: HTMLElement = await findTestId(
        "ai-insights-nothing-stands-out",
      );
      expect(quiet).toHaveTextContent("Nothing stands out right now");
      expect(quiet).toHaveTextContent(
        "No problem came back three times or more, no fix needs you, and no risk is waiting. What OneUptime AI looked into is below.",
      );
      expect(
        screen.queryByTestId("ai-insights-insights"),
      ).not.toBeInTheDocument();

      // Nothing is told above: every problem is listed, under "Problems".
      expect(screen.getByText("Problems")).toBeInTheDocument();
      expect(screen.queryByText("Other problems")).not.toBeInTheDocument();
      expect(
        screen
          .getAllByTestId("ai-insights-problem")
          .map((problem: HTMLElement): string | null => {
            return problem.getAttribute("data-problem-key");
          }),
      ).toEqual([ONE_OFF_PROBLEM_KEY]);

      // No parts, no risks, no fixes: no cards for them at all.
      expect(screen.queryByText("Where problems happen")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("ai-insights-preventive-list"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("ai-insights-fixes")).not.toBeInTheDocument();
      // The window still has activity: no empty state.
      expect(screen.queryByTestId("ai-insights-empty")).not.toBeInTheDocument();
      expect(screen.getByTestId("ai-insights-summary")).toBeInTheDocument();
    });
  });

  describe("the rest of what AI looked into", () => {
    test("the problems the insights above do not already tell, with what AI found", async () => {
      openClusterInsightsPage();

      expect(await findText("Other problems")).toBeInTheDocument();
      expect(
        screen.getByText(
          "The rest of what OneUptime AI looked into here, the most frequent first, with what it found and suggests.",
        ),
      ).toBeInTheDocument();

      // The recurring and the stopped problems are told above: not again.
      const problems: Array<HTMLElement> = screen.getAllByTestId(
        "ai-insights-problem",
      );
      expect(
        problems.map((problem: HTMLElement): string | null => {
          return problem.getAttribute("data-problem-key");
        }),
      ).toEqual([ONE_OFF_PROBLEM_KEY]);

      const oneOff: HTMLElement = problems[0]!;
      expect(hrefOf(within(oneOff).getByText("Disk almost full"))).toBe(
        ALERT_HREF,
      );
      expect(
        within(oneOff).getByTestId("ai-insights-problem-count"),
      ).toHaveTextContent(/^1 time · investigated 1 time · last seen /);
      expect(
        within(oneOff).queryByTestId("ai-insights-badge"),
      ).not.toBeInTheDocument();
      expect(
        linksIn(within(oneOff).getByTestId("ai-insights-problem-objects")),
      ).toEqual([`Node: node-3 → ${NODE_3_HREF}`]);
      // Its TL;DR call failed: the finding is what its report said.
      expect(
        within(oneOff).getByTestId("ai-insights-finding"),
      ).toHaveTextContent(REPORT_FINDING);
      expect(
        within(oneOff).getByText("(from the investigation's report)"),
      ).toBeInTheDocument();
      expect(
        within(oneOff).queryByTestId("ai-insights-problem-fixes"),
      ).not.toBeInTheDocument();
      expect(
        within(oneOff).queryByTestId("ai-insights-problem-verdicts"),
      ).not.toBeInTheDocument();
    });

    test("a problem listed with its badge, time of day, next step, fixes and verdicts, when nothing above tells it", async () => {
      serve(ok(toBody(makeInsights({ insights: [] }))));
      openClusterInsightsPage();

      expect(await findText("Problems")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Grouped by what raised them, the most frequent first, with what OneUptime AI found and suggests.",
        ),
      ).toBeInTheDocument();
      const problems: Array<HTMLElement> = screen.getAllByTestId(
        "ai-insights-problem",
      );
      expect(
        problems.map((problem: HTMLElement): string | null => {
          return problem.getAttribute("data-problem-key");
        }),
      ).toEqual([RECURRING_PROBLEM_KEY, STOPPED_PROBLEM_KEY, ONE_OFF_PROBLEM_KEY]);

      const recurring: HTMLElement = problems[0]!;
      expect(hrefOf(within(recurring).getByText(RECURRING_PROBLEM_TITLE))).toBe(
        INCIDENT_HREF,
      );
      expect(
        within(recurring).getByTestId("ai-insights-badge"),
      ).toHaveTextContent("Getting worse");
      expect(
        within(recurring).getByTestId("ai-insights-problem-count"),
      ).toHaveTextContent(
        /^12 times · 5 in the last 7 days · investigated 5 times · last seen /,
      );
      expect(
        within(recurring).getByTestId("ai-insights-problem-time-of-day"),
      ).toHaveTextContent(
        "It usually starts between 01:00 and 04:00 (UTC): on 9 of the 10 days it happened.",
      );
      expect(
        within(recurring).getByTestId("ai-insights-next-step"),
      ).toHaveTextContent(NEXT_STEP);
      expect(
        within(
          within(recurring).getByTestId("ai-insights-problem-objects"),
        ).getByText("Namespace: checkout ×12"),
      ).toBeInTheDocument();
      expect(
        within(recurring).getByTestId("ai-insights-problem-fixes"),
      ).toHaveTextContent(
        "3 fixes proposed · 2 applied · 1 verified · 1 did not help · 1 waiting for approval",
      );
      expect(
        within(recurring).getByTestId("ai-insights-problem-verdicts"),
      ).toHaveTextContent(/^your team confirmed 2 findings/);

      // A problem that kept coming back, neither new nor worse: Recurring.
      expect(
        within(problems[1]!).getByTestId("ai-insights-badge"),
      ).toHaveTextContent("Recurring");
      // No finding yet: it says so.
      expect(
        within(problems[1]!).getByTestId("ai-insights-problem-no-finding"),
      ).toHaveTextContent("No finding recorded for this problem yet.");
    });

    test("only a problem that came back wears a badge: new this week, getting worse, else recurring", async () => {
      const insights: AiActivityInsights = makeInsights({ insights: [] });
      // The node problem came back twice this week, and started this week.
      insights.problems[1] = {
        ...insights.problems[1]!,
        firstSeenAt: "2026-09-28T04:00:00.000Z",
        recentOccurrenceCount: 2,
      };
      serve(ok(toBody(insights)));
      openClusterInsightsPage();

      const problems: Array<HTMLElement> = await screen.findAllByTestId(
        "ai-insights-problem",
        {},
        { timeout: WAIT_TIMEOUT },
      );

      expect(
        problems.map((problem: HTMLElement): string => {
          return (
            within(problem).queryByTestId("ai-insights-badge")?.textContent ||
            ""
          );
        }),
      ).toEqual([
        "Getting worse",
        "New this week",
        // The disk alert came up once, this week: just listed.
        "",
      ]);
    });

    test("with every problem told above, there is no problems card", async () => {
      const insights: AiActivityInsights = makeInsights();
      insights.problems = insights.problems.slice(0, 2);
      serve(ok(toBody(insights)));
      openClusterInsightsPage();

      await findTestId("ai-insights-insights");
      expect(screen.queryByTestId("ai-insights-problems")).not.toBeInTheDocument();
      expect(screen.queryByText("Other problems")).not.toBeInTheDocument();
    });

    test("where problems happen: the parts that came up the most, each linked to its own page", async () => {
      openClusterInsightsPage();

      expect(await findText("Where problems happen")).toBeInTheDocument();
      expect(
        screen.getByText(
          "The parts of this cluster that came up the most, and in how many different problems.",
        ),
      ).toBeInTheDocument();
      const hotspots: Array<HTMLElement> = screen.getAllByTestId(
        "ai-insights-hotspot",
      );
      expect(hotspots).toHaveLength(2);
      expect(linksIn(hotspots[0]!)).toEqual([
        `Node: node-3 → ${NODE_3_HREF}`,
      ]);
      expect(hotspots[0]).toHaveTextContent(
        /14 times · 2 problems · last seen /,
      );
      expect(linksIn(hotspots[1]!)).toEqual([
        `Namespace: checkout → ${NAMESPACE_HREF}`,
      ]);
      expect(hotspots[1]).toHaveTextContent(/12 times · 1 problem · last seen /);
    });

    test("a part the cluster has no page for is named, not linked", async () => {
      const insights: AiActivityInsights = makeInsights();
      insights.hotspots = [
        {
          name: "Mount",
          value: "/var",
          key: "mountpoint",
          occurrenceCount: 4,
          investigationCount: 2,
          problemCount: 2,
        },
      ];
      serve(ok(toBody(insights)));
      openClusterInsightsPage();

      const hotspot: HTMLElement = await findTestId("ai-insights-hotspot");
      expect(within(hotspot).getByText("Mount: /var")).toBeInTheDocument();
      expect(linksIn(hotspot)).toEqual([]);
    });

    test("the risks the insights above do not already name, each linked to its finding", async () => {
      openClusterInsightsPage();

      expect(
        await findText("Also spotted before anything paged"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Open findings from OneUptime AI's watch on this cluster's own telemetry: spikes, slowdowns and drift, before they became an incident.",
        ),
      ).toBeInTheDocument();
      const rows: Array<HTMLElement> = screen.getAllByTestId(
        "ai-insights-preventive",
      );
      // The error-log spike is an insight above: only the other is listed.
      expect(rows).toHaveLength(1);
      expect(linksIn(rows[0]!)).toEqual([
        `${SECOND_PREVENTIVE_INSIGHT_TITLE} → ${SECOND_INSIGHT_HREF}`,
      ]);
      expect(within(rows[0]!).getByText("Medium")).toBeInTheDocument();
      expect(rows[0]).toHaveTextContent(/seen 1 time · last seen /);
    });

    test("with no risk named above, every open finding is listed, under its own title", async () => {
      const insights: AiActivityInsights = makeInsights();
      insights.insights = insights.insights.filter(
        (item: AiActivityInsight): boolean => {
          return item.kind !== AiActivityInsightKind.RiskSpotted;
        },
      );
      serve(ok(toBody(insights)));
      openClusterInsightsPage();

      expect(
        await findText("Spotted before anything paged"),
      ).toBeInTheDocument();
      expect(
        screen
          .getAllByTestId("ai-insights-preventive")
          .map((row: HTMLElement): Array<string> => {
            return linksIn(row);
          }),
      ).toEqual([
        [`${PREVENTIVE_INSIGHT_TITLE} → ${INSIGHT_HREF}`],
        [`${SECOND_PREVENTIVE_INSIGHT_TITLE} → ${SECOND_INSIGHT_HREF}`],
      ]);
    });
  });

  describe("what OneUptime AI did here: the footnote", () => {
    test("comes after what it found, and sums up the window with what failed", async () => {
      openClusterInsightsPage();

      const summary: HTMLElement = await findTestId("ai-insights-summary");
      const found: HTMLElement = screen.getByTestId("ai-insights-insights");
      expect(follows(found, summary)).toBe(true);
      expect(screen.getByText("What OneUptime AI did here")).toBeInTheDocument();
      expect(
        screen.getByText(
          "The last 30 days at a glance. Everything it did, one step at a time, is in AI Logs.",
        ),
      ).toBeInTheDocument();

      const stat: (name: string) => HTMLElement = (
        name: string,
      ): HTMLElement => {
        return within(summary).getByTestId(`ai-insights-stat-${name}`);
      };
      expect(stat("investigations")).toHaveTextContent(
        "Investigations81 failed or timed out",
      );
      expect(stat("fixes")).toHaveTextContent("Fixes41 verified");
      expect(stat("commands")).toHaveTextContent(
        "Commands372 failed, 1 never ran",
      );
      // A cluster has no coverage of its own.
      expect(
        within(summary).queryByTestId("ai-insights-stat-coverage"),
      ).not.toBeInTheDocument();
    });

    test("what went wrong with its own work, each with where to look, and what people confirmed", async () => {
      openClusterInsightsPage();

      const health: HTMLElement = await findTestId("ai-insights-health");
      const notes: Array<HTMLElement> = within(health).getAllByTestId(
        "ai-insights-health-note",
      );
      expect(
        notes.map((note: HTMLElement): string | null => {
          return note.getAttribute("data-kind");
        }),
      ).toEqual(["InvestigationsFailed", "CommandsTimedOut", "FindingsRejected"]);
      expect(notes[0]).toHaveTextContent(
        "1 investigation failed or timed out in the last 30 days.",
      );
      expect(linksIn(notes[0]!)).toEqual([`Open AI Logs → ${K8S_LOGS_HREF}`]);
      expect(notes[1]).toHaveTextContent(
        "1 command OneUptime AI sent was never picked up by the agent.",
      );
      expect(linksIn(notes[1]!)).toEqual([
        `Open the AI agent page → ${K8S_AGENT_HREF}`,
      ]);
      expect(notes[2]).toHaveTextContent(
        "1 finding was rejected by your team or did not match the root cause recorded later.",
      );
      expect(linksIn(notes[2]!)).toEqual([`Open AI Logs → ${K8S_LOGS_HREF}`]);
      expect(within(health).getByTestId("ai-insights-trust")).toHaveTextContent(
        "3 findings were confirmed by your team or matched the root cause recorded later.",
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

    test("nothing went wrong, nothing is said about it", async () => {
      serve(ok(toBody(makeQuietInsights())));
      openClusterInsightsPage();

      await findTestId("ai-insights-summary");
      expect(screen.queryByTestId("ai-insights-health")).not.toBeInTheDocument();
    });

    test("says when the numbers cover only the newest of what happened", async () => {
      serve(ok(toBody(makeInsights({ isPartial: true }))));
      openClusterInsightsPage();

      expect(await findTestId("ai-insights-partial")).toHaveTextContent(
        "There was more here than these insights read: they cover the newest of it.",
      );
      cleanup();

      serve(ok(toBody(makeInsights())));
      openClusterInsightsPage();
      await findTestId("ai-insights-summary");
      expect(
        screen.queryByTestId("ai-insights-partial"),
      ).not.toBeInTheDocument();
    });
  });

  test("never shows the AI Logs lists: those are on AI → Logs", async () => {
    openClusterInsightsPage();
    await findTestId("ai-insights-insights");

    expect(
      screen.queryByTestId("ai-logs-investigation"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-logs-fix")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No summary was recorded."),
    ).not.toBeInTheDocument();
  });

  // An icon is a <div>: inside a <p> or a heading it is invalid markup React warns about.
  test("never puts a block inside a paragraph or a heading", async () => {
    const BLOCK_IN_TEXT: string = "p div, p p, p ul, p dl, h3 div, h3 p";

    openClusterInsightsPage();
    await findTestId("ai-insights-insights");
    expect(document.querySelectorAll(BLOCK_IN_TEXT)).toHaveLength(0);
    cleanup();

    serve(ok(toBody(makeQuietInsights())));
    openClusterInsightsPage();
    await findTestId("ai-insights-nothing-stands-out");
    expect(document.querySelectorAll(BLOCK_IN_TEXT)).toHaveLength(0);
    cleanup();

    serve(
      ok(toBody(makeEmptyInsights())),
      ok(makeK8sStatus({ isInvestigationReady: false })),
    );
    openClusterInsightsPage();
    await findTestId("ai-insights-agent-hint");
    expect(document.querySelectorAll(BLOCK_IN_TEXT)).toHaveLength(0);
  });

  test("renders server text as text, never as markup", async () => {
    const insights: AiActivityInsights = makeInsights();
    insights.insights[0]!.title = "<img src='x' onerror='window.pwned=1'>";
    insights.insights[0]!.finding!.text = "<script>window.pwned=1</script>";
    insights.insights[0]!.nextStep = "<b>restart</b> it";
    insights.insights[4]!.object!.value = "<i>node-3</i>";
    insights.problems[2]!.title = "<u>disk</u>";
    insights.hotspots[0]!.value = "<b>checkout</b>";
    insights.preventiveInsights[1]!.title =
      "<a href='javascript:alert(1)'>x</a>";
    serve(ok(toBody(insights)));
    openClusterInsightsPage();

    expect(
      await findText(
        "<img src='x' onerror='window.pwned=1'> keeps coming back",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByTestId("ai-insights-finding")[0],
    ).toHaveTextContent("<script>window.pwned=1</script>");
    expect(
      screen.getAllByTestId("ai-insights-next-step")[0],
    ).toHaveTextContent("<b>restart</b> it");
    const hotspot: HTMLElement = screen
      .getAllByTestId("ai-insights-insight")
      .find((item: HTMLElement): boolean => {
        return item.getAttribute("data-kind") === "Hotspot";
      })!;
    expect(
      within(hotspot).getByText(
        "Node <i>node-3</i> is behind 2 different problems",
      ),
    ).toBeInTheDocument();
    // No Kubernetes object has that name: no page to open, the alert instead.
    expect(
      linksIn(within(hotspot).getByTestId("ai-insights-next-step-link")),
    ).toEqual([`Open alert → ${ALERT_HREF}`]);
    expect(screen.getByText("<u>disk</u>")).toBeInTheDocument();
    expect(screen.getByText("Node: <b>checkout</b>")).toBeInTheDocument();
    expect(
      screen.getByText("<a href='javascript:alert(1)'>x</a>"),
    ).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector("i")).toBeNull();
    expect(document.querySelector("u")).toBeNull();
    expect(document.querySelector("a[href^='javascript:']")).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  describe("without AI activity", () => {
    test("shows one empty state that says what will show up, pointing at AI Logs for anything older", async () => {
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
      // No row of zeros, and no "nothing stands out" either.
      expect(
        screen.queryByTestId("ai-insights-summary"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("ai-insights-nothing-stands-out"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("What OneUptime AI found")).not.toBeInTheDocument();
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
    const found: HTMLElement = await findTestId("ai-insights-insights");
    expect(follows(hint, found)).toBe(true);
  });

  describe("when OneUptime AI cannot work for the project", () => {
    test("with AI off, a notice above the insights says nothing new shows up here, and who can turn it on", async () => {
      isAiOn = false;
      openClusterInsightsPage();

      const notice: HTMLElement = await findTestId(PROJECT_AI_OFF_NOTICE_TEST_ID);
      expect(notice).toHaveTextContent(
        "OneUptime AI is off for this project, so nothing new is investigated or fixed, and nothing new shows up on this page.",
      );
      // What it found before is still worth knowing: the insights stay.
      const found: HTMLElement = await findTestId("ai-insights-insights");
      expect(follows(notice, found)).toBe(true);
      expect(
        follows(screen.getByTestId("ai-insights-page-heading"), notice),
      ).toBe(true);
    });

    test("with no LLM provider, a notice says so, and links to where one is added", async () => {
      providersAnswer = ok(NO_PROVIDER);
      openClusterInsightsPage();

      const notice: HTMLElement = await findTestId(
        PROJECT_AI_PROVIDER_NOTICE_TEST_ID,
      );
      expect(notice).toHaveTextContent(
        "This project has no LLM provider for OneUptime AI to use. Until it has one, nothing new is investigated, so nothing new shows up on this page.",
      );
      expect(hrefOf(within(notice).getByText("Add an LLM provider"))).toBe(
        `/dashboard/${PROJECT_ID}/settings/llm-providers`,
      );
    });

    test("with AI on and a provider, no notice", async () => {
      openClusterInsightsPage();
      await findTestId("ai-insights-insights");
      await waitFor(
        () => {
          expect(postsTo(PROVIDERS_ROUTE)).toHaveLength(1);
        },
        { timeout: WAIT_TIMEOUT },
      );

      expect(
        screen.queryByTestId(PROJECT_AI_OFF_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(PROJECT_AI_PROVIDER_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
    });

    test("an empty page with AI off says why above its empty state", async () => {
      isAiOn = false;
      serve(ok(toBody(makeEmptyInsights())));
      openClusterInsightsPage();

      const notice: HTMLElement = await findTestId(PROJECT_AI_OFF_NOTICE_TEST_ID);
      const empty: HTMLElement = await findTestId("ai-insights-empty");
      expect(follows(notice, empty)).toBe(true);
    });
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

      expect(await findTestId("ai-insights-insights")).toBeInTheDocument();
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
        if (url.endsWith(PROVIDERS_ROUTE)) {
          return new HTTPResponse<JSONObject>(200, USABLE_PROVIDER, {});
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

    expect(
      screen.queryByTestId("ai-insights-insights"),
    ).not.toBeInTheDocument();
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

describe("a part of the cluster, on its own page", () => {
  beforeEach(() => {
    goTo(clusterPath(PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS));
  });

  test.each([
    ["k8s.node.name", "nodes"],
    ["k8s.pod.name", "pods"],
    ["k8s.namespace.name", "namespaces"],
    ["k8s.deployment.name", "deployments"],
    ["k8s.statefulset.name", "statefulsets"],
    ["k8s.daemonset.name", "daemonsets"],
    ["k8s.job.name", "jobs"],
    ["k8s.cronjob.name", "cronjobs"],
    ["k8s.container.name", "containers"],
    ["k8s.persistentvolumeclaim.name", "pvcs"],
    ["k8s.hpa.name", "hpas"],
  ])("a part read from %s opens the cluster's %s page for it, by name", (key: string, segment: string) => {
    expect(
      getKubernetesObjectRoute(CLUSTER_ID, {
        name: "Part",
        value: "web-1",
        key,
      })!.toString(),
    ).toBe(
      `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/${segment}/web-1`,
    );
  });

  test("every label the table names has a page", () => {
    for (const [key, page] of Object.entries(KUBERNETES_OBJECT_PAGES)) {
      expect(RouteMap[page]).toBeDefined();
      expect(
        getKubernetesObjectRoute(CLUSTER_ID, { name: "x", value: "y", key }),
      ).not.toBeNull();
    }
  });

  test("a part without a label, of a label without a page, or without a cluster is named, not linked", () => {
    expect(
      getKubernetesObjectRoute(CLUSTER_ID, { name: "Node", value: "node-3" }),
    ).toBeNull();
    expect(
      getKubernetesObjectRoute(CLUSTER_ID, {
        name: "Mount",
        value: "/var",
        key: "mountpoint",
      }),
    ).toBeNull();
    expect(
      getKubernetesObjectRoute("", {
        name: "Node",
        value: "node-3",
        key: "k8s.node.name",
      }),
    ).toBeNull();
    expect(
      getKubernetesObjectRoute(CLUSTER_ID, {
        name: "Node",
        value: "",
        key: "k8s.node.name",
      }),
    ).toBeNull();
  });

  test.each([
    ["markup", "<i>node-3</i>"],
    ["a space", "web 1"],
    ["a slash", "kube-system/web"],
    ["a scheme", "javascript:alert(1)"],
    ["capitals", "Web-1"],
    ["a leading dash", "-web"],
    ["a trailing dot", "web."],
    ["a name longer than Kubernetes allows", `w${"e".repeat(252)}b`],
  ])(
    "a value with %s is no Kubernetes object's name: named, not linked, and never a crash",
    (_label: string, value: string) => {
      expect(
        getKubernetesObjectRoute(CLUSTER_ID, {
          name: "Pod",
          value,
          key: "k8s.pod.name",
        }),
      ).toBeNull();
    },
  );

  test("the longest name Kubernetes allows, and a dotted one, are linked", () => {
    const longest: string = `w${"e".repeat(251)}b`;

    expect(longest).toHaveLength(253);
    expect(
      getKubernetesObjectRoute(CLUSTER_ID, {
        name: "Pod",
        value: longest,
        key: "k8s.pod.name",
      })!.toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/pods/${longest}`);
    expect(
      getKubernetesObjectRoute(CLUSTER_ID, {
        name: "Node",
        value: "ip-10-0-1-23.ec2.internal",
        key: "k8s.node.name",
      })!.toString(),
    ).toBe(
      `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/nodes/ip-10-0-1-23.ec2.internal`,
    );
  });

  test("a cluster id no route can hold links nothing, and never crashes", () => {
    expect(
      getKubernetesObjectRoute("<cluster>", {
        name: "Node",
        value: "node-3",
        key: "k8s.node.name",
      }),
    ).toBeNull();
  });

  test.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "a label named %s is no page of the table's",
    (key: string) => {
      expect(
        getKubernetesObjectRoute(CLUSTER_ID, { name: "x", value: "y", key }),
      ).toBeNull();
    },
  );
});

describe("every resource with a resource AI agent", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: its thin page asks about this resource and links to its own AI pages",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      statusAnswer = ok(makeResourceStatus(type));
      openResourceInsightsPage(type);

      const items: Array<HTMLElement> = await findInsightItems();
      expect(items).toHaveLength(makeInsights().insights.length);
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
          `The parts of this ${descriptor.noun} that came up the most, and in how many different problems.`,
        ),
      ).toBeInTheDocument();

      const logsHref: string = pathFor(descriptor.logsPage, RESOURCE_ID);
      const agentHref: string = pathFor(descriptor.agentPage, RESOURCE_ID);
      expect(logsHref).toMatch(/\/ai\/logs$/);
      expect(agentHref).toMatch(/\/ai\/agent$/);
      expect(hrefOf(screen.getByTestId("ai-insights-logs-link"))).toBe(
        logsHref,
      );
      // A command no agent ran points at this resource's AI agent page.
      expect(hrefOf(screen.getByText("Open the AI agent page"))).toBe(
        agentHref,
      );

      const automatic: HTMLElement = await findInsight(
        AiActivityInsightKind.FixedAutomatically,
      );
      expect(
        linksIn(within(automatic).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Open AI Logs → ${logsHref}`]);

      // A resource's parts have no page of their own: named, not linked,
      // and its hotspot opens the newest alert behind it instead.
      const hotspot: HTMLElement = await findInsight(
        AiActivityInsightKind.Hotspot,
      );
      expect(
        linksIn(within(hotspot).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Open alert → ${ALERT_HREF}`]);
      const recurring: HTMLElement = await findInsight(
        AiActivityInsightKind.RecurringProblem,
      );
      expect(
        linksIn(within(recurring).getByTestId("ai-insights-insight-objects")),
      ).toEqual([]);
      expect(
        within(recurring).getByText("Namespace: checkout"),
      ).toBeInTheDocument();
      expect(
        linksIn(within(recurring).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Open incident → ${INCIDENT_HREF}`]);
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
        if (url.endsWith(PROVIDERS_ROUTE)) {
          return new HTTPResponse<JSONObject>(200, USABLE_PROVIDER, {});
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

    expect(
      screen.queryByTestId("ai-insights-insights"),
    ).not.toBeInTheDocument();
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
    await findTestId("ai-insights-insights");

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
    expect(await findTestId("ai-insights-insights")).toBeInTheDocument();
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
    expect(await findTestId("ai-insights-insights")).toBeInTheDocument();
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

describe("where each insight leads", () => {
  const LOGS: Route = new Route("/logs");
  const AGENT: Route = new Route("/agent");
  const SETTINGS: Route = new Route("/settings");

  const ROUTES: AiInsightsRoutes = { logsRoute: LOGS, agentRoute: AGENT };

  function target(
    item: AiActivityInsight,
    routes: AiInsightsRoutes = ROUTES,
  ): { route: string; label: string; values?: unknown } | null {
    const found: AiInsightTarget | null = getInsightTarget(item, routes);

    return found
      ? {
          route: found.route.toString(),
          label: found.label,
          ...(found.values ? { values: found.values } : {}),
        }
      : null;
  }

  function bare(
    kind: AiActivityInsightKind,
    overrides: Partial<AiActivityInsight> = {},
  ): AiActivityInsight {
    return {
      kind,
      tone: AiActivityInsightTone.Pattern,
      count: 1,
      ...overrides,
    };
  }

  beforeEach(() => {
    goTo(clusterPath(PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS));
  });

  test("a problem, a fix that did not help, or a problem that stopped opens the newest incident or alert behind it", () => {
    for (const kind of [
      AiActivityInsightKind.RecurringProblem,
      AiActivityInsightKind.FixesDidNotHelp,
      AiActivityInsightKind.ProblemStopped,
    ]) {
      expect(
        target(bare(kind, { subject: { kind: "incident", id: INCIDENT_ID } })),
      ).toEqual({ route: INCIDENT_HREF, label: "Open incident" });
      expect(
        target(bare(kind, { subject: { kind: "alert", id: ALERT_ID } })),
      ).toEqual({ route: ALERT_HREF, label: "Open alert" });
      // One the reader may not read was never sent: nowhere to go.
      expect(target(bare(kind))).toBeNull();
    }
  });

  test("a fix waiting for approval is reviewed where it waits, else in AI Logs", () => {
    expect(
      target(
        bare(AiActivityInsightKind.FixesAwaitingApproval, {
          subject: { kind: "alert", id: ALERT_ID },
        }),
      ),
    ).toEqual({ route: ALERT_HREF, label: "Review the fix" });
    expect(target(bare(AiActivityInsightKind.FixesAwaitingApproval))).toEqual({
      route: "/logs",
      label: "Open AI Logs",
    });
  });

  test("a part behind the trouble opens its own page when it has one", () => {
    const route: Route = new Route("/nodes/node-3");

    expect(
      target(
        bare(AiActivityInsightKind.Hotspot, {
          object: { name: "Node", value: "node-3", key: "k8s.node.name" },
          subject: { kind: "alert", id: ALERT_ID },
        }),
        {
          ...ROUTES,
          getObjectRoute: (): Route => {
            return route;
          },
        },
      ),
    ).toEqual({
      route: "/nodes/node-3",
      label: "Open {{name}}",
      values: { name: { translatableTerm: "Node", inSentence: true } },
    });
  });

  test("a hotspot without a page of its own opens its service, its monitor, else the newest subject", () => {
    const withoutPage: AiInsightsRoutes = {
      ...ROUTES,
      getObjectRoute: (): null => {
        return null;
      },
    };

    expect(
      target(
        bare(AiActivityInsightKind.Hotspot, {
          object: { name: "Mount", value: "/var" },
          service: { id: "77777777-0000-4000-8000-000000000001", name: "x" },
          monitor: { id: "88888888-0000-4000-8000-000000000001", name: "y" },
        }),
        withoutPage,
      ),
    ).toEqual({
      route: `/dashboard/${PROJECT_ID}/service/77777777-0000-4000-8000-000000000001`,
      label: "Open service",
    });
    expect(
      target(
        bare(AiActivityInsightKind.Hotspot, {
          monitor: { id: "88888888-0000-4000-8000-000000000001", name: "y" },
        }),
      ),
    ).toEqual({
      route: `/dashboard/${PROJECT_ID}/monitors/88888888-0000-4000-8000-000000000001`,
      label: "Open monitor",
    });
    expect(
      target(
        bare(AiActivityInsightKind.Hotspot, {
          object: { name: "Mount", value: "/var" },
          subject: { kind: "alert", id: ALERT_ID },
        }),
        withoutPage,
      ),
    ).toEqual({ route: ALERT_HREF, label: "Open alert" });
    expect(target(bare(AiActivityInsightKind.Hotspot))).toBeNull();
  });

  test("fixes applied on their own are in AI Logs", () => {
    expect(target(bare(AiActivityInsightKind.FixedAutomatically))).toEqual({
      route: "/logs",
      label: "Open AI Logs",
    });
  });

  test("a team ready for automatic fixes is sent where that is chosen: the AI agent page, else AI settings", () => {
    expect(target(bare(AiActivityInsightKind.ReadyForAutomaticFixes))).toEqual({
      route: "/agent",
      label: "Choose what AI may fix on its own",
    });
    expect(
      target(bare(AiActivityInsightKind.ReadyForAutomaticFixes), {
        logsRoute: LOGS,
        settingsRoute: SETTINGS,
      }),
    ).toEqual({ route: "/settings", label: "Choose what AI may fix on its own" });
    expect(
      target(bare(AiActivityInsightKind.ReadyForAutomaticFixes), {
        logsRoute: LOGS,
      }),
    ).toBeNull();
  });

  test("a risk opens its finding, or nothing without one", () => {
    expect(
      target(bare(AiActivityInsightKind.RiskSpotted, { insightId: INSIGHT_ID })),
    ).toEqual({ route: INSIGHT_HREF, label: "Open insight" });
    expect(target(bare(AiActivityInsightKind.RiskSpotted))).toBeNull();
  });

  test("an insight of a kind this page does not know leads nowhere, and has no note", () => {
    const unknown: AiActivityInsight = bare(
      "SomethingNewer" as AiActivityInsightKind,
      { subject: { kind: "incident", id: INCIDENT_ID } },
    );

    expect(target(unknown)).toBeNull();
    expect(getInsightNote(unknown, {})).toBeNull();
  });

  test("only a skipped investigation has a note about who can act", () => {
    for (const item of makeInsights().insights) {
      expect(getInsightNote(item, {})).toBeNull();
    }
  });

  test("incidents, alerts, findings, monitors and services link to their own pages in this project", () => {
    expect(
      getSubjectRoute({ kind: "incident", id: INCIDENT_ID }).toString(),
    ).toBe(INCIDENT_HREF);
    expect(getSubjectRoute({ kind: "alert", id: ALERT_ID }).toString()).toBe(
      ALERT_HREF,
    );
    expect(getPreventiveInsightRoute(INSIGHT_ID).toString()).toBe(INSIGHT_HREF);
    expect(
      getMonitorRoute("88888888-0000-4000-8000-000000000001").toString(),
    ).toBe(
      `/dashboard/${PROJECT_ID}/monitors/88888888-0000-4000-8000-000000000001`,
    );
    expect(
      getServiceRoute("77777777-0000-4000-8000-000000000001").toString(),
    ).toBe(
      `/dashboard/${PROJECT_ID}/service/77777777-0000-4000-8000-000000000001`,
    );
  });
});

describe("what the page does not say twice", () => {
  test("the problems an insight already tells are not listed again", () => {
    expect(
      getOtherProblems(makeInsights()).map(
        (problem: AiActivityProblem): string => {
          return problem.key;
        },
      ),
    ).toEqual([ONE_OFF_PROBLEM_KEY]);
    expect(getOtherProblems(makeInsights({ insights: [] }))).toHaveLength(3);
    // An insight about no problem tells none.
    expect(
      getOtherProblems(
        makeInsights({
          insights: [insightOfKind(AiActivityInsightKind.Hotspot)],
        }),
      ),
    ).toHaveLength(3);
  });

  test("the risks an insight already names are not listed again", () => {
    expect(
      getOtherPreventiveInsights(makeInsights()).map(
        (insight: AiActivityPreventiveInsight): string => {
          return insight.id;
        },
      ),
    ).toEqual([SECOND_INSIGHT_ID]);
    expect(
      getOtherPreventiveInsights(makeInsights({ insights: [] })),
    ).toHaveLength(2);
  });
});
