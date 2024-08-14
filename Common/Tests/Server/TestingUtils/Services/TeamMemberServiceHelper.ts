import ObjectID from "Common/Types/ObjectID";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";

export default class TeamMemberTestService {
  public static generateRandomTeamMember(data: {
    projectId: ObjectID;
    userId?: ObjectID | undefined;
    teamId: ObjectID;
  }): TeamMember {
    const teamMember: TeamMember = new TeamMember();

    // required fields
    if(data.userId) {
      teamMember.userId = data.userId;
    }
    
    teamMember.projectId = data.projectId;
    teamMember.teamId = data.teamId;

    return teamMember;
  }
}
