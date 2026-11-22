import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (the drift check's
 * statements for the models), reduced to the two the change needs, then
 * numbered after the last registered migration.
 *
 * OneUptime AI proposes owners for data stores, and the owner rules that
 * keep them owned (#10374). A store with no sensitive data has no issue to
 * hang its owners' proposal on, and an owner rule is for many stores at
 * once, so a proposal's issue - and, for a rule, its store - may be empty.
 *
 * The generator also dropped and re-created both columns' foreign keys and
 * the (projectId, dataSecurityIssueId, kind) index around the change.
 * Postgres needs none of that to drop a NOT NULL, and adding the keys again
 * would check every row of DataSecurityIssue and DataStore under a lock
 * (see OnlineDdl), so the keys and the index stay as they are: same names,
 * same definitions, which the schema drift check compares against. DROP
 * NOT NULL changes the table's metadata only: no row is read or rewritten,
 * and every proposal keeps its issue and its store.
 *
 * Down deletes the proposals the old schema cannot hold - owner rules, and
 * owners of stores with no issue - then requires both columns again.
 */
export class AllowDataSecurityAiProposalsForStoresAndRules1809187421600
  implements MigrationInterface
{
  public name: string =
    "AllowDataSecurityAiProposalsForStoresAndRules1809187421600";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ALTER COLUMN "dataSecurityIssueId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ALTER COLUMN "dataStoreId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "DataSecurityAiProposal" WHERE "dataSecurityIssueId" IS NULL OR "dataStoreId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ALTER COLUMN "dataStoreId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ALTER COLUMN "dataSecurityIssueId" SET NOT NULL`,
    );
  }
}
