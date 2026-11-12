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
  UserFlowAnalysis,
  UserFlowNode,
  UserFlowPath,
} from "../../../Utils/Rum/UserFlow";
import { createTranslator, Translator } from "../../../Types/Translator";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import UserFlowOverview from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowOverview";
import UserFlowTables from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowTables";
import UserFlowDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowDetailPanel";
import UserFlowMap from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowMap";
import {
  formatUserFlowShare,
  USER_FLOW_SHARE_UNDER_ONE_PERCENT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowFormat";

/*
 * USER FLOWS' SHARES IN THE READER'S LANGUAGE (#6907).
 *
 * The User Flows page wrote its counts the reader's way and its shares in
 * English: a Persian row read "۱۲" beside "46%", a German one "4.5%" where
 * German writes "4,5 %", and the Top paths' row numbers stayed "1", "2",
 * "3" beside Persian counts. A share is now written as the reader's
 * language writes a percent, and "less than 1%" is said in its words; the
 * row number is written in the digits its counts are. English reads as it
 * always has. Read from the Dashboard's shipped locale files.
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

// Every language the Dashboard ships besides English.
const LOCALES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const FA: Record<string, string> = readLocale("fa");
const FR: Record<string, string> = readLocale("fr");
const AR: Record<string, string> = readLocale("ar");

function translatorFor(language: string): Translator {
  const locale: Record<string, string> = readLocale(language);

  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

const ENGLISH: Translator = translatorFor("en");
const GERMAN: Translator = translatorFor("de");
const PERSIAN: Translator = translatorFor("fa");
const FRENCH: Translator = translatorFor("fr");
const ARABIC: Translator = translatorFor("ar");
const JAPANESE: Translator = translatorFor("ja");

// The space German puts before a percent sign.
const NO_BREAK_SPACE: string = "\u00A0";

const LATIN_DIGIT_PATTERN: RegExp = /[0-9]/;
// Percents written as English writes them: "46%", "4.5%".
const ENGLISH_PERCENT_PATTERN: RegExp = /\d(\.\d)?%/;

function shown(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

const ORIGIN: string = "https://shop.example.com";
const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000002");

/*
 * 200 sessions: 120 from /home to /cart (3 of them with errors), 70 from
 * /home to /pricing, 9 from /blog to /cart and one from /about to /cart -
 * shares of 60%, 35%, 4.5% and 0.5%, which the page writes "<1%".
 */
function buildResponse(): UserFlowJourneysResponseDto {
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
  const groups: Array<{ pages: Array<string>; count: number; errors: number }> =
    [
      { pages: ["/home", "/cart"], count: 120, errors: 3 },
      { pages: ["/home", "/pricing"], count: 70, errors: 0 },
      { pages: ["/blog", "/cart"], count: 9, errors: 0 },
      { pages: ["/about", "/cart"], count: 1, errors: 0 },
    ];
  const sessions: Array<UserFlowSessionDto> = [];

  for (const group of groups) {
    for (let index: number = 0; index < group.count; index++) {
      const position: number = sessions.length;
      const hasError: boolean = index < group.errors;

      sessions.push({
        sessionId: `s${position}`,
        startUnixMs: 1_800_000_000_000 - position * 1000,
        durationMs: 60_000,
        deviceType: "desktop",
        browserName: "Chrome",
        countryCode: "DK",
        errorCount: hasError ? 1 : 0,
        frustrationCount: 0,
        pages: group.pages.map(indexOf),
        pageSignals: hasError ? [[indexOf(group.pages[1]!), 1, 0]] : [],
      });
    }
  }

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

const ANALYSIS: UserFlowAnalysis = analyzeUserFlow(buildResponse());

function renderTables(): void {
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
}

function renderOverview(): void {
  render(
    <UserFlowOverview
      summary={ANALYSIS.summary}
      insights={ANALYSIS.insights}
      sessionsRead={200}
      sessionsInWindow={200}
      isSampled={false}
      onFocusPage={(): void => {
        return;
      }}
    />,
  );
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

function renderDetail(node: UserFlowNode): void {
  render(
    <MemoryRouter>
      <UserFlowDetailPanel
        selection={{ kind: "node", id: node.id }}
        analysis={ANALYSIS}
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

interface PathRow {
  rank: string;
  // The row's sessions and their share, and its share with errors.
  numbers: string;
  text: string;
}

/*
 * The Top paths rows: each row's number, its numbers, and its words. Its
 * average duration ("1m") is #6754's, so it is left out of the numbers.
 */
function pathRows(): Array<PathRow> {
  return screen
    .getAllByTestId("user-flow-path-row")
    .map((row: HTMLElement): PathRow => {
      const cells: Array<HTMLElement> = Array.from(row.querySelectorAll("td"));

      return {
        rank: shown(row.querySelector('[data-testid="user-flow-path-rank"]')!),
        numbers: [cells[2]!, cells[4]!].map(shown).join(" "),
        text: shown(row),
      };
    });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: EN },
      de: { translation: DE },
      fa: { translation: FA },
      fr: { translation: FR },
      ar: { translation: AR },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("a share, written as the reader's language writes a percent", () => {
  test("English reads as it always has, with and without a translator", () => {
    const cases: Array<[number, string]> = [
      [0, "0%"],
      [Number.NaN, "0%"],
      [-0.2, "0%"],
      [0.004, "<1%"],
      [0.0099, "<1%"],
      [0.01, "1%"],
      [0.045, "4.5%"],
      [0.0496, "5.0%"],
      [0.05, "5%"],
      [0.4567, "46%"],
      [1, "100%"],
    ];

    for (const [share, english] of cases) {
      expect({ share, text: formatUserFlowShare(share) }).toEqual({
        share,
        text: english,
      });
      expect({ share, text: formatUserFlowShare(share, ENGLISH) }).toEqual({
        share,
        text: english,
      });
    }
  });

  test("German and French: a decimal comma and a space before the sign", () => {
    expect(formatUserFlowShare(0.4567, GERMAN)).toBe(`46${NO_BREAK_SPACE}%`);
    expect(formatUserFlowShare(0.045, GERMAN)).toBe(`4,5${NO_BREAK_SPACE}%`);
    expect(formatUserFlowShare(0, GERMAN)).toBe(`0${NO_BREAK_SPACE}%`);
    expect(formatUserFlowShare(0.004, GERMAN)).toBe(
      DE[USER_FLOW_SHARE_UNDER_ONE_PERCENT]!.replace(
        "{{percent}}",
        `1${NO_BREAK_SPACE}%`,
      ),
    );
    expect(formatUserFlowShare(0.004, GERMAN)).toBe(`<1${NO_BREAK_SPACE}%`);

    // French's own space before the sign, as Intl writes it.
    expect(formatUserFlowShare(0.045, FRENCH)).toBe(
      new Intl.NumberFormat("fr", {
        style: "percent",
        minimumFractionDigits: 1,
      }).format(0.045),
    );
    expect(formatUserFlowShare(0.045, FRENCH)).toMatch(/^4,5\s%$/);
  });

  test("Persian: its own digits and percent sign, and 'less than' in its words", () => {
    expect(formatUserFlowShare(0.4567, PERSIAN)).toBe("۴۶٪");
    expect(formatUserFlowShare(0.045, PERSIAN)).toBe("۴٫۵٪");
    expect(formatUserFlowShare(0, PERSIAN)).toBe("۰٪");
    expect(withoutIsolateMarks(formatUserFlowShare(0.004, PERSIAN))).toBe(
      FA[USER_FLOW_SHARE_UNDER_ONE_PERCENT]!.replace("{{percent}}", "۱٪"),
    );
    // Not a "<", which a line read from the right draws mirrored.
    expect(formatUserFlowShare(0.004, PERSIAN)).not.toContain("<");
  });

  test("Arabic: Latin digits, as the product writes Arabic's numbers, and 'less than' in its words", () => {
    expect(formatUserFlowShare(0.4567, ARABIC)).toContain("46");
    expect(formatUserFlowShare(0.4567, ARABIC)).not.toMatch(/[٠-٩]/);
    expect(formatUserFlowShare(0.004, ARABIC)).toContain(
      AR[USER_FLOW_SHARE_UNDER_ONE_PERCENT]!.replace("{{percent}}", "").trim(),
    );
    expect(formatUserFlowShare(0.004, ARABIC)).not.toContain("<");
  });

  test("Japanese says 'under 1%' its own way", () => {
    expect(withoutIsolateMarks(formatUserFlowShare(0.004, JAPANESE))).toBe(
      "1%未満",
    );
  });

  test("a language with no words of its own for it writes the sign", () => {
    const bare: Translator = createTranslator(undefined, "de");

    expect(formatUserFlowShare(0.004, bare)).toBe(`<1${NO_BREAK_SPACE}%`);
  });

  test.each(LOCALES)(
    "%s: 'less than' a percent is worded around the percent",
    (locale: string) => {
      const value: string | undefined =
        readLocale(locale)[USER_FLOW_SHARE_UNDER_ONE_PERCENT];

      expect(value).toBeDefined();
      expect(value).toContain("{{percent}}");
      expect(value).not.toBe(EN[USER_FLOW_SHARE_UNDER_ONE_PERCENT]);
      // Words where a line is read from the right, never a mirrored sign.
      if (["ar", "fa"].includes(locale)) {
        expect(value).not.toContain("<");
      }
    },
  );
});

describe("the User Flows page, in the reader's language", () => {
  test("the fixture's shares: 60%, 35%, 4.5% and under 1%", () => {
    const shares: Array<number> = ANALYSIS.paths.map(
      (candidate: UserFlowPath): number => {
        return candidate.share;
      },
    );

    expect(shares).toEqual([0.6, 0.35, 0.045, 0.005]);
  });

  test("English: the Top paths read as they always have", () => {
    renderTables();

    const rows: Array<PathRow> = pathRows();

    expect(
      rows.map((row: PathRow): string => {
        return row.rank;
      }),
    ).toEqual(["1", "2", "3", "4"]);
    expect(rows[0]!.text).toContain("60%");
    // 3 of 120 with errors.
    expect(rows[0]!.text).toContain("2.5%");
    expect(rows[2]!.text).toContain("4.5%");
    expect(rows[3]!.text).toContain("<1%");
  });

  test("Persian: the Top paths' numbers, shares and row numbers in Persian digits", async () => {
    await i18next.changeLanguage("fa");
    renderTables();

    const rows: Array<PathRow> = pathRows();

    expect(
      rows.map((row: PathRow): string => {
        return row.rank;
      }),
    ).toEqual(["۱", "۲", "۳", "۴"]);
    expect(rows[0]!.text).toContain("۱۲۰");
    expect(rows[0]!.text).toContain("۶۰٪");
    expect(rows[0]!.text).toContain("۲٫۵٪");
    expect(rows[2]!.text).toContain("۴٫۵٪");
    expect(rows[3]!.text).toContain(
      FA[USER_FLOW_SHARE_UNDER_ONE_PERCENT]!.replace("{{percent}}", "۱٪"),
    );

    // Not one Latin digit among a row's counts and shares.
    for (const row of rows) {
      expect(row.numbers).not.toMatch(LATIN_DIGIT_PATTERN);
      expect(row.text).not.toMatch(ENGLISH_PERCENT_PATTERN);
    }
  });

  test("German: the Top paths and the Pages tab write German percents", async () => {
    await i18next.changeLanguage("de");
    renderTables();

    const rows: Array<PathRow> = pathRows();

    expect(rows[2]!.text).toContain(`4,5${NO_BREAK_SPACE}%`);
    expect(rows[0]!.text).toContain(`2,5${NO_BREAK_SPACE}%`);
    for (const row of rows) {
      expect(row.text).not.toMatch(ENGLISH_PERCENT_PATTERN);
    }

    fireEvent.click(screen.getByTestId("user-flow-tab-pages"));

    const pages: string = shown(screen.getByTestId("user-flow-pages-table"));

    expect(pages).toContain(`${NO_BREAK_SPACE}%`);
    expect(pages).not.toMatch(ENGLISH_PERCENT_PATTERN);
  });

  /*
   * The tiles: the single-page share, and the landing and exit pages'
   * shares under them. The insights below are #6754's.
   */
  test("Persian: the overview's tiles write their shares in Persian digits", async () => {
    await i18next.changeLanguage("fa");
    renderOverview();

    const tile: (id: string) => string = (id: string): string => {
      return shown(screen.getByTestId(id));
    };

    expect(tile("user-flow-tile-bounce-value")).toBe("۰٪");
    // 190 of 200 sessions landed on /home; 130 left from /cart.
    expect(tile("user-flow-tile-entry-hint")).toContain("۹۵٪");
    expect(tile("user-flow-tile-exit-hint")).toContain("۶۵٪");
    for (const id of [
      "user-flow-tile-bounce",
      "user-flow-tile-entry-hint",
      "user-flow-tile-exit-hint",
    ]) {
      expect(tile(id)).not.toMatch(LATIN_DIGIT_PATTERN);
    }
  });

  test("German and English: the overview's tiles", async () => {
    renderOverview();

    expect(shown(screen.getByTestId("user-flow-tile-entry-hint"))).toContain(
      "95%",
    );

    cleanup();
    await i18next.changeLanguage("de");
    renderOverview();

    expect(shown(screen.getByTestId("user-flow-tile-entry-hint"))).toContain(
      `95${NO_BREAK_SPACE}%`,
    );
    expect(shown(screen.getByTestId("user-flow-tile-bounce-value"))).toBe(
      `0${NO_BREAK_SPACE}%`,
    );
  });

  test("German: the map's boxes and the page panel write German percents", async () => {
    await i18next.changeLanguage("de");
    renderMap();

    const map: string = shown(screen.getByTestId("user-flow-map"));

    expect(map).toContain(`${NO_BREAK_SPACE}%`);
    expect(map).not.toMatch(ENGLISH_PERCENT_PATTERN);

    cleanup();
    renderDetail(nodeAt(1, "/cart"));

    const detail: string = shown(screen.getByTestId("user-flow-detail"));

    expect(detail).toContain(`${NO_BREAK_SPACE}%`);
    expect(detail).not.toMatch(ENGLISH_PERCENT_PATTERN);
  });

  test("Persian: the page panel's shares in Persian digits", async () => {
    await i18next.changeLanguage("fa");
    renderDetail(nodeAt(0, "/home"));

    const detail: string = shown(screen.getByTestId("user-flow-detail"));

    expect(detail).toContain("٪");
    expect(detail).not.toMatch(ENGLISH_PERCENT_PATTERN);
  });
});
