import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMigrationFailureTable1783523076215
  implements MigrationInterface
{
  public name = "AddMigrationFailureTable1783523076215";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MigrationFailure" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "migrationName" character varying(100) NOT NULL, "migrationType" character varying(100) NOT NULL, "errorMessage" text NOT NULL, "errorStack" text, "attemptedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "hostName" character varying(100), "appVersion" character varying(100), CONSTRAINT "PK_db298508bb9e7064755c660eb8b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_afd3cf5c9703ef3cd3f74bcecf" ON "MigrationFailure" ("migrationName") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0e4fbfab7ec24121ac4fc66d64" ON "MigrationFailure" ("migrationType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d0f64f28973facc22ab17764e4" ON "MigrationFailure" ("attemptedAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d0f64f28973facc22ab17764e4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e4fbfab7ec24121ac4fc66d64"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_afd3cf5c9703ef3cd3f74bcecf"`,
    );
    await queryRunner.query(`DROP TABLE "MigrationFailure"`);
  }
}
