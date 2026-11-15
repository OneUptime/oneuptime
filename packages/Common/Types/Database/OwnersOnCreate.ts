/*
 * THE CREATES THAT TAKE THEIR RECORD'S OWNERS BESIDE IT (#8198).
 *
 * An incident's or an alert's create takes the owners it starts with in its
 * misc data - ownerUsers and ownerTeams, lists of ids - asks whether the
 * caller may add them before anything is saved
 * (OwnerRuleAssignment.checkOwnersPickedOnCreate), and adds them before the
 * owners' Created notification is let go, so the notification reaches them
 * rather than the project's owners (IncidentService, AlertService
 * onCreateSuccess). The REST create hands them over as miscDataProps, a
 * workflow's Create One step as its Owner Users and Owner Teams
 * (Types/Workflow/OwnersOnCreateSetting), and the MCP server's create tools
 * as inputs of their own (App/FeatureSet/MCP).
 */

// The misc data keys, as every caller and both services name them.
export const OWNER_USERS_ON_CREATE_KEY: string = "ownerUsers";
export const OWNER_TEAMS_ON_CREATE_KEY: string = "ownerTeams";

// The tables whose create takes them, by table name.
export const TABLES_TAKING_OWNERS_ON_CREATE: ReadonlyArray<string> = [
  "Alert",
  "Incident",
];

export function takesOwnersOnCreate(tableName: string | undefined): boolean {
  return (
    Boolean(tableName) && TABLES_TAKING_OWNERS_ON_CREATE.includes(tableName!)
  );
}
