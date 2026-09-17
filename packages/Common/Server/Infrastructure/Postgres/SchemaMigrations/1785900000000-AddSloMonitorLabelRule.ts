import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The SLO monitor label rule: two many-to-many join tables for
 * ServiceLevelObjective.
 *
 *   - ServiceLevelObjectiveMonitorLabel is the rule itself — the monitor
 *     labels an SLO auto-attaches monitors by.
 *
 *   - ServiceLevelObjectiveAutoAddedMonitor is its bookkeeping: which of the
 *     SLO's attached monitors the rule put there. It is what lets the rule
 *     detach a monitor that stopped matching without ever touching one a
 *     human attached by hand.
 *
 * Both are pure additions; no backfill. An existing SLO has no rule, so it
 * keeps its hand-curated monitor list untouched until someone gives it one.
 */
export class AddSloMonitorLabelRule1785900000000 implements MigrationInterface {
  public name = "AddSloMonitorLabelRule1785900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveMonitorLabel" ("serviceLevelObjectiveId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_daea26f6963106215a4fea2da89" PRIMARY KEY ("serviceLevelObjectiveId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cfda767c33fdbaa6ef9f268b8e" ON "ServiceLevelObjectiveMonitorLabel" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46d9376cbba06f4911ed521b30" ON "ServiceLevelObjectiveMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveAutoAddedMonitor" ("serviceLevelObjectiveId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_2a43ef3a0f312cd6a591838383b" PRIMARY KEY ("serviceLevelObjectiveId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6f19994d02713e1f0021843ce" ON "ServiceLevelObjectiveAutoAddedMonitor" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1c0e494a9f1082373a8b7efda5" ON "ServiceLevelObjectiveAutoAddedMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorLabel" ADD CONSTRAINT "FK_cfda767c33fdbaa6ef9f268b8e7" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorLabel" ADD CONSTRAINT "FK_46d9376cbba06f4911ed521b308" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveAutoAddedMonitor" ADD CONSTRAINT "FK_f6f19994d02713e1f0021843ce6" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveAutoAddedMonitor" ADD CONSTRAINT "FK_1c0e494a9f1082373a8b7efda5b" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveAutoAddedMonitor" DROP CONSTRAINT "FK_1c0e494a9f1082373a8b7efda5b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveAutoAddedMonitor" DROP CONSTRAINT "FK_f6f19994d02713e1f0021843ce6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorLabel" DROP CONSTRAINT "FK_46d9376cbba06f4911ed521b308"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorLabel" DROP CONSTRAINT "FK_cfda767c33fdbaa6ef9f268b8e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1c0e494a9f1082373a8b7efda5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f6f19994d02713e1f0021843ce"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveAutoAddedMonitor"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_46d9376cbba06f4911ed521b30"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cfda767c33fdbaa6ef9f268b8e"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjectiveMonitorLabel"`);
  }
}
