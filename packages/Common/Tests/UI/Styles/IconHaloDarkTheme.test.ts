import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { declaredValue } from "./ThemeStylesheet";

/*
 * The soft halo round an icon's circle in the dark theme (Theme.css): a
 * ring of the -50 shade round a -100 circle - the sign-in pages' email
 * verified, link expired and link refused screens and the check-your-inbox
 * screen after signing up, an empty notes list, the exceptions banner - and
 * a status timeline's chosen dot.
 *
 * On the light page the halo is a breath of the circle's own hue on white.
 * The dark theme drew every one of them as the same indigo ring at 35%: a
 * border of another colour round a green tick, an amber clock and a red
 * cross, heavier than the circle it framed. Each hue now keeps its own, as
 * faint on the dark card as the light one is on white - and a halo the
 * product draws with no rule at all (ring-emerald-50/40) stayed the light
 * shade, a pale ring on the dark page.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..", "..");

// The ring colour each -50 halo is drawn in on a dark page.
const DARK_HALOS: Array<[string, string]> = [
  ["ring-indigo-50", "rgb(129 140 248 / 12%)"],
  ["ring-red-50", "rgb(248 113 113 / 10%)"],
  ["ring-rose-50", "rgb(248 113 113 / 10%)"],
  ["ring-rose-50/50", "rgb(248 113 113 / 10%)"],
  ["ring-amber-50", "rgb(251 191 36 / 10%)"],
  ["ring-yellow-50", "rgb(251 191 36 / 10%)"],
  ["ring-amber-50/50", "rgb(251 191 36 / 10%)"],
  ["ring-green-50", "rgb(52 211 153 / 10%)"],
  ["ring-emerald-50", "rgb(52 211 153 / 10%)"],
  ["ring-emerald-50/40", "rgb(52 211 153 / 10%)"],
  ["ring-blue-50", "rgb(96 165 250 / 10%)"],
  ["ring-sky-50", "rgb(96 165 250 / 10%)"],
  ["ring-sky-50/50", "rgb(96 165 250 / 10%)"],
  ["ring-violet-50", "rgb(167 139 250 / 10%)"],
];

// The family a hue's halo belongs to: its hue, or the one it shares.
const HUE_FAMILY: Record<string, string> = {
  indigo: "indigo",
  red: "red",
  rose: "red",
  amber: "amber",
  yellow: "amber",
  green: "green",
  emerald: "green",
  blue: "blue",
  sky: "blue",
  violet: "violet",
};

// How Theme.css names a class: a plain one by itself, one with a slash by attribute.
const selectorFor: (token: string) => string = (token: string): string => {
  return token.includes("/")
    ? `html.dark [class~="${token}"]`
    : `html.dark .${token}`;
};

const hueOf: (token: string) => string = (token: string): string => {
  return token.split("-")[1] as string;
};

/*
 * The apps that draw with Theme.css, and the code a halo can be written in:
 * Common's components and each app's own pages.
 */
const SOURCE_ROOTS: Array<string> = [
  path.join(PACKAGES, "Common", "UI"),
  path.join(PACKAGES, "App", "FeatureSet", "Dashboard", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "AdminDashboard", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "Accounts", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "StatusPage", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "PublicDashboard", "src"),
];

const SOURCE_FILE: RegExp = /\.tsx?$/;

/*
 * A halo class on its own - not a variant such as focus-within:ring-indigo-50,
 * which is a focus ring and has rules of its own.
 */
const HALO_TOKEN: RegExp =
  /(?<![\w:/-])ring-([a-z]+)-50(?:\/\d{1,3})?(?![\w/-])/g;

const sourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...sourceFiles(full));
      }

      continue;
    }

    if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

describe("an icon's halo in the dark theme", () => {
  test.each(DARK_HALOS)(
    "%s is a faint ring of its own hue",
    (token: string, colour: string) => {
      expect(declaredValue(selectorFor(token), "--tw-ring-color")).toBe(colour);
    },
  );

  test("each family of hues keeps its own colour: no halo is another hue's", () => {
    const colourOfFamily: Map<string, string> = new Map();

    for (const [token, colour] of DARK_HALOS) {
      const family: string = HUE_FAMILY[hueOf(token)] as string;

      expect(family).toBeDefined();

      const known: string | undefined = colourOfFamily.get(family);

      if (known) {
        expect([token, colour]).toEqual([token, known]);
      }

      colourOfFamily.set(family, colour);
    }

    const colours: Array<string> = Array.from(colourOfFamily.values());

    // Six families, six colours.
    expect(colours).toHaveLength(6);
    expect(new Set(colours).size).toBe(6);
  });

  test("a halo is fainter than a focus ring: a breath of colour, not a border", () => {
    for (const [, colour] of DARK_HALOS) {
      const alpha: number = Number(colour.split("/")[1]!.replace("%)", ""));

      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(12);
    }
  });

  test("every halo the apps draw has a dark colour of its own", () => {
    const drawn: Map<string, string> = new Map();

    for (const root of SOURCE_ROOTS) {
      for (const file of sourceFiles(root)) {
        const source: string = fs.readFileSync(file, "utf8");

        for (const match of source.matchAll(HALO_TOKEN)) {
          drawn.set(match[0], path.relative(PACKAGES, file));
        }
      }
    }

    // The scan reads what the sign-in pages draw, so it is not vacuous.
    expect(Array.from(drawn.keys())).toEqual(
      expect.arrayContaining([
        "ring-green-50",
        "ring-amber-50",
        "ring-red-50",
        "ring-indigo-50",
      ]),
    );

    const withoutRule: Array<string> = [];

    for (const [token, file] of drawn) {
      if (!declaredValue(selectorFor(token), "--tw-ring-color")) {
        withoutRule.push(`${token} (${file})`);
      }
    }

    expect(withoutRule).toEqual([]);
  });
});
