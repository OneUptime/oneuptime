import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1722543640526 implements MigrationInterface {
  public name = "MigrationName1722543640526";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TelemetryIngestionKey" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, "secretKey" uuid NOT NULL, CONSTRAINT "PK_57133851c3817251c983a378342" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1fb4fe814854b5467b01b3c0ba" ON "TelemetryIngestionKey" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77ea38e4cde6e922e5e37c3ac4" ON "TelemetryIngestionKey" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb6b4532687f175cedf383f4e7" ON "TelemetryIngestionKey" ("secretKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD CONSTRAINT "FK_1fb4fe814854b5467b01b3c0ba4" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD CONSTRAINT "FK_3f05c2120ab58bbd23883a7bc26" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD CONSTRAINT "FK_2874c193beda1ef2e841cbbfba4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP CONSTRAINT "FK_2874c193beda1ef2e841cbbfba4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP CONSTRAINT "FK_3f05c2120ab58bbd23883a7bc26"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP CONSTRAINT "FK_1fb4fe814854b5467b01b3c0ba4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb6b4532687f175cedf383f4e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77ea38e4cde6e922e5e37c3ac4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1fb4fe814854b5467b01b3c0ba"`,
    );
    await queryRunner.query(`DROP TABLE "TelemetryIngestionKey"`);
  }
}
