import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import { joinOnCallPassOnNames } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import { WhatsAppMessagePayload } from "../../../Types/WhatsApp/WhatsAppMessage";
import { buildNotificationSms } from "../../../Utils/Sms/NotificationSms";
import OnCallDutyPolicyEscalationRuleService from "../../Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import TeamService from "../../Services/TeamService";
import UserNotificationSettingService from "../../Services/UserNotificationSettingService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import PushNotificationUtil from "../PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "../WhatsAppTemplateUtil";
import EscalationRuleReach, {
  MemberJoin,
  MemberRules,
  RuleNewToMember,
  RulePathKind,
  RulesNewToMember,
} from "./EscalationRuleReach";
import OnCallHandoffPolicies, {
  OnCallHandoffRule,
  OnCallHandoffRuleVars,
} from "./OnCallHandoffPolicies";

/*
 * SOMEONE WHO JOINED IS TOLD WHICH ON-CALL POLICIES PAGE THEM NOW (#10557).
 *
 * An escalation rule may name someone only invited, or a team they are
 * invited to, and pages them once they join (#10412); a rule that names a
 * team pages whoever joins it. Their on-call time logs start then
 * (EscalationRuleReach.openTimeLogsOfMember), and a page reaches them from
 * that moment. But "You have been added to the on-call policy ..." was said
 * only when a rule's row was added, and never to someone only invited, so
 * they learned they were on call from their first page.
 *
 * Now joining tells them, once for each policy whose rules started paging
 * them (EscalationRuleReach.getRulesNewToMember):
 *
 *   - someone who joined the project - an invitation accepted, or their
 *     first membership made accepted - hears of every rule that pages them
 *     now: by name, through a team, or on the roster of a schedule they are
 *     on call in, which its hand-off told them nothing of while they were
 *     only invited;
 *   - a member who joined another team hears of the rules that team put
 *     them on, and not of one that named them, or one of their other teams,
 *     already - the "told once" rule of a row's add (#10464).
 *
 * One message for each policy - one email naming every such rule of it,
 * one text, one call, one push, one WhatsApp message - however many of its
 * rules, and however many invitations one acceptance accepted: someone
 * SCIM adds to a team named on many rules is not sent one for each. The
 * person's "added to an on-call policy" settings say how it reaches them,
 * read while they are a member (UserNotificationSettingService): nothing is
 * ever sent with an invitation, only once they have joined. The words are
 * English, as every other message to a project's own people is
 * (Common/Server/Locales/README.md).
 */

// One policy's rules that started paging someone who joined, as they hear of them.
export interface OnCallJoinNotice {
  policyId: ObjectID;
  policyName: string;
  // In their order, each once. Never empty.
  rules: Array<OnCallHandoffRule>;
  // Schedules whose roster has them on call now, for those rules.
  scheduleNames: Array<string>;
}

export default class OnCallJoinNotices {
  /*
   * Tells someone who joined the project, or another of its teams, of every
   * on-call policy whose rules started paging them: once for each policy.
   * Called once their notification settings are written (TeamMemberService).
   * Never throws: what fails is logged, and the membership stands.
   */
  public static async tellJoined(data: {
    projectId: ObjectID;
    userId: ObjectID;
    join: MemberJoin;
  }): Promise<void> {
    try {
      const rules: MemberRules | null =
        await EscalationRuleReach.readRulesOfMember({
          projectId: data.projectId,
          userId: data.userId,
        });

      // Not a member after all - an invitation still waiting: told nothing.
      if (!rules) {
        return;
      }

      const news: RulesNewToMember = EscalationRuleReach.getRulesNewToMember({
        rules: rules,
        join: data.join,
      });

      if (news.rules.length === 0) {
        return;
      }

      const [notices, teamName]: [Array<OnCallJoinNotice>, string | null] =
        await Promise.all([
          OnCallJoinNotices.readNotices({
            projectId: data.projectId,
            rules: news.rules,
            withSchedules: news.joinedProject,
          }),
          news.teamId
            ? OnCallJoinNotices.readTeamName(news.teamId)
            : Promise.resolve(null),
        ]);

      for (const notice of notices) {
        // One policy's message that fails keeps none of the others from going.
        try {
          await OnCallJoinNotices.send({
            projectId: data.projectId,
            userId: data.userId,
            notice: notice,
            joinedProject: news.joinedProject,
            teamName: teamName,
          });
        } catch (error) {
          OnCallJoinNotices.logFailure(data, error as Error);
        }
      }
    } catch (error) {
      OnCallJoinNotices.logFailure(data, error as Error);
    }
  }

  /*
   * The rules, by policy, as their messages name them: each policy once,
   * by name, with its rules in their order, and - for someone who joined
   * the project - the schedules whose roster has them on call for those
   * rules. A rule removed meanwhile is left out, and so is a policy left
   * with none.
   */
  public static async readNotices(data: {
    projectId: ObjectID;
    rules: ReadonlyArray<RuleNewToMember>;
    withSchedules: boolean;
  }): Promise<Array<OnCallJoinNotice>> {
    const scheduleIds: Array<ObjectID> = data.withSchedules
      ? OnCallJoinNotices.getScheduleIds(data.rules)
      : [];

    const [ruleRows, schedules]: [
      Array<OnCallDutyPolicyEscalationRule>,
      Array<OnCallDutyPolicySchedule>,
    ] = await Promise.all([
      OnCallDutyPolicyEscalationRuleService.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(
            data.rules.map((rule: RuleNewToMember): ObjectID => {
              return rule.ruleId;
            }),
          ),
        },
        select: {
          _id: true,
          name: true,
          order: true,
          onCallDutyPolicyId: true,
          onCallDutyPolicy: {
            _id: true,
            name: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
      scheduleIds.length > 0
        ? OnCallDutyPolicyScheduleService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(scheduleIds),
            },
            select: { _id: true, name: true },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
    ]);

    const scheduleNames: Map<string, string> = new Map<string, string>();

    for (const schedule of schedules) {
      if (schedule.id) {
        scheduleNames.set(
          schedule.id.toString().toLowerCase(),
          schedule.name || "",
        );
      }
    }

    const byPolicy: Map<string, OnCallJoinNotice> = new Map<
      string,
      OnCallJoinNotice
    >();

    for (const rule of data.rules) {
      const row: OnCallDutyPolicyEscalationRule | undefined = ruleRows.find(
        (each: OnCallDutyPolicyEscalationRule): boolean => {
          return (
            each.id?.toString().toLowerCase() ===
            rule.ruleId.toString().toLowerCase()
          );
        },
      );

      if (!row) {
        continue;
      }

      const policyKey: string = rule.policyId.toString().toLowerCase();
      const notice: OnCallJoinNotice = byPolicy.get(policyKey) || {
        policyId: rule.policyId,
        policyName: row.onCallDutyPolicy?.name || "",
        rules: [],
        scheduleNames: [],
      };

      notice.rules.push({
        id: rule.ruleId,
        name: row.name || "",
        order: typeof row.order === "number" ? row.order : null,
      });

      for (const path of rule.paths) {
        const scheduleName: string | undefined =
          path.kind === RulePathKind.OnCall && path.scheduleId
            ? scheduleNames.get(path.scheduleId.toString().toLowerCase())
            : undefined;

        if (scheduleName && !notice.scheduleNames.includes(scheduleName)) {
          notice.scheduleNames.push(scheduleName);
        }
      }

      byPolicy.set(policyKey, notice);
    }

    return [...byPolicy.values()]
      .map((notice: OnCallJoinNotice): OnCallJoinNotice => {
        return { ...notice, rules: OnCallJoinNotices.inOrder(notice.rules) };
      })
      .sort((a: OnCallJoinNotice, b: OnCallJoinNotice): number => {
        return (
          a.policyName.localeCompare(b.policyName) ||
          a.policyId.toString().localeCompare(b.policyId.toString())
        );
      });
  }

  /*
   * What one policy's message says, and to whom it goes: "You have been
   * added to the on-call policy Payments" - for the rules that started
   * paging them, and why now.
   */
  public static async send(data: {
    projectId: ObjectID;
    userId: ObjectID;
    notice: OnCallJoinNotice;
    // They joined the project; else they joined `teamName`, a member already.
    joinedProject: boolean;
    teamName: string | null;
  }): Promise<void> {
    const { notice } = data;
    const policyName: string = notice.policyName || "No name provided";
    const ruleVars: OnCallHandoffRuleVars = OnCallHandoffPolicies.getRuleVars(
      notice.rules,
    );
    const isSeveralRules: boolean = notice.rules.length > 1;

    // "escalation rule Level 1 with order 1", "escalation rules ... with orders 1 and 3"
    const ruleText: string = isSeveralRules
      ? `escalation rules ${ruleVars.escalationRuleName} with orders ${ruleVars.escalationRuleOrder}`
      : `escalation rule ${ruleVars.escalationRuleName} with order ${ruleVars.escalationRuleOrder}`;

    const policyLink: string = (
      await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
        data.projectId,
        notice.policyId,
      )
    ).toString();

    const teamName: string = data.teamName || "No name provided";

    const subject: string = data.joinedProject
      ? `You have been added to the on-call policy ${policyName}`
      : `You have been added to the on-call policy ${policyName} for team ${teamName}`;

    const sentence: string = data.joinedProject
      ? `You have been added to the on-call policy ${policyName} for ${ruleText}, now that you have joined the project.`
      : `You have been added to the on-call policy ${policyName} for team ${teamName} and ${ruleText}, now that you are a member of the team.`;

    const reason: string = data.joinedProject
      ? `You have joined the project, so this on-call policy pages you from now on.${OnCallJoinNotices.getOnCallNowText(notice.scheduleNames)}`
      : `You have joined the team ${teamName}, so this on-call policy pages you from now on.`;

    const onCallContext: string = data.joinedProject
      ? `${isSeveralRules ? "escalation rules" : "escalation rule"} ${ruleVars.escalationRuleName}`
      : `team ${teamName}`;

    const vars: Dictionary<string> = {
      onCallPolicyName: policyName,
      ...ruleVars,
      reason: reason,
      onCallPolicyViewLink: policyLink,
    };

    const emailMessage: EmailEnvelope = {
      templateType: EmailTemplateType.UserAddedToOnCallPolicy,
      vars: vars,
      subject: subject,
      isSubjectLiteral: true,
    };

    const sms: SMSMessage = {
      message: buildNotificationSms(sentence),
    };

    const callMessage: CallRequestMessage = {
      data: [
        {
          sayMessage: `This is a message from OneUptime. ${sentence} To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye`,
        },
      ],
    };

    const pushMessage: PushNotificationMessage =
      PushNotificationUtil.createOnCallPolicyAddedNotification({
        policyName: policyName,
      });

    const eventType: NotificationSettingEventType =
      NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY;

    const whatsAppMessage: WhatsAppMessagePayload =
      createWhatsAppMessageFromTemplate({
        eventType,
        templateVariables: {
          on_call_policy_name: policyName,
          on_call_context: onCallContext,
          policy_link: policyLink,
        },
      });

    await UserNotificationSettingService.sendUserNotification({
      userId: data.userId,
      projectId: data.projectId,
      emailEnvelope: emailMessage,
      smsMessage: sms,
      callRequestMessage: callMessage,
      pushNotificationMessage: pushMessage,
      whatsAppMessage,
      eventType,
      onCallPolicyId: notice.policyId,
      // Logged against the policy's first rule of them, as a hand-off's is.
      onCallPolicyEscalationRuleId: notice.rules[0]!.id,
    });
  }

  /*
   * " You are on call now on the roster of schedule Primary." - the shift
   * someone joined during, which its hand-off told them nothing of while
   * they were only invited. Nothing when they are on call in none.
   */
  public static getOnCallNowText(scheduleNames: Array<string>): string {
    const names: Array<string> = scheduleNames
      .map((name: string): string => {
        return name.trim() || "No name provided";
      })
      .filter((name: string, index: number, all: Array<string>): boolean => {
        return all.indexOf(name) === index;
      });

    if (names.length === 0) {
      return "";
    }

    return names.length > 1
      ? ` You are on call now on the rosters of schedules ${joinOnCallPassOnNames(names)}.`
      : ` You are on call now on the roster of schedule ${names[0]}.`;
  }

  // The schedules their rules page them through now, each once.
  private static getScheduleIds(
    rules: ReadonlyArray<RuleNewToMember>,
  ): Array<ObjectID> {
    const scheduleIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const rule of rules) {
      for (const path of rule.paths) {
        if (path.kind === RulePathKind.OnCall && path.scheduleId) {
          scheduleIds.set(
            path.scheduleId.toString().toLowerCase(),
            path.scheduleId,
          );
        }
      }
    }

    return [...scheduleIds.values()];
  }

  private static async readTeamName(teamId: ObjectID): Promise<string | null> {
    const team: Team | null = await TeamService.findOneById({
      id: teamId,
      select: { name: true },
      props: { isRoot: true },
    });

    return team?.name || null;
  }

  // Lowest order first; a rule with no order after the rest, as it came.
  private static inOrder(
    rules: Array<OnCallHandoffRule>,
  ): Array<OnCallHandoffRule> {
    return rules
      .map((rule: OnCallHandoffRule, index: number) => {
        return { rule, index };
      })
      .sort(
        (
          a: { rule: OnCallHandoffRule; index: number },
          b: { rule: OnCallHandoffRule; index: number },
        ): number => {
          const aOrder: number =
            a.rule.order === null ? Number.POSITIVE_INFINITY : a.rule.order;
          const bOrder: number =
            b.rule.order === null ? Number.POSITIVE_INFINITY : b.rule.order;

          if (aOrder !== bOrder) {
            return aOrder < bOrder ? -1 : 1;
          }

          return a.index - b.index;
        },
      )
      .map((entry: { rule: OnCallHandoffRule }): OnCallHandoffRule => {
        return entry.rule;
      });
  }

  private static logFailure(
    data: { projectId: ObjectID; userId: ObjectID },
    error: Error,
  ): void {
    logger.error(
      "Could not tell somebody who joined a project or a team which on-call policies page them now.",
      {
        projectId: data.projectId.toString(),
        userId: data.userId.toString(),
      } as LogAttributes,
    );
    logger.error(error, {
      projectId: data.projectId.toString(),
      userId: data.userId.toString(),
    } as LogAttributes);
  }
}
