import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A new incoming call escalation rule rings for 20 seconds, not 30
 * (IncomingCallPolicyEscalationRule.escalateAfterSeconds, the timeout of
 * Twilio's <Dial>): many phones send an unanswered call to voicemail sooner
 * than 30 seconds, and a voicemail that answers ends the call there instead
 * of moving it on to the next rule. The column default follows, so a rule
 * the API or Terraform creates without a ring time rings for 20 too.
 *
 * Only the column default changes. Existing rules keep the ring time they
 * hold: a rule that rings for 30 may be the old default or a deliberate
 * choice, and nothing tells them apart. SET DEFAULT is a catalog change; it
 * rewrites no rows.
 */
export class StartIncomingCallRulesAtTwentySeconds1798600000000
  implements MigrationInterface
{
  public name: string = "StartIncomingCallRulesAtTwentySeconds1798600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ALTER COLUMN "escalateAfterSeconds" SET DEFAULT '20'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ALTER COLUMN "escalateAfterSeconds" SET DEFAULT '30'`,
    );
  }
}
