import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/Team";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import TeamMemberService from "./TeamMemberService";
import ProjectSCIMService from "./ProjectSCIMService";
import ModelPermission from "../Types/Database/Permissions/Index";

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

  private async assertScimAllowsTeamMutation(data: {
    projectIds: Array<ObjectID>;
    action: "create" | "delete";
  }): Promise<void> {
    if (!data.projectIds || data.projectIds.length === 0) {
      return;
    }

    const uniqueProjectIds: Map<string, ObjectID> = new Map();

    for (const projectId of data.projectIds) {
      if (projectId) {
        uniqueProjectIds.set(projectId.toString(), new ObjectID(projectId));
      }
    }

    for (const projectId of uniqueProjectIds.values()) {
      const scimCount: PositiveNumber = await ProjectSCIMService.countBy({
        query: {
          projectId: projectId,
          enablePushGroups: true,
        },
        skip: new PositiveNumber(0),
        limit: new PositiveNumber(1),
        props: {
          isRoot: true,
          tenantId: projectId,
        },
      });

      if (scimCount.toNumber() > 0) {
        throw new BadDataException(
          `Cannot ${data.action} teams while SCIM Push Groups is enabled for this project. Disable Push Groups to manage teams from OneUptime.`,
        );
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    let projectId: ObjectID | undefined = createBy.data.projectId;

    if (!projectId && createBy.props.tenantId) {
      projectId = new ObjectID(createBy.props.tenantId);
    }

    if (!projectId) {
      throw new BadDataException("Project ID cannot be null");
    }

    projectId = new ObjectID(projectId);
    createBy.data.projectId = projectId;

    if (!createBy.props.isRoot) {
      await this.assertScimAllowsTeamMutation({
        projectIds: [projectId],
        action: "create",
      });
    }

    return { createBy, carryForward: null };
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
        _id: true,
        name: true,
        isTeamDeleteable: true,
        projectId: true,
      },

      props: deleteBy.props,
    });

    const projectIds: Array<ObjectID> = teams
      .map((team: Model) => {
        return team.projectId;
      })
      .filter((projectId: ObjectID | undefined): projectId is ObjectID => {
        return Boolean(projectId);
      });

    if (deleteBy.props.isRoot !== true) {
      await this.assertScimAllowsTeamMutation({
        projectIds: projectIds,
        action: "delete",
      });
    }

    for (const team of teams) {
      if (!team.isTeamDeleteable) {
        throw new BadDataException(
          `${
            team.name || "This"
          } team cannot be deleted its a critical team for this project.`,
        );
      }
    }

    /*
     * Delete these teams' memberships THROUGH TeamMemberService before the
     * team rows go. The TeamMember.teamId FK is ON DELETE CASCADE, so leaving
     * the rows to Postgres would remove them hook-free: no token refresh, no
     * seat update, no notification-settings cleanup and no on-call cleanup —
     * a user whose ONLY team was deleted kept their schedule-layer and
     * escalation-rule assignments, their personal calendar feed stayed
     * enabled and the rotateWhenMemberLeaves feeds were never rotated, so
     * the schedule kept rotating onto (and paging) an ex-member. Runs after
     * the guards above so a refused delete removes nobody. Mirrors the SCIM
     * group-delete path, which already deletes members first for the same
     * reason.
     */
    const teamIds: Array<ObjectID> = teams
      .map((team: Model) => {
        return team.id;
      })
      .filter((teamId: ObjectID | null): teamId is ObjectID => {
        return Boolean(teamId);
      });

    if (teamIds.length > 0) {
      /*
       * DatabaseService checks DELETE permission AFTER this hook runs, and the
       * lookup above only needed READ permission. Since we are about to delete
       * rows on the caller's behalf, check the caller's delete permission on
       * Team FIRST — otherwise someone who may read teams but not delete them
       * would still wipe every membership before being refused. The framework
       * re-runs the same check on the untouched query straight after, so this
       * changes nothing for a caller who is allowed.
       */
      await ModelPermission.checkDeleteQueryPermission(
        Model,
        deleteBy.query,
        deleteBy.props,
      );

      await TeamMemberService.deleteBy({
        query: {
          teamId: QueryHelper.any(teamIds),
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    }

    return { deleteBy, carryForward: null };
  }
}
export default new Service();
