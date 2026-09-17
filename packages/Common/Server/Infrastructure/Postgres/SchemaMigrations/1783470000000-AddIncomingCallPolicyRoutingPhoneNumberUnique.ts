import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIncomingCallPolicyRoutingPhoneNumberUnique1783470000000
  implements MigrationInterface
{
  public name = "AddIncomingCallPolicyRoutingPhoneNumberUnique1783470000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Enforce that a routing phone number belongs to at most one policy. The
     * inbound /voice webhook resolves the policy by routingPhoneNumber and
     * assumes a single match. Partial index so policies without a number (NULL)
     * are unconstrained and soft-deleted rows never collide.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_INCOMING_CALL_POLICY_ROUTING_PHONE_UNIQUE" ON "IncomingCallPolicy" ("routingPhoneNumber") WHERE ("deletedAt" IS NULL AND "routingPhoneNumber" IS NOT NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_INCOMING_CALL_POLICY_ROUTING_PHONE_UNIQUE"`,
    );
  }
}
