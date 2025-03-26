import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1743005293206 implements MigrationInterface {
  public name = "MigrationName1743005293206";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "showSubscriberPageOnStatusPage" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "showSubscriberPageOnStatusPage"`,
    );
  }
}
