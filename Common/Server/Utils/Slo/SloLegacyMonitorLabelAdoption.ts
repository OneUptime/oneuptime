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
 * autoAddedMonitors. Anything written that way after the backfill has no rule.
 * Once new pods serve traffic, the new engine reads only rules, so the first
 * edit to one of those monitors released it (the SLO holds it as
 * rule-attached, and no rule matches), and the SLO quietly stopped measuring
 * the monitors its owner configured.
 *
 * WHY NOT A DATA MIGRATION. A Workers data migration does not run "after the
 * deploy": the migrate Job runs the Postgres schema migrations and then the
 * data migrations back to back, in one process. With the chart's default
 * migrate.hook=false that happens while the pods roll; with hook=true it
 * happens before they roll at all. Either way previous-release pods keep
 * serving after it finishes, so a re-run there closes nothing.
 *
 * So the new engine adopts the list itself, at the moment it would otherwise
 * release those monitors: when a monitor changes and an SLO still records it
 * as rule-attached but has no enabled rule (see
 * ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor).
 *
 * WHICH SLOs ARE ADOPTED. Only those with label rows AND no monitor rule row
 * at all - enabled or disabled. That condition is what keeps a rule the user
 * deleted from coming back:
 *
 *   - An SLO the backfill already converted still has its label rows (they
 *     are never deleted, for the reason above). If its user disables the
 *     rule, a rule row still exists, so nothing is adopted and the disable
 *     means what it says.
 *   - If its user deletes every rule, the delete's own sync releases every
 *     rule-attached monitor, so the SLO no longer holds any monitor as
 *     rule-attached and the monitor-side sync never reaches it. Only a delete
 *     whose sync failed and left monitors behind can still be adopted - and
 *     then the rule that comes back describes monitors that really are
 *     attached.
 *
 * The rule-side sync (syncMonitorsForSlo) never adopts: it runs right after a
 * rule delete, when "no rule rows, monitors still attached" is exactly what a
 * deliberate delete looks like.
 *
 * The label rows are left in place, like the backfill leaves them. Deleting
 * them here would hand previous-release pods an SLO with an empty label list,
 * and their SLO edit form re-submits that list - its sync would then release
 * every rule-attached monitor. The rule written here makes them irrelevant to
 * the new engine.
 *
 * The rule has the backfill's name and description, so it reads the same as
 * every other converted rule. It is written in SQL, with no hooks, as the
 * backfill is; the engine re-syncs the SLO right after, and that sync is what
 * posts the membership feed items.
 *
 * Safe to run concurrently. Two monitor edits can reach the same SLO at once,
 * and "no rule exists" is a read-then-write. The SLO rows are locked first
 * (in id order, so two runs cannot deadlock), and under READ COMMITTED the
 * adopt statement takes its snapshot after the lock is granted - so a second
 * run sees the first run's rule and inserts nothing.
 */

export const SLO_LEGACY_MONITOR_LABEL_LOCK_STATEMENT: string = `SELECT "_id" FROM "ServiceLevelObjective" WHERE "_id" = ANY($1::uuid[]) AND "projectId" = $2 ORDER BY "_id" FOR UPDATE`;

export const SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT: string = `WITH "adoptedRules" AS (INSERT INTO "ServiceLevelObjectiveMonitorRule" ("_id", "version", "projectId", "serviceLevelObjectiveId", "name", "description", "isEnabled") SELECT uuid_generate_v4(), 1, slo."projectId", slo."_id", $3, $4, true FROM "ServiceLevelObjective" slo WHERE slo."_id" = ANY($1::uuid[]) AND slo."projectId" = $2 AND slo."deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "ServiceLevelObjectiveMonitorLabel" sml WHERE sml."serviceLevelObjectiveId" = slo."_id") AND NOT EXISTS (SELECT 1 FROM "ServiceLevelObjectiveMonitorRule" existing WHERE existing."serviceLevelObjectiveId" = slo."_id") RETURNING "_id", "serviceLevelObjectiveId"), "adoptedLabels" AS (INSERT INTO "ServiceLevelObjectiveMonitorRuleMonitorLabel" ("serviceLevelObjectiveMonitorRuleId", "labelId") SELECT "adoptedRules"."_id", sml."labelId" FROM "adoptedRules" INNER JOIN "ServiceLevelObjectiveMonitorLabel" sml ON sml."serviceLevelObjectiveId" = "adoptedRules"."serviceLevelObjectiveId" ON CONFLICT DO NOTHING) SELECT "serviceLevelObjectiveId" FROM "adoptedRules"`;

interface AdoptedRuleRow {
  serviceLevelObjectiveId: string;
}

export default class SloLegacyMonitorLabelAdoption {
  /*
   * Adopts the label lists of those `serviceLevelObjectiveIds` (in
   * `projectId`) that have one and no monitor rule, and returns the ids of the
   * SLOs a rule was written for, lower-cased. Everything else is left
   * untouched, so calling it for an SLO that needs nothing is a no-op.
   */
  public static async adoptLegacyMonitorLabels(data: {
    projectId: ObjectID;
    serviceLevelObjectiveIds: Array<ObjectID | string>;
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
          ],
        );

        return rows.map((row: AdoptedRuleRow): string => {
          return row.serviceLevelObjectiveId.toString().toLowerCase();
        });
      },
    );
  }
}
