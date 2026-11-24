/*
 * The public dashboard route a PromQL widget's data comes from, for a
 * visitor nobody signed in (issue #10226): under the public dashboard API,
 * followed by the dashboard's id. The page names a stored query by its
 * widget (`componentId`) and its place among the widget's queries
 * (`queryIndex`) - never by its text - with the window and the visitor's
 * variable picks, and the server runs it
 * (Server/Utils/Dashboard/PublicDashboardPromQLPolicy).
 */
export const PUBLIC_DASHBOARD_PROMQL_QUERY_PATH: string = "/promql-query";
