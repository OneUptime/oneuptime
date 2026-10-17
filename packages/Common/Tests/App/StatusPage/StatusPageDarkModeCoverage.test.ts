import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";

/*
 * The public status page's own code in its dark theme.
 *
 * The status page draws its dark theme the way the dashboards do: Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * and per variant, and a class with no rule keeps its light colour - a
 * near-white box on a slate page - with nothing failing (Tests/Helpers/
 * DarkModeScan). So every colour class the status page app draws with, in
 * every file of it, is held to what Theme.css re-colours - a page added
 * later included. The shared components it draws (cards, the uptime strip,
 * the forms) are the dashboards' too, and their own guards hold them.
 *
 * Status colours, which are any hex a status page's owner picked, are never
 * written as inline text colour here: they go through StatusColorStyle,
 * which carries their dark shade (Common/Tests/UI/Styles/
 * StatusColorsDarkTheme.test.tsx).
 */

// Relative to Common/UI, where the scan reads from.
const STATUS_PAGE_SOURCE: string = "../../App/FeatureSet/StatusPage/src";

const UI_DIR: string = path.join(__dirname, "..", "..", "..", "UI");

const SOURCE_FILE: RegExp = /\.tsx?$/;

// An inline style object, and the text colour key a style object can hold.
const STYLE_OBJECT_OPENER: string = "style={{";
const TEXT_COLOUR_KEY: RegExp = /\bcolor:/;

/*
 * Whether a source writes a text colour in an inline style object: a
 * "style={{" with "color:" after it and no "}" between. Read one stretch
 * between two "}" at a time, so the time grows with the file, not with the
 * square of it.
 */
const hasInlineTextColour: (source: string) => boolean = (
  source: string,
): boolean => {
  return source.split("}").some((stretch: string): boolean => {
    const opener: number = stretch.indexOf(STYLE_OBJECT_OPENER);

    return opener >= 0 && TEXT_COLOUR_KEY.test(stretch.slice(opener));
  });
};

const listSources: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const found: Array<string> = [];
  const absolute: string = path.join(UI_DIR, directory);

  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative: string = `${directory}/${entry.name}`;

    if (entry.isDirectory()) {
      // The servers' own code renders no classes; the locales hold copy.
      if (entry.name === "Server" || entry.name === "Locales") {
        continue;
      }

      found.push(...listSources(relative));
      continue;
    }

    if (SOURCE_FILE.test(entry.name)) {
      found.push(relative);
    }
  }

  return found;
};

const FILES: Array<string> = listSources(STATUS_PAGE_SOURCE);

/*
 * Right in both themes on purpose, each for its reason. A class added to
 * this list needs one.
 */
const SAME_IN_BOTH_THEMES: Array<string> = [
  // A mid-tone indigo focus ring, drawn on the logo and the header links.
  "focus-visible:outline-indigo-500",
  // The skip link's words, on its own indigo-600 ground, while it has focus.
  "focus:text-white",
  // The resource search's placeholder: 6.6:1 on the dark card.
  "placeholder:text-gray-400",
];

describe("the status page app in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: FILES,
    sameInBothThemes: SAME_IN_BOTH_THEMES,
  });

  test("reads every page and component the app has", () => {
    expect(FILES.length).toBeGreaterThan(60);

    for (const file of [
      "Pages/Overview/Overview.tsx",
      "Pages/Incidents/Detail.tsx",
      "Pages/Announcement/List.tsx",
      "Pages/ScheduledEvent/Detail.tsx",
      "Pages/Subscribe/EmailSubscribe.tsx",
      "Pages/Accounts/Login.tsx",
      "Pages/Accounts/SSO.tsx",
      "Pages/NotFound/PageNotFound.tsx",
      "Components/MasterPage/MasterPage.tsx",
      "Components/Header/Header.tsx",
      "Components/Footer/Footer.tsx",
      "Components/ThemeSwitch/ThemeSwitch.tsx",
      "Components/Skeleton/Skeleton.tsx",
    ]) {
      expect(FILES).toContain(`${STATUS_PAGE_SOURCE}/${file}`);
    }
  });

  test("uses no dark: variant, which this theme does not go by", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
  });

  test("builds no colour class from a template, which no scan could check", () => {
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class it draws with is re-coloured for the dark theme, or right in both", () => {
    // It found colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        "bg-white",
        "text-gray-900",
        "text-gray-500",
        "border-gray-200",
        // The loading skeletons and the overview grid's header.
        "bg-gray-200/80",
        "to-gray-50/80",
      ]),
    );
    expect(scan.unmapped).toEqual([]);
  });

  test("each class it keeps the same in both themes is still one it uses", () => {
    for (const token of SAME_IN_BOTH_THEMES) {
      expect([token, scan.colorTokens.includes(token)]).toEqual([token, true]);
    }
  });

  test("never writes a status colour as inline text colour, which the dark theme could not reach", () => {
    const offenders: Array<string> = FILES.filter((file: string): boolean => {
      return hasInlineTextColour(
        fs.readFileSync(path.join(UI_DIR, file), "utf8"),
      );
    });

    // The reader finds one where there is one, and only there.
    expect(
      hasInlineTextColour("<span style={{ color: status.color }} />"),
    ).toBe(true);
    expect(
      hasInlineTextColour(
        "<span style={{ backgroundColor: c }} /> <p>color: red</p>",
      ),
    ).toBe(false);

    expect(offenders).toEqual([]);
  });
});
