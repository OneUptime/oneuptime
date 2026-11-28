import { translationKey, Translator } from "../Translator";

/*
 * Every string the day-by-day uptime history speaks: the accessible names on
 * the strip itself, and the chrome of the dialog a day opens.
 *
 * These live in one interface, rather than one per component, because a
 * caller who translates the strip must also translate the dialog it opens -
 * splitting them is how you end up with a French status page whose bars
 * announce themselves in French and whose dialog is in English.
 *
 * Every field has an English default (DefaultUptimeHistoryLabels). The
 * status page passes its own locale's words; the Dashboard passes the
 * defaults in the reader's language (getUptimeHistoryLabels), each default
 * a key of the Dashboard's locales. It passed nothing until #11433, so its
 * strips and dialogs read English in every language.
 */
export default interface UptimeHistoryLabels {
  /* Names the strip. {{total}} is the number of days it covers. */
  graphLabel: string;
  /* A day with data. {{date}}, {{uptime}}. */
  dayLabel: string;
  /* A day with data and incidents. {{date}}, {{uptime}}, {{total}}. */
  dayLabelWithIncidents: string;
  /* A day with no timeline rows at all. {{date}}. */
  dayLabelNoData: string;
  /* No timeline rows, but incidents. {{date}}, {{total}}. */
  dayLabelNoDataWithIncidents: string;
  /*
   * A day nothing checked the monitor because its monitoring was off
   * (UptimeDayBucket.monitoringOffSeconds with no coverage, issue #7112):
   * not a day with no data. {{date}}.
   */
  dayLabelMonitoringOff: string;
  /* The same, with incidents. {{date}}, {{total}}. */
  dayLabelMonitoringOffWithIncidents: string;
  /*
   * A day nothing checked the monitor because its checks were paused, with
   * no status set for it (UptimeDayBucket.pausedSeconds, issue #11433): by
   * an incident declared by hand, for scheduled maintenance, or by both.
   * Its time is left out of uptime as monitoring off's is, but monitoring
   * was paused, not turned off. {{date}}, and {{total}} with incidents.
   */
  dayLabelPausedByIncident: string;
  dayLabelPausedByIncidentWithIncidents: string;
  dayLabelPausedForMaintenance: string;
  dayLabelPausedForMaintenanceWithIncidents: string;
  dayLabelPausedByIncidentAndMaintenance: string;
  dayLabelPausedByIncidentAndMaintenanceWithIncidents: string;

  /* Dialog + tooltip body. */
  uptime: string;
  noMonitoringData: string;
  /* In place of noMonitoringData on a day monitoring was off. */
  monitoringOffOnThisDay: string;
  /*
   * Under a day's uptime when monitoring was off for part of it: the uptime
   * is of the rest. {{duration}}, written in the reader's language.
   */
  monitoringOffFor: string;
  /* In place of noMonitoringData on a day a pause left out (#11433). */
  pausedByIncidentOnThisDay: string;
  pausedForMaintenanceOnThisDay: string;
  pausedByIncidentAndMaintenanceOnThisDay: string;
  /*
   * Under a day's uptime when a pause left part of it out: the uptime is of
   * the rest. {{duration}}, written in the reader's language.
   */
  pausedByIncidentFor: string;
  pausedForMaintenanceFor: string;
  pausedByIncidentAndMaintenanceFor: string;
  incidents: string;
  noIncidents: string;
  noIncidentsDescription: string;
  /* Dialog subtitle when the day carried exactly one incident. */
  oneIncidentOnThisDay: string;
  /* Dialog subtitle for two or more. {{total}}. */
  incidentsOnThisDay: string;
  /* Prefixes an incident's declaration time: "Declared Mar 03 2026, 14:12". */
  declared: string;
  close: string;

  /*
   * Scheduled maintenance on a day (UptimeMaintenanceUtil): the heading of
   * its list in the tooltip and the dialog.
   */
  scheduledMaintenance: string;
  /*
   * A day's accessible name when it had maintenance: {{label}} is the name
   * the day has without it (dayLabel and the others above), {{maintenance}}
   * one of the two counts below.
   */
  dayLabelWithMaintenance: string;
  /* The day had exactly one maintenance event. */
  oneMaintenanceEvent: string;
  /* Two or more. {{total}}. */
  maintenanceEvents: string;
  /* Under the tooltip's first few events, for the rest. {{total}}. */
  moreMaintenance: string;
}

/*
 * Each default is a key of the Dashboard's locales (translationKey), so the
 * Dashboard words them all in the reader's language (getUptimeHistoryLabels).
 */
export const DefaultUptimeHistoryLabels: UptimeHistoryLabels = {
  graphLabel: translationKey("Uptime history for the last {{total}} days"),
  dayLabel: translationKey("{{date}}: {{uptime}}% uptime"),
  dayLabelWithIncidents: translationKey(
    "{{date}}: {{uptime}}% uptime, {{total}} incidents",
  ),
  dayLabelNoData: translationKey("{{date}}: no data"),
  dayLabelNoDataWithIncidents: translationKey(
    "{{date}}: no data, {{total}} incidents",
  ),
  dayLabelMonitoringOff: translationKey("{{date}}: monitoring off"),
  dayLabelMonitoringOffWithIncidents: translationKey(
    "{{date}}: monitoring off, {{total}} incidents",
  ),
  dayLabelPausedByIncident: translationKey("{{date}}: paused by an incident"),
  dayLabelPausedByIncidentWithIncidents: translationKey(
    "{{date}}: paused by an incident, {{total}} incidents",
  ),
  dayLabelPausedForMaintenance: translationKey(
    "{{date}}: paused for scheduled maintenance",
  ),
  dayLabelPausedForMaintenanceWithIncidents: translationKey(
    "{{date}}: paused for scheduled maintenance, {{total}} incidents",
  ),
  dayLabelPausedByIncidentAndMaintenance: translationKey(
    "{{date}}: paused by an incident and scheduled maintenance",
  ),
  dayLabelPausedByIncidentAndMaintenanceWithIncidents: translationKey(
    "{{date}}: paused by an incident and scheduled maintenance, {{total}} incidents",
  ),
  uptime: translationKey("Uptime"),
  noMonitoringData: translationKey("No monitoring data for this day"),
  monitoringOffOnThisDay: translationKey("Monitoring was off on this day"),
  monitoringOffFor: translationKey("Monitoring was off for {{duration}}"),
  pausedByIncidentOnThisDay: translationKey(
    "Monitoring was paused by an incident on this day",
  ),
  pausedForMaintenanceOnThisDay: translationKey(
    "Monitoring was paused for scheduled maintenance on this day",
  ),
  pausedByIncidentAndMaintenanceOnThisDay: translationKey(
    "Monitoring was paused by an incident and scheduled maintenance on this day",
  ),
  pausedByIncidentFor: translationKey("Paused by an incident for {{duration}}"),
  pausedForMaintenanceFor: translationKey(
    "Paused for scheduled maintenance for {{duration}}",
  ),
  pausedByIncidentAndMaintenanceFor: translationKey(
    "Paused by an incident and scheduled maintenance for {{duration}}",
  ),
  incidents: translationKey("Incidents"),
  noIncidents: translationKey("No incidents"),
  noIncidentsDescription: translationKey(
    "No incidents were reported on this day.",
  ),
  oneIncidentOnThisDay: translationKey("1 incident reported on this day"),
  incidentsOnThisDay: translationKey(
    "{{total}} incidents reported on this day",
  ),
  declared: translationKey("Declared"),
  close: translationKey("Close"),
  scheduledMaintenance: translationKey("Scheduled maintenance"),
  dayLabelWithMaintenance: translationKey("{{label}}, {{maintenance}}"),
  oneMaintenanceEvent: translationKey("1 maintenance event"),
  maintenanceEvents: translationKey("{{total}} maintenance events"),
  moreMaintenance: translationKey("+{{total}} more"),
};

/*
 * The defaults in the reader's language, for the Dashboard: each looked up
 * by its English, and English where the language has not worded it.
 */
export const getUptimeHistoryLabels: (
  translator: Translator,
) => UptimeHistoryLabels = (translator: Translator): UptimeHistoryLabels => {
  const labels: Record<string, string> = {};

  for (const [field, english] of Object.entries(DefaultUptimeHistoryLabels)) {
    labels[field] = translator.translateText(english) || english;
  }

  return labels as unknown as UptimeHistoryLabels;
};
