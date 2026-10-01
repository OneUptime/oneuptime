import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMonitorSecretAccessScope1797000000000
  implements MigrationInterface
{
  name = "AddMonitorSecretAccessScope1797000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MonitorSecretLabel" ("monitorSecretId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_7bbefc5a8eb14ddb14a0c19d054" PRIMARY KEY ("monitorSecretId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_53812c47353639b995ba4772f4" ON "MonitorSecretLabel" ("monitorSecretId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b0fdc52c7519e4e09190d31711" ON "MonitorSecretLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" ADD "isAvailableToAllMonitors" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecretLabel" ADD CONSTRAINT "FK_53812c47353639b995ba4772f4e" FOREIGN KEY ("monitorSecretId") REFERENCES "MonitorSecret"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecretLabel" ADD CONSTRAINT "FK_b0fdc52c7519e4e09190d317113" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorSecretLabel" DROP CONSTRAINT "FK_b0fdc52c7519e4e09190d317113"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecretLabel" DROP CONSTRAINT "FK_53812c47353639b995ba4772f4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" DROP COLUMN "isAvailableToAllMonitors"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b0fdc52c7519e4e09190d31711"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_53812c47353639b995ba4772f4"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorSecretLabel"`);
  }
}
