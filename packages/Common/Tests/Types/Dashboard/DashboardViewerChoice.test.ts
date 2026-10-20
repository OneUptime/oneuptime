/**
 * The one rule behind every dashboard setting a viewer may change for
 * themselves (Types/Dashboard/DashboardViewerChoice.ts): the link's, else
 * the viewer's own remembered pick, else the dashboard's default, else what
 * every dashboard had before the setting. The time range and auto-refresh
 * use it today (issue #5080), and a list widget's sort is meant to (#5082),
 * so it is held here on a setting of its own kind.
 */

import {
  DashboardSettingSource,
  isDashboardDefaultSource,
  resolveDashboardSetting,
} from "../../../Types/Dashboard/DashboardViewerChoice";
import { describe, expect, test } from "@jest/globals";

describe("which place decides", () => {
  test.each([
    [
      "the link, over everything",
      { link: "a", viewerPick: "b", savedDefault: "c", fallback: "d" },
      { value: "a", source: DashboardSettingSource.Link },
    ],
    [
      "the viewer's pick, over the dashboard's default",
      { viewerPick: "b", savedDefault: "c", fallback: "d" },
      { value: "b", source: DashboardSettingSource.Viewer },
    ],
    [
      "the dashboard's default, over the fallback",
      { savedDefault: "c", fallback: "d" },
      { value: "c", source: DashboardSettingSource.Dashboard },
    ],
    [
      "the fallback, when nothing else says",
      { fallback: "d" },
      { value: "d", source: DashboardSettingSource.Fallback },
    ],
    [
      "the next place, where one says null",
      { link: null, viewerPick: null, savedDefault: "c", fallback: "d" },
      { value: "c", source: DashboardSettingSource.Dashboard },
    ],
  ])(
    "%s",
    (
      _what: string,
      data: {
        link?: string | null;
        viewerPick?: string | null;
        savedDefault?: string | null;
        fallback: string;
      },
      expected: { value: string; source: DashboardSettingSource },
    ) => {
      expect(resolveDashboardSetting<string>(data)).toEqual(expected);
    },
  );

  test("a value that is falsy but real - 0, an empty text, false - still decides", () => {
    expect(
      resolveDashboardSetting<number>({ link: 0, savedDefault: 5, fallback: 1 }),
    ).toEqual({ value: 0, source: DashboardSettingSource.Link });
    expect(
      resolveDashboardSetting<string>({ viewerPick: "", fallback: "x" }),
    ).toEqual({ value: "", source: DashboardSettingSource.Viewer });
    expect(
      resolveDashboardSetting<boolean>({ savedDefault: false, fallback: true }),
    ).toEqual({ value: false, source: DashboardSettingSource.Dashboard });
  });
});

describe("the default's own choice", () => {
  test("is the one in use while the dashboard's default or the fallback decides", () => {
    expect(isDashboardDefaultSource(DashboardSettingSource.Dashboard)).toBe(
      true,
    );
    expect(isDashboardDefaultSource(DashboardSettingSource.Fallback)).toBe(
      true,
    );
  });

  test("and not while a link or the viewer's own pick does", () => {
    expect(isDashboardDefaultSource(DashboardSettingSource.Link)).toBe(false);
    expect(isDashboardDefaultSource(DashboardSettingSource.Viewer)).toBe(false);
  });
});
