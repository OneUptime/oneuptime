import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1722892318363 implements MigrationInterface {
  public name = "MigrationName1722892318363";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "telemetryMonitorNextMonitorAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "telemetryMonitorLastMonitorAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "telemetryQuery" jsonb`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_540a4857bf04eabc59775ca210" ON "Monitor" ("telemetryMonitorNextMonitorAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_02bae6cdc6d5b3092ac393fbb3" ON "Monitor" ("telemetryMonitorLastMonitorAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_02bae6cdc6d5b3092ac393fbb3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_540a4857bf04eabc59775ca210"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "telemetryQuery"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "telemetryMonitorLastMonitorAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "telemetryMonitorNextMonitorAt"`,
    );
  }
}
