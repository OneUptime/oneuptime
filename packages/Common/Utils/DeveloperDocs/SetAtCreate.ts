/*
 * COLUMNS ONEUPTIME SETS WHEN A RECORD IS MADE, AND NEVER AGAIN.
 *
 * A record's read-only columns are of two kinds to a client that plans
 * changes (the Terraform and OpenTofu provider):
 *
 *   - most change as the record lives - when it was last updated, its
 *     current status, whether its owners have been told, when a probe last
 *     reported - so an update's plan can only say "(known after apply)";
 *   - a few are set when the record is made and never change: when, by
 *     whom, in which project, its slug (DatabaseService.generateSlug runs
 *     on create only), the number an incident, an alert, an episode, a
 *     maintenance event or a security case is given (ProjectService takes
 *     it once, and a record keeps the prefix it was numbered with), and
 *     which of a project's teams are the ones it was made with.
 *
 * The second kind plans as its value in state: an update's plan lists what
 * changes and nothing else, where it listed a "(known after apply)" line for
 * each of them. Only columns that truly never change belong here - a value
 * that changed between a plan and its apply would fail the apply with
 * "Provider produced inconsistent result after apply". Whatever someone or
 * OneUptime may change later (an invitation's acceptance, isOwnerNotified,
 * archivedAt) stays "(known after apply)".
 *
 * SetAtCreate.test.ts holds each listed column to its model: it exists, and
 * nobody can write it after the record is made.
 */

// In every table that has them.
export const SET_AT_CREATE_IN_EVERY_TABLE: ReadonlyArray<string> = [
  "createdAt",
  "createdByUserId",
  "projectId",
  "slug",
];

// Table by table.
export const SET_AT_CREATE_BY_TABLE: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  // ProjectService makes a project's Owners, Admins and Members teams so.
  Team: [
    "isTeamEditable",
    "isTeamDeleteable",
    "isPermissionsEditable",
    "shouldHaveAtLeastOneMember",
  ],
  Incident: ["incidentNumber", "incidentNumberWithPrefix"],
  Alert: ["alertNumber", "alertNumberWithPrefix"],
  IncidentEpisode: ["episodeNumber", "episodeNumberWithPrefix"],
  AlertEpisode: ["episodeNumber", "episodeNumberWithPrefix"],
  ScheduledMaintenance: [
    "scheduledMaintenanceNumber",
    "scheduledMaintenanceNumberWithPrefix",
  ],
  SecurityCase: ["caseNumber", "caseNumberWithPrefix"],
};

// Whether OneUptime sets a column when the record is made, and never again.
export function isSetAtCreate(tableName: string, columnName: string): boolean {
  return (
    SET_AT_CREATE_IN_EVERY_TABLE.includes(columnName) ||
    Boolean(SET_AT_CREATE_BY_TABLE[tableName]?.includes(columnName))
  );
}
