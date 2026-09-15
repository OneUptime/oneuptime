import PostgresAppInstance, {
  DatabaseSource,
} from "../../Infrastructure/PostgresDatabase";
import {
  MIGRATED_MONITOR_RULE_DESCRIPTION,
  MIGRATED_MONITOR_RULE_NAME,
} from "../../Infrastructure/Postgres/SchemaMigrations/1793000000000-BackfillSloMonitorRulesAndAffectedResources";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import ObjectID from "../../../Types/ObjectID";
import { EntityManager } from "typeorm";

/*
 * Turns an SLO's deprecated "Auto-Add Monitors With Labels" list into a real
 * SLO Monitor Rule, for SLOs the one-shot backfill could not have seen.
 *
 * WHY THIS EXISTS. Migration 1793000000000 converts every label list into a
 * rule once, when the migrate Job runs. The label table itself is kept so API
 * pods from the previous release keep working during a rolling deploy - and
 * those pods keep WRITING it: their create and edit forms still ask for
 * auto-add labels, and their engine attaches the matching monitors as
 * autoAddedMonitors. A dashboard tab opened before the upgrade, an API client
 * or a workflow can also still send the list to the NEW pods, because the
 * column stays in the API. Anything written that way after the backfill has
 * no rule, and the new engine reads only rules: the next sync of that SLO
 * released every monitor the list had attached, and the SLO quietly stopped
 * measuring the monitors its owner configured.
 *
 * WHY NOT A DATA MIGRATION. A Workers data migration does not run "after the
 * deploy": the migrate Job runs the Postgres schema migrations and then the
 * data migrations back to back, in one process. With the chart's default
 * migrate.hook=false that happens while the pods roll; with hook=true it
 * happens before they roll at all. Either way previous-release pods keep
 * serving after it finishes, so a re-run there closes nothing.
 *
 * So the new code adopts the list itself, at each moment it would otherwise
 * lose it:
 *
 *   - a monitor changed, and an SLO still records it as rule-attached but has
 *     no enabled rule (ServiceLevelObjectiveMonitorRuleEngineService
 *     .syncSlosForMonitor);
 *   - somebody is creating an SLO's first monitor rule, whose sync would
 *     otherwise run with only that rule and detach everything the list
 *     attached (ServiceLevelObjectiveMonitorRuleService.onBeforeCreate - before
 *     the new rule row exists, so "no rule row" still means what it says);
 *   - the list itself was just written through the deprecated column
 *     (ServiceLevelObjectiveService, after the create or update).
 *
 * WHICH SLOs ARE ADOPTED. Only those with label rows AND no monitor rule row
 * at all - enabled or disabled - AND, unless the list was just written,
 * monitors still recorded as rule-attached. Those conditions are what keep a
 * rule the user deleted from coming back:
 *
 *   - An SLO the backfill already converted still has its label rows (they
 *     are never deleted, for the reason below). If its user disables the
 *     rule, a rule row still exists, so nothing is adopted and the disable
 *     means what it says.
 *   - If its user deletes every rule, the delete's own sync releases every
 *     rule-attached monitor. That SLO has label rows and no rule rows - the
 *     same as a list a previous-release pod wrote - so the rule-attached
 *     monitors are the evidence that tells the two apart: only the legacy
 *     engine leaves monitors attached by a list with no rule behind it. Only a
 *     delete whose sync failed and left monitors behind can still be adopted,
 *     and then the rule that comes back describes monitors that really are
 *     attached.
 *   - A list that was just written needs no such evidence: the write is the
 *     owner saying what the SLO should measure now, and a brand-new list has
 *     not attached anything yet. ServiceLevelObjectiveService only asks for
 *     this when the write changed the stored list, so an out-of-date form
 *     re-submitting the list it loaded does not bring a deleted rule back.
 *
 * The rule-side sync (syncMonitorsForSlo) never adopts, and neither do rule
 * edits and deletes: after a rule delete, "no rule rows, monitors still
 * attached" is exactly what a deliberate delete looks like, and an edited
 * rule is itself a rule row.
 *
 * The label rows are left in place, like the backfill leaves them. Deleting
 * them here would hand previous-release pods an SLO with an empty label list,
 * and their SLO edit form re-submits that list - its sync would then release
 * every rule-attached monitor. The rule written here makes them irrelevant to
 * the new engine.
 *
 * The rule has the backfill's name and description, so it reads the same as
 * every other converted rule. It is written in SQL, with no hooks, as the
 * backfill is; the caller re-syncs the SLO right after, and that sync is what
 * posts the membership feed items.
 *
 * Safe to run concurrently. Two monitor edits, or a monitor edit and a rule
 * create, can reach the same SLO at once, and "no rule exists" is a
 * read-then-write. The SLO rows are locked first (in id order, so two runs
 * cannot deadlock), and under READ COMMITTED the adopt statement takes its
 * snapshot after the lock is granted - so a second run sees the first run's
 * rule and inserts nothing.
 */

export const SLO_LEGACY_MONITOR_LABEL_LOCK_STATEMENT: string = `SELECT "_id" FROM "ServiceLevelObjective" WHERE "_id" = ANY($1::uuid[]) AND "projectId" = $2 ORDER BY "_id" FOR UPDATE`;

export const SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT: string = `WITH "adoptedRules" AS (INSERT INTO "ServiceLevelObjectiveMonitorRule" ("_id", "version", "projectId", "serviceLevelObjectiveId", "name", "description", "isEnabled") SELECT uuid_generate_v4(), 1, slo."projectId", slo."_id", $3, $4, true FROM "ServiceLevelObjective" slo WHERE slo."_id" = ANY($1::uuid[]) AND slo."projectId" = $2 AND slo."deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "ServiceLevelObjectiveMonitorLabel" sml WHERE sml."serviceLevelObjectiveId" = slo."_id") AND NOT EXISTS (SELECT 1 FROM "ServiceLevelObjectiveMonitorRule" existing WHERE existing."serviceLevelObjectiveId" = slo."_id") AND (NOT $5::boolean OR EXISTS (SELECT 1 FROM "ServiceLevelObjectiveAutoAddedMonitor" attached WHERE attached."serviceLevelObjectiveId" = slo."_id")) RETURNING "_id", "serviceLevelObjectiveId"), "adoptedLabels" AS (INSERT INTO "ServiceLevelObjectiveMonitorRuleMonitorLabel" ("serviceLevelObjectiveMonitorRuleId", "labelId") SELECT "adoptedRules"."_id", sml."labelId" FROM "adoptedRules" INNER JOIN "ServiceLevelObjectiveMonitorLabel" sml ON sml."serviceLevelObjectiveId" = "adoptedRules"."serviceLevelObjectiveId" ON CONFLICT DO NOTHING) SELECT "serviceLevelObjectiveId" FROM "adoptedRules"`;

interface AdoptedRuleRow {
  serviceLevelObjectiveId: string;
}

export default class SloLegacyMonitorLabelAdoption {
  /*
   * Adopts the label lists of those `serviceLevelObjectiveIds` (in
   * `projectId`) that have one and no monitor rule, and returns the ids of the
   * SLOs a rule was written for, lower-cased. Everything else is left
   * untouched, so calling it for an SLO that needs nothing is a no-op.
   *
   * `requireRuleAttachedMonitors` (default true) additionally requires the SLO
   * to still hold monitors as rule-attached - the evidence that the list was
   * written by a previous-release pod rather than left behind when the user
   * deleted the rule it had become. Pass false only when the caller has just
   * seen the list itself change through the deprecated column.
   */
  public static async adoptLegacyMonitorLabels(data: {
    projectId: ObjectID;
    serviceLevelObjectiveIds: Array<ObjectID | string>;
    requireRuleAttachedMonitors?: boolean | undefined;
  }): Promise<Array<string>> {
    const sloIds: Array<string> = Array.from(
      new Set<string>(
        data.serviceLevelObjectiveIds
          .map((id: ObjectID | string): string => {
            return id.toString().toLowerCase();
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      ),
    );

    if (sloIds.length === 0) {
      return [];
    }

    const dataSource: DatabaseSource | null =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new DatabaseNotConnectedException();
    }

    const projectId: string = data.projectId.toString();

    const requireRuleAttachedMonitors: boolean =
      data.requireRuleAttachedMonitors !== false;

    return await dataSource.transaction(
      async (manager: EntityManager): Promise<Array<string>> => {
        await manager.query(SLO_LEGACY_MONITOR_LABEL_LOCK_STATEMENT, [
          sloIds,
          projectId,
        ]);

        const rows: Array<AdoptedRuleRow> = await manager.query(
          SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT,
          [
            sloIds,
            projectId,
            MIGRATED_MONITOR_RULE_NAME,
            MIGRATED_MONITOR_RULE_DESCRIPTION,
            requireRuleAttachedMonitors,
          ],
        );

        return rows.map((row: AdoptedRuleRow): string => {
          return row.serviceLevelObjectiveId.toString().toLowerCase();
        });
      },
    );
  }
}
