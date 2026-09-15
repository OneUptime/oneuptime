import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data backfill for the SLO product overhaul. Runs after
 * SloProductOverhaul1792900000000, which created the tables it writes to.
 *
 * 1. SLO label rules become SLO Monitor Rules.
 *
 *    Until now an SLO auto-attached monitors through its own label list
 *    (ServiceLevelObjectiveMonitorLabel). That list is superseded by
 *    ServiceLevelObjectiveMonitorRule, so every non-deleted SLO that has
 *    labels gets exactly one enabled rule carrying the same labels.
 *
 *    The labels are copied into the rule's LEGACY label join table
 *    (ServiceLevelObjectiveMonitorRuleMonitorLabel), not into `criteria` JSON.
 *    Criteria relation filters are capped at 100 values and invalid criteria
 *    fail closed, so an SLO with more labels than that would silently lose
 *    every monitor. The legacy any-of label match is exactly what the old
 *    per-SLO list did, so membership does not change by a single monitor.
 *
 *    The existing ServiceLevelObjectiveAutoAddedMonitor rows stay valid: they
 *    record which monitors a RULE attached, and the migrated rule matches the
 *    same monitors. The old label list itself is left untouched so API pods
 *    from the previous release keep working during a rolling deploy.
 *
 *    Idempotent: an SLO that already has a rule with the migrated name is
 *    skipped, and the label copy only ever targets rules inserted by that same
 *    statement (a data-modifying CTE), so re-running never touches a rule a
 *    user created or edited.
 *
 * 2. Burn rate alerts and incidents gain their SLO as an affected resource.
 *
 *    Until now the only link between a burn rate output and its SLO was the
 *    seriesFingerprint `slo:<sloId>:burn-rule:<ruleId>`. The SLO's Alerts and
 *    Incidents pages now query the new relation, so existing records are
 *    linked here or those pages would lose every pre-upgrade record.
 *
 *    The fingerprint's SLO id is compared as TEXT (`s."_id"::text =
 *    split_part(...)`) rather than cast to uuid, so a malformed fingerprint
 *    simply matches nothing instead of aborting the whole migration with a
 *    cast error. The project must match too, so a fingerprint can never link
 *    a record to another tenant's SLO. ON CONFLICT DO NOTHING keeps it safe to
 *    re-run and safe alongside a worker that already attached the relation.
 *
 * down() removes only what it can identify as its own: migrated rules (by
 * name AND description - their label rows cascade with them) and the join rows
 * derivable from fingerprints. It cannot tell a backfilled link from one the
 * worker wrote later with the same derivation, and that is fine: the schema
 * migration's down() drops both join tables right after.
 */

export const MIGRATED_MONITOR_RULE_NAME: string =
  "Auto-add monitors with labels";

/*
 * Plain ASCII without quotes on purpose: it is inlined into SQL below and
 * matched verbatim by down().
 */
export const MIGRATED_MONITOR_RULE_DESCRIPTION: string =
  "Created automatically from the Auto-Add Monitors With Labels setting of this SLO when SLO Monitor Rules were introduced. It attaches every monitor that carries at least one of these labels, exactly as that setting did.";

export const BURN_RATE_FINGERPRINT_LIKE_PATTERN: string = "slo:%:burn-rule:%";

export class BackfillSloMonitorRulesAndAffectedResources1793000000000
  implements MigrationInterface
{
  public name: string =
    "BackfillSloMonitorRulesAndAffectedResources1793000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `WITH "insertedRules" AS (INSERT INTO "ServiceLevelObjectiveMonitorRule" ("_id", "version", "projectId", "serviceLevelObjectiveId", "name", "description", "isEnabled") SELECT uuid_generate_v4(), 1, slo."projectId", slo."_id", '${MIGRATED_MONITOR_RULE_NAME}', '${MIGRATED_MONITOR_RULE_DESCRIPTION}', true FROM "ServiceLevelObjective" slo WHERE slo."deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "ServiceLevelObjectiveMonitorLabel" sml WHERE sml."serviceLevelObjectiveId" = slo."_id") AND NOT EXISTS (SELECT 1 FROM "ServiceLevelObjectiveMonitorRule" existing WHERE existing."serviceLevelObjectiveId" = slo."_id" AND existing."name" = '${MIGRATED_MONITOR_RULE_NAME}') RETURNING "_id", "serviceLevelObjectiveId") INSERT INTO "ServiceLevelObjectiveMonitorRuleMonitorLabel" ("serviceLevelObjectiveMonitorRuleId", "labelId") SELECT "insertedRules"."_id", sml."labelId" FROM "insertedRules" INNER JOIN "ServiceLevelObjectiveMonitorLabel" sml ON sml."serviceLevelObjectiveId" = "insertedRules"."serviceLevelObjectiveId" ON CONFLICT DO NOTHING`,
    );

    await queryRunner.query(
      `INSERT INTO "IncidentServiceLevelObjective" ("incidentId", "serviceLevelObjectiveId") SELECT i."_id", s."_id" FROM "Incident" i INNER JOIN "ServiceLevelObjective" s ON s."_id"::text = split_part(i."seriesFingerprint", ':', 2) AND s."projectId" = i."projectId" WHERE i."seriesFingerprint" LIKE '${BURN_RATE_FINGERPRINT_LIKE_PATTERN}' ON CONFLICT DO NOTHING`,
    );

    await queryRunner.query(
      `INSERT INTO "AlertServiceLevelObjective" ("alertId", "serviceLevelObjectiveId") SELECT a."_id", s."_id" FROM "Alert" a INNER JOIN "ServiceLevelObjective" s ON s."_id"::text = split_part(a."seriesFingerprint", ':', 2) AND s."projectId" = a."projectId" WHERE a."seriesFingerprint" LIKE '${BURN_RATE_FINGERPRINT_LIKE_PATTERN}' ON CONFLICT DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "AlertServiceLevelObjective" aslo USING "Alert" a WHERE aslo."alertId" = a."_id" AND a."seriesFingerprint" LIKE '${BURN_RATE_FINGERPRINT_LIKE_PATTERN}' AND aslo."serviceLevelObjectiveId"::text = split_part(a."seriesFingerprint", ':', 2)`,
    );

    await queryRunner.query(
      `DELETE FROM "IncidentServiceLevelObjective" islo USING "Incident" i WHERE islo."incidentId" = i."_id" AND i."seriesFingerprint" LIKE '${BURN_RATE_FINGERPRINT_LIKE_PATTERN}' AND islo."serviceLevelObjectiveId"::text = split_part(i."seriesFingerprint", ':', 2)`,
    );

    // The rules' label join rows go with them (ON DELETE CASCADE).
    await queryRunner.query(
      `DELETE FROM "ServiceLevelObjectiveMonitorRule" WHERE "name" = '${MIGRATED_MONITOR_RULE_NAME}' AND "description" = '${MIGRATED_MONITOR_RULE_DESCRIPTION}'`,
    );
  }
}
