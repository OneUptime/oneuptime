import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1756821449686 implements MigrationInterface {
  public name = "MigrationName1756821449686";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "doNotAddGlobalProbesByDefaultOnNewMonitors" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "doNotAddGlobalProbesByDefaultOnNewMonitors"`,
    );
  }
}
