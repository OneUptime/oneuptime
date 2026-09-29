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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import NetworkTopologyExplorer, {
  ComponentProps as ExplorerProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyExplorer";
import { ComponentProps as LiveViewProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyLiveView";

/*
 * Issue #3981 — the Device Topology explorer's search box, rendered for real.
 *
 * The customer's complaint was that the box only filtered the level on
 * screen: finding "Unit 104822" meant knowing which region and which market
 * to open first, which is exactly the thing somebody searching does not
 * know. The fix mounts the Network Map's SiteSearchBox in the explorer, so
 * one box now gives two answers — typing still narrows this level's cards,
 * and the dropdown lists matches from ANYWHERE in the hierarchy, each with
 * the path to it, and picking one drills straight there.
 *
 * Everything between the keystroke and the drill is real here: the explorer,
 * the search box, the Input underneath it, the cards, the breadcrumb and the
 * health chips. Only the edges are stubbed — the HTTP layer answers
 * /network-site/children and /network-site/search from an in-memory
 * hierarchy, the URL helper records what the explorer writes, and the device
 * graph is replaced by a stub that prints the scope it was handed. That
 * keeps the assertions about behaviour a reader can see (which cards, which
 * level, which graph) rather than about which setter ran.
 */

type PostOptions = {
  url: { toString: () => string };
  data?: JSONObject | undefined;
  headers?: Dictionary<string> | undefined;
};

const postMock: MockFunction = getJestMockFunction();
const setQueryStringMock: MockFunction = getJestMockFunction();
const getQueryStringByNameMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Dictionary<string> => {
        return { tenantid: "project-3981" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getQueryStringByName: (...args: Array<unknown>): unknown => {
        return getQueryStringByNameMock(...args);
      },
      setQueryString: (...args: Array<unknown>): unknown => {
        return setQueryStringMock(...args);
      },
      navigate: (...args: Array<unknown>): unknown => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return new ObjectID("dde060c6-fe0d-49ce-b44c-4035a13bc1db");
      },
    },
  };
});

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
 * The device graph is its own component with its own tests. Here it only
 * has to say which site it was scoped to and which layout it opened on —
 * the two things the drill decides.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyLiveView",
  () => {
    return {
      __esModule: true,
      default: (props: LiveViewProps): ReactElement => {
        return (
          <div
            data-testid="live-view-stub"
            data-site-id={props.siteId || ""}
            data-layout-mode={props.layoutMode || ""}
          >
            {`siteId=${props.siteId || "none"} layoutMode=${
              props.layoutMode || "none"
            }`}
          </div>
        );
      },
    };
  },
);

/*
 * ------------------------------------------------------------------
 * An in-memory hierarchy: Franchise A > Region East > Market 5 > Unit
 * 104822, plus two sibling regions so the root level has something to
 * narrow and a second branch to drill sideways into.
 * ------------------------------------------------------------------
 */

const FRANCHISE_ID: string = "franchise-a";
const REGION_EAST_ID: string = "region-east";
const REGION_WEST_ID: string = "region-west";
const REGION_CENTRAL_ID: string = "region-central";
const MARKET_ID: string = "market-5";
const MARKET_WEST_ID: string = "market-9";
const UNIT_ID: string = "unit-104822";
const OTHER_UNIT_ID: string = "unit-200";

const UNIT_NAME: string = "Unit 104822 - Michigan Ave";
const UNIT_PATH: string = "Franchise A / Region East / Market 5";

const SEARCH_ID: string = "topology-hierarchy-search";

function deviceStats(input: {
  down?: number;
  degraded?: number;
  healthy?: number;
}): JSONObject {
  const down: number = input.down || 0;
  const degraded: number = input.degraded || 0;
  const healthy: number = input.healthy || 0;
  return {
    down: down,
    degraded: degraded,
    healthy: healthy,
    unknown: 0,
    total: down + degraded + healthy,
  };
}

function childRow(input: {
  id: string;
  name: string;
  siteType: string;
  isUnitLevel?: boolean;
  down?: number;
  healthy?: number;
}): JSONObject {
  const stats: JSONObject = deviceStats({
    down: input.down || 0,
    healthy: input.healthy || 0,
  });
  return {
    id: input.id,
    name: input.name,
    siteType: input.siteType,
    isUnitLevel: input.isUnitLevel === true,
    childSiteCount: input.isUnitLevel ? 0 : 1,
    deviceCount: stats["total"] as number,
    deviceStats: stats,
    unitStats: { totalUnits: 0, operationalUnits: 0 },
    uptimePercent: null,
    dailyUptimePercent: null,
    isUnderMaintenance: false,
  };
}

function crumb(
  id: string,
  name: string,
  siteType: string,
  isUnitLevel: boolean = false,
): JSONObject {
  return { id: id, name: name, siteType: siteType, isUnitLevel: isUnitLevel };
}

/*
 * attachedDeviceCount must be above zero on every level: at the root a
 * hierarchy nobody attached a device to falls back to the flat map, and
 * this suite is about the hierarchy.
 */
function level(
  breadcrumb: Array<JSONObject>,
  children: Array<JSONObject>,
  ownDeviceStats: JSONObject = deviceStats({}),
): JSONObject {
  return {
    breadcrumb: breadcrumb,
    children: children,
    links: [],
    ownDeviceStats: ownDeviceStats,
    deviceScope: { attachedDeviceCount: 24, unattachedDeviceCount: 0 },
    childrenTruncated: false,
    descendantCountsTruncated: false,
  };
}

const ROOT_LEVEL: JSONObject = level(
  [],
  [
    childRow({
      id: REGION_CENTRAL_ID,
      name: "Region Central",
      siteType: "Region",
      healthy: 3,
    }),
    childRow({
      id: REGION_EAST_ID,
      name: "Region East",
      siteType: "Region",
      healthy: 10,
    }),
    // The one region with a device down, so the "Down" chip has a match.
    childRow({
      id: REGION_WEST_ID,
      name: "Region West",
      siteType: "Region",
      down: 2,
      healthy: 5,
    }),
  ],
);

const MARKET_BREADCRUMB: Array<JSONObject> = [
  crumb(FRANCHISE_ID, "Franchise A", "Franchise"),
  crumb(REGION_EAST_ID, "Region East", "Region"),
  crumb(MARKET_ID, "Market 5", "Market"),
];

const LEVELS: Dictionary<JSONObject> = {
  [REGION_EAST_ID]: level(
    [
      crumb(FRANCHISE_ID, "Franchise A", "Franchise"),
      crumb(REGION_EAST_ID, "Region East", "Region"),
    ],
    [childRow({ id: MARKET_ID, name: "Market 5", siteType: "Market" })],
  ),
  [REGION_WEST_ID]: level(
    [
      crumb(FRANCHISE_ID, "Franchise A", "Franchise"),
      crumb(REGION_WEST_ID, "Region West", "Region"),
    ],
    [
      childRow({
        id: MARKET_WEST_ID,
        name: "Market 9",
        siteType: "Market",
        down: 2,
      }),
    ],
  ),
  [MARKET_ID]: level(MARKET_BREADCRUMB, [
    childRow({
      id: UNIT_ID,
      name: UNIT_NAME,
      siteType: "Unit",
      isUnitLevel: true,
      down: 1,
    }),
    childRow({
      id: OTHER_UNIT_ID,
      name: "Unit 200 - State St",
      siteType: "Unit",
      isUnitLevel: true,
      healthy: 4,
    }),
  ]),
  [UNIT_ID]: level(
    [...MARKET_BREADCRUMB, crumb(UNIT_ID, UNIT_NAME, "Unit", true)],
    [],
    deviceStats({ down: 1, healthy: 3 }),
  ),
};

interface IndexedSite {
  id: string;
  name: string;
  siteType: string;
  isUnitLevel: boolean;
  path: string;
}

const SEARCH_INDEX: Array<IndexedSite> = [
  {
    id: FRANCHISE_ID,
    name: "Franchise A",
    siteType: "Franchise",
    isUnitLevel: false,
    path: "",
  },
  {
    id: REGION_CENTRAL_ID,
    name: "Region Central",
    siteType: "Region",
    isUnitLevel: false,
    path: "Franchise A",
  },
  {
    id: REGION_EAST_ID,
    name: "Region East",
    siteType: "Region",
    isUnitLevel: false,
    path: "Franchise A",
  },
  {
    id: REGION_WEST_ID,
    name: "Region West",
    siteType: "Region",
    isUnitLevel: false,
    path: "Franchise A",
  },
  {
    id: MARKET_ID,
    name: "Market 5",
    siteType: "Market",
    isUnitLevel: false,
    path: "Franchise A / Region East",
  },
  {
    id: UNIT_ID,
    name: UNIT_NAME,
    siteType: "Unit",
    isUnitLevel: true,
    path: UNIT_PATH,
  },
  {
    id: OTHER_UNIT_ID,
    name: "Unit 200 - State St",
    siteType: "Unit",
    isUnitLevel: true,
    path: UNIT_PATH,
  },
];

/*
 * The server's rule, in miniature: every word, anywhere in the name. The
 * word "unit" is also made to hit the result cap so the truncation line has
 * a case of its own.
 */
function searchFixture(searchText: string): JSONObject {
  const words: Array<string> = searchText
    .toLowerCase()
    .split(/\s+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });
  const results: Array<JSONObject> = SEARCH_INDEX.filter(
    (site: IndexedSite): boolean => {
      return (
        words.length > 0 &&
        words.every((word: string): boolean => {
          return site.name.toLowerCase().includes(word);
        })
      );
    },
  ).map((site: IndexedSite): JSONObject => {
    return {
      id: site.id,
      name: site.name,
      siteType: site.siteType,
      isUnitLevel: site.isUnitLevel,
      path: site.path,
      currentMonitorStatus:
        site.id === UNIT_ID
          ? {
              id: "status-operational",
              name: "Operational",
              color: "#16a34a",
              priority: 1,
              isOperationalState: true,
            }
          : undefined,
    } as JSONObject;
  });
  return { results: results, isTruncated: searchText.trim() === "unit" };
}

function routeOf(options: PostOptions): string {
  return options.url.toString();
}

function defaultPost(options: PostOptions): Promise<unknown> {
  const route: string = routeOf(options);
  if (route.includes("/network-site/children")) {
    const siteId: string | undefined = options.data?.["siteId"] as
      | string
      | undefined;
    const body: JSONObject | undefined = siteId ? LEVELS[siteId] : ROOT_LEVEL;
    if (!body) {
      return Promise.reject(new Error(`No level fixture for ${siteId}`));
    }
    return Promise.resolve({ data: body });
  }
  if (route.includes("/network-site/search")) {
    return Promise.resolve({
      data: searchFixture(String(options.data?.["searchText"] || "")),
    });
  }
  return Promise.reject(new Error(`Unexpected request to ${route}`));
}

function postsTo(route: string): Array<PostOptions> {
  return postMock.mock.calls
    .map((call: Array<unknown>): PostOptions => {
      return call[0] as PostOptions;
    })
    .filter((options: PostOptions): boolean => {
      return routeOf(options).includes(route);
    });
}

function childrenPosts(): Array<PostOptions> {
  return postsTo("/network-site/children");
}

function searchPosts(): Array<PostOptions> {
  return postsTo("/network-site/search");
}

function searchInput(): HTMLInputElement {
  return screen.getByTestId(SEARCH_ID) as HTMLInputElement;
}

function typeSearch(value: string): void {
  const input: HTMLInputElement = searchInput();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: value } });
}

function resultCountText(): string {
  return (
    screen.getByTestId("topology-hierarchy-result-count").textContent || ""
  );
}

function waitMs(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

async function renderExplorer(
  props: ExplorerProps = {},
  firstCardId: string = REGION_EAST_ID,
): Promise<void> {
  render(<NetworkTopologyExplorer {...props} />);
  await screen.findByTestId(`site-card-${firstCardId}`);
}

// Type the query and wait for the debounced dropdown to answer it.
async function searchFor(value: string, hitId: string): Promise<HTMLElement> {
  typeSearch(value);
  return screen.findByTestId(`${SEARCH_ID}-result-${hitId}`);
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockImplementation((...args: Array<unknown>): unknown => {
    return defaultPost(args[0] as PostOptions);
  });
  setQueryStringMock.mockReset();
  navigateMock.mockReset();
  getQueryStringByNameMock.mockReset();
  getQueryStringByNameMock.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

/*
 * The box itself: the explorer mounts the shared SiteSearchBox under its
 * own test-id prefix and copy, and hides the box's local count because the
 * explorer already prints one beside it.
 */
describe("the explorer mounts the hierarchy-wide search box", () => {
  test("the root renders its region cards and the new search box", async () => {
    await renderExplorer();

    expect(screen.getByTestId(`site-card-${REGION_EAST_ID}`)).toBeVisible();
    expect(screen.getByTestId(`site-card-${REGION_WEST_ID}`)).toBeVisible();
    expect(screen.getByTestId(`site-card-${REGION_CENTRAL_ID}`)).toBeVisible();

    const input: HTMLInputElement = searchInput();
    expect(input).toHaveAttribute(
      "placeholder",
      "Search sites by name — anywhere in your network",
    );
    expect(input).toHaveAttribute(
      "aria-label",
      "Search sites by name — anywhere in your network",
    );
    expect(input).toHaveValue("");
    expect(resultCountText()).toBe("3 of 3 regions · Updates every minute");

    // The root level was the only thing fetched: nothing searched yet.
    expect(childrenPosts()).toHaveLength(1);
    expect(childrenPosts()[0]!.data).toEqual({});
    expect(searchPosts()).toHaveLength(0);
  });

  /*
   * The Network Map keeps the default "network-map-search" prefix; the
   * explorer must never render under it, or two pages' tests (and any
   * automation built on them) would be reading each other's ids.
   */
  test("every id the box renders uses the explorer's prefix", async () => {
    await renderExplorer();
    await searchFor("104822", UNIT_ID);

    expect(screen.getByTestId(`${SEARCH_ID}-results`)).toBeVisible();
    expect(screen.getByTestId(`${SEARCH_ID}-clear`)).toBeVisible();
    expect(screen.queryByTestId("network-map-search")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-map-search-results"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`network-map-search-result-${UNIT_ID}`),
    ).not.toBeInTheDocument();
  });

  test("the box is a combobox wired to its listbox", async () => {
    await renderExplorer();
    const input: HTMLInputElement = searchInput();

    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-haspopup", "listbox");
    expect(input).toHaveAttribute("aria-expanded", "false");
    // aria-controls only while there is something to control.
    expect(input).not.toHaveAttribute("aria-controls");
    expect(input).not.toHaveAttribute("aria-activedescendant");

    const hit: HTMLElement = await searchFor("104822", UNIT_ID);

    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", `${SEARCH_ID}-listbox`);
    const listbox: HTMLElement = screen.getByRole("listbox", {
      name: "Site search results",
    });
    expect(listbox).toHaveAttribute("id", `${SEARCH_ID}-listbox`);
    expect(hit).toHaveAttribute("id", `${SEARCH_ID}-option-${UNIT_ID}`);
    expect(hit).toHaveAttribute("role", "option");
    expect(hit).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      `${SEARCH_ID}-option-${UNIT_ID}`,
    );
    expect(hit).toHaveAttribute("aria-selected", "true");
  });

  /*
   * The explorer prints "x of y regions" to the right of the box already.
   * The box's own "Showing x of y at this level" line would say the same
   * thing twice, one line apart.
   */
  test("the box's own local-count line is not rendered", async () => {
    await renderExplorer();
    typeSearch("east");

    expect(resultCountText()).toBe("1 of 3 regions · Updates every minute");
    expect(
      screen.queryByTestId(`${SEARCH_ID}-local-count`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-map-search-local-count"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/at this level$/)).not.toBeInTheDocument();
  });
});

/*
 * The customer's actual scenario, end to end: a unit number typed at the
 * root, where no card matches it, found four levels down and opened in one
 * click.
 */
describe("finding a unit from the root", () => {
  test("typing a unit number empties the level and lists the unit with its path", async () => {
    await renderExplorer();
    typeSearch("104822");

    // The local half answers at once: nothing at this level matches.
    expect(resultCountText()).toBe("0 of 3 regions · Updates every minute");
    expect(
      screen.queryByTestId(`site-card-${REGION_EAST_ID}`),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No sites match your filters")).toBeVisible();

    // The remote half is debounced, so nothing has been asked for yet.
    expect(searchPosts()).toHaveLength(0);

    const hit: HTMLElement = await screen.findByTestId(
      `${SEARCH_ID}-result-${UNIT_ID}`,
    );
    expect(hit).toHaveTextContent(UNIT_NAME);
    expect(hit).toHaveTextContent(UNIT_PATH);
    expect(hit).toHaveTextContent("Unit");
    expect(screen.getByText(UNIT_PATH)).toBeVisible();

    expect(searchPosts()).toHaveLength(1);
    expect(searchPosts()[0]!.data).toEqual({ searchText: "104822" });
  });

  test("clicking the unit opens its device topology, scoped and tiered", async () => {
    await renderExplorer();
    const hit: HTMLElement = await searchFor("104822", UNIT_ID);
    const childrenBefore: number = childrenPosts().length;

    fireEvent.click(hit);

    const stub: HTMLElement = await screen.findByTestId("live-view-stub");
    expect(stub).toHaveAttribute("data-site-id", UNIT_ID);
    expect(stub).toHaveAttribute("data-layout-mode", "tiered");
    expect(stub).toHaveTextContent(`siteId=${UNIT_ID} layoutMode=tiered`);

    // Exactly one new level fetch, for the unit that was picked.
    expect(childrenPosts()).toHaveLength(childrenBefore + 1);
    expect(childrenPosts()[childrenPosts().length - 1]!.data).toEqual({
      siteId: UNIT_ID,
    });
    expect(childrenPosts()[childrenPosts().length - 1]!.headers).toMatchObject({
      tenantid: "project-3981",
    });

    // The level and its box are gone; the breadcrumb names the whole path.
    expect(screen.queryByTestId(SEARCH_ID)).not.toBeInTheDocument();
    const trail: HTMLElement = screen.getByRole("navigation", {
      name: "Site breadcrumb",
    });
    expect(within(trail).getByText("Franchise A")).toBeVisible();
    expect(within(trail).getByText("Region East")).toBeVisible();
    expect(within(trail).getByText("Market 5")).toBeVisible();
    expect(within(trail).getByText(UNIT_NAME)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the drill is mirrored to the URL once the 200 ms debounce passes", async () => {
    await renderExplorer();
    const hit: HTMLElement = await searchFor("104822", UNIT_ID);

    fireEvent.click(hit);
    // Not synchronously: the write is debounced.
    expect(setQueryStringMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(setQueryStringMock).toHaveBeenCalledWith({
        topologySite: UNIT_ID,
        topologyDevices: null,
      });
    });
    expect(setQueryStringMock).toHaveBeenCalledTimes(1);
  });

  test("a page opened with a device layout of its own keeps it for the picked unit", async () => {
    await renderExplorer({ siteLayoutMode: "force" });
    fireEvent.click(await searchFor("104822", UNIT_ID));

    const stub: HTMLElement = await screen.findByTestId("live-view-stub");
    expect(stub).toHaveAttribute("data-site-id", UNIT_ID);
    expect(stub).toHaveAttribute("data-layout-mode", "force");
  });

  /*
   * The box clears on the way through. Arriving back at a level with the
   * old question still typed into it would leave that level filtered by a
   * unit number that matches nothing on it.
   */
  test("walking back up from the unit finds an empty box and a full level", async () => {
    await renderExplorer();
    fireEvent.click(await searchFor("104822", UNIT_ID));
    await screen.findByTestId("live-view-stub");

    const trail: HTMLElement = screen.getByRole("navigation", {
      name: "Site breadcrumb",
    });
    fireEvent.click(within(trail).getByText("Market 5"));

    await screen.findByTestId(`site-card-${UNIT_ID}`);
    expect(searchInput()).toHaveValue("");
    expect(screen.getByTestId(`site-card-${OTHER_UNIT_ID}`)).toBeVisible();
    expect(resultCountText()).toBe("2 of 2 units · Updates every minute");
  });
});

/*
 * Not every hit is a unit. A region or a market opens its own level of
 * cards, exactly as clicking its card would have — the search only skips
 * the levels in between.
 */
describe("picking a mid-level site", () => {
  test("a market hit renders that market's level with its breadcrumb", async () => {
    await renderExplorer();
    const hit: HTMLElement = await searchFor("market 5", MARKET_ID);
    expect(hit).toHaveTextContent("Franchise A / Region East");

    fireEvent.click(hit);

    await screen.findByTestId(`site-card-${UNIT_ID}`);
    expect(screen.getByTestId(`site-card-${OTHER_UNIT_ID}`)).toBeVisible();
    expect(screen.queryByTestId("live-view-stub")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Explore the units in Market 5. Each card includes the health of the devices below it.",
      ),
    ).toBeVisible();
    expect(resultCountText()).toBe("2 of 2 units · Updates every minute");

    const trail: HTMLElement = screen.getByRole("navigation", {
      name: "Site breadcrumb",
    });
    expect(within(trail).getByTestId("site-breadcrumb-root")).toBeVisible();
    expect(within(trail).getByText("Franchise A").tagName).toBe("BUTTON");
    expect(within(trail).getByText("Region East").tagName).toBe("BUTTON");
    expect(within(trail).getByText("Market 5")).toHaveAttribute(
      "aria-current",
      "page",
    );

    expect(childrenPosts()[childrenPosts().length - 1]!.data).toEqual({
      siteId: MARKET_ID,
    });
  });

  test("the destination level's box is cleared and its dropdown closed", async () => {
    await renderExplorer();
    fireEvent.click(await searchFor("market 5", MARKET_ID));
    await screen.findByTestId(`site-card-${UNIT_ID}`);

    expect(searchInput()).toHaveValue("");
    expect(searchInput()).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId(`${SEARCH_ID}-results`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("topology-hierarchy-reset-filters"),
    ).not.toBeInTheDocument();
  });

  test("a hit in another branch drills sideways from a drilled level", async () => {
    getQueryStringByNameMock.mockImplementation((name: unknown): unknown => {
      return name === "topologySite" ? MARKET_ID : null;
    });
    await renderExplorer({}, UNIT_ID);

    const hit: HTMLElement = await searchFor("region west", REGION_WEST_ID);
    fireEvent.click(hit);

    await screen.findByTestId(`site-card-${MARKET_WEST_ID}`);
    const trail: HTMLElement = screen.getByRole("navigation", {
      name: "Site breadcrumb",
    });
    expect(within(trail).getByText("Region West")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(trail).queryByText("Market 5")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(setQueryStringMock).toHaveBeenCalledWith({
        topologySite: REGION_WEST_ID,
        topologyDevices: null,
      });
    });
  });

  /*
   * changeSite no-ops on an unchanged target. Picking the site already in
   * view therefore only closes the question: the box clears, no level is
   * refetched and the URL is left alone.
   */
  test("picking the site already in view refetches nothing", async () => {
    getQueryStringByNameMock.mockImplementation((name: unknown): unknown => {
      return name === "topologySite" ? MARKET_ID : null;
    });
    await renderExplorer({}, UNIT_ID);
    expect(childrenPosts()).toHaveLength(1);

    fireEvent.click(await searchFor("market 5", MARKET_ID));

    expect(searchInput()).toHaveValue("");
    expect(screen.getByTestId(`site-card-${UNIT_ID}`)).toBeVisible();
    await waitMs(300);
    expect(childrenPosts()).toHaveLength(1);
    expect(setQueryStringMock).not.toHaveBeenCalled();
  });
});

/*
 * The local half of the box, which is what the explorer's search did
 * before issue #3981 and must keep doing: typing narrows the cards of the
 * level in view on every keystroke.
 */
describe("typing still narrows the level in view", () => {
  test("a region name narrows the cards and the count follows", async () => {
    await renderExplorer();
    typeSearch("west");

    expect(screen.getByTestId(`site-card-${REGION_WEST_ID}`)).toBeVisible();
    expect(
      screen.queryByTestId(`site-card-${REGION_EAST_ID}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`site-card-${REGION_CENTRAL_ID}`),
    ).not.toBeInTheDocument();
    expect(resultCountText()).toBe("1 of 3 regions · Updates every minute");

    // Every word, in any order, the same rule the dropdown's server uses.
    typeSearch("EAST region");
    expect(screen.getByTestId(`site-card-${REGION_EAST_ID}`)).toBeVisible();
    expect(resultCountText()).toBe("1 of 3 regions · Updates every minute");

    typeSearch("region");
    expect(resultCountText()).toBe("3 of 3 regions · Updates every minute");
  });

  test("the local narrowing never waits for the server", async () => {
    await renderExplorer();
    postMock.mockImplementation((...args: Array<unknown>): unknown => {
      const options: PostOptions = args[0] as PostOptions;
      if (routeOf(options).includes("/network-site/search")) {
        return new Promise<unknown>(() => {
          // Never answers.
        });
      }
      return defaultPost(options);
    });

    typeSearch("central");

    expect(screen.getByTestId(`site-card-${REGION_CENTRAL_ID}`)).toBeVisible();
    expect(resultCountText()).toBe("1 of 3 regions · Updates every minute");
    expect(await screen.findByTestId(`${SEARCH_ID}-searching`)).toBeVisible();
  });

  test("the search request carries the normalized text and the project header", async () => {
    await renderExplorer();
    typeSearch("  MICHIGAN 104822  ");

    await screen.findByTestId(`${SEARCH_ID}-result-${UNIT_ID}`);
    expect(searchPosts()).toHaveLength(1);
    expect(searchPosts()[0]!.data).toEqual({ searchText: "michigan 104822" });
    expect(searchPosts()[0]!.headers).toMatchObject({
      tenantid: "project-3981",
    });
    expect(routeOf(searchPosts()[0]!)).toContain("/network-site/search");
  });

  test("a burst of keystrokes is one request, for the last text", async () => {
    await renderExplorer();
    for (const value of ["1", "10", "104", "1048", "10482", "104822"]) {
      typeSearch(value);
    }

    await screen.findByTestId(`${SEARCH_ID}-result-${UNIT_ID}`);
    await waitMs(300);
    expect(searchPosts()).toHaveLength(1);
    expect(searchPosts()[0]!.data).toEqual({ searchText: "104822" });
  });

  /*
   * One character matches most of an estate, so the box does not ask the
   * server below two. Measured after trimming: padding a single letter
   * with spaces is still a single letter.
   */
  test.each(["e", " e ", "   "])(
    "%j narrows locally but never reaches the server",
    async (value: string) => {
      await renderExplorer();
      typeSearch(value);

      await waitMs(400);
      expect(searchPosts()).toHaveLength(0);
      expect(
        screen.queryByTestId(`${SEARCH_ID}-results`),
      ).not.toBeInTheDocument();
      expect(searchInput()).toHaveAttribute("aria-expanded", "false");
    },
  );

  test("typing never writes the URL", async () => {
    await renderExplorer();
    await searchFor("104822", UNIT_ID);
    await waitMs(300);
    expect(setQueryStringMock).not.toHaveBeenCalled();
  });
});

/*
 * The empty state is where a reader lands when the level has nothing for
 * them. Before issue #3981 that was a dead end; now the answer is usually in
 * the dropdown, and the copy has to say so — but only when the dropdown can
 * actually have one.
 */
describe("the empty level points at the dropdown only when it can help", () => {
  test("two or more characters mention matches anywhere in the network", async () => {
    await renderExplorer();
    typeSearch("zz");

    expect(screen.getByText("No sites match your filters")).toBeVisible();
    const description: HTMLElement = screen.getByTestId(
      "topology-hierarchy-empty-description",
    );
    expect(description).toHaveTextContent(
      "No regions at this level match what you are looking for. Click the search box to see matching sites from anywhere in your network, or clear the search or the health filter to see the rest of this level.",
    );
  });

  test("a single character keeps the old copy", async () => {
    await renderExplorer();
    typeSearch("z");

    const description: HTMLElement = screen.getByTestId(
      "topology-hierarchy-empty-description",
    );
    expect(description).toHaveTextContent(
      "No regions at this level match what you are looking for. Clear the search or the health filter to see the rest.",
    );
    expect(description).not.toHaveTextContent("anywhere in your network");
  });

  test("a single character padded with spaces is still a single character", async () => {
    await renderExplorer();
    typeSearch("  z  ");

    expect(
      screen.getByTestId("topology-hierarchy-empty-description"),
    ).not.toHaveTextContent("anywhere in your network");
  });

  test("a health filter alone never points at the dropdown", async () => {
    await renderExplorer();
    fireEvent.click(screen.getByTestId("topology-hierarchy-filter-degraded"));

    const description: HTMLElement = screen.getByTestId(
      "topology-hierarchy-empty-description",
    );
    expect(description).toHaveTextContent(
      "Clear the search or the health filter to see the rest.",
    );
    expect(description).not.toHaveTextContent("anywhere in your network");
  });

  test('"Clear filters" empties the box and brings the level back', async () => {
    await renderExplorer();
    await searchFor("104822", UNIT_ID);
    expect(resultCountText()).toBe("0 of 3 regions · Updates every minute");

    fireEvent.click(screen.getByTestId("topology-hierarchy-reset-filters"));

    expect(searchInput()).toHaveValue("");
    expect(resultCountText()).toBe("3 of 3 regions · Updates every minute");
    expect(screen.getByTestId(`site-card-${REGION_EAST_ID}`)).toBeVisible();
    expect(
      screen.queryByTestId("topology-hierarchy-reset-filters"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`${SEARCH_ID}-results`),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId(`${SEARCH_ID}-clear`)).not.toBeInTheDocument();
  });

  test("the box's own clear button does the same for the text", async () => {
    await renderExplorer();
    typeSearch("west");
    expect(resultCountText()).toBe("1 of 3 regions · Updates every minute");

    fireEvent.click(screen.getByTestId(`${SEARCH_ID}-clear`));

    expect(searchInput()).toHaveValue("");
    expect(resultCountText()).toBe("3 of 3 regions · Updates every minute");
  });
});

/*
 * A drill resets the health filter: "Down" at one level says nothing about
 * the next, and arriving inside a market with the filter still on would
 * hide most of it for a reason two rows up. A drill from the dropdown is a
 * drill like any other.
 */
describe("a pick from the dropdown is a drill like any other", () => {
  test("it resets an active health filter", async () => {
    await renderExplorer();
    fireEvent.click(screen.getByTestId("topology-hierarchy-filter-down"));
    expect(
      screen.getByTestId("topology-hierarchy-filter-down"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(resultCountText()).toBe("1 of 3 regions · Updates every minute");

    fireEvent.click(await searchFor("market 5", MARKET_ID));
    await screen.findByTestId(`site-card-${UNIT_ID}`);

    expect(screen.getByTestId("topology-hierarchy-filter-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByTestId("topology-hierarchy-filter-down"),
    ).toHaveAttribute("aria-pressed", "false");
    // The healthy unit is on screen: "Down" did not follow the reader in.
    expect(screen.getByTestId(`site-card-${OTHER_UNIT_ID}`)).toBeVisible();
    expect(resultCountText()).toBe("2 of 2 units · Updates every minute");
  });

  /*
   * The box only exists on the hierarchy view, so a device view cannot be
   * on screen while a hit is picked — but the URL can still carry the
   * parameter, and the drill has to clear it or a reload would reopen the
   * picked site's device map instead of its level.
   */
  test("the URL write names the picked site and clears the device view", async () => {
    await renderExplorer();
    fireEvent.click(await searchFor("market 5", MARKET_ID));
    await screen.findByTestId(`site-card-${UNIT_ID}`);

    await waitFor(() => {
      expect(setQueryStringMock).toHaveBeenCalledWith({
        topologySite: MARKET_ID,
        topologyDevices: null,
      });
    });
  });
});

/*
 * The keyboard path to the same drill. Enter commits only an entry the
 * reader moved onto, and only while the panel is open — Escape hides the
 * panel AND drops the highlight, so a later Enter cannot drill somewhere
 * that is no longer on screen.
 */
describe("keyboard selection", () => {
  test("ArrowDown then Enter drills to the highlighted site", async () => {
    await renderExplorer();
    await searchFor("104822", UNIT_ID);
    const input: HTMLInputElement = searchInput();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    const stub: HTMLElement = await screen.findByTestId("live-view-stub");
    expect(stub).toHaveAttribute("data-site-id", UNIT_ID);
  });

  test("a bare Enter commits nothing", async () => {
    await renderExplorer();
    await searchFor("104822", UNIT_ID);
    const childrenBefore: number = childrenPosts().length;

    fireEvent.keyDown(searchInput(), { key: "Enter" });

    await waitMs(50);
    expect(childrenPosts()).toHaveLength(childrenBefore);
    expect(screen.queryByTestId("live-view-stub")).not.toBeInTheDocument();
  });

  test("Enter after Escape does not drill to the hidden highlight", async () => {
    await renderExplorer();
    await searchFor("104822", UNIT_ID);
    const input: HTMLInputElement = searchInput();
    const childrenBefore: number = childrenPosts().length;

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(
      screen.queryByTestId(`${SEARCH_ID}-results`),
    ).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-activedescendant");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitMs(50);
    expect(childrenPosts()).toHaveLength(childrenBefore);
    expect(screen.queryByTestId("live-view-stub")).not.toBeInTheDocument();
    expect(input).toHaveValue("104822");
  });

  test("ArrowUp re-opens the panel after Escape, on the last hit", async () => {
    await renderExplorer();
    await searchFor("unit", UNIT_ID);
    const input: HTMLInputElement = searchInput();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      screen.queryByTestId(`${SEARCH_ID}-results`),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "ArrowUp" });

    expect(screen.getByTestId(`${SEARCH_ID}-results`)).toBeVisible();
    // Both units match "unit"; the last in the list is the one ArrowUp lands on.
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      `${SEARCH_ID}-option-${OTHER_UNIT_ID}`,
    );

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(childrenPosts()[childrenPosts().length - 1]!.data).toEqual({
        siteId: OTHER_UNIT_ID,
      });
    });
  });

  test("blurring the box closes the panel", async () => {
    await renderExplorer();
    await searchFor("104822", UNIT_ID);

    fireEvent.blur(searchInput());

    expect(
      screen.queryByTestId(`${SEARCH_ID}-results`),
    ).not.toBeInTheDocument();
    // The text, and the level it narrowed, are untouched.
    expect(searchInput()).toHaveValue("104822");
    expect(resultCountText()).toBe("0 of 3 regions · Updates every minute");
  });
});

/*
 * The dropdown's other states, under the explorer's prefix. A failed or
 * empty search must say so inside the panel and leave the level alone.
 */
describe("the dropdown's other answers", () => {
  test("no matches says so", async () => {
    await renderExplorer();
    typeSearch("qqq");

    expect(
      await screen.findByTestId(`${SEARCH_ID}-no-results`),
    ).toHaveTextContent("No sites match that name.");
  });

  test("a capped answer asks the reader to keep typing", async () => {
    await renderExplorer();
    await searchFor("unit", UNIT_ID);

    expect(screen.getByTestId(`${SEARCH_ID}-truncated`)).toBeVisible();
    expect(
      screen.getByTestId(`${SEARCH_ID}-result-${OTHER_UNIT_ID}`),
    ).toBeVisible();
  });

  test("a root site prints no path line", async () => {
    await renderExplorer();
    const hit: HTMLElement = await searchFor("franchise", FRANCHISE_ID);

    expect(hit.textContent).toBe("Franchise AFranchise");
  });

  test("a failed search stays inside the panel", async () => {
    await renderExplorer();
    postMock.mockImplementation((...args: Array<unknown>): unknown => {
      const options: PostOptions = args[0] as PostOptions;
      if (routeOf(options).includes("/network-site/search")) {
        return Promise.reject(new Error("Search is temporarily unavailable"));
      }
      return defaultPost(options);
    });

    typeSearch("east");

    expect(await screen.findByTestId(`${SEARCH_ID}-error`)).toHaveTextContent(
      "Search is temporarily unavailable",
    );
    // The level is still narrowed and still usable.
    expect(screen.getByTestId(`site-card-${REGION_EAST_ID}`)).toBeVisible();
    expect(resultCountText()).toBe("1 of 3 regions · Updates every minute");
    expect(
      screen.queryByTestId("topology-hierarchy-refresh-error"),
    ).not.toBeInTheDocument();
  });

  /*
   * Cancel-stale: a slow answer for an earlier query must not replace the
   * answer for the text in the box now.
   */
  test("a slow answer for an earlier query is dropped", async () => {
    await renderExplorer();
    let resolveStale: (value: unknown) => void = (): void => {};
    postMock.mockImplementation((...args: Array<unknown>): unknown => {
      const options: PostOptions = args[0] as PostOptions;
      if (
        routeOf(options).includes("/network-site/search") &&
        options.data?.["searchText"] === "region"
      ) {
        return new Promise<unknown>((resolve: (value: unknown) => void) => {
          resolveStale = resolve;
        });
      }
      return defaultPost(options);
    });

    typeSearch("region");
    await waitFor(() => {
      expect(searchPosts()).toHaveLength(1);
    });

    typeSearch("104822");
    await screen.findByTestId(`${SEARCH_ID}-result-${UNIT_ID}`);

    await act(async () => {
      resolveStale({ data: searchFixture("region") });
      await waitMs(0);
    });

    expect(
      screen.queryByTestId(`${SEARCH_ID}-result-${REGION_EAST_ID}`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(`${SEARCH_ID}-result-${UNIT_ID}`)).toBeVisible();
  });
});
