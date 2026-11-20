import { buildNotificationSms } from "../../Utils/Sms/NotificationSms";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import OnCallDutyPolicyEscalationRuleResponderService, {
  EscalationRuleResponder,
} from "./OnCallDutyPolicyEscalationRuleResponderService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import Dictionary from "../../Types/Dictionary";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import { SMSMessage } from "../../Types/SMS/SMS";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import DeleteBy from "../Types/Database/DeleteBy";
import TeamMemberService from "./TeamMemberService";
import User from "../../Models/DatabaseModels/User";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "../Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "../../Types/WhatsApp/WhatsAppMessage";
import Team from "../../Models/DatabaseModels/Team";
import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";
import OneUptimeDate from "../../Types/Date";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";
import OnCallChatText from "../Utils/OnCall/OnCallChatText";
import OnDutyPoliciesCache from "../Utils/OnCall/OnDutyPoliciesCache";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import TeamService from "./TeamService";
import EscalationRuleReach, {
  EscalationRuleOfReach,
  LASTING_PATHS,
  ProjectUserPair,
  RuleMembers,
  RulePath,
  RuleReach,
} from "../Utils/OnCall/EscalationRuleReach";
import logger, { LogAttributes } from "../Utils/Logger";
import {
  ESCALATION_RULE_TEAM_INDEX,
  EscalationRuleNames,
  getTeamOnRuleAlreadyRefusal,
} from "../../Types/OnCallDutyPolicy/EscalationRuleResponderOnce";

export class Service extends OnCallDutyPolicyEscalationRuleResponderService<Model> {
  public constructor() {
    super(Model);
  }

  // One row per team on a rule (EscalationRuleResponderOnce).
  protected getResponderIndexName(): string {
    return ESCALATION_RULE_TEAM_INDEX;
  }

  protected readResponder(data: Model): EscalationRuleResponder | null {
    const ruleId: ObjectID | null = this.readRuleId(data);
    const teamId: ObjectID | null = RelationIdUtil.readConsistent(
      data as unknown as Record<string, unknown>,
      ["teamId", "team"],
      "Team",
    );

    if (!ruleId || !teamId) {
      return null;
    }

    return { ruleId: ruleId, columns: { teamId: teamId } };
  }

  // "... pages the team "Platform" already": the team by its name.
  protected async getAlreadyOnRuleRefusal(data: {
    responder: EscalationRuleResponder;
    rule: EscalationRuleNames | null;
    projectId: ObjectID | null;
  }): Promise<string> {
    const team: Team | null = await TeamService.findOneById({
      id: data.responder.columns["teamId"] as ObjectID,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return getTeamOnRuleAlreadyRefusal({
      rule: data.rule,
      team: team?.name?.toString() || "",
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

    // The team's people are paged by the rule now: the header says so at once.
    await OnDutyPoliciesCache.forgetProjects([createdItem.projectId]);

    const createdModel: Model | null = await this.findOneById({
      id: createdItemId,
      select: {
        projectId: true,
        teamId: true,
        team: {
          name: true,
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

    if (!createdModel) {
      throw new BadDataException("Created item does not have an ID");
    }

    if (!createdModel.teamId) {
      throw new BadDataException("Created item does not have a teamId");
    }

    /*
     * Who the team adds to the rule (EscalationRuleReach): its accepted
     * members who are members of the project - someone only invited to the
     * team is paged once they join, and nothing reaches them before, not
     * this message nor an on-call time log. Each of them hears "added" once
     * for the rule: not when a row made before this one - their own, or
     * another of its teams they are in - pages them already. Each keeps an
     * on-call time log for the team on the rule. A read that fails tells and
     * logs the team's accepted members as before.
     */
    const reach: RuleReach | null = await EscalationRuleReach.readOrNull({
      ...this.getRuleOfRow(createdModel),
      withSchedules: false,
    });

    const usersInTeam: Array<{ userId: ObjectID; isNewToRule: boolean }> = reach
      ? EscalationRuleReach.getPagedByRow(reach, createdItemId).map(
          (paged: {
            userId: ObjectID;
            paths: Array<RulePath>;
          }): { userId: ObjectID; isNewToRule: boolean } => {
            return {
              userId: paged.userId,
              isNewToRule: !EscalationRuleReach.wasPagedBefore({
                paths: paged.paths,
                rowId: createdItemId,
                kinds: LASTING_PATHS,
              }),
            };
          },
        )
      : (
          await TeamMemberService.getUsersInTeams([createdModel.teamId!], {
            acceptedOnly: true,
          })
        )
          .filter((user: User): boolean => {
            return Boolean(user?.id);
          })
          .map((user: User): { userId: ObjectID; isNewToRule: boolean } => {
            return { userId: user.id!, isNewToRule: true };
          });

    for (const { userId: sendEmailToUserId, isNewToRule } of usersInTeam) {
      // add start log
      OnCallDutyPolicyTimeLogService.startTimeLogForUser({
        userId: sendEmailToUserId,
        onCallDutyPolicyId: createdModel.onCallDutyPolicy!.id!,
        onCallDutyPolicyEscalationRuleId:
          createdModel.onCallDutyPolicyEscalationRule!.id!,
        projectId: createdModel.projectId!,
        teamId: createdModel.teamId!,
        startsAt: new Date(),
      }).catch((error: Error) => {
        logger.error(
          `Error starting the team time log of user ${sendEmailToUserId.toString()}: ${error}`,
          {
            projectId: createdModel.projectId?.toString(),
            userId: sendEmailToUserId.toString(),
          } as LogAttributes,
        );
      });

      if (!isNewToRule) {
        continue;
      }

      const temaName: string = createdModel.team?.name || "No name provided";

      const vars: Dictionary<string> = {
        onCallPolicyName:
          createdModel.onCallDutyPolicy?.name || "No name provided",
        escalationRuleName:
          createdModel.onCallDutyPolicyEscalationRule?.name ||
          "No name provided",
        escalationRuleOrder:
          createdModel.onCallDutyPolicyEscalationRule?.order?.toString() ||
          "No order provided",
        reason:
          "You have been added to the on-call policy escalation rule because you are a member of the team " +
          temaName,
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
        subject: `You have been added to the on-call policy ${createdModel.onCallDutyPolicy?.name} for team ${temaName}`,
        isSubjectLiteral: true,
      };

      const sms: SMSMessage = {
        message: buildNotificationSms(
          `You have been added to the on-call policy ${createdModel.onCallDutyPolicy?.name} for team ${temaName} and escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}.`,
        ),
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. You have been added to the on-call policy ${createdModel.onCallDutyPolicy?.name} for team ${temaName} and escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye`,
          },
        ],
      };

      const pushMessage: PushNotificationMessage =
        PushNotificationUtil.createOnCallPolicyAddedNotification({
          policyName: createdModel.onCallDutyPolicy?.name || "No name provided",
        });

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY;

      const whatsAppMessage: WhatsAppMessagePayload =
        createWhatsAppMessageFromTemplate({
          eventType,
          templateVariables: {
            on_call_policy_name:
              createdModel.onCallDutyPolicy?.name || "No name provided",
            on_call_context: `team ${temaName}`,
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
      });
    }

    // add workspace message.

    const onCallDutyPolicyId: ObjectID | undefined | null =
      createdModel.onCallDutyPolicy!.id;
    const projectId: ObjectID | undefined = createdModel.projectId;

    const createdByUserId: ObjectID | undefined | null =
      createdModel.createdByUserId;

    const team: Team | undefined = createdModel.team;
    const onCallDutyPolicyName: string | null =
      createdModel.onCallDutyPolicy?.name || "";

    if (onCallDutyPolicyId) {
      const policyLink: string = (
        await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
          projectId!,
          onCallDutyPolicyId!,
        )
      ).toString();

      await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
        onCallDutyPolicyId: onCallDutyPolicyId,
        projectId: projectId!,
        onCallDutyPolicyFeedEventType: OnCallDutyPolicyFeedEventType.TeamAdded,
        displayColor: Gray500,
        feedInfoInMarkdown:
          mdText`👨🏻‍👩🏻‍👦🏻 Added team **${team?.name || ""}** from the [On-Call Policy ${onCallDutyPolicyName}](${policyLink}) escalation rule **${createdModel.onCallDutyPolicyEscalationRule?.name}** with order **${createdModel.onCallDutyPolicyEscalationRule?.order}**.`.toString(),
        // The channels hear which team and the policy (issue #7549).
        chatInfoInMarkdown: OnCallChatText.policyChange({
          emoji: "👨🏻‍👩🏻‍👦🏻",
          isAdded: true,
          what: mdText`team **${team?.name || ""}**`,
          policy: OnCallChatText.policy({
            name: onCallDutyPolicyName || "",
            link: policyLink,
          }),
        }).toString(),
        userId: createdByUserId || undefined,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
        },
      });
    }

    return createdItem;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // The rows the delete removes, and the delete held to them.
    const itemsToFetchBeforeDelete: Array<Model> =
      await this.findRowsAndHoldDeleteToThem(deleteBy, {
        projectId: true,
        teamId: true,
        team: {
          name: true,
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
      });

    const deleteByUserId: ObjectID | undefined =
      deleteBy.deletedByUser?.id || deleteBy.props.userId;

    for (const item of itemsToFetchBeforeDelete) {
      const onCallDutyPolicyId: ObjectID | undefined =
        item.onCallDutyPolicy!.id!;
      const projectId: ObjectID | undefined = item.projectId;

      if (onCallDutyPolicyId && projectId) {
        const onCallDutyPolicyName: string | null =
          item.onCallDutyPolicy?.name || "No name provided";

        const team: Team | undefined = item.team;

        if (!team) {
          continue;
        }

        const policyLink: string = (
          await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
            projectId!,
            onCallDutyPolicyId!,
          )
        ).toString();

        await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
          onCallDutyPolicyId: onCallDutyPolicyId,
          projectId: projectId,
          /*
           * A team taken out of an escalation rule, which it was filed as
           * an owner team removed: a change to the policy (issue #7549).
           */
          onCallDutyPolicyFeedEventType:
            OnCallDutyPolicyFeedEventType.TeamRemoved,
          displayColor: Red500,
          feedInfoInMarkdown:
            mdText`👨🏻‍👩🏻‍👦🏻 Removed team **${team.name}** from the [On-Call Policy ${onCallDutyPolicyName}](${policyLink}) and escalation rule ${item.onCallDutyPolicyEscalationRule?.name} with order ${item.onCallDutyPolicyEscalationRule?.order}.`.toString(),
          chatInfoInMarkdown: OnCallChatText.policyChange({
            emoji: "👨🏻‍👩🏻‍👦🏻",
            isAdded: false,
            what: mdText`team **${team.name || ""}**`,
            policy: OnCallChatText.policy({
              name: onCallDutyPolicyName || "",
              link: policyLink,
            }),
          }).toString(),
          userId: deleteByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            leadWithAuthor: true,
          },
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

    // Nobody in the team is on duty for the rule any more.
    await OnDutyPoliciesCache.forgetProjects(
      deletedItems.map((deletedItem: Model) => {
        return deletedItem.projectId;
      }),
    );

    /*
     * Each of the team's people is told they were removed only when nothing
     * on the rule pages them any more (EscalationRuleReach): not while they
     * are named on it, in another of its teams, on call in one of its
     * schedules or next in the rotation of one - their time log stays open
     * on those instead. A member of the project is told; someone only
     * invited to the team was told nothing when it was added, and is told
     * nothing now. Everyone's time log for the team on the rule ends.
     */
    const reachByRule: Map<string, RuleReach | null> =
      await EscalationRuleReach.readEach({
        rules: deletedItems.map((deletedItem: Model): EscalationRuleOfReach => {
          return this.getRuleOfRow(deletedItem);
        }),
        withSchedules: true,
      });

    // One message for one person on one rule, however many of its teams went.
    const told: Set<string> = new Set<string>();

    for (const deletedItem of deletedItems) {
      if (!deletedItem.teamId || !deletedItem.projectId) {
        continue;
      }

      const rule: EscalationRuleOfReach = this.getRuleOfRow(deletedItem);
      const reach: RuleReach | null | undefined = reachByRule.get(
        EscalationRuleReach.getRuleKey(rule),
      );

      // Every membership, an invitation included: an older log of theirs ends too.
      const usersInTeam: Array<User> = await TeamMemberService.getUsersInTeam(
        deletedItem.teamId,
      );

      const members: RuleMembers = await EscalationRuleReach.readMembers(
        usersInTeam
          .filter((user: User): boolean => {
            return Boolean(user?.id);
          })
          .map((user: User): ProjectUserPair => {
            return { projectId: deletedItem.projectId!, userId: user.id! };
          }),
      );

      for (const user of usersInTeam) {
        const sendEmailToUserId: ObjectID | undefined | null = user?.id;

        if (!sendEmailToUserId) {
          continue;
        }

        // end time log
        await OnCallDutyPolicyTimeLogService.endTimeLogForUser({
          userId: sendEmailToUserId,
          onCallDutyPolicyId: deletedItem.onCallDutyPolicy!.id!,
          onCallDutyPolicyEscalationRuleId:
            deletedItem.onCallDutyPolicyEscalationRule!.id!,

          projectId: deletedItem.projectId!,
          teamId: deletedItem.teamId!,
          endsAt: OneUptimeDate.getCurrentDate(),
        });

        const paths: Array<RulePath> = reach
          ? EscalationRuleReach.getPaths(reach, sendEmailToUserId)
          : [];

        if (paths.length > 0) {
          EscalationRuleReach.keepTimeLogsOpen({
            ...rule,
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

        const teamName: string = deletedItem.team?.name || "No name provided";

        const vars: Dictionary<string> = {
          onCallPolicyName:
            deletedItem.onCallDutyPolicy?.name || "No name provided",
          escalationRuleName:
            deletedItem.onCallDutyPolicyEscalationRule?.name ||
            "No name provided",
          escalationRuleOrder:
            deletedItem.onCallDutyPolicyEscalationRule?.order?.toString() ||
            "No order provided",
          reason: `You have been removed from the on-call policy escalation rule for team ${teamName}.`,
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
          subject: `You have been removed from the on-call policy ${deletedItem.onCallDutyPolicy?.name} for team ${teamName}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been removed from the on-call policy ${deletedItem.onCallDutyPolicy?.name} for team ${teamName} and escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been removed from the on-call policy ${deletedItem.onCallDutyPolicy?.name} for team ${teamName} and escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createOnCallPolicyRemovedNotification({
            policyName:
              deletedItem.onCallDutyPolicy?.name || "No name provided",
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              on_call_policy_name:
                deletedItem.onCallDutyPolicy?.name || "No name provided",
              on_call_context: `team ${teamName}`,
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
        });
      }
    }

    return onDelete;
  }
}
export default new Service();
