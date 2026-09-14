import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Lets an SLO burn rate rule declare an Incident, not only raise an Alert.
 *
 *   - shouldCreateAlert / shouldCreateIncident: what the rule declares when it
 *     fires. `shouldCreateAlert` defaults to TRUE so every rule that already
 *     exists keeps behaving exactly as it did, and `shouldCreateIncident`
 *     defaults to FALSE so nobody starts declaring incidents by upgrading.
 *
 *   - incidentSeverityId: the severity of that incident, nullable — the worker
 *     falls back to the project's most severe when it is not set, exactly as
 *     the alert path already does with alertSeverityId.
 *
 *   - lastIncidentCreatedAt / lastIncidentResolvedAt: the incident's own
 *     worker-owned lifecycle, deliberately separate from the alert pair. The
 *     two outputs open, fail and resolve independently, and each one's re-fire
 *     suppression is measured from its own resolve.
 *
 *   - ServiceLevelObjectiveBurnRateRuleIncidentOnCallDutyPolicy: the incident's
 *     own escalation list, kept apart from the alert's the same way a monitor
 *     criteria keeps CriteriaAlert.onCallPolicyIds apart from
 *     CriteriaIncident.onCallPolicyIds.
 *
 * Pure addition; no backfill. Dropping the join table in down() destroys the
 * incident escalation configuration — the standard cost of reversing a
 * many-to-many, and the reason down() is a last resort here.
 */
export class AddSloBurnRateRuleIncidents1792400000000
  implements MigrationInterface
{
  public name = "AddSloBurnRateRuleIncidents1792400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOnCallDutyPolicy" ("serviceLevelObjectiveBurnRateRuleId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_36d90c310063d3973c1a6b817d0" PRIMARY KEY ("serviceLevelObjectiveBurnRateRuleId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_081ac216caed6ca9890944f847" ON "ServiceLevelObjectiveBurnRateRuleIncidentOnCallDutyPolicy" ("serviceLevelObjectiveBurnRateRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5366231ef8db4c5bd4507089a3" ON "ServiceLevelObjectiveBurnRateRuleIncidentOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "shouldCreateAlert" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "shouldCreateIncident" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "incidentSeverityId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "lastIncidentCreatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "lastIncidentResolvedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c5d58d9e81f420a634abeb5ccc" ON "ServiceLevelObjectiveBurnRateRule" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD CONSTRAINT "FK_c5d58d9e81f420a634abeb5ccc2" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_081ac216caed6ca9890944f847a" FOREIGN KEY ("serviceLevelObjectiveBurnRateRuleId") REFERENCES "ServiceLevelObjectiveBurnRateRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_5366231ef8db4c5bd4507089a37" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_5366231ef8db4c5bd4507089a37"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_081ac216caed6ca9890944f847a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP CONSTRAINT "FK_c5d58d9e81f420a634abeb5ccc2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c5d58d9e81f420a634abeb5ccc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "lastIncidentResolvedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "lastIncidentCreatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "incidentSeverityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "shouldCreateIncident"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "shouldCreateAlert"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5366231ef8db4c5bd4507089a3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_081ac216caed6ca9890944f847"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOnCallDutyPolicy"`,
    );
  }
}
