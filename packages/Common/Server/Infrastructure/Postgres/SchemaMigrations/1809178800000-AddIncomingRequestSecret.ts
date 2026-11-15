import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A project's incoming request secrets, and the switch that makes its
 * Incoming Request monitors require one (issue #7526): the IncomingRequestSecret
 * table and Project.requireIncomingRequestSecret.
 *
 * The table is new and empty, so its index and foreign keys are built here,
 * in the transaction. The column is added with a constant default, which
 * Postgres records without rewriting "Project".
 */
export class AddIncomingRequestSecret1809178800000
  implements MigrationInterface
{
  public name: string = "AddIncomingRequestSecret1809178800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncomingRequestSecret" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "secretValue" text NOT NULL, "lastUsedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_044adfcadda6e84f04c5f00aad7" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b78fe4144758daacc20f79220" ON "IncomingRequestSecret" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "requireIncomingRequestSecret" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecret" ADD CONSTRAINT "FK_8b78fe4144758daacc20f792202" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecret" ADD CONSTRAINT "FK_e3919663aa874d7ffb26aa05e5b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecret" ADD CONSTRAINT "FK_039c922008784d430af36f5f960" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecret" DROP CONSTRAINT "FK_039c922008784d430af36f5f960"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecret" DROP CONSTRAINT "FK_e3919663aa874d7ffb26aa05e5b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecret" DROP CONSTRAINT "FK_8b78fe4144758daacc20f792202"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "requireIncomingRequestSecret"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b78fe4144758daacc20f79220"`,
    );
    await queryRunner.query(`DROP TABLE "IncomingRequestSecret"`);
  }
}
