import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Two nullable columns on AutoRemediationSuggestion: where a person
 * approved the fix (approvedFrom: Dashboard, Slack or MicrosoftTeams), and
 * how a proposed runbook went the last times OneUptime AI ran it as a fix
 * (runbookTrackRecord). Both stay empty on the rows written before.
 */
export class AddFixApprovalSourceAndRunbookTrackRecord1808992610000
  implements MigrationInterface
{
  public name: string =
    "AddFixApprovalSourceAndRunbookTrackRecord1808992610000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "runbookTrackRecord" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "approvedFrom" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "approvedFrom"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "runbookTrackRecord"`,
    );
  }
}
