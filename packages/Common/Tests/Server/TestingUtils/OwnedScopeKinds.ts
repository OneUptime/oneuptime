/*
 * THE KINDS WITH OWNERS WHOSE READS THE OWNED SCOPE LEAVES ALONE, each with
 * the reason: other records are set up with them, so picking one - or
 * seeing who is on call - is reading it. Whoever may read such a kind reads
 * every one of its records, whatever the scope of their grant; a grant
 * scoped to Owned still changes and deletes only the ones its holder or
 * their teams own, and adds and removes owners only on those. Every other
 * kind of OwnerTableRegistry is narrowed on reads as well.
 *
 * Pinned here, apart from the registry it is checked against
 * (OwnedScopeEveryKindWithOwners), so that a kind added to the list, or
 * taken off it, is a deliberate change of this file and of its reason.
 */
export const KINDS_READ_BY_EVERY_READER: Readonly<Record<string, string>> = {
  OnCallDutyPolicySchedule:
    "An escalation rule pages a schedule as it pages a person or a team, and the people on a schedule see their turns on it, whoever owns it.",
  IncidentTemplate:
    "Everyone who declares incidents picks from the project's incident templates.",
  ScheduledMaintenanceTemplate:
    "Everyone who schedules maintenance picks from the project's maintenance templates.",
  Probe:
    "A monitor's probe picker lists the project's probes to everyone who may pick one.",
  Runner:
    "A runbook's steps, and a cluster's AI, run on a runner picked from the project's runners.",
  AIAgent: "Like a probe, an agent the project's AI work runs on.",
};

// Whether the Owned scope leaves reads of `kind` (a registry key) alone.
export function isReadByEveryReader(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(KINDS_READ_BY_EVERY_READER, kind);
}
