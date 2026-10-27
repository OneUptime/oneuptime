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
});
