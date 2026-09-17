import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * AIConversation.pageContext: the conversation's subject — the dashboard page
 * (usually one specific entity, e.g. an incident) the user was looking at
 * when the conversation started. ChatAgentRunner persists it from the first
 * turn that carries a sanitized page context, and turns that arrive without
 * one fall back to it, so "this incident" keeps resolving after the user
 * navigates away mid-conversation.
 *
 * Hand-written rather than emitted by `npm run generate-postgres-migration`.
 * The generator diffs the entire entity set against the live database, and
 * several models in this worktree are being changed in parallel, so a
 * generated file would have swept up unrelated in-flight columns. The
 * statement below is exactly what the generator produces for a nullable JSON
 * column — compare "widgets" and "pausedState" in
 * 1783453297388-AddAIChatWriteActionsAndWidgets.
 *
 * Nullable with no default: a conversation without a pinned subject is the
 * normal state (the user opened Ask AI from nowhere in particular), and every
 * pre-existing conversation is exactly that.
 */
export class AddAIConversationPageContext1787100000000
  implements MigrationInterface
{
  public name: string = "AddAIConversationPageContext1787100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIConversation" ADD "pageContext" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIConversation" DROP COLUMN "pageContext"`,
    );
  }
}
