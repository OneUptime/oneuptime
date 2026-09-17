import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1754828812691 implements MigrationInterface {
  public name = "MigrationName1754828812691";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "PushNotificationLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "title" character varying(500) NOT NULL, "body" text, "deviceType" character varying(100), "statusMessage" character varying(500), "status" character varying(100) NOT NULL, "incidentId" uuid, "alertId" uuid, "scheduledMaintenanceId" uuid, "statusPageId" uuid, "statusPageAnnouncementId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_48b086e2ca3ee9d745ecfe97c41" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_73168664b6ffced71ffa731981" ON "PushNotificationLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_59a4b45ae83418ceef477ef459" ON "PushNotificationLog" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c684177471f5d1a9a3051f21bf" ON "PushNotificationLog" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5ad3e66a90d721ac387a7da5ca" ON "PushNotificationLog" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c48d5589256ff128b0965ab9e7" ON "PushNotificationLog" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c62bb260910d202548e36d7827" ON "PushNotificationLog" ("statusPageAnnouncementId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_73168664b6ffced71ffa7319817" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_59a4b45ae83418ceef477ef4590" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_c684177471f5d1a9a3051f21bf0" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_5ad3e66a90d721ac387a7da5caa" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_c48d5589256ff128b0965ab9e78" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_c62bb260910d202548e36d7827a" FOREIGN KEY ("statusPageAnnouncementId") REFERENCES "StatusPageAnnouncement"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_e891a0077d446c86acee230959d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_e891a0077d446c86acee230959d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_c62bb260910d202548e36d7827a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_c48d5589256ff128b0965ab9e78"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_5ad3e66a90d721ac387a7da5caa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_c684177471f5d1a9a3051f21bf0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_59a4b45ae83418ceef477ef4590"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_73168664b6ffced71ffa7319817"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c62bb260910d202548e36d7827"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c48d5589256ff128b0965ab9e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5ad3e66a90d721ac387a7da5ca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c684177471f5d1a9a3051f21bf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_59a4b45ae83418ceef477ef459"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_73168664b6ffced71ffa731981"`,
    );
    await queryRunner.query(`DROP TABLE "PushNotificationLog"`);
  }
}
