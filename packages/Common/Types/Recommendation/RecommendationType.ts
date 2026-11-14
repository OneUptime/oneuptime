/*
 * The kinds of recommendation OneUptime can surface.
 *
 * Recommendations are suggestions OneUptime derives from telemetry it already
 * has — "you have a Kubernetes cluster reporting HPA metrics but nothing
 * watching whether an HPA is pinned at max replicas". Today the only kind is
 * `Monitor` (create this monitor), but the surrounding machinery — the
 * dismissal table, the side-menu count, the page shell — is deliberately keyed
 * on this enum rather than on monitors, so a second kind (dashboards, cost
 * savings, retention policies) needs no schema change and no new page.
 *
 * The values ARE persisted, in `RecommendationDismissal.recommendationType`.
 * Renaming a member orphans every dismissal recorded under the old value, so
 * treat these strings as a migration surface.
 */
enum RecommendationType {
  Monitor = "Monitor",
  // A check a table's columns call for (Types/DataObservability/DataCheckSuggestions).
  DataCheck = "DataCheck",
  // A database the project knows of with no connection (Server/Utils/DataObservability/DataSourceSuggestions).
  DataSource = "DataSource",
  /*
   * A Setup health finding the team hides on purpose ("We do not page for
   * this on purpose"): the check as the recommendation, the record it is
   * about as the resource (Types/SetupHealth/SetupHealth).
   */
  SetupHealth = "SetupHealth",
}

export default RecommendationType;
