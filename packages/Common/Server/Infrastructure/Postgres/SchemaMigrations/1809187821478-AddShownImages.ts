import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Which records show each inline image (ShownImage, #11478): one row per
 * image and record, so the image's address opens it only for the people
 * who may read one of those records, without the image route reading every
 * record of the project. A new table, so its indexes are built on an empty
 * table and need no online DDL. The records written before it are read
 * into it once by BackfillShownImages1809187821479.
 */
export class AddShownImages1809187821478 implements MigrationInterface {
  public name: string = "AddShownImages1809187821478";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ShownImage" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "fileId" uuid NOT NULL, "recordTableName" character varying(100) NOT NULL, "recordId" uuid NOT NULL, CONSTRAINT "PK_67b9671053b28d5fe3fa18def29" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ad84889ec971f228dc046e8070" ON "ShownImage" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_196cb8103e0203f8143122afd4" ON "ShownImage" ("fileId", "recordTableName", "recordId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ShownImage" ADD CONSTRAINT "FK_ad84889ec971f228dc046e80700" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ShownImage" DROP CONSTRAINT "FK_ad84889ec971f228dc046e80700"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_196cb8103e0203f8143122afd4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ad84889ec971f228dc046e8070"`,
    );
    await queryRunner.query(`DROP TABLE "ShownImage"`);
  }
}
