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

    /*
     * The row's ids are read from its own columns (getRuleOfRow), which
     * every row holds: the policy and the rule are joined for their names
     * alone (#10970).
     */
    const createdModel: Model | null = await this.findOneById({
      id: createdItemId,
      select: {
        projectId: true,
        teamId: true,
        onCallDutyPolicyId: true,
        onCallDutyPolicyEscalationRuleId: true,
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

    const teamId: ObjectID = createdModel.teamId;
    const rule: EscalationRuleOfReach = this.getRuleOfRow(createdModel);
    const onCallDutyPolicyId: ObjectID | null = rule.policyId;

    // Required columns both: a row without them names nobody to tell or log.
    if (!rule.projectId || !rule.ruleId || !onCallDutyPolicyId) {
      logger.error(
        `Escalation rule team ${createdItemId.toString()} was read back without its project, rule or policy; nobody was told or logged.`,
        {
          projectId: rule.projectId?.toString(),
        } as LogAttributes,
      );

      return createdItem;
    }

    const projectId: ObjectID = rule.projectId;
    const ruleId: ObjectID = rule.ruleId;

    const policyLink: string = (
      await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
        projectId,
        onCallDutyPolicyId,
      )
    ).toString();

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
      ...rule,
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
          await TeamMemberService.getUserIdsInTeams([teamId], {
            acceptedOnly: true,
          })
        ).map(
          (userId: ObjectID): { userId: ObjectID; isNewToRule: boolean } => {
            return { userId: userId, isNewToRule: true };
          },
        );

    for (const { userId: sendEmailToUserId, isNewToRule } of usersInTeam) {
      // add start log
      OnCallDutyPolicyTimeLogService.startTimeLogForUser({
        userId: sendEmailToUserId,
        onCallDutyPolicyId: onCallDutyPolicyId,
        onCallDutyPolicyEscalationRuleId: ruleId,
        projectId: projectId,
        teamId: teamId,
        startsAt: new Date(),
      }).catch((error: Error) => {
        logger.error(
          `Error starting the team time log of user ${sendEmailToUserId.toString()}: ${error}`,
          {
            projectId: projectId.toString(),
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
        onCallPolicyViewLink: policyLink,
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
        projectId: projectId,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        pushNotificationMessage: pushMessage,
        whatsAppMessage,
        eventType,
      });
    }

    // add workspace message.

    const createdByUserId: ObjectID | undefined | null =
      createdModel.createdByUserId;

    const team: Team | undefined = createdModel.team;
    const onCallDutyPolicyName: string | null =
      createdModel.onCallDutyPolicy?.name || "";

    await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
      onCallDutyPolicyId: onCallDutyPolicyId,
      projectId: projectId,
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
        // The ids from the row's own columns (getRuleOfRow, #10970).
        onCallDutyPolicyId: true,
        onCallDutyPolicyEscalationRuleId: true,
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
      const onCallDutyPolicyId: ObjectID | null =
        this.getRuleOfRow(item).policyId;
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
            projectId,
            onCallDutyPolicyId,
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
      const rule: EscalationRuleOfReach = this.getRuleOfRow(deletedItem);
      const teamId: ObjectID | undefined = deletedItem.teamId;
      const projectId: ObjectID | undefined = deletedItem.projectId;
      const onCallDutyPolicyId: ObjectID | null = rule.policyId;
      const ruleId: ObjectID | undefined = rule.ruleId;

      // Without them the row names no log to end and nobody to tell.
      if (!teamId || !projectId || !ruleId || !onCallDutyPolicyId) {
        continue;
      }

      const reach: RuleReach | null | undefined = reachByRule.get(
        EscalationRuleReach.getRuleKey(rule),
      );

      /*
       * Every membership, an invitation included: an older log of theirs
       * ends too. Read by the memberships' own user ids, no person joined.
       */
      const usersInTeam: Array<ObjectID> =
        await TeamMemberService.getUserIdsInTeams([teamId]);

      const members: RuleMembers = await EscalationRuleReach.readMembers(
        usersInTeam.map((userId: ObjectID): ProjectUserPair => {
          return { projectId: projectId, userId: userId };
        }),
      );

      for (const sendEmailToUserId of usersInTeam) {
        // end time log
        await OnCallDutyPolicyTimeLogService.endTimeLogForUser({
          userId: sendEmailToUserId,
          onCallDutyPolicyId: onCallDutyPolicyId,
          onCallDutyPolicyEscalationRuleId: ruleId,
          projectId: projectId,
          teamId: teamId,
          endsAt: OneUptimeDate.getCurrentDate(),
        }).catch((error: Error) => {
          // One log that cannot be ended stops neither the others nor the messages.
          logger.error(
            `Error ending the team time log of user ${sendEmailToUserId.toString()}: ${error}`,
            {
              projectId: projectId.toString(),
              userId: sendEmailToUserId.toString(),
            } as LogAttributes,
          );
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
          !members.isMember(projectId, sendEmailToUserId)
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
              projectId,
              onCallDutyPolicyId,
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
          projectId: projectId,
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
