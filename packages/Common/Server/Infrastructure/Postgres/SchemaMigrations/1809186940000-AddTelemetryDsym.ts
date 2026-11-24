import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * TelemetryDsym (#9922): one row per build of an iOS app's binary, its
 * function symbols from its dSYM, looked up by (projectId, debugId) for every
 * crash and hang ingest names. A new table: creating it rewrites and blocks
 * nothing.
 */
export class AddTelemetryDsym1809186940000 implements MigrationInterface {
  public name: string = "AddTelemetryDsym1809186940000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TelemetryDsym" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "debugId" character varying(100) NOT NULL, "binaryName" character varying(100) NOT NULL, "architecture" character varying(100) NOT NULL, "appName" character varying(100), "symbols" text NOT NULL, "symbolCount" integer, "sizeInBytes" integer, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_1793bc6c32c8a76e9a282695e95" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d4b13528fcc7918ea8b96e224b" ON "TelemetryDsym" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b945e479b3c5054ac394e4e70" ON "TelemetryDsym" ("projectId", "debugId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryDsym" ADD CONSTRAINT "FK_d4b13528fcc7918ea8b96e224b1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryDsym" ADD CONSTRAINT "FK_d5f4b0119fab4cbd591888e7ddd" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryDsym" ADD CONSTRAINT "FK_6db5c1b4b180249d6194e1e0b3c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryDsym" DROP CONSTRAINT "FK_6db5c1b4b180249d6194e1e0b3c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryDsym" DROP CONSTRAINT "FK_d5f4b0119fab4cbd591888e7ddd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryDsym" DROP CONSTRAINT "FK_d4b13528fcc7918ea8b96e224b1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b945e479b3c5054ac394e4e70"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d4b13528fcc7918ea8b96e224b"`,
    );
    await queryRunner.query(`DROP TABLE "TelemetryDsym"`);
  }
}
