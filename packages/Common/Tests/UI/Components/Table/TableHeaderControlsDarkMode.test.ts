import { describe, expect, test } from "@jest/globals";
import { DarkModeScan, scanDarkMode } from "../../../Helpers/DarkModeScan";

/*
 * Dark mode is Theme.css class remaps, not dark: variants: a colour class
 * with no rule of its own keeps its light colour on the dark card. Every
 * piece of a table's header - the shared search slot, main button and ⋯,
 * the time range picker at the header's size, the search's syntax help -
 * and of the session list's header and chips row is held to that here.
 */

const DASHBOARD: string = "../../App/FeatureSet/Dashboard/src";

const FILES: Array<string> = [
  "Components/Table/TableHeaderControls.tsx",
  "Components/Date/TimeRangePickerDropdown.tsx",
  "Components/TelemetryViewer/components/TelemetrySearchHelp.tsx",
  `${DASHBOARD}/Components/SessionReplay/SessionReplaySearchBar.tsx`,
  `${DASHBOARD}/Components/SessionReplay/SessionReplayFacets.tsx`,
  `${DASHBOARD}/Components/ResourceOwners/FacetFilterBar.tsx`,
];

describe("a table's header in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: FILES });

  test("reads the classes it means to", () => {
    for (const token of [
      "bg-white",
      "border-gray-200",
      "border-gray-300",
      "border-gray-400",
      "bg-gray-50",
      "text-gray-400",
      "text-gray-500",
      "text-gray-700",
      "text-gray-900",
      "hover:bg-gray-50",
      "text-amber-700",
      "bg-indigo-100",
      "text-indigo-700",
    ]) {
      expect([token, scan.colorTokens.includes(token)]).toEqual([token, true]);
    }
  });

  test("every colour class has its dark rule in Theme.css", () => {
    expect(scan.unmapped).toEqual([]);
  });

  test("no dark: variant, which the theme does not go by, and no colour built from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });
});
