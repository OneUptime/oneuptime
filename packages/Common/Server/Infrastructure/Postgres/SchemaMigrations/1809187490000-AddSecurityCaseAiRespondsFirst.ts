import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * OneUptime AI responds first to a security case, and people are alerted
 * only when it needs them (#10353, Types/SecurityCase/SecurityCaseAiHold):
 *
 *   - "Project" gains "enableSecurityCaseAiRespondsFirst", off for every
 *     project, and what it holds: the priority it holds cases below
 *     ("securityCaseAiHoldBelowPriorityId", empty for the built-in High)
 *     and for how long at most ("securityCaseAiHoldMinutes", 10). Constant
 *     defaults: adding them does not rewrite the table.
 *   - "SecurityCase" gains how OneUptime AI's hold of the case's alerts
 *     stands - holding, then how it ended - when it runs out, when it ended
 *     and who ended it. Empty on every existing case. The index the
 *     every-minute review reads ("aiHoldUntil") is built online, in
 *     AddSecurityCaseAiHoldUntilIndex1809187490010.
 */
export class AddSecurityCaseAiRespondsFirst1809187490000
  implements MigrationInterface
{
  public name: string = "AddSecurityCaseAiRespondsFirst1809187490000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableSecurityCaseAiRespondsFirst" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseAiHoldBelowPriorityId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseAiHoldMinutes" integer NOT NULL DEFAULT '10'`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiHoldOutcome" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiHoldUntil" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiHoldEndedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiHoldEndedByUserId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiHoldEndedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiHoldEndedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiHoldUntil"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiHoldOutcome"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseAiHoldMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseAiHoldBelowPriorityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableSecurityCaseAiRespondsFirst"`,
    );
  }
}
