/*
 * What OneUptime did with a Huntress incident report, as recorded on its
 * HuntressIncidentReport row and shown in the connection's "Incident
 * reports" table, so "why did nobody get paged?" has an answer on screen.
 */
enum HuntressIncidentReportOutcome {
  /*
   * The report was claimed and its incident is being opened. A row left in
   * this state by an attempt that failed is opened again when Huntress
   * retries the delivery.
   */
  Opening = "Opening",
  // An incident was opened for the report.
  IncidentOpened = "IncidentOpened",
  /*
   * Huntress closed the report and its incident is resolved: by OneUptime
   * when the report closed, or by someone before that.
   */
  IncidentResolved = "IncidentResolved",
  // The report's organization is not one this connection watches.
  OrganizationNotWatched = "OrganizationNotWatched",
  // The first event OneUptime received said the report was already closed.
  ClosedBeforeReceived = "ClosedBeforeReceived",
}

export default HuntressIncidentReportOutcome;

export const AllHuntressIncidentReportOutcomes: Array<HuntressIncidentReportOutcome> =
  [
    HuntressIncidentReportOutcome.Opening,
    HuntressIncidentReportOutcome.IncidentOpened,
    HuntressIncidentReportOutcome.IncidentResolved,
    HuntressIncidentReportOutcome.OrganizationNotWatched,
    HuntressIncidentReportOutcome.ClosedBeforeReceived,
  ];

// Outcomes that opened an incident (whatever has happened to it since).
export function didHuntressOutcomeOpenIncident(
  outcome: HuntressIncidentReportOutcome | string | null | undefined,
): boolean {
  return (
    outcome === HuntressIncidentReportOutcome.IncidentOpened ||
    outcome === HuntressIncidentReportOutcome.IncidentResolved
  );
}

// Outcomes that decided, for good, that the report opens no incident.
export function isHuntressOutcomeSkipped(
  outcome: HuntressIncidentReportOutcome | string | null | undefined,
): boolean {
  return (
    outcome === HuntressIncidentReportOutcome.OrganizationNotWatched ||
    outcome === HuntressIncidentReportOutcome.ClosedBeforeReceived
  );
}
