import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "../../Models/DatabaseModels/IncidentMember";
import IncidentMemberService from "./IncidentMemberService";
import IncidentEpisodeMember from "../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeMemberService from "./IncidentEpisodeMemberService";
import { OnCreate, OnDelete, OnFind } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import BadDataException from "../../Types/Exception/BadDataException";
import TeamMemberService from "./TeamMemberService";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import IncidentEpisodeService from "./IncidentEpisodeService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import FeedFollowOnWriteProps from "../Utils/Feed/FeedFollowOnWriteProps";
import FindBy from "../Types/Database/FindBy";
import CountBy from "../Types/Database/CountBy";
import PositiveNumber from "../../Types/PositiveNumber";
import { applyIncidentEpisodeRelatedRecordPrivacyFilter } from "../Utils/IncidentEpisode/IncidentEpisodePrivacyFilter";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The roles of a private incident episode are read only by those who see the
   * incident episode: its owners - the people named on it and the members of the
   * teams named on it - and the project's owners and admins
   * (applyIncidentEpisodeRelatedRecordPrivacyFilter), as every other part of one is
   * (PrivateRecordParts.test). Changing or deleting them follows
   * the private record rule (PrivateRecordPermission).
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyIncidentEpisodeRelatedRecordPrivacyFilter(findBy.query, findBy.props);
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentEpisodeRelatedRecordPrivacyFilter(countBy.query, countBy.props);
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    // The project the role is saved in: the request's, else the row's own.
    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    // The person, under either of their names (the two must agree).
    const userId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      createBy.data as unknown as Record<string, unknown>,
      ["userId", "user"],
      "User",
    );

    // Only a member of the project can hold a role on its episodes.
    if (
      projectId &&
      userId &&
      !(await TeamMemberService.isUserMemberOfProject({
        projectId: projectId,
        userId: userId,
      }))
    ) {
      throw new BadDataException(
        "This user is not a member of this project and cannot be assigned a role on this episode.",
      );
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // The members the delete removes, and the delete held to them.
    const itemsToDelete: Model[] = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        incidentEpisodeId: true,
        projectId: true,
        userId: true,
        incidentRoleId: true,
      },
    );

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

    /*
     * Remove the role assignment from all incidents in the episode, as
     * whoever took it off the episode: each incident's entry names them
     * (FeedFollowOnWriteProps).
     */
    const props: DatabaseCommonInteractionProps = FeedFollowOnWriteProps.get({
      props: onDelete.deleteBy.props,
      userId: onDelete.deleteBy.deletedByUser?.id,
    });

    for (const item of itemsToDelete) {
      await this.removeRoleFromIncidentsInEpisode({
        incidentEpisodeId: item.incidentEpisodeId!,
        userId: item.userId!,
        incidentRoleId: item.incidentRoleId!,
        projectId: item.projectId!,
        props: props,
      });
    }

    return onDelete;
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const incidentEpisodeId: ObjectID | undefined =
      createdItem.incidentEpisodeId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const incidentRoleId: ObjectID | undefined = createdItem.incidentRoleId;

    if (incidentEpisodeId && userId && projectId && incidentRoleId) {
      /*
       * Propagate role assignment to all incidents in the episode, as
       * whoever gave it on the episode: each incident's entry names them
       * (FeedFollowOnWriteProps). A grouping rule's is OneUptime's own.
       */
      await this.propagateRoleToIncidentsInEpisode({
        incidentEpisodeId,
        userId,
        incidentRoleId,
        projectId,
        props: FeedFollowOnWriteProps.get({
          props: onCreate.createBy.props,
          userId: createdItem.createdByUserId,
        }),
      });

      // And into the episode's own channels, when their rules add roles.
      this.inviteToEpisodeChannels({
        incidentEpisodeId,
        userId,
        projectId,
      }).catch((error: Error) => {
        logger.error(error);
      });
    }

    return createdItem;
  }

  /*
   * Somebody given a role on an episode joins the channels its rules
   * created that add the people given a role (NotificationRuleInvites), as
   * the incident's commander joins an incident's.
   */
  @CaptureSpan()
  private async inviteToEpisodeChannels(data: {
    incidentEpisodeId: ObjectID;
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const notificationRules: Array<WorkspaceNotificationRule> =
      await WorkspaceNotificationRuleService.getNotificationRulesWhereInviteRolesIsTrue(
        {
          projectId: data.projectId,
          notificationFor: {
            incidentEpisodeId: data.incidentEpisodeId,
          },
          notificationRuleEventType: NotificationRuleEventType.IncidentEpisode,
        },
      );

    if (notificationRules.length === 0) {
      return;
    }

    await WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: data.projectId,
        workspaceChannels:
          await IncidentEpisodeService.getWorkspaceChannelForEpisode({
            episodeId: data.incidentEpisodeId,
          }),
        userIds: [data.userId],
        notificationFor: {
          incidentEpisodeId: data.incidentEpisodeId,
        },
      },
    );
  }

  @CaptureSpan()
  private async propagateRoleToIncidentsInEpisode(data: {
    incidentEpisodeId: ObjectID;
    userId: ObjectID;
    incidentRoleId: ObjectID;
    projectId: ObjectID;
    // OneUptime's own write, naming who gave the role on the episode.
    props: DatabaseCommonInteractionProps;
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
          props: data.props,
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
    // OneUptime's own write, naming who took the role off the episode.
    props: DatabaseCommonInteractionProps;
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
          props: data.props,
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
