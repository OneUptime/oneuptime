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
