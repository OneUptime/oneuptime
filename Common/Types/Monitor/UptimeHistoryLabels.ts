/*
 * Every string the day-by-day uptime history speaks: the accessible names on
 * the strip itself, and the chrome of the dialog a day opens.
 *
 * These live in one interface, rather than one per component, because a
 * caller who translates the strip must also translate the dialog it opens -
 * splitting them is how you end up with a French status page whose bars
 * announce themselves in French and whose dialog is in English.
 *
 * Every field has an English default (DefaultUptimeHistoryLabels), so the
 * dashboard - which is English-only, like the tooltip next to it - passes
 * nothing.
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

  /* Dialog + tooltip body. */
  uptime: string;
  noMonitoringData: string;
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
}

export const DefaultUptimeHistoryLabels: UptimeHistoryLabels = {
  graphLabel: "Uptime history for the last {{total}} days",
  dayLabel: "{{date}}: {{uptime}}% uptime",
  dayLabelWithIncidents: "{{date}}: {{uptime}}% uptime, {{total}} incidents",
  dayLabelNoData: "{{date}}: no data",
  dayLabelNoDataWithIncidents: "{{date}}: no data, {{total}} incidents",
  uptime: "Uptime",
  noMonitoringData: "No monitoring data for this day",
  incidents: "Incidents",
  noIncidents: "No incidents",
  noIncidentsDescription: "No incidents were reported on this day.",
  oneIncidentOnThisDay: "1 incident reported on this day",
  incidentsOnThisDay: "{{total}} incidents reported on this day",
  declared: "Declared",
  close: "Close",
};
