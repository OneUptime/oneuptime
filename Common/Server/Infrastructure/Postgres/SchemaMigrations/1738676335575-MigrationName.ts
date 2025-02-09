import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1738676335575 implements MigrationInterface {
  public name = "MigrationName1738676335575";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceProviderProjectAuthToken" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "authToken" text NOT NULL, "serviceType" character varying(500) NOT NULL, "miscData" jsonb NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_64841f1b5152bdca4cbc7891109" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_51e54f737f8d568193060ec086" ON "ServiceProviderProjectAuthToken" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" ADD CONSTRAINT "FK_51e54f737f8d568193060ec086f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" ADD CONSTRAINT "FK_deba69a35cfce9ab352f7a6765e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" ADD CONSTRAINT "FK_04e551d83edcd3e3ff9f33f3b90" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" DROP CONSTRAINT "FK_04e551d83edcd3e3ff9f33f3b90"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" DROP CONSTRAINT "FK_deba69a35cfce9ab352f7a6765e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" DROP CONSTRAINT "FK_51e54f737f8d568193060ec086f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_51e54f737f8d568193060ec086"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceProviderProjectAuthToken"`);
  }
}
