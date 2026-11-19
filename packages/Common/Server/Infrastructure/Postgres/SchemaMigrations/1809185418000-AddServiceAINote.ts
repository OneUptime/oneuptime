import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * What a service's team tells OneUptime AI about it (#7672): a note at a
 * time, on the service's page, read by every investigation of an incident or
 * an alert on the service (Models/DatabaseModels/ServiceAINote).
 *
 * A new table: its indexes and keys are built on no rows, so nothing here
 * waits on a table that holds data.
 */
export class AddServiceAINote1809185418000 implements MigrationInterface {
  public name = "AddServiceAINote1809185418000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceAINote" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceId" uuid NOT NULL, "note" character varying NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_61f7edab808716f4c243f8cb2fb" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_492561a1ebe2f6f3365501d1d1" ON "ServiceAINote" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_88c4da86adc787a6d4178d76c5" ON "ServiceAINote" ("serviceId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceAINote" ADD CONSTRAINT "FK_492561a1ebe2f6f3365501d1d11" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceAINote" ADD CONSTRAINT "FK_944683cc561bc446dfcace8bb1b" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceAINote" ADD CONSTRAINT "FK_928b5df498a38801b27ac2c7dfa" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceAINote" ADD CONSTRAINT "FK_ffffcfaae1190276812ab8b8aa9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceAINote" DROP CONSTRAINT "FK_ffffcfaae1190276812ab8b8aa9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceAINote" DROP CONSTRAINT "FK_928b5df498a38801b27ac2c7dfa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceAINote" DROP CONSTRAINT "FK_944683cc561bc446dfcace8bb1b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceAINote" DROP CONSTRAINT "FK_492561a1ebe2f6f3365501d1d11"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_88c4da86adc787a6d4178d76c5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_492561a1ebe2f6f3365501d1d1"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceAINote"`);
  }
}
