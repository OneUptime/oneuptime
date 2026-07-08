import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated via `npm run generate-postgres-migration`, then trimmed to only the
 * statements belonging to this feature (the generator also re-emitted unrelated
 * constraint-name drift on IncidentReminderRuleLabel / AlertReminderRuleLabel
 * and default drift on OnCallDutyPolicyScheduleLayer, which was removed).
 *
 * Turns the AI copilot from read-only into an agent that can act:
 *  - AIConversation.permissionMode: per-conversation autonomy for mutating tools
 *    (AskForApproval | AutoRun | ReadOnly).
 *  - AIConversationMessage.widgets: inline charts/tables/traces rendered in chat.
 *  - AIConversationMessage.toolActions: mutating actions + their approval status.
 *  - AIRun.pausedState: serialized turn state saved while awaiting approval.
 */
export class AddAIChatWriteActionsAndWidgets1783453297388
  implements MigrationInterface
{
  public name = "AddAIChatWriteActionsAndWidgets1783453297388";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIConversation" ADD "permissionMode" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" ADD "widgets" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" ADD "toolActions" jsonb`,
    );
    await queryRunner.query(`ALTER TABLE "AIRun" ADD "pausedState" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "pausedState"`);
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" DROP COLUMN "toolActions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" DROP COLUMN "widgets"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" DROP COLUMN "permissionMode"`,
    );
  }
}
