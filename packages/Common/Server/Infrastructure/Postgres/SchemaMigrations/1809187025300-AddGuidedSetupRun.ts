import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A guided setup's run, kept on the server (GuidedSetupRun, #7253): one row
 * per project, person and setup, with what the run made and how each record
 * it makes is getting on, so another device opens the setup where the
 * person left it. It goes with its project or its person. A new table, so
 * its index is built on an empty table and needs no online DDL. Existing
 * installations start with none: a browser that kept a run sends it the
 * first time its setup opens.
 */
export class AddGuidedSetupRun1809187025300 implements MigrationInterface {
  public name: string = "AddGuidedSetupRun1809187025300";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "GuidedSetupRun" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "setup" character varying(100) NOT NULL, "values" jsonb, "resources" jsonb, "revision" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_6470355f8e6239e1e9f284e1952" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6dc050f394b544459671589cb2" ON "GuidedSetupRun" ("projectId", "userId", "setup") `,
    );
    await queryRunner.query(
      `ALTER TABLE "GuidedSetupRun" ADD CONSTRAINT "FK_355b6a5cfefad8ccd78f5ae6c5f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GuidedSetupRun" ADD CONSTRAINT "FK_0f488ad75e21cac7ed0d3eabaaf" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GuidedSetupRun" DROP CONSTRAINT "FK_0f488ad75e21cac7ed0d3eabaaf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GuidedSetupRun" DROP CONSTRAINT "FK_355b6a5cfefad8ccd78f5ae6c5f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6dc050f394b544459671589cb2"`,
    );
    await queryRunner.query(`DROP TABLE "GuidedSetupRun"`);
  }
}
