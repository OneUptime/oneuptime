import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1774355321449 implements MigrationInterface {
  public name = "MigrationName1774355321449";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "WorkspaceNotificationSummary" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(500) NOT NULL, "description" character varying(500), "workspaceType" character varying(500) NOT NULL, "summaryType" character varying NOT NULL, "recurringInterval" jsonb NOT NULL, "numberOfDaysOfData" integer NOT NULL DEFAULT '7', "channelNames" jsonb NOT NULL, "teamName" character varying(500), "summaryItems" jsonb NOT NULL, "filters" jsonb, "filterCondition" character varying, "nextSendAt" TIMESTAMP WITH TIME ZONE, "lastSentAt" TIMESTAMP WITH TIME ZONE, "isEnabled" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c5bb0f644c5279e3781177ce819" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7f80977bcbac1b82c2beacc27" ON "WorkspaceNotificationSummary" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationSummary" ADD CONSTRAINT "FK_d7f80977bcbac1b82c2beacc271" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationSummary" ADD CONSTRAINT "FK_f9c24022445dbea5d8b2d104302" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationSummary" ADD CONSTRAINT "FK_a9f1c0c0d88abf1795d1c93c138" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationSummary" DROP CONSTRAINT "FK_a9f1c0c0d88abf1795d1c93c138"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationSummary" DROP CONSTRAINT "FK_f9c24022445dbea5d8b2d104302"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationSummary" DROP CONSTRAINT "FK_d7f80977bcbac1b82c2beacc271"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d7f80977bcbac1b82c2beacc27"`,
    );
    await queryRunner.query(`DROP TABLE "WorkspaceNotificationSummary"`);
  }
}
