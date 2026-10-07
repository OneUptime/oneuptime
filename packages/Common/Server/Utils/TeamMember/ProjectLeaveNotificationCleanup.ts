import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import DatabaseService from "../../Services/DatabaseService";
import TeamMemberService from "../../Services/TeamMemberService";
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
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import ProjectMembership from "./ProjectMembership";

/*
 * What a removal of one person's rows removed, for logging and for the
 * tests. Keyed by table ("UserEmail", "UserNotificationRule", ...); tables
 * with nothing to remove are left out. Every count is "as far as we got": a
 * table that failed is logged, listed in failedTables, and the rest still go.
 */
export interface ProjectLeaveNotificationCleanupResult {
  removedRowCounts: Dictionary<number>;
  failedTables: Array<string>;
}

/*
 * A per-project table of rows that belong to one person (projectId, userId)
 * and go when they leave the project.
 */
export interface PersonalTable {
  service: DatabaseService<DatabaseBaseModel>;
  /*
   * Extra conditions on top of (projectId, userId), as a query and as the
   * same condition in SQL for finding former members' rows. Only the email
   * rollup queue has one: its sent rows are the record of what went out,
   * like notification logs, and expire by themselves; the pending ones are
   * project mail still waiting to reach the person.
   */
  query?: Dictionary<unknown> | undefined;
  sqlCondition?: string | undefined;
}

export type PersonalNotificationTable = PersonalTable;

/*
 * What a walk over former members' leftovers did: how many (project,
 * person) pairs it cleaned, how many rows went, and how many pairs failed
 * part way (logged; the walk goes on).
 */
export interface FormerMemberCleanupResult {
  cleanedPairCount: number;
  removedRowCount: number;
  failedPairCount: number;
}

export interface ProjectUserRow {
  projectId: string;
  userId: string;
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function personalTable<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
  extra?: { query: Dictionary<unknown>; sqlCondition: string },
): PersonalTable {
  return {
    service: service as unknown as DatabaseService<DatabaseBaseModel>,
    query: extra?.query,
    sqlCondition: extra?.sqlCondition,
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
   * (walkFormerMembers).
   */
  public static async removePersonalNotificationSettingsOfFormerMembers(): Promise<FormerMemberCleanupResult> {
    return await this.walkFormerMembers({
      pairs: await this.getFormerMemberPairs(),
      remove: (data: {
        projectId: ObjectID;
        userId: ObjectID;
      }): Promise<ProjectLeaveNotificationCleanupResult> => {
        return this.removePersonalNotificationSettings(data);
      },
    });
  }

  /*
   * The (project, person) pairs, in key order, that hold rows in a personal
   * notification table but no accepted membership of the project.
   */
  public static async getFormerMemberPairs(): Promise<Array<ProjectUserRow>> {
    return await this.getFormerMemberPairsIn(
      this.getPersonalNotificationTables(),
    );
  }

  /*
   * Removes each pair's rows (`remove`) after re-checking, just before, that
   * the person still is not a member - somebody who joined again in between
   * keeps everything. A pair that fails is logged and the walk goes on.
   * Idempotent, and safe to run twice at once: it only ever removes rows of
   * people who are not members.
   */
  public static async walkFormerMembers(data: {
    pairs: Array<ProjectUserRow>;
    remove: (pair: {
      projectId: ObjectID;
      userId: ObjectID;
    }) => Promise<ProjectLeaveNotificationCleanupResult>;
  }): Promise<FormerMemberCleanupResult> {
    const result: FormerMemberCleanupResult = {
      cleanedPairCount: 0,
      removedRowCount: 0,
      failedPairCount: 0,
    };

    for (const pair of data.pairs) {
      const projectId: ObjectID = new ObjectID(pair.projectId);
      const userId: ObjectID = new ObjectID(pair.userId);

      try {
        if (
          await TeamMemberService.isUserMemberOfProject({
            projectId: projectId,
            userId: userId,
          })
        ) {
          continue;
        }

        const removed: ProjectLeaveNotificationCleanupResult =
          await data.remove({
            projectId: projectId,
            userId: userId,
          });

        result.cleanedPairCount += 1;

        for (const count of Object.values(removed.removedRowCounts)) {
          result.removedRowCount += count;
        }

        if (removed.failedTables.length > 0) {
          result.failedPairCount += 1;
        }
      } catch (err) {
        result.failedPairCount += 1;

        logger.error(
          err as Error,
          {
            projectId: pair.projectId,
            userId: pair.userId,
          } as LogAttributes,
        );
      }
    }

    return result;
  }

  /*
   * The (project, person) pairs, in key order, that hold rows in any of
   * `tables` but no accepted membership of the project (ProjectMembership's
   * rule, in SQL). One statement, one pass over each table: the pairs are
   * few - one per person who left a project and still has rows there - and
   * reading them a page at a time would make Postgres rebuild the whole
   * union for every page.
   */
  public static async getFormerMemberPairsIn(
    tables: Array<PersonalTable>,
  ): Promise<Array<ProjectUserRow>> {
    const sources: Array<string> = tables.map(
      (table: PersonalTable): string => {
        const tableName: string = table.service.getModel().tableName || "";

        return `SELECT "projectId", "userId" FROM ${quoteIdentifier(
          tableName,
        )} WHERE "deletedAt" IS NULL${
          table.sqlCondition ? ` AND ${table.sqlCondition}` : ""
        }`;
      },
    );

    if (sources.length === 0) {
      return [];
    }

    const rows: Array<ProjectUserRow> =
      await TeamMemberService.getRepository().manager.query(
        `SELECT personal."projectId", personal."userId"
           FROM (${sources.join(" UNION ")}) personal
          WHERE personal."projectId" IS NOT NULL
            AND personal."userId" IS NOT NULL
            AND NOT ${ProjectMembership.getMembershipExistsSql({
              projectIdSql: `personal."projectId"`,
              userIdSql: `personal."userId"`,
            })}
          ORDER BY personal."projectId" ASC, personal."userId" ASC`,
      );

    return rows || [];
  }

  public static async removePersonalNotificationSettings(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<ProjectLeaveNotificationCleanupResult> {
    const result: ProjectLeaveNotificationCleanupResult =
      await this.removeRowsOf({
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

  /*
   * Removes one person's rows in one project from each of `tables`, in
   * order, through each table's service as root. A table with nothing of
   * theirs is not written to; a table that fails is logged and named, and
   * the others still go.
   */
  public static async removeRowsOf(data: {
    projectId: ObjectID;
    userId: ObjectID;
    tables: Array<PersonalTable>;
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

    for (const table of data.tables) {
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

    return result;
  }
}
