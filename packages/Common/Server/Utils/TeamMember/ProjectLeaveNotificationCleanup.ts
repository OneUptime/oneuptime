import ObjectID from "../../../Types/ObjectID";
import UserCallService from "../../Services/UserCallService";
import UserEmailService from "../../Services/UserEmailService";
import UserIncomingCallNumberService from "../../Services/UserIncomingCallNumberService";
import UserMicrosoftTeamsService from "../../Services/UserMicrosoftTeamsService";
import UserNotificationEmailRollupItemService from "../../Services/UserNotificationEmailRollupItemService";
import UserNotificationEmailRollupSettingService from "../../Services/UserNotificationEmailRollupSettingService";
import UserNotificationRuleService from "../../Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../Services/UserNotificationSettingService";
import UserOnCallShiftReminderService from "../../Services/UserOnCallShiftReminderService";
import UserPushService from "../../Services/UserPushService";
import UserSlackService from "../../Services/UserSlackService";
import UserSmsService from "../../Services/UserSmsService";
import UserTelegramService from "../../Services/UserTelegramService";
import UserWebhookService from "../../Services/UserWebhookService";
import UserWhatsAppService from "../../Services/UserWhatsAppService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import ProjectLeaveRows, {
  FormerMemberCleanupResult,
  PersonalTable,
  ProjectLeaveRemovalResult,
  ProjectUserRow,
  personalTable,
} from "./ProjectLeaveRows";

/*
 * A person's own notification settings for a project are personal: they say
 * how and where THIS person wants to hear about THIS project. When the person
 * leaves the project (no accepted membership left in any of its teams) they
 * are removed with the membership, so nothing of the project can reach the
 * person through them, and joining again starts from the defaults rather than
 * bringing a stale phone number or webhook back to life.
 *
 * What goes, for that (project, person) only:
 *   - their notification rules (on-call rules, shift rules, opt-outs),
 *   - their notification methods: email, SMS, call, WhatsApp, Telegram, push
 *     devices, webhooks, Slack and Microsoft Teams accounts,
 *   - their notification settings (which events they hear about, and how),
 *   - their email rollup preference and the rollup mail still pending for
 *     them,
 *   - their phone number for routed incoming calls,
 *   - their on-call shift reminders (the on-call leave cleanup removes them
 *     too; listed here so former members' leftovers go as well).
 *
 * What stays: history (notification and on-call logs, sent rollups, feeds,
 * timelines), and everything other people set up - owners, on-call layers,
 * escalation rules, overrides, incident roles - which the on-call and
 * resource leave cleanups handle (TeamMemberService), and which never
 * deliver to somebody who is not a member (ProjectMembership). The on-call
 * history points at the rule and method each page went out through; the
 * database clears those references when a rule or method is removed (ON
 * DELETE SET NULL), so the history stays whatever removes them - this
 * cleanup, or the person themselves.
 *
 * What a person holds that lets them, or a client acting for them, into the
 * project goes too, and first: see ProjectLeaveAccessCleanup.
 *
 * Deletes go through each service as root, so a method's own delete hook
 * still runs; rules go first, so no method is left with rules pointing at it
 * part way. Unconditional - callers decide whether the person really left
 * (TeamMemberService.removePersonalNotificationSettingsIfUserLeftProject and
 * the RemoveNotificationSettingsOfFormerMembers data migration).
 */
export default class ProjectLeaveNotificationCleanup {
  /*
   * Every per-project table holding a person's own notification settings, in
   * the order they are removed. A new notification method belongs here too -
   * the guard test fails when one is missing.
   */
  public static getPersonalNotificationTables(): Array<PersonalTable> {
    return [
      personalTable(UserNotificationRuleService),
      personalTable(UserEmailService),
      personalTable(UserSmsService),
      personalTable(UserCallService),
      personalTable(UserWhatsAppService),
      personalTable(UserTelegramService),
      personalTable(UserPushService),
      personalTable(UserWebhookService),
      personalTable(UserSlackService),
      personalTable(UserMicrosoftTeamsService),
      personalTable(UserNotificationSettingService),
      personalTable(UserNotificationEmailRollupSettingService),
      personalTable(UserNotificationEmailRollupItemService, {
        query: {
          sentAt: QueryHelper.isNull(),
        },
        sqlCondition: `"sentAt" IS NULL`,
      }),
      personalTable(UserIncomingCallNumberService),
      personalTable(UserOnCallShiftReminderService),
    ];
  }

  /*
   * For the RemoveNotificationSettingsOfFormerMembers data migration: the
   * same removal for everybody who already left before it ran
   * (ProjectLeaveRows.walkFormerMembers).
   */
  public static async removePersonalNotificationSettingsOfFormerMembers(): Promise<FormerMemberCleanupResult> {
    return await ProjectLeaveRows.walkFormerMembers({
      pairs: await this.getFormerMemberPairs(),
      remove: (data: {
        projectId: ObjectID;
        userId: ObjectID;
      }): Promise<ProjectLeaveRemovalResult> => {
        return this.removePersonalNotificationSettings(data);
      },
    });
  }

  /*
   * The (project, person) pairs, in key order, that hold rows in a personal
   * notification table but no accepted membership of the project.
   */
  public static async getFormerMemberPairs(): Promise<Array<ProjectUserRow>> {
    return await ProjectLeaveRows.getFormerMemberPairsIn(
      this.getPersonalNotificationTables(),
    );
  }

  public static async removePersonalNotificationSettings(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<ProjectLeaveRemovalResult> {
    const result: ProjectLeaveRemovalResult =
      await ProjectLeaveRows.removeRowsOf({
        projectId: data.projectId,
        userId: data.userId,
        tables: this.getPersonalNotificationTables(),
      });

    logger.debug(
      `Notification settings cleanup for a user leaving the project: ${JSON.stringify(
        result,
      )}`,
      {
        projectId: data.projectId.toString(),
        userId: data.userId.toString(),
      } as LogAttributes,
    );

    return result;
  }
}
