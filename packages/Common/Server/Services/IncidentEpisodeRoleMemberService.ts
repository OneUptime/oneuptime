import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "../../Models/DatabaseModels/IncidentMember";
import IncidentMemberService from "./IncidentMemberService";
import IncidentEpisodeMember from "../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeMemberService from "./IncidentEpisodeMemberService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Model[] = await this.findBy({
      query: deleteBy.query,
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      props: {
        isRoot: true,
      },
      select: {
        incidentEpisodeId: true,
        projectId: true,
        userId: true,
        incidentRoleId: true,
      },
    });

    return {
      carryForward: {
        itemsToDelete: itemsToDelete,
      },
      deleteBy: deleteBy,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Model[] = onDelete.carryForward.itemsToDelete;

    // Remove the role assignment from all incidents in the episode
    for (const item of itemsToDelete) {
      await this.removeRoleFromIncidentsInEpisode({
        incidentEpisodeId: item.incidentEpisodeId!,
        userId: item.userId!,
        incidentRoleId: item.incidentRoleId!,
        projectId: item.projectId!,
      });
    }

    return onDelete;
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const incidentEpisodeId: ObjectID | undefined =
      createdItem.incidentEpisodeId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const incidentRoleId: ObjectID | undefined = createdItem.incidentRoleId;

    if (incidentEpisodeId && userId && projectId && incidentRoleId) {
      // Propagate role assignment to all incidents in the episode
      await this.propagateRoleToIncidentsInEpisode({
        incidentEpisodeId,
        userId,
        incidentRoleId,
        projectId,
      });
    }

    return createdItem;
  }

  @CaptureSpan()
  private async propagateRoleToIncidentsInEpisode(data: {
    incidentEpisodeId: ObjectID;
    userId: ObjectID;
    incidentRoleId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const { incidentEpisodeId, userId, incidentRoleId, projectId } = data;

    try {
      // Get all incidents in this episode
      const episodeMembers: Array<IncidentEpisodeMember> =
        await IncidentEpisodeMemberService.findBy({
          query: {
            incidentEpisodeId: incidentEpisodeId,
            projectId: projectId,
          },
          select: {
            incidentId: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      // Add the role to each incident
      for (const episodeMember of episodeMembers) {
        if (!episodeMember.incidentId) {
          continue;
        }

        // Check if the user already has this role on the incident
        const existingMember: IncidentMember | null =
          await IncidentMemberService.findOneBy({
            query: {
              incidentId: episodeMember.incidentId,
              userId: userId,
              incidentRoleId: incidentRoleId,
              projectId: projectId,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (existingMember) {
          // User already has this role on the incident
          continue;
        }

        // Create the incident member
        const incidentMember: IncidentMember = new IncidentMember();
        incidentMember.incidentId = episodeMember.incidentId;
        incidentMember.userId = userId;
        incidentMember.incidentRoleId = incidentRoleId;
        incidentMember.projectId = projectId;

        await IncidentMemberService.create({
          data: incidentMember,
          props: {
            isRoot: true,
          },
        });

        logger.debug(
          `Propagated role ${incidentRoleId.toString()} to incident ${episodeMember.incidentId.toString()} for user ${userId.toString()}`,
        );
      }
    } catch (error) {
      logger.error(
        `Failed to propagate role to incidents in episode: ${error}`,
      );
    }
  }

  @CaptureSpan()
  private async removeRoleFromIncidentsInEpisode(data: {
    incidentEpisodeId: ObjectID;
    userId: ObjectID;
    incidentRoleId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const { incidentEpisodeId, userId, incidentRoleId, projectId } = data;

    try {
      // Get all incidents in this episode
      const episodeMembers: Array<IncidentEpisodeMember> =
        await IncidentEpisodeMemberService.findBy({
          query: {
            incidentEpisodeId: incidentEpisodeId,
            projectId: projectId,
          },
          select: {
            incidentId: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      // Remove the role from each incident
      for (const episodeMember of episodeMembers) {
        if (!episodeMember.incidentId) {
          continue;
        }

        await IncidentMemberService.deleteBy({
          query: {
            incidentId: episodeMember.incidentId,
            userId: userId,
            incidentRoleId: incidentRoleId,
            projectId: projectId,
          },
          limit: 1,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        logger.debug(
          `Removed role ${incidentRoleId.toString()} from incident ${episodeMember.incidentId.toString()} for user ${userId.toString()}`,
        );
      }
    } catch (error) {
      logger.error(`Failed to remove role from incidents in episode: ${error}`);
    }
  }
}

export default new Service();
