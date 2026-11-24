import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddDataSecurityIssueCodeFixTask1809187580367, and moved into a migration
 * of its own: "DataSecurityIssue" is written by every evaluation, so the
 * index on its new "codeFixTaskId" column - how a merged fix finds the
 * issues it fixes (#10367, #10368) - is built online, without blocking
 * those writes. Safe to run again after a stop part way.
 */
export class AddDataSecurityIssueCodeFixTaskIndex1809187580377
  implements MigrationInterface
{
  public name: string = "AddDataSecurityIssueCodeFixTaskIndex1809187580377";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_1a432b7b6b4b417c803dce1cd1" ON "DataSecurityIssue" ("codeFixTaskId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_1a432b7b6b4b417c803dce1cd1"`,
    );
  }
}
