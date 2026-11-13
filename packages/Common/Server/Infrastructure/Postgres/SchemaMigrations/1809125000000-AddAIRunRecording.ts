import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * AIRunRecording (issue #6800): what an AI investigation saw - the context it
 * started from and every tool call it made with the text it was handed back -
 * so the run can be replayed on the same data after a prompt or model change
 * (npm run ai-eval -- --replay). Server-only, deleted with its run or its
 * project, and after 30 days (AIRunRecordingService).
 *
 * A new table: its indexes and foreign keys are built while it is empty.
 */
export class AddAIRunRecording1809125000000 implements MigrationInterface {
  public name: string = "AddAIRunRecording1809125000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AIRunRecording" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "aiRunId" uuid NOT NULL, "recording" jsonb NOT NULL, CONSTRAINT "PK_623224d7df6b96ae963c02ead9c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f29f9c6a67c67bc961ef5cb2b" ON "AIRunRecording" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_87bb9a16fc01d9a404785b4398" ON "AIRunRecording" ("aiRunId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunRecording" ADD CONSTRAINT "FK_6f29f9c6a67c67bc961ef5cb2be" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunRecording" ADD CONSTRAINT "FK_87bb9a16fc01d9a404785b4398d" FOREIGN KEY ("aiRunId") REFERENCES "AIRun"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRunRecording" DROP CONSTRAINT "FK_87bb9a16fc01d9a404785b4398d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunRecording" DROP CONSTRAINT "FK_6f29f9c6a67c67bc961ef5cb2be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_87bb9a16fc01d9a404785b4398"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f29f9c6a67c67bc961ef5cb2b"`,
    );
    await queryRunner.query(`DROP TABLE "AIRunRecording"`);
  }
}
