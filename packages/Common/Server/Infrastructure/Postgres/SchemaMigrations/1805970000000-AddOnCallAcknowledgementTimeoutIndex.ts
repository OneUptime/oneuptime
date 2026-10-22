import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddOnCallAcknowledgementTimeout1805960000000, and moved into a migration of
 * its own: "OnCallDutyPolicyExecutionLog" already holds rows, so its index is
 * built online, without blocking the on-call runs written meanwhile. It is
 * partial - only the runs whose acknowledgement timeout's clock is running,
 * at most one for each acknowledged record and policy that pages again - so
 * it stays as small as what the worker that pages again reads every minute.
 * Safe to run again after a stop part way.
 */
export class AddOnCallAcknowledgementTimeoutIndex1805970000000
  implements MigrationInterface
{
  public name: string = "AddOnCallAcknowledgementTimeoutIndex1805970000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_0f4f05a1edf78e030b1de2904f" ON "OnCallDutyPolicyExecutionLog" ("acknowledgementTimeoutStartedAt") WHERE "acknowledgementTimeoutStartedAt" IS NOT NULL AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_0f4f05a1edf78e030b1de2904f"`,
    );
  }
}
