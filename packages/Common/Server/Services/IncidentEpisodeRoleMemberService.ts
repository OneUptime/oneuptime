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

// And of a move to another role (#10274).
export const EPISODE_ROLE_REQUIRED_MESSAGE: string =
  "A person on an episode always holds a role. To take them off this one, remove them from it instead.";
export const MOVE_ONE_EPISODE_ROLE_AT_A_TIME_MESSAGE: string =
  "Move one person to another episode role at a time.";
export const ALREADY_HOLDS_TARGET_EPISODE_ROLE_MESSAGE: string =
  "This person already holds that role on this episode. To take them off the role they hold now, remove them from it instead.";

/*
 * A role row of the episode changed in one write, read once the caller may
 * make the write and carried to the episode's incidents once it is
 * written: the role handed from one person to another (Reassign, #10191),
 * the person moved to another role (#10274), or both at once.
 */
interface EpisodeRoleChange {
  memberId: ObjectID;
  incidentEpisodeId: ObjectID;
  projectId: ObjectID;
  fromUserId: ObjectID;
  toUserId: ObjectID;
  fromRoleId: ObjectID;
  toRoleId: ObjectID;
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
  // The changes onUpdatePermitted read, for onUpdateSuccess to carry on.
  private roleChanges: WeakMap<UpdateBy<Model>, EpisodeRoleChange> =
    new WeakMap<UpdateBy<Model>, EpisodeRoleChange>();

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
   *
   * AND A PERSON MOVED TO ANOTHER ROLE IN ONE WRITE (#10274), as an
   * incident's is: an update of the row's role is held to the same - one
   * row at a time, to a role the person does not hold on the episode yet -
   * and carried into the episode's incidents. One that names another person
   * and another role at once does both.
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

    const namesPerson: boolean = RelationIdUtil.isPresent(data, USER_KEYS);
    const namesRole: boolean = RelationIdUtil.isPresent(data, ROLE_KEYS);

    if (!namesPerson && !namesRole) {
      return;
    }

    const toUserId: ObjectID | null = namesPerson
      ? RelationIdUtil.readIntoIdColumn(data, USER_KEYS, "User")
      : null;

    if (namesPerson && !toUserId) {
      throw new BadDataException(EPISODE_ROLE_HOLDER_REQUIRED_MESSAGE);
    }

    const toRoleId: ObjectID | null = namesRole
      ? RelationIdUtil.readIntoIdColumn(data, ROLE_KEYS, "Incident Role")
      : null;

    if (namesRole && !toRoleId) {
      throw new BadDataException(EPISODE_ROLE_REQUIRED_MESSAGE);
    }

    const written: { row: Model | null; writesMore: boolean } =
      await this.findOneRowAndHoldUpdateToIt(updateBy, {
        _id: true,
        projectId: true,
        incidentEpisodeId: true,
        userId: true,
        incidentRoleId: true,
      });

    if (written.writesMore) {
      throw new BadDataException(
        namesPerson
          ? REASSIGN_ONE_EPISODE_ROLE_AT_A_TIME_MESSAGE
          : MOVE_ONE_EPISODE_ROLE_AT_A_TIME_MESSAGE,
      );
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

    const change: EpisodeRoleChange = {
      memberId: row.id,
      incidentEpisodeId: row.incidentEpisodeId,
      projectId: row.projectId,
      fromUserId: row.userId,
      toUserId: toUserId || row.userId,
      fromRoleId: row.incidentRoleId,
      toRoleId: toRoleId || row.incidentRoleId,
    };

    const isHandedOn: boolean = !isSameId(change.fromUserId, change.toUserId);
    const isMoved: boolean = !isSameId(change.fromRoleId, change.toRoleId);

    // The same person in the same role: nothing changes.
    if (!isHandedOn && !isMoved) {
      return;
    }

    const holdsItAlready: Model | null = await this.findOneBy({
      query: {
        incidentEpisodeId: row.incidentEpisodeId,
        userId: change.toUserId,
        incidentRoleId: change.toRoleId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (holdsItAlready) {
      throw new BadDataException(
        isHandedOn
          ? ALREADY_HOLDS_EPISODE_ROLE_MESSAGE
          : ALREADY_HOLDS_TARGET_EPISODE_ROLE_MESSAGE,
      );
    }

    this.roleChanges.set(updateBy, change);
  }

  /*
   * Once the episode's role row is changed: the same in each of its
   * incidents, as whoever changed it (FeedFollowOnWriteProps), and the
   * person who holds the role now brought into the episode's own channels.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const change: EpisodeRoleChange | undefined = this.roleChanges.get(
      onUpdate.updateBy,
    );

    if (change) {
      this.roleChanges.delete(onUpdate.updateBy);

      const wasWritten: boolean = updatedItemIds.some(
        (id: ObjectID): boolean => {
          return isSameId(id, change.memberId);
        },
      );

      if (wasWritten) {
        await this.changeRoleInIncidentsOfEpisode({
          change: change,
          props: FeedFollowOnWriteProps.get({
            props: onUpdate.updateBy.props,
          }),
        });

        this.inviteToEpisodeChannels({
          incidentEpisodeId: change.incidentEpisodeId,
          userId: change.toUserId,
          projectId: change.projectId,
        }).catch((error: Error) => {
          logger.error(error);
        });
      }
    }

    return await super.onUpdateSuccess(onUpdate, updatedItemIds);
  }

  /*
   * A role row of an episode changed, in each of its incidents: the
   * incident's row for the person in the role the episode gave them now
   * names the person and the role the episode's row names - one write, said
   * in the incident's feed as the incident's own change of it is ("Reassigned
   * ... from ... to ...", "Moved ... from ... to ..."). An incident where
   * the episode's row is held already only loses the other row; one where
   * nobody held it from the episode is given it, as the episode gives its
   * roles (propagateRoleToIncidentsInEpisode).
   */
  @CaptureSpan()
  private async changeRoleInIncidentsOfEpisode(data: {
    change: EpisodeRoleChange;
    // OneUptime's own write, naming who changed the episode's row.
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const change: EpisodeRoleChange = data.change;

    let episodeMembers: Array<IncidentEpisodeMember> = [];

    try {
      episodeMembers = await IncidentEpisodeMemberService.findBy({
        query: {
          incidentEpisodeId: change.incidentEpisodeId,
          projectId: change.projectId,
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
        `Failed to read the incidents of episode ${change.incidentEpisodeId.toString()} to change a role in them: ${error}`,
      );
      return;
    }

    // Each incident on its own: one that fails leaves the others as changed.
    for (const episodeMember of episodeMembers) {
      const incidentId: ObjectID | undefined = episodeMember.incidentId;

      if (!incidentId) {
        continue;
      }

      try {
        await this.changeRoleInIncident({
          incidentId: incidentId,
          change: change,
          props: data.props,
        });
      } catch (error) {
        logger.error(
          `Failed to change role ${change.fromRoleId.toString()} in incident ${incidentId.toString()} of episode ${change.incidentEpisodeId.toString()}: ${error}`,
        );
      }
    }
  }

  // The episode's change in one of its incidents (see above).
  private async changeRoleInIncident(data: {
    incidentId: ObjectID;
    change: EpisodeRoleChange;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const change: EpisodeRoleChange = data.change;

    const heldBy: (
      userId: ObjectID,
      incidentRoleId: ObjectID,
    ) => Promise<IncidentMember | null> = async (
      userId: ObjectID,
      incidentRoleId: ObjectID,
    ): Promise<IncidentMember | null> => {
      return await IncidentMemberService.findOneBy({
        query: {
          incidentId: data.incidentId,
          userId: userId,
          incidentRoleId: incidentRoleId,
          projectId: change.projectId,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });
    };

    const fromRow: IncidentMember | null = await heldBy(
      change.fromUserId,
      change.fromRoleId,
    );
    const toRow: IncidentMember | null = await heldBy(
      change.toUserId,
      change.toRoleId,
    );

    if (fromRow?.id && !toRow) {
      await IncidentMemberService.updateOneById({
        id: fromRow.id,
        data: {
          ...(isSameId(change.fromUserId, change.toUserId)
            ? {}
            : { userId: change.toUserId }),
          ...(isSameId(change.fromRoleId, change.toRoleId)
            ? {}
            : { incidentRoleId: change.toRoleId }),
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
    incidentMember.userId = change.toUserId;
    incidentMember.incidentRoleId = change.toRoleId;
    incidentMember.projectId = change.projectId;

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
