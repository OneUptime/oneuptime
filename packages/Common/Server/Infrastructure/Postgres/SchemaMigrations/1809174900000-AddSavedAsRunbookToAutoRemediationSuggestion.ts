import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #6801) after
 * AutoRemediationSuggestion gained savedAsRunbookId: the runbook a verified
 * fix was saved as. Nullable, with no default: adding it rewrites nothing.
 * Its index and its key to "Runbook" are built online, in
 * AddSavedAsRunbookToAutoRemediationSuggestionIndexAndKey1809174910000.
 */
export class AddSavedAsRunbookToAutoRemediationSuggestion1809174900000
  implements MigrationInterface
{
  public name: string =
    "AddSavedAsRunbookToAutoRemediationSuggestion1809174900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "savedAsRunbookId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "savedAsRunbookId"`,
    );
  }
}
