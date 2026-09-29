import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1729682875503 implements MigrationInterface {
  public name = "MigrationName1729682875503";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "Dashboard" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, "dashboardViewConfig" jsonb NOT NULL, CONSTRAINT "PK_98ee748c8a7a18d6f9ca995eaf4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7f0fc9402b8d4151c46e3015a3" ON "Dashboard" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardLabel" ("dashboardId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_bf2648028a4eab3f57aad76dab6" PRIMARY KEY ("dashboardId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ce2113f43c6d88a632318414d0" ON "DashboardLabel" ("dashboardId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31a32c8d6d1d1cb734c7711050" ON "DashboardLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_7f0fc9402b8d4151c46e3015a30" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_501b2bb8e0cb03f309211cbfa5f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_0debc7bed011eac37da40e875cb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabel" ADD CONSTRAINT "FK_ce2113f43c6d88a632318414d0d" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabel" ADD CONSTRAINT "FK_31a32c8d6d1d1cb734c77110509" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DashboardLabel" DROP CONSTRAINT "FK_31a32c8d6d1d1cb734c77110509"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabel" DROP CONSTRAINT "FK_ce2113f43c6d88a632318414d0d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_0debc7bed011eac37da40e875cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_501b2bb8e0cb03f309211cbfa5f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_7f0fc9402b8d4151c46e3015a30"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31a32c8d6d1d1cb734c7711050"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce2113f43c6d88a632318414d0"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7f0fc9402b8d4151c46e3015a3"`,
    );
    await queryRunner.query(`DROP TABLE "Dashboard"`);
  }
}
