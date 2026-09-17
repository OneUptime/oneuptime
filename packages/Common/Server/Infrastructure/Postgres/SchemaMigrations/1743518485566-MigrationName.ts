import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1743518485566 implements MigrationInterface {
  public name = "MigrationName1743518485566";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MetricType" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_3b19440ac8f314d9c775e026af5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d25bfc3fab2ebac8e977d88593" ON "MetricType" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MetricTypeTelemetryService" ("metricTypeId" uuid NOT NULL, "telemetryServiceId" uuid NOT NULL, CONSTRAINT "PK_ff3bdfa86c187345b15bf2d94e5" PRIMARY KEY ("metricTypeId", "telemetryServiceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2e26ea92e9cb5693040fd0a65b" ON "MetricTypeTelemetryService" ("metricTypeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f5ca58781b68c634e61ce25868" ON "MetricTypeTelemetryService" ("telemetryServiceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricType" ADD CONSTRAINT "FK_d25bfc3fab2ebac8e977d88593a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricType" ADD CONSTRAINT "FK_0662070948eed6110c5e108e77f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricType" ADD CONSTRAINT "FK_154d3b5c6f725d30753ef209666" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricTypeTelemetryService" ADD CONSTRAINT "FK_2e26ea92e9cb5693040fd0a65bb" FOREIGN KEY ("metricTypeId") REFERENCES "MetricType"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricTypeTelemetryService" ADD CONSTRAINT "FK_f5ca58781b68c634e61ce25868b" FOREIGN KEY ("telemetryServiceId") REFERENCES "TelemetryService"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MetricTypeTelemetryService" DROP CONSTRAINT "FK_f5ca58781b68c634e61ce25868b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricTypeTelemetryService" DROP CONSTRAINT "FK_2e26ea92e9cb5693040fd0a65bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricType" DROP CONSTRAINT "FK_154d3b5c6f725d30753ef209666"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricType" DROP CONSTRAINT "FK_0662070948eed6110c5e108e77f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricType" DROP CONSTRAINT "FK_d25bfc3fab2ebac8e977d88593a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5ca58781b68c634e61ce25868"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2e26ea92e9cb5693040fd0a65b"`,
    );
    await queryRunner.query(`DROP TABLE "MetricTypeTelemetryService"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d25bfc3fab2ebac8e977d88593"`,
    );
    await queryRunner.query(`DROP TABLE "MetricType"`);
  }
}
