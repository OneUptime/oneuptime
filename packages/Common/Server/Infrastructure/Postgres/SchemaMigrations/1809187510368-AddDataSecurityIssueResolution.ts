import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * How a resolved Data Security issue was resolved, and the fix that was
 * followed to production (#10368):
 *
 *  - DataSecurityIssue.resolution, resolutionDetails: fixed in code (with
 *    the pull request and the version that shipped it), in infrastructure
 *    code, from here, contained at ingest, its check passing, a person,
 *    its check no longer run, or its store archived;
 *  - DataSecurityIssue.pendingResolution: a response action's change that
 *    waits for its check to pass, OneUptime's own;
 *  - DataStoreFinding.fixedAt: when a code fix was verified to have stopped
 *    a telemetry finding, so it no longer keeps its issue open.
 *
 * Nullable columns with no default and no index, so no row is rewritten,
 * nothing is locked for longer than the catalog change, and every issue
 * resolved before reads as one whose resolution was not recorded.
 */
export class AddDataSecurityIssueResolution1809187510368
  implements MigrationInterface
{
  public name: string = "AddDataSecurityIssueResolution1809187510368";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "fixedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD "resolution" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD "resolutionDetails" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD "pendingResolution" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "pendingResolution"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "resolutionDetails"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "resolution"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "fixedAt"`,
    );
  }
}
