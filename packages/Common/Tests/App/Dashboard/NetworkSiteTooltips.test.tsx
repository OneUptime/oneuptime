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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The (i) tooltips on the network site pages, RENDERED: the site Overview
 * hero, the summary strip above the Sites list, the Status Timeline tab's
 * uptime cards and daily strip, and the Child Sites list's Status column.
 *
 * Only the network and the ModelTable are replaced. Every metric title is
 * checked for an (i) whose tooltip is the matching
 * NETWORK_SITE_METRIC_DESCRIPTIONS entry, Site Type (a name, not a number)
 * for having none, and the clickable summary tiles for not activating when
 * someone asks what the number means.
 */

const SITE_ID: string = "55555555-5555-4555-8555-555555555555";
const OPERATIONAL_ID: string = "77777777-7777-4777-8777-000000000001";
const DEGRADED_ID: string = "77777777-7777-4777-8777-000000000002";
const MS_PER_DAY: number = 24 * 60 * 60 * 1000;

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const fetchSiteSummaryMock: MockFunction = getJestMockFunction();
const fetchMaintenanceWindowsMock: MockFunction = getJestMockFunction();
const modelTableMock: MockFunction = getJestMockFunction();

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Network/NetworkSummaryApi",
  () => {
    return {
      __esModule: true,
      fetchSiteSummary: (...args: Array<unknown>): unknown => {
        return fetchSiteSummaryMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteMaintenanceWindows",
  () => {
    const fetcher: (...args: Array<unknown>) => unknown = (
      ...args: Array<unknown>
    ): unknown => {
      return fetchMaintenanceWindowsMock(...args);
    };

    return {
      __esModule: true,
      default: fetcher,
      fetchSiteMaintenanceWindows: fetcher,
    };
  },
);

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      // Read at render time, long after the module-level id below exists.
      getLastParamAsObjectID: (): unknown => {
        return mockSiteObjectId;
      },
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

import SiteStatusHero, {
  SiteHeroTileTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteStatusHero";
import SiteSummaryCards from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteSummaryCards";
import {
  SITE_SUMMARY_TILES,
  SiteSummaryTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteSummaryTiles";
import {
  NETWORK_SITE_METRIC_DESCRIPTIONS,
  NetworkSiteMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/NetworkSiteMetricDescriptions";
import NetworkSiteStatusTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/StatusTimeline";
import NetworkSiteChildSites from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/ChildSites";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "../../../Models/DatabaseModels/NetworkEndpoint";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSiteStatusTimeline from "../../../Models/DatabaseModels/NetworkSiteStatusTimeline";
import { Green } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";

const DESCRIPTIONS: Record<NetworkSiteMetric, string> =
  NETWORK_SITE_METRIC_DESCRIPTIONS;

// Handed out by the Navigation mock; below the imports so ObjectID exists.
const mockSiteObjectId: ObjectID = new ObjectID(SITE_ID);

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

async function flush(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderAndSettle(element: React.ReactElement): Promise<void> {
  render(<MemoryRouter>{element}</MemoryRouter>);
  await flush();
}

function infoButtonNames(): Array<string> {
  return screen
    .queryAllByRole("button", { name: /^About / })
    .map((button: HTMLElement): string => {
      return button.getAttribute("aria-label") || "";
    });
}

async function expectExplained(label: string, text: string): Promise<void> {
  const button: HTMLElement = screen.getByRole("button", {
    name: `About ${label}`,
  });

  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  expect(
    screen.getAllByRole("tooltip").map((tooltip: HTMLElement): string => {
      return tooltip.textContent || "";
    }),
  ).toContain(text);

  fireEvent.mouseLeave(button);
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
}

function status(id: string, isOperationalState: boolean): MonitorStatus {
  const row: MonitorStatus = new MonitorStatus();
  row._id = id;
  row.name = isOperationalState ? "Operational" : "Degraded";
  row.color = Green;
  row.priority = isOperationalState ? 1 : 2;
  row.isOperationalState = isOperationalState;
  return row;
}

/*
 * Healthy for the last ten days, except one full day (two to one days ago)
 * spent Degraded.
 */
function timelineRows(): Array<NetworkSiteStatusTimeline> {
  const now: number = Date.now();
  const make: (
    startsAgo: number,
    endsAgo: number | null,
    isOperational: boolean,
  ) => NetworkSiteStatusTimeline = (
    startsAgo: number,
    endsAgo: number | null,
    isOperational: boolean,
  ): NetworkSiteStatusTimeline => {
    const row: NetworkSiteStatusTimeline = new NetworkSiteStatusTimeline();
    row.startsAt = new Date(now - startsAgo * MS_PER_DAY);
    // An open row (still the current status) has no end.
    if (endsAgo !== null) {
      row.endsAt = new Date(now - endsAgo * MS_PER_DAY);
    }

    row.monitorStatus = status(
      isOperational ? OPERATIONAL_ID : DEGRADED_ID,
      isOperational,
    );
    return row;
  };

  return [make(1, null, true), make(2, 1, false), make(10, 2, true)];
}

function site(): NetworkSite {
  const row: NetworkSite = new NetworkSite();
  row._id = SITE_ID;
  row.currentMonitorStatus = status(OPERATIONAL_ID, true);
  row.lastRollupAt = new Date();
  return row;
}

function heroModelAPI(): void {
  getItemMock.mockResolvedValue(site());
  getListMock.mockImplementation((request: unknown): unknown => {
    const modelType: unknown = (request as { modelType: unknown }).modelType;

    if (modelType === NetworkDevice) {
      return Promise.resolve({ data: [], count: 5 });
    }

    if (modelType === NetworkSiteStatusTimeline) {
      return Promise.resolve({ data: timelineRows(), count: 3 });
    }

    return Promise.resolve({ data: [], count: 0 });
  });
  countMock.mockImplementation((request: unknown): unknown => {
    const modelType: unknown = (request as { modelType: unknown }).modelType;

    if (modelType === NetworkSite) {
      return Promise.resolve(2);
    }

    if (modelType === NetworkEndpoint) {
      return Promise.resolve(311);
    }

    return Promise.resolve(0);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  getListMock.mockReset();
  countMock.mockReset();
  fetchSiteSummaryMock.mockReset();
  fetchMaintenanceWindowsMock.mockReset();
  modelTableMock.mockReset();

  fetchMaintenanceWindowsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ---------------------------------------------------------------- the hero

describe("SiteHeroTileTitle", () => {
  test("with a description, the title gets an (i) named after it", async () => {
    render(
      <SiteHeroTileTitle title="Health" description={DESCRIPTIONS.health} />,
    );

    await expectExplained("Health", DESCRIPTIONS.health);
  });

  test("without one, the title stands alone", () => {
    render(<SiteHeroTileTitle title="Site Type" />);

    expect(screen.getByText("Site Type")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("the site Overview hero", () => {
  const HERO_TILES: Array<[string, NetworkSiteMetric]> = [
    ["Health", "health"],
    ["Uptime (24h)", "uptime24h"],
    ["Uptime (30d)", "uptime30d"],
    ["Devices", "devices"],
    ["Child Sites", "childSites"],
    ["Endpoints", "endpoints"],
  ];

  test("the six metric tiles, and not Site Type, carry an (i)", async () => {
    heroModelAPI();

    await renderAndSettle(<SiteStatusHero modelId={new ObjectID(SITE_ID)} />);

    expect(screen.getByTestId("site-status-hero")).toBeInTheDocument();
    expect(screen.getByText("Site Type")).toBeInTheDocument();
    expect(infoButtonNames()).toEqual(
      HERO_TILES.map(([title]: [string, NetworkSiteMetric]): string => {
        return `About ${title}`;
      }),
    );
  });

  test.each(HERO_TILES)(
    "the %s tile's (i) reads NETWORK_SITE_METRIC_DESCRIPTIONS.%s",
    async (title: string, key: NetworkSiteMetric) => {
      heroModelAPI();

      await renderAndSettle(<SiteStatusHero modelId={new ObjectID(SITE_ID)} />);

      await expectExplained(title, DESCRIPTIONS[key]);
    },
  );

  test("the 30-day figure the (i) explains: one Degraded day in the window is downtime", async () => {
    heroModelAPI();

    await renderAndSettle(<SiteStatusHero modelId={new ObjectID(SITE_ID)} />);

    /*
     * Ten days of history, one of them Degraded, measured over 30 days: the
     * twenty days before the first rollup count as up, so the tile reads
     * 29/30 = 96.7% — the "about 3.3 points" and "counts as up" the (i)
     * promises.
     */
    expect(screen.getByText("96.7%")).toBeInTheDocument();
    expect(DESCRIPTIONS.uptime30d).toContain("about 3.3 points");
    expect(DESCRIPTIONS.uptime30d).toContain(
      "time before the first rollup counts as up",
    );
  });

  test("the skeleton draws no titles, and so no (i)", async () => {
    getItemMock.mockReturnValue(
      new Promise<NetworkSite>(() => {
        // Never settles.
      }),
    );
    getListMock.mockReturnValue(
      new Promise<unknown>(() => {
        // Never settles.
      }),
    );
    countMock.mockReturnValue(
      new Promise<number>(() => {
        // Never settles.
      }),
    );

    await renderAndSettle(<SiteStatusHero modelId={new ObjectID(SITE_ID)} />);

    expect(screen.getByTestId("site-status-hero-skeleton")).toBeInTheDocument();
    expect(infoButtonNames()).toEqual([]);
  });
});

// ------------------------------------------------------ the summary strip

const SITE_COUNTS: {
  totalSites: number;
  unhealthySites: number;
  sitesWithNoData: number;
  devicesWithoutSite: number;
  unhealthyStatusIds: Array<string>;
} = {
  totalSites: 12,
  unhealthySites: 2,
  sitesWithNoData: 3,
  devicesWithoutSite: 9,
  unhealthyStatusIds: [DEGRADED_ID],
};

describe("the Sites list summary strip", () => {
  test("every tile carries an (i), in tile order", async () => {
    fetchSiteSummaryMock.mockResolvedValue(SITE_COUNTS);

    await renderAndSettle(
      <SiteSummaryCards facetSelections={{}} facetOperators={{}} />,
    );

    expect(infoButtonNames()).toEqual(
      SITE_SUMMARY_TILES.map((tile: SiteSummaryTile): string => {
        return `About ${tile.label}`;
      }),
    );
  });

  test.each(
    SITE_SUMMARY_TILES.map((tile: SiteSummaryTile): [string, string] => {
      return [tile.label, tile.description];
    }),
  )(
    "the %s tile's (i) reads its description",
    async (label: string, text: string) => {
      fetchSiteSummaryMock.mockResolvedValue(SITE_COUNTS);

      await renderAndSettle(
        <SiteSummaryCards facetSelections={{}} facetOperators={{}} />,
      );

      await expectExplained(label, text);
    },
  );

  test("asking what a tile means does not activate it", async () => {
    const onTileClick: MockFunction = getJestMockFunction();
    fetchSiteSummaryMock.mockResolvedValue(SITE_COUNTS);

    await renderAndSettle(
      <SiteSummaryCards
        facetSelections={{}}
        facetOperators={{}}
        onTileClick={onTileClick}
      />,
    );

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Unassigned Devices",
    });

    fireEvent.click(info);
    fireEvent.keyDown(info, { key: "Enter" });
    fireEvent.keyDown(info, { key: " " });

    expect(onTileClick).not.toHaveBeenCalled();

    /*
     * The tile itself still activates. Found by its accessible name, which
     * is the card's own control whichever way InfoCard draws a clickable
     * card.
     */
    fireEvent.click(
      screen.getByRole("button", { name: /^Unassigned Devices: 9\. Activate/ }),
    );
    expect(onTileClick).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------- Status Timeline tab

describe("the Status Timeline tab", () => {
  const CARD_TITLES: Array<string> = [
    "Uptime — Last 24 Hours",
    "Uptime — Last 7 Days",
    "Uptime — Last 30 Days",
    "Uptime — Last 90 Days",
  ];

  function timelineModelAPI(): void {
    getListMock.mockResolvedValue({ data: timelineRows(), count: 3 });
  }

  test("each uptime card and the daily strip's heading carry an (i)", async () => {
    timelineModelAPI();

    await renderAndSettle(<NetworkSiteStatusTimelinePage {...PAGE_PROPS} />);

    expect(infoButtonNames()).toEqual([
      ...CARD_TITLES.map((title: string): string => {
        return `About ${title}`;
      }),
      "About Daily Uptime — Last 30 Days",
    ]);
  });

  test.each(CARD_TITLES)(
    "the %s card's (i) reads the window text",
    async (title: string) => {
      timelineModelAPI();

      await renderAndSettle(<NetworkSiteStatusTimelinePage {...PAGE_PROPS} />);

      await expectExplained(title, DESCRIPTIONS.uptimeWindow);
    },
  );

  test("the daily strip's (i) is its legend", async () => {
    timelineModelAPI();

    await renderAndSettle(<NetworkSiteStatusTimelinePage {...PAGE_PROPS} />);

    expect(screen.getByTestId("site-daily-uptime-strip")).toBeInTheDocument();
    await expectExplained(
      "Daily Uptime — Last 30 Days",
      DESCRIPTIONS.dailyUptime,
    );
  });

  test("with no history there is nothing to measure, and no (i)", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0 });

    await renderAndSettle(<NetworkSiteStatusTimelinePage {...PAGE_PROPS} />);

    expect(infoButtonNames()).toEqual([]);
  });

  test("the history table's Status column is a record of states, not a metric", async () => {
    timelineModelAPI();

    await renderAndSettle(<NetworkSiteStatusTimelinePage {...PAGE_PROPS} />);

    const props: { columns: Array<{ title: string; headerTooltip?: string }> } =
      modelTableMock.mock.calls[modelTableMock.mock.calls.length - 1]![0] as {
        columns: Array<{ title: string; headerTooltip?: string }>;
      };

    for (const column of props.columns) {
      expect({ title: column.title, tooltip: column.headerTooltip }).toEqual({
        title: column.title,
        tooltip: undefined,
      });
    }
  });
});

// -------------------------------------------------------- Child Sites tab

describe("the Child Sites tab", () => {
  test("the Status column explains the rollup; Name and Site Type do not", async () => {
    await renderAndSettle(<NetworkSiteChildSites {...PAGE_PROPS} />);

    expect(modelTableMock).toHaveBeenCalled();

    const props: { columns: Array<{ title: string; headerTooltip?: string }> } =
      modelTableMock.mock.calls[modelTableMock.mock.calls.length - 1]![0] as {
        columns: Array<{ title: string; headerTooltip?: string }>;
      };
    const tooltips: Record<string, string | undefined> = {};

    for (const column of props.columns) {
      tooltips[column.title] = column.headerTooltip;
    }

    expect(tooltips).toEqual({
      Name: undefined,
      "Site Type": undefined,
      Status: DESCRIPTIONS.childSiteStatus,
    });
  });
});
