import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A workflow's version history (issue #6188): WorkflowVersion keeps every
 * version of a workflow's graph - who saved it, when and what it changed -
 * for the builder's Version history to list, show and restore.
 *
 * Generated with npm run generate-postgres-migration. The table is new and
 * empty, so its indexes and keys are made here. Nothing is backfilled: a
 * workflow saved before this release gets its first version - its graph as
 * it is then - the next time its graph is saved (WorkflowVersionService).
 */
export class AddWorkflowVersions1808995461880 implements MigrationInterface {
  public name: string = "AddWorkflowVersions1808995461880";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "WorkflowVersion" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "workflowId" uuid NOT NULL, "versionNumber" integer NOT NULL, "versionType" character varying(100) NOT NULL, "graph" jsonb NOT NULL, "graphFingerprint" character varying(100) NOT NULL, "changes" jsonb, "changeCount" integer NOT NULL DEFAULT '0', "restoredFromVersionNumber" integer, "createdByUserId" uuid, CONSTRAINT "PK_9def94f88f8693c9e98867de11c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed95e1efb4d1b6a3c28003803a" ON "WorkflowVersion" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_759c911e8d0c7d3a3b700602da" ON "WorkflowVersion" ("workflowId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_60076b265769e5d8330cab917a" ON "WorkflowVersion" ("workflowId", "versionNumber") `,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "FK_ed95e1efb4d1b6a3c28003803a3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "FK_759c911e8d0c7d3a3b700602da1" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "FK_605f4a8e906dde5be1d4be559b3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowVersion" DROP CONSTRAINT "FK_605f4a8e906dde5be1d4be559b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVersion" DROP CONSTRAINT "FK_759c911e8d0c7d3a3b700602da1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVersion" DROP CONSTRAINT "FK_ed95e1efb4d1b6a3c28003803a3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_60076b265769e5d8330cab917a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_759c911e8d0c7d3a3b700602da"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed95e1efb4d1b6a3c28003803a"`,
    );
    await queryRunner.query(`DROP TABLE "WorkflowVersion"`);
  }
}
