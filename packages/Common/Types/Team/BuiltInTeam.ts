/*
 * Why a team that comes with every project (Owners and Admin, whose
 * isTeamDeleteable is false) is never deleted. The server refuses with it
 * (TeamService), and the Teams list's locked Delete says it before anyone
 * clicks - the Dashboard holds the same English as a translation key
 * (BUILT_IN_TEAM_DELETE_REASON in Pages/Teams/Index.tsx; a test keeps the
 * two equal), so the refusal reads in the reader's language wherever it is
 * shown: the tooltip, a bulk Delete's list of what it did not delete, the
 * error dialog of the team's own Delete page.
 */
export const BUILT_IN_TEAM_DELETE_MESSAGE: string =
  "This team comes with every project and can't be deleted.";

/*
 * Why Owners and Admin (whose isTeamEditable is false) have no owners of
 * their own: their members are the project's owners and admins, and only
 * the permissions that come with those roles change who is in them - never a
 * team permission scoped to the teams someone owns. The server refuses an
 * owner for them with it (TeamOwnerUserService, TeamOwnerTeamService), and
 * such a team's page says it where other teams list their owners: the
 * Dashboard holds the same English as a translation key
 * (BUILT_IN_TEAM_OWNERS_REASON in Pages/Teams/View/Index.tsx; a test keeps
 * the two equal).
 */
export const BUILT_IN_TEAM_OWNERS_MESSAGE: string =
  "This team comes with every project and can't have owners.";
