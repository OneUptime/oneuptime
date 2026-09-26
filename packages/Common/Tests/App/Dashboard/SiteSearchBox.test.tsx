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
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import SiteSearchBox, {
  ComponentProps,
  MIN_SITE_SEARCH_CHARS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteSearchBox";

/*
 * Issue #3981, from the reader's side of the search box.
 *
 * Device Topology's search used to narrow only the level on screen, so
 * finding "Unit 104822" meant opening every region above it first. The fix
 * mounts the Network Map's SiteSearchBox there too: typing still narrows the
 * page locally, and a dropdown lists hierarchy-wide matches from
 * POST /network-site/search, each with the path to it, one pick away.
 *
 * Everything here is what a person at the keyboard (or behind a screen
 * reader) meets: when the box goes to the server and with what, what a row
 * says, how the arrow keys, Enter and Escape behave, which answers are
 * allowed to paint, and the ids and ARIA each page that mounts the box
 * relies on. The server is an API.post mock whose answers the test releases
 * one at a time, so ordering races are staged rather than hoped for, and the
 * 250 ms debounce runs on jest's fake clock.
 */

const PROJECT_ID: string = "5f0f7d7e-8a2b-4a5b-9c1d-2e3f4a5b6c7d";
const SEARCH_DEBOUNCE_MS: number = 250;
const DEFAULT_PREFIX: string = "network-map-search";
const TOPOLOGY_PREFIX: string = "topology-hierarchy-search";
const DEFAULT_PLACEHOLDER: string =
  "Search sites by name — anywhere in your network";

interface SearchRequest {
  url: URL;
  data: JSONObject;
  headers: Dictionary<string>;
}

type SearchAnswer = HTTPResponse<JSONObject> | HTTPErrorResponse;

interface PendingSearch {
  request: SearchRequest;
  resolve: (answer: SearchAnswer) => void;
  reject: (reason: unknown) => void;
}

/*
 * Every POST parks here until the test answers it, in whatever order the
 * test chooses. That is what lets "the slow answer for 'ka' lands after the
 * answer for 'kansas'" be written down as two lines instead of two timers.
 */
let pendingSearches: Array<PendingSearch> = [];

const postMock: MockFunction = getJestMockFunction();
const getFriendlyMessageMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const onChangeMock: MockFunction = getJestMockFunction();
const onSelectSiteMock: MockFunction = getJestMockFunction();

/*
 * One ordered log of what the box asked its page to do, so "clear the text,
 * THEN drill" is an assertion about order and not just about two calls.
 */
let pageCalls: Array<string> = [];

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so the mocks are dereferenced lazily, at call time.
 */
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
      getFriendlyMessage: (...args: Array<unknown>): unknown => {
        return getFriendlyMessageMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<unknown>): unknown => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

// The Input translates its placeholder; the identity keeps assertions exact.
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
 * Three rows that between them exercise every way a row can look: a status
 * with a colour, no status at all (a unit that has never reported), and a
 * status without a colour at the root of the hierarchy (so no path line).
 */
const KANSAS_CITY: JSONObject = {
  id: "site-kc",
  name: "Kansas City",
  siteType: "Market",
  isUnitLevel: false,
  path: "North America / Central",
  currentMonitorStatus: {
    id: "status-operational",
    name: "Operational",
    color: "#22c55e",
    priority: 1,
    isOperationalState: true,
  },
};

const UNIT_104822: JSONObject = {
  id: "site-unit-104822",
  name: "Unit 104822 — Michigan Ave",
  siteType: "Unit",
  isUnitLevel: true,
  path: "North America / Central / Chicago",
};

const CENTRAL: JSONObject = {
  id: "site-central",
  name: "Central",
  siteType: "Region",
  isUnitLevel: false,
  currentMonitorStatus: {
    id: "status-degraded",
    name: "Degraded",
    priority: 2,
    isOperationalState: false,
  },
};

const THREE_ROWS: Array<JSONObject> = [KANSAS_CITY, UNIT_104822, CENTRAL];

interface HarnessProps {
  initialValue?: string | undefined;
  localMatchCount?: number | undefined;
  localTotalCount?: number | undefined;
  childTypeLabel?: string | undefined;
  dataTestId?: ComponentProps["dataTestId"];
  placeholder?: ComponentProps["placeholder"];
  showLocalCount?: ComponentProps["showLocalCount"];
}

/*
 * The box is controlled — the page owns the text, because the page also
 * filters its own cards with it — so it is mounted the way a page mounts it:
 * under a parent that keeps the value in state.
 */
function Harness(props: HarnessProps): ReactElement {
  const [value, setValue] = useState<string>(props.initialValue ?? "");
  return (
    <SiteSearchBox
      value={value}
      onChange={(next: string): void => {
        pageCalls.push(`change:${next}`);
        onChangeMock(next);
        setValue(next);
      }}
      onSelectSite={(siteId: string): void => {
        pageCalls.push(`select:${siteId}`);
        onSelectSiteMock(siteId);
      }}
      localMatchCount={props.localMatchCount ?? 0}
      localTotalCount={props.localTotalCount ?? 0}
      childTypeLabel={props.childTypeLabel ?? "Market"}
      dataTestId={props.dataTestId}
      placeholder={props.placeholder}
      showLocalCount={props.showLocalCount}
    />
  );
}

function renderBox(props: HarnessProps = {}): RenderResult {
  return render(<Harness {...props} />);
}

function searchInput(): HTMLInputElement {
  return screen.getByRole("combobox") as HTMLInputElement;
}

function typeText(text: string): void {
  fireEvent.change(searchInput(), { target: { value: text } });
}

function advance(milliseconds: number): void {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
}

async function flush(): Promise<void> {
  await act(async () => {});
}

function searchBody(
  rows: Array<JSONObject>,
  isTruncated: boolean = false,
): JSONObject {
  return { results: rows, isTruncated: isTruncated };
}

async function answer(index: number, body: JSONObject): Promise<void> {
  const pending: PendingSearch | undefined = pendingSearches[index];
  if (!pending) {
    throw new Error(`No search request #${index} was sent`);
  }
  await act(async () => {
    pending.resolve(new HTTPResponse<JSONObject>(200, body, {}));
  });
  await flush();
}

async function answerWith(index: number, answer: SearchAnswer): Promise<void> {
  const pending: PendingSearch | undefined = pendingSearches[index];
  if (!pending) {
    throw new Error(`No search request #${index} was sent`);
  }
  await act(async () => {
    pending.resolve(answer);
  });
  await flush();
}

async function rejectWith(index: number, reason: unknown): Promise<void> {
  const pending: PendingSearch | undefined = pendingSearches[index];
  if (!pending) {
    throw new Error(`No search request #${index} was sent`);
  }
  await act(async () => {
    pending.reject(reason);
  });
  await flush();
}

/*
 * Type, let the debounce run out, and answer the request that produced —
 * the whole round trip a reader makes before they can pick anything.
 */
async function searchFor(
  text: string,
  rows: Array<JSONObject>,
  isTruncated: boolean = false,
): Promise<void> {
  const before: number = pendingSearches.length;
  typeText(text);
  advance(SEARCH_DEBOUNCE_MS);
  expect(pendingSearches).toHaveLength(before + 1);
  await answer(before, searchBody(rows, isTruncated));
}

function panel(prefix: string = DEFAULT_PREFIX): HTMLElement | null {
  return screen.queryByTestId(`${prefix}-results`);
}

function option(siteId: string, prefix: string = DEFAULT_PREFIX): HTMLElement {
  return screen.getByTestId(`${prefix}-result-${siteId}`);
}

function selectedOptionIds(): Array<string> {
  return screen
    .queryAllByRole("option")
    .filter((element: HTMLElement): boolean => {
      return element.getAttribute("aria-selected") === "true";
    })
    .map((element: HTMLElement): string => {
      return element.id;
    });
}

function press(key: string): boolean {
  return fireEvent.keyDown(searchInput(), { key: key });
}

beforeEach(() => {
  jest.useFakeTimers();
  pendingSearches = [];
  pageCalls = [];
  onChangeMock.mockReset();
  onSelectSiteMock.mockReset();

  postMock.mockReset();
  postMock.mockImplementation((request: unknown): Promise<SearchAnswer> => {
    return new Promise<SearchAnswer>(
      (
        resolve: (answer: SearchAnswer) => void,
        reject: (reason: unknown) => void,
      ): void => {
        pendingSearches.push({
          request: request as SearchRequest,
          resolve: resolve,
          reject: reject,
        });
      },
    );
  });

  // Mirrors the real helper closely enough for the box's two failure paths.
  getFriendlyMessageMock.mockReset();
  getFriendlyMessageMock.mockImplementation((error: unknown): string => {
    if (error instanceof HTTPErrorResponse) {
      return error.message || "Server Error. Please try again";
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Server Error. Please try again";
  });

  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue({ tenantid: PROJECT_ID });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

/*
 * When the box goes to the server, and with what. One character matches most
 * of an estate, and per-keystroke requests are one round trip per letter, so
 * both the threshold and the debounce are part of the contract.
 */
describe("when the box asks the server", () => {
  test("the threshold the box exports is two characters", () => {
    expect(MIN_SITE_SEARCH_CHARS).toBe(2);
  });

  test("one character sends nothing and opens no panel", () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("k");
    advance(SEARCH_DEBOUNCE_MS * 4);

    expect(postMock).not.toHaveBeenCalled();
    expect(panel()).not.toBeInTheDocument();
    expect(searchInput()).toHaveAttribute("aria-expanded", "false");
    // The page still got the text, for its own local narrowing.
    expect(onChangeMock).toHaveBeenLastCalledWith("k");
  });

  test("padding does not count toward the threshold", () => {
    renderBox();
    typeText("   k   ");
    advance(SEARCH_DEBOUNCE_MS * 4);
    typeText("      ");
    advance(SEARCH_DEBOUNCE_MS * 4);

    expect(postMock).not.toHaveBeenCalled();
    expect(panel()).not.toBeInTheDocument();
  });

  test("two characters send exactly one request, and only once the debounce runs out", () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("ka");

    // The panel is open (and says it is searching) before anything is sent.
    expect(panel()).toBeInTheDocument();
    advance(SEARCH_DEBOUNCE_MS - 1);
    expect(postMock).not.toHaveBeenCalled();

    advance(1);
    expect(postMock).toHaveBeenCalledTimes(1);

    advance(SEARCH_DEBOUNCE_MS * 4);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("the request goes to /network-site/search with the trimmed, lower-cased text and the common headers", () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("  Kansas CITY  ");
    advance(SEARCH_DEBOUNCE_MS);

    expect(postMock).toHaveBeenCalledTimes(1);
    const request: SearchRequest = pendingSearches[0]!.request;
    expect(request.url.toString()).toMatch(/\/network-site\/search$/);
    expect(request.data).toEqual({ searchText: "kansas city" });
    expect(request.headers).toEqual({ tenantid: PROJECT_ID });
    expect(getCommonHeadersMock).toHaveBeenCalled();
    // The page itself still sees exactly what was typed.
    expect(onChangeMock).toHaveBeenLastCalledWith("  Kansas CITY  ");
  });

  test("rapid typing sends only the last text", () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("ka");
    advance(100);
    typeText("kan");
    advance(100);
    typeText("kans");
    advance(SEARCH_DEBOUNCE_MS - 1);
    typeText("kansas");
    advance(SEARCH_DEBOUNCE_MS);

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(pendingSearches[0]!.request.data).toEqual({
      searchText: "kansas",
    });
  });

  test("an edit that normalizes to the same text does not search again", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("ka", [KANSAS_CITY]);

    typeText("ka ");
    advance(SEARCH_DEBOUNCE_MS);
    typeText("KA");
    advance(SEARCH_DEBOUNCE_MS);

    expect(postMock).toHaveBeenCalledTimes(1);
    // And the answer it already has stays on screen, still answering.
    expect(option(KANSAS_CITY["id"] as string)).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-searching`),
    ).not.toBeInTheDocument();
  });

  test("text that drops below the threshold before the debounce runs out sends nothing", () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("ka");
    advance(SEARCH_DEBOUNCE_MS - 50);
    typeText("k");
    advance(SEARCH_DEBOUNCE_MS * 4);

    expect(postMock).not.toHaveBeenCalled();
  });

  test("unmounting while the debounce is running sends nothing", () => {
    const view: RenderResult = renderBox();
    typeText("kansas");
    view.unmount();
    advance(SEARCH_DEBOUNCE_MS * 4);

    expect(postMock).not.toHaveBeenCalled();
  });

  test("an answer that lands after the box is gone is dropped quietly", async () => {
    const view: RenderResult = renderBox();
    typeText("kansas");
    advance(SEARCH_DEBOUNCE_MS);
    expect(postMock).toHaveBeenCalledTimes(1);
    view.unmount();

    await answer(0, searchBody([KANSAS_CITY]));

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  test("a failure that lands after the box is gone is not even turned into a message", async () => {
    const view: RenderResult = renderBox();
    typeText("kansas");
    advance(SEARCH_DEBOUNCE_MS);
    view.unmount();

    await rejectWith(0, new Error("late"));

    expect(getFriendlyMessageMock).not.toHaveBeenCalled();
  });

  test("text the page mounts with is searched, and its answer is waiting when the box is focused", async () => {
    renderBox({ initialValue: "kansas" });
    expect(panel()).not.toBeInTheDocument();

    advance(SEARCH_DEBOUNCE_MS);
    expect(postMock).toHaveBeenCalledTimes(1);
    await answer(0, searchBody([KANSAS_CITY]));
    expect(panel()).not.toBeInTheDocument();

    fireEvent.focus(searchInput());
    expect(option(KANSAS_CITY["id"] as string)).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});

/*
 * What a hit says. The dropdown exists to answer "where is it", so the path
 * is the important line; the status mark keeps "no data" a different SHAPE
 * from a status, not merely a greyer colour (same rule as the site cards).
 */
describe("what a result row shows", () => {
  test("name, site type and ancestor path", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("kansas", THREE_ROWS);

    const row: HTMLElement = option("site-kc");
    expect(within(row).getByText("Kansas City")).toBeInTheDocument();
    expect(within(row).getByText("Market")).toBeInTheDocument();
    expect(
      within(row).getByText("North America / Central"),
    ).toBeInTheDocument();

    const unit: HTMLElement = option("site-unit-104822");
    expect(
      within(unit).getByText("Unit 104822 — Michigan Ave"),
    ).toBeInTheDocument();
    expect(within(unit).getByText("Unit")).toBeInTheDocument();
    expect(
      within(unit).getByText("North America / Central / Chicago"),
    ).toBeInTheDocument();
  });

  test("rows keep the server's order", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("ce", THREE_ROWS);

    expect(
      screen.getAllByRole("option").map((element: HTMLElement): string => {
        return element.getAttribute("data-testid") || "";
      }),
    ).toEqual([
      `${DEFAULT_PREFIX}-result-site-kc`,
      `${DEFAULT_PREFIX}-result-site-unit-104822`,
      `${DEFAULT_PREFIX}-result-site-central`,
    ]);
  });

  test("a reporting site gets a filled dot in its status colour, titled with the status", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("kansas", THREE_ROWS);

    const dot: HTMLElement = within(option("site-kc")).getByTitle(
      "Operational",
    );
    expect(dot).toHaveStyle({ backgroundColor: "#22c55e" });
    expect(dot).not.toHaveClass("border");
    expect(
      within(option("site-kc")).queryByTitle("Not reporting"),
    ).not.toBeInTheDocument();
  });

  test("a status without a colour still gets a filled dot, in neutral grey", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("central", THREE_ROWS);

    const dot: HTMLElement = within(option("site-central")).getByTitle(
      "Degraded",
    );
    expect(dot).toHaveStyle({ backgroundColor: "#9ca3af" });
    expect(dot).not.toHaveClass("border");
  });

  test("a site that is not reporting gets a hollow ring instead of a dot", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("unit", THREE_ROWS);

    const ring: HTMLElement = within(option("site-unit-104822")).getByTitle(
      "Not reporting",
    );
    expect(ring).toHaveClass("border");
    expect(ring.style.backgroundColor).toBe("");
  });

  test("a root site prints no path line at all", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("central", [CENTRAL]);

    const row: HTMLElement = option("site-central");
    expect(row.textContent).toBe("CentralRegion");
  });

  test("a partly broken row falls back to readable labels, and a row without an id is dropped", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("xx", [
      { id: "site-bare" },
      { name: "No id at all", siteType: "Store" },
      KANSAS_CITY,
    ]);

    const bare: HTMLElement = option("site-bare");
    expect(within(bare).getByText("Unnamed site")).toBeInTheDocument();
    expect(within(bare).getByText("Other")).toBeInTheDocument();
    expect(within(bare).getByTitle("Not reporting")).toBeInTheDocument();
    expect(screen.queryByText("No id at all")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  test("the panel is headed as a search of the whole network", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("kansas", [KANSAS_CITY]);

    expect(
      within(panel()!).getByText("Anywhere in your network"),
    ).toBeInTheDocument();
  });
});

/*
 * Picking with the pointer. The page is told to clear the text BEFORE it is
 * told where to go, so the destination level is not left filtered by the
 * question that led there — and the panel swallows mousedown, because that
 * is what keeps the input from blurring and the panel from unmounting under
 * the pointer before the click lands.
 */
describe("choosing a result with the pointer", () => {
  test("clicking a result clears the text, then drills to that site", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("unit", THREE_ROWS);
    pageCalls = [];

    fireEvent.click(option("site-unit-104822"));

    expect(pageCalls).toEqual(["change:", "select:site-unit-104822"]);
    expect(onSelectSiteMock).toHaveBeenCalledTimes(1);
    expect(onSelectSiteMock).toHaveBeenCalledWith("site-unit-104822");
    expect(searchInput().value).toBe("");
    expect(panel()).not.toBeInTheDocument();
    expect(searchInput()).toHaveAttribute("aria-expanded", "false");
  });

  test("mousedown anywhere in the panel is default-prevented", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("kansas", THREE_ROWS);

    // fireEvent returns false exactly when a handler called preventDefault.
    expect(fireEvent.mouseDown(option("site-kc"))).toBe(false);
    expect(
      fireEvent.mouseDown(within(option("site-kc")).getByText("Kansas City")),
    ).toBe(false);
    expect(
      fireEvent.mouseDown(
        within(panel()!).getByText("Anywhere in your network"),
      ),
    ).toBe(false);
    // Mousedown alone commits nothing — only the click does.
    expect(onSelectSiteMock).not.toHaveBeenCalled();
  });

  test("the whole press — mousedown then click — lands on the site", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("kansas", THREE_ROWS);

    const row: HTMLElement = option("site-central");
    fireEvent.mouseDown(row);
    fireEvent.mouseUp(row);
    fireEvent.click(row);

    expect(onSelectSiteMock).toHaveBeenCalledWith("site-central");
  });

  test("hovering a result highlights it", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("kansas", THREE_ROWS);

    fireEvent.mouseEnter(option("site-central"));

    expect(selectedOptionIds()).toEqual([
      `${DEFAULT_PREFIX}-option-site-central`,
    ]);
    expect(searchInput()).toHaveAttribute(
      "aria-activedescendant",
      `${DEFAULT_PREFIX}-option-site-central`,
    );
  });

  test("typing again after a pick re-opens the panel for the new search", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("kansas", THREE_ROWS);
    fireEvent.click(option("site-kc"));
    expect(panel()).not.toBeInTheDocument();

    // Focus never left the input, so no focus event will re-open it.
    typeText("ce");
    expect(panel()).toBeInTheDocument();
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-searching`),
    ).toBeInTheDocument();
  });
});

/*
 * The keyboard. Focus never leaves the input, so the arrow keys move a
 * highlight that the input names through aria-activedescendant, and Enter
 * commits only an entry the reader actually moved onto.
 *
 * The Escape cases are the regression the issue's fix shipped with: Escape
 * used to hide the panel but keep the highlight, so a following Enter drilled
 * into a site that was no longer on screen.
 */
describe("the keyboard", () => {
  async function openWithThreeRows(): Promise<void> {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("ce", THREE_ROWS);
  }

  test("nothing is highlighted until an arrow key is pressed", async () => {
    await openWithThreeRows();

    expect(selectedOptionIds()).toEqual([]);
    expect(searchInput()).not.toHaveAttribute("aria-activedescendant");
    for (const element of screen.getAllByRole("option")) {
      expect(element).toHaveAttribute("aria-selected", "false");
    }
  });

  test("ArrowDown highlights the first option and names it on the input", async () => {
    await openWithThreeRows();

    expect(press("ArrowDown")).toBe(false);

    const first: HTMLElement = option("site-kc");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first.id).toBe(`${DEFAULT_PREFIX}-option-site-kc`);
    expect(searchInput()).toHaveAttribute("aria-activedescendant", first.id);
    expect(
      document.getElementById(
        searchInput().getAttribute("aria-activedescendant") || "",
      ),
    ).toBe(first);
    expect(option("site-unit-104822")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  test("ArrowDown walks the list and wraps from the last option to the first", async () => {
    await openWithThreeRows();

    press("ArrowDown");
    press("ArrowDown");
    expect(selectedOptionIds()).toEqual([
      `${DEFAULT_PREFIX}-option-site-unit-104822`,
    ]);
    press("ArrowDown");
    expect(selectedOptionIds()).toEqual([
      `${DEFAULT_PREFIX}-option-site-central`,
    ]);
    press("ArrowDown");
    expect(selectedOptionIds()).toEqual([`${DEFAULT_PREFIX}-option-site-kc`]);
    expect(searchInput()).toHaveAttribute(
      "aria-activedescendant",
      `${DEFAULT_PREFIX}-option-site-kc`,
    );
  });

  test("ArrowUp with nothing highlighted wraps to the last option", async () => {
    await openWithThreeRows();

    expect(press("ArrowUp")).toBe(false);

    expect(selectedOptionIds()).toEqual([
      `${DEFAULT_PREFIX}-option-site-central`,
    ]);
    expect(searchInput()).toHaveAttribute(
      "aria-activedescendant",
      `${DEFAULT_PREFIX}-option-site-central`,
    );
  });

  test("ArrowUp walks back and wraps from the first option to the last", async () => {
    await openWithThreeRows();

    press("ArrowDown");
    press("ArrowDown");
    press("ArrowUp");
    expect(selectedOptionIds()).toEqual([`${DEFAULT_PREFIX}-option-site-kc`]);
    press("ArrowUp");
    expect(selectedOptionIds()).toEqual([
      `${DEFAULT_PREFIX}-option-site-central`,
    ]);
  });

  test("Enter commits the highlighted option: clear the text, then drill", async () => {
    await openWithThreeRows();
    press("ArrowDown");
    press("ArrowDown");
    pageCalls = [];

    expect(press("Enter")).toBe(false);

    expect(pageCalls).toEqual(["change:", "select:site-unit-104822"]);
    expect(onSelectSiteMock).toHaveBeenCalledTimes(1);
    expect(panel()).not.toBeInTheDocument();
    expect(searchInput().value).toBe("");
  });

  test("Enter commits the option the pointer is over", async () => {
    await openWithThreeRows();
    fireEvent.mouseEnter(option("site-central"));

    press("Enter");

    expect(onSelectSiteMock).toHaveBeenCalledWith("site-central");
  });

  test("a bare Enter with nothing highlighted does nothing at all", async () => {
    await openWithThreeRows();
    onChangeMock.mockClear();

    // Not claimed either, so a surrounding form still sees it.
    expect(press("Enter")).toBe(true);

    expect(onSelectSiteMock).not.toHaveBeenCalled();
    expect(onChangeMock).not.toHaveBeenCalled();
    expect(panel()).toBeInTheDocument();
  });

  test("Escape closes the panel and drops the highlight", async () => {
    await openWithThreeRows();
    press("ArrowDown");

    press("Escape");

    expect(panel()).not.toBeInTheDocument();
    expect(searchInput()).toHaveAttribute("aria-expanded", "false");
    expect(searchInput()).not.toHaveAttribute("aria-activedescendant");
    expect(searchInput()).not.toHaveAttribute("aria-controls");
    // Escape hides the answers; it does not throw the question away.
    expect(searchInput().value).toBe("ce");
  });

  test("REGRESSION: Enter after Escape does not drill into the hidden highlight", async () => {
    await openWithThreeRows();
    press("ArrowDown");
    press("ArrowDown");
    onChangeMock.mockClear();

    press("Escape");
    expect(press("Enter")).toBe(true);

    expect(onSelectSiteMock).not.toHaveBeenCalled();
    expect(onChangeMock).not.toHaveBeenCalled();
    expect(searchInput().value).toBe("ce");
  });

  test("ArrowUp after Escape re-opens the panel, starting again from the end", async () => {
    await openWithThreeRows();
    press("ArrowDown");
    press("ArrowDown");
    press("Escape");

    expect(press("ArrowUp")).toBe(false);

    expect(panel()).toBeInTheDocument();
    expect(searchInput()).toHaveAttribute("aria-expanded", "true");
    /*
     * From the middle option ArrowUp would have gone to the first; landing
     * on the last proves Escape really did drop the highlight.
     */
    expect(selectedOptionIds()).toEqual([
      `${DEFAULT_PREFIX}-option-site-central`,
    ]);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("ArrowDown after Escape re-opens the panel, starting again from the top", async () => {
    await openWithThreeRows();
    press("ArrowDown");
    press("ArrowDown");
    press("Escape");

    press("ArrowDown");

    expect(panel()).toBeInTheDocument();
    expect(selectedOptionIds()).toEqual([`${DEFAULT_PREFIX}-option-site-kc`]);
  });

  test("Enter after Escape and a fresh arrow key commits the new highlight", async () => {
    await openWithThreeRows();
    press("ArrowDown");
    press("ArrowDown");
    press("Escape");
    press("ArrowDown");

    press("Enter");

    expect(onSelectSiteMock).toHaveBeenCalledTimes(1);
    expect(onSelectSiteMock).toHaveBeenCalledWith("site-kc");
  });

  test("arrow keys are left alone when there is nothing to move through", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("zz", []);

    expect(press("ArrowDown")).toBe(true);
    expect(press("ArrowUp")).toBe(true);
    expect(press("Enter")).toBe(true);
    expect(searchInput()).not.toHaveAttribute("aria-activedescendant");
    expect(onSelectSiteMock).not.toHaveBeenCalled();
  });

  test("arrow keys do nothing below the threshold", () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("k");

    expect(press("ArrowDown")).toBe(true);
    expect(panel()).not.toBeInTheDocument();
  });

  test("typing a new search drops the highlight", async () => {
    await openWithThreeRows();
    press("ArrowDown");

    typeText("cen");

    expect(selectedOptionIds()).toEqual([]);
    expect(searchInput()).not.toHaveAttribute("aria-activedescendant");
    // So an Enter before the new answer arrives commits nothing.
    press("Enter");
    expect(onSelectSiteMock).not.toHaveBeenCalled();
  });

  test("other keys neither move the highlight nor close the panel", async () => {
    await openWithThreeRows();
    press("ArrowDown");

    expect(press("Tab")).toBe(true);
    press("a");

    expect(panel()).toBeInTheDocument();
    expect(selectedOptionIds()).toEqual([`${DEFAULT_PREFIX}-option-site-kc`]);
  });
});

/*
 * Which answers may paint. Every request takes a sequence number and only the
 * latest may write, so a slow answer for "ka" can never land over the answer
 * for "kansas" — the list on screen must always answer the text in the box.
 */
describe("stale and failed answers", () => {
  test("a slow earlier answer that lands after a later one is ignored", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("ka");
    advance(SEARCH_DEBOUNCE_MS);
    typeText("kansas");
    advance(SEARCH_DEBOUNCE_MS);
    expect(postMock).toHaveBeenCalledTimes(2);

    await answer(1, searchBody([KANSAS_CITY]));
    await answer(0, searchBody([UNIT_104822, CENTRAL], true));

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(option("site-kc")).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-result-site-central`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-truncated`),
    ).not.toBeInTheDocument();
  });

  test("an earlier answer that lands while the later request is still out does not paint", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("ka");
    advance(SEARCH_DEBOUNCE_MS);
    typeText("kansas");
    advance(SEARCH_DEBOUNCE_MS);

    await answer(0, searchBody([UNIT_104822]));

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-searching`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-no-results`),
    ).not.toBeInTheDocument();

    await answer(1, searchBody([KANSAS_CITY]));
    expect(option("site-kc")).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-searching`),
    ).not.toBeInTheDocument();
  });

  test("a slow earlier failure does not paint an error over a later answer", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("ka");
    advance(SEARCH_DEBOUNCE_MS);
    typeText("kansas");
    advance(SEARCH_DEBOUNCE_MS);

    await answer(1, searchBody([KANSAS_CITY]));
    await answerWith(
      0,
      new HTTPErrorResponse(500, { message: "Search is down" }, {}),
    );

    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-error`),
    ).not.toBeInTheDocument();
    expect(option("site-kc")).toBeInTheDocument();
  });

  test("a failed request shows the friendly error and no results", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("kansas");
    advance(SEARCH_DEBOUNCE_MS);
    const failure: HTTPErrorResponse = new HTTPErrorResponse(
      500,
      { message: "Search is temporarily unavailable." },
      {},
    );

    await answerWith(0, failure);

    expect(getFriendlyMessageMock).toHaveBeenCalledWith(failure);
    expect(screen.getByTestId(`${DEFAULT_PREFIX}-error`)).toHaveTextContent(
      "Search is temporarily unavailable.",
    );
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    // An error is not "no matches", and it is not still searching.
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-no-results`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-searching`),
    ).not.toBeInTheDocument();
  });

  test("a request that throws shows its message the same way", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("kansas");
    advance(SEARCH_DEBOUNCE_MS);

    await rejectWith(0, new Error("Network request failed"));

    expect(screen.getByTestId(`${DEFAULT_PREFIX}-error`)).toHaveTextContent(
      "Network request failed",
    );
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  test("a failure replaces the previous answer's rows and truncation note", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("ka", THREE_ROWS, true);
    expect(screen.getAllByRole("option")).toHaveLength(3);

    typeText("kan");
    advance(SEARCH_DEBOUNCE_MS);
    await answerWith(1, new HTTPErrorResponse(503, { message: "Nope" }, {}));

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-truncated`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(`${DEFAULT_PREFIX}-error`)).toHaveTextContent(
      "Nope",
    );
  });

  test("the next successful answer clears the error", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("ka");
    advance(SEARCH_DEBOUNCE_MS);
    await rejectWith(0, new Error("Network request failed"));

    typeText("kansas");
    advance(SEARCH_DEBOUNCE_MS);
    await answer(1, searchBody([KANSAS_CITY]));

    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-error`),
    ).not.toBeInTheDocument();
    expect(option("site-kc")).toBeInTheDocument();
  });

  test("dropping below the threshold clears an error", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("ka");
    advance(SEARCH_DEBOUNCE_MS);
    await rejectWith(0, new Error("Network request failed"));

    typeText("k");
    typeText("ka");

    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-error`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-searching`),
    ).toBeInTheDocument();
  });
});

/*
 * The status lines inside the panel. "No sites match" must only ever describe
 * the text in the box: shown over the previous query's rows, the instant
 * somebody types, it would be a lie about a search that has not run yet.
 */
describe("the panel's status lines", () => {
  test('"Searching…" shows from the first keystroke until the answer arrives', async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("kansas");

    expect(screen.getByTestId(`${DEFAULT_PREFIX}-searching`)).toHaveTextContent(
      "Searching…",
    );
    advance(SEARCH_DEBOUNCE_MS);
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-searching`),
    ).toBeInTheDocument();

    await answer(0, searchBody([KANSAS_CITY]));
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-searching`),
    ).not.toBeInTheDocument();
  });

  test('"No sites match that name." appears only once the answer for the current text is empty', async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("zz");
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-no-results`),
    ).not.toBeInTheDocument();

    advance(SEARCH_DEBOUNCE_MS);
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-no-results`),
    ).not.toBeInTheDocument();

    await answer(0, searchBody([]));
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-no-results`),
    ).toHaveTextContent("No sites match that name.");
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-searching`),
    ).not.toBeInTheDocument();
  });

  test('"No sites match" disappears the moment the text changes, and "Searching…" takes its place', async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("zz", []);
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-no-results`),
    ).toBeInTheDocument();

    typeText("zzz");

    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-no-results`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-searching`),
    ).toBeInTheDocument();

    advance(SEARCH_DEBOUNCE_MS);
    await answer(1, searchBody([]));
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-no-results`),
    ).toBeInTheDocument();
  });

  /*
   * The line is keyed to the text the rows answer, not to "is a request
   * pending": typing back to text that was already answered puts that
   * answer's line straight back, rather than claiming to search for it.
   */
  test("going back to text that was already answered shows its status line at once", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("zz", []);

    typeText("zzz");
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-no-results`),
    ).not.toBeInTheDocument();

    typeText("zz");
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-no-results`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-searching`),
    ).not.toBeInTheDocument();
  });

  test("an answer with rows shows neither status line", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("kansas", [KANSAS_CITY]);

    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-no-results`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-searching`),
    ).not.toBeInTheDocument();
  });

  test("a capped answer says there are more matches than shown", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("unit", [KANSAS_CITY, UNIT_104822], true);

    expect(screen.getByTestId(`${DEFAULT_PREFIX}-truncated`)).toHaveTextContent(
      "More sites match than are shown — keep typing to narrow it down.",
    );
  });

  test("the truncation note needs a literal true", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("unit");
    advance(SEARCH_DEBOUNCE_MS);
    await answer(0, { results: [UNIT_104822], isTruncated: "true" });

    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-truncated`),
    ).not.toBeInTheDocument();
  });

  test("an uncapped answer after a capped one drops the note", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("un", THREE_ROWS, true);
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-truncated`),
    ).toBeInTheDocument();

    await searchFor("unit 1048", [UNIT_104822]);
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-truncated`),
    ).not.toBeInTheDocument();
  });
});

/*
 * Clearing and shrinking the text. Below the threshold there is nothing to
 * show, and the sequence number is bumped so a request already in flight for
 * the longer text cannot arrive afterwards and repopulate a cleared list.
 */
describe("clearing and shrinking the text", () => {
  test("the clear button appears only when there is text", () => {
    renderBox();
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-clear`),
    ).not.toBeInTheDocument();

    typeText("k");
    expect(screen.getByTestId(`${DEFAULT_PREFIX}-clear`)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear search" }),
    ).toBeInTheDocument();
  });

  test("the clear button hands the page an empty string and closes the panel", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("kansas", THREE_ROWS);
    onChangeMock.mockClear();

    fireEvent.click(screen.getByTestId(`${DEFAULT_PREFIX}-clear`));

    expect(onChangeMock).toHaveBeenCalledTimes(1);
    expect(onChangeMock).toHaveBeenCalledWith("");
    expect(onSelectSiteMock).not.toHaveBeenCalled();
    expect(searchInput().value).toBe("");
    expect(panel()).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-clear`),
    ).not.toBeInTheDocument();
  });

  test("dropping below the threshold clears the rows, and a late answer does not bring them back", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("ka");
    advance(SEARCH_DEBOUNCE_MS);
    expect(postMock).toHaveBeenCalledTimes(1);

    typeText("k");
    await answer(0, searchBody(THREE_ROWS, true));

    expect(panel()).not.toBeInTheDocument();

    // Back above the threshold: a fresh search, not the late answer.
    typeText("ka");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-searching`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${DEFAULT_PREFIX}-truncated`),
    ).not.toBeInTheDocument();

    advance(SEARCH_DEBOUNCE_MS);
    expect(postMock).toHaveBeenCalledTimes(2);
    await answer(1, searchBody([KANSAS_CITY]));
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  test("rows already on screen are cleared, not kept, when the text drops below the threshold", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("ka", THREE_ROWS);

    typeText("k");
    typeText("ka");

    // The same text as before, but the old answer was thrown away.
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-searching`),
    ).toBeInTheDocument();
  });

  test("clearing while a request is in flight keeps its answer off the page", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("kansas");
    advance(SEARCH_DEBOUNCE_MS);

    fireEvent.click(screen.getByTestId(`${DEFAULT_PREFIX}-clear`));
    await answer(0, searchBody([KANSAS_CITY]));

    typeText("ka");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

/*
 * Focus. Closing on blur is exact because the panel swallows mousedown: the
 * only thing that blurs the input is the reader going somewhere else.
 */
describe("focus", () => {
  test("blur closes the panel and focus re-opens it without searching again", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("kansas", THREE_ROWS);

    fireEvent.blur(searchInput());
    expect(panel()).not.toBeInTheDocument();
    expect(searchInput()).toHaveAttribute("aria-expanded", "false");

    fireEvent.focus(searchInput());
    expect(panel()).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("a closed panel names no active option, and Enter while blurred commits nothing", async () => {
    renderBox();
    fireEvent.focus(searchInput());
    await searchFor("kansas", THREE_ROWS);
    press("ArrowDown");

    fireEvent.blur(searchInput());

    expect(searchInput()).not.toHaveAttribute("aria-activedescendant");
    expect(press("Enter")).toBe(true);
    expect(onSelectSiteMock).not.toHaveBeenCalled();
  });

  test("focus alone below the threshold opens nothing", () => {
    renderBox({ initialValue: "k" });
    fireEvent.focus(searchInput());

    expect(panel()).not.toBeInTheDocument();
    expect(searchInput()).toHaveAttribute("aria-expanded", "false");
  });
});

/*
 * The local half's feedback: how far this text narrowed the level in view.
 * The Network Map prints it under the box; Device Topology already prints
 * the same count beside its box, so it turns this one off rather than say
 * it twice.
 */
describe("the local count", () => {
  function localCount(prefix: string = DEFAULT_PREFIX): HTMLElement | null {
    return screen.queryByTestId(`${prefix}-local-count`);
  }

  test("shows by default when the text narrowed the level", () => {
    renderBox({
      initialValue: "ka",
      localMatchCount: 2,
      localTotalCount: 5,
      childTypeLabel: "Market",
    });

    expect(localCount()).toHaveTextContent(
      "Showing 2 of 5 markets at this level",
    );
  });

  test("stays up while the dropdown is closed — it describes the page, not the panel", () => {
    renderBox({
      initialValue: "k",
      localMatchCount: 1,
      localTotalCount: 4,
      childTypeLabel: "Region",
    });

    expect(panel()).not.toBeInTheDocument();
    expect(localCount()).toHaveTextContent(
      "Showing 1 of 4 regions at this level",
    );
  });

  test("is singular when the level holds exactly one site", () => {
    renderBox({
      initialValue: "zz",
      localMatchCount: 0,
      localTotalCount: 1,
      childTypeLabel: "Market",
    });

    expect(localCount()).toHaveTextContent(
      "Showing 0 of 1 market at this level",
    );
  });

  test.each([
    ["Facility", "facilities"],
    ["Branch", "branches"],
    ["Business", "businesses"],
    ["Units", "units"],
    ["Store", "stores"],
  ])(
    "pluralizes the customer's %s as %s",
    (label: string, plural: string): void => {
      renderBox({
        initialValue: "ka",
        localMatchCount: 3,
        localTotalCount: 7,
        childTypeLabel: label,
      });

      expect(localCount()).toHaveTextContent(
        `Showing 3 of 7 ${plural} at this level`,
      );
    },
  );

  test("is absent when nothing was filtered out", () => {
    renderBox({
      initialValue: "ka",
      localMatchCount: 5,
      localTotalCount: 5,
    });

    expect(localCount()).not.toBeInTheDocument();
  });

  test("is absent when the box is empty or only whitespace", () => {
    renderBox({ localMatchCount: 2, localTotalCount: 5 });
    expect(localCount()).not.toBeInTheDocument();

    typeText("   ");
    expect(localCount()).not.toBeInTheDocument();
  });

  test("appears and disappears as the text changes", () => {
    renderBox({ localMatchCount: 2, localTotalCount: 5 });
    typeText("k");
    expect(localCount()).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`${DEFAULT_PREFIX}-clear`));
    expect(localCount()).not.toBeInTheDocument();
  });

  test("never shows with showLocalCount={false}", () => {
    renderBox({
      initialValue: "ka",
      localMatchCount: 2,
      localTotalCount: 5,
      showLocalCount: false,
      dataTestId: TOPOLOGY_PREFIX,
    });

    expect(localCount(TOPOLOGY_PREFIX)).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing 2 of 5/)).not.toBeInTheDocument();
  });

  test("shows with an explicit showLocalCount={true}", () => {
    renderBox({
      initialValue: "ka",
      localMatchCount: 2,
      localTotalCount: 5,
      showLocalCount: true,
    });

    expect(localCount()).toBeInTheDocument();
  });

  test("lives in a polite live region that is mounted even when it is empty", () => {
    const view: RenderResult = renderBox({
      localMatchCount: 2,
      localTotalCount: 5,
    });
    const region: Element | null = view.container.querySelector(
      '[aria-live="polite"]',
    );

    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();

    typeText("ka");
    expect(region).toContainElement(localCount());
  });
});

/*
 * Test ids and DOM ids. The Network Map's end-to-end tests and the explorer's
 * each find the box by a prefix of their own, so the default must stay the
 * map's and a custom prefix must rename EVERY id — one left behind would make
 * two boxes on one page collide, or a page's tests find the wrong one.
 */
describe("test ids", () => {
  test("default to the Network Map's prefix", async () => {
    renderBox();
    expect(screen.getByTestId(DEFAULT_PREFIX)).toBe(searchInput());

    fireEvent.focus(searchInput());
    typeText("kansas");
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-searching`),
    ).toBeInTheDocument();
    advance(SEARCH_DEBOUNCE_MS);
    await answer(0, searchBody([KANSAS_CITY], true));

    expect(screen.getByTestId(`${DEFAULT_PREFIX}-clear`)).toBeInTheDocument();
    expect(screen.getByTestId(`${DEFAULT_PREFIX}-results`)).toBeInTheDocument();
    expect(
      screen.getByTestId(`${DEFAULT_PREFIX}-truncated`),
    ).toBeInTheDocument();
    expect(option("site-kc")).toHaveAttribute(
      "id",
      `${DEFAULT_PREFIX}-option-site-kc`,
    );
    expect(screen.getByRole("listbox")).toHaveAttribute(
      "id",
      `${DEFAULT_PREFIX}-listbox`,
    );
  });

  test("an empty prefix falls back to the default", () => {
    renderBox({ dataTestId: "" });
    expect(screen.getByTestId(DEFAULT_PREFIX)).toBe(searchInput());
  });

  test("a custom prefix renames the input, panel, rows, clear button and DOM ids", async () => {
    const view: RenderResult = renderBox({ dataTestId: TOPOLOGY_PREFIX });
    expect(screen.getByTestId(TOPOLOGY_PREFIX)).toBe(searchInput());

    fireEvent.focus(searchInput());
    await searchFor("kansas", [KANSAS_CITY, UNIT_104822]);

    expect(
      screen.getByTestId(`${TOPOLOGY_PREFIX}-results`),
    ).toBeInTheDocument();
    expect(screen.getByTestId(`${TOPOLOGY_PREFIX}-clear`)).toBeInTheDocument();
    expect(option("site-kc", TOPOLOGY_PREFIX)).toHaveAttribute(
      "id",
      `${TOPOLOGY_PREFIX}-option-site-kc`,
    );
    expect(option("site-unit-104822", TOPOLOGY_PREFIX)).toHaveAttribute(
      "id",
      `${TOPOLOGY_PREFIX}-option-site-unit-104822`,
    );
    expect(screen.getByRole("listbox")).toHaveAttribute(
      "id",
      `${TOPOLOGY_PREFIX}-listbox`,
    );
    expect(searchInput()).toHaveAttribute(
      "aria-controls",
      `${TOPOLOGY_PREFIX}-listbox`,
    );

    press("ArrowDown");
    expect(searchInput()).toHaveAttribute(
      "aria-activedescendant",
      `${TOPOLOGY_PREFIX}-option-site-kc`,
    );

    // Nothing is left under the Network Map's names.
    expect(
      view.container.querySelectorAll(`[data-testid^="${DEFAULT_PREFIX}"]`),
    ).toHaveLength(0);
    expect(
      view.container.querySelectorAll(`[id^="${DEFAULT_PREFIX}"]`),
    ).toHaveLength(0);
  });

  test("a custom prefix renames the status lines too", async () => {
    const view: RenderResult = renderBox({
      dataTestId: TOPOLOGY_PREFIX,
      initialValue: "k",
      localMatchCount: 1,
      localTotalCount: 3,
    });
    expect(
      screen.getByTestId(`${TOPOLOGY_PREFIX}-local-count`),
    ).toBeInTheDocument();

    fireEvent.focus(searchInput());
    typeText("zz");
    expect(
      screen.getByTestId(`${TOPOLOGY_PREFIX}-searching`),
    ).toBeInTheDocument();
    advance(SEARCH_DEBOUNCE_MS);
    await answer(0, searchBody([]));
    expect(
      screen.getByTestId(`${TOPOLOGY_PREFIX}-no-results`),
    ).toBeInTheDocument();

    typeText("zzz");
    advance(SEARCH_DEBOUNCE_MS);
    await answer(1, searchBody([KANSAS_CITY], true));
    expect(
      screen.getByTestId(`${TOPOLOGY_PREFIX}-truncated`),
    ).toBeInTheDocument();

    typeText("zzzz");
    advance(SEARCH_DEBOUNCE_MS);
    await rejectWith(2, new Error("Network request failed"));
    expect(screen.getByTestId(`${TOPOLOGY_PREFIX}-error`)).toBeInTheDocument();

    expect(
      view.container.querySelectorAll(`[data-testid^="${DEFAULT_PREFIX}"]`),
    ).toHaveLength(0);
  });

  test("two boxes with different prefixes on one page keep separate listboxes", async () => {
    render(
      <>
        <Harness />
        <Harness dataTestId={TOPOLOGY_PREFIX} />
      </>,
    );
    const mapBox: HTMLElement = screen.getByTestId(DEFAULT_PREFIX);
    const topologyBox: HTMLElement = screen.getByTestId(TOPOLOGY_PREFIX);

    fireEvent.focus(topologyBox);
    fireEvent.change(topologyBox, { target: { value: "kansas" } });
    advance(SEARCH_DEBOUNCE_MS);
    await answer(0, searchBody([KANSAS_CITY]));

    expect(topologyBox).toHaveAttribute(
      "aria-controls",
      `${TOPOLOGY_PREFIX}-listbox`,
    );
    expect(mapBox).toHaveAttribute("aria-expanded", "false");
    expect(
      document.getElementById(`${TOPOLOGY_PREFIX}-option-site-kc`),
    ).toBeInTheDocument();
    expect(
      document.getElementById(`${DEFAULT_PREFIX}-option-site-kc`),
    ).not.toBeInTheDocument();
  });
});

/*
 * Combobox ARIA. The dropdown is a real listbox driven from a text box, so a
 * screen reader has to be told that it exists, whether it is open, which
 * element it is, and which of its options the arrow keys are on.
 */
describe("combobox semantics", () => {
  test("the input is a list-autocompleting combobox that pops up a listbox", () => {
    renderBox();
    const input: HTMLInputElement = searchInput();

    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-haspopup", "listbox");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  test("aria-expanded and aria-controls follow the panel", async () => {
    renderBox();
    const input: HTMLInputElement = searchInput();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-controls");
    expect(input).not.toHaveAttribute("aria-activedescendant");

    fireEvent.focus(input);
    typeText("ka");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", `${DEFAULT_PREFIX}-listbox`);

    advance(SEARCH_DEBOUNCE_MS);
    await answer(0, searchBody(THREE_ROWS));

    const listbox: HTMLElement | null = document.getElementById(
      input.getAttribute("aria-controls") || "",
    );
    expect(listbox).toHaveAttribute("role", "listbox");
    expect(listbox).toHaveAttribute("aria-label", "Site search results");
    expect(within(listbox!).getAllByRole("option")).toHaveLength(3);

    typeText("k");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-controls");
  });

  test("the listbox is mounted, empty, while the first answer is pending", () => {
    renderBox();
    fireEvent.focus(searchInput());
    typeText("ka");

    const listbox: HTMLElement = screen.getByRole("listbox");
    expect(listbox.id).toBe(searchInput().getAttribute("aria-controls"));
    expect(within(listbox).queryAllByRole("option")).toHaveLength(0);
  });

  test("the default placeholder doubles as the accessible name", () => {
    renderBox();
    const input: HTMLInputElement = searchInput();

    expect(input).toHaveAttribute("placeholder", DEFAULT_PLACEHOLDER);
    expect(input).toHaveAttribute("aria-label", DEFAULT_PLACEHOLDER);
    expect(screen.getByRole("combobox", { name: DEFAULT_PLACEHOLDER })).toBe(
      input,
    );
  });

  test("a custom placeholder is used as both placeholder and accessible name", () => {
    renderBox({ placeholder: "Find a store, market or region" });
    const input: HTMLInputElement = searchInput();

    expect(input).toHaveAttribute(
      "placeholder",
      "Find a store, market or region",
    );
    expect(input).toHaveAttribute(
      "aria-label",
      "Find a store, market or region",
    );
    expect(
      screen.queryByRole("combobox", { name: DEFAULT_PLACEHOLDER }),
    ).not.toBeInTheDocument();
  });

  test("an empty placeholder falls back to the default", () => {
    renderBox({ placeholder: "" });
    expect(searchInput()).toHaveAttribute("placeholder", DEFAULT_PLACEHOLDER);
    expect(searchInput()).toHaveAttribute("aria-label", DEFAULT_PLACEHOLDER);
  });
});
