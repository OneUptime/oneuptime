import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data products (DataProduct): named groups of watched tables with a
 * freshness SLA, each with its monitor and SLO, and the join table of its
 * tables (DataProductDataAsset). Both tables are new, so their indexes and
 * keys are built with them.
 */
export class AddDataProducts1808992100000 implements MigrationInterface {
  public name: string = "AddDataProducts1808992100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataProduct" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "consumers" character varying(500), "freshByTimeOfDay" character varying(100), "maxDataAgeInMinutes" integer, "slaTargetPercentage" numeric, "ownerTeamId" uuid, "ownerUserId" uuid, "status" character varying(100), "lateTableCount" integer, "lateDataAssetIds" jsonb, "dataAsOf" TIMESTAMP WITH TIME ZONE, "statusChangedAt" TIMESTAMP WITH TIME ZONE, "statusCheckedAt" TIMESTAMP WITH TIME ZONE, "monitorId" uuid, "serviceLevelObjectiveId" uuid, "badgeToken" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_57c8a425fa3ff059b9bb0a377d1" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9e0acd212aacbf12d23e33d951" ON "DataProduct" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_48858419e969f490e78aa283b3" ON "DataProduct" ("ownerTeamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d1141c22fcb9e828db03303c47" ON "DataProduct" ("ownerUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d9209a85f881cb68a22818100" ON "DataProduct" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b06d97e3296032f970c6159ca4" ON "DataProduct" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_966c4c956e346f0f708d2a5697" ON "DataProduct" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataProductDataAsset" ("dataProductId" uuid NOT NULL, "dataAssetId" uuid NOT NULL, CONSTRAINT "PK_961b51dcbf1b86525e6c5bcc1f6" PRIMARY KEY ("dataProductId", "dataAssetId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1afd968ccc2a6309afa781b24d" ON "DataProductDataAsset" ("dataProductId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_19dab91bc1c70c769894e8abd4" ON "DataProductDataAsset" ("dataAssetId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" ADD CONSTRAINT "FK_9e0acd212aacbf12d23e33d9516" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" ADD CONSTRAINT "FK_48858419e969f490e78aa283b3c" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" ADD CONSTRAINT "FK_d1141c22fcb9e828db03303c47c" FOREIGN KEY ("ownerUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" ADD CONSTRAINT "FK_8d9209a85f881cb68a228181007" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" ADD CONSTRAINT "FK_b06d97e3296032f970c6159ca42" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" ADD CONSTRAINT "FK_2e36baffa9c9d17f18b79d4cd22" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" ADD CONSTRAINT "FK_e8686c929d6582cec5da9c917e6" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProductDataAsset" ADD CONSTRAINT "FK_1afd968ccc2a6309afa781b24dd" FOREIGN KEY ("dataProductId") REFERENCES "DataProduct"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProductDataAsset" ADD CONSTRAINT "FK_19dab91bc1c70c769894e8abd44" FOREIGN KEY ("dataAssetId") REFERENCES "DataAsset"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataProductDataAsset" DROP CONSTRAINT "FK_19dab91bc1c70c769894e8abd44"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProductDataAsset" DROP CONSTRAINT "FK_1afd968ccc2a6309afa781b24dd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" DROP CONSTRAINT "FK_e8686c929d6582cec5da9c917e6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" DROP CONSTRAINT "FK_2e36baffa9c9d17f18b79d4cd22"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" DROP CONSTRAINT "FK_b06d97e3296032f970c6159ca42"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" DROP CONSTRAINT "FK_8d9209a85f881cb68a228181007"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" DROP CONSTRAINT "FK_d1141c22fcb9e828db03303c47c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" DROP CONSTRAINT "FK_48858419e969f490e78aa283b3c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" DROP CONSTRAINT "FK_9e0acd212aacbf12d23e33d9516"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_19dab91bc1c70c769894e8abd4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1afd968ccc2a6309afa781b24d"`,
    );
    await queryRunner.query(`DROP TABLE "DataProductDataAsset"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_966c4c956e346f0f708d2a5697"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b06d97e3296032f970c6159ca4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d9209a85f881cb68a22818100"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d1141c22fcb9e828db03303c47"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_48858419e969f490e78aa283b3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9e0acd212aacbf12d23e33d951"`,
    );
    await queryRunner.query(`DROP TABLE "DataProduct"`);
  }
}
