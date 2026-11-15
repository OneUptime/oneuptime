/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterAll,
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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { PluralTemplate, TemplateValues } from "../../../Types/Translator";
import {
  UserFlowJourneysResponseDto,
  UserFlowSessionDto,
} from "../../../Types/Rum/UserFlow";
import {
  analyzeUserFlow,
  UserFlowAnalysis,
  UserFlowDirection,
  UserFlowInsight,
  UserFlowLink,
  UserFlowNode,
} from "../../../Utils/Rum/UserFlow";
import {
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
  ParagraphDirection,
} from "../../Helpers/BidiLayout";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
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

import DashboardI18n, {
  i18nReady,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/i18n";
import UserFlowDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowDetailPanel";
import { formatUserFlowShare } from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowFormat";
import UserFlowMap, {
  UserFlowSelection,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowMap";
import UserFlowOverview from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowOverview";
import UserFlowTables from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowTables";
import RumApplicationUserFlows from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/UserFlows";

/*
 * #7879: A PATH IN LATIN LETTERS OR DIGITS READS AS WRITTEN IN AN ARABIC OR
 * PERSIAN SENTENCE.
 *
 * The User Flows page names a page in its sentences - "Show paths from
 * {{page}}", "{{page}} (not visited in this range)" - and filled them with
 * the path as it is. In a sentence read from the right, the bidi algorithm
 * lays "/cart" out as part of the line: its slash belongs to no letter, so
 * it takes the sentence's direction and is drawn at the path's other end,
 * "cart/". "/2024" is drawn "2024/": its digits read as a number of the
 * sentence. Each such sentence that is only drawn now sets its values
 * apart (the Translator's setsValuesApart), so the path reads as written.
 *
 * Through the Dashboard's own i18next (src/Utils/i18n.ts: its locale files,
 * fetched as a reader picks a language, and its post-processor, which sets
 * the code of a sentence apart before the values go in), laid out with the
 * tests' copy of the bidi algorithm (Tests/Helpers/BidiLayout). Each test
 * has its negative control: the same words filled with nothing set apart,
 * as the page filled them before, draw the path backwards.
 */

jest.setTimeout(120000);

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

// Paths in Latin letters ("/cart") and in digits ("/2024").
const SESSIONS: Array<{ id: string; pages: Array<string> }> = [
  { id: "p1", pages: ["/home", "/cart", "/checkout"] },
  { id: "p2", pages: ["/home", "/cart", "/2024"] },
  { id: "p3", pages: ["/home", "/cart"] },
  { id: "p4", pages: ["/2024", "/cart"] },
];

/*
 * With ids grouped, as the page starts, "/2024" is one of the "/:id"
 * pages; a reader who turns the grouping off sees it as it is.
 */
function analyze(
  options: { anchorPage?: string; direction?: UserFlowDirection } = {},
): UserFlowAnalysis {
  return analyzeUserFlow(response(SESSIONS), {
    ...options,
    groupDynamicSegments: false,
  });
}

const ANALYSIS: UserFlowAnalysis = analyze();

function nodeOf(
  analysis: UserFlowAnalysis,
  step: number,
  page: string,
): UserFlowNode {
  const node: UserFlowNode | undefined = analysis.graph.nodes.find(
    (candidate: UserFlowNode): boolean => {
      return candidate.step === step && candidate.page === page;
    },
  );

  if (!node) {
    throw new Error(`No node for ${page} at step ${step}`);
  }

  return node;
}

function linkOf(fromPage: string, toPage: string): UserFlowLink {
  const link: UserFlowLink | undefined = ANALYSIS.graph.links.find(
    (candidate: UserFlowLink): boolean => {
      return candidate.fromPage === fromPage && candidate.toPage === toPage;
    },
  );

  if (!link) {
    throw new Error(`No link from ${fromPage} to ${toPage}`);
  }

  return link;
}

function renderDetail(
  selection: UserFlowSelection,
  analysis: UserFlowAnalysis = ANALYSIS,
): HTMLElement {
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

  return screen.getByTestId("user-flow-detail");
}

// The Dashboard's i18next, in a language, as its language menu sets it.
async function readIn(language: string): Promise<void> {
  await act(async () => {
    await DashboardI18n.changeLanguage(language);
  });

  expect(DashboardI18n.resolvedLanguage).toBe(language);
}

/*
 * The way the browser lays out `element`'s line: its own dir, else its
 * nearest box's, else the page's (<html dir>, which follows the language).
 */
function lineDirectionOf(element: Element): ParagraphDirection {
  const box: Element | null = element.closest("[dir]");

  return box?.getAttribute("dir") === "rtl" ? "rtl" : "ltr";
}

// Whether `path`, where `line` holds it, is drawn as written in a paragraph read `direction`.
function isPathDrawnAsWritten(
  line: string,
  path: string,
  direction: ParagraphDirection,
): boolean {
  const at: number = line.indexOf(path);

  expect({ line, holdsPath: at >= 0 }).toEqual({ line, holdsPath: true });

  return isDrawnAsWritten(drawLine(line, direction), at, at + path.length);
}

// The signs in front of a path's first letter or digit: "/" of "/cart".
const LEADING_SIGNS: RegExp = /^[^\p{L}\p{N}]*/u;

/*
 * A one-word path drawn backwards: its word first, then the signs in front
 * of it, from the right - "cart/", "2024/", "id:/".
 */
function backwards(path: string): string {
  const signs: string = LEADING_SIGNS.exec(path)?.[0] || "";

  return `${path.slice(signs.length)}${Array.from(signs).reverse().join("")}`;
}

/*
 * A line drawn on the page names `path` as written, in the direction the
 * browser lays the line out. Its negative control: the same words with
 * nothing set apart, as the page filled them before, are laid out with the
 * path backwards.
 */
function expectLineNamesPathAsWritten(
  line: string,
  path: string,
  direction: ParagraphDirection,
): void {
  expect({
    line,
    direction,
    asWritten: isPathDrawnAsWritten(line, path, direction),
  }).toEqual({ line, direction, asWritten: true });

  const plain: string = withoutIsolateMarks(line);

  expect(isPathDrawnAsWritten(plain, path, direction)).toBe(false);
  expect(getDrawnText(drawLine(plain, direction))).toContain(backwards(path));
}

/*
 * A title, drawn in a box of its own when the pointer rests on its element.
 * How a browser lays that line out is its own choice - the element's way,
 * or the way the sentence's first letter reads - so the path must read as
 * written either way. Its negative control is the sentence's own way, from
 * the right, which drew the path backwards.
 */
function expectTitleNamesPathAsWritten(title: string, path: string): void {
  expectLineNamesPathAsWritten(title, path, "rtl");
  expect(isPathDrawnAsWritten(title, path, "ltr")).toBe(true);
}

/*
 * The locale's sentence for `template`, its values filled in as they are:
 * the words a sentence must say, whatever marks set its values apart.
 */
function wordsOf(
  language: string,
  template: string | PluralTemplate,
  values: TemplateValues,
  count?: number,
): string {
  return typeof template === "string"
    ? dashboardTranslator(language).translateTemplate(template, values)
    : dashboardTranslator(language).translatePlural(
        template,
        count ?? 0,
        values,
      );
}

// The Top paths table's page chips that name `path`.
function chipsFor(path: string): Array<HTMLElement> {
  return screen
    .getAllByTestId("user-flow-path-row")
    .flatMap((row: HTMLElement): Array<HTMLElement> => {
      return within(row).getAllByRole("button");
    })
    .filter((button: HTMLElement): boolean => {
      return withoutIsolateMarks(button.textContent || "") === path;
    });
}

// The element under `container` whose words, marks aside, are `words`.
function saying(
  container: HTMLElement,
  selector: string,
  words: string,
): HTMLElement {
  const found: HTMLElement | undefined = Array.from(
    container.querySelectorAll<HTMLElement>(selector),
  ).find((element: HTMLElement): boolean => {
    return withoutIsolateMarks(element.textContent || "") === words;
  });

  expect({ words, found: Boolean(found) }).toEqual({ words, found: true });

  return found as HTMLElement;
}

/*
 * Two findings, one for each way a finding points the map: a drop-off at
 * "/cart" (how did people get there?) and the landing page "/2024" (where
 * do they go from it?).
 */
const INSIGHTS: Array<UserFlowInsight> = [
  {
    kind: "drop-off",
    tone: "warning",
    title: "Journeys end on /cart",
    detail: "25% of the sessions that navigated to /cart left there.",
    page: "/cart",
    focusDirection: "backward",
    sessions: 1,
    share: 0.25,
  },
  {
    kind: "top-entry",
    tone: "neutral",
    title: "Most sessions start on /2024",
    detail: "25% of sessions landed on /2024.",
    page: "/2024",
    focusDirection: "forward",
    sessions: 1,
    share: 0.25,
  },
];

function renderOverview(): void {
  render(
    <UserFlowOverview
      summary={ANALYSIS.summary}
      insights={INSIGHTS}
      sessionsRead={4}
      sessionsInWindow={4}
      isSampled={false}
      onFocusPage={(): void => {
        return;
      }}
    />,
  );
}

function insightTitle(direction: UserFlowDirection): string {
  const insight: HTMLElement | undefined = screen
    .getAllByTestId("user-flow-insight")
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-focus-direction") === direction;
    });

  expect(insight).toBeDefined();

  return insight?.getAttribute("title") || "";
}

/* ---- The page itself: a page nobody visited in the range ---- */

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID.toString()}/user-flows`;

// Nobody visited "/2024" in the range the page reads.
const PAGE_SESSIONS: Array<{ id: string; pages: Array<string> }> = [
  { id: "q1", pages: ["/home", "/cart"] },
  { id: "q2", pages: ["/home", "/checkout"] },
];

const NOT_VISITED_OPTION: string = "{{page}} (not visited in this range)";
const NOT_VISITED_NOTE: string =
  "No session visited {{page}} in this range with the current filters. Pick another page, or {{startLink}}.";

// The User Flows page, its map anchored on `anchor`.
async function renderPageAnchoredOn(anchor: string): Promise<void> {
  window.history.replaceState(
    null,
    "",
    `${PAGE_PATH}?page=${encodeURIComponent(anchor)}`,
  );

  render(
    <MemoryRouter>
      <RumApplicationUserFlows
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("user-flow-anchor-missing")).toBeVisible();
  });
}

// The page picker's first option: the anchored page nobody visited.
function notVisitedOption(anchor: string): HTMLOptionElement {
  const option: HTMLOptionElement | undefined = (
    screen.getByTestId("user-flow-anchor-select") as HTMLSelectElement
  ).options[0];

  expect(option?.value).toBe(anchor);

  return option as HTMLOptionElement;
}

beforeEach(async () => {
  window.localStorage.clear();
  await i18nReady;
  postMock.mockReset();
  postMock.mockImplementation(
    (request: { url: { toString: () => string } }) => {
      if (request.url.toString().includes("/session-replay/users")) {
        return Promise.resolve(
          new HTTPResponse(200, { users: [], nextCursor: null }, {}),
        );
      }

      return Promise.resolve(
        new HTTPResponse(
          200,
          response(PAGE_SESSIONS) as unknown as JSONObject,
          {},
        ),
      );
    },
  );
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await DashboardI18n.changeLanguage("en");
});

describe.each(["ar", "fa"])(
  "#7879: in %s, a path in Latin letters or digits reads as written in a sentence",
  (language: string) => {
    test("a page chip's title names '/cart' and '/2024' as written, not 'cart/'", async () => {
      await readIn(language);

      // The page is read from the right.
      expect(document.documentElement.getAttribute("dir")).toBe("rtl");

      render(
        <MemoryRouter>
          <UserFlowTables
            paths={ANALYSIS.paths}
            pages={ANALYSIS.pages}
            loops={ANALYSIS.loops}
            rumApplicationId={APP_ID}
            onAnchor={(): void => {
              return;
            }}
          />
        </MemoryRouter>,
      );

      for (const path of ["/cart", "/2024"]) {
        const chips: Array<HTMLElement> = chipsFor(path);

        expect(chips.length).toBeGreaterThan(0);

        for (const chip of chips) {
          const title: string = chip.getAttribute("title") || "";

          expect(withoutIsolateMarks(title)).toBe(
            wordsOf(language, "Show paths from {{page}}", { page: path }),
          );
          expectTitleNamesPathAsWritten(title, path);
        }
      }
    });

    test("the panel: a page list's titles, a column's subtitle, a transition's shares and buttons", async () => {
      await readIn(language);

      // A page's lists of where its sessions came from and went next.
      renderDetail({ kind: "node", id: nodeOf(ANALYSIS, 1, "/cart").id });

      const listed: Array<HTMLElement> = Array.from(
        screen
          .getByTestId("user-flow-previous-pages")
          .querySelectorAll<HTMLElement>("li > button"),
      );

      expect(listed.length).toBeGreaterThan(0);

      for (const item of listed) {
        const path: string = withoutIsolateMarks(
          (item.querySelector(".font-mono") as HTMLElement).textContent || "",
        );
        const title: string = item.getAttribute("title") || "";

        expect(withoutIsolateMarks(title)).toBe(
          wordsOf(language, "Show paths from {{page}}", { page: path }),
        );
        expectTitleNamesPathAsWritten(title, path);
      }

      cleanup();

      // A page one step after "/2024", and one step before "/cart".
      const columns: Array<{
        anchor: string;
        direction: UserFlowDirection;
        page: string;
        template: PluralTemplate;
      }> = [
        {
          anchor: "/2024",
          direction: "forward",
          page: "/cart",
          template: {
            one: "{{count}} page after {{page}}",
            other: "{{count}} pages after {{page}}",
          },
        },
        {
          anchor: "/cart",
          direction: "backward",
          page: "/home",
          template: {
            one: "{{count}} page before {{page}}",
            other: "{{count}} pages before {{page}}",
          },
        },
      ];

      for (const column of columns) {
        const anchored: UserFlowAnalysis = analyze({
          anchorPage: column.anchor,
          direction: column.direction,
        });

        renderDetail(
          { kind: "node", id: nodeOf(anchored, 1, column.page).id },
          anchored,
        );

        // "1 صفحة بعد /2024", above the page's own name.
        const subtitle: HTMLElement = screen.getByTestId(
          "user-flow-detail-title",
        ).previousElementSibling as HTMLElement;
        const line: string = subtitle.textContent || "";

        expect(withoutIsolateMarks(line)).toBe(
          wordsOf(language, column.template, { page: column.anchor }, 1),
        );
        expectLineNamesPathAsWritten(
          line,
          column.anchor,
          lineDirectionOf(subtitle),
        );

        cleanup();
      }

      /*
       * A transition: the share of each of its pages, and a button for
       * each. A Stat's label and a Button's words are looked up once more
       * when drawn, and the Dashboard's post-processor sets the path apart
       * then, so these already read as written before #7879. Each is now
       * set apart where it is filled too, so none leans on that second
       * lookup.
       */
      const detail: HTMLElement = renderDetail({
        kind: "link",
        id: linkOf("/home", "/cart").id,
      });

      const drawn: Array<{ selector: string; words: string; path: string }> = [
        {
          selector: "p",
          words: wordsOf(language, "Share of {{page}}", { page: "/home" }),
          path: "/home",
        },
        {
          selector: "p",
          words: wordsOf(language, "Share of {{page}}", { page: "/cart" }),
          path: "/cart",
        },
        {
          selector: "button",
          words: wordsOf(language, "Paths after {{page}}", { page: "/cart" }),
          path: "/cart",
        },
        {
          selector: "button",
          words: wordsOf(language, "Paths before {{page}}", { page: "/home" }),
          path: "/home",
        },
      ];

      for (const piece of drawn) {
        const element: HTMLElement = saying(
          detail,
          piece.selector,
          piece.words,
        );

        expectLineNamesPathAsWritten(
          element.textContent || "",
          piece.path,
          lineDirectionOf(element),
        );
      }
    });

    test("the map: a band's tooltip line names its first page as written", async () => {
      await readIn(language);

      render(
        <UserFlowMap
          graph={ANALYSIS.graph}
          selection={null}
          onSelect={(): void => {
            return;
          }}
        />,
      );

      const band: HTMLElement | undefined = screen
        .getAllByTestId("user-flow-link")
        .find((candidate: HTMLElement): boolean => {
          return (
            candidate.getAttribute("data-from") === "/home" &&
            candidate.getAttribute("data-to") === "/cart"
          );
        });

      expect(band).toBeDefined();
      fireEvent.mouseEnter(band as HTMLElement);

      // "3 جلسات · 100% من /home": every session on "/home" went to "/cart".
      const share: string = wordsOf(language, "{{share}} of {{page}}", {
        share: formatUserFlowShare(1, dashboardTranslator(language)),
        page: "/home",
      });
      const line: HTMLElement | undefined = Array.from(
        screen
          .getByTestId("user-flow-tooltip")
          .querySelectorAll<HTMLElement>("p"),
      ).find((candidate: HTMLElement): boolean => {
        return withoutIsolateMarks(candidate.textContent || "").endsWith(share);
      });

      expect(line).toBeDefined();
      expectLineNamesPathAsWritten(
        line?.textContent || "",
        "/home",
        lineDirectionOf(line as HTMLElement),
      );
    });

    test("the overview: a finding's title names its page as written", async () => {
      await readIn(language);
      renderOverview();

      const reached: string = insightTitle("backward");

      expect(withoutIsolateMarks(reached)).toBe(
        wordsOf(language, "Show how sessions reached {{page}}", {
          page: "/cart",
        }),
      );
      expectTitleNamesPathAsWritten(reached, "/cart");

      const from: string = insightTitle("forward");

      expect(withoutIsolateMarks(from)).toBe(
        wordsOf(language, "Show paths from {{page}}", { page: "/2024" }),
      );
      expectTitleNamesPathAsWritten(from, "/2024");
    });

    test("the page: the picker's 'not visited in this range' option and the note under the map name '/2024' as written", async () => {
      await readIn(language);
      await renderPageAnchoredOn("/2024");

      const option: HTMLOptionElement = notVisitedOption("/2024");
      const optionText: string = option.textContent || "";

      expect(withoutIsolateMarks(optionText)).toBe(
        wordsOf(language, NOT_VISITED_OPTION, { page: "/2024" }),
      );
      // The option has no dir of its own: it reads as the page does.
      expect(option).not.toHaveAttribute("dir");
      expectLineNamesPathAsWritten(
        optionText,
        "/2024",
        lineDirectionOf(option),
      );

      /*
       * The note draws the path as an element in a slot of its sentence
       * (TranslatedSentence), which sets the slot apart in a sentence read
       * from the right: it read as written before #7879 too.
       */
      const note: HTMLElement = screen.getByTestId("user-flow-anchor-missing");
      const startLink: string =
        DashboardI18n.t("start from the landing page", {
          keySeparator: false,
          nsSeparator: false,
        }) || "";

      expect(note.querySelector("code")?.textContent).toBe("/2024");
      expect(withoutIsolateMarks(note.textContent || "")).toBe(
        wordsOf(language, NOT_VISITED_NOTE, {
          page: "/2024",
          startLink: startLink,
        }),
      );
      expectLineNamesPathAsWritten(
        note.textContent || "",
        "/2024",
        lineDirectionOf(note),
      );
    });
  },
);

describe("#7879: a page read from the left draws the same sentences as before", () => {
  test.each(["en", "de"])(
    "%s: a chip's title, a finding's title and the picker's option, with no marks",
    async (language: string) => {
      await readIn(language);
      expect(document.documentElement.getAttribute("dir")).toBe("ltr");

      render(
        <MemoryRouter>
          <UserFlowTables
            paths={ANALYSIS.paths}
            pages={ANALYSIS.pages}
            loops={ANALYSIS.loops}
            rumApplicationId={APP_ID}
            onAnchor={(): void => {
              return;
            }}
          />
        </MemoryRouter>,
      );

      expect((chipsFor("/cart")[0] as HTMLElement).getAttribute("title")).toBe(
        wordsOf(language, "Show paths from {{page}}", { page: "/cart" }),
      );

      cleanup();
      renderOverview();

      expect(insightTitle("backward")).toBe(
        wordsOf(language, "Show how sessions reached {{page}}", {
          page: "/cart",
        }),
      );

      cleanup();
      await renderPageAnchoredOn("/2024");

      expect(notVisitedOption("/2024").textContent).toBe(
        wordsOf(language, NOT_VISITED_OPTION, { page: "/2024" }),
      );

      const note: string =
        screen.getByTestId("user-flow-anchor-missing").textContent || "";

      expect(note).toBe(withoutIsolateMarks(note));
    },
  );

  test("English: word for word as before", async () => {
    await readIn("en");
    await renderPageAnchoredOn("/2024");

    expect(notVisitedOption("/2024").textContent).toBe(
      "/2024 (not visited in this range)",
    );
    expect(screen.getByTestId("user-flow-anchor-missing").textContent).toBe(
      "No session visited /2024 in this range with the current filters. Pick another page, or start from the landing page.",
    );
  });
});
