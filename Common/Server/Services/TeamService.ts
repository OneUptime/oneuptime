import DeleteBy from "../Types/Database/DeleteBy";
import { OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/Team";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import TeamMemberService from "./TeamMemberService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async getTeamsUserIsAPartOf(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<Model>> {
    const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        userId: data.userId,
        projectId: data.projectId,
      },
      select: {
        team: {
          name: true,
          _id: true,
        },
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const teams: Array<Model> = [];

    for (const teamMember of teamMembers) {
      if (teamMember.team) {
        teams.push(teamMember.team);
      }
    }

    return teams;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // get teams by query.

    const teams: Array<Model> = await this.findBy({
      query: updateBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        name: true,
        isTeamEditable: true,
      },

      props: updateBy.props,
    });

    for (const team of teams) {
      if (!team.isTeamEditable) {
        throw new BadDataException(
          `${
            team.name || "This"
          } team cannot be updated because its a critical team for this project.`,
        );
      }
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const teams: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        name: true,
        isTeamDeleteable: true,
      },

      props: deleteBy.props,
    });

    for (const team of teams) {
      if (!team.isTeamDeleteable) {
        throw new BadDataException(
          `${
            team.name || "This"
          } team cannot be deleted its a critical team for this project.`,
        );
      }
    }

    return { deleteBy, carryForward: null };
  }
}
export default new Service();
