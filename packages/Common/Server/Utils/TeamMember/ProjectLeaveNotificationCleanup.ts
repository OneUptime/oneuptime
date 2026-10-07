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
import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
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
   * Extra conditions on top of (projectId, userId), as a query and as the
   * same condition in SQL for finding former members' rows. Only the email
   * rollup queue has one: its sent rows are the record of what went out,
   * like notification logs, and expire by themselves; the pending ones are
   * project mail still waiting to reach the person.
   */
  query?: Dictionary<unknown> | undefined;
  sqlCondition?: string | undefined;
}

/*
 * A column of a history table that points at one of a person's own
 * notification rules or methods. The database deletes the history row along
 * with the rule or method it points at (ON DELETE CASCADE), so these columns
 * are cleared before anything is removed (keepHistory): the history stays -
 * who was paged, when, how it went - and no longer points at a rule or
 * method that is gone.
 */
export interface HistoryReference {
  history: DatabaseService<DatabaseBaseModel>;
  column: string;
  references: DatabaseService<DatabaseBaseModel>;
}

/*
 * What removePersonalNotificationSettingsOfFormerMembers did: how many
 * (project, person) pairs it cleaned, how many rows went, and how many pairs
 * failed part way (logged; the walk goes on).
 */
export interface FormerMemberCleanupResult {
  cleanedPairCount: number;
  removedRowCount: number;
  failedPairCount: number;
}

interface ProjectUserRow {
  projectId: string;
  userId: string;
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function historyReference<
  THistory extends DatabaseBaseModel,
  TPersonal extends DatabaseBaseModel,
>(
  history: DatabaseService<THistory>,
  column: string,
  references: DatabaseService<TPersonal>,
): HistoryReference {
  return {
    history: history as unknown as DatabaseService<DatabaseBaseModel>,
    column: column,
    references: references as unknown as DatabaseService<DatabaseBaseModel>,
  };
}

function personalTable<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
  extra?: { query: Dictionary<unknown>; sqlCondition: string },
): PersonalNotificationTable {
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
 * history points at the rule and method each page went out through, and the
 * database would delete it with them; those references are cleared first
 * (keepHistory). If that fails, the rules and methods the history points at
 * stay (they reach nobody who is not a member) and everything else goes.
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
   * Every history column that points at a personal table above. A new one
   * belongs here too - the guard test fails when a relation to a personal
   * table is neither here nor in a personal table itself.
   */
  public static getHistoryReferences(): Array<HistoryReference> {
    return [
      historyReference(
        UserOnCallLogTimelineService,
        "userNotificationRuleId",
        UserNotificationRuleService,
      ),
      historyReference(
        UserOnCallLogTimelineService,
        "userEmailId",
        UserEmailService,
      ),
      historyReference(
        UserOnCallLogTimelineService,
        "userSmsId",
        UserSmsService,
      ),
      historyReference(
        UserOnCallLogTimelineService,
        "userCallId",
        UserCallService,
      ),
      historyReference(
        UserOnCallLogTimelineService,
        "userWhatsAppId",
        UserWhatsAppService,
      ),
      historyReference(
        UserOnCallLogTimelineService,
        "userTelegramId",
        UserTelegramService,
      ),
      historyReference(
        UserOnCallLogTimelineService,
        "userPushId",
        UserPushService,
      ),
      historyReference(
        UserOnCallLogTimelineService,
        "userWebhookId",
        UserWebhookService,
      ),
      historyReference(
        UserOnCallLogTimelineService,
        "userSlackId",
        UserSlackService,
      ),
      historyReference(
        UserOnCallLogTimelineService,
        "userMicrosoftTeamsId",
        UserMicrosoftTeamsService,
      ),
    ];
  }

  /*
   * Clears every history reference (getHistoryReferences) to this person's
   * own rules and methods in this project - one statement per history table,
   * touching only the columns that point at a row about to be removed.
   */
  public static async keepHistory(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    const byHistoryTable: Map<string, Array<HistoryReference>> = new Map<
      string,
      Array<HistoryReference>
    >();

    for (const reference of this.getHistoryReferences()) {
      const historyTable: string = reference.history.getModel().tableName || "";
      const references: Array<HistoryReference> =
        byHistoryTable.get(historyTable) || [];

      references.push(reference);
      byHistoryTable.set(historyTable, references);
    }

    for (const [historyTable, references] of byHistoryTable.entries()) {
      const ownRows: (reference: HistoryReference) => string = (
        reference: HistoryReference,
      ): string => {
        return `SELECT personal."_id" FROM ${quoteIdentifier(
          reference.references.getModel().tableName || "",
        )} personal WHERE personal."projectId" = $1 AND personal."userId" = $2`;
      };

      const assignments: Array<string> = references.map(
        (reference: HistoryReference): string => {
          const column: string = quoteIdentifier(reference.column);

          return `${column} = CASE WHEN history.${column} IN (${ownRows(
            reference,
          )}) THEN NULL ELSE history.${column} END`;
        },
      );

      const conditions: Array<string> = references.map(
        (reference: HistoryReference): string => {
          return `history.${quoteIdentifier(reference.column)} IN (${ownRows(
            reference,
          )})`;
        },
      );

      await TeamMemberService.getRepository().manager.query(
        `UPDATE ${quoteIdentifier(historyTable)} history SET ${assignments.join(
          ", ",
        )} WHERE ${conditions.join(" OR ")}`,
        [data.projectId.toString(), data.userId.toString()],
      );
    }
  }

  /*
   * For the RemoveNotificationSettingsOfFormerMembers data migration: the
   * same removal for everybody who already left before it ran. Finds the
   * (project, person) pairs that still hold rows in any table above but no
   * accepted membership of the project - one statement, one pass over each
   * table - then re-checks each pair just before removing (somebody who
   * joined again in between keeps everything); a pair that fails is logged
   * and the walk goes on. Idempotent, and safe to run twice at once: it only
   * ever removes rows of people who are not members.
   */
  public static async removePersonalNotificationSettingsOfFormerMembers(): Promise<FormerMemberCleanupResult> {
    const result: FormerMemberCleanupResult = {
      cleanedPairCount: 0,
      removedRowCount: 0,
      failedPairCount: 0,
    };

    const pairs: Array<ProjectUserRow> = await this.getFormerMemberPairs();

    for (const pair of pairs) {
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
          await this.removePersonalNotificationSettings({
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
   * The (project, person) pairs, in key order, that hold rows in a personal
   * notification table but no accepted membership of the project
   * (ProjectMembership's rule, in SQL).
   */
  public static async getFormerMemberPairs(): Promise<Array<ProjectUserRow>> {
    const sources: Array<string> = this.getPersonalNotificationTables().map(
      (table: PersonalNotificationTable): string => {
        const tableName: string = table.service.getModel().tableName || "";

        return `SELECT "projectId", "userId" FROM "${tableName.replace(
          /"/g,
          '""',
        )}" WHERE "deletedAt" IS NULL${
          table.sqlCondition ? ` AND ${table.sqlCondition}` : ""
        }`;
      },
    );

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
    const { projectId, userId } = data;

    const logAttributes: LogAttributes = {
      projectId: projectId.toString(),
      userId: userId.toString(),
    } as LogAttributes;

    const result: ProjectLeaveNotificationCleanupResult = {
      removedRowCounts: {},
      failedTables: [],
    };

    /*
     * The tables the history points at. If the history cannot be kept, they
     * stay - removing a rule or method would remove the on-call history that
     * points at it - and the person still receives nothing through them
     * (ProjectMembership). Everything else goes either way.
     */
    const tablesTheHistoryPointsAt: Set<string> = new Set<string>(
      this.getHistoryReferences().map((reference: HistoryReference): string => {
        return reference.references.getModel().tableName || "";
      }),
    );

    let isHistoryKept: boolean = true;

    try {
      await this.keepHistory({ projectId, userId });
    } catch (err) {
      isHistoryKept = false;

      logger.error(
        "Error keeping the on-call history of a user who left the project; their notification rules and methods were left in place.",
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
    }

    for (const table of this.getPersonalNotificationTables()) {
      const tableName: string = table.service.getModel().tableName || "";

      if (!isHistoryKept && tablesTheHistoryPointsAt.has(tableName)) {
        result.failedTables.push(tableName);
        continue;
      }

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
