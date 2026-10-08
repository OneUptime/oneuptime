import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Imports from another tool (Project Settings > Import from another tool):
 * ToolImportRun is one import (its status, what was read, what was ticked,
 * its report, and - only while it reads - the encrypted API key);
 * ToolImportRecord remembers what an import brought over by the other tool's
 * id, unique per project, tool, kind and id, so an import run twice never
 * creates anything twice. Both tables are new, so their indexes and foreign
 * keys are built while nothing writes to them.
 */
export class AddToolImportTables1800000000000 implements MigrationInterface {
  public name: string = "AddToolImportTables1800000000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "ToolImportRun" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "source" character varying(100) NOT NULL, "region" character varying(100), "status" character varying(100) NOT NULL, "apiKey" text, "accountName" character varying(100), "snapshot" jsonb, "selection" jsonb, "progress" jsonb, "report" jsonb, "error" text, "createdByUserId" uuid, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_94f3b88725cc8b119e54edd5c3e" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b5a553b85f0ba27c772cd526aa" ON "ToolImportRun" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_bdab6216ec60401330aae1a2d3" ON "ToolImportRun" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_86de349dd90076eef5cd45a83f" ON "ToolImportRun" ("projectId", "createdAt") `);
        await queryRunner.query(`CREATE TABLE "ToolImportRecord" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "source" character varying(100) NOT NULL, "kind" character varying(100) NOT NULL, "sourceId" character varying(500) NOT NULL, "recordId" uuid NOT NULL, "name" character varying(100), "isComplete" boolean NOT NULL DEFAULT true, "toolImportRunId" uuid, CONSTRAINT "PK_0f3651ab81d5c19a7645f6172a8" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6761a681343d30bf64ead2ae19" ON "ToolImportRecord" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_c6a6ca8dac88b0d315ddf091d8" ON "ToolImportRecord" ("toolImportRunId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ToolImportRecord_projectId_source_kind_sourceId" ON "ToolImportRecord" ("projectId", "source", "kind", "sourceId") WHERE "deletedAt" IS NULL`);
        await queryRunner.query(`ALTER TABLE "ToolImportRun" ADD CONSTRAINT "FK_b5a553b85f0ba27c772cd526aaa" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ToolImportRun" ADD CONSTRAINT "FK_f3914857a825c7fe8c327cbace7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ToolImportRecord" ADD CONSTRAINT "FK_6761a681343d30bf64ead2ae19f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ToolImportRecord" ADD CONSTRAINT "FK_c6a6ca8dac88b0d315ddf091d8e" FOREIGN KEY ("toolImportRunId") REFERENCES "ToolImportRun"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ToolImportRecord" DROP CONSTRAINT "FK_c6a6ca8dac88b0d315ddf091d8e"`);
        await queryRunner.query(`ALTER TABLE "ToolImportRecord" DROP CONSTRAINT "FK_6761a681343d30bf64ead2ae19f"`);
        await queryRunner.query(`ALTER TABLE "ToolImportRun" DROP CONSTRAINT "FK_f3914857a825c7fe8c327cbace7"`);
        await queryRunner.query(`ALTER TABLE "ToolImportRun" DROP CONSTRAINT "FK_b5a553b85f0ba27c772cd526aaa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ToolImportRecord_projectId_source_kind_sourceId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c6a6ca8dac88b0d315ddf091d8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6761a681343d30bf64ead2ae19"`);
        await queryRunner.query(`DROP TABLE "ToolImportRecord"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_86de349dd90076eef5cd45a83f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bdab6216ec60401330aae1a2d3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b5a553b85f0ba27c772cd526aa"`);
        await queryRunner.query(`DROP TABLE "ToolImportRun"`);
    }

}
