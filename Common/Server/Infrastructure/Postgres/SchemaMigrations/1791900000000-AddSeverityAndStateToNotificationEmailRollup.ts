import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSeverityAndStateToNotificationEmailRollup1791900000000
  implements MigrationInterface
{
  public name: string =
    "AddSeverityAndStateToNotificationEmailRollup1791900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" ADD "severity" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" ADD "currentState" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" DROP COLUMN "currentState"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" DROP COLUMN "severity"`,
    );
  }
}
