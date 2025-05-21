import TeamMember from "../../Models/DatabaseModels/TeamMember";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ProjectUser";
import TeamMemberService from "./TeamMemberService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async refreshProjectUsersByProject(data: {
    projectId: ObjectID;
  }): Promise<void> {
    // get all team members by user

    // first delete all project users by project id.
    await this.deleteBy({
      query: {
        projectId: data.projectId,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // get all team members by project.
    const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
      select: {
        userId: true,
        teamId: true,
        team: {
          _id: true,
        },
        hasAcceptedInvitation: true,
      },
    });

    // create project users by team members.

    const projectUsersToCreate: Array<Model> = [];

    for (const teamMember of teamMembers) {
      // check if the user already exists in the project users.

      // if yes then add the team to the project user acceptedTeams, if the invitation is accepted.

      // if no then create a new project user.

      // if the user is not accepted the invitation then add the team to invitedTeams of the project user.

      // if the user is accepted the invitation then add the team to acceptedTeams of the project user.

      let doesProjectUserExist: boolean = false;

      for (const item of projectUsersToCreate) {
        if (item.userId?.toString() === teamMember.userId?.toString()) {
          doesProjectUserExist = true;
          break;
        }
      }

      if (doesProjectUserExist) {
        // add the team to the project user acceptedTeams, if the invitation is accepted.
        if (teamMember.hasAcceptedInvitation) {
          for (const projectUser of projectUsersToCreate) {
            if (
              projectUser.userId?.toString() === teamMember.userId?.toString()
            ) {
              if (!projectUser.acceptedTeams) {
                projectUser.acceptedTeams = [];
              }

              projectUser.acceptedTeams?.push(teamMember.team!);
            }
          }
        } else {
          for (const projectUser of projectUsersToCreate) {
            if (
              projectUser.userId?.toString() === teamMember.userId?.toString()
            ) {
              if (!projectUser.invitedTeams) {
                projectUser.invitedTeams = [];
              }

              projectUser.invitedTeams?.push(teamMember.team!);
            }
          }
        }
      } else {
        // create a new project user.
        const projectUser: Model = new Model();
        projectUser.userId = teamMember.userId!;
        projectUser.projectId = data.projectId;

        if (teamMember.hasAcceptedInvitation) {
          projectUser.acceptedTeams = [teamMember.team!];
        } else {
          projectUser.invitedTeams = [teamMember.team!];
        }

        projectUsersToCreate.push(projectUser);
      }
    }

    // now create the project users.

    for (const projectUser of projectUsersToCreate) {
      await this.create({
        data: projectUser,
        props: {
          isRoot: true,
        },
      });
    }
  }
}

export default new Service();
