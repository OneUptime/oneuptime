import CreateBy from "../../../Types/Database/CreateBy";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Team from "Model/Models/Team";
import TeamMember from "Model/Models/TeamMember";

export default class TeamMemberTestService {
  public static generateRandomTeamMember(
    projectId: ObjectID,
    userId: ObjectID,
    team: Team,
    miscDataProps?: JSONObject,
  ): CreateBy<TeamMember> {
    const teamMember: TeamMember = new TeamMember();

    // required fields
    teamMember.userId = userId;
    teamMember.projectId = projectId;
    teamMember.team = team;

    return {
      data: teamMember,
      props: { isRoot: true, userId },
      miscDataProps: miscDataProps as JSONObject,
    };
  }
}
