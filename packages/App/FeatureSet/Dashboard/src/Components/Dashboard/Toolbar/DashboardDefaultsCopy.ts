import {
  AutoRefreshInterval,
  getAutoRefreshIntervalLabel,
} from "Common/Types/Dashboard/DashboardViewConfig";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words and test ids of a dashboard's defaults in its toolbar (issue
 * #5080): the time range and auto-refresh everyone who opens the dashboard
 * starts on.
 *
 *   - While editing, a row under the toolbar's buttons sets them on purpose:
 *     Default time range and Default auto-refresh, saved with Save Changes
 *     (DashboardDefaultsBar.tsx). They used to be saved as a side effect -
 *     whatever interval the editor had last picked while viewing - so an
 *     unrelated save could turn a wall screen's refresh off.
 *   - While viewing, each picker starts with "Default (...)", which names
 *     the dashboard's default and goes back to it from the viewer's own
 *     pick, which their browser remembers for the dashboard.
 *
 * Kept free of React so the toolbar and App/Tests (the docs facts among
 * them) read these exact strings. Every sentence is wrapped in
 * translationKey() so npm run i18n:extract finds it, and is translated in
 * all seventeen Dashboard locale files.
 */

// The row of defaults while editing, and its two pickers' buttons.
export const DASHBOARD_DEFAULTS_BAR_TEST_ID: string = "dashboard-defaults-bar";

export const DEFAULT_TIME_RANGE_PICKER_TEST_ID: string =
  "dashboard-default-time-range";

export const DEFAULT_AUTO_REFRESH_PICKER_TEST_ID: string =
  "dashboard-default-auto-refresh";

// A picker's list of choices is `${pickerTestId}-menu`, a choice `${pickerTestId}-${value}`.
export const getDefaultsPickerMenuTestId: (pickerTestId: string) => string = (
  pickerTestId: string,
): string => {
  return `${pickerTestId}-menu`;
};

export const getDefaultsPickerChoiceTestId: (
  pickerTestId: string,
  value: string,
) => string = (pickerTestId: string, value: string): string => {
  // "Past 1 Day" -> past-1-day, so a test id has no spaces.
  return `${pickerTestId}-${value.toLowerCase().split(" ").join("-")}`;
};

export const DashboardDefaultsCopy: {
  timeRangeLabel: string;
  autoRefreshLabel: string;
  hint: string;
} = {
  timeRangeLabel: translationKey("Default time range"),
  autoRefreshLabel: translationKey("Default auto-refresh"),
  hint: translationKey(
    "Everyone opens the dashboard on these. Each viewer can still pick their own.",
  ),
};

/*
 * The view-mode auto-refresh menu's first choice, "Default (1m)", and the
 * line between it and the intervals.
 */
export const AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID: string =
  "dashboard-auto-refresh-default";

/*
 * An interval as the defaults' picker and the "Default (...)" choice name
 * it: Off, or its short form (5s, 1m) - as the auto-refresh button shows it.
 */
export const getAutoRefreshChoiceLabel: (
  interval: AutoRefreshInterval,
) => string = (interval: AutoRefreshInterval): string => {
  if (interval === AutoRefreshInterval.OFF) {
    return translationKey("Off");
  }

  return getAutoRefreshIntervalLabel(interval);
};
