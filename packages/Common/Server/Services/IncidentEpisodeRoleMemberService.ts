import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "../../Models/DatabaseModels/IncidentMember";
import IncidentMemberService from "./IncidentMemberService";
import IncidentEpisodeMember from "../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeMemberService from "./IncidentEpisodeMemberService";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
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

/*
 * The names a role row's person and role are written under: the ID column
 * first (RelationIdUtil).
 */
const USER_KEYS: Array<string> = ["userId", "user"];
const ROLE_KEYS: Array<string> = ["incidentRoleId", "incidentRole"];

// Refusals of a Reassign, in the words of what the person was doing.
export const EPISODE_ROLE_HOLDER_REQUIRED_MESSAGE: string =
  "An episode role is always held by someone. To take this person off the role, remove them from it instead.";
export const REASSIGN_ONE_EPISODE_ROLE_AT_A_TIME_MESSAGE: string =
  "Reassign one episode role at a time.";
export const ALREADY_HOLDS_EPISODE_ROLE_MESSAGE: string =
  "This person already holds this role on this episode. Choose someone else to hand it to.";

/*
 * A role handed from one person to another in one write (Reassign), read
 * once the caller may make the write and carried to the episode's
 * incidents once it is written.
 */
interface EpisodeRoleHandOver {
  memberId: ObjectID;
  incidentEpisodeId: ObjectID;
  projectId: ObjectID;
  incidentRoleId: ObjectID;
  fromUserId: ObjectID;
  toUserId: ObjectID;
}

// Two ids are one id in any case: ObjectID keeps the case it was handed.
const isSameId: (
  first: ObjectID | string | null | undefined,
  second: ObjectID | string | null | undefined,
) => boolean = (
  first: ObjectID | string | null | undefined,
  second: ObjectID | string | null | undefined,
): boolean => {
  if (!first || !second) {
    return false;
  }

  return first.toString().toLowerCase() === second.toString().toLowerCase();
};

export class Service extends ProjectReferencesService<Model> {
  // The hand-overs onUpdatePermitted read, for onUpdateSuccess to carry on.
  private handOvers: WeakMap<UpdateBy<Model>, EpisodeRoleHandOver> =
    new WeakMap<UpdateBy<Model>, EpisodeRoleHandOver>();

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
    findBy.query = applyIncidentEpisodeRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentEpisodeRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
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
   * REASSIGN: A ROLE HANDED TO SOMEONE ELSE IN ONE WRITE (#10191), as an
   * incident's is (IncidentMemberService.onUpdatePermitted): an update that
   * names another person on the row hands the role on, and asks what any
   * change of the row asks (Edit Incident Episode Role Member) - one row at
   * a time, to someone who does not hold that role on the episode yet.
   * Whether they belong to the project is asked of every update that names
   * a person, before this (ProjectReferencesService).
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await super.onUpdatePermitted(updateBy);

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (!RelationIdUtil.isPresent(data, USER_KEYS)) {
      return;
    }

    const toUserId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      USER_KEYS,
      "User",
    );

    if (!toUserId) {
      throw new BadDataException(EPISODE_ROLE_HOLDER_REQUIRED_MESSAGE);
    }

    const toRoleId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      ROLE_KEYS,
      "Incident Role",
    );

    const written: { row: Model | null; writesMore: boolean } =
      await this.findOneRowAndHoldUpdateToIt(updateBy, {
        _id: true,
        projectId: true,
        incidentEpisodeId: true,
        userId: true,
        incidentRoleId: true,
      });

    if (written.writesMore) {
      throw new BadDataException(REASSIGN_ONE_EPISODE_ROLE_AT_A_TIME_MESSAGE);
    }

    const row: Model | null = written.row;

    if (
      !row ||
      !row.id ||
      !row.projectId ||
      !row.incidentEpisodeId ||
      !row.userId ||
      !row.incidentRoleId
    ) {
      return;
    }

    // The same person: nothing is handed on.
    if (isSameId(toUserId, row.userId)) {
      return;
    }

    const incidentRoleId: ObjectID = toRoleId || row.incidentRoleId;

    const holdsItAlready: Model | null = await this.findOneBy({
      query: {
        incidentEpisodeId: row.incidentEpisodeId,
        userId: toUserId,
        incidentRoleId: incidentRoleId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (holdsItAlready) {
      throw new BadDataException(ALREADY_HOLDS_EPISODE_ROLE_MESSAGE);
    }

    this.handOvers.set(updateBy, {
      memberId: row.id,
      incidentEpisodeId: row.incidentEpisodeId,
      projectId: row.projectId,
      incidentRoleId: incidentRoleId,
      fromUserId: row.userId,
      toUserId: toUserId,
    });
  }

  /*
   * Once the episode's role is handed on: the same in each of its
   * incidents, as whoever handed it on (FeedFollowOnWriteProps), and the
   * person it went to brought into the episode's own channels.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const handOver: EpisodeRoleHandOver | undefined = this.handOvers.get(
      onUpdate.updateBy,
    );

    if (handOver) {
      this.handOvers.delete(onUpdate.updateBy);

      const wasWritten: boolean = updatedItemIds.some(
        (id: ObjectID): boolean => {
          return isSameId(id, handOver.memberId);
        },
      );

      if (wasWritten) {
        await this.handRoleOnInIncidentsOfEpisode({
          handOver: handOver,
          props: FeedFollowOnWriteProps.get({
            props: onUpdate.updateBy.props,
          }),
        });

        this.inviteToEpisodeChannels({
          incidentEpisodeId: handOver.incidentEpisodeId,
          userId: handOver.toUserId,
          projectId: handOver.projectId,
        }).catch((error: Error) => {
          logger.error(error);
        });
      }
    }

    return await super.onUpdateSuccess(onUpdate, updatedItemIds);
  }

  /*
   * A role handed on on an episode, in each of its incidents: the
   * incident's row for the person who held it names the person who holds
   * it now - one write, one "Reassigned" entry in the incident's feed. An
   * incident where the new person holds the role already only loses the
   * other row; one where nobody held it from the episode is given it, as
   * the episode gives its roles (propagateRoleToIncidentsInEpisode).
   */
  @CaptureSpan()
  private async handRoleOnInIncidentsOfEpisode(data: {
    handOver: EpisodeRoleHandOver;
    // OneUptime's own write, naming who handed the role on.
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const handOver: EpisodeRoleHandOver = data.handOver;

    let episodeMembers: Array<IncidentEpisodeMember> = [];

    try {
      episodeMembers = await IncidentEpisodeMemberService.findBy({
        query: {
          incidentEpisodeId: handOver.incidentEpisodeId,
          projectId: handOver.projectId,
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
    } catch (error) {
      logger.error(
        `Failed to read the incidents of episode ${handOver.incidentEpisodeId.toString()} to hand on a role: ${error}`,
      );
      return;
    }

    // Each incident on its own: one that fails leaves the others as handed on.
    for (const episodeMember of episodeMembers) {
      const incidentId: ObjectID | undefined = episodeMember.incidentId;

      if (!incidentId) {
        continue;
      }

      try {
        await this.handRoleOnInIncident({
          incidentId: incidentId,
          handOver: handOver,
          props: data.props,
        });
      } catch (error) {
        logger.error(
          `Failed to hand on role ${handOver.incidentRoleId.toString()} in incident ${incidentId.toString()} of episode ${handOver.incidentEpisodeId.toString()}: ${error}`,
        );
      }
    }
  }

  // The episode's hand-over in one of its incidents (see above).
  private async handRoleOnInIncident(data: {
    incidentId: ObjectID;
    handOver: EpisodeRoleHandOver;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const handOver: EpisodeRoleHandOver = data.handOver;

    const heldBy: (userId: ObjectID) => Promise<IncidentMember | null> = async (
      userId: ObjectID,
    ): Promise<IncidentMember | null> => {
      return await IncidentMemberService.findOneBy({
        query: {
          incidentId: data.incidentId,
          userId: userId,
          incidentRoleId: handOver.incidentRoleId,
          projectId: handOver.projectId,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });
    };

    const fromRow: IncidentMember | null = await heldBy(handOver.fromUserId);
    const toRow: IncidentMember | null = await heldBy(handOver.toUserId);

    if (fromRow?.id && !toRow) {
      await IncidentMemberService.updateOneById({
        id: fromRow.id,
        data: {
          userId: handOver.toUserId,
        },
        props: data.props,
      });
      return;
    }

    if (fromRow?.id && toRow) {
      await IncidentMemberService.deleteOneById({
        id: fromRow.id,
        props: data.props,
      });
      return;
    }

    if (toRow) {
      return;
    }

    const incidentMember: IncidentMember = new IncidentMember();
    incidentMember.incidentId = data.incidentId;
    incidentMember.userId = handOver.toUserId;
    incidentMember.incidentRoleId = handOver.incidentRoleId;
    incidentMember.projectId = handOver.projectId;

    await IncidentMemberService.create({
      data: incidentMember,
      props: data.props,
    });
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
