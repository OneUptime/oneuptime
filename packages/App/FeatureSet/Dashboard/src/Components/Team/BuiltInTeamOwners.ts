import Team from "Common/Models/DatabaseModels/Team";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Owners and Admin come with every project and have no owners: the server
 * refuses one for them (TeamService.assertTeamCanHaveOwners, in these words:
 * Common/Types/Team/BuiltInTeam). A team's page says so where every other
 * team lists its owners, and the Teams list's Add Owner and Remove Owner
 * leave such a team alone, saying why.
 */
export const BUILT_IN_TEAM_OWNERS_REASON: string = translationKey(
  "This team comes with every project and can't have owners.",
);

/*
 * Why a team takes no owners - one that comes with every project, whose
 * isTeamEditable is false - or undefined for every other team, and for one
 * whose isTeamEditable was not read: the server refuses what it must.
 */
export const getTeamOwnersDisabledReason: (team: Team) => string | undefined = (
  team: Team,
): string | undefined => {
  return team.isTeamEditable === false
    ? BUILT_IN_TEAM_OWNERS_REASON
    : undefined;
};
