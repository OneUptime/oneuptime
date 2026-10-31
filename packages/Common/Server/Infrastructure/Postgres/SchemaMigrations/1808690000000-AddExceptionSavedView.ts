import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 *   - "ExceptionSavedView": the exceptions list's saved views, a table of
 *     their own beside "TraceSavedView", so a project's default views of
 *     the two never take the default from each other.
 *
 * A new table: its indexes and foreign keys are built while it is still
 * empty, so they need no online DDL.
 */
export class AddExceptionSavedView1808690000000 implements MigrationInterface {
  public name: string = "AddExceptionSavedView1808690000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ExceptionSavedView" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "query" jsonb NOT NULL, "isDefault" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_4bbc92166a8c4dab65a83c2b717" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fe46db522ebb373bd425ad2023" ON "ExceptionSavedView" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_81adf9a7108136bd839af8c4f0" ON "ExceptionSavedView" ("isDefault") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ExceptionSavedView" ADD CONSTRAINT "FK_fe46db522ebb373bd425ad20237" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExceptionSavedView" ADD CONSTRAINT "FK_adacd9206f894f9b2973073d90a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExceptionSavedView" ADD CONSTRAINT "FK_25350e9b232c500f4c0cb0c60b2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ExceptionSavedView" DROP CONSTRAINT "FK_25350e9b232c500f4c0cb0c60b2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExceptionSavedView" DROP CONSTRAINT "FK_adacd9206f894f9b2973073d90a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExceptionSavedView" DROP CONSTRAINT "FK_fe46db522ebb373bd425ad20237"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_81adf9a7108136bd839af8c4f0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fe46db522ebb373bd425ad2023"`,
    );
    await queryRunner.query(`DROP TABLE "ExceptionSavedView"`);
  }
}
