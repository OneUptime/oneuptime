import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSeverityAndStateColorsToNotificationEmailRollup1797600000000
  implements MigrationInterface
{
  public name: string =
    "AddSeverityAndStateColorsToNotificationEmailRollup1797600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" ADD "severityColor" character varying(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" ADD "currentStateColor" character varying(10)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" DROP COLUMN "currentStateColor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" DROP COLUMN "severityColor"`,
    );
  }
}
