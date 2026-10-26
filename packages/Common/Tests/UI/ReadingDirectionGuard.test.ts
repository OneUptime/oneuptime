import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots, listSourceFiles } from "../ForeignHiddenRuleGuard";

/*
 * KEEPING RIGHT TO LEFT RIGHT.
 *
 * A Persian page is served <html dir="rtl"> and every left and right
 * utility then means the start and the end of the line
 * (Common/UI/Styles/TailwindReadingDirection.js). Three things that
 * mechanism cannot see are guarded here:
 *
 * - An inline style is not a utility: style={{ marginLeft }} stays on the
 *   left of a Persian page, on the wrong side of what it spaces. Inline
 *   spacing and edges use their logical twins (marginInlineStart,
 *   paddingInlineEnd, borderInlineStart, ...). The few left on purpose are
 *   listed below with why, and the list only shrinks.
 * - A time chart reads left to right in every language: the oldest moment
 *   at the left, as along every axis. Each one keeps dir="ltr".
 * - An <Icon> that points along the line turns round by itself (Icon's
 *   ICONS_POINTING_ALONG_THE_LINE): turning it by hand as well turns it
 *   back.
 * - A browser suite's offline fixture that can lay a page out right to left
 *   loads the reading-direction script after the Tailwind runtime, as every
 *   index.ejs does, or it measures a page production never draws.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function read(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

let cachedComponentFiles: Array<string> | null = null;

// Every component the frontends draw with (.tsx), as repository paths.
function componentFiles(): Array<string> {
  if (!cachedComponentFiles) {
    cachedComponentFiles = listScanRoots(REPOSITORY_ROOT)
      .flatMap(listSourceFiles)
      .filter((file: string): boolean => {
        return file.endsWith(".tsx");
      })
      .map(relative)
      .sort();
  }

  return cachedComponentFiles;
}

/*
 * An inline style's physical side: marginLeft: ..., paddingRight: ...,
 * borderLeft: ... - not a variable of that name (const marginLeft: number).
 */
const PHYSICAL_INLINE_SIDE_REGEX: RegExp =
  /(?<!(?:const|let|var)\s+)\b(?:margin|padding|border)(?:Left|Right)\s*:/g;

const countPhysicalInlineSides: (source: string) => number = (
  source: string,
): number => {
  return (source.match(PHYSICAL_INLINE_SIDE_REGEX) || []).length;
};

interface KeptPhysicalSides {
  count: number;
  reason: string;
}

const KEPT_PHYSICAL_SIDES: Record<string, KeptPhysicalSides> = {
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineBar.tsx":
    {
      count: 4,
      reason:
        "A shift's bar on the schedule's time grid, which reads left to right in every language (TimelineGrid's dir=ltr).",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceWaterfall.tsx":
    {
      count: 1,
      reason:
        "A span's indent in the waterfall, which reads left to right in every language.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/TraceWaterfallWidget.tsx":
    {
      count: 1,
      reason:
        "A span's indent in the chat's waterfall, which reads left to right in every language.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/TraceExplorer.tsx": {
    count: 2,
    reason:
      "The waterfall's loading placeholder, staggered from the left as the waterfall it stands in for.",
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent.tsx":
    {
      count: 2,
      reason:
        "A widget's resize handles, named by compass point (east, west) on a grid laid out from the left.",
    },
  "packages/Common/UI/Components/Charts/ChartLibrary/LineChart/LineChart.tsx": {
    count: 1,
    reason:
      "The legend steps past the value axis, which the chart draws at the left in every language.",
  },
  "packages/Common/UI/Components/Charts/ChartLibrary/BarChart/BarChart.tsx": {
    count: 1,
    reason:
      "The legend steps past the value axis, which the chart draws at the left in every language.",
  },
  "packages/Common/UI/Components/Charts/ChartLibrary/AreaChart/AreaChart.tsx": {
    count: 1,
    reason:
      "The legend steps past the value axis, which the chart draws at the left in every language.",
  },
  "packages/Common/UI/Components/EventHistoryList/EventHistoryDayList.tsx": {
    count: 2,
    reason: "The same on both sides (-10px each), so either way is one.",
  },
  "packages/Common/UI/Components/Dropdown/Dropdown.tsx": {
    count: 2,
    reason: "The same on both sides (4px each), so either way is one.",
  },
};

describe("inline styles space things on the side the line reads from", () => {
  test("PHYSICAL_INLINE_SIDE_REGEX finds a style's side and not a variable", () => {
    expect(countPhysicalInlineSides('style={{ marginLeft: "4px" }}')).toBe(1);
    expect(
      countPhysicalInlineSides("{ paddingRight: 8, borderLeft: `3px` }"),
    ).toBe(2);
    expect(countPhysicalInlineSides("const marginLeft: number = 4;")).toBe(0);
    expect(countPhysicalInlineSides("let paddingLeft: number = 0;")).toBe(0);
    expect(countPhysicalInlineSides('{ marginInlineStart: "4px" }')).toBe(0);
    expect(countPhysicalInlineSides("{ borderLeftColor: color }")).toBe(0);
  });

  test("no component sets a left or right margin, padding or edge inline but the ones kept on purpose", () => {
    const found: Record<string, number> = {};

    for (const file of componentFiles()) {
      const count: number = countPhysicalInlineSides(read(file));

      if (count > 0) {
        found[file] = count;
      }
    }

    const unexpected: Array<string> = Object.keys(found)
      .filter((file: string): boolean => {
        return found[file]! > (KEPT_PHYSICAL_SIDES[file]?.count || 0);
      })
      .map((file: string): string => {
        return `${file}: ${found[file]} (marginLeft -> marginInlineStart, paddingRight -> paddingInlineEnd, borderLeft -> borderInlineStart)`;
      });

    expect(unexpected).toEqual([]);
  });

  test("the list of kept ones only shrinks", () => {
    const stale: Array<string> = Object.keys(KEPT_PHYSICAL_SIDES)
      .filter((file: string): boolean => {
        const kept: number = KEPT_PHYSICAL_SIDES[file]!.count;
        const exists: boolean = fs.existsSync(path.join(REPOSITORY_ROOT, file));

        return !exists || countPhysicalInlineSides(read(file)) < kept;
      })
      .map((file: string): string => {
        return `${file}: lower its count, or drop it`;
      });

    expect(stale).toEqual([]);
  });

  test("every kept one says why", () => {
    for (const kept of Object.values(KEPT_PHYSICAL_SIDES)) {
      expect(kept.reason.length).toBeGreaterThan(20);
    }
  });
});

/*
 * The time charts: what each draws from the left, oldest first. A new one
 * belongs here.
 */
const TIME_CHARTS: Record<string, string> = {
  "packages/Common/UI/Components/Graphs/DayUptimeGraph.tsx":
    "The day-by-day uptime strip.",
  "packages/Common/UI/Components/StatusTimeline/StatusTimelineBand.tsx":
    "The status timeline's band and its start and now labels.",
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorUptimeHistoryCard.tsx":
    "A monitor's uptime history strip.",
  "packages/App/FeatureSet/StatusPage/src/Components/Monitor/MonitorOverview.tsx":
    "A status page resource's uptime bars and their labels.",
  "packages/App/FeatureSet/StatusPage/src/Pages/Overview/Overview.tsx":
    "The time axis under a status page's uptime bars.",
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceWaterfall.tsx":
    "A trace's span waterfall.",
  "packages/App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/TraceWaterfallWidget.tsx":
    "The chat's trace waterfall.",
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/FlameGraph.tsx":
    "A trace's flame graph.",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineGrid.tsx":
    "An on-call schedule's timeline.",
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimeline.tsx":
    "A session replay's timeline.",
  "packages/App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmReplayBar.tsx":
    "An AI conversation replay's scrubber.",
  "packages/App/FeatureSet/Dashboard/src/Components/Slo/SloBudgetBar.tsx":
    "An SLO's error budget bar.",
};

describe("time charts read left to right in every language", () => {
  test.each(Object.entries(TIME_CHARTS))(
    "%s keeps dir=ltr",
    (file: string, _what: string) => {
      expect(read(file)).toContain('dir="ltr"');
    },
  );

  test("the charts' own axis labels do too (Theme.css)", () => {
    const theme: string = read("packages/Common/UI/Styles/Theme.css");

    expect(theme).toMatch(
      /\.recharts-surface:dir\(rtl\)\s*\{\s*direction:\s*ltr;/,
    );
  });
});

describe("code reads left to right in every language (Theme.css)", () => {
  const theme: () => string = (): string => {
    return read("packages/Common/UI/Styles/Theme.css");
  };

  test("a block of code starts at the left", () => {
    expect(theme()).toMatch(
      /\npre:dir\(rtl\)\s*\{\s*direction:\s*ltr;\s*text-align:\s*left;\s*\}/,
    );
  });

  test("code inside a sentence is an island of its own", () => {
    expect(theme()).toMatch(
      /\n:is\(code, kbd, samp\):dir\(rtl\)\s*\{\s*direction:\s*ltr;\s*unicode-bidi:\s*isolate;\s*\}/,
    );
  });

  test("the rules touch only a page that reads right to left", () => {
    // Everything after the right-to-left heading is scoped to :dir(rtl).
    const section: string = theme().slice(
      theme().indexOf(" * Right to left. A Persian page"),
    );
    const selectors: Array<string> = (
      section.match(/\n([^\s/*][^{\n]*)\{/g) || []
    ).map((selector: string): string => {
      return selector.trim();
    });

    expect(selectors.length).toBeGreaterThanOrEqual(3);

    for (const selector of selectors) {
      expect(selector).toContain(":dir(rtl)");
    }
  });

  test("a stuck table column's shadow falls the other way in the dark too", () => {
    expect(theme()).toContain(
      'html.dark [class~="shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.18)]"]:dir(rtl) {\n  --tw-shadow: 8px 0 12px -10px rgb(0 0 0 / 70%);',
    );
  });
});

/*
 * Each <Icon ...> tag in a source, up to the end of its opening tag: an
 * arrow function's => is not one.
 */
const iconTagsOf: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const tags: Array<string> = [];
  const opening: RegExp = /<Icon\b/g;
  let match: RegExpExecArray | null = opening.exec(source);

  while (match) {
    const end: number = source.indexOf("/>", match.index);
    tags.push(source.slice(match.index, end === -1 ? undefined : end));
    match = opening.exec(source);
  }

  return tags;
};

const HAND_TURNED_REGEX: RegExp =
  /rtl:(?:-?rotate-180|-?scale-x-\S+)|dir\(rtl\)\]:(?:-?rotate-180|\[scale:-1_1\])/;

describe("icons turn round by themselves", () => {
  test("iconTagsOf finds each tag, and HAND_TURNED_REGEX a turn by hand", () => {
    const tags: Array<string> = iconTagsOf(
      '<Icon icon={IconProp.ChevronRight} className="h-4 rtl:rotate-180" onClick={() => {}} /> <Icon icon={IconProp.Check} />',
    );

    expect(tags).toHaveLength(2);
    expect(tags[0]).toMatch(HAND_TURNED_REGEX);
    expect(tags[1]).not.toMatch(HAND_TURNED_REGEX);
    expect('className="[&:dir(rtl)]:[scale:-1_1]"').toMatch(HAND_TURNED_REGEX);
    expect('className="rtl:-translate-x-1/2"').not.toMatch(HAND_TURNED_REGEX);
  });

  test("no <Icon> is also turned by hand for a page that reads right to left", () => {
    const handTurned: Array<string> = [];

    for (const file of componentFiles()) {
      const source: string = read(file);

      if (source.indexOf("<Icon") === -1) {
        continue;
      }

      for (const tag of iconTagsOf(source)) {
        if (HAND_TURNED_REGEX.test(tag)) {
          handTurned.push(`${file}: ${tag.replace(/\s+/g, " ").slice(0, 160)}`);
        }
      }
    }

    // Icon mirrors arrows and chevrons (isMirroredRightToLeft to opt out).
    expect(handTurned).toEqual([]);
  });
});

const E2E_DIRECTORY: string = path.join(REPOSITORY_ROOT, "packages", "E2E");

// Every offline fixture server in packages/E2E, as repository paths.
const fixtureServers: () => Array<string> = (): Array<string> => {
  const found: Array<string> = [];

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
          walk(path.join(directory, entry.name));
        }
      } else if (entry.name === "server.js") {
        found.push(relative(path.join(directory, entry.name)));
      }
    }
  };

  walk(E2E_DIRECTORY);

  return found.sort();
};

/*
 * What a fixture draws its page with: the scripts beside its server, and
 * the page the server writes - not a spec.
 */
const fixtureSourcesOf: (server: string) => Array<string> = (
  server: string,
): Array<string> => {
  const directory: string = path.dirname(path.join(REPOSITORY_ROOT, server));

  return fs
    .readdirSync(directory)
    .filter((name: string): boolean => {
      return /\.(js|jsx|ts|tsx)$/.test(name) && !/\.spec\.ts$/.test(name);
    })
    .map((name: string): string => {
      return relative(path.join(directory, name));
    });
};

/*
 * A page laid out right to left: a frontend's own i18n set-up (it sets
 * <html dir> from the language, Common/UI/Utils/PageLanguage), that helper
 * itself, or a dir set by hand.
 */
const LAYS_OUT_RIGHT_TO_LEFT_REGEX: RegExp =
  /src\/Utils\/i18n["']|UI\/Utils\/PageLanguage["']|documentElement\.dir\s*=|documentElement\.setAttribute\(\s*["']dir["']/;

describe("offline fixtures draw a right-to-left page as production does", () => {
  test("LAYS_OUT_RIGHT_TO_LEFT_REGEX knows each way a fixture does it", () => {
    for (const source of [
      'import "../../App/FeatureSet/StatusPage/src/Utils/i18n";',
      'import i18n from "../../../App/FeatureSet/Accounts/src/Utils/i18n";',
      'import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";',
      'document.documentElement.dir = language === "fa" ? "rtl" : "ltr";',
      'document.documentElement.setAttribute("dir", "rtl");',
    ]) {
      expect(source).toMatch(LAYS_OUT_RIGHT_TO_LEFT_REGEX);
    }

    expect('import i18next from "i18next";').not.toMatch(
      LAYS_OUT_RIGHT_TO_LEFT_REGEX,
    );
  });

  test("every fixture that can lay a page out right to left loads the reading-direction script after the runtime", () => {
    const servers: Array<string> = fixtureServers();
    const rightToLeft: Array<string> = servers.filter((server: string) => {
      return fixtureSourcesOf(server).some((source: string): boolean => {
        return LAYS_OUT_RIGHT_TO_LEFT_REGEX.test(read(source));
      });
    });

    // The reading direction's own suite, and the suites of the pages above.
    expect(rightToLeft).toEqual(
      expect.arrayContaining([
        "packages/E2E/ReadingDirection/Fixture/server.js",
        "packages/E2E/SignInOptions/Fixture/server.js",
      ]),
    );

    /*
     * The page loads the runtime (/tailwind.js, or a build's
     * tailwind-3.4.5.js), then the reading direction's script, and the
     * server serves it: from Common's source, or from the build that copied
     * it beside the runtime (Common/UI/esbuild-config.js).
     */
    const missing: Array<string> = rightToLeft.filter(
      (server: string): boolean => {
        const source: string = read(server);
        const runtime: number = source.search(
          /<script src="[^"]*(?:\/tailwind\.js|tailwind-3\.4\.5\.js)">/,
        );
        const readingDirection: number = source.search(
          /<script src="[^"]*\/tailwind-reading-direction\.js">/,
        );
        const isServed: boolean =
          source.includes("UI/Styles/TailwindReadingDirection.js") ||
          source.includes('"assets/js/tailwind-reading-direction.js"');

        return runtime === -1 || readingDirection < runtime || !isServed;
      },
    );

    expect(missing).toEqual([]);
  });
});
