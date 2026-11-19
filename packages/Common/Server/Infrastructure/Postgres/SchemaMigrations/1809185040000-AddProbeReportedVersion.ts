import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The release a probe says it runs (issue #9759): kept with its liveness
 * stamp, so its page and the monitor forms can say when a custom probe is
 * too old to make the one-time codes of a TOTP monitor secret.
 *
 * Nullable, with no default: every probe reads as having said nothing
 * until its next request says what it runs. Adding a nullable column
 * rewrites nothing, and Probe is a small table.
 */
export class AddProbeReportedVersion1809185040000
  implements MigrationInterface
{
  public name: string = "AddProbeReportedVersion1809185040000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD "reportedVersion" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP COLUMN "reportedVersion"`,
    );
  }
}
