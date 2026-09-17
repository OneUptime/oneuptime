import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1783957160597 implements MigrationInterface {
  public name: string = "MigrationName1783957160597";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "InstanceHealthLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "eventType" character varying(100) NOT NULL, "status" character varying(100) NOT NULL, "message" text NOT NULL, "completedAt" TIMESTAMP WITH TIME ZONE, "nextCheckAt" TIMESTAMP WITH TIME ZONE, "capacityBeforePercent" numeric, "capacityAfterPercent" numeric, "thresholdPercent" integer, "targetPercent" integer, "estimatedFreedBytes" bigint, "metadata" jsonb, CONSTRAINT "PK_625f9ce409f0648439e9940c0c6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c2586a18f586d8f02dbec4a46" ON "InstanceHealthLog" ("eventType", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "clickhouseCapacityNotificationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "clickhouseCapacityNotificationThresholdPercent" integer NOT NULL DEFAULT '80'`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "clickhouseDataPruningEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "clickhouseDataPruningThresholdPercent" integer NOT NULL DEFAULT '90'`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "clickhouseDataPruningTargetPercent" integer NOT NULL DEFAULT '80'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "clickhouseDataPruningTargetPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "clickhouseDataPruningThresholdPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "clickhouseDataPruningEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "clickhouseCapacityNotificationThresholdPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "clickhouseCapacityNotificationEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c2586a18f586d8f02dbec4a46"`,
    );
    await queryRunner.query(`DROP TABLE "InstanceHealthLog"`);
  }
}
