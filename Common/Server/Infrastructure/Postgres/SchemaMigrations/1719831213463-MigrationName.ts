import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1719831213463 implements MigrationInterface {
  public name = "MigrationName1719831213463";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "isAllProbesDisconnectedFromThisMonitor" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "isAllProbesDisconnectedFromThisMonitor"`,
    );
  }
}
