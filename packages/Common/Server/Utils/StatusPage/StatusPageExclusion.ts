import StatusPage from "../../../Models/DatabaseModels/StatusPage";

/*
 * Why a status page that lists an incident's monitors does not reach it (see
 * IncidentStatusPageScope). Kept on its own so the delivery record can name
 * the reason without loading the services the scope helper queries.
 */
export enum StatusPageExclusionReason {
  // The incident is limited to other status pages.
  OutsideIncidentScope = "OutsideIncidentScope",
  // The page only shows incidents limited to it, and this one is not.
  OnlyShowsScopedIncidents = "OnlyShowsScopedIncidents",
}

export interface ExcludedStatusPage {
  statusPage: StatusPage;
  reason: StatusPageExclusionReason;
}
