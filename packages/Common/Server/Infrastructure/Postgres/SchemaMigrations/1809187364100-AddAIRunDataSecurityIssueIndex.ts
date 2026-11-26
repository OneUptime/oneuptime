import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddDataSecurityAiRules1809187364000, and moved into a migration of its
 * own: "AIRun" already holds every investigation, chat and code fix, and
 * the AI queue writes it all the time, so the index on its new
 * "triggeredByDataSecurityIssueId" column - how an issue finds the runs
 * about it (#10364) - is built online, without blocking those writes. Safe
 * to run again after a stop part way.
 */
export class AddAIRunDataSecurityIssueIndex1809187364100
  implements MigrationInterface
{
  public name: string = "AddAIRunDataSecurityIssueIndex1809187364100";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_f3ede3fa4d2734c08bc77e3471" ON "AIRun" ("triggeredByDataSecurityIssueId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_f3ede3fa4d2734c08bc77e3471"`,
    );
  }
}
