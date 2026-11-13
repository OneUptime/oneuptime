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
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  UserFlowJourneysResponseDto,
  UserFlowSessionDto,
} from "../../../Types/Rum/UserFlow";
import {
  analyzeUserFlow,
  OTHER_PAGES_LABEL,
  UserFlowAnalysis,
  UserFlowLink,
  UserFlowNode,
} from "../../../Utils/Rum/UserFlow";
import { createTranslator, Translator } from "../../../Types/Translator";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { ParagraphDirection } from "../../Helpers/BidiLayout";
import { getPathArrows, PathArrow } from "../../Helpers/PathArrows";
import UserFlowOverview, {
  USER_FLOW_TILE_HINT_CLASS_NAME,
  USER_FLOW_TILE_LABEL_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowOverview";
import UserFlowTables from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowTables";
import UserFlowDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowDetailPanel";
import UserFlowMap, {
  UserFlowSelection,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowMap";
import {
  formatUserFlowCount,
  formatUserFlowSessionsHint,
  pluralizeSessions,
  USER_FLOW_OTHER_PAGES_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowFormat";
import { describeUserFlowColumn } from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowLayout";

/*
 * USER FLOWS IN THE READER'S LANGUAGE - from the Dashboard's shipped locale
 * files (#6658, part 3).
 *
 * A German or Arabic reader of the User Flows page used to meet "Page 2 of
 * the journey", "3 pages after /checkout", "40% of the step", "Share of
 * /cart", "newest 5,000 of 12,000 recorded", the map's legend and its
 * "User flow map with 3 steps across 5 sessions" in English. Each is now one
 * sentence looked up whole, its count written and its plural chosen the
 * reader's way; English stays word for word without a translator.
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

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const AR: Record<string, string> = readLocale("ar");

// The locale's own words for `key`, which must differ from the English.
function worded(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return Object.keys(values).reduce((sentence: string, name: string) => {
    return sentence.split(`{{${name}}}`).join(values[name] as string);
  }, text as string);
}

function translatorFor(
  locale: Record<string, string>,
  language: string,
): Translator {
  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

const GERMAN: Translator = translatorFor(DE, "de");
const ARABIC: Translator = translatorFor(AR, "ar");

function shown(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

const ORIGIN: string = "https://shop.example.com";
const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001");

function response(
  specs: Array<{
    id: string;
    pages: Array<string>;
    errorCount?: number;
    frustrationCount?: number;
    signals?: Array<[string, number, number]>;
  }>,
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
        errorCount: spec.errorCount ?? 0,
        frustrationCount: spec.frustrationCount ?? 0,
        pages: spec.pages.map(indexOf),
        pageSignals: (spec.signals || []).map(
          ([page, errors, frustration]: [string, number, number]): [
            number,
            number,
            number,
          ] => {
            return [indexOf(page), errors, frustration];
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
    scope: null,
  };
}

const FIXTURE: UserFlowJourneysResponseDto = response([
  {
    id: "s1",
    pages: ["/home", "/cart", "/checkout"],
    errorCount: 2,
    signals: [["/checkout", 2, 0]],
  },
  {
    id: "s2",
    pages: ["/home", "/cart", "/home"],
    frustrationCount: 1,
    signals: [["/cart", 0, 1]],
  },
  { id: "s3", pages: ["/home", "/home"] },
  { id: "s4", pages: ["/product/1", "/cart", "/cart"], errorCount: 1 },
  { id: "s5", pages: ["/home", "/cart", "/checkout"] },
]);

const ANALYSIS: UserFlowAnalysis = analyzeUserFlow(FIXTURE);

// No session goes back and forth between two pages.
const STRAIGHT: UserFlowAnalysis = analyzeUserFlow(
  response([
    { id: "t1", pages: ["/home", "/cart"] },
    { id: "t2", pages: ["/home", "/pricing"] },
  ]),
);

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
        onAnchor={(): void => {
          return;
        }}
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

function renderMap(analysis: UserFlowAnalysis = ANALYSIS): void {
  render(
    <UserFlowMap
      graph={analysis.graph}
      selection={null}
      onSelect={(): void => {
        return;
      }}
    />,
  );
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
          return;
        }}
      />
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
});

afterEach(() => {
  cleanup();
});

describe("the user flow format helpers in the reader's language", () => {
  test("a count is written the reader's way; English without a translator", () => {
    expect(formatUserFlowCount(12345, GERMAN)).toBe("12.345");
    expect(formatUserFlowCount(0, GERMAN)).toBe(GERMAN.formatNumber(0));
    expect(formatUserFlowCount(12345)).toBe("12,345");
  });

  test("sessions are counted in the reader's plural", () => {
    expect(pluralizeSessions(1, GERMAN)).toBe(
      worded(DE, "{{count}} sessions_one", { count: "1" }),
    );
    expect(pluralizeSessions(1200, GERMAN)).toBe(
      worded(DE, "{{count}} sessions", { count: "1.200" }),
    );
    expect(withoutIsolateMarks(pluralizeSessions(1, ARABIC))).toBe(
      worded(AR, "{{count}} sessions_one", {
        count: ARABIC.formatNumber(1),
      }),
    );
    expect(pluralizeSessions(1)).toBe("1 session");
    expect(pluralizeSessions(1200)).toBe("1,200 sessions");
  });

  test("the sessions hint says what was read, in German", () => {
    expect(
      formatUserFlowSessionsHint(
        { sessionsRead: 5000, sessionsInWindow: 12000, isSampled: true },
        GERMAN,
      ),
    ).toBe(
      worded(DE, "newest {{read}} of {{total}} recorded", {
        read: "5.000",
        total: "12.000",
      }),
    );
    expect(
      formatUserFlowSessionsHint(
        { sessionsRead: 5, sessionsInWindow: 5, isSampled: false },
        GERMAN,
      ),
    ).toBe(worded(DE, "recorded sessions in range"));
    expect(
      formatUserFlowSessionsHint(
        {
          sessionsRead: 5,
          sessionsInWindow: 5,
          isSampled: false,
          scopeKind: "user",
        },
        ARABIC,
      ),
    ).toBe(worded(AR, "this user's sessions in range"));
    expect(
      formatUserFlowSessionsHint({
        sessionsRead: 5000,
        sessionsInWindow: 12000,
        isSampled: true,
      }),
    ).toBe("newest 5,000 of 12,000 recorded");
  });

  test("a map column is named in German and Arabic", () => {
    const everyone: { anchorPage: null; direction: "forward" } = {
      anchorPage: null,
      direction: "forward",
    };
    const after: { anchorPage: string; direction: "forward" } = {
      anchorPage: "/checkout",
      direction: "forward",
    };
    const before: { anchorPage: string; direction: "backward" } = {
      anchorPage: "/checkout",
      direction: "backward",
    };

    expect(describeUserFlowColumn(0, everyone, GERMAN)).toBe(
      worded(DE, "Landing page"),
    );
    expect(describeUserFlowColumn(2, everyone, GERMAN)).toBe(
      worded(DE, "Page {{number}}", { number: "3" }),
    );
    expect(describeUserFlowColumn(0, after, GERMAN)).toBe(
      worded(DE, "Selected page"),
    );
    expect(describeUserFlowColumn(1, after, GERMAN)).toBe(
      worded(DE, "{{count}} pages after_one", { count: "1" }),
    );
    expect(describeUserFlowColumn(3, before, GERMAN)).toBe(
      worded(DE, "{{count}} pages before", { count: "3" }),
    );
    expect(withoutIsolateMarks(describeUserFlowColumn(3, after, ARABIC))).toBe(
      worded(AR, "{{count}} pages after", { count: ARABIC.formatNumber(3) }),
    );
    // Without a translator: the English it always was.
    expect(describeUserFlowColumn(2, everyone)).toBe("Page 3");
    expect(describeUserFlowColumn(1, before)).toBe("1 page before");
  });
});

describe("the user flow map in German and Arabic", () => {
  test("German: the legend and the map's own name", () => {
    renderMap();

    const legend: HTMLElement = screen.getByTestId("user-flow-legend");

    for (const key of [
      "Sessions moving between pages (thickness = sessions)",
      "Mostly returning to a page already seen",
      "Left the application here",
      "Journey continues beyond the map",
      "Errors on this page",
    ]) {
      expect(shown(legend)).toContain(worded(DE, key));
      expect(shown(legend)).not.toContain(key);
    }

    const map: HTMLElement = screen.getByRole("img");

    expect(withoutIsolateMarks(map.getAttribute("aria-label") || "")).toBe(
      worded(DE, "User flow map with {{count}} steps across {{sessions}}", {
        count: String(ANALYSIS.graph.steps),
        sessions: worded(DE, "{{count}} sessions", {
          count: String(ANALYSIS.graph.sessions),
        }),
      }),
    );

    // Each band names its two pages and its sessions in German.
    const band: HTMLElement = screen.getAllByTestId("user-flow-link")[0]!;

    expect(band.getAttribute("aria-label")).not.toMatch(/ to |sessions?$/);
  });

  test("German: the columns are named in German", () => {
    renderMap();

    const map: HTMLElement = screen.getByTestId("user-flow-map");

    expect(shown(map)).toContain(worded(DE, "Landing page"));
    expect(shown(map)).toContain(
      worded(DE, "Page {{number}}", { number: "2" }),
    );
    expect(shown(map)).not.toContain("Landing page");
  });

  test("Arabic: the legend and the map's name, in Arabic", async () => {
    await i18next.changeLanguage("ar");
    renderMap();

    const legend: HTMLElement = screen.getByTestId("user-flow-legend");

    expect(shown(legend)).toContain(worded(AR, "Errors on this page"));
    expect(shown(legend)).not.toMatch(/[A-Za-z]{3,}/);
    expect(
      withoutIsolateMarks(screen.getByRole("img").getAttribute("aria-label")!),
    ).not.toContain("User flow map");
  });
});

describe("the user flow detail panel in German and Arabic", () => {
  test("German: a page's figures, its header and its hints", () => {
    const node: UserFlowNode = nodeAt(1, "/cart");

    renderDetail({ kind: "node", id: node.id });

    const detail: HTMLElement = screen.getByTestId("user-flow-detail");

    expect(shown(detail)).toContain(
      worded(DE, "Page {{number}} of the journey", { number: "2" }),
    );

    for (const key of [
      "Sessions at this step",
      "Of all sessions",
      "Left the application here",
      "Hit an error here",
      "reached this point",
    ]) {
      expect(shown(detail)).toContain(worded(DE, key));
    }

    expect(shown(detail)).toContain(
      worded(DE, "{{count}} frustrated (rage, dead clicks)", {
        count: String(node.frustrationSessions),
      }),
    );

    for (const english of [
      "of the journey",
      "Sessions at this step",
      "of the step",
      "drop-off",
      "frustrated",
      "Watch sessions",
    ]) {
      expect(shown(detail)).not.toContain(english);
    }
  });

  test("German: a transition's shares name both pages inside one sentence", () => {
    const from: UserFlowNode = nodeAt(0, "/home");
    const to: UserFlowNode = nodeAt(1, "/cart");
    const link: UserFlowLink = linkBetween(from, to);

    renderDetail({ kind: "link", id: link.id });

    const detail: HTMLElement = screen.getByTestId("user-flow-detail");

    expect(shown(detail)).toContain(worded(DE, "Transition"));
    expect(shown(detail)).toContain(
      worded(DE, "Share of {{page}}", { page: from.label }),
    );
    expect(shown(detail)).toContain(
      worded(DE, "Share of {{page}}", { page: to.label }),
    );
    expect(
      screen.getByRole("button", {
        name: worded(DE, "Paths after {{page}}", { page: to.label }),
      }),
    ).toBeInTheDocument();
    expect(shown(detail)).not.toContain("Share of");
    expect(shown(detail)).not.toContain("Paths after");
  });

  test("Arabic: the page's header and figures, in Arabic", async () => {
    await i18next.changeLanguage("ar");

    const node: UserFlowNode = nodeAt(1, "/cart");

    renderDetail({ kind: "node", id: node.id });

    const detail: HTMLElement = screen.getByTestId("user-flow-detail");

    expect(shown(detail)).toContain(
      worded(AR, "Page {{number}} of the journey", {
        number: ARABIC.formatNumber(2),
      }),
    );
    expect(shown(detail)).toContain(worded(AR, "Sessions at this step"));
    expect(shown(detail)).toContain(worded(AR, "reached this point"));
    expect(shown(detail)).not.toContain("of the step");
    expect(shown(detail)).not.toContain("drop-off");
  });
});

describe("the user flow tables and overview in German and Arabic", () => {
  test("German: the Top paths headers and its Watch link", () => {
    renderTables();

    const tables: HTMLElement = document.body;

    expect(shown(tables)).toContain(worded(DE, "Avg. duration"));
    expect(shown(tables)).toContain(worded(DE, "With errors"));
    expect(shown(tables)).not.toContain("Avg. duration");
    expect(shown(tables)).not.toContain("With errors");
  });

  test("German: an empty Back and forth tab says so in German", () => {
    renderTables(STRAIGHT);

    fireEvent.click(screen.getByTestId("user-flow-tab-loops"));

    const key: string =
      "No session in this range left a page and came straight back to it.";

    expect(shown(document.body)).toContain(worded(DE, key));
    expect(shown(document.body)).not.toContain(key);
  });

  test("Arabic: the overview's tile names and its sampled line", async () => {
    await i18next.changeLanguage("ar");

    render(
      <UserFlowOverview
        summary={ANALYSIS.summary}
        insights={ANALYSIS.insights}
        sessionsRead={5000}
        sessionsInWindow={12000}
        isSampled={true}
        onFocusPage={(): void => {
          return;
        }}
      />,
    );

    for (const key of [
      "Sessions analysed",
      "Pages per session",
      "Single-page sessions",
      "Top landing page",
      "Top exit page",
    ]) {
      expect(shown(document.body)).toContain(worded(AR, key));
      expect(shown(document.body)).not.toContain(key);
    }

    expect(shown(document.body)).toContain(
      worded(AR, "newest {{read}} of {{total}} recorded", {
        read: ARABIC.formatNumber(5000),
        total: ARABIC.formatNumber(12000),
      }),
    );
  });
});

/* ---- UI review of #6658 part 3 ---- */

// Four landing pages and room for one, so three fold into "Other pages".
const FOLDED: UserFlowAnalysis = analyzeUserFlow(
  response([
    { id: "f1", pages: ["/home", "/cart"] },
    { id: "f2", pages: ["/home", "/cart"] },
    { id: "f3", pages: ["/pricing", "/cart"] },
    { id: "f4", pages: ["/about", "/cart"] },
    { id: "f5", pages: ["/blog", "/cart"] },
  ]),
  { pagesPerStep: 1 },
);

// A one-line title as it is drawn: its words, its dir and its arrows.
interface DrawnTitle {
  shown: string;
  dir: string | null;
  pointsBack: Array<boolean>;
}

// Laid out in the title's own dir, or the page's where it has none.
function drawnTitle(
  title: HTMLElement,
  pageDirection: ParagraphDirection,
): DrawnTitle {
  const dir: string | null = title.getAttribute("dir");

  return {
    shown: shown(title),
    dir: dir,
    pointsBack: getPathArrows(
      title.textContent || "",
      (dir as ParagraphDirection | null) ?? pageDirection,
    ).map((arrow: PathArrow): boolean => {
      return arrow.pointsBack;
    }),
  };
}

// The transition out of the fold, at the first step, to /cart.
function linkOutOfTheFold(): UserFlowLink {
  const fold: UserFlowNode | undefined = FOLDED.graph.nodes.find(
    (node: UserFlowNode): boolean => {
      return node.isOther && node.step === 0;
    },
  );
  const link: UserFlowLink | undefined = FOLDED.graph.links.find(
    (candidate: UserFlowLink): boolean => {
      return candidate.sourceId === fold?.id;
    },
  );

  if (!fold || !link) {
    throw new Error("No transition out of the fold");
  }

  return link;
}

function renderOverview(): void {
  render(
    <UserFlowOverview
      summary={ANALYSIS.summary}
      insights={ANALYSIS.insights}
      sessionsRead={5000}
      sessionsInWindow={12000}
      isSampled={true}
      onFocusPage={(): void => {
        return;
      }}
    />,
  );
}

describe("UI review: the user flow map on a page read from the right", () => {
  test("the map is drawn from the left on any page, so a label starts at its point", async () => {
    await i18next.changeLanguage("ar");
    renderMap();

    const svg: SVGElement = screen
      .getByTestId("user-flow-map")
      .querySelector("svg") as SVGElement;

    expect(svg.getAttribute("direction")).toBe("ltr");

    cleanup();
    await i18next.changeLanguage("de");
    renderMap();

    expect(
      screen
        .getByTestId("user-flow-map")
        .querySelector("svg")
        ?.getAttribute("direction"),
    ).toBe("ltr");
  });

  test("German: a band into the fold names it in German in its tooltip", () => {
    expect(USER_FLOW_OTHER_PAGES_NAME).toBe(OTHER_PAGES_LABEL);

    renderMap(FOLDED);

    const titles: Array<string> = screen
      .getAllByTestId("user-flow-link")
      .map((band: HTMLElement): string => {
        fireEvent.mouseEnter(band);

        const title: string = shown(
          screen
            .getByTestId("user-flow-tooltip")
            .querySelector("p") as HTMLElement,
        );

        fireEvent.mouseLeave(band);

        return title;
      });

    // "Andere Seiten → /cart".
    expect(titles).toContain(`${worded(DE, "Other pages")} → /cart`);
    expect(titles.join(" | ")).not.toContain("Other pages");
  });

  test("Arabic: a band's tooltip reads '/home → /cart' from the left", async () => {
    await i18next.changeLanguage("ar");
    renderMap();

    const band: HTMLElement = screen.getAllByTestId("user-flow-link")[0]!;

    fireEvent.mouseEnter(band);

    const title: HTMLElement = screen
      .getByTestId("user-flow-tooltip")
      .querySelector("p") as HTMLElement;

    expect(shown(title)).toMatch(/^\/\S* → \/\S*$/);
    expect(title).toHaveAttribute("dir", "ltr");
  });

  /*
   * The fold is named in Arabic there, so most of the letters of a band
   * out of it read from the right. Joined as "صفحات أخرى → /cart" with
   * nothing set apart, its tooltip was laid out from the right: the arrow
   * pointed back at the fold, and the page read "cart/". Its name set
   * apart (joinWithArrowsInDirection), the line reads the map's way.
   */
  test("Arabic: a band out of the fold reads from the left too, its arrow on to the page", async () => {
    await i18next.changeLanguage("ar");
    renderMap(FOLDED);

    const titles: Array<DrawnTitle> = screen
      .getAllByTestId("user-flow-link")
      .map((band: HTMLElement): DrawnTitle => {
        fireEvent.mouseEnter(band);

        const title: DrawnTitle = drawnTitle(
          screen
            .getByTestId("user-flow-tooltip")
            .querySelector("p") as HTMLElement,
          "rtl",
        );

        fireEvent.mouseLeave(band);

        return title;
      });

    expect(titles).toContainEqual({
      shown: `${worded(AR, "Other pages")} → /cart`,
      dir: "ltr",
      pointsBack: [false],
    });
  });
});

describe("UI review: a page's path reads from the left in the panel and the tables", () => {
  test("Arabic: a transition's header is '/home → /cart', starting where the page's lines do", async () => {
    await i18next.changeLanguage("ar");

    const link: UserFlowLink = linkBetween(
      nodeAt(0, "/home"),
      nodeAt(1, "/cart"),
    );

    renderDetail({ kind: "link", id: link.id });

    const title: HTMLElement = screen.getByTestId("user-flow-detail-title");

    expect(shown(title)).toBe("/home → /cart");
    expect(title).toHaveAttribute("dir", "ltr");
    expect(title.className.split(" ")).toContain("text-end");
  });

  test("Arabic: a transition out of the fold is named from the left too, its arrow on", async () => {
    await i18next.changeLanguage("ar");

    renderDetail({ kind: "link", id: linkOutOfTheFold().id }, FOLDED);

    const title: HTMLElement = screen.getByTestId("user-flow-detail-title");

    expect(drawnTitle(title, "rtl")).toEqual({
      shown: `${worded(AR, "Other pages")} → /cart`,
      dir: "ltr",
      pointsBack: [false],
    });
    expect(title.className.split(" ")).toContain("text-end");
  });

  test("German: the same header reads as the page does", () => {
    const link: UserFlowLink = linkBetween(
      nodeAt(0, "/home"),
      nodeAt(1, "/cart"),
    );

    renderDetail({ kind: "link", id: link.id });

    const title: HTMLElement = screen.getByTestId("user-flow-detail-title");

    expect(title).not.toHaveAttribute("dir");
    expect(title.className.split(" ")).not.toContain("text-end");
  });

  test("Arabic: the panel's page lists and the tables' page chips read '/cart', not 'cart/'", async () => {
    await i18next.changeLanguage("ar");
    renderDetail({ kind: "node", id: nodeAt(1, "/cart").id });

    const listed: Array<HTMLElement> = screen
      .getAllByText(/^\/[a-z0-9/]*$/)
      .filter((element: HTMLElement): boolean => {
        return element.tagName === "SPAN";
      });

    expect(listed.length).toBeGreaterThan(0);

    for (const page of listed) {
      expect([page.textContent, page.getAttribute("dir")]).toEqual([
        page.textContent,
        "ltr",
      ]);
    }

    cleanup();
    renderTables();

    const pagePath: RegExp = /^\/[a-z0-9/]*$/;
    const chips: Array<HTMLElement> = screen
      .getAllByRole("button")
      .filter((button: HTMLElement): boolean => {
        return pagePath.test(button.textContent || "");
      });

    expect(chips.length).toBeGreaterThan(0);

    for (const chip of chips) {
      expect([chip.textContent, chip.getAttribute("dir")]).toEqual([
        chip.textContent,
        "ltr",
      ]);
    }
  });
});

describe("UI review: the overview's tiles and findings", () => {
  test("a tile's label and hint wrap to a second line instead of being cut", () => {
    expect(USER_FLOW_TILE_LABEL_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["line-clamp-2", "hyphens-auto", "break-words"]),
    );
    expect(USER_FLOW_TILE_HINT_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["line-clamp-2", "hyphens-auto", "break-words"]),
    );

    renderOverview();

    const label: HTMLElement = screen.getByTestId(
      "user-flow-tile-bounce-label",
    );
    const hint: HTMLElement = screen.getByTestId(
      "user-flow-tile-sessions-hint",
    );

    // "Sitzungen mit nur einer Seite", "neueste 5.000 von 12.000 aufgezeichnet".
    expect(shown(label)).toBe(worded(DE, "Single-page sessions"));
    expect(label.className).toBe(USER_FLOW_TILE_LABEL_CLASS_NAME);
    expect(hint.className).toBe(USER_FLOW_TILE_HINT_CLASS_NAME);
    expect(label.className.split(" ")).not.toContain("truncate");
    expect(hint.className.split(" ")).not.toContain("truncate");
  });

  test("Arabic: the top landing page reads '/home' at the tile's start; a number has no direction of its own", async () => {
    await i18next.changeLanguage("ar");
    renderOverview();

    const page: HTMLElement = screen.getByTestId("user-flow-tile-entry-value");
    const count: HTMLElement = screen.getByTestId(
      "user-flow-tile-sessions-value",
    );

    expect(shown(page)).toBe("/home");
    expect(page).toHaveAttribute("dir", "ltr");
    expect(page.className.split(" ")).toContain("text-end");
    expect(count).not.toHaveAttribute("dir");
    expect(count.className.split(" ")).not.toContain("text-end");
  });

  test("Arabic: a finding still worded in English reads from the left, its full stop last", async () => {
    await i18next.changeLanguage("ar");
    renderOverview();

    const finding: HTMLElement = screen.getAllByTestId("user-flow-insight")[0]!;
    const lines: Array<HTMLElement> = Array.from(
      finding.querySelectorAll("p"),
    ) as Array<HTMLElement>;

    expect(lines).toHaveLength(2);

    for (const line of lines) {
      expect(line).toHaveAttribute("dir", "ltr");
    }

    cleanup();
    await i18next.changeLanguage("de");
    renderOverview();

    for (const line of Array.from(
      screen.getAllByTestId("user-flow-insight")[0]!.querySelectorAll("p"),
    )) {
      expect(line).not.toHaveAttribute("dir");
    }
  });
});
