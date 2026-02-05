import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770232207959 implements MigrationInterface {
  public name = "MigrationName1770232207959";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodePublicNote" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incidentEpisodeId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "note" text NOT NULL, "subscriberNotificationStatusOnNoteCreated" character varying NOT NULL DEFAULT 'Pending', "subscriberNotificationStatusMessage" text, "shouldStatusPageSubscribersBeNotifiedOnNoteCreated" boolean NOT NULL DEFAULT true, "isOwnerNotified" boolean NOT NULL DEFAULT false, "postedAt" TIMESTAMP WITH TIME ZONE, "postedFromSlackMessageId" character varying, CONSTRAINT "PK_7ac3241d9cf7bdf5ecac42c9c98" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46268b7b996f3b8129136d12d2" ON "IncidentEpisodePublicNote" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_885de505291c2f6f4f86b988ca" ON "IncidentEpisodePublicNote" ("incidentEpisodeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2e0c6dd840bbc05b9a5117f882" ON "IncidentEpisodePublicNote" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_784fb865a857417194a37034ed" ON "IncidentEpisodePublicNote" ("postedFromSlackMessageId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodePublicNoteFile" ("incidentEpisodePublicNoteId" uuid NOT NULL, "fileId" uuid NOT NULL, CONSTRAINT "PK_546f0c2cf908ebf301fb164a1ed" PRIMARY KEY ("incidentEpisodePublicNoteId", "fileId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e439d24c574141d9a66d74fa5" ON "IncidentEpisodePublicNoteFile" ("incidentEpisodePublicNoteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0dfcd7747b6e55239df9bbaac5" ON "IncidentEpisodePublicNoteFile" ("fileId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" ADD "showEpisodeOnStatusPage" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" ADD "isVisibleOnStatusPage" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" ADD "declaredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" ADD "shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" ADD "subscriberNotificationStatusOnEpisodeCreated" character varying NOT NULL DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" ADD "subscriberNotificationStatusMessage" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "showEpisodesOnStatusPage" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeStateTimeline" ADD "shouldStatusPageSubscribersBeNotified" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeStateTimeline" ADD "subscriberNotificationStatus" character varying NOT NULL DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeStateTimeline" ADD "subscriberNotificationStatusMessage" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9d7bfebab97dc56583df143ae8" ON "IncidentGroupingRule" ("showEpisodeOnStatusPage") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_298e3524e859ddb920c05e1072" ON "IncidentEpisode" ("isVisibleOnStatusPage") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_30d4a06d51be505b6233185906" ON "IncidentEpisode" ("declaredAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" ADD CONSTRAINT "FK_46268b7b996f3b8129136d12d21" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" ADD CONSTRAINT "FK_885de505291c2f6f4f86b988ca6" FOREIGN KEY ("incidentEpisodeId") REFERENCES "IncidentEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" ADD CONSTRAINT "FK_7711bde5254d7c1021bbbb0f944" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" ADD CONSTRAINT "FK_96d88a43c5479b67ddd7c70df16" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNoteFile" ADD CONSTRAINT "FK_8e439d24c574141d9a66d74fa5c" FOREIGN KEY ("incidentEpisodePublicNoteId") REFERENCES "IncidentEpisodePublicNote"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNoteFile" ADD CONSTRAINT "FK_0dfcd7747b6e55239df9bbaac59" FOREIGN KEY ("fileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNoteFile" DROP CONSTRAINT "FK_0dfcd7747b6e55239df9bbaac59"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNoteFile" DROP CONSTRAINT "FK_8e439d24c574141d9a66d74fa5c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" DROP CONSTRAINT "FK_96d88a43c5479b67ddd7c70df16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" DROP CONSTRAINT "FK_7711bde5254d7c1021bbbb0f944"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" DROP CONSTRAINT "FK_885de505291c2f6f4f86b988ca6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" DROP CONSTRAINT "FK_46268b7b996f3b8129136d12d21"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30d4a06d51be505b6233185906"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_298e3524e859ddb920c05e1072"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d7bfebab97dc56583df143ae8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeStateTimeline" DROP COLUMN "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeStateTimeline" DROP COLUMN "subscriberNotificationStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeStateTimeline" DROP COLUMN "shouldStatusPageSubscribersBeNotified"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "showEpisodesOnStatusPage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" DROP COLUMN "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" DROP COLUMN "subscriberNotificationStatusOnEpisodeCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" DROP COLUMN "shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" DROP COLUMN "declaredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" DROP COLUMN "isVisibleOnStatusPage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" DROP COLUMN "showEpisodeOnStatusPage"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0dfcd7747b6e55239df9bbaac5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e439d24c574141d9a66d74fa5"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentEpisodePublicNoteFile"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_784fb865a857417194a37034ed"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2e0c6dd840bbc05b9a5117f882"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_885de505291c2f6f4f86b988ca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_46268b7b996f3b8129136d12d2"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentEpisodePublicNote"`);
  }
}
