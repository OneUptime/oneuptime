import DataMigrationBase from "./DataMigrationBase";
import AlertReminderRule from "Common/Models/DatabaseModels/AlertReminderRule";
import IncidentReminderRule from "Common/Models/DatabaseModels/IncidentReminderRule";
import ScheduledMaintenanceReminderRule from "Common/Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import AlertReminderRuleService from "Common/Server/Services/AlertReminderRuleService";
import IncidentReminderRuleService from "Common/Server/Services/IncidentReminderRuleService";
import ScheduledMaintenanceReminderRuleService from "Common/Server/Services/ScheduledMaintenanceReminderRuleService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * The two columns this pass reads from a reminder rule: its id, the cursor
 * the rule pages are walked by, and its project. All three rule models
 * satisfy it as they are.
 */
interface ReminderRuleProjectRow {
  id: ObjectID | null;
  projectId?: ObjectID | undefined;
}

interface ReminderRuleKind {
  // How the kind is named in the logs.
  label: string;
  // One `_id`-ordered page of enabled rules whose id sorts after `cursor`.
  findEnabledRulesAfter: (
    cursor: ObjectID | null,
  ) => Promise<Array<ReminderRuleProjectRow>>;
  // Schedules the project's open subjects that have no reminder at all.
  scheduleOpenSubjectsWithoutReminder: (projectId: ObjectID) => Promise<void>;
}

/*
 * Schedules the owner reminders that issue #4030 left unscheduled.
 *
 * The bug: from 13.0.3 until the fix, every read of an Incident, Alert or
 * Scheduled Maintenance reminder rule filtered by isEnabled failed in Postgres
 * ("missing FROM-clause entry for table incidentreminderrule"; the
 * criteria-backed isEnabled filter left the table alias unquoted). That read
 * is findMatchingRule, so refreshReminderSchedule threw before writing
 * nextReminderNotificationAt, and every caller (creating the subject, changing
 * the fields that pick its rule, creating or editing a rule) only logged the
 * error. Subjects opened or re-evaluated in that window were left
 * with nextReminderNotificationAt = NULL.
 *
 * The fix alone does not reach them. The reminder workers
 * (Jobs/{Incident,Alert,ScheduledMaintenance}Owners/SendUnresolvedReminderNotification)
 * select only subjects whose nextReminderNotificationAt is in the past, so a
 * NULL subject is never looked at again until someone edits it or a rule in
 * its project. Owners who configured reminders would go on getting none for
 * the subjects that most needed them: the ones still open since the upgrade.
 *
 * This runs the refresh those callers could not: for every project with an
 * enabled rule of a kind, it re-matches the rule for each open subject of
 * that kind and writes the timestamp, exactly as a rule edit would. Projects
 * with no enabled rule are skipped: nothing can match there, and NULL is
 * already the right answer for their subjects.
 *
 * Only subjects with NO timestamp are touched
 * (refreshSchedulesForOpen*({ onlyWithoutNextReminder: true })). A subject
 * that already had one kept it through the bug: the worker's own rule lookup
 * threw, so it left the timestamp in place and retried every minute, and
 * once the fix ships it sends that overdue reminder on its next tick.
 * Re-scheduling it here would push that reminder one full interval later.
 * With that option the refresh reads every such subject of the project, in
 * `_id`-cursored pages of LIMIT_MAX, so a project with more of them than one
 * read returns (a noisy alert project, where the subjects no rule matches
 * stay NULL) is covered in full.
 *
 * A subject whose NULL was correct (no rule matches it, reminders are off on
 * it, or its rule stops on acknowledgement and it was acknowledged) is
 * re-evaluated the same way. The first two write NULL again. The third gets a
 * timestamp, and at that time the worker sees the acknowledgement and clears
 * it without notifying anyone, which is what already happens after any rule
 * edit.
 *
 * Idempotent, and safe to run twice concurrently as the runner requires
 * (see Workers/Utils/DataMigration.ts): a subject scheduled by one pass is no
 * longer NULL, so the other pass leaves it alone, and two passes that
 * schedule the same subject write the same rule's interval from now.
 *
 * Best effort: a subject or project the refresh cannot refresh is logged by
 * the refresh itself, with the projectId, and the rest carry on; a kind whose
 * rules cannot be read is logged and the other kinds still run. None of that
 * halts the migrations queued behind this one.
 *
 * Not covered: subjects opened by pre-fix pods while the rollout is still in
 * progress, once this pass has walked their project. The runner records this
 * migration as executed once migrate() resolves and never runs it again
 * (Workers/Utils/DataMigration.ts), but the pods still on the old code keep
 * failing the rule lookup, and so keep leaving NULLs, until the rollout
 * replaces them. With the Helm default
 * (migrate.hook: false) the migrate Job runs while the pods roll, and with
 * migrate.hook: true it runs pre-upgrade, before any pod is replaced, so
 * either way pre-fix pods can outlive the backfill; the same holds for a
 * subject whose rule-picking fields a pre-fix pod changed in that window. To reach them, re-save any reminder rule of that kind in the
 * project: its hooks run the same refresh for the project's open subjects
 * (without the NULL narrowing, so it also re-schedules the ones that already
 * have a timestamp, and in one read of at most LIMIT_MAX). Editing a
 * subject's labels or enableReminders (or its severity, for incidents and
 * alerts) re-evaluates that subject alone.
 */
export default class ScheduleRemindersMissedByReminderRuleLookup extends DataMigrationBase {
  public constructor() {
    super("ScheduleRemindersMissedByReminderRuleLookup");
  }

  public override async migrate(): Promise<void> {
    for (const kind of ScheduleRemindersMissedByReminderRuleLookup.getKinds()) {
      await this.scheduleMissedRemindersForKind(kind);
    }
  }

  private async scheduleMissedRemindersForKind(
    kind: ReminderRuleKind,
  ): Promise<void> {
    const projectIds: Array<ObjectID> =
      await this.findProjectIdsWithEnabledRules(kind);

    for (const projectId of projectIds) {
      /*
       * Not expected to catch anything: the refresh logs and swallows its
       * own failures, each subject it could not refresh and each project it
       * could not read, with the projectId. That is also why the summary
       * below counts no failures: it would always say none. This is a
       * backstop, so that a throw escaping the refresh can never cost the
       * remaining projects their reminders.
       */
      try {
        await kind.scheduleOpenSubjectsWithoutReminder(projectId);
      } catch (err) {
        logger.error(
          `ScheduleRemindersMissedByReminderRuleLookup: failed to schedule missed ${kind.label} reminders for project ${projectId.toString()}: ${err}`,
          { projectId: projectId.toString() } as LogAttributes,
        );
      }
    }

    logger.info(
      `ScheduleRemindersMissedByReminderRuleLookup: re-evaluated the unscheduled open ${kind.label} reminders of ${projectIds.length} project(s) with an enabled ${kind.label} reminder rule. Failures are not counted here: the refresh logs each ${kind.label} and each project it could not refresh, with the projectId.`,
    );
  }

  /*
   * Distinct project ids across the kind's enabled rules, in first-seen order.
   *
   * Paged by an `_id` cursor rather than an offset, so a rule a user creates
   * or deletes during the walk cannot shift the pages and hide another
   * project's only rule. A rule created during the walk refreshes its own
   * project anyway.
   *
   * If a page cannot be read the walk stops there and the projects already
   * found are still returned: each one has an enabled rule, and refreshing it
   * is no less correct because a later page failed.
   */
  private async findProjectIdsWithEnabledRules(
    kind: ReminderRuleKind,
  ): Promise<Array<ObjectID>> {
    const projectIdsByKey: Map<string, ObjectID> = new Map<string, ObjectID>();

    let cursor: ObjectID | null = null;

    try {
      while (true) {
        const rules: Array<ReminderRuleProjectRow> =
          await kind.findEnabledRulesAfter(cursor);

        for (const rule of rules) {
          if (rule.projectId) {
            const key: string = rule.projectId.toString();

            if (!projectIdsByKey.has(key)) {
              projectIdsByKey.set(key, rule.projectId);
            }
          }
        }

        if (rules.length < LIMIT_MAX) {
          break;
        }

        const lastId: ObjectID | null = rules[rules.length - 1]!.id;

        if (!lastId || (cursor && lastId.toString() <= cursor.toString())) {
          /*
           * A full page whose last row does not move the cursor forward
           * would be read again forever. Not reachable with `_id ASC` and a
           * `> cursor` filter; guarded so a broken sort cannot hang the
           * migration chain.
           */
          throw new Error(
            `the ${kind.label} reminder rule page did not advance its _id cursor`,
          );
        }

        cursor = lastId;
      }
    } catch (err) {
      logger.error(
        `ScheduleRemindersMissedByReminderRuleLookup: could not read every enabled ${kind.label} reminder rule, so only the ${projectIdsByKey.size} project(s) found before the failure are re-evaluated: ${err}`,
      );
    }

    return Array.from(projectIdsByKey.values());
  }

  /*
   * The query is written out per kind so each stays typed against its own
   * model. `isEnabled: true` is the same effective-enabled filter
   * findMatchingRule reads (DatabaseService rewrites it for criteria-backed
   * rules), so a project is walked exactly when a rule could match there.
   */
  private static getKinds(): Array<ReminderRuleKind> {
    return [
      {
        label: "incident",
        findEnabledRulesAfter: (
          cursor: ObjectID | null,
        ): Promise<Array<IncidentReminderRule>> => {
          return IncidentReminderRuleService.findBy({
            query: {
              isEnabled: true,
              ...(cursor ? { _id: QueryHelper.greaterThan(cursor) } : {}),
            },
            select: {
              _id: true,
              projectId: true,
            },
            sort: { _id: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
              isRoot: true,
            },
          });
        },
        scheduleOpenSubjectsWithoutReminder: (
          projectId: ObjectID,
        ): Promise<void> => {
          return IncidentReminderRuleService.refreshSchedulesForOpenIncidents(
            projectId,
            { onlyWithoutNextReminder: true },
          );
        },
      },
      {
        label: "alert",
        findEnabledRulesAfter: (
          cursor: ObjectID | null,
        ): Promise<Array<AlertReminderRule>> => {
          return AlertReminderRuleService.findBy({
            query: {
              isEnabled: true,
              ...(cursor ? { _id: QueryHelper.greaterThan(cursor) } : {}),
            },
            select: {
              _id: true,
              projectId: true,
            },
            sort: { _id: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
              isRoot: true,
            },
          });
        },
        scheduleOpenSubjectsWithoutReminder: (
          projectId: ObjectID,
        ): Promise<void> => {
          return AlertReminderRuleService.refreshSchedulesForOpenAlerts(
            projectId,
            { onlyWithoutNextReminder: true },
          );
        },
      },
      {
        label: "scheduled maintenance",
        findEnabledRulesAfter: (
          cursor: ObjectID | null,
        ): Promise<Array<ScheduledMaintenanceReminderRule>> => {
          return ScheduledMaintenanceReminderRuleService.findBy({
            query: {
              isEnabled: true,
              ...(cursor ? { _id: QueryHelper.greaterThan(cursor) } : {}),
            },
            select: {
              _id: true,
              projectId: true,
            },
            sort: { _id: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
              isRoot: true,
            },
          });
        },
        scheduleOpenSubjectsWithoutReminder: (
          projectId: ObjectID,
        ): Promise<void> => {
          return ScheduledMaintenanceReminderRuleService.refreshSchedulesForOpenScheduledMaintenances(
            projectId,
            { onlyWithoutNextReminder: true },
          );
        },
      },
    ];
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the timestamps written are the ones the fixed code
     * would have written, and clearing them again would restore the bug.
     */
    return;
  }
}
