import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddIncomingCallLogItemPolicy1803600000000, and moved into a migration of
 * its own: IncomingCallLogItem already exists, so the index on its new
 * "incomingCallPolicyId" column is built online, and the foreign key to
 * "IncomingCallPolicy" is added NOT VALID and then validated, without
 * blocking the writes a call in progress makes. The backfill before it gave
 * each attempt the policy its call names, which the call's own foreign key
 * holds to an existing policy, so the validation finds nothing to refuse.
 * Safe to run again after a stop part way.
 */
export class AddIncomingCallLogItemPolicyIndexAndKey1803650000000
  implements MigrationInterface
{
  public name: string = "AddIncomingCallLogItemPolicyIndexAndKey1803650000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_d728fcf2cd2e2bafbbb0ee8719" ON "IncomingCallLogItem" ("incomingCallPolicyId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_d728fcf2cd2e2bafbbb0ee87193" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_d728fcf2cd2e2bafbbb0ee87193"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_d728fcf2cd2e2bafbbb0ee8719"`,
    );
  }
}
