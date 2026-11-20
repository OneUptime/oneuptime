import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/IncidentMember";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import UserService from "./UserService";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import IncidentService from "./IncidentService";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import IncidentRole from "../../Models/DatabaseModels/IncidentRole";
import IncidentRoleService from "./IncidentRoleService";
import BadDataException from "../../Types/Exception/BadDataException";
import TeamMemberService from "./TeamMemberService";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";
import FeedApiKeyActorUtil from "../Utils/Feed/FeedApiKeyActor";
import FindBy from "../Types/Database/FindBy";
import CountBy from "../Types/Database/CountBy";
import PositiveNumber from "../../Types/PositiveNumber";
import { applyIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import IncidentRoleFeedText, {
  IncidentRoleAssignmentCause,
} from "../Utils/Incident/IncidentRoleFeedText";

/*
 * The names a role row's person and role are written under: the ID column
 * first (RelationIdUtil).
 */
const USER_KEYS: Array<string> = ["userId", "user"];
const ROLE_KEYS: Array<string> = ["incidentRoleId", "incidentRole"];

// Refusals of a Reassign, in the words of what the person was doing.
export const ROLE_HOLDER_REQUIRED_MESSAGE: string =
  "An incident role is always held by someone. To take this person off the role, remove them from it instead.";
export const REASSIGN_ONE_ROLE_AT_A_TIME_MESSAGE: string =
  "Reassign one incident role at a time.";
export const ALREADY_HOLDS_INCIDENT_ROLE_MESSAGE: string =
  "This person already holds this role on this incident. Choose someone else to hand it to.";

// And of a move to another role (#10274).
export const ROLE_REQUIRED_MESSAGE: string =
  "A person on an incident always holds a role. To take them off this one, remove them from it instead.";
export const MOVE_ONE_ROLE_AT_A_TIME_MESSAGE: string =
  "Move one person to another incident role at a time.";
export const ALREADY_HOLDS_TARGET_ROLE_MESSAGE: string =
  "This person already holds that role on this incident. To take them off the role they hold now, remove them from it instead.";

/*
 * A role row changed in one write, read once the caller may make the write
 * (onUpdatePermitted) and said in the incident's feed and its channels
 * once it is written (onUpdateSuccess): the role handed from one person to
 * another (Reassign, #10191), the person moved to another role (#10274),
 * or both at once - the person who held the old role taken off it, and the
 * one named given the new one.
 */
interface RoleChange {
  memberId: ObjectID;
  incidentId: ObjectID;
  projectId: ObjectID;
  fromUserId: ObjectID;
  toUserId: ObjectID;
  fromRoleId: ObjectID;
  toRoleId: ObjectID;
}

// What a change does: hands the role on, moves the person, or both.
type RoleChangeKind = "handOver" | "move" | "both";

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

const getRoleChangeKind: (change: RoleChange) => RoleChangeKind = (
  change: RoleChange,
): RoleChangeKind => {
  const isHandedOn: boolean = !isSameId(change.fromUserId, change.toUserId);
  const isMoved: boolean = !isSameId(change.fromRoleId, change.toRoleId);

  if (isHandedOn && isMoved) {
    return "both";
  }

  return isMoved ? "move" : "handOver";
};

export class Service extends ProjectReferencesService<Model> {
  // The changes onUpdatePermitted read, for onUpdateSuccess to tell.
  private roleChanges: WeakMap<UpdateBy<Model>, RoleChange> = new WeakMap<
    UpdateBy<Model>,
    RoleChange
  >();

  public constructor() {
    super(Model);
  }

  /*
   * The roles of a private incident are read only by those who see the
   * incident: its owners - the people named on it and the members of the
   * teams named on it - and the project's owners and admins
   * (applyIncidentRelatedRecordPrivacyFilter), as every other part of one is
   * (PrivateRecordParts.test). Changing or deleting them follows
   * the private record rule (PrivateRecordPermission).
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyIncidentRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentRelatedRecordPrivacyFilter(
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

    if (!createBy.data.incidentId) {
      throw new BadDataException("incidentId is required");
    }

    if (!createBy.data.userId) {
      throw new BadDataException("userId is required");
    }

    if (!createBy.data.incidentRoleId) {
      throw new BadDataException("incidentRoleId is required");
    }

    /*
     * Only a member of the project can hold a role on its incidents. The
     * automatic paths (commander auto-assignment, monitor criteria, episode
     * roles) skip a user who left before getting here; this is the backstop.
     */
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (
      projectId &&
      !(await TeamMemberService.isUserMemberOfProject({
        projectId: projectId,
        userId: createBy.data.userId,
      }))
    ) {
      throw new BadDataException(
        "This user is not a member of this project and cannot be assigned a role on this incident.",
      );
    }

    // Check if this user is already assigned to this role for this incident
    const existingMember: Model | null = await this.findOneBy({
      query: {
        incidentId: createBy.data.incidentId,
        userId: createBy.data.userId,
        incidentRoleId: createBy.data.incidentRoleId,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
      },
    });

    if (existingMember) {
      throw new BadDataException(
        "This user is already assigned to this role for this incident",
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
        incidentId: true,
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
    const deleteByUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    const itemsToDelete: Model[] = onDelete.carryForward.itemsToDelete;

    for (const item of itemsToDelete) {
      const incidentId: ObjectID | undefined = item.incidentId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;
      const incidentRoleId: ObjectID | undefined = item.incidentRoleId;

      if (incidentId && userId && projectId) {
        /*
         * The person taken off the role, as a link to them - by their
         * name, or their email when they never gave one. Nobody is named
         * for a person who is gone.
         */
        const person: MarkdownText = await UserService.getUserMarkdownString({
          userId: userId,
          projectId: projectId,
        });

        const roleName: string = await this.getRoleName(incidentRoleId);

        if (!person.isEmpty()) {
          const incident: MarkdownText = await this.getIncidentMarkdown({
            projectId: projectId,
            incidentId: incidentId,
          });

          /*
           * By whoever took them off - the person (the message in Slack
           * and Teams opens with them too), the API key, the workflow -
           * never the person taken off, unless they left the role
           * themselves.
           */
          await IncidentFeedService.createIncidentFeedItem({
            incidentId: incidentId,
            projectId: projectId,
            incidentFeedEventType: IncidentFeedEventType.IncidentMemberRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: IncidentRoleFeedText.getRemovedMarkdown({
              roleName: roleName,
              incident: incident,
              person: person,
              isSelf: deleteByUserId?.toString() === userId.toString(),
              workflowName: IncidentRoleFeedText.getWorkflowName(
                onDelete.deleteBy.props,
              ),
            }).toString(),
            userId: deleteByUserId || undefined,
            apiKeyActor: FeedApiKeyActorUtil.fromProps(onDelete.deleteBy.props),
            workspaceNotification: {
              sendWorkspaceNotification: true,
              leadWithAuthor: true,
            },
          });
        }
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const incidentId: ObjectID | undefined = createdItem.incidentId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const incidentRoleId: ObjectID | undefined = createdItem.incidentRoleId;
    /*
     * Why OneUptime gave the role by itself - the first person to change
     * the incident's state becomes its commander, a monitor's criteria
     * name people for its incidents - when it did (IncidentRoleFeedText).
     * The entry then says so, and has no author: nobody did it by hand.
     */
    const cause: IncidentRoleAssignmentCause | null =
      IncidentRoleFeedText.readCause({
        miscDataProps: onCreate.createBy.miscDataProps,
        props: onCreate.createBy.props,
      });

    const createdByUserId: ObjectID | undefined = cause
      ? undefined
      : createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (incidentId && userId && projectId) {
      const roleName: string = await this.getRoleName(incidentRoleId);

      const incident: MarkdownText = await this.getIncidentMarkdown({
        projectId: projectId,
        incidentId: incidentId,
      });

      /*
       * By whoever gave the role - the person (the message in Slack and
       * Teams opens with them too), the API key, the workflow, the monitor
       * - never the person given it, unless they took it themselves.
       */
      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incidentId,
        projectId: projectId,
        incidentFeedEventType: IncidentFeedEventType.IncidentMemberAdded,
        displayColor: Gray500,
        feedInfoInMarkdown: IncidentRoleFeedText.getAddedMarkdown({
          roleName: roleName,
          incident: incident,
          person: await UserService.getUserMarkdownString({
            userId: userId,
            projectId: projectId,
          }),
          isSelf: createdByUserId?.toString() === userId.toString(),
          workflowName: IncidentRoleFeedText.getWorkflowName(
            onCreate.createBy.props,
          ),
          cause: cause,
        }).toString(),
        userId: createdByUserId || undefined,
        apiKeyActor: FeedApiKeyActorUtil.fromProps(onCreate.createBy.props),
        workspaceNotification: {
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
        },
      });
    }

    await this.inviteToIncidentChannels({
      projectId: projectId!,
      incidentId: incidentId!,
      userId: userId!,
    });

    return createdItem;
  }

  /*
   * REASSIGN: A ROLE HANDED TO SOMEONE ELSE IN ONE WRITE (#10191).
   *
   * An update that names another person on a role row hands that role on:
   * the row keeps its incident and its role, so the role is never without
   * someone, and the write asks what any change of the row asks (Edit
   * Incident Member) - not the permission to take people off roles, which
   * Reassign used to need as a delete and then a create. A person who may
   * not delete the row was refused half way, in a sentence about deleting,
   * and a create refused after the delete went through left the role with
   * nobody. Asked here, once the caller may make the write:
   *
   *   - one row at a time: a role goes from one person to one person;
   *   - the person it goes to does not hold that role on the incident yet;
   *   - they are told of it as anyone given a role is: the row is marked as
   *     not told, for the job that tells the people of new rows
   *     (SendMemberAddedNotification).
   *
   * Whether they belong to the project is asked of every update that names
   * a person, before this (ProjectReferencesService).
   *
   * AND A PERSON MOVED TO ANOTHER ROLE IN ONE WRITE (#10274): an update of
   * the row's role - through the API, Terraform or a workflow's Update step
   * (Edit Incident Member) - is held to the same: one row at a time, to a
   * role the person does not hold on the incident yet, said in the feed and
   * told to them. One that names another person and another role at once
   * takes the old holder off the old role and gives the new one the new
   * role. An update that changes neither - a row's notes - is left as it
   * was.
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
      throw new BadDataException(ROLE_HOLDER_REQUIRED_MESSAGE);
    }

    const toRoleId: ObjectID | null = namesRole
      ? RelationIdUtil.readIntoIdColumn(data, ROLE_KEYS, "Incident Role")
      : null;

    if (namesRole && !toRoleId) {
      throw new BadDataException(ROLE_REQUIRED_MESSAGE);
    }

    const written: { row: Model | null; writesMore: boolean } =
      await this.findOneRowAndHoldUpdateToIt(updateBy, {
        _id: true,
        projectId: true,
        incidentId: true,
        userId: true,
        incidentRoleId: true,
      });

    if (written.writesMore) {
      throw new BadDataException(
        namesPerson
          ? REASSIGN_ONE_ROLE_AT_A_TIME_MESSAGE
          : MOVE_ONE_ROLE_AT_A_TIME_MESSAGE,
      );
    }

    const row: Model | null = written.row;

    if (
      !row ||
      !row.id ||
      !row.projectId ||
      !row.incidentId ||
      !row.userId ||
      !row.incidentRoleId
    ) {
      return;
    }

    const change: RoleChange = {
      memberId: row.id,
      incidentId: row.incidentId,
      projectId: row.projectId,
      fromUserId: row.userId,
      toUserId: toUserId || row.userId,
      fromRoleId: row.incidentRoleId,
      toRoleId: toRoleId || row.incidentRoleId,
    };

    // The same person in the same role: nothing changes.
    if (
      isSameId(change.fromUserId, change.toUserId) &&
      isSameId(change.fromRoleId, change.toRoleId)
    ) {
      return;
    }

    const kind: RoleChangeKind = getRoleChangeKind(change);

    const holdsItAlready: Model | null = await this.findOneBy({
      query: {
        incidentId: row.incidentId,
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
        kind === "move"
          ? ALREADY_HOLDS_TARGET_ROLE_MESSAGE
          : ALREADY_HOLDS_INCIDENT_ROLE_MESSAGE,
      );
    }

    // Told of the role the row gives them now, as a new row's person is.
    data["isMemberNotified"] = false;

    this.roleChanges.set(updateBy, change);
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const change: RoleChange | undefined = this.roleChanges.get(
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
        await this.tellOfRoleChange({
          change: change,
          props: onUpdate.updateBy.props,
        });
      }
    }

    return await super.onUpdateSuccess(onUpdate, updatedItemIds);
  }

  /*
   * A role row changed, in the incident's feed and its Slack and Teams
   * channels, by whoever changed it - and the person who holds the role
   * now brought into the incident's channels, as anyone given a role is:
   *
   *   - handed on: one entry (IncidentRoleFeedText.getReassignedMarkdown);
   *   - a person moved to another role: one entry ("Moved Maya Chen from
   *     Responder to Incident Commander", getMovedMarkdown);
   *   - both at once: the old holder taken off the old role and the new
   *     holder given the new one, as two entries say it.
   */
  private async tellOfRoleChange(data: {
    change: RoleChange;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const change: RoleChange = data.change;
    const kind: RoleChangeKind = getRoleChangeKind(change);
    const madeByUserId: ObjectID | undefined = data.props.userId;
    const workflowName: string | undefined =
      IncidentRoleFeedText.getWorkflowName(data.props);

    const to: MarkdownText = await UserService.getUserMarkdownString({
      userId: change.toUserId,
      projectId: change.projectId,
    });
    const incident: MarkdownText = await this.getIncidentMarkdown({
      projectId: change.projectId,
      incidentId: change.incidentId,
    });

    const tell: (entry: {
      markdown: MarkdownText;
      eventType: IncidentFeedEventType;
      color: typeof Gray500;
    }) => Promise<void> = async (entry: {
      markdown: MarkdownText;
      eventType: IncidentFeedEventType;
      color: typeof Gray500;
    }): Promise<void> => {
      await IncidentFeedService.createIncidentFeedItem({
        incidentId: change.incidentId,
        projectId: change.projectId,
        incidentFeedEventType: entry.eventType,
        displayColor: entry.color,
        feedInfoInMarkdown: entry.markdown.toString(),
        userId: madeByUserId || undefined,
        apiKeyActor: FeedApiKeyActorUtil.fromProps(data.props),
        workspaceNotification: {
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
        },
      });
    };

    if (!to.isEmpty() && kind === "handOver") {
      await tell({
        markdown: IncidentRoleFeedText.getReassignedMarkdown({
          roleName: await this.getRoleName(change.toRoleId),
          incident: incident,
          from: await UserService.getUserMarkdownString({
            userId: change.fromUserId,
            projectId: change.projectId,
          }),
          to: to,
          madeBy: isSameId(madeByUserId, change.toUserId)
            ? "to"
            : isSameId(madeByUserId, change.fromUserId)
              ? "from"
              : undefined,
          workflowName: workflowName,
        }),
        eventType: IncidentFeedEventType.IncidentMemberAdded,
        color: Gray500,
      });
    }

    if (!to.isEmpty() && kind === "move") {
      await tell({
        markdown: IncidentRoleFeedText.getMovedMarkdown({
          person: to,
          fromRoleName: await this.getRoleName(change.fromRoleId),
          toRoleName: await this.getRoleName(change.toRoleId),
          incident: incident,
          isSelf: isSameId(madeByUserId, change.toUserId),
          workflowName: workflowName,
        }),
        eventType: IncidentFeedEventType.IncidentMemberAdded,
        color: Gray500,
      });
    }

    if (kind === "both") {
      const from: MarkdownText = await UserService.getUserMarkdownString({
        userId: change.fromUserId,
        projectId: change.projectId,
      });

      if (!from.isEmpty()) {
        await tell({
          markdown: IncidentRoleFeedText.getRemovedMarkdown({
            roleName: await this.getRoleName(change.fromRoleId),
            incident: incident,
            person: from,
            isSelf: isSameId(madeByUserId, change.fromUserId),
            workflowName: workflowName,
          }),
          eventType: IncidentFeedEventType.IncidentMemberRemoved,
          color: Red500,
        });
      }

      if (!to.isEmpty()) {
        await tell({
          markdown: IncidentRoleFeedText.getAddedMarkdown({
            roleName: await this.getRoleName(change.toRoleId),
            incident: incident,
            person: to,
            isSelf: isSameId(madeByUserId, change.toUserId),
            workflowName: workflowName,
          }),
          eventType: IncidentFeedEventType.IncidentMemberAdded,
          color: Gray500,
        });
      }
    }

    await this.inviteToIncidentChannels({
      projectId: change.projectId,
      incidentId: change.incidentId,
      userId: change.toUserId,
    });
  }

  // A role's name as the feed says it: "Member" for a role it cannot read.
  private async getRoleName(
    incidentRoleId: ObjectID | undefined,
  ): Promise<string> {
    if (!incidentRoleId) {
      return "Member";
    }

    const role: IncidentRole | null = await IncidentRoleService.findOneById({
      id: incidentRoleId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return role?.name || "Member";
  }

  // The incident as a link to it: [Incident INC-18](...).
  private async getIncidentMarkdown(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<MarkdownText> {
    const incidentNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await IncidentService.getIncidentNumber({
      incidentId: data.incidentId,
    });
    const incidentNumberDisplay: string =
      incidentNumberResult.numberWithPrefix ||
      "#" + incidentNumberResult.number;

    return mdText`[Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(data.projectId, data.incidentId)).toString()})`;
  }

  /*
   * The rules whose channels somebody given a role joins: the Incident
   * Commander - often assigned as they acknowledge - and the others. This
   * read the owners' switch, so a rule that added the people paged but not
   * the owners never added the commander to its channel. The invites go
   * out in the background: a channel's failure is logged, never the
   * role's.
   */
  private async inviteToIncidentChannels(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    const notificationRules: Array<WorkspaceNotificationRule> =
      await WorkspaceNotificationRuleService.getNotificationRulesWhereInviteRolesIsTrue(
        {
          projectId: data.projectId,
          notificationFor: {
            incidentId: data.incidentId,
          },
          notificationRuleEventType: NotificationRuleEventType.Incident,
        },
      );

    WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: data.projectId,
        workspaceChannels: await IncidentService.getWorkspaceChannelForIncident(
          {
            incidentId: data.incidentId,
          },
        ),
        userIds: [data.userId],
        notificationFor: {
          incidentId: data.incidentId,
        },
      },
    ).catch((error: Error) => {
      logger.error(error);
    });
  }
}
export default new Service();
