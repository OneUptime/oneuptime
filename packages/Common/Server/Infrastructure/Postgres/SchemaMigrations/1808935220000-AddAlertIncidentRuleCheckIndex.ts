import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddAlertIncidentRules1808935210000, and moved into a migration of its own:
 * "Alert" already exists and monitors write it all the time, so the index on
 * its new "nextIncidentRuleCheckAt" column - which the worker reads every
 * minute to find the alerts whose alert incident rule's wait is up - is
 * built online, without blocking those writes. Safe to run again after a
 * stop part way: an index that is already there is left as it is.
 */
export class AddAlertIncidentRuleCheckIndex1808935220000
  implements MigrationInterface
{
  public name: string = "AddAlertIncidentRuleCheckIndex1808935220000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_8cadbc7bf080d5a92a3753bacf" ON "Alert" ("nextIncidentRuleCheckAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_8cadbc7bf080d5a92a3753bacf"`,
    );
  }
}
