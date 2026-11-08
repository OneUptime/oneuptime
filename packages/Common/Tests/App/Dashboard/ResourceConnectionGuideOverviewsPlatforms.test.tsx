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
import CloudResourceOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/Overview";
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
import { getConfiguredOneUptimeUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/ConfiguredOneUptimeUrl";
import { escapeRegExp } from "../../../Utils/RegExpEscape";

/*
 * The OneUptime the pages' diagnostic commands download from: this
 * Dashboard's own (HOST and HTTP_PROTOCOL).
 */
const READER_URL: string = getConfiguredOneUptimeUrl();

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
  // What the pill and the card say; an agent-fed resource's when left out.
  words?: OverviewWords | undefined;
}

/*
 * What the hero's pill says in each state, and the heading of the card for
 * one whose data stopped. An agent-fed resource is Connected or
 * Disconnected, and has stopped sending data when nothing arrives. A RUM
 * application's data comes from the people using it, so it is Receiving
 * data, No recent traffic or Waiting for data, and is idle - not stopped -
 * when nobody has used it for a while (issue #6191). A serverless function
 * sends data only while it runs, so it is Receiving data, No recent
 * invocations or Waiting for data, and is idle when nothing has invoked it
 * for a while (issue #6269).
 */
interface OverviewWords {
  connected: string;
  disconnected: string;
  neverConnected: string;
  stoppedHeading: (noun: string) => string;
}

const AGENT_WORDS: OverviewWords = {
  connected: "Connected",
  disconnected: "Disconnected",
  neverConnected: "Disconnected",
  stoppedHeading: (noun: string): string => {
    return `This ${noun} stopped sending data`;
  },
};

const RUM_WORDS: OverviewWords = {
  connected: "Receiving data",
  disconnected: "No recent traffic",
  neverConnected: "Waiting for data",
  stoppedHeading: (): string => {
    return "No traffic in the last 15 minutes";
  },
};

const SERVERLESS_WORDS: OverviewWords = {
  connected: "Receiving data",
  disconnected: "No recent invocations",
  neverConnected: "Waiting for data",
  stoppedHeading: (): string => {
    return "No invocations in the last 15 minutes";
  },
};

function wordsOf(overview: OverviewCase): OverviewWords {
  return overview.words || AGENT_WORDS;
}

// The whole of an element's words, as a regular expression would match them.
function exactly(text: string): RegExp {
  return new RegExp(`^${escapeRegExp(text)}$`);
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
      guide: getProxmoxClusterConnectionGuide("pve-prod", READER_URL),
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
      guide: getCephClusterConnectionGuide("ceph-prod", READER_URL),
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
      guide: getVMwareVCenterConnectionGuide("prod-vcenter", READER_URL),
      documentationPage: PageMap.VMWARE_VCENTER_VIEW_DOCUMENTATION,
      heroStatus: pillBesideTitle,
      // The tile the vCenter Overview opens its row of tiles with.
      firstTile: "Effective hosts",
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
      words: SERVERLESS_WORDS,
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
      words: RUM_WORDS,
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
      documentationPage: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DOCUMENTATION,
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

    test("its hero agrees: not connected yet, never seen", async () => {
      await mount(overview, handMade());

      const element: HTMLElement = shownCard();
      const title: HTMLElement = heroTitle(overview);

      expect(overview.heroStatus(title)).toHaveTextContent(
        exactly(wordsOf(overview).neverConnected),
      );
      /*
       * One whole sentence, not "Last seen never": a language that words
       * "Last seen" would read an English "never" inside it.
       */
      expect(
        within(element.previousElementSibling as HTMLElement).getByText(
          "Never seen",
        ),
      ).toBeInTheDocument();
      expect(
        within(element.previousElementSibling as HTMLElement).queryByText(
          /Last seen/,
        ),
      ).toBeNull();
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
          name: wordsOf(overview).stoppedHeading(overview.noun),
        }),
      ).toBeInTheDocument();
      expect(element).toHaveTextContent(
        `OneUptime last heard from this ${overview.noun} 3 hours ago.`,
      );
      // An idle resource's checks wait, folded, until someone asks for them.
      if (overview.guide.idleCopy) {
        fireEvent.click(
          within(element).getByTestId("resource-connection-guide-steps-toggle"),
        );
      }
      expect(stepTitles(element)).toEqual(
        titlesOf(overview.guide.troubleshootingSteps),
      );
      expect(
        within(element).getByRole("link", { name: "Open the setup guide" }),
      ).toHaveAttribute("href", documentationHref(overview.documentationPage));
      await expectDirectlyUnderHero(overview, element);

      // The hero says the same, last seen 3 hours ago.
      expect(overview.heroStatus(heroTitle(overview))).toHaveTextContent(
        exactly(wordsOf(overview).disconnected),
      );
      expect(
        within(element.previousElementSibling as HTMLElement).getByText(
          "Last seen 3 hours ago",
        ),
      ).toBeInTheDocument();
    });

    test("a connected one has no card, and its hero says data arrives", async () => {
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
      expect(overview.heroStatus(title)).toHaveTextContent(
        exactly(wordsOf(overview).connected),
      );
    });
  },
);

/*
 * Issues #6191 and #6269: a RUM application's data comes from the people
 * using it, and a serverless function sends data only while it runs, so
 * one nobody has used - or nothing has invoked - for a while is idle, not
 * broken. Its Overview says so: the hero's pill reads No recent traffic or
 * No recent invocations in grey, never "Disconnected" in any colour, and
 * the card under it says when data last arrived, that this is normal, and
 * keeps the checks folded until someone asks for them.
 */
interface IdleWhenUnusedCase {
  // What the idle card says, whole.
  idleDescription: string;
  // The line the folded checks sit behind.
  checksLabel: string;
  // What the setup card says before the first data.
  waitingDescription: string;
  // The setup's last step, naming the status the pill switches to.
  waitStep: string;
  // What the hero's pill says on hover, in each state.
  receivingHover: string;
  quietHover: string;
  waitingHover: string;
}

const IDLE_WHEN_UNUSED: Array<[string, IdleWhenUnusedCase]> = [
  [
    "RUM application",
    {
      idleDescription:
        "OneUptime last heard from this application 3 hours ago. It sends data only while people use it, so this is normal when nobody is, such as overnight.",
      checksLabel: "What to check if people are using it",
      waitingDescription:
        "No data has arrived from this application yet. Set up the OpenTelemetry browser or mobile SDK — it takes a few minutes.",
      waitStep:
        "Open your app so it sends its first data, then refresh this page. The application switches to Receiving data.",
      receivingHover:
        "Data has arrived from this application in the last 15 minutes.",
      quietHover:
        "Nothing has arrived in the last 15 minutes. An application sends data only while people use it, so this is normal when nobody is, for example overnight. If people are using it right now, its Overview lists what to check.",
      waitingHover:
        "Nothing has arrived from this application yet. Add the OpenTelemetry SDK or the Session Replay snippet to your app; its Documentation tab shows how.",
    },
  ],
  [
    "Serverless function",
    {
      idleDescription:
        "OneUptime last heard from this function 3 hours ago. It sends data only while it runs, so this is normal when nothing invokes it, such as between scheduled runs.",
      checksLabel: "What to check if it should be running",
      waitingDescription:
        "No data has arrived from this function yet. Set up the OpenTelemetry SDK and invoke the function — it takes a few minutes.",
      waitStep:
        "Data is sent when the function runs. Invoke it once, then refresh this page after a few minutes. The function switches to Receiving data once its first data arrives.",
      receivingHover:
        "Data has arrived from this function in the last 15 minutes.",
      quietHover:
        "Nothing has arrived in the last 15 minutes. A function sends data only while it runs, so this is normal when nothing has invoked it, for example between scheduled runs. If it should be running, its Overview lists what to check.",
      waitingHover:
        "Nothing has arrived from this function yet. Add the OpenTelemetry SDK to it and invoke it once; its Documentation tab shows how.",
    },
  ],
];

describe.each(IDLE_WHEN_UNUSED)(
  "%s overview: idle, never Disconnected",
  (name: string, idle: IdleWhenUnusedCase) => {
    const OVERVIEW: OverviewCase = (
      OVERVIEWS.find(([candidate]: [string, OverviewCase]): boolean => {
        return candidate === name;
      }) as [string, OverviewCase]
    )[1];
    const WORDS: OverviewWords = wordsOf(OVERVIEW);

    const IDLE: Record<string, unknown> = {
      otelCollectorStatus: "disconnected",
      lastSeenAt: THREE_HOURS_AGO,
    };

    function toggle(): HTMLElement {
      return within(shownCard()).getByTestId(
        "resource-connection-guide-steps-toggle",
      );
    }

    function shownSteps(): Array<HTMLElement> {
      return within(shownCard())
        .queryAllByTestId("resource-connection-guide-step")
        .filter((step: HTMLElement): boolean => {
          // jsdom has no stylesheet: the list is hidden by its attribute.
          return !step.closest("[hidden]");
        });
    }

    test("its guide says it is idle when unused", () => {
      expect(OVERVIEW.guide.idleCopy).toBeDefined();
      expect(OVERVIEW.words).toBeDefined();
    });

    test.each([
      ["waiting for its first data", { otelCollectorStatus: undefined }],
      ["idle", IDLE],
      [
        "receiving data",
        { otelCollectorStatus: "connected", lastSeenAt: A_MINUTE_AGO },
      ],
    ])(
      "nothing on the page says Disconnected while it is %s",
      async (_state: string, connection: Record<string, unknown>) => {
        await mount(OVERVIEW, connection);
        await firstTileOfNextSection(OVERVIEW);

        expect(document.body.textContent).not.toMatch(/disconnected/i);
        expect(resourceOverviewPill().getAttribute("title") || "").not.toMatch(
          /disconnected/i,
        );
      },
    );

    test("the idle card is grey and says that this is normal", async () => {
      await mount(OVERVIEW, IDLE);

      const element: HTMLElement = shownCard();

      expect(element).toHaveAttribute("data-variant", "idle");
      expect(element).toHaveAttribute("data-state", "disconnected");
      expect(element).toHaveClass("border-gray-200");
      expect(element.className).not.toMatch(/amber|red/);
      expect(
        within(element).getByRole("heading", {
          level: 2,
          name: WORDS.stoppedHeading(OVERVIEW.noun),
        }),
      ).toBeInTheDocument();
      expect(element).toHaveTextContent(idle.idleDescription);
      // Not the agent's "stopped sending data" card.
      expect(element).not.toHaveTextContent(/stopped sending data/);
      expect(element).not.toHaveTextContent(/no longer reporting/);
    });

    test("its checks stay folded until asked for, then fold away again", async () => {
      await mount(OVERVIEW, IDLE);

      expect(toggle()).toHaveTextContent(idle.checksLabel);
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
      expect(shownSteps()).toHaveLength(0);

      const list: HTMLElement = document.getElementById(
        toggle().getAttribute("aria-controls") as string,
      ) as HTMLElement;
      expect(list).not.toBeNull();
      expect(list).toHaveAttribute("hidden");

      fireEvent.click(toggle());

      expect(toggle()).toHaveAttribute("aria-expanded", "true");
      expect(list).not.toHaveAttribute("hidden");
      expect(
        shownSteps().map((step: HTMLElement): string => {
          return within(step).getByRole("heading").textContent || "";
        }),
      ).toEqual(titlesOf(OVERVIEW.guide.troubleshootingSteps));

      fireEvent.click(toggle());

      expect(toggle()).toHaveAttribute("aria-expanded", "false");
      expect(shownSteps()).toHaveLength(0);
    });

    test("its link to the setup guide is the quieter, outlined button", async () => {
      await mount(OVERVIEW, IDLE);

      const link: HTMLElement = within(shownCard()).getByRole("link", {
        name: "Open the setup guide",
      });

      expect(link).toHaveClass("bg-white");
      expect(link).not.toHaveClass("bg-indigo-600");
      expect(link).toHaveAttribute(
        "href",
        documentationHref(OVERVIEW.documentationPage),
      );
    });

    test("before its first data the setup card does not call it Disconnected either", async () => {
      await mount(OVERVIEW, {
        otelCollectorStatus: undefined,
        lastSeenAt: undefined,
      });

      const element: HTMLElement = shownCard();

      expect(element).toHaveAttribute("data-variant", "setup");
      expect(element).toHaveTextContent(idle.waitingDescription);
      expect(element).not.toHaveTextContent(/which is why it shows as/);
      // Its steps are what to do now, so they are not folded.
      expect(
        within(element).queryByTestId("resource-connection-guide-steps-toggle"),
      ).toBeNull();
      expect(shownSteps()).toHaveLength(3);
      expect(element).toHaveTextContent(idle.waitStep);
      // The step names the status the pill will switch to.
      expect(idle.waitStep).toContain(WORDS.connected);
    });

    test.each([
      ["receiving data", "connected"],
      ["idle", "disconnected"],
      ["waiting for its first data", "neverConnected"],
    ] as Array<[string, "connected" | "disconnected" | "neverConnected"]>)(
      "the hero's pill, %s, is coloured as it should be and says what it means on hover",
      async (
        _state: string,
        state: "connected" | "disconnected" | "neverConnected",
      ) => {
        const connection: Record<string, unknown> = {
          connected: {
            otelCollectorStatus: "connected",
            lastSeenAt: A_MINUTE_AGO,
          },
          disconnected: IDLE,
          neverConnected: {
            otelCollectorStatus: undefined,
            lastSeenAt: undefined,
          },
        }[state];
        const hover: string = {
          connected: idle.receivingHover,
          disconnected: idle.quietHover,
          neverConnected: idle.waitingHover,
        }[state];

        await mount(OVERVIEW, connection);

        const pill: HTMLElement = resourceOverviewPill();

        expect(pill).toHaveTextContent(exactly(WORDS[state]));
        expect(pill).toHaveClass(
          state === "connected" ? "bg-emerald-50" : "bg-gray-50",
        );
        expect(pill.className).not.toMatch(/amber|red/);
        expect(pill).toHaveAttribute("title", hover);
      },
    );
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
