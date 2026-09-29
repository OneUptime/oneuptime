import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  UserFlowJourneysResponseDto,
  UserFlowSessionDto,
} from "../../../Types/Rum/UserFlow";
import {
  analyzeUserFlow,
  UserFlowAnalysis,
  UserFlowLink,
  UserFlowNode,
  UserFlowOptions,
  UserFlowPageStats,
} from "../../../Utils/Rum/UserFlow";
import UserFlowOverview from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowOverview";
import UserFlowTables from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowTables";
import UserFlowDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowDetailPanel";
import { UserFlowSelection } from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowMap";
import {
  RUM_USER_FLOW_METRIC_DESCRIPTIONS,
  RumUserFlowMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/RumMetricDescriptions";
import { expectReadableDescriptionRecord } from "../../App/Dashboard/MetricDescriptionRules";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The User Flows page's (i) tooltips, rendered: the five overview tiles,
 * every metric column of the Top paths, Pages and Back and forth tabs, and
 * every figure and page list in the detail panel a click on the map opens.
 *
 * Each (i) is hovered and must show its own text from
 * RUM_USER_FLOW_METRIC_DESCRIPTIONS. The sortable Pages headers keep the
 * (i) BESIDE the sort button - a button inside a button is invalid and
 * would sort on every hover-click.
 *
 * The fixture is hand-worked so the numbers the texts talk about can be
 * checked against what the page actually draws: Exit rate is Left over
 * Sessions, a reload counts once, the Pages Errors column counts only
 * errors placed on that page while "With errors" counts any error in the
 * session, and the Sessions/Device filters change "Sessions analysed".
 */

const ORIGIN: string = "https://shop.example.com";
const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001");
// Every (i) is a button named "About <what it explains>".
const INFO_BUTTON_NAME: RegExp = /^About /;

interface SessionSpec {
  id: string;
  pages: Array<string>;
  errorCount?: number;
  frustrationCount?: number;
  durationMs?: number;
  deviceType?: string;
  /* [path, errors, frustration] */
  signals?: Array<[string, number, number]>;
}

function response(specs: Array<SessionSpec>): UserFlowJourneysResponseDto {
  const pages: Array<string> = [];
  const indexOf: (path: string) => number = (path: string): number => {
    const url: string = `${ORIGIN}${path}`;
    let index: number = pages.indexOf(url);

    if (index < 0) {
      index = pages.length;
      pages.push(url);
    }

    return index;
  };

  const sessions: Array<UserFlowSessionDto> = specs.map(
    (spec: SessionSpec, position: number): UserFlowSessionDto => {
      return {
        sessionId: spec.id,
        startUnixMs: 1_800_000_000_000 - position * 1000,
        durationMs: spec.durationMs ?? 60_000,
        deviceType: spec.deviceType ?? "desktop",
        browserName: "Chrome",
        countryCode: "DK",
        errorCount: spec.errorCount ?? 0,
        frustrationCount: spec.frustrationCount ?? 0,
        pages: spec.pages.map(indexOf),
        pageSignals: (spec.signals || []).map(
          ([path, errors, frustration]: [string, number, number]): [
            number,
            number,
            number,
          ] => {
            return [indexOf(path), errors, frustration];
          },
        ),
      };
    },
  );

  return {
    pages: pages,
    sessions: sessions,
    sessionsInWindow: sessions.length,
    isSampled: false,
    maxSessions: 5000,
    startUnixMs: 1_799_990_000_000,
    endUnixMs: 1_800_000_000_000,
  };
}

/*
 *  s1  /home -> /cart -> /checkout   2 errors, placed on /checkout, 60s
 *  s2  /home -> /cart -> /home       frustrated on /cart (a loop), 30s
 *  s3  /home -> /home                a reload: one page, 10s
 *  s4  /product/1 -> /cart -> /cart  an error with no page to place it on, 20s
 *  s5  /home -> /cart -> /checkout   clean, 40s, on a phone
 */
const FIXTURE: UserFlowJourneysResponseDto = response([
  {
    id: "s1",
    pages: ["/home", "/cart", "/checkout"],
    errorCount: 2,
    signals: [["/checkout", 2, 0]],
    durationMs: 60_000,
  },
  {
    id: "s2",
    pages: ["/home", "/cart", "/home"],
    frustrationCount: 1,
    signals: [["/cart", 0, 1]],
    durationMs: 30_000,
  },
  { id: "s3", pages: ["/home", "/home"], durationMs: 10_000 },
  {
    id: "s4",
    pages: ["/product/1", "/cart", "/cart"],
    errorCount: 1,
    durationMs: 20_000,
  },
  {
    id: "s5",
    pages: ["/home", "/cart", "/checkout"],
    durationMs: 40_000,
    deviceType: "mobile",
  },
]);

const ANALYSIS: UserFlowAnalysis = analyzeUserFlow(FIXTURE);

function renderOverview(analysis: UserFlowAnalysis = ANALYSIS): void {
  render(
    <UserFlowOverview
      summary={analysis.summary}
      insights={analysis.insights}
      sessionsInWindow={FIXTURE.sessionsInWindow}
      isSampled={false}
      onFocusPage={(): void => {
        /* not under test */
      }}
    />,
  );
}

let onAnchor: MockFunction = getJestMockFunction();

function renderDetail(
  analysis: UserFlowAnalysis,
  selection: UserFlowSelection,
): void {
  render(
    <MemoryRouter>
      <UserFlowDetailPanel
        selection={selection}
        analysis={analysis}
        rumApplicationId={APP_ID}
        timeRange={{ range: TimeRange.PAST_ONE_DAY }}
        onAnchor={onAnchor}
        onHide={(): void => {
          /* not under test */
        }}
        onClose={(): void => {
          /* not under test */
        }}
      />
    </MemoryRouter>,
  );
}

function nodeAt(
  analysis: UserFlowAnalysis,
  step: number,
  page: string,
): UserFlowNode {
  const node: UserFlowNode | undefined = analysis.graph.nodes.find(
    (candidate: UserFlowNode): boolean => {
      return candidate.step === step && candidate.page === page;
    },
  );
  expect(node).toBeDefined();
  return node!;
}

function linkBetween(
  analysis: UserFlowAnalysis,
  from: UserFlowNode,
  to: UserFlowNode,
): UserFlowLink {
  const link: UserFlowLink | undefined = analysis.graph.links.find(
    (candidate: UserFlowLink): boolean => {
      return candidate.sourceId === from.id && candidate.targetId === to.id;
    },
  );
  expect(link).toBeDefined();
  return link!;
}

/* A detail-panel figure: the box holding the (i) named "About <label>". */
function statBox(label: string): HTMLElement {
  return infoButton(label).closest(".rounded-lg") as HTMLElement;
}

/* The big number in that box, exactly. */
function statValue(label: string): string {
  return (statBox(label).querySelector("p.text-lg")?.textContent || "").trim();
}

function renderTables(analysis: UserFlowAnalysis = ANALYSIS): void {
  render(
    <MemoryRouter>
      <UserFlowTables
        paths={analysis.paths}
        pages={analysis.pages}
        loops={analysis.loops}
        rumApplicationId={APP_ID}
        onAnchor={(): void => {
          /* not under test */
        }}
      />
    </MemoryRouter>,
  );
}

function infoButton(label: string): HTMLElement {
  const found: Array<HTMLElement> = screen.getAllByRole("button", {
    name: `About ${label}`,
  });
  expect(found).toHaveLength(1);
  return found[0]!;
}

function allInfoLabels(): Array<string> {
  return screen
    .queryAllByRole("button", { name: INFO_BUTTON_NAME })
    .map((button: HTMLElement): string => {
      return (button.getAttribute("aria-label") || "").replace("About ", "");
    });
}

async function tooltipTextOf(button: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  const describedBy: string | null = button.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();

  const text: string =
    document.getElementById(describedBy as string)?.textContent || "";

  fireEvent.mouseLeave(button);

  return text;
}

async function expectExplained(
  label: string,
  key: RumUserFlowMetric,
): Promise<void> {
  const button: HTMLElement = infoButton(label);

  // Never nested in another control (a sort button, a finding card).
  expect(button.parentElement?.closest("button, a")).toBeNull();
  expect(await tooltipTextOf(button)).toBe(
    RUM_USER_FLOW_METRIC_DESCRIPTIONS[key],
  );
}

function openTab(id: "paths" | "pages" | "loops"): void {
  fireEvent.click(screen.getByTestId(`user-flow-tab-${id}`));
}

function pageRow(page: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .getAllByTestId("user-flow-page-row")
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-page") === page;
    });
  expect(row).toBeDefined();
  return row!;
}

function cellTexts(row: HTMLElement): Array<string> {
  return Array.from(row.querySelectorAll("td")).map(
    (cell: HTMLTableCellElement): string => {
      return (cell.textContent || "").trim();
    },
  );
}

function sortState(): Record<string, string | null> {
  const state: Record<string, string | null> = {};

  for (const header of Array.from(
    screen.getByTestId("user-flow-pages-table").querySelectorAll("th"),
  )) {
    const label: string = (header.textContent || "").trim();

    if (label) {
      state[label] = header.getAttribute("aria-sort");
    }
  }

  return state;
}

beforeEach(() => {
  jest.useFakeTimers();
  onAnchor = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the User Flows descriptions", () => {
  test("read as short, finished, distinct sentences", () => {
    expectReadableDescriptionRecord(
      RUM_USER_FLOW_METRIC_DESCRIPTIONS,
      "RUM_USER_FLOW_METRIC_DESCRIPTIONS",
    );
  });
});

describe("User Flows overview tiles", () => {
  test("every tile explains itself, and nothing else on the strip carries an (i)", async () => {
    renderOverview();

    expect(allInfoLabels()).toEqual([
      "Sessions analysed",
      "Pages per session",
      "Single-page sessions",
      "Top landing page",
      "Top exit page",
    ]);

    await expectExplained("Sessions analysed", "sessionsAnalysed");
    await expectExplained("Pages per session", "pagesPerSession");
    await expectExplained("Single-page sessions", "singlePageSessions");
    await expectExplained("Top landing page", "topLandingPage");
    await expectExplained("Top exit page", "topExitPage");
  });

  test("the (i) sits in the tile's label row, beside the label it names", () => {
    renderOverview();

    for (const [testId, label] of [
      ["user-flow-tile-sessions", "Sessions analysed"],
      ["user-flow-tile-pages", "Pages per session"],
      ["user-flow-tile-bounce", "Single-page sessions"],
      ["user-flow-tile-entry", "Top landing page"],
      ["user-flow-tile-exit", "Top exit page"],
    ] as Array<[string, string]>) {
      const tile: HTMLElement = screen.getByTestId(testId);
      const info: HTMLElement = within(tile).getByTestId(`${testId}-info`);

      expect(info).toHaveAttribute("aria-label", `About ${label}`);
      expect(info.parentElement).toHaveTextContent(label);
      // The value paragraph is not the (i)'s row.
      expect(
        info.parentElement?.contains(
          within(tile).getByTestId(`${testId}-value`),
        ),
      ).toBe(false);
    }
  });

  test("the tiles show what the texts describe: reloads count once, medians are of journey lengths", () => {
    renderOverview();

    // s3 reloaded /home: one page, so the journeys are 3, 3, 1, 2, 3 pages.
    expect(
      screen.getByTestId("user-flow-tile-sessions-value"),
    ).toHaveTextContent("5");
    expect(screen.getByTestId("user-flow-tile-pages-value")).toHaveTextContent(
      "2.4",
    );
    expect(screen.getByTestId("user-flow-tile-pages")).toHaveTextContent(
      "median 3",
    );
    // Only the reload session saw one page.
    expect(screen.getByTestId("user-flow-tile-bounce-value")).toHaveTextContent(
      "20%",
    );
    expect(screen.getByTestId("user-flow-tile-bounce")).toHaveTextContent(
      "1 never navigated",
    );
    expect(screen.getByTestId("user-flow-tile-entry-value")).toHaveAttribute(
      "data-value",
      "/home",
    );
    expect(screen.getByTestId("user-flow-tile-entry")).toHaveTextContent(
      "80% of sessions start here",
    );
    // /checkout and /home both end two sessions; the tie goes by name.
    expect(screen.getByTestId("user-flow-tile-exit-value")).toHaveAttribute(
      "data-value",
      "/checkout",
    );
    expect(screen.getByTestId("user-flow-tile-exit")).toHaveTextContent(
      "40% of sessions end here",
    );
  });

  test("'Sessions analysed' follows the Sessions and Device filters and hidden pages, as its text says", () => {
    const only: (options: Partial<UserFlowOptions>) => number = (
      options: Partial<UserFlowOptions>,
    ): number => {
      return analyzeUserFlow(FIXTURE, options).summary.sessions;
    };

    expect(only({})).toBe(5);
    expect(only({ sessionFilter: "errors" })).toBe(2);
    expect(only({ sessionFilter: "frustration" })).toBe(1);
    expect(only({ deviceType: "mobile" })).toBe(1);
    // s3 saw nothing but /home, so hiding /home drops it.
    expect(only({ hiddenPages: ["/home"] })).toBe(4);
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.sessionsAnalysed).toContain(
      "match the Sessions and Device filters",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.sessionsAnalysed).toContain(
      "one whose pages are all hidden drops out",
    );
  });
});

describe("User Flows Top paths headers", () => {
  test("Sessions, Avg. duration and With errors each explain themselves; # and Journey do not", async () => {
    renderTables();

    expect(allInfoLabels()).toEqual([
      "Sessions",
      "Avg. duration",
      "With errors",
    ]);

    await expectExplained("Sessions", "pathSessions");
    await expectExplained("Avg. duration", "pathAvgDuration");
    await expectExplained("With errors", "pathWithErrors");
  });

  test("the path cells read the way the headers say", () => {
    renderTables();

    const rows: Array<HTMLElement> =
      screen.getAllByTestId("user-flow-path-row");
    const byPath: Record<string, Array<string>> = {};

    for (const row of rows) {
      byPath[row.getAttribute("data-path") || ""] = cellTexts(row);
    }

    // Two sessions, 40% of five; (60s + 40s) / 2; one of the two errored.
    expect(byPath["/home > /cart > /checkout"]?.[2]).toContain("2");
    expect(byPath["/home > /cart > /checkout"]?.[2]).toContain("40%");
    expect(byPath["/home > /cart > /checkout"]?.[3]).toBe("50s");
    expect(byPath["/home > /cart > /checkout"]?.[4]).toBe("50%");

    /*
     * s4's error was never placed on a page, yet its path reads 100% with
     * errors: the column counts any error in the session.
     */
    expect(byPath["/product/:id > /cart"]?.[4]).toBe("100%");
    expect(byPath["/home > /cart > /home"]?.[4]).toBe("—");
  });
});

describe("User Flows Pages headers", () => {
  test("all seven metric columns explain themselves; Page does not", async () => {
    renderTables();
    openTab("pages");

    expect(allInfoLabels()).toEqual([
      "Sessions",
      "Visits",
      "Landed",
      "Left",
      "Exit rate",
      "Errors",
      "Frustrated",
    ]);

    await expectExplained("Sessions", "pageSessions");
    await expectExplained("Visits", "pageVisits");
    await expectExplained("Landed", "pageLanded");
    await expectExplained("Left", "pageLeft");
    await expectExplained("Exit rate", "pageExitRate");
    await expectExplained("Errors", "pageErrors");
    await expectExplained("Frustrated", "pageFrustrated");
  });

  test("the (i) sits beside each sort button: hovering or clicking it never sorts, the button still does", async () => {
    renderTables();
    openTab("pages");

    expect(sortState()["Sessions"]).toBe("descending");
    expect(sortState()["Exit rate"]).toBe("none");

    const exitInfo: HTMLElement = infoButton("Exit rate");
    const header: HTMLElement = exitInfo.closest("th") as HTMLElement;
    const sortButton: HTMLElement = within(header).getByRole("button", {
      name: "Exit rate",
    });

    expect(sortButton.contains(exitInfo)).toBe(false);

    await tooltipTextOf(exitInfo);
    fireEvent.click(exitInfo);
    fireEvent.keyDown(exitInfo, { key: "Enter" });

    expect(sortState()["Sessions"]).toBe("descending");
    expect(sortState()["Exit rate"]).toBe("none");

    fireEvent.click(sortButton);

    expect(sortState()["Exit rate"]).toBe("descending");
    expect(sortState()["Sessions"]).toBe("none");
    // Sorting does not lose the (i).
    expect(infoButton("Exit rate")).toBeInTheDocument();
  });

  test("the page cells read the way the headers say", () => {
    renderTables();
    openTab("pages");

    // [Page, Sessions, Visits, Landed, Left, Exit rate, Errors, Frustrated, actions]
    const home: Array<string> = cellTexts(pageRow("/home"));
    const cart: Array<string> = cellTexts(pageRow("/cart"));
    const checkout: Array<string> = cellTexts(pageRow("/checkout"));

    // s2 came back to /home: 4 sessions, 5 visits. s3's reload is one visit.
    expect(home.slice(1, 6)).toEqual(["4", "5", "4", "2", "50%"]);
    expect(cart.slice(1, 6)).toEqual(["4", "4", "0", "1", "25%"]);
    expect(checkout.slice(1, 6)).toEqual(["2", "2", "0", "2", "100%"]);

    // Only s1's error was placed on a page; s4's reached no page's column.
    expect(checkout[6]).toBe("1");
    expect(cart[6]).toBe("—");
    expect(cart[7]).toBe("1");
    expect(home[7]).toBe("—");
  });

  test("Exit rate is Left divided by Sessions on every row", () => {
    for (const page of ANALYSIS.pages) {
      expect(page.exitRate).toBeCloseTo(page.exits / page.sessions, 10);
    }

    // Per session, not per visit: /home has 5 visits but its rate is 2 of 4.
    const home: UserFlowPageStats | undefined = ANALYSIS.pages.find(
      (page: UserFlowPageStats): boolean => {
        return page.page === "/home";
      },
    );

    expect(home?.views).toBe(5);
    expect(home?.exitRate).toBe(0.5);
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pageExitRate).toContain(
      "Left divided by Sessions",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pageExitRate).toContain(
      "per session, not per visit",
    );
  });
});

describe("User Flows Back and forth", () => {
  test("the loop list gets a header whose (i) explains the count and its bar", async () => {
    renderTables();
    openTab("loops");

    expect(screen.getByTestId("user-flow-loops-header")).toHaveTextContent(
      "Pages",
    );
    expect(allInfoLabels()).toEqual(["Sessions"]);

    await expectExplained("Sessions", "loopSessions");

    // s2 went /home -> /cart -> /home: one session of five.
    const [row] = screen.getAllByTestId("user-flow-loop-row");

    expect(row).toHaveTextContent("1 sessions");
    expect(row).toHaveTextContent("20%");
  });

  test("with no loops there is no header and no (i), only the empty line", () => {
    const noLoops: UserFlowAnalysis = analyzeUserFlow(
      response([{ id: "a", pages: ["/home", "/cart"] }]),
    );

    renderTables(noLoops);
    openTab("loops");

    expect(screen.queryByTestId("user-flow-loops-header")).toBeNull();
    expect(allInfoLabels()).toEqual([]);
    expect(screen.getByTestId("user-flow-loops")).toHaveTextContent(
      "No session in this range left a page and came straight back to it.",
    );
  });
});

describe("User Flows detail panel: a page on the map", () => {
  test("every figure and both page lists explain themselves; the actions do not", async () => {
    // From session start: /cart is the second page of s1, s2, s4 and s5.
    renderDetail(ANALYSIS, {
      kind: "node",
      id: nodeAt(ANALYSIS, 1, "/cart").id,
    });

    expect(allInfoLabels()).toEqual([
      "Sessions at this step",
      "Of all sessions",
      "Left the application here",
      "Hit an error here",
      "Where they came from (whole range)",
      "Where they went next (whole range)",
    ]);

    await expectExplained("Sessions at this step", "detailStepSessions");
    await expectExplained("Of all sessions", "detailOfAllSessions");
    await expectExplained("Left the application here", "detailLeftHere");
    await expectExplained("Hit an error here", "detailErrorsHere");
    await expectExplained(
      "Where they came from (whole range)",
      "detailCameFrom",
    );
    await expectExplained(
      "Where they went next (whole range)",
      "detailWentNext",
    );
  });

  test("the figures read the way their texts say", () => {
    renderDetail(ANALYSIS, {
      kind: "node",
      id: nodeAt(ANALYSIS, 1, "/cart").id,
    });

    // Four sessions here; s3 never reached a second page, so they are the whole step.
    expect(statValue("Sessions at this step")).toBe("4");
    expect(statBox("Sessions at this step")).toHaveTextContent(
      "100% of the step",
    );
    // Four of the five sessions the map is drawn from.
    expect(statValue("Of all sessions")).toBe("80%");
    // s4 (/product/1 -> /cart) ended here: one of four.
    expect(statValue("Left the application here")).toBe("1");
    expect(statBox("Left the application here")).toHaveTextContent(
      "25% drop-off",
    );
    // s1's error was placed on /checkout and s4's on no page; s2 was frustrated here.
    expect(statValue("Hit an error here")).toBe("0");
    expect(statBox("Hit an error here")).toHaveTextContent("1 frustrated");
  });

  test("the page lists count whole journeys, as a share of the page's sessions", () => {
    renderDetail(ANALYSIS, {
      kind: "node",
      id: nodeAt(ANALYSIS, 1, "/cart").id,
    });

    const cameFrom: HTMLElement = screen.getByTestId(
      "user-flow-previous-pages",
    );
    const wentNext: HTMLElement = screen.getByTestId("user-flow-next-pages");

    // /home before /cart for s1, s2, s5; /product/:id for s4 - of 4 sessions.
    expect(
      within(cameFrom).getByText("/home").closest("button"),
    ).toHaveTextContent("3 · 75%");
    expect(
      within(cameFrom).getByText("/product/:id").closest("button"),
    ).toHaveTextContent("1 · 25%");
    // s4 left from /cart and adds nothing, so the shares add up to 75%.
    expect(
      within(wentNext).getByText("/checkout").closest("button"),
    ).toHaveTextContent("2 · 50%");
    expect(
      within(wentNext).getByText("/home").closest("button"),
    ).toHaveTextContent("1 · 25%");
  });

  test("the list (i) sits in the title row: clicking it never re-anchors the map, a row still does", () => {
    renderDetail(ANALYSIS, {
      kind: "node",
      id: nodeAt(ANALYSIS, 1, "/cart").id,
    });

    const info: HTMLElement = screen.getByTestId(
      "user-flow-previous-pages-info",
    );
    const firstRow: HTMLElement = within(
      screen.getByTestId("user-flow-previous-pages"),
    )
      .getByText("/home")
      .closest("button") as HTMLElement;

    expect(firstRow.contains(info)).toBe(false);
    expect(info.parentElement?.closest("button, a")).toBeNull();

    fireEvent.click(info);
    fireEvent.keyDown(info, { key: "Enter" });

    expect(onAnchor).not.toHaveBeenCalled();

    fireEvent.click(firstRow);

    expect(onAnchor).toHaveBeenCalledWith("/home", "forward");
  });

  test("going backward the terminal figure is where sessions started, and the share is of anchored sessions", async () => {
    const backward: UserFlowAnalysis = analyzeUserFlow(FIXTURE, {
      anchorPage: "/checkout",
      direction: "backward",
    });

    // s1 and s5 reached /checkout from /cart, having landed on /home.
    renderDetail(backward, {
      kind: "node",
      id: nodeAt(backward, 2, "/home").id,
    });

    expect(allInfoLabels()).toEqual([
      "Sessions at this step",
      "Of anchored sessions",
      "Started their session here",
      "Hit an error here",
      "Where they came from (whole range)",
      "Where they went next (whole range)",
    ]);

    await expectExplained("Of anchored sessions", "detailOfAllSessions");
    await expectExplained("Started their session here", "detailStartedHere");

    expect(statValue("Started their session here")).toBe("2");
    expect(statBox("Started their session here")).toHaveTextContent("100%");
    // Two of the two sessions that visited /checkout, not two of five.
    expect(statValue("Of anchored sessions")).toBe("100%");
  });

  test("an Other pages node explains its folded list", async () => {
    const crowded: UserFlowAnalysis = analyzeUserFlow(
      response([
        { id: "a1", pages: ["/a"] },
        { id: "a2", pages: ["/a"] },
        { id: "a3", pages: ["/a"] },
        { id: "b1", pages: ["/b"] },
        { id: "b2", pages: ["/b"] },
        { id: "c1", pages: ["/c"] },
        { id: "d1", pages: ["/d"] },
      ]),
      { pagesPerStep: 2 },
    );
    const other: UserFlowNode | undefined = crowded.graph.nodes.find(
      (node: UserFlowNode): boolean => {
        return node.isOther;
      },
    );

    expect(other).toBeDefined();

    renderDetail(crowded, { kind: "node", id: other!.id });

    expect(allInfoLabels()).toEqual([
      "Pages folded together (click to follow one)",
    ]);

    await expectExplained(
      "Pages folded together (click to follow one)",
      "detailFoldedPages",
    );

    // /c and /d fold together: one session each, half of Other's two.
    const folded: HTMLElement = screen.getByTestId("user-flow-other-pages");

    expect(within(folded).getByText("/c").closest("button")).toHaveTextContent(
      "1 · 50%",
    );
    expect(within(folded).getByText("/d").closest("button")).toHaveTextContent(
      "1 · 50%",
    );
  });
});

describe("User Flows detail panel: a band between two pages", () => {
  test("all four figures explain themselves", async () => {
    // s2 went /home -> /cart -> /home: the band from /cart to /home.
    const from: UserFlowNode = nodeAt(ANALYSIS, 1, "/cart");
    const to: UserFlowNode = nodeAt(ANALYSIS, 2, "/home");

    renderDetail(ANALYSIS, {
      kind: "link",
      id: linkBetween(ANALYSIS, from, to).id,
    });

    expect(allInfoLabels()).toEqual([
      "Sessions",
      "Share of /cart",
      "Share of /home",
      "Returning to a seen page",
    ]);

    await expectExplained("Sessions", "detailTransitionSessions");
    await expectExplained("Share of /cart", "detailShareOfSource");
    await expectExplained("Share of /home", "detailShareOfTarget");
    await expectExplained("Returning to a seen page", "detailReturning");
  });

  test("the two shares divide by different pages, and a return to a page already seen is amber", () => {
    const from: UserFlowNode = nodeAt(ANALYSIS, 1, "/cart");
    const to: UserFlowNode = nodeAt(ANALYSIS, 2, "/home");

    renderDetail(ANALYSIS, {
      kind: "link",
      id: linkBetween(ANALYSIS, from, to).id,
    });

    expect(statValue("Sessions")).toBe("1");
    // One of the four sessions on /cart at step 2 went this way...
    expect(statValue("Share of /cart")).toBe("25%");
    // ...and it is the only session on /home at step 3.
    expect(statValue("Share of /home")).toBe("100%");
    // s2 had already seen /home, at step 1: amber, as the text says.
    expect(statValue("Returning to a seen page")).toBe("100%");
    expect(
      statBox("Returning to a seen page").querySelector("p.text-amber-700"),
    ).not.toBeNull();
  });

  test("a move to a new page is not a return", () => {
    const from: UserFlowNode = nodeAt(ANALYSIS, 0, "/home");
    const to: UserFlowNode = nodeAt(ANALYSIS, 1, "/cart");

    renderDetail(ANALYSIS, {
      kind: "link",
      id: linkBetween(ANALYSIS, from, to).id,
    });

    // s1, s2 and s5: three of the four sessions that started on /home.
    expect(statValue("Sessions")).toBe("3");
    expect(statValue("Share of /home")).toBe("75%");
    // Three of the four sessions on /cart at step 2 came from /home (s4 did not).
    expect(statValue("Share of /cart")).toBe("75%");
    expect(statValue("Returning to a seen page")).toBe("0%");
    expect(
      statBox("Returning to a seen page").querySelector("p.text-amber-700"),
    ).toBeNull();
  });
});
