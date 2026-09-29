import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1736780194077 implements MigrationInterface {
  public name = "MigrationName1736780194077";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incidentId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text NOT NULL, "incidentFeedEventType" character varying NOT NULL, "displayColor" character varying(7) NOT NULL, CONSTRAINT "PK_8188c79d1ed22013205ff324dea" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32ae47fa45018ecdb7f28c6468" ON "IncidentFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cf4aea7310bb855873fc40f244" ON "IncidentFeed" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "alertId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text NOT NULL, "alertFeedEventType" character varying NOT NULL, "displayColor" character varying(7) NOT NULL, CONSTRAINT "PK_d5f629abd40a51d58a35423b361" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f430519f21c327c14c12e4f106" ON "AlertFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f74177b6675d92243cc0794bd3" ON "AlertFeed" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "scheduledMaintenanceId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text NOT NULL, "scheduledMaintenanceFeedEventType" character varying NOT NULL, "displayColor" character varying(7) NOT NULL, CONSTRAINT "PK_ced33ccb5551624e432b2df6513" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_416c6ded7f17b15e9a83114740" ON "ScheduledMaintenanceFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ce3b353bbd3e1695c0ffb2d235" ON "ScheduledMaintenanceFeed" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ADD CONSTRAINT "FK_32ae47fa45018ecdb7f28c64685" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ADD CONSTRAINT "FK_cf4aea7310bb855873fc40f2441" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ADD CONSTRAINT "FK_4458fd00d52521ae4333e74ddbd" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ADD CONSTRAINT "FK_f1ee9faba64e96f91925247aae3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" ADD CONSTRAINT "FK_f430519f21c327c14c12e4f1063" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" ADD CONSTRAINT "FK_f74177b6675d92243cc0794bd3f" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" ADD CONSTRAINT "FK_2eda7dbbc78de28f653812b5e3d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" ADD CONSTRAINT "FK_f0e72673c38f18ed84f0e94a5a1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ADD CONSTRAINT "FK_416c6ded7f17b15e9a831147403" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ADD CONSTRAINT "FK_ce3b353bbd3e1695c0ffb2d2354" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ADD CONSTRAINT "FK_fc34cf1a5eb488310bbe7c6a46a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ADD CONSTRAINT "FK_8374052884c5d75f5018c1dc908" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" DROP CONSTRAINT "FK_8374052884c5d75f5018c1dc908"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" DROP CONSTRAINT "FK_fc34cf1a5eb488310bbe7c6a46a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" DROP CONSTRAINT "FK_ce3b353bbd3e1695c0ffb2d2354"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" DROP CONSTRAINT "FK_416c6ded7f17b15e9a831147403"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" DROP CONSTRAINT "FK_f0e72673c38f18ed84f0e94a5a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" DROP CONSTRAINT "FK_2eda7dbbc78de28f653812b5e3d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" DROP CONSTRAINT "FK_f74177b6675d92243cc0794bd3f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" DROP CONSTRAINT "FK_f430519f21c327c14c12e4f1063"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" DROP CONSTRAINT "FK_f1ee9faba64e96f91925247aae3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" DROP CONSTRAINT "FK_4458fd00d52521ae4333e74ddbd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" DROP CONSTRAINT "FK_cf4aea7310bb855873fc40f2441"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" DROP CONSTRAINT "FK_32ae47fa45018ecdb7f28c64685"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce3b353bbd3e1695c0ffb2d235"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_416c6ded7f17b15e9a83114740"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f74177b6675d92243cc0794bd3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f430519f21c327c14c12e4f106"`,
    );
    await queryRunner.query(`DROP TABLE "AlertFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cf4aea7310bb855873fc40f244"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_32ae47fa45018ecdb7f28c6468"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentFeed"`);
  }
}
