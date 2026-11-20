import { buildNotificationSms } from "../../Utils/Sms/NotificationSms";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import OnCallDutyPolicyEscalationRuleResponderService, {
  EscalationRuleResponder,
} from "./OnCallDutyPolicyEscalationRuleResponderService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import Dictionary from "../../Types/Dictionary";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import { SMSMessage } from "../../Types/SMS/SMS";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import DeleteBy from "../Types/Database/DeleteBy";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import UserService from "./UserService";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../Utils/TeamMember/PendingInviteeProfiles";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import {
  ESCALATION_RULE_USER_INDEX,
  EscalationRuleNames,
  getPersonOnRuleAlreadyRefusal,
} from "../../Types/OnCallDutyPolicy/EscalationRuleResponderOnce";
import User from "../../Models/DatabaseModels/User";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";
import OneUptimeDate from "../../Types/Date";
import { createWhatsAppMessageFromTemplate } from "../Utils/WhatsAppTemplateUtil";
import logger, { LogAttributes } from "../Utils/Logger";
import { WhatsAppMessagePayload } from "../../Types/WhatsApp/WhatsAppMessage";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";
import OnCallChatByWorkspace, {
  OnCallChatTextByWorkspaceType,
  OnCallChatWriter,
} from "../Utils/OnCall/OnCallChatByWorkspace";
import OnCallChatText from "../Utils/OnCall/OnCallChatText";
import OnDutyPoliciesCache from "../Utils/OnCall/OnDutyPoliciesCache";
import EscalationRuleReach, {
  EscalationRuleOfReach,
  LASTING_PATHS,
  ProjectUserPair,
  RuleMembers,
  RulePath,
  RuleReach,
} from "../Utils/OnCall/EscalationRuleReach";

export class Service extends OnCallDutyPolicyEscalationRuleResponderService<Model> {
  public constructor() {
    super(Model);
  }

  // One row per person on a rule (EscalationRuleResponderOnce).
  protected getResponderIndexName(): string {
    return ESCALATION_RULE_USER_INDEX;
  }

  protected readResponder(data: Model): EscalationRuleResponder | null {
    const ruleId: ObjectID | null = this.readRuleId(data);
    const userId: ObjectID | null = RelationIdUtil.readConsistent(
      data as unknown as Record<string, unknown>,
      ["userId", "user"],
      "User",
    );

    if (!ruleId || !userId) {
      return null;
    }

    return { ruleId: ruleId, columns: { userId: userId } };
  }

  /*
   * "The escalation rule "Level 1" of the on-call policy "Payments" pages
   * Ana Lopez already": the person as the project knows them - someone only
   * invited by the name typed for them, else the address they were invited
   * at (#9823) - else their address.
   */
  protected async getAlreadyOnRuleRefusal(data: {
    responder: EscalationRuleResponder;
    rule: EscalationRuleNames | null;
    projectId: ObjectID | null;
  }): Promise<string> {
    const userId: ObjectID = data.responder.columns["userId"] as ObjectID;

    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    const withheld: Map<string, WithheldProfile> = data.projectId
      ? await PendingInviteeProfiles.readWithheldProfilesInProject({
          userIds: [userId.toString()],
          projectId: data.projectId,
        })
      : new Map<string, WithheldProfile>();

    return getPersonOnRuleAlreadyRefusal({
      rule: data.rule,
      person: PendingInviteeProfiles.getNameInProject({
        userId: userId,
        name: user?.name,
        email: user?.email,
        withheld: withheld,
      }),
    });
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const createdItemId: ObjectID = createdItem.id!;

    if (!createdItemId) {
      throw new BadDataException("Created item does not have an ID");
    }

    // Someone else is paged by the rule now: the header says so at once.
    await OnDutyPoliciesCache.forgetProjects([createdItem.projectId]);

    const createdModel: Model | null = await this.findOneById({
      id: createdItemId,
      select: {
        projectId: true,
        user: {
          timezone: true,
          _id: true,
        },
        onCallDutyPolicyEscalationRule: {
          name: true,
          _id: true,
          order: true,
        },
        onCallDutyPolicy: {
          name: true,
          _id: true,
        },
        createdByUserId: true,
      },
      props: {
        isRoot: true,
      },
    });

    // send notification to the new current user.

    const sendEmailToUserId: ObjectID | undefined | null =
      createdModel?.user?.id;

    if (!sendEmailToUserId) {
      return createdItem;
    }

    if (!createdModel) {
      return createdItem;
    }

    /*
     * Who the rule pages now, and through what (EscalationRuleReach): this
     * row pages a member of the project from now on, and someone only
     * invited once they join - nothing reaches them before, not this
     * message nor an on-call time log. They hear "added" once for the rule:
     * not when a row made before this one - one of its teams they are in -
     * pages them already. A read that fails tells and logs them as before.
     */
    const paths: Array<RulePath> | null = await this.readPathsOfRow({
      row: createdModel,
      withSchedules: false,
    });
    const isPagedByRow: boolean =
      paths === null || EscalationRuleReach.isPagedByRow(paths, createdItemId);
    const isNewToRule: boolean =
      paths === null ||
      (isPagedByRow &&
        !EscalationRuleReach.wasPagedBefore({
          paths: paths,
          rowId: createdItemId,
          kinds: LASTING_PATHS,
        }));

    if (isNewToRule) {
      await this.tellAdded(createdModel, sendEmailToUserId);
    }

    // add workspace message.

    const onCallDutyPolicyId: ObjectID | undefined | null =
      createdModel.onCallDutyPolicy!.id;
    const projectId: ObjectID | undefined = createdModel.projectId;

    if (onCallDutyPolicyId) {
      await this.writeAddedToFeed({
        createdModel: createdModel,
        projectId: projectId!,
        onCallDutyPolicyId: onCallDutyPolicyId,
      });

      // Their on-call time on this rule, by name, while it pages them.
      if (isPagedByRow) {
        OnCallDutyPolicyTimeLogService.startTimeLogForUser({
          projectId: projectId!,
          onCallDutyPolicyId: onCallDutyPolicyId!,
          onCallDutyPolicyEscalationRuleId:
            createdModel.onCallDutyPolicyEscalationRule!.id!,
          userId: createdModel.user!.id!,
          startsAt: OneUptimeDate.getCurrentDate(),
        }).catch((error: Error) => {
          logger.error(
            `Error starting time log for user ${createdModel.user?.id}: ${error}`,
            {
              projectId: projectId?.toString(),
              userId: createdModel.user?.id?.toString(),
            } as LogAttributes,
          );
        });
      }
    }

    return createdItem;
  }

  /*
   * The paths by which the rule of `row` pages its person now
   * (EscalationRuleReach): none for someone it does not page, null when they
   * could not be read.
   */
  private async readPathsOfRow(data: {
    row: Model;
    withSchedules: boolean;
  }): Promise<Array<RulePath> | null> {
    const userId: ObjectID | undefined = data.row.user?.id || data.row.userId;
    const rule: EscalationRuleOfReach = this.getRuleOfRow(data.row);

    if (!userId || !rule.ruleId || !rule.projectId) {
      return null;
    }

    const reach: RuleReach | null = await EscalationRuleReach.readOrNull({
      ...rule,
      withSchedules: data.withSchedules,
    });

    return reach ? EscalationRuleReach.getPaths(reach, userId) : null;
  }

  // "You have been added to the on-call policy ...", as their settings say.
  private async tellAdded(
    createdModel: Model,
    sendEmailToUserId: ObjectID,
  ): Promise<void> {
    const vars: Dictionary<string> = {
      onCallPolicyName:
        createdModel.onCallDutyPolicy?.name || "No name provided",
      escalationRuleName:
        createdModel.onCallDutyPolicyEscalationRule?.name || "No name provided",
      escalationRuleOrder:
        createdModel.onCallDutyPolicyEscalationRule?.order?.toString() ||
        "No order provided",
      reason: "You have been added to the on-call policy escalation rule.",
      onCallPolicyViewLink: (
        await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
          createdModel!.projectId!,
          createdModel.onCallDutyPolicy!.id!,
        )
      ).toString(),
    };

    // current user changed, send alert the new current user.
    const emailMessage: EmailEnvelope = {
      templateType: EmailTemplateType.UserAddedToOnCallPolicy,
      vars: vars,
      subject: `You have been added to the on-call policy ${createdModel.onCallDutyPolicy?.name}`,
      isSubjectLiteral: true,
    };

    const sms: SMSMessage = {
      message: buildNotificationSms(
        `You have been added to the on-call policy ${createdModel.onCallDutyPolicy?.name} for escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}.`,
      ),
    };

    const callMessage: CallRequestMessage = {
      data: [
        {
          sayMessage: `This is a message from OneUptime. You have been added to the on-call policy ${createdModel.onCallDutyPolicy?.name} for escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye`,
        },
      ],
    };

    const pushMessage: PushNotificationMessage =
      PushNotificationUtil.createOnCallPolicyAddedNotification({
        policyName: createdModel.onCallDutyPolicy?.name || "",
      });

    const eventType: NotificationSettingEventType =
      NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY;

    const whatsAppMessage: WhatsAppMessagePayload =
      createWhatsAppMessageFromTemplate({
        eventType,
        templateVariables: {
          on_call_policy_name:
            createdModel.onCallDutyPolicy?.name || "No name provided",
          on_call_context: `escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name || "No name provided"}`,
          policy_link: vars["onCallPolicyViewLink"] || "",
        },
      });

    await UserNotificationSettingService.sendUserNotification({
      userId: sendEmailToUserId,
      projectId: createdModel!.projectId!,
      emailEnvelope: emailMessage,
      smsMessage: sms,
      callRequestMessage: callMessage,
      pushNotificationMessage: pushMessage,
      whatsAppMessage,
      eventType,
      onCallPolicyId: createdModel.onCallDutyPolicy!.id!,
      onCallPolicyEscalationRuleId:
        createdModel.onCallDutyPolicyEscalationRule!.id!,
    });
  }

  /*
   * "Added Ana to ... escalation rule ...": the policy's feed and its
   * channels hear of every row, whoever else names the person - it is a
   * change to the policy.
   */
  private async writeAddedToFeed(data: {
    createdModel: Model;
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID;
  }): Promise<void> {
    const { createdModel, projectId, onCallDutyPolicyId } = data;

    const addedUserMarkdown: MarkdownText =
      await UserService.getUserMarkdownString({
        userId: createdModel.user!.id!,
        projectId: projectId,
      });

    const policyLink: string = (
      await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
        projectId,
        onCallDutyPolicyId,
      )
    ).toString();

    const chatPolicy: MarkdownText = OnCallChatText.policy({
      name: createdModel.onCallDutyPolicy?.name || "",
      link: policyLink,
    });

    const addedUserId: ObjectID = createdModel.user!.id!;

    // Each workspace's line names them as it knows them (issue #7967).
    const chatInfoByWorkspaceType: OnCallChatTextByWorkspaceType =
      await new OnCallChatByWorkspace({
        projectId: projectId,
      }).write(async (writer: OnCallChatWriter): Promise<MarkdownText> => {
        return OnCallChatText.policyChange({
          emoji: "👨🏻‍💻",
          isAdded: true,
          what: mdText`**${await writer.nameOf(addedUserId)}**`,
          policy: chatPolicy,
        });
      });

    await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
      onCallDutyPolicyId: onCallDutyPolicyId,
      projectId: projectId,
      onCallDutyPolicyFeedEventType: OnCallDutyPolicyFeedEventType.UserAdded,
      displayColor: Gray500,
      feedInfoInMarkdown:
        mdText`👨🏻‍💻 Added **${addedUserMarkdown}** to the [On-Call Policy ${createdModel.onCallDutyPolicy?.name}](${policyLink}) escalation rule **${createdModel.onCallDutyPolicyEscalationRule?.name}** with order **${createdModel.onCallDutyPolicyEscalationRule?.order}**.`.toString(),
      // The channels hear who and the policy, not the rule (issue #7549).
      chatInfoInMarkdown: OnCallChatText.policyChange({
        emoji: "👨🏻‍💻",
        isAdded: true,
        what: mdText`**${addedUserMarkdown}**`,
        policy: chatPolicy,
      }).toString(),
      chatInfoByWorkspaceType: chatInfoByWorkspaceType,
      userId: createdModel.createdByUserId! || undefined,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        leadWithAuthor: true,
      },
    });
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // The rows the delete removes, and the delete held to them.
    const itemsToFetchBeforeDelete: Array<Model> =
      await this.findRowsAndHoldDeleteToThem(deleteBy, {
        projectId: true,
        user: {
          timezone: true,
          _id: true,
        },
        onCallDutyPolicyEscalationRule: {
          name: true,
          _id: true,
          order: true,
        },
        onCallDutyPolicy: {
          name: true,
          _id: true,
        },
        createdByUserId: true,
      });

    const deleteByUserId: ObjectID | undefined =
      deleteBy.deletedByUser?.id || deleteBy.props.userId;

    for (const item of itemsToFetchBeforeDelete) {
      const onCallDutyPolicyId: ObjectID | undefined =
        item.onCallDutyPolicy!.id!;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.user!.id!;

      if (onCallDutyPolicyId && userId && projectId) {
        const user: User | null = await UserService.findOneById({
          id: userId,
          select: {
            name: true,
            email: true,
          },
          props: {
            isRoot: true,
          },
        });

        // Someone only invited is named as the project knows them (#9823).
        await PendingInviteeProfiles.nameInProject({
          users: [user],
          projectId: projectId,
        });

        const onCallDutyPolicyName: string | null =
          item.onCallDutyPolicy?.name || "No name provided";

        if (user && user.name) {
          const policyLink: string = (
            await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
              projectId!,
              onCallDutyPolicyId!,
            )
          ).toString();

          const chatPolicy: MarkdownText = OnCallChatText.policy({
            name: onCallDutyPolicyName || "",
            link: policyLink,
          });

          // Each workspace's line names them as it knows them (#7967).
          const chatInfoByWorkspaceType: OnCallChatTextByWorkspaceType =
            await new OnCallChatByWorkspace({
              projectId: projectId,
            }).write(
              async (writer: OnCallChatWriter): Promise<MarkdownText> => {
                return OnCallChatText.policyChange({
                  emoji: "👨🏻‍💻",
                  isAdded: false,
                  what: mdText`**${await writer.nameOf(userId)}**`,
                  policy: chatPolicy,
                });
              },
            );

          await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
            onCallDutyPolicyId: onCallDutyPolicyId,
            projectId: projectId,
            /*
             * A person taken out of an escalation rule: the policy pages
             * them no more. It was filed as an owner removed, so the
             * channels whose rules chose owners heard of it, and those that
             * chose changes to the policy did not.
             */
            onCallDutyPolicyFeedEventType:
              OnCallDutyPolicyFeedEventType.UserRemoved,
            displayColor: Red500,
            feedInfoInMarkdown:
              mdText`👨🏻‍💻 Removed **${user.name.toString()}** (${user.email?.toString()}) from the [On-Call Policy ${onCallDutyPolicyName}](${policyLink}) for escalation rule ${item.onCallDutyPolicyEscalationRule?.name} with order ${item.onCallDutyPolicyEscalationRule?.order}.`.toString(),
            chatInfoInMarkdown: OnCallChatText.policyChange({
              emoji: "👨🏻‍💻",
              isAdded: false,
              what: mdText`**${user.name.toString()}**`,
              policy: chatPolicy,
            }).toString(),
            chatInfoByWorkspaceType: chatInfoByWorkspaceType,
            userId: deleteByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              leadWithAuthor: true,
            },
          });
        }

        /*
         * Close the removed user's open on-call time log. This MUST run
         * independently of whether the user has a display name — invited users
         * who have not finished signup commonly have a null/empty name, and the
         * ADD path (onCreateSuccess) opens their time log regardless of name.
         * Nesting this inside `if (user && user.name)` left those users' logs
         * open forever, showing them as perpetually on-call in reporting
         * (audit F19).
         */
        OnCallDutyPolicyTimeLogService.endTimeLogForUser({
          projectId: projectId,
          onCallDutyPolicyId: onCallDutyPolicyId,
          onCallDutyPolicyEscalationRuleId:
            item.onCallDutyPolicyEscalationRule!.id!,
          userId: userId,
          endsAt: OneUptimeDate.getCurrentDate(),
        }).catch((error: Error) => {
          logger.error(`Error ending time log for user ${userId}: ${error}`, {
            projectId: projectId?.toString(),
            userId: userId?.toString(),
          } as LogAttributes);
        });
      }
    }

    return {
      deleteBy,
      carryForward: {
        deletedItems: itemsToFetchBeforeDelete,
      },
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deletedItems: Array<Model> = onDelete.carryForward.deletedItems;

    // Nobody the rule paged is on duty for it any more.
    await OnDutyPoliciesCache.forgetProjects(
      deletedItems.map((deletedItem: Model) => {
        return deletedItem.projectId;
      }),
    );

    /*
     * Each person is told they were removed only when nothing on the rule
     * pages them any more (EscalationRuleReach): not while one of its teams
     * they are in, a schedule of it they are on call in, or its next in
     * rotation still does - their time log stays open on those instead. A
     * member of the project is told; someone only invited, or who has left,
     * was told nothing when they were added and is told nothing now.
     */
    const reachByRule: Map<string, RuleReach | null> =
      await EscalationRuleReach.readEach({
        rules: deletedItems.map((deletedItem: Model): EscalationRuleOfReach => {
          return this.getRuleOfRow(deletedItem);
        }),
        withSchedules: true,
      });

    const members: RuleMembers = await EscalationRuleReach.readMembers(
      deletedItems
        .filter((deletedItem: Model): boolean => {
          return Boolean(deletedItem.projectId && deletedItem.user?.id);
        })
        .map((deletedItem: Model): ProjectUserPair => {
          return {
            projectId: deletedItem.projectId!,
            userId: deletedItem.user!.id!,
          };
        }),
    );

    // One message for one person on one rule, however many rows went.
    const told: Set<string> = new Set<string>();

    for (const deletedItem of deletedItems) {
      const sendEmailToUserId: ObjectID | undefined | null =
        deletedItem.user?.id;

      if (!sendEmailToUserId || !deletedItem.projectId) {
        continue;
      }

      const rule: EscalationRuleOfReach = this.getRuleOfRow(deletedItem);
      const reach: RuleReach | null | undefined = reachByRule.get(
        EscalationRuleReach.getRuleKey(rule),
      );
      const paths: Array<RulePath> = reach
        ? EscalationRuleReach.getPaths(reach, sendEmailToUserId)
        : [];

      if (paths.length > 0) {
        EscalationRuleReach.keepTimeLogsOpen({
          ...rule,
          policyId: deletedItem.onCallDutyPolicy!.id!,
          userId: sendEmailToUserId,
          paths: paths,
        });

        continue;
      }

      const toldKey: string = `${EscalationRuleReach.getRuleKey(rule)}:${sendEmailToUserId.toString().toLowerCase()}`;

      if (
        told.has(toldKey) ||
        !members.isMember(deletedItem.projectId, sendEmailToUserId)
      ) {
        continue;
      }

      told.add(toldKey);

      const vars: Dictionary<string> = {
        onCallPolicyName:
          deletedItem.onCallDutyPolicy?.name || "No name provided",
        escalationRuleName:
          deletedItem.onCallDutyPolicyEscalationRule?.name ||
          "No name provided",
        escalationRuleOrder:
          deletedItem.onCallDutyPolicyEscalationRule?.order?.toString() ||
          "No order provided",
        reason:
          "You have been removed from the on-call policy escalation rule.",
        onCallPolicyViewLink: (
          await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
            deletedItem!.projectId!,
            deletedItem.onCallDutyPolicy!.id!,
          )
        ).toString(),
      };

      // current user changed, send alert the new current user.
      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.UserRemovedFromOnCallPolicy,
        vars: vars,
        subject: `You have been removed from the on-call policy ${deletedItem.onCallDutyPolicy?.name}`,
        isSubjectLiteral: true,
      };

      const sms: SMSMessage = {
        message: buildNotificationSms(
          `You have been removed from the on-call policy ${deletedItem.onCallDutyPolicy?.name} for escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}.`,
        ),
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. You have been removed from the on-call policy ${deletedItem.onCallDutyPolicy?.name} for escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye`,
          },
        ],
      };

      const pushMessage: PushNotificationMessage =
        PushNotificationUtil.createOnCallPolicyRemovedNotification({
          policyName: deletedItem.onCallDutyPolicy?.name || "",
        });

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY;

      const whatsAppMessage: WhatsAppMessagePayload =
        createWhatsAppMessageFromTemplate({
          eventType,
          templateVariables: {
            on_call_policy_name:
              deletedItem.onCallDutyPolicy?.name || "No name provided",
            on_call_context: `escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name || "No name provided"}`,
            policy_link: vars["onCallPolicyViewLink"] || "",
          },
        });

      UserNotificationSettingService.sendUserNotification({
        userId: sendEmailToUserId,
        projectId: deletedItem!.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        pushNotificationMessage: pushMessage,
        whatsAppMessage,
        eventType,
        onCallPolicyId: deletedItem.onCallDutyPolicy!.id!,
        onCallPolicyEscalationRuleId:
          deletedItem.onCallDutyPolicyEscalationRule!.id!,
      });
    }

    return onDelete;
  }
}
export default new Service();
