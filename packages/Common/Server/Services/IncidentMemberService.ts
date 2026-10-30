import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/IncidentMember";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import UserService from "./UserService";
import { OnCreate, OnDelete, OnFind } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
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

export class Service extends ProjectReferencesService<Model> {
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
    findBy.query = applyIncidentRelatedRecordPrivacyFilter(findBy.query, findBy.props);
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentRelatedRecordPrivacyFilter(countBy.query, countBy.props);
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

        let roleName: string = "Member";
        if (incidentRoleId) {
          const role: IncidentRole | null =
            await IncidentRoleService.findOneById({
              id: incidentRoleId,
              select: {
                name: true,
              },
              props: {
                isRoot: true,
              },
            });
          if (role && role.name) {
            roleName = role.name;
          }
        }

        const incidentNumberResult: {
          number: number | null;
          numberWithPrefix: string | null;
        } = await IncidentService.getIncidentNumber({
          incidentId: incidentId,
        });
        const incidentNumberDisplay: string =
          incidentNumberResult.numberWithPrefix ||
          "#" + incidentNumberResult.number;

        if (!person.isEmpty()) {
          const incident: MarkdownText = mdText`[Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId!, incidentId!)).toString()})`;

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
      let roleName: string = "Member";
      if (incidentRoleId) {
        const role: IncidentRole | null = await IncidentRoleService.findOneById(
          {
            id: incidentRoleId,
            select: {
              name: true,
            },
            props: {
              isRoot: true,
            },
          },
        );
        if (role && role.name) {
          roleName = role.name;
        }
      }

      const incidentNumberResult: {
        number: number | null;
        numberWithPrefix: string | null;
      } = await IncidentService.getIncidentNumber({
        incidentId: incidentId,
      });
      const incidentNumberDisplay: string =
        incidentNumberResult.numberWithPrefix ||
        "#" + incidentNumberResult.number;

      if (userId) {
        const incident: MarkdownText = mdText`[Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId!, incidentId!)).toString()})`;

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
    }

    /*
     * The rules whose channels somebody given a role joins: the Incident
     * Commander - often assigned as they acknowledge - and the others. This
     * read the owners' switch, so a rule that added the people paged but
     * not the owners never added the commander to its channel.
     */
    const notificationRules: Array<WorkspaceNotificationRule> =
      await WorkspaceNotificationRuleService.getNotificationRulesWhereInviteRolesIsTrue(
        {
          projectId: projectId!,
          notificationFor: {
            incidentId: incidentId,
          },
          notificationRuleEventType: NotificationRuleEventType.Incident,
        },
      );

    WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: projectId!,
        workspaceChannels: await IncidentService.getWorkspaceChannelForIncident(
          {
            incidentId: incidentId!,
          },
        ),
        userIds: [userId!],
        notificationFor: {
          incidentId: incidentId,
        },
      },
    ).catch((error: Error) => {
      logger.error(error);
    });

    return createdItem;
  }
}
export default new Service();
