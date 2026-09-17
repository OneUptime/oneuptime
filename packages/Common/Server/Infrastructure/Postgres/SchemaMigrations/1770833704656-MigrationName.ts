import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770833704656 implements MigrationInterface {
  public name = "MigrationName1770833704656";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * AlertOnCallDutyPolicy: fix column names
     * Original columns: onCallDutyPolicyId (FK → Alert._id), monitorId (FK → OnCallDutyPolicy._id)
     * Target columns: alertId (FK → Alert._id), onCallDutyPolicyId (FK → OnCallDutyPolicy._id)
     * Must rename onCallDutyPolicyId first to free the name, then rename monitorId.
     */

    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_0eca13d28cf4d2349406ddebc5c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_1ef6702995a8406630f75f06e28"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0eca13d28cf4d2349406ddebc5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1ef6702995a8406630f75f06e2"`,
    );

    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" RENAME COLUMN "onCallDutyPolicyId" TO "alertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" RENAME COLUMN "monitorId" TO "onCallDutyPolicyId"`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_AlertOnCallDutyPolicy_alertId" ON "AlertOnCallDutyPolicy" ("alertId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AlertOnCallDutyPolicy_onCallDutyPolicyId" ON "AlertOnCallDutyPolicy" ("onCallDutyPolicyId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_AlertOnCallDutyPolicy_alertId" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_AlertOnCallDutyPolicy_onCallDutyPolicyId" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    /*
     * IncidentOnCallDutyPolicy: fix column names
     * Original columns: onCallDutyPolicyId (FK → Incident._id), monitorId (FK → OnCallDutyPolicy._id)
     * Target columns: incidentId (FK → Incident._id), onCallDutyPolicyId (FK → OnCallDutyPolicy._id)
     */

    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_2d127b6da0e4fab9f905b4d332d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_f89b23e3cafd1c6a0bfd42c297d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d127b6da0e4fab9f905b4d332"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f89b23e3cafd1c6a0bfd42c297"`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" RENAME COLUMN "onCallDutyPolicyId" TO "incidentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" RENAME COLUMN "monitorId" TO "onCallDutyPolicyId"`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_IncidentOnCallDutyPolicy_incidentId" ON "IncidentOnCallDutyPolicy" ("incidentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncidentOnCallDutyPolicy_onCallDutyPolicyId" ON "IncidentOnCallDutyPolicy" ("onCallDutyPolicyId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_IncidentOnCallDutyPolicy_incidentId" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_IncidentOnCallDutyPolicy_onCallDutyPolicyId" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert IncidentOnCallDutyPolicy
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_IncidentOnCallDutyPolicy_onCallDutyPolicyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_IncidentOnCallDutyPolicy_incidentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncidentOnCallDutyPolicy_onCallDutyPolicyId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncidentOnCallDutyPolicy_incidentId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" RENAME COLUMN "onCallDutyPolicyId" TO "monitorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" RENAME COLUMN "incidentId" TO "onCallDutyPolicyId"`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_2d127b6da0e4fab9f905b4d332" ON "IncidentOnCallDutyPolicy" ("onCallDutyPolicyId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f89b23e3cafd1c6a0bfd42c297" ON "IncidentOnCallDutyPolicy" ("monitorId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_2d127b6da0e4fab9f905b4d332d" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_f89b23e3cafd1c6a0bfd42c297d" FOREIGN KEY ("monitorId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // Revert AlertOnCallDutyPolicy
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_AlertOnCallDutyPolicy_onCallDutyPolicyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_AlertOnCallDutyPolicy_alertId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_AlertOnCallDutyPolicy_onCallDutyPolicyId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_AlertOnCallDutyPolicy_alertId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" RENAME COLUMN "onCallDutyPolicyId" TO "monitorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" RENAME COLUMN "alertId" TO "onCallDutyPolicyId"`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_0eca13d28cf4d2349406ddebc5" ON "AlertOnCallDutyPolicy" ("onCallDutyPolicyId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ef6702995a8406630f75f06e2" ON "AlertOnCallDutyPolicy" ("monitorId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_0eca13d28cf4d2349406ddebc5c" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_1ef6702995a8406630f75f06e28" FOREIGN KEY ("monitorId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }
}
