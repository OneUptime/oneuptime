import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1754910440587 implements MigrationInterface {
  public name = "MigrationName1754910440587";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "WorkspaceNotificationLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "workspaceType" character varying(100) NOT NULL, "channelId" character varying(100), "channelName" character varying(100), "threadId" character varying(100), "messageSummary" character varying(500), "statusMessage" character varying(500), "status" character varying(100) NOT NULL, "incidentId" uuid, "alertId" uuid, "scheduledMaintenanceId" uuid, "statusPageId" uuid, "statusPageAnnouncementId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_8017cedff7ab932c1dc3d9c4c5f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_88e90b94233cbe8563a4bbfe45" ON "WorkspaceNotificationLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_872f735f983a70558c79c78ab7" ON "WorkspaceNotificationLog" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_346cb35ed758bd44e1e6e7405e" ON "WorkspaceNotificationLog" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31bc9b6754310f914c30e074d0" ON "WorkspaceNotificationLog" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ef2bf686464a74e9d759630b02" ON "WorkspaceNotificationLog" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf6998abfbf0786aeeb870756f" ON "WorkspaceNotificationLog" ("statusPageAnnouncementId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_88e90b94233cbe8563a4bbfe45a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_872f735f983a70558c79c78ab71" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_346cb35ed758bd44e1e6e7405eb" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_31bc9b6754310f914c30e074d00" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_ef2bf686464a74e9d759630b02a" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_bf6998abfbf0786aeeb870756f8" FOREIGN KEY ("statusPageAnnouncementId") REFERENCES "StatusPageAnnouncement"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_a99d29c3dfd37e7d2838436f702" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_a99d29c3dfd37e7d2838436f702"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_bf6998abfbf0786aeeb870756f8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_ef2bf686464a74e9d759630b02a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_31bc9b6754310f914c30e074d00"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_346cb35ed758bd44e1e6e7405eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_872f735f983a70558c79c78ab71"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_88e90b94233cbe8563a4bbfe45a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bf6998abfbf0786aeeb870756f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ef2bf686464a74e9d759630b02"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31bc9b6754310f914c30e074d0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_346cb35ed758bd44e1e6e7405e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_872f735f983a70558c79c78ab7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_88e90b94233cbe8563a4bbfe45"`,
    );
    await queryRunner.query(`DROP TABLE "WorkspaceNotificationLog"`);
  }
}
