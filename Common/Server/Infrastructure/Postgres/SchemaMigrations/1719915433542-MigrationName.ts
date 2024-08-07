import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1719915433542 implements MigrationInterface {
  public name = "MigrationName1719915433542";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "isNoProbeEnabledOnThisMonitor" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "isNoProbeEnabledOnThisMonitor"`,
    );
  }
}
