/** @timezone UTC */

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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import KubernetesClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index";
import DockerHostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Overview";
import PodmanHostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Overview";
import HostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Overview";
import DockerSwarmClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { AI_AGENT_STATUS_SUMMARY_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummaryCard";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { settle } from "./HostTooltipHarness";

/*
 * The "AI agent" card at the bottom of the Kubernetes, Docker, Podman, Host
 * and Docker Swarm Overviews, inside the real pages: for each, the card is
 * the last thing on the page, reads THIS resource's status from the route
 * its AI agent page reads, shows the agent's connection, the investigation
 * switch and the fixes mode, links to this resource's AI agent page — and a
 * refused status never fails the Overview.
 *
 * Only the data sources and the heavy neighbours (charts, details card,
 * activity cards, refresh control, time picker) are stubbed, as the pages'
 * connection-guide suite (ResourceConnectionGuideOverviewsInfra) stubs
 * them; the card and everything it draws are the real code.
 */

const NOW: Date = new Date("2026-09-30T12:00:00.000Z");

// The AI access status routes: a cluster's, and every other resource's.
const STATUS_ROUTE_PATTERN: RegExp =
  /\/(kubernetes-cluster\/ai-access|resource-ai-access)\/status$/;

/*
 * What the mocked data layer serves. Mutable so each test picks the
 * resource and the AI status answer; `mock` prefix because jest.mock
 * factories are hoisted and may only close over mock-prefixed names.
 */
let mockModelId: string = "";
let mockResource: Record<string, unknown> | null = null;
let mockAiStatus: (() => Promise<unknown>) | null = null;
const mockPosts: Array<{ url: string; data: unknown }> = [];
const mockProjectId: string = "10000000-0000-4000-8000-000000000001";

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType(mockModelId);
      },
      getLastParamAsString: (): string => {
        return "";
      },
      getFirstParam: (): undefined => {
        return undefined;
      },
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType(mockProjectId);
      },
    },
  };
});

/*
 * The AI access status routes answer from mockAiStatus; anything else (the
 * Kubernetes inventory summary) has nothing to report.
 */
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (request: { url: unknown; data: unknown }): Promise<unknown> => {
        const url: string = String(request.url);
        mockPosts.push({ url, data: request.data });

        const isStatusRoute: boolean =
          url.endsWith("/kubernetes-cluster/ai-access/status") ||
          url.endsWith("/resource-ai-access/status");

        if (isStatusRoute && mockAiStatus) {
          return mockAiStatus();
        }

        return Promise.resolve({ data: {} });
      },
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (): Promise<unknown> => {
        return Promise.resolve(mockResource ? { ...mockResource } : null);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils",
  () => {
    const actual: {
      default: {
        formatCpuValue: (value: number | null) => string;
        formatMemoryValue: (bytes: number | null) => string;
      };
    } = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils",
    ) as {
      default: {
        formatCpuValue: (value: number | null) => string;
        formatMemoryValue: (bytes: number | null) => string;
      };
    };

    return {
      __esModule: true,
      default: {
        formatCpuValue: actual.default.formatCpuValue,
        formatMemoryValue: actual.default.formatMemoryValue,
        fetchResourceListWithMemory: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
        fetchNodeAllocatableMemory: (): Promise<Map<string, number>> => {
          return Promise.resolve(new Map<string, number>());
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
  () => {
    return {
      __esModule: true,
      ...(jest.requireActual(
        "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
      ) as Record<string, unknown>),
      fetchClusterWarningEvents: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="stub-activity-cards" />;
      },
    };
  },
);

// The page's own "Refresh now", without the interval menu around it.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: { onManualRefresh: () => void }): ReactElement => {
        return (
          <button
            type="button"
            data-testid="stub-auto-refresh-control"
            onClick={props.onManualRefresh}
          >
            Refresh now
          </button>
        );
      },
    };
  },
);

// The Docker Swarm overview's refresh timer; off, so no interval runs.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: (): Record<string, unknown> => {
        return {
          autoRefreshInterval: "off",
          setAutoRefreshInterval: (): void => {},
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="stub-model-detail" />;
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="stub-time-range-picker" />;
      },
    };
  },
);

// Recharts has nothing to measure under jsdom; the charts are not under test.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="stub-line-chart" />;
    },
  };
});

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

interface OverviewCase {
  Page: FunctionComponent<PageComponentProps>;
  modelId: string;
  fields: Record<string, unknown>;
  heroName: string;
  agentPage: PageMap;
  // The request body the status route is read with.
  statusRequest: Record<string, string>;
  // A status that route answers, for this resource.
  status: () => Record<string, unknown>;
  // The same resource once its AI agent went offline.
  offlineStatus: () => Record<string, unknown>;
  // The fixes mode that status has, by its short name.
  fixes: string;
  agentSentence: string;
}

function resourceStatus(
  type: AiResourceType,
  modelId: string,
): () => Record<string, unknown> {
  return (): Record<string, unknown> => {
    return {
      resourceType: type,
      resourceId: modelId,
      resourceName: "web-01",
      isAiInvestigationEnabled: true,
      aiRemediationMode: "RequireApproval",
      aiCommandAllowlist: [],
      agent: {
        agentId: "99999999-0000-4000-8000-000000000009",
        connectionStatus: "connected",
        isOnline: true,
        agentVersion: "14.1.0",
        lastAliveAt: NOW.toISOString(),
      },
      gaps: [],
      isInvestigationReady: true,
      isRemediationReady: true,
    };
  };
}

function offlineResourceStatus(
  type: AiResourceType,
  modelId: string,
): () => Record<string, unknown> {
  return (): Record<string, unknown> => {
    const status: Record<string, unknown> = resourceStatus(type, modelId)();

    return {
      ...status,
      agent: {
        ...(status["agent"] as Record<string, unknown>),
        connectionStatus: "disconnected",
        isOnline: false,
      },
      isInvestigationReady: false,
      isRemediationReady: false,
    };
  };
}

const KUBERNETES_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";

function kubernetesStatus(isOnline: boolean): Record<string, unknown> {
  return {
    clusterId: KUBERNETES_ID,
    clusterName: "prod-us-east-1",
    runner: {
      id: "99999999-0000-4000-8000-000000000009",
      name: "Kubernetes AI agent",
      kind: "ai_agent",
      isOnline,
      canRunAiCommands: isOnline,
    },
    accessMethod: "in_cluster",
    aiAgent: {
      id: "99999999-0000-4000-8000-000000000009",
      isOnline,
      connectionStatus: isOnline ? "connected" : "disconnected",
    },
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: isOnline,
    remediationMode: "Automatic",
    isRemediationReady: isOnline,
    gaps: [],
    evaluatedAt: NOW.toISOString(),
  };
}
const DOCKER_ID: string = "5a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9";
const PODMAN_ID: string = "6b2c3d4e-5f60-4172-8384-a5b6c7d8e9f0";
const HOST_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const SWARM_ID: string = "11111111-1111-4111-8111-111111111111";

const OVERVIEWS: Array<[string, OverviewCase]> = [
  [
    "Kubernetes cluster",
    {
      Page: KubernetesClusterOverview,
      modelId: KUBERNETES_ID,
      fields: {
        name: "Production US East",
        clusterIdentifier: "prod-us-east-1",
      },
      heroName: "Production US East",
      agentPage: PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT,
      statusRequest: { clusterId: KUBERNETES_ID },
      status: (): Record<string, unknown> => {
        return kubernetesStatus(true);
      },
      offlineStatus: (): Record<string, unknown> => {
        return kubernetesStatus(false);
      },
      fixes: "Automatic",
      agentSentence: "The Kubernetes AI agent is connected.",
    },
  ],
  [
    "Docker host",
    {
      Page: DockerHostOverview,
      modelId: DOCKER_ID,
      fields: { name: "Web 01", hostIdentifier: "web-01", osType: "linux" },
      heroName: "Web 01",
      agentPage: PageMap.DOCKER_HOST_VIEW_AI_AGENT,
      statusRequest: {
        resourceType: AiResourceType.DockerHost,
        resourceId: DOCKER_ID,
      },
      status: resourceStatus(AiResourceType.DockerHost, DOCKER_ID),
      offlineStatus: offlineResourceStatus(
        AiResourceType.DockerHost,
        DOCKER_ID,
      ),
      fixes: "Ask for approval",
      agentSentence: "The Docker AI agent is connected.",
    },
  ],
  [
    "Podman host",
    {
      Page: PodmanHostOverview,
      modelId: PODMAN_ID,
      fields: { name: "Web 01", hostIdentifier: "web-01", osType: "linux" },
      heroName: "Web 01",
      agentPage: PageMap.PODMAN_HOST_VIEW_AI_AGENT,
      statusRequest: {
        resourceType: AiResourceType.PodmanHost,
        resourceId: PODMAN_ID,
      },
      status: resourceStatus(AiResourceType.PodmanHost, PODMAN_ID),
      offlineStatus: offlineResourceStatus(
        AiResourceType.PodmanHost,
        PODMAN_ID,
      ),
      fixes: "Ask for approval",
      agentSentence: "The Podman AI agent is connected.",
    },
  ],
  [
    "Host",
    {
      Page: HostOverview,
      modelId: HOST_ID,
      fields: {
        name: "Web server 01",
        hostIdentifier: "web-01",
        osType: "linux",
      },
      heroName: "Web server 01",
      agentPage: PageMap.HOST_VIEW_AI_AGENT,
      statusRequest: {
        resourceType: AiResourceType.Host,
        resourceId: HOST_ID,
      },
      status: resourceStatus(AiResourceType.Host, HOST_ID),
      offlineStatus: offlineResourceStatus(AiResourceType.Host, HOST_ID),
      fixes: "Ask for approval",
      agentSentence: "The Host AI agent is connected.",
    },
  ],
  [
    "Docker Swarm cluster",
    {
      Page: DockerSwarmClusterOverview,
      modelId: SWARM_ID,
      fields: { name: "prod-swarm" },
      heroName: "prod-swarm",
      agentPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_AGENT,
      statusRequest: {
        resourceType: AiResourceType.DockerSwarmCluster,
        resourceId: SWARM_ID,
      },
      status: resourceStatus(AiResourceType.DockerSwarmCluster, SWARM_ID),
      offlineStatus: offlineResourceStatus(
        AiResourceType.DockerSwarmCluster,
        SWARM_ID,
      ),
      fixes: "Ask for approval",
      agentSentence: "The Docker Swarm AI agent is connected.",
    },
  ],
];

async function renderOverview(page: OverviewCase): Promise<void> {
  mockModelId = page.modelId;
  mockResource = {
    _id: page.modelId,
    ...page.fields,
    // Connected, so no connection guide sits under the hero.
    otelCollectorStatus: "connected",
    lastSeenAt: NOW,
  };

  const Page: FunctionComponent<PageComponentProps> = page.Page;

  render(<Page {...PAGE_PROPS} />);
  await settle();
  await settle();
  await settle();
}

function aiAgentCard(): HTMLElement {
  return screen.getByTestId(AI_AGENT_STATUS_SUMMARY_TEST_ID);
}

// Every read of an AI access status route, in order.
function statusReads(): Array<{ url: string; data: unknown }> {
  return mockPosts.filter((post: { url: string }): boolean => {
    return STATUS_ROUTE_PATTERN.test(post.url);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  mockModelId = "";
  mockResource = null;
  mockAiStatus = null;
  mockPosts.length = 0;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.localStorage.clear();
});

describe.each(OVERVIEWS)(
  "the %s Overview",
  (_name: string, page: OverviewCase) => {
    beforeEach(() => {
      mockAiStatus = (): Promise<unknown> => {
        return Promise.resolve({ data: page.status() });
      };
    });

    test("ends with the AI agent card: nothing on the page comes after it", async () => {
      await renderOverview(page);

      const card: HTMLElement = aiAgentCard();
      const others: Array<Element> = Array.from(
        document.querySelectorAll("[data-testid], h1, h2"),
      ).filter((element: Element): boolean => {
        return !card.contains(element) && element !== card;
      });

      // The page drew its sections (the hero at least) before the card.
      expect(
        screen.getByRole("heading", { level: 1, name: page.heroName }),
      ).toBeInTheDocument();
      expect(others.length).toBeGreaterThan(0);

      for (const element of others) {
        expect({
          element: element.getAttribute("data-testid") || element.tagName,
          beforeTheCard: Boolean(
            element.compareDocumentPosition(card) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        }).toEqual({
          element: element.getAttribute("data-testid") || element.tagName,
          beforeTheCard: true,
        });
      }
    });

    test("reads this resource's status from the route its AI agent page reads — once, when the page opens", async () => {
      await renderOverview(page);

      /*
       * The page stamps its refresh signal when its own first load ends;
       * that is not a refresh, so the card reads once, not twice.
       */
      expect(statusReads()).toHaveLength(1);
      expect(statusReads()[0]!.data).toEqual(page.statusRequest);
    });

    test("shows the agent's connection, the investigation switch and the fixes mode", async () => {
      await renderOverview(page);

      const card: HTMLElement = aiAgentCard();

      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-badge`,
        ),
      ).toHaveTextContent("Connected");
      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-value`,
        ),
      ).toHaveTextContent(page.agentSentence);
      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-investigation-badge`,
        ),
      ).toHaveTextContent("On");
      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-fixes-badge`,
        ),
      ).toHaveTextContent(page.fixes);
    });

    test("links to this resource's AI agent page", async () => {
      await renderOverview(page);

      expect(
        within(aiAgentCard()).getByRole("link", {
          name: "Open the AI agent page",
        }),
      ).toHaveAttribute(
        "href",
        RouteUtil.populateRouteParams(RouteMap[page.agentPage] as Route, {
          modelId: new ObjectID(page.modelId),
        }).toString(),
      );
    });

    test("a refresh reads the status again, and the card shows the new one", async () => {
      await renderOverview(page);
      expect(statusReads()).toHaveLength(1);

      // The agent went offline since the page opened; a minute later, Refresh.
      mockAiStatus = (): Promise<unknown> => {
        return Promise.resolve({ data: page.offlineStatus() });
      };
      jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
      fireEvent.click(screen.getByTestId("stub-auto-refresh-control"));
      await settle();
      await settle();
      await settle();

      expect(statusReads()).toHaveLength(2);
      expect(statusReads()[1]!.data).toEqual(page.statusRequest);
      expect(
        within(aiAgentCard()).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-badge`,
        ),
      ).toHaveTextContent("Offline");
    });

    test("a refused status leaves the Overview whole, and the card says it could not load it", async () => {
      mockAiStatus = (): Promise<unknown> => {
        return Promise.reject(new Error("Not authorized"));
      };

      await renderOverview(page);

      expect(
        screen.getByRole("heading", { level: 1, name: page.heroName }),
      ).toBeInTheDocument();
      expect(
        within(aiAgentCard()).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`,
        ),
      ).toHaveTextContent("The AI agent's status could not be loaded.");
    });
  },
);

/*
 * The cluster Overview shows the AI agent twice: "AI agent" beside Agent
 * Status (whether it is connected) and the card at the bottom (that, and
 * what AI may do). One read feeds both, so they never disagree — not even
 * after a refresh, which the summary row used to sit out.
 */
describe("the Kubernetes cluster Overview's two AI agent cards", () => {
  const page: OverviewCase = OVERVIEWS[0]![1];

  function summaryRowBadge(): HTMLElement {
    return screen.getByTestId("kubernetes-ai-agent-overview-status");
  }

  function bottomCardBadge(): HTMLElement {
    return within(aiAgentCard()).getByTestId(
      `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-badge`,
    );
  }

  beforeEach(() => {
    mockAiStatus = (): Promise<unknown> => {
      return Promise.resolve({ data: kubernetesStatus(true) });
    };
  });

  test("read the cluster's status once between them, and say the same", async () => {
    await renderOverview(page);

    expect(statusReads()).toHaveLength(1);
    expect(summaryRowBadge()).toHaveTextContent("Connected");
    expect(bottomCardBadge()).toHaveTextContent("Connected");
  });

  test("both follow a refresh", async () => {
    await renderOverview(page);

    mockAiStatus = (): Promise<unknown> => {
      return Promise.resolve({ data: kubernetesStatus(false) });
    };
    jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
    fireEvent.click(screen.getByTestId("stub-auto-refresh-control"));
    await settle();
    await settle();
    await settle();

    expect(statusReads()).toHaveLength(2);
    expect(summaryRowBadge()).toHaveTextContent("Offline");
    expect(bottomCardBadge()).toHaveTextContent("Offline");
  });

  test("a refused status: a dash in the summary row, the unavailable sentence at the bottom", async () => {
    mockAiStatus = (): Promise<unknown> => {
      return Promise.reject(new Error("Not authorized"));
    };

    await renderOverview(page);

    expect(statusReads()).toHaveLength(1);
    expect(
      screen.queryByTestId("kubernetes-ai-agent-overview-status"),
    ).not.toBeInTheDocument();
    // The card's link is an overlay; its value sits beside it in the card.
    expect(
      within(
        screen.getByRole("button", { name: "AI agent — open AI → Agent" })
          .parentElement as HTMLElement,
      ).getByText("—"),
    ).toBeInTheDocument();
    expect(
      within(aiAgentCard()).getByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`,
      ),
    ).toBeInTheDocument();
  });
});
