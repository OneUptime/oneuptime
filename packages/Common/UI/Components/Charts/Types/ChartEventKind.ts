/**
 * What a chart event marker represents. Drives the marker's ordering when
 * several markers collapse into one cluster (an incident outranks an alert,
 * which outranks a deploy) and the fallback colour when a caller gives none.
 */
enum ChartEventKind {
  Incident = "incident",
  Alert = "alert",
  Change = "change",
  Generic = "generic",
}

export default ChartEventKind;
