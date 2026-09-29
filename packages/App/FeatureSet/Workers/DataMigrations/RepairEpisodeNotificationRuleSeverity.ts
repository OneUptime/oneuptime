import DataMigrationBase from "./DataMigrationBase";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";

/*
 * How many NULL-severity rules are pulled per round trip. Small on purpose: each row
 * fans out into one INSERT per severity in its project, so a large page turns into a
 * long-running write burst against a table the on-call path reads on every page.
 */
const BATCH_SIZE: number = 100;

/*
 * Repairs the episode notification rules that were created without a severity.
 *
 * The bug: addDefaultNotificationRulesForVerifiedMethod created the two episode rule
 * types through createSingleRule, which sets only `ruleType` and `notifyAfterMinutes` and
 * leaves `alertSeverityId` / `incidentSeverityId` NULL. But UserOnCallLogService counts
 * matching rules filtered by a CONCRETE severity id, and NULL never equals a uuid — so
 * every one of these "default" rules counted as zero and the page took the dead-end
 * branch. Users who never opened the episode rule pages (which is everyone who relied on
 * the defaults) got no episode pages at all.
 *
 * The forward fix creates these rules per severity. This migration repairs the rows
 * already in the table: each NULL-severity episode rule becomes one row per severity in
 * its project, preserving the notification-method FK and `notifyAfterMinutes` so the
 * user's original intent — "reach me here, after this long" — survives intact.
 *
 * Why the original is DELETED rather than left behind:
 *
 *   1. It can never match. The count query the on-call path runs always supplies a
 *      concrete severity id, so a NULL row is unreachable by construction, not merely
 *      unlikely.
 *   2. It is invisible. Both episode rule pages (EpisodeOnCallRules.tsx and
 *      IncidentEpisodeOnCallRules.tsx) scope their ModelTable by severity id, so a
 *      NULL-severity row renders in no table on any page.
 *
 * Together those mean the user can neither be notified by the row nor see it nor remove
 * it — it is pure invisible clutter that shows up only as an inflated rule count in any
 * future readiness or compliance calculation. Leaving it is strictly worse than removing
 * it, and the replacement rows carry everything it expressed.
 *
 * Idempotent: replacements are created only when an identical (project, user, ruleType,
 * severity, method) rule does not already exist, and the NULL originals are gone after a
 * successful pass, so a re-run finds nothing to do. Restartable: each row is fanned out
 * and deleted before the next is read, so a killed pod resumes with at most one row
 * half-done, and that row's duplicate replacements are suppressed by the existence check.
 */
export default class RepairEpisodeNotificationRuleSeverity extends DataMigrationBase {
  public constructor() {
    super("RepairEpisodeNotificationRuleSeverity");
  }

  public override async migrate(): Promise<void> {
    await this.repairRulesForEpisodeRuleType(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    );

    await this.repairRulesForEpisodeRuleType(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    );
  }

  private async repairRulesForEpisodeRuleType(
    ruleType: NotificationRuleType,
  ): Promise<void> {
    const isAlertEpisode: boolean =
      ruleType === NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE;

    const query: Query<UserNotificationRule> = isAlertEpisode
      ? {
          ruleType: ruleType,
          alertSeverityId: QueryHelper.isNull(),
        }
      : {
          ruleType: ruleType,
          incidentSeverityId: QueryHelper.isNull(),
        };

    /*
     * Severity lists are per project and every rule in a project fans out to the same
     * list, so they are resolved once per project rather than once per rule. Keyed by
     * project id; a project with thousands of affected users is the common shape here.
     */
    const severityIdsByProjectId: Map<string, Array<ObjectID>> = new Map<
      string,
      Array<ObjectID>
    >();

    let createdCount: number = 0;
    let deletedCount: number = 0;

    /*
     * Rows we deliberately do not touch stay in the table, so they would be returned
     * again by the next page-zero query and the loop would never drain. The cursor is
     * therefore the running count of rows left in place: with `_id ASC` every row from an
     * already-processed page sorts before every row not yet seen, so the untouched rows
     * occupy exactly the first `leftInPlaceCount` positions of the remaining result set.
     *
     * (Rows INSERTed by another process mid-migration can land anywhere in that ordering
     * because ids are random uuids, so a concurrent writer could hide one row from this
     * pass. Data migrations run at boot before this pod serves traffic, and the pass is
     * idempotent, so the cost of that is one extra run — not a corrupted row.)
     */
    let leftInPlaceCount: number = 0;

    for (;;) {
      const rules: Array<UserNotificationRule> =
        await UserNotificationRuleService.findBy({
          query: query,
          select: {
            _id: true,
            projectId: true,
            userId: true,
            notifyAfterMinutes: true,
            userEmailId: true,
            userSmsId: true,
            userCallId: true,
            userPushId: true,
            userWhatsAppId: true,
            userTelegramId: true,
            userSlackId: true,
            userMicrosoftTeamsId: true,
            userWebhookId: true,
          },
          sort: {
            _id: SortOrder.Ascending,
          },
          skip: leftInPlaceCount,
          limit: BATCH_SIZE,
          props: {
            isRoot: true,
          },
        });

      if (rules.length === 0) {
        break;
      }

      for (const rule of rules) {
        if (!rule.id || !rule.projectId || !rule.userId) {
          /*
           * A rule with no project or user cannot be fanned out (the replacement would
           * fail the model's own NOT NULL constraints) and cannot be reasoned about.
           * Left alone and reported rather than deleted: deleting rows we do not
           * understand is not a repair.
           */
          logger.debug(
            `RepairEpisodeNotificationRuleSeverity: skipping rule ${rule.id?.toString() || "(no id)"} because it has no projectId or userId.`,
          );
          leftInPlaceCount++;
          continue;
        }

        const methodFks: Partial<UserNotificationRule> =
          this.getNotificationMethodColumns(rule);

        if (Object.keys(methodFks).length === 0) {
          /*
           * No notification method at all. Every rule createSingleRule produced carries
           * exactly one, so this is something else — an opt-out row, or a row a future
           * feature gave a meaning this migration predates. Fanning it out would create
           * rules that deliver nothing and would be rejected by onBeforeCreate anyway.
           */
          logger.debug(
            `RepairEpisodeNotificationRuleSeverity: skipping rule ${rule.id.toString()} because it carries no notification method.`,
          );
          leftInPlaceCount++;
          continue;
        }

        const severityIds: Array<ObjectID> =
          await this.getSeverityIdsForProject({
            projectId: rule.projectId,
            isAlertEpisode: isAlertEpisode,
            cache: severityIdsByProjectId,
          });

        if (severityIds.length === 0) {
          /*
           * The project has no severities of this kind, so there is nothing to fan out
           * to. Deleting here would throw away the user's chosen method and delay for a
           * severity that has simply not been created yet, and would gain nothing — the
           * row is equally unreachable either way. Left in place; the severity-creation
           * backfill picks the intent up when the project's first severity appears.
           */
          logger.debug(
            `RepairEpisodeNotificationRuleSeverity: project ${rule.projectId.toString()} has no ${isAlertEpisode ? "alert" : "incident"} severities, leaving rule ${rule.id.toString()} in place.`,
          );
          leftInPlaceCount++;
          continue;
        }

        for (const severityId of severityIds) {
          const created: boolean = await this.createRuleForSeverity({
            rule: rule,
            ruleType: ruleType,
            severityId: severityId,
            isAlertEpisode: isAlertEpisode,
            methodFks: methodFks,
          });

          if (created) {
            createdCount++;
          }
        }

        /*
         * Only after every replacement exists. If a create throws, the exception halts
         * the migration with the original still present, so the retry re-runs a row that
         * is at worst partially fanned out — and the existence check makes that free.
         */
        await UserNotificationRuleService.deleteOneById({
          id: rule.id,
          props: {
            isRoot: true,
          },
        });

        deletedCount++;
      }
    }

    logger.debug(
      `RepairEpisodeNotificationRuleSeverity: ${ruleType} — created ${createdCount} severity-scoped rule(s), deleted ${deletedCount} NULL-severity rule(s), left ${leftInPlaceCount} row(s) untouched.`,
    );
  }

  /*
   * Creates the replacement for one (rule, severity) pair unless it already exists.
   * Returns whether a row was written, so the caller can report a truthful count on a
   * partially-completed re-run.
   */
  private async createRuleForSeverity(input: {
    rule: UserNotificationRule;
    ruleType: NotificationRuleType;
    severityId: ObjectID;
    isAlertEpisode: boolean;
    methodFks: Partial<UserNotificationRule>;
  }): Promise<boolean> {
    const { rule, ruleType, severityId, isAlertEpisode, methodFks } = input;

    const severityQuery: Query<UserNotificationRule> = isAlertEpisode
      ? { alertSeverityId: severityId }
      : { incidentSeverityId: severityId };

    const existingRule: UserNotificationRule | null =
      await UserNotificationRuleService.findOneBy({
        query: {
          projectId: rule.projectId!,
          userId: rule.userId!,
          ruleType: ruleType,
          ...severityQuery,
          ...methodFks,
        } as Query<UserNotificationRule>,
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (existingRule) {
      return false;
    }

    const newRule: UserNotificationRule = new UserNotificationRule();
    newRule.projectId = rule.projectId!;
    newRule.userId = rule.userId!;
    newRule.ruleType = ruleType;

    /*
     * `notifyAfterMinutes` is the whole reason this is a fan-out rather than a delete:
     * a user who set "page me on Telegram after 15 minutes" keeps that delay on every
     * severity. Defaulted to 0 only when the original never carried one.
     */
    newRule.notifyAfterMinutes = rule.notifyAfterMinutes ?? 0;

    if (isAlertEpisode) {
      newRule.alertSeverityId = severityId;
    } else {
      newRule.incidentSeverityId = severityId;
    }

    Object.assign(newRule, methodFks);

    await UserNotificationRuleService.create({
      data: newRule,
      props: {
        isRoot: true,
      },
    });

    return true;
  }

  /*
   * The notification-method FK the original rule points at, as a partial model that can
   * be spread into both the duplicate-detection query and the replacement row. Copying
   * every FK that is set (rather than assuming one) keeps this correct if a rule is ever
   * allowed to name more than one method.
   */
  private getNotificationMethodColumns(
    rule: UserNotificationRule,
  ): Partial<UserNotificationRule> {
    const columns: Partial<UserNotificationRule> = {};

    if (rule.userEmailId) {
      columns.userEmailId = rule.userEmailId;
    }

    if (rule.userSmsId) {
      columns.userSmsId = rule.userSmsId;
    }

    if (rule.userCallId) {
      columns.userCallId = rule.userCallId;
    }

    if (rule.userPushId) {
      columns.userPushId = rule.userPushId;
    }

    if (rule.userWhatsAppId) {
      columns.userWhatsAppId = rule.userWhatsAppId;
    }

    if (rule.userTelegramId) {
      columns.userTelegramId = rule.userTelegramId;
    }

    if (rule.userSlackId) {
      columns.userSlackId = rule.userSlackId;
    }

    if (rule.userMicrosoftTeamsId) {
      columns.userMicrosoftTeamsId = rule.userMicrosoftTeamsId;
    }

    if (rule.userWebhookId) {
      columns.userWebhookId = rule.userWebhookId;
    }

    return columns;
  }

  private async getSeverityIdsForProject(input: {
    projectId: ObjectID;
    isAlertEpisode: boolean;
    cache: Map<string, Array<ObjectID>>;
  }): Promise<Array<ObjectID>> {
    const { projectId, isAlertEpisode, cache } = input;

    const cacheKey: string = projectId.toString();
    const cached: Array<ObjectID> | undefined = cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    let severityIds: Array<ObjectID> = [];

    if (isAlertEpisode) {
      const severities: Array<AlertSeverity> =
        await AlertSeverityService.findBy({
          query: {
            projectId: projectId,
          },
          select: {
            _id: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      severityIds = severities.map((severity: AlertSeverity) => {
        return severity.id!;
      });
    } else {
      const severities: Array<IncidentSeverity> =
        await IncidentSeverityService.findBy({
          query: {
            projectId: projectId,
          },
          select: {
            _id: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      severityIds = severities.map((severity: IncidentSeverity) => {
        return severity.id!;
      });
    }

    cache.set(cacheKey, severityIds);

    return severityIds;
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately not reversible. Recreating the NULL-severity originals would restore
     * rows that page nobody and that the user cannot see or delete — the exact defect
     * this migration exists to remove.
     */
    return;
  }
}
