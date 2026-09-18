import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated via `npm run generate-postgres-migration`, then trimmed to only the
 * statements belonging to this feature (the generator also re-emitted unrelated
 * constraint-name drift on IncidentReminderRuleLabel / AlertReminderRuleLabel
 * and default drift on OnCallDutyPolicyScheduleLayer, which was removed).
 *
 * Adds the per-conversation LLM provider selection column that powers the
 * in-chat provider/model switcher. Plain uuid (no FK) so it can point at a
 * global provider and so deleting a provider degrades to the default rather
 * than cascading.
 */
export class AddLlmProviderToAIConversation1783443471795
  implements MigrationInterface
{
  public name = "AddLlmProviderToAIConversation1783443471795";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIConversation" ADD "llmProviderId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7d2d5dac9e8e8fd9f33e629787" ON "AIConversation" ("llmProviderId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7d2d5dac9e8e8fd9f33e629787"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" DROP COLUMN "llmProviderId"`,
    );
  }
}
