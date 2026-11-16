/*
 * How many days of history a status page's lists show: its incidents,
 * episodes, announcements and maintenance events.
 *
 * The server reads only that window (StatusPageAPI) and the page says so
 * ("No incidents in the last 14 days"), from the same number. A page that
 * said only "No incidents" read as "this service has never had one" (#9122).
 * Unset, the window is 14 days, as it always was.
 */
export const DEFAULT_STATUS_PAGE_HISTORY_IN_DAYS: number = 14;

// The key a status page list's response names its window by.
export const HISTORY_IN_DAYS_RESPONSE_KEY: string = "historyInDays";

export const getStatusPageHistoryInDays: (
  configured: number | null | undefined,
) => number = (configured: number | null | undefined): number => {
  if (
    typeof configured !== "number" ||
    !Number.isFinite(configured) ||
    configured < 1
  ) {
    return DEFAULT_STATUS_PAGE_HISTORY_IN_DAYS;
  }

  return Math.floor(configured);
};
