import { MigrationInterface, QueryRunner } from "typeorm";

export class AddServiceLevelObjectiveRequestSli1809176600000
  implements MigrationInterface
{
  public name: string = "AddServiceLevelObjectiveRequestSli1809176600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveService" ("serviceLevelObjectiveId" uuid NOT NULL, "serviceId" uuid NOT NULL, CONSTRAINT "PK_25b883da524031b52ece215593d" PRIMARY KEY ("serviceLevelObjectiveId", "serviceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_44f62e913f36dfced9d5f9d1fc" ON "ServiceLevelObjectiveService" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4fa2a477055378bd2b73958638" ON "ServiceLevelObjectiveService" ("serviceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "latencyThresholdInMilliseconds" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "goodEventCount" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "totalEventCount" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "errorBudgetTotalEvents" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "errorBudgetRemainingEvents" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "firstAccumulatedBucketStartAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "eventAccumulationFingerprint" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveService" ADD CONSTRAINT "FK_44f62e913f36dfced9d5f9d1fc6" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveService" ADD CONSTRAINT "FK_4fa2a477055378bd2b73958638f" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveService" DROP CONSTRAINT "FK_4fa2a477055378bd2b73958638f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveService" DROP CONSTRAINT "FK_44f62e913f36dfced9d5f9d1fc6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "eventAccumulationFingerprint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "firstAccumulatedBucketStartAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "errorBudgetRemainingEvents"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "errorBudgetTotalEvents"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "totalEventCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "goodEventCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "latencyThresholdInMilliseconds"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4fa2a477055378bd2b73958638"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_44f62e913f36dfced9d5f9d1fc"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjectiveService"`);
  }
}
