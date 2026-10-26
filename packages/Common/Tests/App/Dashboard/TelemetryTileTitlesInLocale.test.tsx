import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * THE TELEMETRY OVERVIEWS' TILES AND CHART CARDS NAME THEIR METRIC IN THE
 * READER'S LANGUAGE.
 *
 * Every telemetry overview (RUM apps, databases, cloud environments,
 * services, queues, serverless functions) hands ResourceOverview's
 * golden-metric tiles and ChartCard an English name - "Page loads",
 * "Queries", "p95 latency", "Queries from applications" - and both used to
 * draw it as given, so a French reader saw "Page loads" on the tile while
 * the showcase and the French docs said "Chargements de page". They draw
 * it in the reader's language now, as the shared components do with the
 * English they are handed (Dashboard/src/Locales/README.md, stage 2):
 *
 *   - a tile's and a chart card's title read as the Dashboard's locale
 *     words them, in all sixteen languages, and a name the locale has no
 *     words for (a metric someone named) reads as given;
 *   - a linked tile's link says "View <name>" in the same language, so its
 *     name holds the words on screen, and a loading tile reads one whole
 *     sentence, never a translated name inside an English sentence;
 *   - the (i) beside a title names the same words;
 *   - a translated title says its language, so a word too long for a
 *     narrow tile is hyphenated where that language breaks it, and the
 *     icon beside it keeps its size;
 *   - English reads exactly as it always did.
 */

// recharts draws nothing in a 0x0 jsdom box: the card's header is what is checked.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="line-chart" />;
    },
  };
});

import ResourceOverview, {
  ResourceOverviewTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import ChartCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import {
  getTileTitleWordsClassName,
  TILE_TITLE_HYPHENATED_WORD_LENGTH,
  TILE_TITLE_HYPHENATED_WORDS_CLASS_NAME,
  TILE_TITLE_WORDS_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/TileTitleWords";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// The tile names the RUM, database and cloud overviews hand ResourceOverview.
const TILE_TITLES: ReadonlyArray<string> = [
  "Page loads",
  "Page load time (p95)",
  "Queries",
  "p95 latency",
];

// The chart card names the RUM and database overviews hand ChartCard.
const CHART_TITLES: ReadonlyArray<string> = [
  "Page loads",
  "Page load time (p95)",
  "Queries from applications",
];

// A name no locale words: a metric someone named.
const NAMED_METRIC: string = "checkout-api p99 (custom)";

const DESCRIPTION: string = "What the number means, in plain words.";

const WINDOW_START: Date = new Date("2026-10-26T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-10-26T11:00:00.000Z");

const SERIES: Array<SeriesPoint> = [
  { seriesName: "Page loads", data: [{ x: WINDOW_START, y: 12 }] },
];

type ChartState = "loading" | "empty" | "chart";

const CHART_STATES: ReadonlyArray<ChartState> = ["loading", "empty", "chart"];

const locales: Record<string, Record<string, unknown>> = {};
const instances: Record<string, i18n> = {};

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

// What the Dashboard draws for this English, in this language.
function drawn(language: string, english: string): string {
  const value: unknown = locales[language]?.[english];

  return typeof value === "string" && value.length > 0 ? value : english;
}

/*
 * A one-slot sentence as the language words it, its slot in the language's
 * words; or, when the language has no wording of it, the English sentence
 * with the English name.
 */
function sentence(
  language: string,
  template: string,
  slot: string,
  english: string,
): string {
  const worded: boolean = drawn(language, template) !== template;

  return (worded ? drawn(language, template) : template).replace(
    `{{${slot}}}`,
    worded ? drawn(language, english) : english,
  );
}

beforeAll(async () => {
  locales["en"] = readLocale("en");

  for (const language of ["en", ...LANGUAGES]) {
    const locale: Record<string, unknown> =
      locales[language] || readLocale(language);
    locales[language] = locale;

    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts).
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: locales["en"] },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function tile(
  title: string,
  extra: Partial<ResourceOverviewTile> = {},
): ResourceOverviewTile {
  return {
    title,
    value: "42",
    icon: IconProp.Globe,
    iconColor: "emerald",
    description: DESCRIPTION,
    ...extra,
  };
}

function tilesFor(titles: ReadonlyArray<string>): Array<ResourceOverviewTile> {
  return titles.map((title: string): ResourceOverviewTile => {
    return tile(title);
  });
}

function renderTiles(
  language: string,
  tiles: Array<ResourceOverviewTile>,
): void {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter initialEntries={["/dashboard/overview"]}>
        <ResourceOverview
          icon={IconProp.Globe}
          title="checkout-web"
          identifier="checkout-web"
          identifierLabel="service.name"
          status="connected"
          lastSeenAt={undefined}
          chips={[]}
          tiles={tiles}
          detailRows={[]}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

// The words each tile's title draws, in the order the tiles are drawn.
function tileTitles(): Array<string> {
  return Array.from(
    document.querySelectorAll("[aria-busy] span.uppercase"),
  ).map((element: Element): string => {
    return element.textContent || "";
  });
}

function renderChartCard(
  language: string,
  title: string,
  state: ChartState,
): void {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <ChartCard
        title={title}
        icon={IconProp.Clock}
        iconColor="blue"
        series={state === "chart" ? SERIES : []}
        windowStart={WINDOW_START}
        windowEnd={WINDOW_END}
        syncId="locale-test"
        loading={state === "loading"}
        description={DESCRIPTION}
      />
    </I18nextProvider>,
  );
}

// The one title a rendered chart card draws.
function chartTitle(): string {
  const titles: Array<Element> = Array.from(
    document.querySelectorAll("span.uppercase"),
  );

  expect(titles).toHaveLength(1);

  return titles[0]!.textContent || "";
}

describe("the names these checks draw", () => {
  test.each(LANGUAGES)("%s words every one of them", (language: string) => {
    for (const english of [...TILE_TITLES, ...CHART_TITLES]) {
      expect({
        language,
        english,
        isWorded: drawn(language, english) !== english,
      }).toEqual({
        language,
        english,
        isWorded: true,
      });
    }

    // And no locale has words for a name someone gave a metric.
    expect(drawn(language, NAMED_METRIC)).toBe(NAMED_METRIC);
  });
});

describe("a golden-metric tile", () => {
  test("in English reads every name as written", () => {
    renderTiles("en", tilesFor([...TILE_TITLES, NAMED_METRIC]));

    expect(tileTitles()).toEqual([...TILE_TITLES, NAMED_METRIC]);
  });

  test.each(LANGUAGES)(
    "%s: names its metric as the Dashboard words it, and a named metric as given",
    (language: string) => {
      renderTiles(language, tilesFor([...TILE_TITLES, NAMED_METRIC]));

      expect(tileTitles()).toEqual([
        ...TILE_TITLES.map((english: string): string => {
          return drawn(language, english);
        }),
        NAMED_METRIC,
      ]);

      for (const english of TILE_TITLES) {
        expect(
          screen.queryByText(english, { selector: "span.uppercase" }),
        ).not.toBeInTheDocument();
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: a linked tile's link says View and the words on screen",
    (language: string) => {
      renderTiles(language, [
        tile("Page loads", { to: new Route("/dashboard/rum/page-loads") }),
      ]);

      const link: HTMLElement = screen.getByRole("link", {
        name: sentence(language, "View {{itemName}}", "itemName", "Page loads"),
      });

      // The link's name holds the label it lies over (WCAG 2.5.3).
      expect(link.textContent).toContain(drawn(language, "Page loads"));
      expect(link.textContent).not.toContain("Page loads");
    },
  );

  test.each(["en", ...LANGUAGES])(
    "%s: a loading tile reads one whole sentence",
    (language: string) => {
      renderTiles(language, [tile("Page loads", { loading: true })]);

      const status: HTMLElement = screen.getByRole("status");
      const expected: string = sentence(
        language,
        "Loading {{itemsName}}",
        "itemsName",
        "Page loads",
      );

      expect(status).toHaveTextContent(expected);

      // The language's name never sits inside the English sentence.
      expect(status).toHaveTextContent(
        expected.startsWith("Loading ")
          ? "Loading Page loads"
          : drawn(language, "Page loads"),
      );
    },
  );

  test("Japanese words the loading line; German keeps the English one whole", () => {
    renderTiles("ja", [tile("Page loads", { loading: true })]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "ページ読み込みを読み込み中",
    );
    cleanup();

    renderTiles("de", [tile("Page loads", { loading: true })]);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Page loads");
    expect(screen.getByRole("status")).not.toHaveTextContent("Seitenaufrufe");
  });

  test.each(LANGUAGES)(
    "%s: the (i) beside the title names the same words",
    (language: string) => {
      renderTiles(language, [tile("Queries")]);

      const root: HTMLElement = document.querySelector(
        "[aria-busy]",
      ) as HTMLElement;

      expect(
        within(root).getByRole("button", {
          name: sentence(language, "About {{label}}", "label", "Queries"),
        }),
      ).toBeInTheDocument();
    },
  );

  test("English links and loading lines read as they always did", () => {
    renderTiles("en", [
      tile("Clients", { to: new Route("/dashboard/rum/clients") }),
      tile("p95 duration", { loading: true }),
    ]);

    expect(
      screen.getByRole("link", { name: "View Clients" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading p95 duration",
    );
  });
});

describe("a chart card", () => {
  test.each(CHART_STATES)(
    "in English, %s, reads its name as written",
    (state: ChartState) => {
      renderChartCard("en", "Queries from applications", state);

      expect(chartTitle()).toBe("Queries from applications");
    },
  );

  test.each(
    LANGUAGES.flatMap((language: string): Array<[string, ChartState]> => {
      return CHART_STATES.map((state: ChartState): [string, ChartState] => {
        return [language, state];
      });
    }),
  )(
    "%s, %s: names its chart as the Dashboard words it",
    (language: string, state: ChartState) => {
      for (const english of CHART_TITLES) {
        renderChartCard(language, english, state);

        expect({ english, title: chartTitle() }).toEqual({
          english,
          title: drawn(language, english),
        });
        expect(
          screen.getByRole("button", {
            name: sentence(language, "About {{label}}", "label", english),
          }),
        ).toBeInTheDocument();
        expect(screen.queryAllByTestId("line-chart")).toHaveLength(
          state === "chart" ? 1 : 0,
        );

        cleanup();
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: a chart someone named reads as given",
    (language: string) => {
      renderChartCard(language, NAMED_METRIC, "chart");

      expect(chartTitle()).toBe(NAMED_METRIC);
    },
  );
});

/*
 * A translated name can hold a word longer than a narrow tile's line: two
 * tiles side by side on a phone leave a title about ten letters, so
 * Portuguese "Carregamentos" broke as "CARREGAME / NTOS". Its title says
 * which language it is in, so the browser hyphenates such a word where that
 * language breaks it (TileTitleWords, as a side menu's titles do); a name
 * the reader's language did not word stays the page's English, and English
 * is never hyphenated. The icon beside the title keeps its size.
 */
describe("TileTitleWords", () => {
  test("hyphenates only a title in the reader's language that holds a word of ten letters or more", () => {
    expect(TILE_TITLE_HYPHENATED_WORD_LENGTH).toBe(10);

    // Nine letters fit the narrowest line; ten may not.
    expect(getTileTitleWordsClassName({ text: "Consultas", lang: "pt" })).toBe(
      TILE_TITLE_WORDS_CLASS_NAME,
    );
    expect(
      getTileTitleWordsClassName({
        text: "Temps de chargement de la page (p95)",
        lang: "fr",
      }),
    ).toBe(TILE_TITLE_HYPHENATED_WORDS_CLASS_NAME);
    expect(
      getTileTitleWordsClassName({ text: "Chargements de page", lang: "fr" }),
    ).toBe(TILE_TITLE_HYPHENATED_WORDS_CLASS_NAME);
    expect(
      getTileTitleWordsClassName({
        text: "Carregamentos de página",
        lang: "pt",
      }),
    ).toBe(TILE_TITLE_HYPHENATED_WORDS_CLASS_NAME);

    // A compound's own hyphen ends a word: "p95-latentie" is two short ones.
    expect(
      getTileTitleWordsClassName({ text: "p95-latentie", lang: "nl" }),
    ).toBe(TILE_TITLE_WORDS_CLASS_NAME);
    expect(
      getTileTitleWordsClassName({ text: "Broker-Zustand", lang: "de" }),
    ).toBe(TILE_TITLE_WORDS_CLASS_NAME);

    // An accented letter counts as one: "Forespørgs" has ten.
    expect(getTileTitleWordsClassName({ text: "Forespørgs", lang: "da" })).toBe(
      TILE_TITLE_HYPHENATED_WORDS_CLASS_NAME,
    );
    expect(getTileTitleWordsClassName({ text: "Forespørg", lang: "da" })).toBe(
      TILE_TITLE_WORDS_CLASS_NAME,
    );
  });

  test("never hyphenates English, or a title without words", () => {
    expect(
      getTileTitleWordsClassName({
        text: "Queries from applications",
        lang: undefined,
      }),
    ).toBe(TILE_TITLE_WORDS_CLASS_NAME);
    expect(getTileTitleWordsClassName({ text: "", lang: "de" })).toBe(
      TILE_TITLE_WORDS_CLASS_NAME,
    );
    expect(getTileTitleWordsClassName({ text: undefined, lang: "de" })).toBe(
      TILE_TITLE_WORDS_CLASS_NAME,
    );
  });

  test("breaks between words always, and hyphenates only inside long words, four letters before and three after", () => {
    expect(TILE_TITLE_WORDS_CLASS_NAME.split(" ")).toEqual(["break-words"]);
    expect(TILE_TITLE_HYPHENATED_WORDS_CLASS_NAME.split(" ")).toEqual([
      "break-words",
      "hyphens-auto",
      `[hyphenate-limit-chars:${TILE_TITLE_HYPHENATED_WORD_LENGTH}_4_3]`,
    ]);
  });
});

describe("a long translated name", () => {
  function titleSpans(): Array<HTMLElement> {
    return Array.from(document.querySelectorAll<HTMLElement>("span.uppercase"));
  }

  test.each(
    LANGUAGES.flatMap((language: string): Array<[string, string]> => {
      return [...TILE_TITLES, NAMED_METRIC].map(
        (english: string): [string, string] => {
          return [language, english];
        },
      );
    }),
  )(
    "%s tile '%s': says its language and breaks where its language does",
    (language: string, english: string) => {
      renderTiles(language, [tile(english)]);

      const span: HTMLElement = titleSpans()[0]!;
      const isWorded: boolean = drawn(language, english) !== english;

      expect(span.getAttribute("lang")).toBe(isWorded ? language : null);
      expect(span).toHaveClass("min-w-0", "break-words");
      expect(span.className).toContain(
        getTileTitleWordsClassName({
          text: drawn(language, english),
          lang: isWorded ? language : undefined,
        }),
      );
    },
  );

  test("Portuguese hyphenates its long page-load words; German Abfragen, English and a named metric only break", () => {
    renderTiles("pt", [tile("Page loads")]);
    expect(titleSpans()[0]).toHaveTextContent("Carregamentos de página");
    expect(titleSpans()[0]).toHaveClass(
      ...TILE_TITLE_HYPHENATED_WORDS_CLASS_NAME.split(" "),
    );
    expect(titleSpans()[0]).toHaveAttribute("lang", "pt");
    cleanup();

    renderTiles("da", [tile("Page load time (p95)")]);
    expect(titleSpans()[0]).toHaveTextContent("Sideindlæsningstid (p95)");
    expect(titleSpans()[0]).toHaveClass("hyphens-auto");
    expect(titleSpans()[0]).toHaveAttribute("lang", "da");
    cleanup();

    renderTiles("de", [tile("Queries")]);
    expect(titleSpans()[0]).toHaveTextContent("Abfragen");
    expect(titleSpans()[0]).not.toHaveClass("hyphens-auto");
    expect(titleSpans()[0]).toHaveClass(TILE_TITLE_WORDS_CLASS_NAME);
    expect(titleSpans()[0]).toHaveAttribute("lang", "de");
    cleanup();

    renderTiles("en", [tile("Page load time (p95)")]);
    expect(titleSpans()[0]).not.toHaveAttribute("lang");
    expect(titleSpans()[0]).not.toHaveClass("hyphens-auto");
    cleanup();

    renderTiles("fr", [tile(NAMED_METRIC)]);
    expect(titleSpans()[0]).not.toHaveAttribute("lang");
    expect(titleSpans()[0]).not.toHaveClass("hyphens-auto");
  });

  test.each(["en", ...LANGUAGES])(
    "%s: a tile's icon keeps its size beside a title of two lines",
    (language: string) => {
      renderTiles(language, [tile("Page load time (p95)")]);

      const root: HTMLElement = document.querySelector(
        "[aria-busy]",
      ) as HTMLElement;
      const icon: HTMLElement = root.querySelector(
        "div.h-7.w-7",
      ) as HTMLElement;

      expect(icon).toHaveClass("shrink-0");
      expect(icon.parentElement).toContainElement(titleSpans()[0]!);
    },
  );

  test.each(
    LANGUAGES.flatMap((language: string): Array<[string, string]> => {
      return CHART_TITLES.map((english: string): [string, string] => {
        return [language, english];
      });
    }),
  )(
    "%s chart card '%s': says its language and breaks where its language does",
    (language: string, english: string) => {
      renderChartCard(language, english, "chart");

      const span: HTMLElement = titleSpans()[0]!;

      expect(span).toHaveAttribute("lang", language);
      expect(span).toHaveClass("min-w-0", "break-words");
      expect(span.className).toContain(
        getTileTitleWordsClassName({
          text: drawn(language, english),
          lang: language,
        }),
      );
    },
  );

  test("an English chart card says no language and never hyphenates", () => {
    renderChartCard("en", "Queries from applications", "chart");

    expect(titleSpans()[0]).not.toHaveAttribute("lang");
    expect(titleSpans()[0]).not.toHaveClass("hyphens-auto");
    expect(titleSpans()[0]).toHaveClass("break-words");
  });
});
