import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddInvestigationRuleWait1805030000000, and moved into a migration of its
 * own: "Incident", "Alert" and "AIRun" already hold rows, so their indexes
 * are built online, without blocking the incidents, alerts and AI runs
 * written meanwhile. Each is partial - only the records an investigation
 * rule makes wait, and only the runs it made wait - so each stays as small
 * as what it finds: the rule-wait job's "wait ended" read, and the follow-up
 * check's read of waited runs that finished in the last half hour. Safe to
 * run again after a stop part way.
 */
export class AddInvestigationRuleWaitIndexes1805040000000
  implements MigrationInterface
{
  public name: string = "AddInvestigationRuleWaitIndexes1805040000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_301974537e3094dbcd5a2b14ba" ON "Incident" ("aiInvestigationWaitUntil") WHERE "aiInvestigationWaitUntil" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_e6dad46c4d8795ceeda63315aa" ON "Alert" ("aiInvestigationWaitUntil") WHERE "aiInvestigationWaitUntil" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_f64302b4e3a0a32291184248c6" ON "AIRun" ("projectId", "completedAt") WHERE "ruleWaitMinutes" IS NOT NULL AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_f64302b4e3a0a32291184248c6"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_e6dad46c4d8795ceeda63315aa"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_301974537e3094dbcd5a2b14ba"`,
    );
  }
}
