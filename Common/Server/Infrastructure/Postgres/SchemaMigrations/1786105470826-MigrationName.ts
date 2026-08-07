import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1786105470826 implements MigrationInterface {
  public name = "MigrationName1786105470826";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "IncidentFeed" ADD "aiRunId" uuid`);
    await queryRunner.query(`ALTER TABLE "AlertFeed" ADD "aiRunId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_bae064a2cf9282fc2cca934d78" ON "IncidentFeed" ("incidentId", "aiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7da528b06c0ae8b2f1b6c9c848" ON "AlertFeed" ("alertId", "aiRunId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7da528b06c0ae8b2f1b6c9c848"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bae064a2cf9282fc2cca934d78"`,
    );
    await queryRunner.query(`ALTER TABLE "AlertFeed" DROP COLUMN "aiRunId"`);
    await queryRunner.query(`ALTER TABLE "IncidentFeed" DROP COLUMN "aiRunId"`);
  }
}
