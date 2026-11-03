import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The project somebody last chose for their Slack or Microsoft Teams Home,
 * in a workspace connected to several projects (WorkspaceHomeChoice): one
 * row per project and chat account, with when it was chosen. Kept in the
 * cache before, which forgot every choice whenever Valkey restarted. A new
 * table, so its indexes are built on an empty table and need no online DDL.
 * Existing installations start with none: each Home opens on the first of
 * the person's projects until they choose one again.
 */
export class AddWorkspaceHomeChoice1808880000000 implements MigrationInterface {
  public name: string = "AddWorkspaceHomeChoice1808880000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "WorkspaceHomeChoice" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "workspaceType" character varying(100) NOT NULL, "workspaceUserId" character varying(100) NOT NULL, "chosenAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_0d9534e82562e909f04f675c10b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15c0896cd115d3fc0fbaf49717" ON "WorkspaceHomeChoice" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_fc179913d15091f7a5cd2445b2" ON "WorkspaceHomeChoice" ("projectId", "workspaceType", "workspaceUserId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceHomeChoice" ADD CONSTRAINT "FK_15c0896cd115d3fc0fbaf497177" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceHomeChoice" DROP CONSTRAINT "FK_15c0896cd115d3fc0fbaf497177"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fc179913d15091f7a5cd2445b2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15c0896cd115d3fc0fbaf49717"`,
    );
    await queryRunner.query(`DROP TABLE "WorkspaceHomeChoice"`);
  }
}
