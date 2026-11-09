/*
 * The tabs of an App Platforms app's page (Pages/AppPlatforms/View/App),
 * by the name its address opens one by: …/apps/:id?tab=Revisions. The
 * environment's feed lines and Overview link to Revisions, and its
 * Recommendations page to an app's Recommendations. React-free, so the
 * pages and components that link here need not import the page.
 */
export enum CloudAppTabName {
  Overview = "Overview",
  Revisions = "Revisions",
  Instances = "Instances",
  Logs = "Logs",
  Traces = "Traces",
  Recommendations = "Recommendations",
}
