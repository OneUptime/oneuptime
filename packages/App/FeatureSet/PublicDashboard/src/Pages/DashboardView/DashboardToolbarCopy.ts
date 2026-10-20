/*
 * Test ids of the public dashboard's toolbar (DashboardViewPage.tsx), kept
 * free of React so App's tests and the browser suites read these exact
 * values.
 */

/*
 * The auto-refresh menu's first choice, "Default (1m)": the dashboard's own
 * interval, and the way back to it from the visitor's own pick (issue
 * #5080).
 */
export const PUBLIC_AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID: string =
  "public-dashboard-auto-refresh-default";
