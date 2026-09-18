import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDataSourceTable1786303472848 implements MigrationInterface {
  public name: string = "AddDataSourceTable1786303472848";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataSource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "dataSourceType" character varying(100) NOT NULL, "url" character varying, "databaseHost" character varying(100), "databasePort" integer, "databaseName" character varying(100), "username" character varying(100), "password" text, "apiToken" text, "customHeaders" jsonb, "additionalOptions" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_49141becafea4a0574d9b5219ca" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0e559ea9d7fbc66d014a29c380" ON "DataSource" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSource" ADD CONSTRAINT "FK_0e559ea9d7fbc66d014a29c3804" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSource" ADD CONSTRAINT "FK_38843f53e5ca0ce0bf4de525d6f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSource" ADD CONSTRAINT "FK_29f0d663494b52c4ed2c0cc8e88" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSource" DROP CONSTRAINT "FK_29f0d663494b52c4ed2c0cc8e88"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSource" DROP CONSTRAINT "FK_38843f53e5ca0ce0bf4de525d6f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSource" DROP CONSTRAINT "FK_0e559ea9d7fbc66d014a29c3804"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e559ea9d7fbc66d014a29c380"`,
    );
    await queryRunner.query(`DROP TABLE "DataSource"`);
  }
}
