import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * AIConversationMessage.userFeedback: thumbs feedback ("Up" | "Down") the user
 * left on an assistant message via POST /ai-chat/message-feedback. Nullable
 * with no default — no feedback is the normal state, and every pre-existing
 * message is exactly that. Clearing feedback writes NULL back.
 *
 * Hand-written rather than emitted by `npm run generate-postgres-migration`.
 * The generator diffs the entire entity set against the live database, and
 * several models in this worktree are being changed in parallel, so a
 * generated file would have swept up unrelated in-flight columns. The
 * statement below is exactly what the generator produces for a nullable
 * ShortText column (ColumnLength.ShortText = 100) — compare "analysisTldr" in
 * 1786600000000-AddInvestigationAnalysisTldr for the varchar shape.
 */
export class AddAIChatMessageFeedback1787200000000
  implements MigrationInterface
{
  public name: string = "AddAIChatMessageFeedback1787200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" ADD "userFeedback" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" DROP COLUMN "userFeedback"`,
    );
  }
}
