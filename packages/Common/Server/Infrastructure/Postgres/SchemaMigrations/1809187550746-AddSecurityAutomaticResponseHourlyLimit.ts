import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The hourly limit of automatic blocks a project sets its own (#10746):
 * Project.securityAutomaticResponseMaxBlocksPerHour, 50 for every project
 * until someone changes it - the limit every project's automatic response
 * policies were held to before. A constant default, so Postgres adds the
 * column without rewriting the table, and holds its lock only for the
 * catalog change.
 */
export class AddSecurityAutomaticResponseHourlyLimit1809187550746
  implements MigrationInterface
{
  public name: string = "AddSecurityAutomaticResponseHourlyLimit1809187550746";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityAutomaticResponseMaxBlocksPerHour" integer NOT NULL DEFAULT '50'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityAutomaticResponseMaxBlocksPerHour"`,
    );
  }
}
