import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddSecurityCaseStepChecks1809187150000, and moved into a migration of its
 * own: "SecurityCase" already exists, so the index the every-minute step
 * check reads ("nextStepCheckAt") is built online, without blocking the
 * table's writes. Safe to run again after a stop part way: an index that is
 * already there is left as it is.
 */
export class AddSecurityCaseNextStepCheckIndex1809187150010
  implements MigrationInterface
{
  public name: string = "AddSecurityCaseNextStepCheckIndex1809187150010";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_f348b6c566979be7bfaa740651" ON "SecurityCase" ("nextStepCheckAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_f348b6c566979be7bfaa740651"`,
    );
  }
}
