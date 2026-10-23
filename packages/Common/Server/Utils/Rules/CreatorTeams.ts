import ObjectID from "../../../Types/ObjectID";
import TeamMemberService from "../../Services/TeamMemberService";
import OwnerRulePlanBuilder from "./OwnerRulePlan";

/*
 * THE CREATOR'S TEAM, AS AN OWNER RULE ADDS IT.
 *
 * An incident or alert owner rule can list teams under Creator's Team
 * (creatorTeams): when the person who created the event is a member of one
 * of them, that team becomes an owner too. "Every team the creator is in"
 * would be the wrong answer in most projects: people are invited into the
 * project's Members team by default (Utils/DefaultInviteTeam), and teams are
 * also how permissions are handed out, so it would make Members - everyone -
 * an owner of every incident a person declares. A rule says which teams
 * count instead, and a team the creator is not in is not added.
 *
 * The creator is the person the event names as its creator: whoever
 * declared it in the dashboard, from Slack or Microsoft Teams, or through
 * the API with their own session. An event a monitor, a workflow, a form or
 * an API key creates has none, so a rule adds no creator's team to it. A
 * creator who has since left the project is in no team of it.
 *
 * Membership is an accepted one in the event's project
 * (TeamMemberService.getTeamIdsForUser), read once per evaluation, and only
 * when a matched rule lists teams.
 */
export default class CreatorTeams {
  private readonly projectId: ObjectID | null;
  private readonly creatorUserId: ObjectID | null;
  private memberOf: Promise<Set<string>> | null = null;

  public constructor(data: {
    projectId?: ObjectID | null | undefined;
    creatorUserId?: ObjectID | null | undefined;
  }) {
    this.projectId = data.projectId || null;
    this.creatorUserId = data.creatorUserId || null;
  }

  // Whether the event has a creator a team could be added for.
  public hasCreator(): boolean {
    return Boolean(this.projectId && this.creatorUserId);
  }

  /*
   * The teams of `listed` the creator is a member of, as text, in the order
   * the rule lists them. None for an event without a creator.
   */
  public async pick(
    listed: Array<{ id?: ObjectID | null | undefined }> | null | undefined,
  ): Promise<Array<string>> {
    const listedIds: Array<string> = OwnerRulePlanBuilder.idsOf(listed);

    if (listedIds.length === 0 || !this.hasCreator()) {
      return [];
    }

    const memberOf: Set<string> = await this.getTeamsOfCreator();

    return listedIds.filter((teamId: string): boolean => {
      return memberOf.has(teamId.toLowerCase());
    });
  }

  private getTeamsOfCreator(): Promise<Set<string>> {
    if (!this.memberOf) {
      this.memberOf = TeamMemberService.getTeamIdsForUser(
        this.creatorUserId!,
        this.projectId!,
      ).then((teamIds: Array<ObjectID>): Set<string> => {
        return new Set<string>(
          teamIds.map((teamId: ObjectID): string => {
            return teamId.toString().toLowerCase();
          }),
        );
      });
    }

    return this.memberOf;
  }
}
