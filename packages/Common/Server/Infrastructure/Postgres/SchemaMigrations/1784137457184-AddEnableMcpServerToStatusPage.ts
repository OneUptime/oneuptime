import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Status page owners can now stop AI agents from reading their status page over
 * the public OneUptime MCP server. MCP access stays on unless it is turned off,
 * so the column defaults to true.
 *
 * ADD COLUMN ... NOT NULL DEFAULT true populates every existing row with true in
 * the same statement, so no backfill is needed and existing status pages keep
 * working exactly as they do today. That is what makes the
 * `enableMcpServer: true` predicate in StatusPageService.isMcpServerEnabled
 * safe — there are no NULL rows for it to silently drop.
 */
export class AddEnableMcpServerToStatusPage1784137457184
  implements MigrationInterface
{
  public name = "AddEnableMcpServerToStatusPage1784137457184";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enableMcpServer" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enableMcpServer"`,
    );
  }
}
