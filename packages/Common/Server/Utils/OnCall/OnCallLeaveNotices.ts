import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
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
import OnCallDutyPolicyEscalationRuleTeamService from "../../Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import TeamService from "../../Services/TeamService";
import UserNotificationSettingService from "../../Services/UserNotificationSettingService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import PushNotificationUtil from "../PushNotificationUtil";
import ProjectMembership from "../TeamMember/ProjectMembership";
import { createWhatsAppMessageFromTemplate } from "../WhatsAppTemplateUtil";
import EscalationRuleReach, {
  PersonRulePath,
  PolicyReachOfPerson,
} from "./EscalationRuleReach";
import OnCallHandoffPolicies, {
  OnCallHandoffRule,
  OnCallHandoffRuleVars,
} from "./OnCallHandoffPolicies";

/*
 * SOMEONE WHO LEFT A TEAM IS TOLD WHICH ON-CALL POLICIES STOPPED PAGING
 * THEM (#10587).
 *
 * An escalation rule that names a team pages its accepted members. Joining
 * the team tells them, once for each policy, of the rules it put them on
 * (OnCallJoinNotices, #10557). Leaving it - or being removed from it, by a
 * Project Admin, by SCIM Push Groups, or with the team itself - ended their
 * pages through it and their on-call time logs for it
 * (TeamMemberService.endOnCallTimeLogsOfRemovedMembers), and nothing told
 * them: they could believe they were still on call until they noticed
 * nobody paged them.
 *
 * Now leaving tells them, through their "removed from an on-call policy"
 * notification settings - the reach rule of joining, applied in reverse:
 *
 *   - only of a policy nothing on which pages them any more: not named on
 *     one of its rules, in none of its other teams, on call in none of its
 *     schedules and not next in the rotation of one it pages that way
 *     (EscalationRuleReach.readPolicyPathsOfPerson, read after the delete).
 *     While anything on it does, the policy still pages them, and leaving
 *     one of its teams is no news of the policy: their time logs stay open
 *     on what still pages them (keepTimeLogsOpen). On call in one of its
 *     schedules, the hand-off that ends the shift tells them "You are no
 *     longer on-call" (#10556);
 *   - once for each policy - one email naming every rule of it that the
 *     teams they left had put them on, one text, one call, one push, one
 *     WhatsApp message - however many of its rules, teams and memberships
 *     one delete took. SCIM removing many people from a team sends each of
 *     them one message per policy; what every one of them needs - the
 *     rules naming the teams, who is still a member, the rules' and the
 *     teams' names - is read once for them all;
 *   - only while they are a member of the project. Removing someone from
 *     the project takes them off every team, and every policy stops paging
 *     them, but nothing of the project reaches someone who has left
 *     (ProjectMembership): they are told nothing - the Dashboard tells
 *     whoever removes them that they "stop receiving its notifications" -
 *     and the leave cleanup ends the rest of their time logs
 *     (TeamMemberService.cleanupOnCallAssignmentsIfUserLeftProject);
 *   - an invitation withdrawn never paged anybody: the caller hands over
 *     accepted memberships only.
 *
 * The words are English, as every other message to a project's own people
 * is (Common/Server/Locales/README.md).
 */

// Someone a delete took out of teams of the project.
export interface OnCallLeaver {
  userId: ObjectID;
  // The teams the delete removed an accepted membership of theirs from.
  teamIds: Array<ObjectID>;
}

// One policy that stopped paging someone who left a team, as they hear of it.
export interface OnCallLeaveNotice {
  policyId: ObjectID;
  policyName: string;
  // The rules the teams they left had put them on: in order, each once. Never empty.
  rules: Array<OnCallHandoffRule>;
  // The teams they left that those rules name, each once. Never empty.
  teamNames: Array<string>;
}

// What a team or a rule with no name is called, as every on-call message says it.
const NO_NAME: string = "No name provided";

const keyOf: (id: ObjectID | string) => string = (
  id: ObjectID | string,
): string => {
  return id.toString().toLowerCase();
};

// Each id once, as given first.
const eachOnce: (ids: ReadonlyArray<ObjectID>) => Array<ObjectID> = (
  ids: ReadonlyArray<ObjectID>,
): Array<ObjectID> => {
  const seen: Set<string> = new Set<string>();

  return ids.filter((id: ObjectID): boolean => {
    const key: string = keyOf(id);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

export default class OnCallLeaveNotices {
  /*
   * Tells each of `leavers` - the people one delete took out of teams of
   * the project - of every on-call policy that pages them through nothing
   * any more: once for each policy. Called once the memberships are gone
   * (TeamMemberService.onDeleteSuccess). Never throws: what fails is
   * logged, and the delete stands.
   */
  public static async tellLeft(data: {
    projectId: ObjectID;
    leavers: ReadonlyArray<OnCallLeaver>;
  }): Promise<void> {
    try {
      const teamIds: Array<ObjectID> = eachOnce(
        data.leavers.flatMap((leaver: OnCallLeaver): Array<ObjectID> => {
          return leaver.teamIds;
        }),
      );

      if (teamIds.length === 0) {
        return;
      }

      // The rules that name the teams they left: most teams are on none.
      const teamRows: Array<OnCallDutyPolicyEscalationRuleTeam> =
        await OnCallDutyPolicyEscalationRuleTeamService.findBy({
          query: {
            projectId: data.projectId,
            teamId: QueryHelper.any(teamIds),
          },
          select: {
            _id: true,
            teamId: true,
            onCallDutyPolicyId: true,
            onCallDutyPolicyEscalationRuleId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      if (teamRows.length === 0) {
        return;
      }

      const leavers: Array<OnCallLeaver> = data.leavers.filter(
        (leaver: OnCallLeaver): boolean => {
          return (
            OnCallLeaveNotices.getRowsOfLeaver(teamRows, leaver).length > 0
          );
        },
      );

      if (leavers.length === 0) {
        return;
      }

      // Only someone still a member is told: nothing reaches someone who left.
      const memberUserIds: Set<string> =
        await ProjectMembership.getMemberUserIds({
          projectId: data.projectId,
          userIds: leavers.map((leaver: OnCallLeaver): ObjectID => {
            return leaver.userId;
          }),
        });

      const members: Array<OnCallLeaver> = leavers.filter(
        (leaver: OnCallLeaver): boolean => {
          return memberUserIds.has(keyOf(leaver.userId));
        },
      );

      if (members.length === 0) {
        return;
      }

      // The rules' and the teams' names, read once for everyone.
      const [ruleRows, teams]: [
        Array<OnCallDutyPolicyEscalationRule>,
        Array<Team>,
      ] = await Promise.all([
        OnCallDutyPolicyEscalationRuleService.findBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(
              eachOnce(
                teamRows
                  .map(
                    (
                      row: OnCallDutyPolicyEscalationRuleTeam,
                    ): ObjectID | undefined => {
                      return row.onCallDutyPolicyEscalationRuleId;
                    },
                  )
                  .filter(
                    (ruleId: ObjectID | undefined): ruleId is ObjectID => {
                      return Boolean(ruleId);
                    },
                  ),
              ),
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
        TeamService.findBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(teamIds),
          },
          select: { _id: true, name: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
      ]);

      const teamNames: Map<string, string> = new Map<string, string>();

      for (const team of teams) {
        if (team.id) {
          teamNames.set(keyOf(team.id), team.name?.toString() || "");
        }
      }

      for (const leaver of members) {
        // One person's failure keeps nobody else from being told.
        try {
          await OnCallLeaveNotices.tellLeaver({
            projectId: data.projectId,
            leaver: leaver,
            teamRows: teamRows,
            ruleRows: ruleRows,
            teamNames: teamNames,
          });
        } catch (error) {
          OnCallLeaveNotices.logFailure(
            { projectId: data.projectId, userId: leaver.userId },
            error as Error,
          );
        }
      }
    } catch (error) {
      logger.error(
        "Could not tell the people who left teams of a project which on-call policies stopped paging them.",
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      logger.error(
        error as Error,
        {
          projectId: data.projectId.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * One policy for each policy that pages them through nothing any more,
   * from the rows that named the teams they left: its rules in their order,
   * and the teams, each once, by name. A rule removed meanwhile is left
   * out, and so is a policy left with none. By the policy's name.
   */
  public static getNotices(data: {
    rows: ReadonlyArray<OnCallDutyPolicyEscalationRuleTeam>;
    ruleRows: ReadonlyArray<OnCallDutyPolicyEscalationRule>;
    teamNames: Map<string, string>;
  }): Array<OnCallLeaveNotice> {
    const byPolicy: Map<string, OnCallLeaveNotice> = new Map<
      string,
      OnCallLeaveNotice
    >();

    for (const row of data.rows) {
      const ruleId: ObjectID | undefined = row.onCallDutyPolicyEscalationRuleId;
      const policyId: ObjectID | undefined = row.onCallDutyPolicyId;

      if (!ruleId || !policyId || !row.teamId) {
        continue;
      }

      const ruleRow: OnCallDutyPolicyEscalationRule | undefined =
        data.ruleRows.find((each: OnCallDutyPolicyEscalationRule): boolean => {
          return Boolean(each.id) && keyOf(each.id!) === keyOf(ruleId);
        });

      if (!ruleRow) {
        continue;
      }

      const notice: OnCallLeaveNotice = byPolicy.get(keyOf(policyId)) || {
        policyId: policyId,
        policyName: ruleRow.onCallDutyPolicy?.name || "",
        rules: [],
        teamNames: [],
      };

      if (
        !notice.rules.some((rule: OnCallHandoffRule): boolean => {
          return keyOf(rule.id) === keyOf(ruleId);
        })
      ) {
        notice.rules.push({
          id: ruleId,
          name: ruleRow.name || "",
          order: typeof ruleRow.order === "number" ? ruleRow.order : null,
        });
      }

      const teamName: string =
        (data.teamNames.get(keyOf(row.teamId)) || "").trim() || NO_NAME;

      if (!notice.teamNames.includes(teamName)) {
        notice.teamNames.push(teamName);
      }

      byPolicy.set(keyOf(policyId), notice);
    }

    return [...byPolicy.values()]
      .map((notice: OnCallLeaveNotice): OnCallLeaveNotice => {
        return {
          ...notice,
          rules: OnCallHandoffPolicies.inOrder(notice.rules),
        };
      })
      .sort((a: OnCallLeaveNotice, b: OnCallLeaveNotice): number => {
        return (
          a.policyName.localeCompare(b.policyName) ||
          a.policyId.toString().localeCompare(b.policyId.toString())
        );
      });
  }

  /*
   * What one policy's message says: "You have been removed from the on-call
   * policy Payments for team Platform" - for the rules that team had put
   * them on, and why.
   */
  public static async send(data: {
    projectId: ObjectID;
    userId: ObjectID;
    notice: OnCallLeaveNotice;
  }): Promise<void> {
    const { notice } = data;
    const policyName: string = notice.policyName || NO_NAME;
    const ruleVars: OnCallHandoffRuleVars = OnCallHandoffPolicies.getRuleVars(
      notice.rules,
    );
    const isSeveralRules: boolean = notice.rules.length > 1;
    const isSeveralTeams: boolean = notice.teamNames.length > 1;
    const teamNames: string = joinOnCallPassOnNames(notice.teamNames);

    // "team Platform", "teams Platform and SRE"
    const teamText: string = isSeveralTeams
      ? `teams ${teamNames}`
      : `team ${teamNames}`;

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

    const subject: string = `You have been removed from the on-call policy ${policyName} for ${teamText}`;

    const sentence: string = isSeveralTeams
      ? `You have been removed from the on-call policy ${policyName} for ${teamText}, and ${ruleText}, now that you are no longer a member of those teams.`
      : `You have been removed from the on-call policy ${policyName} for ${teamText} and ${ruleText}, now that you are no longer a member of the team.`;

    const reason: string = isSeveralTeams
      ? `You are no longer a member of the teams ${teamNames}, so this on-call policy no longer pages you.`
      : `You are no longer a member of the team ${teamNames}, so this on-call policy no longer pages you.`;

    const vars: Dictionary<string> = {
      onCallPolicyName: policyName,
      ...ruleVars,
      reason: reason,
      onCallPolicyViewLink: policyLink,
    };

    const emailMessage: EmailEnvelope = {
      templateType: EmailTemplateType.UserRemovedFromOnCallPolicy,
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
      PushNotificationUtil.createOnCallPolicyRemovedNotification({
        policyName: policyName,
      });

    const eventType: NotificationSettingEventType =
      NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY;

    const whatsAppMessage: WhatsAppMessagePayload =
      createWhatsAppMessageFromTemplate({
        eventType,
        templateVariables: {
          on_call_policy_name: policyName,
          on_call_context: teamText,
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
   * One leaver: what still pages them on the policies whose rules named the
   * teams they left, read after the delete; their time logs kept open on
   * those that do, and one message for each of the others.
   */
  private static async tellLeaver(data: {
    projectId: ObjectID;
    leaver: OnCallLeaver;
    teamRows: ReadonlyArray<OnCallDutyPolicyEscalationRuleTeam>;
    ruleRows: ReadonlyArray<OnCallDutyPolicyEscalationRule>;
    teamNames: Map<string, string>;
  }): Promise<void> {
    const rows: Array<OnCallDutyPolicyEscalationRuleTeam> =
      OnCallLeaveNotices.getRowsOfLeaver(data.teamRows, data.leaver);

    const policyIds: Array<ObjectID> = eachOnce(
      rows
        .map(
          (row: OnCallDutyPolicyEscalationRuleTeam): ObjectID | undefined => {
            return row.onCallDutyPolicyId;
          },
        )
        .filter((policyId: ObjectID | undefined): policyId is ObjectID => {
          return Boolean(policyId);
        }),
    );

    if (policyIds.length === 0) {
      return;
    }

    const reach: PolicyReachOfPerson =
      await EscalationRuleReach.readPolicyPathsOfPerson({
        projectId: data.projectId,
        userId: data.leaver.userId,
        policyIds: policyIds,
      });

    /*
     * A policy that still pages them: no news of it, and their on-call time
     * logs stay open on each path that does - the team's own ended with the
     * membership.
     */
    for (const paths of reach.values()) {
      OnCallLeaveNotices.keepTimeLogsOpen({
        projectId: data.projectId,
        userId: data.leaver.userId,
        paths: paths,
      });
    }

    const notices: Array<OnCallLeaveNotice> = OnCallLeaveNotices.getNotices({
      rows: rows.filter((row: OnCallDutyPolicyEscalationRuleTeam): boolean => {
        return (
          Boolean(row.onCallDutyPolicyId) &&
          !reach.has(keyOf(row.onCallDutyPolicyId!))
        );
      }),
      ruleRows: data.ruleRows,
      teamNames: data.teamNames,
    });

    for (const notice of notices) {
      // One policy's message that fails keeps none of the others from going.
      try {
        await OnCallLeaveNotices.send({
          projectId: data.projectId,
          userId: data.leaver.userId,
          notice: notice,
        });
      } catch (error) {
        OnCallLeaveNotices.logFailure(
          { projectId: data.projectId, userId: data.leaver.userId },
          error as Error,
        );
      }
    }
  }

  // The rows that name a team the leaver left.
  private static getRowsOfLeaver(
    teamRows: ReadonlyArray<OnCallDutyPolicyEscalationRuleTeam>,
    leaver: OnCallLeaver,
  ): Array<OnCallDutyPolicyEscalationRuleTeam> {
    const left: Set<string> = new Set<string>(
      leaver.teamIds.map((teamId: ObjectID): string => {
        return keyOf(teamId);
      }),
    );

    return teamRows.filter(
      (row: OnCallDutyPolicyEscalationRuleTeam): boolean => {
        return Boolean(row.teamId) && left.has(keyOf(row.teamId!));
      },
    );
  }

  // Each rule's paths of one policy that still pages them, kept open rule by rule.
  private static keepTimeLogsOpen(data: {
    projectId: ObjectID;
    userId: ObjectID;
    paths: ReadonlyArray<PersonRulePath>;
  }): void {
    const byRule: Map<string, Array<PersonRulePath>> = new Map<
      string,
      Array<PersonRulePath>
    >();

    for (const path of data.paths) {
      const rulePaths: Array<PersonRulePath> =
        byRule.get(keyOf(path.ruleId)) || [];
      rulePaths.push(path);
      byRule.set(keyOf(path.ruleId), rulePaths);
    }

    for (const rulePaths of byRule.values()) {
      EscalationRuleReach.keepTimeLogsOpen({
        projectId: data.projectId,
        policyId: rulePaths[0]!.policyId,
        ruleId: rulePaths[0]!.ruleId,
        userId: data.userId,
        paths: rulePaths,
      });
    }
  }

  private static logFailure(
    data: { projectId: ObjectID; userId: ObjectID },
    error: Error,
  ): void {
    logger.error(
      "Could not tell somebody who left a team which on-call policies stopped paging them.",
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
