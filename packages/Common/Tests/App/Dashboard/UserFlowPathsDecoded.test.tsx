/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  UserFlowJourneysResponseDto,
  UserFlowSessionDto,
} from "../../../Types/Rum/UserFlow";
import {
  analyzeUserFlow,
  UserFlowAnalysis,
  UserFlowDirection,
  UserFlowLink,
  UserFlowNode,
} from "../../../Utils/Rum/UserFlow";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  drawLine,
  getDrawnText,
  ParagraphDirection,
} from "../../Helpers/BidiLayout";
import getJestMockFunction, { MockFunction } from "../../MockType";

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import UserFlowMap, {
  UserFlowSelection,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowMap";
import UserFlowDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowDetailPanel";
import UserFlowTables from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowTables";
import UserFlowJourneys from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowJourneys";
import UserFlowOverview from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowOverview";
import { truncateUserFlowLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowFormat";
import RumApplicationUserFlows from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/UserFlows";

/*
 * #7817: USER FLOWS DRAW A PAGE IN ITS OWN LETTERS.
 *
 * A page's key is its path as the URL parser left it, which escapes every
 * letter beyond ASCII, and the page drew the key: an Arabic page read
 * "/%D8%A7%D9%84%D8%B1...", "/café" read "/caf%C3%A9". Each place that
 * draws a page now draws it as a person reads it, and reads it from the
 * left on every page - "/" first, the Arabic or Persian words in it from
 * the right - while every key, test hook, link and anchor stays the
 * escaped path the session list matches against.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const LRI: string = String.fromCharCode(0x2066);
const PDI: string = String.fromCharCode(0x2069);

// A path with words read from the right, set apart to read from the left.
function setApart(text: string): string {
  return `${LRI}${text}${PDI}`;
}

const HOME_WORD: string = "الرئيسية";
const HOME: string = `/${HOME_WORD}`;
// As the browser stores the address, and as the URL parser writes the key.
const HOME_KEY: string = "/%D8%A7%D9%84%D8%B1%D8%A6%D9%8A%D8%B3%D9%8A%D8%A9";
const PRODUCTS_WORD: string = "المنتجات";
const PRODUCTS: string = `/${PRODUCTS_WORD}`;
const PRODUCTS_KEY: string = encodeURI(PRODUCTS);
// Persian: "about us".
const ABOUT_WORD: string = "درباره-ما";
const ABOUT: string = `/${ABOUT_WORD}`;
const ABOUT_KEY: string = encodeURI(ABOUT);
const CAFE: string = "/café";
const CAFE_KEY: string = "/caf%C3%A9";

// Any escaped byte drawn where a person reads.
const ESCAPED_BYTE: RegExp = /%[0-9A-F]{2}/i;

// A one-segment path drawn from the left: its "/", then its word from the right.
function drawnPath(word: string): string {
  return `/${Array.from(word).reverse().join("")}`;
}

function shown(element: Element): string {
  return withoutIsolateMarks(element.textContent || "");
}

// The element's text as a browser draws it: in its own dir, or the page's.
function drawnFromTheLeft(
  element: Element,
  pageDirection: ParagraphDirection,
): string {
  const dir: string | null = element.getAttribute("dir");

  return getDrawnText(
    drawLine(
      element.textContent || "",
      (dir as ParagraphDirection | null) ?? pageDirection,
    ),
  );
}

// Whether each arrow in the element's line points back, as it is drawn.
function arrowsPointingBack(
  element: Element,
  pageDirection: ParagraphDirection,
): Array<boolean> {
  const text: string = element.textContent || "";
  const dir: string | null = element.getAttribute("dir");
  const levels: Array<number> = drawLine(
    text,
    (dir as ParagraphDirection | null) ?? pageDirection,
  ).levels;
  const pointsBack: Array<boolean> = [];

  for (let index: number = 0; index < text.length; index++) {
    if (text.charAt(index) === "→") {
      pointsBack.push((levels[index] as number) % 2 === 1);
    }
  }

  return pointsBack;
}

const ORIGIN: string = "https://shop.example.com";
const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001");

function response(
  specs: Array<{ id: string; pages: Array<string> }>,
): UserFlowJourneysResponseDto {
  const pages: Array<string> = [];
  const indexOf: (page: string) => number = (page: string): number => {
    const url: string = `${ORIGIN}${page}`;
    let index: number = pages.indexOf(url);

    if (index < 0) {
      index = pages.length;
      pages.push(url);
    }

    return index;
  };

  const sessions: Array<UserFlowSessionDto> = specs.map(
    (spec: (typeof specs)[number], position: number): UserFlowSessionDto => {
      return {
        sessionId: spec.id,
        startUnixMs: 1_800_000_000_000 - position * 1000,
        durationMs: 60_000,
        deviceType: "desktop",
        browserName: "Chrome",
        countryCode: "DK",
        errorCount: 0,
        frustrationCount: 0,
        pages: spec.pages.map(indexOf),
        pageSignals: [],
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
    scope: null,
  };
}

/*
 * The home page is stored in its own letters by two sessions and escaped,
 * as a browser writes it, by the third: one page, three sessions.
 */
const SESSIONS: Array<{ id: string; pages: Array<string> }> = [
  { id: "a1", pages: [HOME, PRODUCTS, CAFE] },
  { id: "a2", pages: [HOME_KEY, PRODUCTS_KEY, "/cart"] },
  { id: "a3", pages: [HOME, PRODUCTS] },
  { id: "a4", pages: [ABOUT, HOME] },
];

const ANALYSIS: UserFlowAnalysis = analyzeUserFlow(response(SESSIONS));

function nodeAt(step: number, page: string): UserFlowNode {
  const node: UserFlowNode | undefined = ANALYSIS.graph.nodes.find(
    (candidate: UserFlowNode): boolean => {
      return candidate.step === step && candidate.page === page;
    },
  );

  if (!node) {
    throw new Error(`No node for ${page} at step ${step}`);
  }

  return node;
}

function linkBetween(from: UserFlowNode, to: UserFlowNode): UserFlowLink {
  const link: UserFlowLink | undefined = ANALYSIS.graph.links.find(
    (candidate: UserFlowLink): boolean => {
      return candidate.sourceId === from.id && candidate.targetId === to.id;
    },
  );

  if (!link) {
    throw new Error(`No link from ${from.page} to ${to.page}`);
  }

  return link;
}

// The pages each render asked the map to open on, and which way.
let anchored: Array<[string, UserFlowDirection]> = [];

function onAnchor(page: string, direction: UserFlowDirection): void {
  anchored.push([page, direction]);
}

function renderMap(): void {
  render(
    <UserFlowMap
      graph={ANALYSIS.graph}
      selection={null}
      onSelect={(): void => {
        return;
      }}
    />,
  );
}

function renderDetail(
  selection: UserFlowSelection,
  analysis: UserFlowAnalysis = ANALYSIS,
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
          return;
        }}
        onClose={(): void => {
          return;
        }}
      />
    </MemoryRouter>,
  );
}

function renderTables(): void {
  render(
    <MemoryRouter>
      <UserFlowTables
        paths={ANALYSIS.paths}
        pages={ANALYSIS.pages}
        loops={ANALYSIS.loops}
        rumApplicationId={APP_ID}
        onAnchor={onAnchor}
      />
    </MemoryRouter>,
  );
}

// The page chips of the Top paths table that name `page`.
function chipsFor(page: string): Array<HTMLElement> {
  return screen
    .getAllByTestId("user-flow-path-row")
    .flatMap((row: HTMLElement): Array<HTMLElement> => {
      return within(row).getAllByRole("button");
    })
    .filter((button: HTMLElement): boolean => {
      return shown(button) === page;
    });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      ar: { translation: readLocale("ar") },
      fa: { translation: readLocale("fa") },
      de: { translation: readLocale("de") },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  anchored = [];
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("the map draws a page in its own letters, from the left", () => {
  test("Arabic: a node is named '/الرئيسية', not its escapes, and keyed by its address", async () => {
    await i18next.changeLanguage("ar");
    renderMap();

    const node: HTMLElement | undefined = screen
      .getAllByTestId("user-flow-node")
      .find((candidate: HTMLElement): boolean => {
        return (
          candidate.getAttribute("data-page") === HOME_KEY &&
          candidate.getAttribute("data-step") === "0"
        );
      });

    expect(node).toBeDefined();
    // Stored in its own letters or escaped, one page.
    expect(node?.getAttribute("data-sessions")).toBe("3");

    const label: Text = node?.querySelector("text")?.firstChild as Text;

    expect(label.textContent).toBe(setApart(HOME));
    // The map is drawn from the left on any page: "/" first.
    expect(getDrawnText(drawLine(label.textContent || "", "ltr"))).toBe(
      drawnPath(HOME_WORD),
    );
    expect(withoutIsolateMarks(node?.getAttribute("aria-label") || "")).toMatch(
      new RegExp(`^${HOME}, `),
    );

    // No node is named by its escapes.
    for (const name of Array.from(
      screen.getByTestId("user-flow-map").querySelectorAll("text > title"),
    )) {
      expect(name.textContent).not.toMatch(ESCAPED_BYTE);
    }

    fireEvent.mouseEnter(node as HTMLElement);

    const title: HTMLElement = screen
      .getByTestId("user-flow-tooltip")
      .querySelector("p") as HTMLElement;

    expect(shown(title)).toBe(HOME);
    expect(title).toHaveAttribute("dir", "ltr");
    expect(drawnFromTheLeft(title, "rtl")).toBe(drawnPath(HOME_WORD));
  });

  test("Arabic: a band between two Arabic pages reads from the left, its arrow pointing on", async () => {
    await i18next.changeLanguage("ar");
    renderMap();

    const band: HTMLElement | undefined = screen
      .getAllByTestId("user-flow-link")
      .find((candidate: HTMLElement): boolean => {
        return (
          candidate.getAttribute("data-from") === HOME_KEY &&
          candidate.getAttribute("data-to") === PRODUCTS_KEY
        );
      });

    expect(band).toBeDefined();
    fireEvent.mouseEnter(band as HTMLElement);

    const title: HTMLElement = screen
      .getByTestId("user-flow-tooltip")
      .querySelector("p") as HTMLElement;

    expect(shown(title)).toBe(`${HOME} → ${PRODUCTS}`);
    expect(title).toHaveAttribute("dir", "ltr");
    expect(drawnFromTheLeft(title, "rtl")).toBe(
      `${drawnPath(HOME_WORD)} → ${drawnPath(PRODUCTS_WORD)}`,
    );
    expect(arrowsPointingBack(title, "rtl")).toEqual([false]);
  });

  test("English: an Arabic path still reads from the left, set apart in its own marks", () => {
    renderMap();

    const node: HTMLElement | undefined = screen
      .getAllByTestId("user-flow-node")
      .find((candidate: HTMLElement): boolean => {
        return candidate.getAttribute("data-page") === CAFE_KEY;
      });

    // A path in letters read from the left needs no marks.
    expect(node?.querySelector("text")?.firstChild?.textContent).toBe(CAFE);

    fireEvent.mouseEnter(
      screen
        .getAllByTestId("user-flow-node")
        .find((candidate: HTMLElement): boolean => {
          return candidate.getAttribute("data-page") === HOME_KEY;
        }) as HTMLElement,
    );

    const title: HTMLElement = screen
      .getByTestId("user-flow-tooltip")
      .querySelector("p") as HTMLElement;

    expect(title.textContent).toBe(setApart(HOME));
    expect(title).not.toHaveAttribute("dir");
    expect(drawnFromTheLeft(title, "ltr")).toBe(drawnPath(HOME_WORD));
  });
});

describe("the detail panel names a page in its own letters, and links it by its address", () => {
  test("Arabic: a page's header, its next pages and its sessions", async () => {
    await i18next.changeLanguage("ar");
    renderDetail({ kind: "node", id: nodeAt(0, HOME_KEY).id });

    const title: HTMLElement = screen.getByTestId("user-flow-detail-title");

    expect(shown(title)).toBe(HOME);
    expect(title).toHaveAttribute("dir", "ltr");
    expect(drawnFromTheLeft(title, "rtl")).toBe(drawnPath(HOME_WORD));

    const next: HTMLElement = screen
      .getByTestId("user-flow-next-pages")
      .querySelector("li > button") as HTMLElement;
    const name: HTMLElement = next.querySelector(".font-mono") as HTMLElement;

    expect(shown(name)).toBe(PRODUCTS);
    expect(name).toHaveAttribute("dir", "ltr");
    expect(drawnFromTheLeft(name, "rtl")).toBe(drawnPath(PRODUCTS_WORD));
    expect(withoutIsolateMarks(next.getAttribute("title") || "")).toContain(
      PRODUCTS,
    );
    expect(next.getAttribute("title")).not.toMatch(ESCAPED_BYTE);

    // Followed by its key, which the anchor and the address hold.
    fireEvent.click(next);
    expect(anchored).toEqual([[PRODUCTS_KEY, "forward"]]);

    // The session list matches the address as the browser stored it.
    const sessions: HTMLAnchorElement | null = document.querySelector(
      "a[href*='urlPrefix']",
    );

    expect(sessions).not.toBeNull();
    expect(
      new URLSearchParams(
        (sessions?.getAttribute("href") || "").split("?")[1] || "",
      ).get("urlPrefix"),
    ).toBe(HOME_KEY);
  });

  test("Arabic: a transition between two Arabic pages reads from the left, its arrow pointing on", async () => {
    await i18next.changeLanguage("ar");
    renderDetail({
      kind: "link",
      id: linkBetween(nodeAt(0, HOME_KEY), nodeAt(1, PRODUCTS_KEY)).id,
    });

    const title: HTMLElement = screen.getByTestId("user-flow-detail-title");

    expect(shown(title)).toBe(`${HOME} → ${PRODUCTS}`);
    expect(title).toHaveAttribute("dir", "ltr");
    expect(drawnFromTheLeft(title, "rtl")).toBe(
      `${drawnPath(HOME_WORD)} → ${drawnPath(PRODUCTS_WORD)}`,
    );
    expect(arrowsPointingBack(title, "rtl")).toEqual([false]);
  });

  test("German: the anchored page is named in its own letters in the column's subtitle", async () => {
    await i18next.changeLanguage("de");

    const anchoredAnalysis: UserFlowAnalysis = analyzeUserFlow(
      response(SESSIONS),
      { anchorPage: HOME_KEY },
    );
    const after: UserFlowNode | undefined = anchoredAnalysis.graph.nodes.find(
      (node: UserFlowNode): boolean => {
        return node.step === 1 && node.page === PRODUCTS_KEY;
      },
    );

    renderDetail({ kind: "node", id: after?.id || "" }, anchoredAnalysis);

    // "1 Seite nach /الرئيسية", above the page's own name.
    const subtitle: HTMLElement = screen.getByTestId("user-flow-detail-title")
      .previousElementSibling as HTMLElement;

    expect(withoutIsolateMarks(subtitle.textContent || "")).toContain(HOME);
    expect(subtitle.textContent).not.toMatch(ESCAPED_BYTE);
  });
});

describe("the tables, the journeys and the overview name a page in its own letters", () => {
  test("Arabic: a path's page chips read from the left, and open the map on the page's key", async () => {
    await i18next.changeLanguage("ar");
    renderTables();

    const chips: Array<HTMLElement> = chipsFor(HOME);

    expect(chips.length).toBeGreaterThan(0);

    for (const chip of chips) {
      expect(chip.textContent).toBe(setApart(HOME));
      expect(chip).toHaveAttribute("dir", "ltr");
      expect(drawnFromTheLeft(chip, "rtl")).toBe(drawnPath(HOME_WORD));
      expect(withoutIsolateMarks(chip.getAttribute("title") || "")).toContain(
        HOME,
      );
    }

    const rows: Array<HTMLElement> =
      screen.getAllByTestId("user-flow-path-row");

    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.getAttribute("data-path");
      }),
    ).toContain(`${HOME_KEY} > ${PRODUCTS_KEY} > ${CAFE_KEY}`);

    // No chip names a page by its escapes.
    for (const row of rows) {
      for (const chip of within(row).getAllByRole("button")) {
        expect(chip.textContent).not.toMatch(ESCAPED_BYTE);
      }
    }

    fireEvent.click(chips[0] as HTMLElement);
    expect(anchored).toEqual([[HOME_KEY, "forward"]]);
  });

  test("Persian: a Persian path reads from the left too", async () => {
    await i18next.changeLanguage("fa");
    renderTables();

    const chip: HTMLElement = chipsFor(ABOUT)[0] as HTMLElement;

    expect(chip.textContent).toBe(setApart(ABOUT));
    expect(chip).toHaveAttribute("dir", "ltr");
    expect(drawnFromTheLeft(chip, "rtl")).toBe(drawnPath(ABOUT_WORD));
    expect(chip.closest("tr")?.getAttribute("data-path")).toBe(
      `${ABOUT_KEY} > ${HOME_KEY}`,
    );
  });

  test("English: an Arabic path's chip needs no dir; '/café' comes back as it was", () => {
    renderTables();

    const chip: HTMLElement = chipsFor(HOME)[0] as HTMLElement;

    expect(chip).not.toHaveAttribute("dir");
    expect(drawnFromTheLeft(chip, "ltr")).toBe(drawnPath(HOME_WORD));
    expect((chipsFor(CAFE)[0] as HTMLElement).textContent).toBe(CAFE);
  });

  test("Arabic: a journey's steps name their pages in their own letters", async () => {
    await i18next.changeLanguage("ar");
    render(
      <MemoryRouter>
        <UserFlowJourneys
          journeys={ANALYSIS.journeys}
          rumApplicationId={APP_ID}
        />
      </MemoryRouter>,
    );

    const steps: Array<HTMLElement> = screen
      .getAllByTestId("user-flow-journey-step")
      .filter((step: HTMLElement): boolean => {
        return step.getAttribute("data-page") === HOME_KEY;
      });

    // Every session saw the home page: as it landed, or after another page.
    expect(steps).toHaveLength(4);

    for (const step of steps) {
      const name: HTMLElement = step.querySelector(".truncate") as HTMLElement;

      expect(name.textContent).toBe(setApart(HOME));
      expect(name).toHaveAttribute("dir", "ltr");
      expect(drawnFromTheLeft(name, "rtl")).toBe(drawnPath(HOME_WORD));
      expect(
        withoutIsolateMarks(
          (name.parentElement as HTMLElement).getAttribute("title") || "",
        ).split("\n")[0],
      ).toBe(HOME);
    }

    for (const step of screen.getAllByTestId("user-flow-journey-step")) {
      expect(step.textContent).not.toMatch(ESCAPED_BYTE);
    }
  });

  test("Arabic: the top landing page's tile and the findings name it as the map does", async () => {
    await i18next.changeLanguage("ar");

    const focused: Array<[string, UserFlowDirection]> = [];

    render(
      <UserFlowOverview
        summary={ANALYSIS.summary}
        insights={ANALYSIS.insights}
        sessionsRead={4}
        sessionsInWindow={4}
        isSampled={false}
        onFocusPage={(page: string, direction: UserFlowDirection): void => {
          focused.push([page, direction]);
        }}
      />,
    );

    const tile: HTMLElement = screen.getByTestId("user-flow-tile-entry-value");

    expect(tile.textContent).toBe(setApart(HOME));
    expect(tile.getAttribute("title")).toBe(setApart(HOME));
    expect(tile).toHaveAttribute("data-value", HOME_KEY);
    expect(tile).toHaveAttribute("dir", "ltr");
    expect(drawnFromTheLeft(tile, "rtl")).toBe(drawnPath(HOME_WORD));

    const finding: HTMLElement | undefined = screen
      .getAllByTestId("user-flow-insight")
      .find((candidate: HTMLElement): boolean => {
        return candidate.getAttribute("data-kind") === "top-entry";
      });

    expect(finding).toBeDefined();
    expect(shown(finding as HTMLElement)).toContain(
      `Most sessions start on ${HOME}`,
    );
    expect(withoutIsolateMarks(finding?.getAttribute("title") || "")).toContain(
      HOME,
    );
    expect(finding?.getAttribute("title")).not.toMatch(ESCAPED_BYTE);

    fireEvent.click(finding as HTMLElement);
    expect(focused).toEqual([[HOME_KEY, "forward"]]);
  });
});

describe("a label cut to fit a node keeps its marks", () => {
  test("the marks take no room, and a path cut from the front still reads from the left", () => {
    // Nine letters fit nine places: not cut for the two marks round them.
    expect(truncateUserFlowLabel(setApart(HOME), HOME.length)).toBe(
      setApart(HOME),
    );
    // Cut, it keeps its end and both marks.
    expect(truncateUserFlowLabel(setApart(`/shop${HOME}`), 6)).toBe(
      setApart(`…${HOME.slice(-5)}`),
    );
    // A path in letters read from the left is cut as before.
    expect(truncateUserFlowLabel("/account/orders/:id/refund", 12)).toBe(
      "…/:id/refund",
    );
  });
});

/* ---- The page itself: the anchor picker, the hidden pages, a missing anchor ---- */

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID.toString()}/user-flows`;
const MISSING_WORD: string = "مفقود";
const MISSING_KEY: string = encodeURI(`/${MISSING_WORD}`);

function answer(): HTTPResponse<JSONObject> {
  return new HTTPResponse(200, response(SESSIONS) as unknown as JSONObject, {});
}

function renderPage(search: string): void {
  window.history.replaceState(null, "", `${PAGE_PATH}${search}`);

  render(
    <MemoryRouter>
      <RumApplicationUserFlows
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

describe("the User Flows page names a page in its own letters, and keeps its key", () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockImplementation(
      (request: { url: { toString: () => string } }) => {
        if (request.url.toString().includes("/session-replay/users")) {
          return Promise.resolve(
            new HTTPResponse(200, { users: [], nextCursor: null }, {}),
          );
        }

        return Promise.resolve(answer());
      },
    );
  });

  test("Arabic: the page picker and a hidden page read from the left; their values stay keys", async () => {
    await i18next.changeLanguage("ar");
    renderPage(
      `?page=${encodeURIComponent(HOME_KEY)}&hide=${encodeURIComponent(
        CAFE_KEY,
      )}&hide=${encodeURIComponent(ABOUT_KEY)}`,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-flow-anchor-select")).toHaveValue(
        HOME_KEY,
      );
    });

    const option: HTMLOptionElement | undefined = Array.from(
      (screen.getByTestId("user-flow-anchor-select") as HTMLSelectElement)
        .options,
    ).find((candidate: HTMLOptionElement): boolean => {
      return candidate.value === HOME_KEY;
    });

    expect(option).toBeDefined();
    expect(option?.textContent).toMatch(
      new RegExp(`^${setApart(HOME)} \\(.+\\)$`),
    );
    expect(option).toHaveAttribute("dir", "ltr");
    expect(
      drawnFromTheLeft(option as HTMLOptionElement, "rtl").startsWith(
        drawnPath(HOME_WORD),
      ),
    ).toBe(true);

    const hidden: Array<HTMLElement> = screen.getAllByTestId(
      "user-flow-hidden-page",
    );

    expect(
      hidden.map((chip: HTMLElement): string | null => {
        return chip.getAttribute("data-page");
      }),
    ).toEqual([CAFE_KEY, ABOUT_KEY]);

    const about: HTMLElement = (hidden[1] as HTMLElement)
      .firstElementChild as HTMLElement;

    expect(about.textContent).toBe(setApart(ABOUT));
    expect(about).toHaveAttribute("dir", "ltr");
    expect(drawnFromTheLeft(about, "rtl")).toBe(drawnPath(ABOUT_WORD));
    expect(
      withoutIsolateMarks(
        within(hidden[1] as HTMLElement)
          .getByRole("button")
          .getAttribute("aria-label") || "",
      ),
    ).toContain(ABOUT);
    expect(
      ((hidden[0] as HTMLElement).firstElementChild as HTMLElement).textContent,
    ).toBe(CAFE);

    for (const choice of Array.from(
      (screen.getByTestId("user-flow-anchor-select") as HTMLSelectElement)
        .options,
    )) {
      expect(choice.textContent).not.toMatch(ESCAPED_BYTE);
    }
  });

  test("English: a page nobody visited is named in its own letters, in the picker and in the note", async () => {
    renderPage(`?page=${encodeURIComponent(MISSING_KEY)}`);

    await waitFor(() => {
      expect(screen.getByTestId("user-flow-anchor-missing")).toBeVisible();
    });

    const note: HTMLElement = screen.getByTestId("user-flow-anchor-missing");

    expect((note.querySelector("code") as HTMLElement).textContent).toBe(
      setApart(`/${MISSING_WORD}`),
    );
    expect(note.textContent).not.toMatch(ESCAPED_BYTE);

    const select: HTMLSelectElement = screen.getByTestId(
      "user-flow-anchor-select",
    ) as HTMLSelectElement;

    expect(select).toHaveValue(MISSING_KEY);
    expect(withoutIsolateMarks(select.options[0]?.textContent || "")).toContain(
      `/${MISSING_WORD}`,
    );

    // An English page needs no dir for a path: it reads from the left already.
    for (const option of Array.from(select.options)) {
      expect(option).not.toHaveAttribute("dir");
      expect(option.textContent).not.toMatch(ESCAPED_BYTE);
    }
  });
});
