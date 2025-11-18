import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1763480947474 implements MigrationInterface {
  public name = "MigrationName1763480947474";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "StatusPageAnnouncementFile" ("statusPageAnnouncementId" uuid NOT NULL, "fileId" uuid NOT NULL, CONSTRAINT "PK_1323a0215e608ece58a96816134" PRIMARY KEY ("statusPageAnnouncementId", "fileId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b152a77a26a67d2e76160ba15e" ON "StatusPageAnnouncementFile" ("statusPageAnnouncementId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2f78e2d073bf58013c962ce482" ON "StatusPageAnnouncementFile" ("fileId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertInternalNoteFile" ("alertInternalNoteId" uuid NOT NULL, "fileId" uuid NOT NULL, CONSTRAINT "PK_a5370c68590b3db5c3635d364aa" PRIMARY KEY ("alertInternalNoteId", "fileId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_09507cdab877a482edcc4c0593" ON "AlertInternalNoteFile" ("alertInternalNoteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77dc8a31bd4ebb0882450abdde" ON "AlertInternalNoteFile" ("fileId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncementFile" ADD CONSTRAINT "FK_b152a77a26a67d2e76160ba15e3" FOREIGN KEY ("statusPageAnnouncementId") REFERENCES "StatusPageAnnouncement"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncementFile" ADD CONSTRAINT "FK_2f78e2d073bf58013c962ce4827" FOREIGN KEY ("fileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNoteFile" ADD CONSTRAINT "FK_09507cdab877a482edcc4c05933" FOREIGN KEY ("alertInternalNoteId") REFERENCES "AlertInternalNote"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNoteFile" ADD CONSTRAINT "FK_77dc8a31bd4ebb0882450abdde9" FOREIGN KEY ("fileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNoteFile" DROP CONSTRAINT "FK_77dc8a31bd4ebb0882450abdde9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNoteFile" DROP CONSTRAINT "FK_09507cdab877a482edcc4c05933"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncementFile" DROP CONSTRAINT "FK_2f78e2d073bf58013c962ce4827"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncementFile" DROP CONSTRAINT "FK_b152a77a26a67d2e76160ba15e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77dc8a31bd4ebb0882450abdde"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_09507cdab877a482edcc4c0593"`,
    );
    await queryRunner.query(`DROP TABLE "AlertInternalNoteFile"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2f78e2d073bf58013c962ce482"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b152a77a26a67d2e76160ba15e"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageAnnouncementFile"`);
  }
}
