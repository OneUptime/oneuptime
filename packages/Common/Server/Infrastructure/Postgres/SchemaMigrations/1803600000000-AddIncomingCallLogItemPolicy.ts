import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration; its index and foreign key are built online
 * by AddIncomingCallLogItemPolicyIndexAndKey1803650000000.
 *
 * Each attempt to reach someone during a call (IncomingCallLogItem) now names
 * the incoming call policy whose number took the call, so it is read with the
 * policy as the call is: a permission scoped to Owned reads the attempts of
 * the calls to the policies its holder or their teams own. Every attempt
 * written before this gets its call's policy - the one its call names - so
 * the owners of a policy keep seeing the attempts of its past calls. Adding a
 * nullable column with no default changes no row; the backfill rewrites each
 * attempt once.
 */
export class AddIncomingCallLogItemPolicy1803600000000
  implements MigrationInterface
{
  public name: string = "AddIncomingCallLogItemPolicy1803600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD "incomingCallPolicyId" uuid`,
    );

    // Each attempt written before this: its call's policy.
    await queryRunner.query(
      `UPDATE "IncomingCallLogItem" SET "incomingCallPolicyId" = "IncomingCallLog"."incomingCallPolicyId" FROM "IncomingCallLog" WHERE "IncomingCallLogItem"."incomingCallLogId" = "IncomingCallLog"."_id" AND "IncomingCallLogItem"."incomingCallPolicyId" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP COLUMN "incomingCallPolicyId"`,
    );
  }
}
