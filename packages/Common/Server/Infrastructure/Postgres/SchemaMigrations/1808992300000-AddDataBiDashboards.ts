import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * BI dashboards (DataBiConnection, DataDashboard): the BI tools a project
 * reads dashboards from, with their encrypted credentials, and each tool's
 * dashboards with the watched tables behind them (DataDashboardDataAsset).
 */
export class AddDataBiDashboards1808992300000 implements MigrationInterface {
  public name: string = "AddDataBiDashboards1808992300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataBiConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "tool" character varying(100) NOT NULL, "baseUrl" character varying(500), "credentials" text, "isEnabled" boolean DEFAULT true, "lastSyncedAt" TIMESTAMP WITH TIME ZONE, "lastSyncError" character varying(500), "dashboardCount" integer, "matchedTableCount" integer, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_873a09a6cbcfc706b014b9df866" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a91b4d1fe8ec7f32f0f5845c6f" ON "DataBiConnection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0f30bc7a4045393488ac340781" ON "DataBiConnection" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataDashboard" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataBiConnectionId" uuid NOT NULL, "tool" character varying(100) NOT NULL, "externalId" character varying(100) NOT NULL, "name" character varying(500) NOT NULL, "url" character varying(500), "folder" character varying(500), "owner" character varying(100), "changedAt" TIMESTAMP WITH TIME ZONE, "tableCount" integer, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_822448c37a8266cb47876ebfe4e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f5f4ebf70a419f7ec2de7e1079" ON "DataDashboard" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_981bd6fb0e9a8913097e66f479" ON "DataDashboard" ("dataBiConnectionId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7084388b7375c5519e256cf034" ON "DataDashboard" ("dataBiConnectionId", "externalId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataDashboardDataAsset" ("dataDashboardId" uuid NOT NULL, "dataAssetId" uuid NOT NULL, CONSTRAINT "PK_15f8fda8bda00bfd4fd149542ea" PRIMARY KEY ("dataDashboardId", "dataAssetId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5ef4c9b9154653372f5d53d1d" ON "DataDashboardDataAsset" ("dataDashboardId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7c85512d28e608113a9689e7e1" ON "DataDashboardDataAsset" ("dataAssetId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" ADD CONSTRAINT "FK_a91b4d1fe8ec7f32f0f5845c6f9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" ADD CONSTRAINT "FK_74662cafe019c91c91cda94ecc3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" ADD CONSTRAINT "FK_5049c6f5affe4d1d0bd582cf4b1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD CONSTRAINT "FK_f5f4ebf70a419f7ec2de7e10797" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD CONSTRAINT "FK_981bd6fb0e9a8913097e66f4799" FOREIGN KEY ("dataBiConnectionId") REFERENCES "DataBiConnection"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD CONSTRAINT "FK_a67ddebdef510ab8d3a9aa9b586" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD CONSTRAINT "FK_6d8aae1ec5e35555106e2b219c9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboardDataAsset" ADD CONSTRAINT "FK_e5ef4c9b9154653372f5d53d1df" FOREIGN KEY ("dataDashboardId") REFERENCES "DataDashboard"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboardDataAsset" ADD CONSTRAINT "FK_7c85512d28e608113a9689e7e18" FOREIGN KEY ("dataAssetId") REFERENCES "DataAsset"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataDashboardDataAsset" DROP CONSTRAINT "FK_7c85512d28e608113a9689e7e18"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboardDataAsset" DROP CONSTRAINT "FK_e5ef4c9b9154653372f5d53d1df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP CONSTRAINT "FK_6d8aae1ec5e35555106e2b219c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP CONSTRAINT "FK_a67ddebdef510ab8d3a9aa9b586"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP CONSTRAINT "FK_981bd6fb0e9a8913097e66f4799"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP CONSTRAINT "FK_f5f4ebf70a419f7ec2de7e10797"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" DROP CONSTRAINT "FK_5049c6f5affe4d1d0bd582cf4b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" DROP CONSTRAINT "FK_74662cafe019c91c91cda94ecc3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" DROP CONSTRAINT "FK_a91b4d1fe8ec7f32f0f5845c6f9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c85512d28e608113a9689e7e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5ef4c9b9154653372f5d53d1d"`,
    );
    await queryRunner.query(`DROP TABLE "DataDashboardDataAsset"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7084388b7375c5519e256cf034"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_981bd6fb0e9a8913097e66f479"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5f4ebf70a419f7ec2de7e1079"`,
    );
    await queryRunner.query(`DROP TABLE "DataDashboard"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f30bc7a4045393488ac340781"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a91b4d1fe8ec7f32f0f5845c6f"`,
    );
    await queryRunner.query(`DROP TABLE "DataBiConnection"`);
  }
}
