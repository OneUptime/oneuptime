import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRunnerCapabilities1785776960660 implements MigrationInterface {
  public name = "AddRunnerCapabilities1785776960660";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" ADD "canRunRunbooks" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" ADD "canRunCodeFixTasks" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" DROP COLUMN "canRunCodeFixTasks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" DROP COLUMN "canRunRunbooks"`,
    );
  }
}
