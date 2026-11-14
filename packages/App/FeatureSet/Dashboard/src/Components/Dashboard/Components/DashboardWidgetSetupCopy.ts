import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A WIDGET THAT IS NOT SET UP YET SAYS, WHERE IT IS DRAWN (issue #7160).
 *
 * A widget with nothing picked yet - no metric, no query, no SLO, no saved
 * funnel - draws one line in place of its data. "Click to configure
 * metric" is true only on a board being edited, where a click on a widget
 * opens its settings. The same widget is drawn in two more places, where a
 * click opens nothing:
 *
 *   - the widget settings dialog's Live Preview, which draws the widget as
 *     a reader sees it while its settings are right below it
 *     (DashboardWidgetPreview, issue #6859);
 *   - a board out of edit mode: a reader's, who may not be allowed to edit
 *     it, a public dashboard's visitor, or a playlist on a wall screen.
 *
 * So each line is written for its place: a click on the board being
 * edited, the settings below in the preview, and only what is missing
 * everywhere else - never an instruction the reader cannot follow there.
 *
 * Kept free of React, so the widgets, their tests and App/Tests read these
 * exact strings. Every sentence is wrapped in translationKey() so npm run
 * i18n:extract finds it, and is worded in every Dashboard locale.
 */

// What the widget needs before it has anything to draw.
export enum DashboardWidgetSetupNeed {
  // Value, Gauge and Chart: a metric.
  Metric = "metric",
  // The four external Data Source widgets: a data source and its query.
  Query = "query",
  // SLO: the SLO it shows, or a toolbar variable that names one.
  Slo = "slo",
  // Funnel: a funnel saved on a RUM application's Funnels page.
  SavedFunnel = "saved-funnel",
  // User Retention: a retention table saved on its page.
  SavedRetentionTable = "saved-retention-table",
  /*
   * The metric Table: a column that reads a metric. A new table has one
   * column, with no metric picked for it yet (issue #7329).
   */
  MetricColumn = "metric-column",
  /*
   * The Trace Table: the dimension its rows are grouped by - one row per
   * span name, status or attribute value. Its "Group rows by" setting is
   * required, and a table whose dimension was cleared has no rows to draw
   * (issue #7329).
   */
  GroupByDimension = "group-by-dimension",
}

// Where a widget is drawn, which decides what its setup line may ask.
export enum DashboardWidgetPlace {
  // The board while it is edited: a click on a widget opens its settings.
  EditedBoard = "edited-board",
  /*
   * The widget settings dialog's Live Preview: the settings are right
   * below it, and nothing in it opens anything.
   */
  SettingsPreview = "settings-preview",
  /*
   * A board out of edit mode - a reader's, a public dashboard, a
   * playlist's turn: a click opens nothing, and the reader may not be
   * allowed to edit the dashboard at all.
   */
  Board = "board",
}

/*
 * The place a widget is drawn in. The Live Preview draws its widget out of
 * edit mode, so the preview is asked first.
 */
export const getDashboardWidgetPlace: (data: {
  isEditMode: boolean;
  isPreview: boolean;
}) => DashboardWidgetPlace = (data: {
  isEditMode: boolean;
  isPreview: boolean;
}): DashboardWidgetPlace => {
  if (data.isPreview) {
    return DashboardWidgetPlace.SettingsPreview;
  }

  return data.isEditMode
    ? DashboardWidgetPlace.EditedBoard
    : DashboardWidgetPlace.Board;
};

/*
 * Each need's line in each place. On the board being edited the widgets
 * keep the lines they had there (a click does open their settings), each
 * naming what it asks for as "a metric", "a query", "an SLO" - the metric's
 * was "Click to configure metric" beside "Click to configure a query" on
 * one board. The Funnel and User Retention widgets' line, which names this
 * widget's settings, is true there and in the preview alike.
 */
export const DASHBOARD_WIDGET_SETUP_LINES: Readonly<
  Record<
    DashboardWidgetSetupNeed,
    Readonly<Record<DashboardWidgetPlace, string>>
  >
> = {
  [DashboardWidgetSetupNeed.Metric]: {
    [DashboardWidgetPlace.EditedBoard]: translationKey(
      "Click to configure a metric",
    ),
    [DashboardWidgetPlace.SettingsPreview]: translationKey(
      "Pick a metric in the settings below.",
    ),
    [DashboardWidgetPlace.Board]: translationKey("No metric picked yet."),
  },
  [DashboardWidgetSetupNeed.Query]: {
    [DashboardWidgetPlace.EditedBoard]: translationKey(
      "Click to configure a query",
    ),
    [DashboardWidgetPlace.SettingsPreview]: translationKey(
      "Write a query in the settings below.",
    ),
    [DashboardWidgetPlace.Board]: translationKey("No query set up yet."),
  },
  [DashboardWidgetSetupNeed.Slo]: {
    [DashboardWidgetPlace.EditedBoard]: translationKey(
      "Click to select an SLO",
    ),
    [DashboardWidgetPlace.SettingsPreview]: translationKey(
      "Pick an SLO in the settings below.",
    ),
    [DashboardWidgetPlace.Board]: translationKey("No SLO picked yet."),
  },
  [DashboardWidgetSetupNeed.SavedFunnel]: {
    [DashboardWidgetPlace.EditedBoard]: translationKey(
      "Pick a saved funnel in this widget's settings.",
    ),
    [DashboardWidgetPlace.SettingsPreview]: translationKey(
      "Pick a saved funnel in this widget's settings.",
    ),
    [DashboardWidgetPlace.Board]: translationKey("No saved funnel picked yet."),
  },
  [DashboardWidgetSetupNeed.SavedRetentionTable]: {
    [DashboardWidgetPlace.EditedBoard]: translationKey(
      "Pick a saved retention table in this widget's settings.",
    ),
    [DashboardWidgetPlace.SettingsPreview]: translationKey(
      "Pick a saved retention table in this widget's settings.",
    ),
    [DashboardWidgetPlace.Board]: translationKey(
      "No saved retention table picked yet.",
    ),
  },
  /*
   * The metric Table drew "Add a metric column with a Metric Name to start
   * populating the table." in English, in pale gray, in every place - a
   * wall screen told to add a column (issue #7329).
   */
  [DashboardWidgetSetupNeed.MetricColumn]: {
    [DashboardWidgetPlace.EditedBoard]: translationKey(
      "Click to configure a metric column",
    ),
    [DashboardWidgetPlace.SettingsPreview]: translationKey(
      "Pick a metric for a column in the settings below.",
    ),
    [DashboardWidgetPlace.Board]: translationKey(
      "No metric column set up yet.",
    ),
  },
  /*
   * The Trace Table said "Choose a “Group rows by” dimension in the widget
   * settings to populate this table." wherever it was drawn, to readers
   * who cannot open the widget's settings (issue #7329).
   */
  [DashboardWidgetSetupNeed.GroupByDimension]: {
    [DashboardWidgetPlace.EditedBoard]: translationKey(
      "Click to pick a dimension to group rows by",
    ),
    [DashboardWidgetPlace.SettingsPreview]: translationKey(
      "Pick a dimension to group rows by in the settings below.",
    ),
    [DashboardWidgetPlace.Board]: translationKey(
      "No dimension to group rows by yet.",
    ),
  },
};

// A need's line in a place, in English: the key the widget translates.
export const getDashboardWidgetSetupLine: (
  need: DashboardWidgetSetupNeed,
  place: DashboardWidgetPlace,
) => string = (
  need: DashboardWidgetSetupNeed,
  place: DashboardWidgetPlace,
): string => {
  return DASHBOARD_WIDGET_SETUP_LINES[need][place];
};

/*
 * The line's element in every widget, with the place it was written for,
 * so a reader of the page (or a test) can find it whatever the widget.
 */
export const DASHBOARD_WIDGET_SETUP_LINE_TEST_ID: string =
  "dashboard-widget-setup-line";

/*
 * How the line looks in the widgets that draw it under an icon and a name
 * (Gauge, Chart, the Data Source Gauge, Table and Chart, SLO): dark enough
 * to read on the widget (gray-500 is 4.5:1 on white, gray-400 2.5:1, as
 * the Value widget's and every public placeholder's already are), centred,
 * and balanced across its lines, so a wide Live Preview never leaves
 * "below." alone on a second line.
 */
export const DASHBOARD_WIDGET_SETUP_LINE_CLASS_NAME: string =
  "text-xs text-gray-500 text-center text-balance max-w-xs px-2";

/*
 * The widget's name above the line ("Gauge Widget", "Data Source Table" or
 * its own title): centred on every line it takes, so a German
 * "Datenquellen-Messwert" that wraps in a narrow tile is not drawn flush
 * left over a centred line.
 */
export const DASHBOARD_WIDGET_SETUP_NAME_CLASS_NAME: string =
  "text-xs font-medium text-gray-500 text-center text-balance break-words max-w-full px-2";

/*
 * A WIDGET'S ERROR LINE (issue #7330): why it has nothing to draw - a read
 * that failed, a time range with no start or end - drawn in the same
 * readable look as the setup line (gray-500, centred, balanced, as wide as
 * a line reads well), and broken inside a word that is longer than the
 * tile, as a server's message or an address can be. Every widget drew its
 * own: the Chart, the Data Source Chart and Table, the metric Table, the
 * Log Stream, the Gauge and the Network Map in gray-400 (2.5:1 on white),
 * held to a 160 or 192px column, most of them in English. One line for
 * every widget (DashboardWidgetError) keeps them from drifting apart again.
 */
export const DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME: string =
  "text-xs text-gray-500 text-center text-balance break-words max-w-xs px-2";

// The error line's element, whatever the widget.
export const DASHBOARD_WIDGET_ERROR_LINE_TEST_ID: string =
  "dashboard-widget-error-line";
