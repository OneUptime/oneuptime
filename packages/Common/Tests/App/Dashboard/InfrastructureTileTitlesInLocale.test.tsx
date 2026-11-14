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

/*
 * THE INFRASTRUCTURE PAGES' TILES, AND EVERY CHART CARD'S LINES, IN THE
 * READER'S LANGUAGE.
 *
 * The Kubernetes, Proxmox, Ceph, VMware, Docker, Podman, storage array, host
 * and IoT pages draw their golden metrics with one tile
 * (Components/Infrastructure/GoldenMetricTile). It drew its title and the
 * line under its value as a page handed them, so each page either looked its
 * words up itself (tx("Capacity Used"), translator.translateText(...)) or -
 * Kubernetes, IoT, a host's process page, Kubernetes costs - left them in
 * English in every language. The tile now draws them in the reader's
 * language, as the telemetry overviews' tiles do (ResourceOverview), and the
 * pages hand it English:
 *
 *   - every tile title a page hands over is an English literal, never one
 *     the page looked up first, and every one is worded in all sixteen
 *     languages (or is on the language's own same-as-English list);
 *   - the tile draws a title and its line as the locale words them, says
 *     their language, breaks a long translated word where its language
 *     hyphenates it, and reads a name the locale has no words for - and a
 *     line written as the resource wrote it - as given;
 *   - English reads exactly as before.
 *
 * A chart card's legend, hover line and tooltip name each line it plots
 * ("Requests", "Page loads", "Failed", "Received") in the reader's
 * language too: those names are the product's words, which a French reader
 * saw in English beside a French title.
 */

interface CapturedSeries {
  seriesName: string;
}

const drawnSeries: Array<Array<string>> = [];
const drawnData: Array<Array<CapturedSeries>> = [];

// recharts draws nothing in a 0x0 jsdom box: the series it is handed are checked.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: { data: Array<CapturedSeries> }): React.ReactElement => {
      drawnData.push(props.data);
      drawnSeries.push(
        props.data.map((series: CapturedSeries): string => {
          return series.seriesName;
        }),
      );
      return (
        <div data-testid="line-chart">
          {props.data.map((series: CapturedSeries, index: number) => {
            return (
              <span key={index} data-testid="line-chart-series">
                {series.seriesName}
              </span>
            );
          })}
        </div>
      );
    },
  };
});

import GoldenMetricTile from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/GoldenMetricTile";
import ChartCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard";
import IconProp from "../../../Types/Icon/IconProp";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import {
  getTileTitleWordsClassName,
  TILE_TITLE_LONG_WORDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/TileTitleWords";
import { translatableTerm } from "../../../UI/Utils/TranslateTemplate";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);
const SOURCE: string = path.join(DASHBOARD, "src");
const LOCALES_DIR: string = path.join(SOURCE, "Locales");

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

// ResourceOverview's own tile, which translates its tiles itself.
const OWN_TILE_FILES: ReadonlyArray<string> = [
  "Components/TelemetryResource/ResourceOverview.tsx",
];

const TILE_ELEMENT: RegExp = /<GoldenMetricTile\b[\s\S]*?\/>/g;
const LITERAL_TITLE: RegExp = /^<GoldenMetricTile\s+title="([^"]+)"/;
/*
 * These two draw one tile per row of a table, where a list of literals would say the same thing
 * several times. Each table's words go through translationKey, so they reach the locale files.
 */
const TITLES_FROM_A_TABLE: ReadonlyArray<string> = [
  "Pages/OpenStack/View/Capacity.tsx",
  "Components/OpenStack/Part/OpenStackServiceOverview.tsx",
];
const LITERAL_SUBLABEL: RegExp = /\bsublabel="([^"]+)"/g;
const LOOKED_UP_PROP: RegExp =
  /\b(title|sublabel)=\{\s*(tx|translator\.translateText|translateText)\(/;
const CHART_CARD_ELEMENT: RegExp = /<ChartCard\b[\s\S]*?\/>/g;
const LOOKED_UP_SERIES_NAME: RegExp = /seriesName: tx\(/;

const locales: Record<string, Record<string, unknown>> = {};
const instances: Record<string, i18n> = {};
const sameAsEnglish: Record<string, Set<string>> = {};
let globalSameAsEnglish: Set<string> = new Set<string>();

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function drawn(language: string, english: string): string {
  const value: unknown = locales[language]?.[english];

  return typeof value === "string" && value.length > 0 ? value : english;
}

function isKeptAsWritten(language: string, english: string): boolean {
  return (
    globalSameAsEnglish.has(english) ||
    Boolean(sameAsEnglish[language]?.has(english))
  );
}

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

interface PageTile {
  file: string;
  element: string;
}

function pageTiles(): Array<PageTile> {
  const tiles: Array<PageTile> = [];

  for (const file of sourceFiles(SOURCE)) {
    const relative: string = path
      .relative(SOURCE, file)
      .split(path.sep)
      .join("/");

    if (
      OWN_TILE_FILES.includes(relative) ||
      relative === "Components/Infrastructure/GoldenMetricTile.tsx"
    ) {
      continue;
    }

    const code: string = fs.readFileSync(file, "utf8");

    for (const match of code.match(TILE_ELEMENT) || []) {
      tiles.push({ file: relative, element: match });
    }
  }

  return tiles;
}

// Every English title and line a page hands a tile as a literal.
function handedWords(): { titles: Set<string>; sublabels: Set<string> } {
  const titles: Set<string> = new Set<string>();
  const sublabels: Set<string> = new Set<string>();

  for (const tile of pageTiles()) {
    const title: RegExpMatchArray | null = tile.element.match(LITERAL_TITLE);

    if (title) {
      titles.add(title[1] as string);
    }

    for (const sublabel of tile.element.matchAll(LITERAL_SUBLABEL)) {
      sublabels.add(sublabel[1] as string);
    }
  }

  return { titles, sublabels };
}

beforeAll(async () => {
  globalSameAsEnglish = new Set<string>(
    readJson(path.join(DASHBOARD, "i18n/SameAsEnglish.json")) as Array<string>,
  );
  locales["en"] = readJson(path.join(LOCALES_DIR, "en.json")) as Record<
    string,
    unknown
  >;

  for (const language of ["en", ...LANGUAGES]) {
    const locale: Record<string, unknown> =
      locales[language] ||
      (readJson(path.join(LOCALES_DIR, `${language}.json`)) as Record<
        string,
        unknown
      >);
    locales[language] = locale;

    if (language !== "en") {
      const progress: { sameAsEnglish?: Array<string> } = readJson(
        path.join(DASHBOARD, `i18n/Progress/${language}.json`),
      ) as { sameAsEnglish?: Array<string> };
      sameAsEnglish[language] = new Set<string>(progress.sameAsEnglish || []);
    }

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
  drawnSeries.length = 0;
  drawnData.length = 0;
});

function renderTile(
  language: string,
  props: Partial<React.ComponentProps<typeof GoldenMetricTile>>,
): void {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <GoldenMetricTile
        title="Capacity Used"
        icon={IconProp.ChartBar}
        iconColor="blue"
        value="42%"
        description="What the number means, in plain words."
        {...props}
      />
    </I18nextProvider>,
  );
}

function titleElement(): HTMLElement {
  return screen.getByTestId("golden-metric-tile-title");
}

describe("the pages hand their tiles English", () => {
  test("no tile's title or line is looked up by the page first", () => {
    const lookedUp: Array<string> = pageTiles()
      .filter((tile: PageTile): boolean => {
        return LOOKED_UP_PROP.test(tile.element);
      })
      .map((tile: PageTile): string => {
        return `${tile.file}: ${tile.element.slice(0, 80)}`;
      });

    expect(lookedUp).toEqual([]);
  });

  test("every tile's title is an English literal", () => {
    const tiles: Array<PageTile> = pageTiles();

    expect(tiles.length).toBeGreaterThan(80);

    const withoutLiteral: Array<string> = tiles
      .filter((tile: PageTile): boolean => {
        return (
          !LITERAL_TITLE.test(tile.element) &&
          !TITLES_FROM_A_TABLE.some((table: string): boolean => {
            return tile.file.endsWith(table);
          })
        );
      })
      .map((tile: PageTile): string => {
        return `${tile.file}: ${tile.element.slice(0, 80)}`;
      });

    expect(withoutLiteral).toEqual([]);
  });

  test("every title and literal line is a key of the English locale", () => {
    const { titles, sublabels } = handedWords();

    for (const english of [...titles, ...sublabels]) {
      expect({ english, key: locales["en"]?.[english] }).toEqual({
        english,
        key: english,
      });
    }

    // The Kubernetes, IoT and costs tiles that used to stay English.
    for (const english of [
      "Availability",
      "Online Devices",
      "Avg Battery",
      "Total Spend",
      "Potential Saving",
      "Threads",
    ]) {
      expect(titles.has(english)).toBe(true);
    }
  });

  test.each(LANGUAGES)(
    "%s words every tile's title and literal line, or keeps it as written on purpose",
    (language: string) => {
      const { titles, sublabels } = handedWords();
      const english: Array<string> = [...titles, ...sublabels].filter(
        (words: string): boolean => {
          return (
            drawn(language, words) === words &&
            !isKeptAsWritten(language, words)
          );
        },
      );

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );

  test("chart cards are handed English titles and lines too", () => {
    const lookedUp: Array<string> = [];

    for (const file of sourceFiles(SOURCE)) {
      const code: string = fs.readFileSync(file, "utf8");
      const relative: string = path.relative(SOURCE, file);

      for (const chart of code.match(CHART_CARD_ELEMENT) || []) {
        if (LOOKED_UP_PROP.test(chart)) {
          lookedUp.push(`${relative}: ${chart.slice(0, 80)}`);
        }
      }

      if (code.includes("<ChartCard") && LOOKED_UP_SERIES_NAME.test(code)) {
        lookedUp.push(`${relative}: seriesName looked up`);
      }
    }

    expect(lookedUp).toEqual([]);
  });
});

describe("a golden metric tile", () => {
  test("in English reads its title and line as written, and says no language", () => {
    renderTile("en", { title: "Capacity Used", sublabel: "monitor daemons" });

    expect(titleElement()).toHaveTextContent("Capacity Used");
    expect(titleElement()).not.toHaveAttribute("lang");
    expect(screen.getByTestId("golden-metric-tile-sublabel")).toHaveTextContent(
      "monitor daemons",
    );
    expect(
      screen.getByTestId("golden-metric-tile-sublabel"),
    ).not.toHaveAttribute("lang");
  });

  test.each(LANGUAGES)(
    "%s: draws every title the pages hand it as the locale words it, saying its language",
    (language: string) => {
      const { titles } = handedWords();

      for (const english of titles) {
        renderTile(language, { title: english });

        const isWorded: boolean = drawn(language, english) !== english;

        expect({
          english,
          text: titleElement().textContent,
          lang: titleElement().getAttribute("lang"),
        }).toEqual({
          english,
          text: drawn(language, english),
          lang: isWorded ? language : null,
        });

        cleanup();
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: draws the line under the value as the locale words it",
    (language: string) => {
      renderTile(language, {
        title: "Mons In Quorum",
        sublabel: "monitor daemons",
      });

      const line: HTMLElement = screen.getByTestId(
        "golden-metric-tile-sublabel",
      );

      expect(line).toHaveTextContent(drawn(language, "monitor daemons"));
      expect(line.getAttribute("lang")).toBe(
        drawn(language, "monitor daemons") !== "monitor daemons"
          ? language
          : null,
      );
    },
  );

  test("a line the page worded itself reads as given, and says no language", () => {
    renderTile("de", { sublabel: "3 in" });

    expect(screen.getByTestId("golden-metric-tile-sublabel")).toHaveTextContent(
      "3 in",
    );
    expect(
      screen.getByTestId("golden-metric-tile-sublabel"),
    ).not.toHaveAttribute("lang");
  });

  test("a line as the resource wrote it is never looked up, though the locale has words for it", () => {
    // "Memory" is a Dashboard key German words: a mount named so is a value.
    expect(drawn("de", "Memory")).not.toBe("Memory");

    renderTile("de", { sublabel: "Memory", isSublabelAsWritten: true });

    const line: HTMLElement = screen.getByTestId("golden-metric-tile-sublabel");

    expect(line).toHaveTextContent("Memory");
    expect(line).not.toHaveAttribute("lang");
    expect(within(line).getByText("Memory").closest("bdi")).not.toBeNull();
  });

  test("a name the locale has no words for reads as given", () => {
    renderTile("fr", { title: "checkout-db p99 (custom)" });

    expect(titleElement()).toHaveTextContent("checkout-db p99 (custom)");
    expect(titleElement()).not.toHaveAttribute("lang");
  });

  /*
   * A Persian page drew a size's figure after its unit, "GiB ۲۵", the
   * unit's Latin letters and the Persian digits laid out right to left
   * (issue #7106): the value is an isolate of its own, as the hosts list
   * and the Filesystems table set theirs apart.
   */
  test("its value is set apart: a size reads number first on a Persian page", () => {
    renderTile("fa", { value: "۲۵ GiB" });

    const value: HTMLElement = screen.getByTestId("golden-metric-tile-value");

    expect(value).toHaveTextContent("۲۵ GiB");
    expect(value.querySelector("bdi")?.textContent).toBe("۲۵ GiB");
  });

  test.each(LANGUAGES)(
    "%s: the (i) beside the title names the title in the same words",
    (language: string) => {
      renderTile(language, { title: "Capacity Used" });

      /*
       * As the (i) fills it (InfoTooltip): the title a term of the sentence,
       * so a Chinese or Japanese sentence keeps no space where the title and
       * its words meet in their own script, "使用容量について" (#7864).
       */
      const name: string = dashboardTranslator(language).translateTemplate(
        "About {{label}}",
        { label: translatableTerm("Capacity Used") },
      );

      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    },
  );

  test("a translated title breaks its long words where its language hyphenates them; English never", () => {
    renderTile("de", { title: "Unhealthy Hardware" });

    const german: string = drawn("de", "Unhealthy Hardware");

    expect(titleElement().className).toContain(
      getTileTitleWordsClassName({ text: german, lang: "de" }),
    );

    const longWords: Array<string> = german
      .split(" ")
      .filter((word: string): boolean => {
        return word.length >= 10;
      });

    /*
     * Each long word is a span of its own: hyphenated in its language, and
     * a box no wider than its line, so it moves whole to the next line when
     * it fits one (TILE_TITLE_LONG_WORDS).
     */
    if (longWords.length > 0 && longWords.length < german.split(" ").length) {
      expect(
        titleElement().querySelector(
          `span[class="${TILE_TITLE_LONG_WORDS.longWordClassName}"]`,
        ),
      ).not.toBeNull();
    }

    cleanup();

    renderTile("en", { title: "Unhealthy Hardware" });

    expect(titleElement().className).not.toContain("hyphens-auto");
    // No word in a box of its own: the only box is the (i)'s glue.
    expect(
      Array.from(titleElement().querySelectorAll("span")).map(
        (span: Element): boolean => {
          return span.hasAttribute("data-info-glue");
        },
      ),
    ).toEqual([true]);
  });

  test("the icon keeps its size beside a long title", () => {
    renderTile("de", { title: "Node Availability" });

    const icon: Element | null = document.querySelector(
      "div.h-7.w-7",
    ) as Element | null;

    expect(icon?.className).toContain("flex-shrink-0");
  });
});

/*
 * A chart whose lines a page names with English words of its own ("State",
 * "Total Cost", "Calls", "Read") hands them to the chart in the reader's
 * words - through ChartCard, which translates them, or through
 * withTranslatedSeriesNames - and each of those words is worded in every
 * language. A series named by data (a service, a host) is never a literal.
 */
describe("charts whose lines the page names", () => {
  const LITERAL_SERIES_NAME: RegExp = /seriesName: "([^"]+)"/g;
  const TRANSLATES_ITS_SERIES: RegExp =
    /withTranslatedSeriesNames\(|<ChartCard\b|translateText\(item\.seriesName\)/;

  function filesNamingSeries(): Array<{ file: string; names: Array<string> }> {
    const found: Array<{ file: string; names: Array<string> }> = [];

    for (const file of sourceFiles(SOURCE)) {
      const code: string = fs.readFileSync(file, "utf8");
      const names: Array<string> = Array.from(
        code.matchAll(LITERAL_SERIES_NAME),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      if (names.length > 0) {
        found.push({
          file: path.relative(SOURCE, file).split(path.sep).join("/"),
          names,
        });
      }
    }

    return found;
  }

  test("hand their charts the lines' names in the reader's words", () => {
    const files: Array<{ file: string; names: Array<string> }> =
      filesNamingSeries();

    expect(files.length).toBeGreaterThan(15);

    const untranslated: Array<string> = files
      .filter((entry: { file: string }): boolean => {
        return !TRANSLATES_ITS_SERIES.test(
          fs.readFileSync(path.join(SOURCE, entry.file), "utf8"),
        );
      })
      .map((entry: { file: string }): string => {
        return entry.file;
      });

    expect(untranslated).toEqual([]);
  });

  test.each(LANGUAGES)(
    "%s words every line a page names in English",
    (language: string) => {
      const english: Array<string> = Array.from(
        new Set<string>(
          filesNamingSeries().flatMap(
            (entry: { names: Array<string> }): Array<string> => {
              return entry.names;
            },
          ),
        ),
      ).filter((words: string): boolean => {
        return (
          drawn(language, words) === words && !isKeptAsWritten(language, words)
        );
      });

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );
});

describe("a chart card's lines", () => {
  const WINDOW_START: Date = new Date("2026-11-03T10:00:00.000Z");
  const WINDOW_END: Date = new Date("2026-11-03T11:00:00.000Z");

  function series(...names: Array<string>): Array<SeriesPoint> {
    return names.map((name: string): SeriesPoint => {
      return { seriesName: name, data: [{ x: WINDOW_START, y: 1 }] };
    });
  }

  function renderChart(language: string, names: Array<string>): void {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <ChartCard
          title="Page loads"
          icon={IconProp.Globe}
          iconColor="blue"
          series={series(...names)}
          windowStart={WINDOW_START}
          windowEnd={WINDOW_END}
          syncId="series-names"
          showLegend={true}
        />
      </I18nextProvider>,
    );
  }

  // The lines the overviews hand their chart cards, in the product's words.
  const PRODUCT_LINES: ReadonlyArray<string> = [
    "Page loads",
    "Failed",
    "Requests",
    "Errors",
    "Received",
    "Sent",
    "Slowest disk",
    "Log lines",
  ];

  test("in English are named as written", () => {
    renderChart("en", [...PRODUCT_LINES]);

    expect(drawnSeries[drawnSeries.length - 1]).toEqual([...PRODUCT_LINES]);
  });

  test.each(LANGUAGES)(
    "%s: are named as the locale words them, and a line named by data as given",
    (language: string) => {
      renderChart(language, [...PRODUCT_LINES, "checkout-api"]);

      expect(drawnSeries[drawnSeries.length - 1]).toEqual([
        ...PRODUCT_LINES.map((english: string): string => {
          return drawn(language, english);
        }),
        "checkout-api",
      ]);
    },
  );

  test.each(LANGUAGES)(
    "%s: words every line the overviews hand a chart card",
    (language: string) => {
      const english: Array<string> = PRODUCT_LINES.filter(
        (words: string): boolean => {
          return (
            drawn(language, words) === words &&
            !isKeptAsWritten(language, words)
          );
        },
      );

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );

  test("the same series, drawn twice, are handed to the chart as the same array", () => {
    const points: Array<SeriesPoint> = series("Requests", "Errors");
    const { rerender } = render(
      <I18nextProvider i18n={instances["de"]!}>
        <ChartCard
          title="Requests"
          icon={IconProp.Globe}
          iconColor="blue"
          series={points}
          windowStart={WINDOW_START}
          windowEnd={WINDOW_END}
          syncId="same-series"
        />
      </I18nextProvider>,
    );

    rerender(
      <I18nextProvider i18n={instances["de"]!}>
        <ChartCard
          title="Requests"
          icon={IconProp.Globe}
          iconColor="blue"
          series={points}
          windowStart={WINDOW_START}
          windowEnd={WINDOW_END}
          syncId="same-series"
        />
      </I18nextProvider>,
    );

    expect(drawnData.length).toBeGreaterThanOrEqual(2);
    // The chart recomputes its points whenever its data changes identity.
    expect(drawnData[drawnData.length - 1]).toBe(
      drawnData[drawnData.length - 2],
    );
    expect(drawnSeries[drawnSeries.length - 1]).toEqual([
      drawn("de", "Requests"),
      drawn("de", "Errors"),
    ]);
  });
});
