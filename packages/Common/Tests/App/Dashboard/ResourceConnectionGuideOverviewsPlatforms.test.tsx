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
import ServerlessFunctionOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/Overview";
import RumApplicationOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Overview";
import CloudResourceOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  ResourceConnectionGuide,
  ResourceConnectionGuideStep,
  getCephClusterConnectionGuide,
  getCloudResourceConnectionGuide,
  getProxmoxClusterConnectionGuide,
  getRumApplicationConnectionGuide,
  getServerlessFunctionConnectionGuide,
  getVMwareVCenterConnectionGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { flush } from "./TimeRangeZoomPageHarness";

/*
 * The "how do I connect this?" card (ResourceConnectionGuideCard) on the
 * Proxmox, Ceph, VMware, Serverless, RUM and Cloud overviews, each page
 * rendered for real with only its data sources and its heavy neighbours
 * (charts, the details and activity cards, the session replay list and
 * health) replaced.
 *
 * The card's own states are pinned in ResourceConnectionGuideCard.test.tsx;
 * this suite checks each page wires it: straight under the hero and before
 * the page's first tiles, with this resource's own name or identifier in the
 * setup snippet, linking to this resource's Documentation tab, telling a
 * resource that stopped reporting when it was last heard from, gone once the
 * resource is connected - and never contradicting the hero's status pill.
 * A Cloud environment with no cloud.platform keeps its "Waiting for
 * telemetry" banner and gets no card on top of it.
 */

// What the Navigation mock below hands every page as the id in the URL.
const RESOURCE_ID: string = "0193c0de-5555-4aaa-8bbb-000000000005";
const NOW: Date = new Date("2026-09-30T12:00:00.000Z");
const THREE_HOURS_AGO: Date = new Date("2026-09-30T09:00:00.000Z");
const A_MINUTE_AGO: Date = new Date("2026-09-30T11:59:00.000Z");

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

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

// RUM's log / exception histograms and page-load stats are API.post calls.
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
      navigate: (...args: Array<unknown>): void => {
        navigateMock(...args);
      },
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
      default: (): null => {
        return null;
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

// RUM's recorded-session count reads one page of the session replay list.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayTable",
  () => {
    return {
      __esModule: true,
      fetchSessionReplayList: (): Promise<unknown> => {
        return Promise.resolve({ sessions: [], nextCursor: null });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth",
  () => {
    return {
      __esModule: true,
      default: (): unknown => {
        return {
          isLoading: false,
          error: null,
          diagnosis: {
            state: "healthy",
            severity: "ok",
            title: "Recording healthy",
            detail: "",
          },
          refresh: async (): Promise<void> => {},
        };
      },
    };
  },
);

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

interface OverviewCase {
  Page: React.FunctionComponent<PageComponentProps>;
  // What getItem answers, before the connection fields a test sets.
  resource: Record<string, unknown>;
  // The resource's name, in the hero's h1.
  title: string;
  /*
   * otelCollectorStatus of one created by hand: "disconnected" where the
   * column has a default, nothing where it does not.
   */
  handMadeStatus: string | undefined;
  noun: string;
  // The setup step's snippet, carrying this resource's own identifier.
  setupSnippet: string;
  guide: ResourceConnectionGuide;
  documentationPage: PageMap;
  // The hero's Connected / Disconnected pill.
  heroStatus: (title: HTMLElement) => HTMLElement;
  // The first tile of the section the page draws after the card.
  firstTile: string;
}

// Proxmox, Ceph and VMware draw their own hero: the pill sits beside the h1.
function pillBesideTitle(title: HTMLElement): HTMLElement {
  return within(title.parentElement as HTMLElement).getByText(
    /^(Connected|Disconnected)$/,
  );
}

// Serverless, RUM and Cloud share ResourceOverview's hero.
function resourceOverviewPill(): HTMLElement {
  return screen.getByTestId("resource-overview-status");
}

const OVERVIEWS: Array<[string, OverviewCase]> = [
  [
    "Proxmox cluster",
    {
      Page: ProxmoxClusterOverview,
      resource: { _id: RESOURCE_ID, name: "pve-prod" },
      title: "pve-prod",
      handMadeStatus: "disconnected",
      noun: "cluster",
      setupSnippet: "PROXMOX_CLUSTER_NAME=pve-prod",
      guide: getProxmoxClusterConnectionGuide("pve-prod"),
      documentationPage: PageMap.PROXMOX_CLUSTER_VIEW_DOCUMENTATION,
      heroStatus: pillBesideTitle,
      firstTile: "Node Availability",
    },
  ],
  [
    "Ceph cluster",
    {
      Page: CephClusterOverview,
      resource: { _id: RESOURCE_ID, name: "ceph-prod" },
      title: "ceph-prod",
      handMadeStatus: "disconnected",
      noun: "cluster",
      setupSnippet: "CEPH_CLUSTER_NAME=ceph-prod",
      guide: getCephClusterConnectionGuide("ceph-prod"),
      documentationPage: PageMap.CEPH_CLUSTER_VIEW_DOCUMENTATION,
      heroStatus: pillBesideTitle,
      firstTile: "Capacity Used",
    },
  ],
  [
    "VMware vCenter",
    {
      Page: VMwareVCenterOverview,
      resource: { _id: RESOURCE_ID, name: "prod-vcenter" },
      title: "prod-vcenter",
      handMadeStatus: "disconnected",
      noun: "vCenter",
      setupSnippet: "VMWARE_VCENTER_NAME=prod-vcenter",
      guide: getVMwareVCenterConnectionGuide("prod-vcenter"),
      documentationPage: PageMap.VMWARE_VCENTER_VIEW_DOCUMENTATION,
      heroStatus: pillBesideTitle,
      firstTile: "Host Effectiveness",
    },
  ],
  [
    "Serverless function",
    {
      Page: ServerlessFunctionOverview,
      // The name differs from faas.name, which is what the agent must report.
      resource: {
        _id: RESOURCE_ID,
        name: "Checkout handler",
        functionIdentifier: "checkout-handler-prod",
      },
      title: "Checkout handler",
      handMadeStatus: undefined,
      noun: "function",
      setupSnippet:
        'OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler-prod"',
      guide: getServerlessFunctionConnectionGuide("checkout-handler-prod"),
      documentationPage: PageMap.SERVERLESS_FUNCTION_VIEW_DOCUMENTATION,
      heroStatus: resourceOverviewPill,
      firstTile: "Invocations",
    },
  ],
  [
    "RUM application",
    {
      Page: RumApplicationOverview,
      // No sessionReplayLastChunkReceivedAt: no "replay only" notice.
      resource: {
        _id: RESOURCE_ID,
        name: "Checkout Web",
        appIdentifier: "checkout-web",
      },
      title: "Checkout Web",
      handMadeStatus: undefined,
      noun: "application",
      setupSnippet: "service.name=checkout-web",
      guide: getRumApplicationConnectionGuide("checkout-web"),
      documentationPage: PageMap.RUM_APPLICATION_VIEW_DOCUMENTATION,
      heroStatus: resourceOverviewPill,
      firstTile: "Page loads",
    },
  ],
  [
    "Cloud environment",
    {
      Page: CloudResourceOverview,
      resource: {
        _id: RESOURCE_ID,
        name: "prod · us-east-1",
        resourceIdentifier: "aws_ecs|123456789012|us-east-1",
        cloudPlatform: "aws_ecs",
        cloudProvider: "aws",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      },
      title: "prod · us-east-1",
      handMadeStatus: undefined,
      noun: "environment",
      setupSnippet:
        "cloud.platform=aws_ecs,cloud.account.id=123456789012,cloud.region=us-east-1",
      guide: getCloudResourceConnectionGuide({
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
      documentationPage: PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION,
      heroStatus: resourceOverviewPill,
      firstTile: "CPU",
    },
  ],
];

// This resource's Documentation tab, as the page should link to it.
function documentationHref(page: PageMap): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(RESOURCE_ID),
  }).toString();
}

async function mount(
  overview: OverviewCase,
  connection: Record<string, unknown>,
): Promise<void> {
  // A fresh object per fetch, as the API returns.
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({ ...overview.resource, ...connection });
  });

  render(
    <MemoryRouter>
      <overview.Page {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await flush();
}

function heroTitle(overview: OverviewCase): HTMLElement {
  return screen.getByRole("heading", { level: 1, name: overview.title });
}

function card(): HTMLElement | null {
  return screen.queryByTestId("resource-connection-guide");
}

function shownCard(): HTMLElement {
  const element: HTMLElement | null = card();

  expect(element).not.toBeNull();

  return element as HTMLElement;
}

function stepTitles(root: HTMLElement): Array<string> {
  return within(root)
    .getAllByTestId("resource-connection-guide-step")
    .map((step: HTMLElement): string => {
      return within(step).getByRole("heading").textContent || "";
    });
}

function titlesOf(steps: Array<ResourceConnectionGuideStep>): Array<string> {
  return steps.map((step: ResourceConnectionGuideStep): string => {
    return step.title;
  });
}

function codeSnippets(root: HTMLElement): Array<string> {
  return Array.from(root.querySelectorAll("code")).map(
    (code: HTMLElement): string => {
      return code.textContent || "";
    },
  );
}

async function firstTileOfNextSection(
  overview: OverviewCase,
): Promise<HTMLElement> {
  const [info] = await screen.findAllByRole("button", {
    name: `About ${overview.firstTile}`,
  });

  return info as HTMLElement;
}

/*
 * The card is the element right after the hero (which holds the h1 with the
 * resource's name) and right before the page's next section.
 */
async function expectDirectlyUnderHero(
  overview: OverviewCase,
  element: HTMLElement,
): Promise<void> {
  const title: HTMLElement = heroTitle(overview);
  const nextTile: HTMLElement = await firstTileOfNextSection(overview);

  expect(element.previousElementSibling).toContainElement(title);
  expect(element.nextElementSibling).toContainElement(nextTile);
  expect(
    title.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    element.compareDocumentPosition(nextTile) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
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
  navigateMock.mockReset();

  // Nothing has reported: no inventory, no instances, no telemetry.
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
  "%s overview: the connection guide card",
  (_name: string, overview: OverviewCase) => {
    const handMade: () => Record<string, unknown> = (): Record<
      string,
      unknown
    > => {
      return {
        otelCollectorStatus: overview.handMadeStatus,
        lastSeenAt: undefined,
      };
    };

    test("a hand-made one nothing has reported for gets the setup card, straight under the hero", async () => {
      await mount(overview, handMade());

      const element: HTMLElement = shownCard();

      expect(element).toHaveAttribute("data-state", "never-connected");
      expect(
        screen.getByRole("region", { name: `Connect this ${overview.noun}` }),
      ).toBe(element);
      expect(stepTitles(element)).toEqual(titlesOf(overview.guide.setupSteps));
      await expectDirectlyUnderHero(overview, element);
    });

    test("its hero agrees: Disconnected, last seen never", async () => {
      await mount(overview, handMade());

      const element: HTMLElement = shownCard();
      const title: HTMLElement = heroTitle(overview);

      expect(overview.heroStatus(title)).toHaveTextContent(/^Disconnected$/);
      expect(
        within(element.previousElementSibling as HTMLElement).getByText(
          "Last seen never",
        ),
      ).toBeInTheDocument();
    });

    test("the setup step names this resource's own identifier, in code", async () => {
      await mount(overview, handMade());

      expect(codeSnippets(shownCard())).toContain(overview.setupSnippet);
    });

    test("the card links to this resource's Documentation tab", async () => {
      await mount(overview, handMade());

      const expected: string = documentationHref(overview.documentationPage);
      const link: HTMLElement = within(shownCard()).getByRole("link", {
        name: "Open the setup guide",
      });

      // The route was filled in for this project and this resource.
      expect(expected).toContain(`/${RESOURCE_ID}/documentation`);
      expect(link).toHaveAttribute("href", expected);

      navigateMock.mockClear();
      fireEvent.click(link);

      expect(navigateMock).toHaveBeenCalledTimes(1);
      expect(String(navigateMock.mock.calls[0]![0])).toBe(expected);
    });

    test("one that reported and then stopped gets the troubleshooting card, saying when it was last heard from", async () => {
      await mount(overview, {
        otelCollectorStatus: "disconnected",
        lastSeenAt: THREE_HOURS_AGO,
      });

      const element: HTMLElement = shownCard();

      expect(element).toHaveAttribute("data-state", "disconnected");
      expect(
        within(element).getByRole("heading", {
          level: 2,
          name: `This ${overview.noun} stopped sending data`,
        }),
      ).toBeInTheDocument();
      expect(element).toHaveTextContent(
        `OneUptime last heard from this ${overview.noun} 3 hours ago.`,
      );
      expect(stepTitles(element)).toEqual(
        titlesOf(overview.guide.troubleshootingSteps),
      );
      expect(
        within(element).getByRole("link", { name: "Open the setup guide" }),
      ).toHaveAttribute("href", documentationHref(overview.documentationPage));
      await expectDirectlyUnderHero(overview, element);

      // The hero says the same: Disconnected, last seen 3 hours ago.
      expect(overview.heroStatus(heroTitle(overview))).toHaveTextContent(
        /^Disconnected$/,
      );
      expect(
        within(element.previousElementSibling as HTMLElement).getByText(
          "Last seen 3 hours ago",
        ),
      ).toBeInTheDocument();
    });

    test("a connected one has no card, and its hero reads Connected", async () => {
      await mount(overview, {
        otelCollectorStatus: "connected",
        lastSeenAt: A_MINUTE_AGO,
      });

      // The page is drawn...
      const title: HTMLElement = heroTitle(overview);
      await firstTileOfNextSection(overview);

      // ...with no card anywhere on it.
      expect(card()).toBeNull();
      expect(
        screen.queryAllByTestId("resource-connection-guide-step"),
      ).toHaveLength(0);
      expect(
        screen.queryByRole("link", { name: "Open the setup guide" }),
      ).toBeNull();
      expect(overview.heroStatus(title)).toHaveTextContent(/^Connected$/);
    });
  },
);

describe("Cloud environment overview with no cloud.platform", () => {
  const UNSCOPED: Record<string, unknown> = {
    _id: RESOURCE_ID,
    name: "Staging",
    resourceIdentifier: "staging",
  };

  test.each([
    [
      "nothing has reported",
      { otelCollectorStatus: undefined, lastSeenAt: undefined },
    ],
    [
      "it was last seen 3 hours ago",
      { otelCollectorStatus: "disconnected", lastSeenAt: THREE_HOURS_AGO },
    ],
  ])(
    "when %s, keeps its Waiting for telemetry banner and draws no card on top of it",
    async (_when: string, connection: Record<string, unknown>) => {
      getItemMock.mockImplementation((): Promise<unknown> => {
        return Promise.resolve({ ...UNSCOPED, ...connection });
      });

      render(
        <MemoryRouter>
          <CloudResourceOverview {...PAGE_PROPS} />
        </MemoryRouter>,
      );
      await flush();

      expect(
        screen.getByRole("heading", { level: 1, name: "Staging" }),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("cloud-resource-connect-banner"),
      ).toBeInTheDocument();
      expect(card()).toBeNull();
      expect(
        screen.queryByRole("link", { name: "Open the setup guide" }),
      ).toBeNull();
      // The hero still reads Disconnected; the banner is what explains it.
      expect(resourceOverviewPill()).toHaveTextContent(/^Disconnected$/);
    },
  );
});
