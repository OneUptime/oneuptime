import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1779980428744 implements MigrationInterface {
  public name = "MigrationName1779980428744";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" ADD "isOwnerNotifiedOfAlertAdded" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeMember" ADD "isOwnerNotifiedOfIncidentAdded" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeMember" DROP COLUMN "isOwnerNotifiedOfIncidentAdded"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" DROP COLUMN "isOwnerNotifiedOfAlertAdded"`,
    );
  }
}
