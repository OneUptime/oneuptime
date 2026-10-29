import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddSecurityCaseResponseTargetsTasksAndEvidence1808240000000, and moved into
 * a migration of its own: "SecurityCase" already exists, so the index the
 * every-minute response target check reads ("nextTargetCheckAt") is built
 * online, without blocking the table's writes. Every existing case's column
 * is null. Safe to run again after a stop part way: an index that is already
 * there is left as it is.
 */
export class AddSecurityCaseNextTargetCheckIndex1808250000000
  implements MigrationInterface
{
  public name: string = "AddSecurityCaseNextTargetCheckIndex1808250000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_4d93f16f2b893387335f4e1b01" ON "SecurityCase" ("nextTargetCheckAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_4d93f16f2b893387335f4e1b01"`,
    );
  }
}
