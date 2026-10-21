/**
 * @timezone UTC
 */
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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ProxmoxClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Index";
import CephClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index";
import VMwareVCenterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { AI_AGENT_STATUS_SUMMARY_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummaryCard";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { RESOURCE_AI_ACCESS_STATUS_PATH } from "../../../Types/AI/ResourceAiAccessApi";
import { flush } from "./TimeRangeZoomPageHarness";

/*
 * The "AI agent" card at the bottom of the Proxmox, Ceph and VMware
 * Overviews, inside the real pages: for each, the card is the last thing on
 * the page, reads THIS resource's status from the route its AI agent page
 * reads, shows the agent's connection, the investigation switch and the
 * fixes mode, links to this resource's AI agent page — and a refused status
 * never fails the Overview.
 *
 * Only the data sources and the heavy neighbours (charts, the details and
 * activity cards) are stubbed, as the pages' connection-guide suite
 * (ResourceConnectionGuideOverviewsPlatforms) stubs them.
 */

const RESOURCE_ID: string = "0193c0de-5555-4aaa-8bbb-000000000005";
const NOW: Date = new Date("2026-09-30T12:00:00.000Z");

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: (): unknown => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
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
      aggregate: (...args: Array<unknown>): unknown => {
        return aggregateMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-5555-4aaa-8bbb-000000000005");
      },
      getLastParamAsString: (): string => {
        return "0193c0de-5555-4aaa-8bbb-000000000005";
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
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

// Recharts has no layout under jsdom; the card is the subject, not the charts.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "card-model-detail" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", {
          "data-testid": "resource-activity-cards",
        });
      },
    };
  },
);

// Ceph's Golden Signals card: its title and children, without MetricView.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        title?: React.ReactNode;
        children?: React.ReactNode;
      }): React.ReactElement => {
        return React.createElement(
          "section",
          { "data-testid": "embedded-metric-card" },
          props.title,
          props.children,
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/CephRateChart",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "ceph-rate-chart" });
      },
    };
  },
);

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

interface OverviewCase {
  Page: React.FunctionComponent<PageComponentProps>;
  resource: Record<string, unknown>;
  title: string;
  type: AiResourceType;
  agentPage: PageMap;
  agentName: string;
}

const OVERVIEWS: Array<[string, OverviewCase]> = [
  [
    "Proxmox cluster",
    {
      Page: ProxmoxClusterOverview,
      resource: { _id: RESOURCE_ID, name: "pve-prod" },
      title: "pve-prod",
      type: AiResourceType.ProxmoxCluster,
      agentPage: PageMap.PROXMOX_CLUSTER_VIEW_AI_AGENT,
      agentName: "Proxmox AI agent",
    },
  ],
  [
    "Ceph cluster",
    {
      Page: CephClusterOverview,
      resource: { _id: RESOURCE_ID, name: "ceph-prod" },
      title: "ceph-prod",
      type: AiResourceType.CephCluster,
      agentPage: PageMap.CEPH_CLUSTER_VIEW_AI_AGENT,
      agentName: "Ceph AI agent",
    },
  ],
  [
    "VMware vCenter",
    {
      Page: VMwareVCenterOverview,
      resource: { _id: RESOURCE_ID, name: "prod-vcenter" },
      title: "prod-vcenter",
      type: AiResourceType.VMwareVCenter,
      agentPage: PageMap.VMWARE_VCENTER_VIEW_AI_AGENT,
      agentName: "VMware AI agent",
    },
  ],
];

function statusFor(type: AiResourceType): Record<string, unknown> {
  return {
    resourceType: type,
    resourceId: RESOURCE_ID,
    resourceName: "prod",
    isAiInvestigationEnabled: true,
    aiRemediationMode: "BypassApproval",
    aiCommandAllowlist: [],
    agent: {
      agentId: "99999999-0000-4000-8000-000000000009",
      connectionStatus: "disconnected",
      isOnline: false,
      agentVersion: "14.1.0",
      lastAliveAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    },
    gaps: [
      {
        code: "ai_agent_offline",
        title: "The agent is offline",
        nextStep: "Bring it back",
        blocksInvestigation: true,
        blocksRemediation: true,
      },
    ],
    isInvestigationReady: false,
    isRemediationReady: false,
  };
}

function isStatusRead(call: Array<unknown>): boolean {
  return String((call[0] as { url: unknown }).url).endsWith(
    RESOURCE_AI_ACCESS_STATUS_PATH,
  );
}

async function mount(overview: OverviewCase): Promise<void> {
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      ...overview.resource,
      otelCollectorStatus: "connected",
      lastSeenAt: NOW,
    });
  });

  render(
    <MemoryRouter>
      <overview.Page {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await flush();
}

function aiAgentCard(): HTMLElement {
  return screen.getByTestId(AI_AGENT_STATUS_SUMMARY_TEST_ID);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
  getListMock.mockReset();
  countMock.mockReset();
  aggregateMock.mockReset();
  analyticsGetListMock.mockReset();
  apiPostMock.mockReset();

  getListMock.mockResolvedValue({ data: [], count: 0 });
  countMock.mockResolvedValue(0);
  aggregateMock.mockResolvedValue({ data: [] });
  analyticsGetListMock.mockResolvedValue({ data: [], count: 0 });
  apiPostMock.mockResolvedValue({ data: {} });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each(OVERVIEWS)(
  "the %s Overview",
  (_name: string, overview: OverviewCase) => {
    beforeEach(() => {
      apiPostMock.mockImplementation(
        (request: { url: unknown }): Promise<unknown> => {
          if (String(request.url).endsWith(RESOURCE_AI_ACCESS_STATUS_PATH)) {
            return Promise.resolve({ data: statusFor(overview.type) });
          }
          return Promise.resolve({ data: {} });
        },
      );
    });

    test("ends with the AI agent card: nothing on the page comes after it", async () => {
      await mount(overview);

      const card: HTMLElement = aiAgentCard();
      const others: Array<Element> = Array.from(
        document.querySelectorAll("[data-testid], h1, h2"),
      ).filter((element: Element): boolean => {
        return !card.contains(element) && element !== card;
      });

      expect(
        screen.getByRole("heading", { level: 1, name: overview.title }),
      ).toBeInTheDocument();
      // The details card used to be last; the AI agent card comes after it.
      expect(
        screen.getByTestId("card-model-detail").compareDocumentPosition(card) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

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

    test("reads this resource's status, as its AI agent page does", async () => {
      await mount(overview);

      const reads: Array<Array<unknown>> =
        apiPostMock.mock.calls.filter(isStatusRead);

      expect(reads).toHaveLength(1);
      expect((reads[0]![0] as { data: unknown }).data).toEqual({
        resourceType: overview.type,
        resourceId: RESOURCE_ID,
      });
    });

    test("an offline agent: Offline, investigation on, fixes Bypass approval, and what needs attention", async () => {
      await mount(overview);

      const card: HTMLElement = aiAgentCard();

      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-badge`,
        ),
      ).toHaveTextContent("Offline");
      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-value`,
        ),
      ).toHaveTextContent(`The ${overview.agentName} is offline.`);
      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-details`,
        ),
      ).toHaveTextContent("last seen 3 hours ago");
      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-investigation-badge`,
        ),
      ).toHaveTextContent("On");
      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-fixes-badge`,
        ),
      ).toHaveTextContent("Bypass approval");
      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-attention-title`,
        ),
      ).toHaveTextContent(
        /^OneUptime AI can't investigate this .+ or run fixes on it$/,
      );
    });

    test("links to this resource's AI agent page", async () => {
      await mount(overview);

      expect(
        within(aiAgentCard()).getByRole("link", {
          name: "Open the AI agent page",
        }),
      ).toHaveAttribute(
        "href",
        RouteUtil.populateRouteParams(RouteMap[overview.agentPage] as Route, {
          modelId: new ObjectID(RESOURCE_ID),
        }).toString(),
      );
    });

    test("Refresh now reads the status again, and the card shows the new one", async () => {
      await mount(overview);
      expect(apiPostMock.mock.calls.filter(isStatusRead)).toHaveLength(1);

      // The agent came back and fixes now ask first; a minute later, Refresh.
      apiPostMock.mockImplementation(
        (request: { url: unknown }): Promise<unknown> => {
          if (String(request.url).endsWith(RESOURCE_AI_ACCESS_STATUS_PATH)) {
            return Promise.resolve({
              data: {
                ...statusFor(overview.type),
                aiRemediationMode: "RequireApproval",
                agent: {
                  agentId: "99999999-0000-4000-8000-000000000009",
                  connectionStatus: "connected",
                  isOnline: true,
                },
                gaps: [],
                isInvestigationReady: true,
                isRemediationReady: true,
              },
            });
          }
          return Promise.resolve({ data: {} });
        },
      );
      jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
      fireEvent.click(screen.getByTitle("Refresh now"));
      await flush();

      expect(apiPostMock.mock.calls.filter(isStatusRead)).toHaveLength(2);
      const card: HTMLElement = aiAgentCard();
      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-badge`,
        ),
      ).toHaveTextContent("Connected");
      expect(
        within(card).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-fixes-badge`,
        ),
      ).toHaveTextContent("Ask for approval");
      expect(
        within(card).queryByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-attention`,
        ),
      ).not.toBeInTheDocument();
    });

    test("a refused status leaves the Overview whole, and the card says it could not load it", async () => {
      apiPostMock.mockImplementation(
        (request: { url: unknown }): Promise<unknown> => {
          if (String(request.url).endsWith(RESOURCE_AI_ACCESS_STATUS_PATH)) {
            return Promise.reject(new Error("Not authorized"));
          }
          return Promise.resolve({ data: {} });
        },
      );

      await mount(overview);

      expect(
        screen.getByRole("heading", { level: 1, name: overview.title }),
      ).toBeInTheDocument();
      expect(
        within(aiAgentCard()).getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`,
        ),
      ).toBeInTheDocument();
    });
  },
);
