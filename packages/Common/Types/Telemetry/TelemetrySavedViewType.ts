/*
 * Which explorer surface a saved telemetry view belongs to. Stored in the
 * nullable `viewType` column of MetricSavedView — NULL is treated as List
 * for back-compat (every row created before the column existed came from
 * the list page).
 */
enum TelemetrySavedViewType {
  List = "list",
  Explorer = "explorer",
}

export default TelemetrySavedViewType;
