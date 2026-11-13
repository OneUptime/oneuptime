import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The off switches for recording OneUptime's own Dashboard on Cloud (issue
 * #6834): the person's (User.disableDashboardRecording) and the project's
 * (Project.disableDashboardRecording). Both default to false - recording
 * stays off everywhere until OneUptime Cloud's configuration turns it on.
 * A column with a constant default is added without rewriting the table.
 */
export class AddDashboardRecordingSwitches1809123700000
  implements MigrationInterface
{
  public name = "AddDashboardRecordingSwitches1809123700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" ADD "disableDashboardRecording" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "disableDashboardRecording" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "disableDashboardRecording"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "disableDashboardRecording"`,
    );
  }
}
