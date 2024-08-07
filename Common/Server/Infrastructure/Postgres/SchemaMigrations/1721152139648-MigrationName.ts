import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1721152139648 implements MigrationInterface {
  public name = "MigrationName1721152139648";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceCatalogMonitor" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceCatalogId" uuid NOT NULL, "monitorId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_194c766475d9a575a17c16bb7b9" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4ea52669c01c5ec8920d5d4b6d" ON "ServiceCatalogMonitor" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8becc4dbab47d9c6cbdcdcd4dc" ON "ServiceCatalogMonitor" ("serviceCatalogId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b3cdff92c6b8c874e3406b2add" ON "ServiceCatalogMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceCatalogTelemetryService" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceCatalogId" uuid NOT NULL, "telemetryServiceId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_8459b09ed3e9f0c337b8d61d977" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8193db094ffae0498ed3425e36" ON "ServiceCatalogTelemetryService" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d8010d867aee38375f92dcf5a0" ON "ServiceCatalogTelemetryService" ("serviceCatalogId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0e147801744032a9b33ee87982" ON "ServiceCatalogTelemetryService" ("telemetryServiceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" ADD CONSTRAINT "FK_4ea52669c01c5ec8920d5d4b6da" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" ADD CONSTRAINT "FK_8becc4dbab47d9c6cbdcdcd4dc9" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" ADD CONSTRAINT "FK_b3cdff92c6b8c874e3406b2add5" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" ADD CONSTRAINT "FK_e8e03c07999471753b9f6093a67" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" ADD CONSTRAINT "FK_1783ec2972d9cbf2f91fced5be3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" ADD CONSTRAINT "FK_8193db094ffae0498ed3425e36a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" ADD CONSTRAINT "FK_d8010d867aee38375f92dcf5a02" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" ADD CONSTRAINT "FK_0e147801744032a9b33ee879829" FOREIGN KEY ("telemetryServiceId") REFERENCES "TelemetryService"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" ADD CONSTRAINT "FK_64a7908ff27c562a2d7f5532e2a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" ADD CONSTRAINT "FK_b0419b3b36e6606a404eb97a98a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" DROP CONSTRAINT "FK_b0419b3b36e6606a404eb97a98a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" DROP CONSTRAINT "FK_64a7908ff27c562a2d7f5532e2a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" DROP CONSTRAINT "FK_0e147801744032a9b33ee879829"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" DROP CONSTRAINT "FK_d8010d867aee38375f92dcf5a02"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" DROP CONSTRAINT "FK_8193db094ffae0498ed3425e36a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" DROP CONSTRAINT "FK_1783ec2972d9cbf2f91fced5be3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" DROP CONSTRAINT "FK_e8e03c07999471753b9f6093a67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" DROP CONSTRAINT "FK_b3cdff92c6b8c874e3406b2add5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" DROP CONSTRAINT "FK_8becc4dbab47d9c6cbdcdcd4dc9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" DROP CONSTRAINT "FK_4ea52669c01c5ec8920d5d4b6da"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e147801744032a9b33ee87982"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d8010d867aee38375f92dcf5a0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8193db094ffae0498ed3425e36"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceCatalogTelemetryService"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b3cdff92c6b8c874e3406b2add"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8becc4dbab47d9c6cbdcdcd4dc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4ea52669c01c5ec8920d5d4b6d"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceCatalogMonitor"`);
  }
}
