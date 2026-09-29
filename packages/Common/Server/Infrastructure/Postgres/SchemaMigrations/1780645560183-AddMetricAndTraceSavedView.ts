import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMetricAndTraceSavedView1780645560183
  implements MigrationInterface
{
  public name = "AddMetricAndTraceSavedView1780645560183";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MetricSavedView" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "query" jsonb NOT NULL, "isDefault" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_c039adf718ddfc387e2f9182cd6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ca87e6c282970f623562035f2" ON "MetricSavedView" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c68db47974161dff86906b987d" ON "MetricSavedView" ("isDefault") `,
    );
    await queryRunner.query(
      `CREATE TABLE "TraceSavedView" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "query" jsonb NOT NULL, "isDefault" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_087d7140b86556085f9aebe8ee5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a5ab6a338198ce0171d7e9e767" ON "TraceSavedView" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24f5967407b37b1601e8aa95cd" ON "TraceSavedView" ("isDefault") `,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricSavedView" ADD CONSTRAINT "FK_1ca87e6c282970f623562035f2b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricSavedView" ADD CONSTRAINT "FK_5d6c800c0070ca19e75e664b46b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricSavedView" ADD CONSTRAINT "FK_84e306d0d03a2a4721fe767464d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceSavedView" ADD CONSTRAINT "FK_a5ab6a338198ce0171d7e9e767b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceSavedView" ADD CONSTRAINT "FK_e22965c32f7cb0e154d2fa76d24" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceSavedView" ADD CONSTRAINT "FK_e98727a618620d359fc766c95fc" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TraceSavedView" DROP CONSTRAINT "FK_e98727a618620d359fc766c95fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceSavedView" DROP CONSTRAINT "FK_e22965c32f7cb0e154d2fa76d24"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceSavedView" DROP CONSTRAINT "FK_a5ab6a338198ce0171d7e9e767b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricSavedView" DROP CONSTRAINT "FK_84e306d0d03a2a4721fe767464d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricSavedView" DROP CONSTRAINT "FK_5d6c800c0070ca19e75e664b46b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricSavedView" DROP CONSTRAINT "FK_1ca87e6c282970f623562035f2b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24f5967407b37b1601e8aa95cd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a5ab6a338198ce0171d7e9e767"`,
    );
    await queryRunner.query(`DROP TABLE "TraceSavedView"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c68db47974161dff86906b987d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1ca87e6c282970f623562035f2"`,
    );
    await queryRunner.query(`DROP TABLE "MetricSavedView"`);
  }
}
