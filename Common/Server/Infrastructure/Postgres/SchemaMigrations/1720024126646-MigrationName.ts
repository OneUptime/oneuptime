import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1720024126646 implements MigrationInterface {
  public name = "MigrationName1720024126646";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // change type of secretValue from varchar to text
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" ALTER COLUMN "secretValue" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" ALTER COLUMN "secretValue" TYPE character varying(500)`,
    );
  }
}
