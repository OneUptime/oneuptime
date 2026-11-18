import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddDataObservabilityAttentionColumnsAndPipelineOwners1809184550000, and
 * moved into a migration of its own: "DataCheck" is written by every check
 * that runs, so its index is built online, without blocking its readers or
 * writers (Docs/migrations/README.md).
 *
 * An alert whose state changes asks which check its monitor alerts for, if
 * any (DataCheckHealthSync), so the check's health follows its alert
 * (#6554). That question is asked for every alert on the server, almost
 * always of a monitor that is no check's, so it is answered by this index
 * rather than by reading the table.
 *
 * The name is TypeORM's own, so the drift check finds nothing to change.
 * Safe to run again after a stop part way.
 */
export class AddDataCheckMonitorIdIndex1809184560000
  implements MigrationInterface
{
  public name: string = "AddDataCheckMonitorIdIndex1809184560000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_dfdde7e9057030a51a753883f8" ON "DataCheck" ("monitorId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_dfdde7e9057030a51a753883f8"`,
    );
  }
}
