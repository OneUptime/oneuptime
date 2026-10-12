import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The Slack and Microsoft Teams messages OneUptime keeps up to date in place
 * (WorkspaceLiveMessage): one row per message - an on-call policy run's
 * progress, the note naming who could not be added to a channel - with where
 * it is and the id the workspace gave it, so the next change edits it
 * instead of posting another message. A new table, so its indexes are built
 * on an empty table and need no online DDL. Existing installations start
 * with none: the first change after upgrading posts each message once.
 */
export class AddWorkspaceLiveMessage1801400000000
  implements MigrationInterface
{
  public name: string = "AddWorkspaceLiveMessage1801400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "WorkspaceLiveMessage" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "workspaceType" character varying(100) NOT NULL, "messageKey" character varying(100) NOT NULL, "destinationType" character varying(100) NOT NULL, "channelId" character varying(100) NOT NULL, "channelName" character varying(100), "teamId" character varying(100), "messageId" character varying(100) NOT NULL, "contentHash" character varying(100), "messageData" jsonb, CONSTRAINT "PK_5ffe61a70ea584c2e9626852c4a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_437ce91ed2cea15412327226cc" ON "WorkspaceLiveMessage" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c31152ac15be221a708d04feb3" ON "WorkspaceLiveMessage" ("messageKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7000584fef010a7fd50f927b1f" ON "WorkspaceLiveMessage" ("channelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceLiveMessage" ADD CONSTRAINT "FK_437ce91ed2cea15412327226cc8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceLiveMessage" DROP CONSTRAINT "FK_437ce91ed2cea15412327226cc8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7000584fef010a7fd50f927b1f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c31152ac15be221a708d04feb3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_437ce91ed2cea15412327226cc"`,
    );
    await queryRunner.query(`DROP TABLE "WorkspaceLiveMessage"`);
  }
}
