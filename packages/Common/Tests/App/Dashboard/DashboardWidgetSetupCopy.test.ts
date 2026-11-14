import { describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_WIDGET_SETUP_LINES,
  DashboardWidgetPlace,
  DashboardWidgetSetupNeed,
  getDashboardWidgetPlace,
  getDashboardWidgetSetupLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSetupCopy";
import {
  isMetricWidgetQuerySet,
  withAverageWhenNotAggregated,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/MetricWidgetQuery";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * WHAT A WIDGET THAT IS NOT SET UP YET SAYS, PLACE BY PLACE (issue #7160).
 *
 * The lines themselves, read as the widgets read them: which place a
 * widget is drawn in, that only the board being edited is asked for a
 * click, that a reader's board is only told what is missing, and that
 * every line reaches every reader in their own language.
 */

const NEEDS: ReadonlyArray<DashboardWidgetSetupNeed> = Object.values(
  DashboardWidgetSetupNeed,
);
const PLACES: ReadonlyArray<DashboardWidgetPlace> =
  Object.values(DashboardWidgetPlace);

const ASKS_FOR_A_CLICK: RegExp = /click/i;
const NAMES_THE_SETTINGS: RegExp = /settings/;
const SAYS_WHAT_IS_MISSING: RegExp = /^No .+ yet\.$/;
const ASKS_SOMETHING: RegExp = /\b(pick|write|select|configure|settings)\b/i;
const DIRECTION_MARKS: RegExp = /[\u200E\u200F\u061C]/;
/*
 * "Click to <verb> a|an <thing>": the thing may be a few words long - "a
 * metric column", "a dimension to group rows by" - but it has its article.
 */
const CLICK_NAMES_A_THING: RegExp = /^Click to \w+ (?:a|an) \w+(?: \w+)*$/;

function everyLine(): Array<{
  need: DashboardWidgetSetupNeed;
  place: DashboardWidgetPlace;
  line: string;
}> {
  return NEEDS.flatMap((need: DashboardWidgetSetupNeed) => {
    return PLACES.map((place: DashboardWidgetPlace) => {
      return { need, place, line: getDashboardWidgetSetupLine(need, place) };
    });
  });
}

describe("the place a widget is drawn in", () => {
  test.each([
    [false, false, DashboardWidgetPlace.Board],
    [true, false, DashboardWidgetPlace.EditedBoard],
    /*
     * The Live Preview draws its widget out of edit mode, over a board
     * being edited: the preview, whichever the board is.
     */
    [false, true, DashboardWidgetPlace.SettingsPreview],
    [true, true, DashboardWidgetPlace.SettingsPreview],
  ])(
    "edit mode %s, preview %s: %s",
    (isEditMode: boolean, isPreview: boolean, place: DashboardWidgetPlace) => {
      expect(getDashboardWidgetPlace({ isEditMode, isPreview })).toBe(place);
    },
  );
});

describe("each need has a line in each place", () => {
  test("every need, every place, one non-empty sentence", () => {
    expect(Object.keys(DASHBOARD_WIDGET_SETUP_LINES).sort()).toEqual(
      [...NEEDS].sort(),
    );

    for (const { need, place, line } of everyLine()) {
      expect({ need, place, line: line.trim() }).toEqual({
        need,
        place,
        line: line,
      });
      expect(line.length).toBeGreaterThan(0);
      expect(DASHBOARD_WIDGET_SETUP_LINES[need][place]).toBe(line);
    }
  });

  test("only the board being edited is asked for a click", () => {
    for (const { need, place, line } of everyLine()) {
      if (place !== DashboardWidgetPlace.EditedBoard) {
        expect({
          need,
          place,
          line,
          asksForAClick: ASKS_FOR_A_CLICK.test(line),
        }).toEqual({ need, place, line, asksForAClick: false });
      }
    }

    // The widgets that had a click there keep it: it does open settings.
    expect(
      getDashboardWidgetSetupLine(
        DashboardWidgetSetupNeed.Metric,
        DashboardWidgetPlace.EditedBoard,
      ),
    ).toBe("Click to configure a metric");
    expect(
      getDashboardWidgetSetupLine(
        DashboardWidgetSetupNeed.Query,
        DashboardWidgetPlace.EditedBoard,
      ),
    ).toBe("Click to configure a query");
    expect(
      getDashboardWidgetSetupLine(
        DashboardWidgetSetupNeed.Slo,
        DashboardWidgetPlace.EditedBoard,
      ),
    ).toBe("Click to select an SLO");
  });

  /*
   * The metric Table and the Trace Table (issue #7329) drew one English
   * line in every place: "Add a metric column with a Metric Name to start
   * populating the table." and "Choose a “Group rows by” dimension in the
   * widget settings to populate this table.". Each now has a line for each
   * place, as every other widget's.
   */
  test.each([
    [
      DashboardWidgetSetupNeed.MetricColumn,
      "Click to configure a metric column",
      "Pick a metric for a column in the settings below.",
      "No metric column set up yet.",
    ],
    [
      DashboardWidgetSetupNeed.GroupByDimension,
      "Click to pick a dimension to group rows by",
      "Pick a dimension to group rows by in the settings below.",
      "No dimension to group rows by yet.",
    ],
  ])(
    "%s: a click, the settings below, and what is missing",
    (
      need: DashboardWidgetSetupNeed,
      editedBoard: string,
      settingsPreview: string,
      board: string,
    ) => {
      expect({
        edited: getDashboardWidgetSetupLine(
          need,
          DashboardWidgetPlace.EditedBoard,
        ),
        preview: getDashboardWidgetSetupLine(
          need,
          DashboardWidgetPlace.SettingsPreview,
        ),
        board: getDashboardWidgetSetupLine(need, DashboardWidgetPlace.Board),
      }).toEqual({
        edited: editedBoard,
        preview: settingsPreview,
        board: board,
      });

      // None of them is the old one-line-everywhere sentence.
      for (const place of PLACES) {
        expect(getDashboardWidgetSetupLine(need, place)).not.toMatch(
          /populat|Metric Name|widget settings/,
        );
      }
    },
  );

  /*
   * One board drew "Click to configure metric" beside "Click to configure a
   * query": each click line names what it asks for as a thing - a metric, a
   * query, an SLO - as every other place's line does.
   */
  test("each click line names what it asks for with its article", () => {
    for (const need of NEEDS) {
      const line: string = getDashboardWidgetSetupLine(
        need,
        DashboardWidgetPlace.EditedBoard,
      );

      if (!ASKS_FOR_A_CLICK.test(line)) {
        continue;
      }

      expect({ need, line, named: CLICK_NAMES_A_THING.test(line) }).toEqual({
        need,
        line,
        named: true,
      });
    }

    expect(CLICK_NAMES_A_THING.test("Click to configure metric")).toBe(false);
    expect(CLICK_NAMES_A_THING.test("Click to configure metric column")).toBe(
      false,
    );
    expect(CLICK_NAMES_A_THING.test("Click to configure a metric column")).toBe(
      true,
    );
  });

  test("the Live Preview points at the settings below it, which are there", () => {
    for (const need of NEEDS) {
      const line: string = getDashboardWidgetSetupLine(
        need,
        DashboardWidgetPlace.SettingsPreview,
      );

      expect({
        need,
        line,
        namesTheSettings: NAMES_THE_SETTINGS.test(line),
      }).toEqual({
        need,
        line,
        namesTheSettings: true,
      });
    }
  });

  test("a board out of edit mode is told what is missing, and nothing to do", () => {
    for (const need of NEEDS) {
      const line: string = getDashboardWidgetSetupLine(
        need,
        DashboardWidgetPlace.Board,
      );

      expect({
        need,
        line,
        saysWhatIsMissing: SAYS_WHAT_IS_MISSING.test(line),
      }).toEqual({ need, line, saysWhatIsMissing: true });
      expect({
        need,
        line,
        asksSomething: ASKS_SOMETHING.test(line),
      }).toEqual({ need, line, asksSomething: false });
      // No reader's board line is another place's line.
      expect(line).not.toBe(
        getDashboardWidgetSetupLine(need, DashboardWidgetPlace.EditedBoard),
      );
      expect(line).not.toBe(
        getDashboardWidgetSetupLine(need, DashboardWidgetPlace.SettingsPreview),
      );
    }
  });

  test("the Chart widget's old lines, and their typo, are no line of any place", () => {
    for (const { line } of everyLine()) {
      expect(line).not.toMatch(/Please select|Click here|a aggregation/);
    }
  });
});

describe("every line reaches every reader in their language", () => {
  const english: Record<string, string> = readDashboardLocale("en");

  test("every line is a key of the English file, worded as itself", () => {
    for (const { line } of everyLine()) {
      expect({ line, english: english[line] }).toEqual({
        line,
        english: line,
      });
    }
  });

  test.each(
    DASHBOARD_LANGUAGES.map((language: string) => {
      return [language];
    }),
  )("%s words every line its own way", (language: string) => {
    const words: Record<string, string> = readDashboardLocale(language);

    for (const { line } of everyLine()) {
      expect({
        language,
        line,
        worded: isWordedInDashboardLocale(line, language),
        // Each line has words of its own besides SLO: none is kept English.
        keptEnglish: words[line] === line,
      }).toEqual({ language, line, worded: true, keptEnglish: false });
    }

    /*
     * A reader's board line stays apart from the other places' lines in
     * every language: a translation that merged them would hand a
     * reader the click again.
     */
    for (const need of NEEDS) {
      const board: string | undefined =
        words[getDashboardWidgetSetupLine(need, DashboardWidgetPlace.Board)];

      for (const place of [
        DashboardWidgetPlace.EditedBoard,
        DashboardWidgetPlace.SettingsPreview,
      ]) {
        expect({
          language,
          need,
          place,
          sameAsBoard:
            board === words[getDashboardWidgetSetupLine(need, place)],
        }).toEqual({ language, need, place, sameAsBoard: false });
      }
    }
  });

  test.each([["ar"], ["fa"]])(
    "%s writes its lines without direction marks beside the SLO's name",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const { line } of everyLine()) {
        expect({
          language,
          line,
          marks: DIRECTION_MARKS.test(words[line] || ""),
        }).toEqual({ language, line, marks: false });
      }

      // The SLO keeps its name, as every other line of the language does.
      expect(
        words[
          getDashboardWidgetSetupLine(
            DashboardWidgetSetupNeed.Slo,
            DashboardWidgetPlace.Board,
          )
        ],
      ).toContain("SLO");
    },
  );
});

function metricQuery(
  filterData: Record<string, unknown>,
): MetricQueryConfigData {
  return {
    metricAliasData: { metricVariable: "a" },
    metricQueryData: { filterData: filterData },
  } as unknown as MetricQueryConfigData;
}

describe("a metric widget's query", () => {
  test("is set once its filter holds anything", () => {
    expect(isMetricWidgetQuerySet(undefined)).toBe(false);
    expect(
      isMetricWidgetQuerySet({
        metricAliasData: { metricVariable: "a" },
      } as unknown as MetricQueryConfigData),
    ).toBe(false);
    expect(isMetricWidgetQuerySet(metricQuery({}))).toBe(false);
    expect(
      isMetricWidgetQuerySet(metricQuery({ metricName: "http.requests" })),
    ).toBe(true);
    expect(
      isMetricWidgetQuerySet(
        metricQuery({ aggegationType: MetricsAggregationType.Sum }),
      ),
    ).toBe(true);
  });

  test("names no aggregation: it is read as its average, as its picker shows", () => {
    const stored: MetricQueryConfigData = metricQuery({
      metricName: "http.requests",
      attributes: { "service.name": "api" },
    });
    const storedCopy: string = JSON.stringify(stored);

    const read: MetricQueryConfigData = withAverageWhenNotAggregated(stored);

    expect(read.metricQueryData.filterData).toEqual({
      metricName: "http.requests",
      attributes: { "service.name": "api" },
      aggegationType: MetricsAggregationType.Avg,
    });
    expect(read.metricAliasData).toEqual(stored.metricAliasData);
    // The stored widget is left as its settings wrote it.
    expect(JSON.stringify(stored)).toBe(storedCopy);
    expect(read).not.toBe(stored);
  });

  test("names one: it is read as named, the same query", () => {
    for (const aggregation of Object.values(MetricsAggregationType)) {
      const stored: MetricQueryConfigData = metricQuery({
        metricName: "http.requests",
        aggegationType: aggregation,
      });

      expect(withAverageWhenNotAggregated(stored)).toBe(stored);
    }
  });

  test("names no metric yet: nothing is added to it", () => {
    const empty: MetricQueryConfigData = metricQuery({});

    expect(withAverageWhenNotAggregated(empty)).toBe(empty);
    expect(empty.metricQueryData.filterData).toEqual({});
  });
});
