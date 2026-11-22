import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { withDateDisplayLanguage } from "Common/Types/DateLanguage";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { Translator } from "Common/Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import {
  TIME_RANGE_LABEL_SEPARATOR,
  getTimeRangeButtonLabel,
  getTimeRangeLabel,
} from "Common/UI/Components/Date/TimeRangeLabel";
import { describeTimeRangeForTile } from "../../FeatureSet/Dashboard/src/Pages/Rum/View/OverviewHelpers";
import {
  describeFaultTile,
  describeSessionsTile,
} from "../../FeatureSet/Dashboard/src/Pages/Rum/View/MobileOverviewHelpers";

/*
 * A RUM APPLICATION'S OVERVIEW TILES NAME THEIR RANGE IN THE READER'S
 * LANGUAGE (issue #10552).
 *
 * The Sessions recorded tile, and a mobile app's Sessions, Crashes and ANRs
 * tiles, say under their figure which range they counted. They said it by
 * lowercasing the TimeRange value ("past 1 hour", "custom range"), which no
 * locale words, so a German Overview read "Aufgezeichnete Sitzungen 0 · past
 * 1 hour". Lowercasing a translated label would be wrong as well: German
 * keeps a noun's capital.
 *
 * Now a tile names its range as the range picker above it does
 * (getTimeRangeButtonLabel): a quick range by the picker's own label, which
 * every Dashboard language words and the tile looks up in the reader's
 * language, and a custom range - a zoom among them - by its two ends,
 * written in the reader's language by the shared date helper.
 */

const QUICK_RANGES: Array<TimeRange> = (
  Object.values(TimeRange) as Array<TimeRange>
).filter((range: TimeRange): boolean => {
  return range !== TimeRange.CUSTOM;
});

const ZOOM_START: Date = new Date("2026-11-19T09:20:00.000Z");
const ZOOM_END: Date = new Date("2026-11-19T09:50:00.000Z");

const ZOOMED: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(ZOOM_START, ZOOM_END),
};

const english: Record<string, string> = readDashboardLocale("en");

// What the tile draws: its sublabel as the reader's translator words it.
function drawn(sublabel: string, translator: Translator): string {
  return translator.translateText(sublabel) || sublabel;
}

describe("a quick range is named as the range picker names it", () => {
  test.each(QUICK_RANGES)("%s", (range: TimeRange) => {
    expect(describeTimeRangeForTile({ range })).toBe(getTimeRangeLabel(range));
  });

  test("never as the lowercased TimeRange value it used to be", () => {
    for (const range of QUICK_RANGES) {
      const sublabel: string = describeTimeRangeForTile({ range });

      expect(sublabel).not.toBe(String(range).toLowerCase());
      expect(sublabel).not.toMatch(/^past /);
    }
  });

  test("each is a key of the Dashboard's English locale", () => {
    for (const range of QUICK_RANGES) {
      const sublabel: string = describeTimeRangeForTile({ range });

      expect({ sublabel, inLocale: english[sublabel] }).toEqual({
        sublabel,
        inLocale: sublabel,
      });
    }
  });
});

describe.each(DASHBOARD_LANGUAGES)("in %s", (language: string) => {
  const translator: Translator = dashboardTranslator(language);

  test("every quick range is worded in the language, never drawn in English", () => {
    for (const range of QUICK_RANGES) {
      const sublabel: string = describeTimeRangeForTile({ range });

      expect({
        range,
        worded: isWordedInDashboardLocale(sublabel, language),
      }).toEqual({ range, worded: true });
      expect({ range, drawn: drawn(sublabel, translator) }).not.toEqual({
        range,
        drawn: sublabel,
      });
    }
  });

  test("a mobile app's tiles name the range in the language too", () => {
    const sessionsTile: string = describeSessionsTile({
      sessions: { sessions: 12, spans: 120, installs: null, failed: false },
      timeRange: { range: TimeRange.PAST_ONE_HOUR },
    }).sublabel as string;
    const crashesTile: string = describeFaultTile({
      fault: {
        total: 0,
        series: [],
        sessions: 0,
        installs: null,
        failed: false,
      },
      timeRange: { range: TimeRange.PAST_ONE_DAY },
    }).sublabel as string;

    expect(drawn(sessionsTile, translator)).toBe(
      readDashboardLocale(language)["Past 1 Hour"],
    );
    expect(drawn(crashesTile, translator)).toBe(
      readDashboardLocale(language)["Past 1 Day"],
    );
  });

  test("a zoomed range is its window's two ends, written in the language", () => {
    const sublabel: string = withDateDisplayLanguage(language, () => {
      return describeTimeRangeForTile(ZOOMED);
    });

    expect(sublabel).toBe(
      withDateDisplayLanguage(language, () => {
        return getTimeRangeButtonLabel(ZOOMED);
      }),
    );
    expect(sublabel).toContain(TIME_RANGE_LABEL_SEPARATOR);
    // No English words for a window: "custom range" is gone.
    expect(sublabel).not.toMatch(/custom|range/i);
    // The tile draws dates as they are written: nothing to look up.
    expect(drawn(sublabel, translator)).toBe(sublabel);
  });
});

describe("German, the case the issue was found in", () => {
  const german: Record<string, string> = readDashboardLocale("de");
  const translator: Translator = dashboardTranslator("de");

  test("Past 1 Hour reads as the German picker's label, its noun capitalised", () => {
    const sublabel: string = drawn(
      describeTimeRangeForTile({ range: TimeRange.PAST_ONE_HOUR }),
      translator,
    );

    expect(sublabel).toBe(german["Past 1 Hour"]);
    expect(sublabel).toBe("Letzte Stunde");
    expect(sublabel).not.toMatch(/past|hour/i);
  });

  test("a zoomed range names its month in German", () => {
    const sublabel: string = withDateDisplayLanguage("de", () => {
      return describeTimeRangeForTile(ZOOMED);
    });

    expect(sublabel).toContain("Nov.");
    expect(sublabel).not.toContain("Nov ");
  });

  test("a custom range with no dates is named Custom, in German", () => {
    const sublabel: string = describeTimeRangeForTile({
      range: TimeRange.CUSTOM,
    });

    expect(sublabel).toBe("Custom");
    expect(drawn(sublabel, translator)).toBe(german["Custom"]);
    expect(german["Custom"]).not.toBe("Custom");
  });
});
