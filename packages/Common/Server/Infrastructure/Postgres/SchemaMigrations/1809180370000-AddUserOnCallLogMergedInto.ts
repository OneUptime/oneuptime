import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserOnCallLogMergedInto1809180370000
  implements MigrationInterface
{
  public name: string = "AddUserOnCallLogMergedInto1809180370000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD "mergedIntoUserOnCallLogId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP COLUMN "mergedIntoUserOnCallLogId"`,
    );
  }
}
