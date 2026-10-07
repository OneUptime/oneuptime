import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import DatabaseService from "../../Services/DatabaseService";
import UserCallService from "../../Services/UserCallService";
import UserEmailService from "../../Services/UserEmailService";
import UserIncomingCallNumberService from "../../Services/UserIncomingCallNumberService";
import UserMicrosoftTeamsService from "../../Services/UserMicrosoftTeamsService";
import UserNotificationEmailRollupItemService from "../../Services/UserNotificationEmailRollupItemService";
import UserNotificationEmailRollupSettingService from "../../Services/UserNotificationEmailRollupSettingService";
import UserNotificationRuleService from "../../Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../Services/UserNotificationSettingService";
import UserPushService from "../../Services/UserPushService";
import UserSlackService from "../../Services/UserSlackService";
import UserSmsService from "../../Services/UserSmsService";
import UserTelegramService from "../../Services/UserTelegramService";
import UserWebhookService from "../../Services/UserWebhookService";
import UserWhatsAppService from "../../Services/UserWhatsAppService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";

/*
 * What removePersonalNotificationSettings removed, for logging and for the
 * tests. Keyed by table ("UserEmail", "UserNotificationRule", ...); tables
 * with nothing to remove are left out. Every count is "as far as we got": a
 * table that failed is logged, listed in failedTables, and the rest still go.
 */
export interface ProjectLeaveNotificationCleanupResult {
  removedRowCounts: Dictionary<number>;
  failedTables: Array<string>;
}

export interface PersonalNotificationTable {
  service: DatabaseService<DatabaseBaseModel>;
  /*
   * Extra conditions on top of (projectId, userId). Only the email rollup
   * queue has one: its sent rows are the record of what went out, like
   * notification logs, and expire by themselves; the pending ones are
   * project mail still waiting to reach the person.
   */
  query?: Dictionary<unknown> | undefined;
}

function personalTable<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
  query?: Dictionary<unknown>,
): PersonalNotificationTable {
  return {
    service: service as unknown as DatabaseService<DatabaseBaseModel>,
    query,
  };
}

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
 *   - their phone number for routed incoming calls.
 *
 * What stays: history (notification and on-call logs, sent rollups, feeds,
 * timelines), and everything other people set up - owners, on-call layers,
 * escalation rules, overrides, incident roles - which the on-call and
 * resource leave cleanups handle (TeamMemberService), and which never
 * deliver to somebody who is not a member (ProjectMembership).
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
  public static getPersonalNotificationTables(): Array<PersonalNotificationTable> {
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
        sentAt: QueryHelper.isNull(),
      }),
      personalTable(UserIncomingCallNumberService),
    ];
  }

  public static async removePersonalNotificationSettings(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<ProjectLeaveNotificationCleanupResult> {
    const { projectId, userId } = data;

    const logAttributes: LogAttributes = {
      projectId: projectId.toString(),
      userId: userId.toString(),
    } as LogAttributes;

    const result: ProjectLeaveNotificationCleanupResult = {
      removedRowCounts: {},
      failedTables: [],
    };

    for (const table of this.getPersonalNotificationTables()) {
      const tableName: string = table.service.getModel().tableName || "";

      const query: Query<DatabaseBaseModel> = {
        ...(table.query || {}),
        projectId: projectId,
        userId: userId,
      } as unknown as Query<DatabaseBaseModel>;

      try {
        const count: PositiveNumber = await table.service.countBy({
          query: query,
          props: {
            isRoot: true,
          },
        });

        if (count.toNumber() === 0) {
          continue;
        }

        const removed: number = await table.service.deleteBy({
          query: query,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        if (removed > 0) {
          result.removedRowCounts[tableName] = removed;
        }
      } catch (err) {
        result.failedTables.push(tableName);

        logger.error(
          `Error removing ${tableName} rows of a user who left the project (best-effort).`,
          logAttributes,
        );
        logger.error(err as Error, logAttributes);
      }
    }

    logger.debug(
      `Notification settings cleanup for a user leaving the project: ${JSON.stringify(
        result,
      )}`,
      logAttributes,
    );

    return result;
  }
}
