import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { StyleRule, THEME_RULES } from "./ThemeStylesheet";

/*
 * A spinner's arc in the dark theme.
 *
 * A spinner is a ring whose top border has a colour of its own: a light
 * track ("border-indigo-200") and a strong arc ("border-t-indigo-600"),
 * turning. Theme.css re-colours the track's class for the dark theme with
 * `border-color`, which paints all four sides - and, being the more
 * specific rule, it painted the arc too. The ring was then one colour all
 * round, and a ring that is one colour all round does not look like it
 * turns: Code's "Working" mark, its live steps and its pickers' loading
 * looked stopped in the dark theme, and so did every other spinner drawn
 * that way. Theme.css now gives each such arc its colour back, last in the
 * sheet so it wins. This holds every arc drawn over a re-coloured track,
 * in Common's components and every app's own, to such a rule.
 */

const REPOSITORY_PACKAGES: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
);

// Where class names are written: Common's components and each app's own.
const SOURCE_ROOTS: Array<string> = [
  path.join(REPOSITORY_PACKAGES, "Common", "UI"),
  path.join(REPOSITORY_PACKAGES, "App", "FeatureSet"),
];

const SOURCE_FILE: RegExp = /\.tsx?$/;
const SKIPPED_DIRECTORIES: Array<string> = ["node_modules", "build", "dist"];

// An arc's own colour: border-t-indigo-600, with no variant before it.
const ARC_TOKEN: RegExp =
  /(?<![\w:/-])border-t-(?:gray|slate|indigo|blue|sky|violet|purple|emerald|green|amber|yellow|orange|red|rose)-\d{2,3}(?![\w/-])/g;

// A track's colour, as Theme.css re-colours it: border-gray-200.
const TRACK_TOKEN: RegExp =
  /(?<![\w:/-])border-(?:gray|slate|indigo|blue|sky|violet|purple|emerald|green|amber|yellow|orange|red|rose)-\d{2,3}(?![\w/-])/g;

const QUOTES: Array<string> = ['"', "'", "`"];
const IDENTIFIER_CHAR: RegExp = /[\w-]/;

function listSources(root: string): Array<string> {
  const files: Array<string> = [];
  const pending: Array<string> = [root];

  while (pending.length > 0) {
    const directory: string = pending.pop()!;

    if (!fs.existsSync(directory)) {
      continue;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
          pending.push(path.join(directory, entry.name));
        }
      } else if (SOURCE_FILE.test(entry.name)) {
        files.push(path.join(directory, entry.name));
      }
    }
  }

  return files;
}

// The class string a token sits in: from the quote before it to the one after.
function enclosingString(code: string, at: number): string {
  let start: number = -1;

  for (const quote of QUOTES) {
    start = Math.max(start, code.lastIndexOf(quote, at));
  }

  let end: number = code.length;

  for (const quote of QUOTES) {
    const next: number = code.indexOf(quote, at);

    if (next !== -1) {
      end = Math.min(end, next);
    }
  }

  return code.slice(start + 1, end);
}

// Whether a selector names the class itself, not a longer one it starts.
function selectorNamesClass(selector: string, className: string): boolean {
  const needle: string = `.${className}`;
  let from: number = selector.indexOf(needle);

  while (from !== -1) {
    const next: string = selector[from + needle.length] || " ";

    if (!IDENTIFIER_CHAR.test(next) && next !== "\\") {
      return true;
    }

    from = selector.indexOf(needle, from + 1);
  }

  return false;
}

/*
 * The dark theme's rules that re-colour a track's whole border. The sheet's
 * reader splits a prelude at every comma, :is() lists' too, so a rule is
 * the dark theme's when any piece of it starts there.
 */
function trackRemaps(track: string): Array<StyleRule> {
  return THEME_RULES.filter((rule: StyleRule): boolean => {
    return (
      rule.declarations["border-color"] !== undefined &&
      rule.selectors.some((selector: string): boolean => {
        return selector.startsWith("html.dark");
      }) &&
      rule.selectors.some((selector: string): boolean => {
        return selectorNamesClass(selector, track);
      })
    );
  });
}

// The dark theme's rule that gives an arc its own colour back.
function arcRule(arc: string): StyleRule | undefined {
  return THEME_RULES.find((rule: StyleRule): boolean => {
    return (
      rule.selectors.includes(`html.dark .${arc}`) &&
      rule.declarations["border-top-color"] !== undefined
    );
  });
}

interface ArcOverTrack {
  file: string;
  arc: string;
  track: string;
}

function findArcsOverRemappedTracks(): Array<ArcOverTrack> {
  const found: Array<ArcOverTrack> = [];

  for (const root of SOURCE_ROOTS) {
    for (const file of listSources(root)) {
      const code: string = fs.readFileSync(file, "utf8");

      for (const match of code.matchAll(ARC_TOKEN)) {
        const classes: string = enclosingString(code, match.index || 0);

        for (const track of classes.match(TRACK_TOKEN) || []) {
          if (trackRemaps(track).length > 0) {
            found.push({
              file: path.relative(REPOSITORY_PACKAGES, file),
              arc: match[0],
              track,
            });
          }
        }
      }
    }
  }

  return found;
}

const ARCS: Array<ArcOverTrack> = findArcsOverRemappedTracks();

describe("a spinner's arc in the dark theme", () => {
  test("the scan finds the spinners drawn over a re-coloured track, Code's among them", () => {
    expect(ARCS.length).toBeGreaterThan(5);
    expect(
      ARCS.some((arc: ArcOverTrack): boolean => {
        return (
          arc.file.endsWith("CodeTaskStateMark.tsx") &&
          arc.arc === "border-t-indigo-600" &&
          arc.track === "border-indigo-200"
        );
      }),
    ).toBe(true);
  });

  test("every such arc keeps a colour of its own, over every remap of its track", () => {
    const failures: Array<string> = [];

    for (const found of ARCS) {
      const rule: StyleRule | undefined = arcRule(found.arc);

      if (!rule) {
        failures.push(`${found.file}: ${found.arc} has no dark rule`);
        continue;
      }

      // The remaps carry !important at times: the arc's rule must too.
      if (!rule.declarations["border-top-color"]!.includes("!important")) {
        failures.push(`${found.file}: ${found.arc} is not !important`);
      }

      // Equal specificity: the later rule wins, so the arc's comes last.
      for (const remap of trackRemaps(found.track)) {
        if (remap.index > rule.index) {
          failures.push(
            `${found.file}: ${found.arc} comes before a remap of ${found.track}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test("the arc stands apart from its track: a lighter indigo, and a light grey", () => {
    const indigo: StyleRule | undefined = arcRule("border-t-indigo-600");
    const grey: StyleRule | undefined = arcRule("border-t-gray-500");

    expect(indigo?.declarations["border-top-color"]).toBe("#a5b4fc !important");
    expect(grey?.declarations["border-top-color"]).toBe(
      "var(--ou-text-muted) !important",
    );
  });

  test("the guard reads a class string, not its neighbours", () => {
    const code: string =
      'a="border-gray-200 x" b="h-4 border-indigo-200 border-t-indigo-600 animate-spin"';
    const at: number = code.indexOf("border-t-indigo-600");

    expect(enclosingString(code, at)).toBe(
      "h-4 border-indigo-200 border-t-indigo-600 animate-spin",
    );
    expect(
      selectorNamesClass("html.dark .border-gray-200", "border-gray-200"),
    ).toBe(true);
    expect(
      selectorNamesClass("html.dark .border-gray-2000", "border-gray-200"),
    ).toBe(false);
  });
});
