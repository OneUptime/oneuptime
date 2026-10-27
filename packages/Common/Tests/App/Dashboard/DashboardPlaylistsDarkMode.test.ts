/*
 * Dashboard playlists in the dark theme (issue #5235): the player - its
 * bar, the progress line, the keyboard sheet, and what it says when there
 * is nothing to play - the playlist's dashboards on its page, and the
 * Dashboards field on its forms.
 *
 * They are drawn with the app's Tailwind classes, and Theme.css re-colours
 * them under html.dark one rule per class and per variant: a class without
 * a rule keeps its light colour - a white bar over a slate board on a NOC
 * wall at night - and nothing fails (Tests/Helpers/DarkModeScan). So every
 * colour class they use is held to what Theme.css remaps.
 */

import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

// Read as Common/UI's own files are: from Common/UI.
const PLAYLIST: string =
  "../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist";
const PAGES: string =
  "../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Playlists";

const FILES: Array<string> = [
  `${PLAYLIST}/PlaylistPlayer.tsx`,
  `${PLAYLIST}/PlaylistPlayerBar.tsx`,
  `${PLAYLIST}/PlaylistDashboardList.tsx`,
  `${PLAYLIST}/PlaylistDashboardsField.tsx`,
  `${PAGES}/Playlists.tsx`,
  `${PAGES}/PlaylistView.tsx`,
  `${PAGES}/PlaylistPlay.tsx`,
  `${PAGES}/PlaylistFormFields.tsx`,
];

const UI_DIR: string = path.join(__dirname, "..", "..", "..", "UI");

describe("dashboard playlists in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: FILES });

  test("every file the scan reads is there, so a move cannot empty it", () => {
    for (const file of FILES) {
      expect(fs.existsSync(path.join(UI_DIR, file))).toBe(true);
    }
  });

  test("they use no dark: variant and build no colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found their colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The bar, the stage behind the boards, and the list's numbers.
        "bg-white",
        "bg-gray-50",
        "bg-gray-100",
        "border-gray-200",
        // The words.
        "text-gray-900",
        "text-gray-600",
        "text-gray-500",
        // The progress line.
        "bg-indigo-600",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });

  /*
   * The Dashboards field marks its picker invalid when the playlist has no
   * dashboard (Dropdown's error: !border-red-400 in a !ring-red-100 ring).
   * The dark theme keeps every select's border its grey, and the light
   * ring is near white: the field was framed white. Theme.css frames an
   * invalid select red instead - for every form's dropdowns, not only this.
   */
  test("a picker the form marks invalid is framed red, not white", () => {
    const dropdown: string = fs.readFileSync(
      path.join(UI_DIR, "Components", "Dropdown", "Dropdown.tsx"),
      "utf8",
    );
    const theme: string = fs.readFileSync(
      path.join(UI_DIR, "Styles", "Theme.css"),
      "utf8",
    );

    // What Dropdown draws for an error...
    expect(dropdown).toContain(
      'classes.push("!border-red-400 !ring-2 !ring-red-100");',
    );

    // ...and the dark rule for exactly that control, red, over the grey one.
    const rule: string =
      'html.dark .ou-select__control[class~="!ring-red-100"] {';
    const start: number = theme.indexOf(rule);

    expect(start).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(
      theme.indexOf("html.dark :is(.ou-select__control, .ou-select__menu) {"),
    );

    const body: string = theme.slice(start, theme.indexOf("}", start));

    expect(body).toContain("border-color: rgb(248 113 113 / 70%) !important;");
    expect(body).toContain(
      "--tw-ring-color: rgb(248 113 113 / 30%) !important;",
    );
  });
});
