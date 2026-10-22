import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddSecurityCaseAiTriage1805980000000, and moved into a migration of its
 * own: "AIRun" already holds every investigation, chat and code fix, and
 * the AI queue writes it all the time, so the index on its new
 * "triggeredBySecurityCaseId" column - how a case's AI card finds its
 * triage - is built online, without blocking those writes. Safe to run
 * again after a stop part way.
 */
export class AddAIRunSecurityCaseIndex1805990000000
  implements MigrationInterface
{
  public name: string = "AddAIRunSecurityCaseIndex1805990000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_8672c473ca0bc4af24d311b880" ON "AIRun" ("triggeredBySecurityCaseId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_8672c473ca0bc4af24d311b880"`,
    );
  }
}
