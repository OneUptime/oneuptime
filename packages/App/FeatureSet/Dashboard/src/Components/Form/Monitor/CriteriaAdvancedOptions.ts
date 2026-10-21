import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";

/*
 * Whether a monitor rule's incident or alert holds anything in its
 * "Advanced Options" that the user chose. That is what opens the section when
 * the form loads, and what badges it "Configured" while it is folded.
 *
 * Advanced Options starts collapsed (as every Advanced section in the product
 * does), so only a choice that differs from what a new rule starts with
 * counts. Every default rule turns auto-resolve ON
 * (MonitorCriteriaInstance's templates), and counting that as configured
 * opened Advanced Options on the Offline rule of every new monitor. Turning
 * auto-resolve OFF is the choice worth surfacing: the same rule the SLO
 * burn-rate form follows ("a false auto-resolve value is configured").
 */

export function hasIncidentAdvancedOptions(
  incident: Pick<
    CriteriaIncident,
    | "autoResolveIncident"
    | "remediationNotes"
    | "showIncidentOnStatusPage"
    | "isPrivate"
  >,
): boolean {
  return (
    incident.autoResolveIncident === false ||
    Boolean(incident.remediationNotes?.trim()) ||
    incident.showIncidentOnStatusPage === false ||
    incident.isPrivate === true
  );
}

export function hasAlertAdvancedOptions(
  alert: Pick<
    CriteriaAlert,
    "autoResolveAlert" | "remediationNotes" | "isPrivate"
  >,
): boolean {
  return (
    alert.autoResolveAlert === false ||
    Boolean(alert.remediationNotes?.trim()) ||
    alert.isPrivate === true
  );
}
