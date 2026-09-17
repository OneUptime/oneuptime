import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1763471659817 implements MigrationInterface {
  public name = "MigrationName1763471659817";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentInternalNoteFile" ("incidentInternalNoteId" uuid NOT NULL, "fileId" uuid NOT NULL, CONSTRAINT "PK_1e97a749db84f9dc65ee162dd6b" PRIMARY KEY ("incidentInternalNoteId", "fileId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0edb0291ff3e97197269d77dc4" ON "IncidentInternalNoteFile" ("incidentInternalNoteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b30b49d21a553c06bd0ff3acf5" ON "IncidentInternalNoteFile" ("fileId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentPublicNoteFile" ("incidentPublicNoteId" uuid NOT NULL, "fileId" uuid NOT NULL, CONSTRAINT "PK_42d2fe75b663f8fa20421f31e78" PRIMARY KEY ("incidentPublicNoteId", "fileId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5c4a5671b2bb51a9918f1f203" ON "IncidentPublicNoteFile" ("incidentPublicNoteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_81a5bc92f59cb5577746ee51ba" ON "IncidentPublicNoteFile" ("fileId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNoteFile" ADD CONSTRAINT "FK_0edb0291ff3e97197269d77dc48" FOREIGN KEY ("incidentInternalNoteId") REFERENCES "IncidentInternalNote"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNoteFile" ADD CONSTRAINT "FK_b30b49d21a553c06bd0ff3acf5f" FOREIGN KEY ("fileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNoteFile" ADD CONSTRAINT "FK_e5c4a5671b2bb51a9918f1f203d" FOREIGN KEY ("incidentPublicNoteId") REFERENCES "IncidentPublicNote"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNoteFile" ADD CONSTRAINT "FK_81a5bc92f59cb5577746ee51baf" FOREIGN KEY ("fileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNoteFile" DROP CONSTRAINT "FK_81a5bc92f59cb5577746ee51baf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNoteFile" DROP CONSTRAINT "FK_e5c4a5671b2bb51a9918f1f203d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNoteFile" DROP CONSTRAINT "FK_b30b49d21a553c06bd0ff3acf5f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNoteFile" DROP CONSTRAINT "FK_0edb0291ff3e97197269d77dc48"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_81a5bc92f59cb5577746ee51ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5c4a5671b2bb51a9918f1f203"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPublicNoteFile"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b30b49d21a553c06bd0ff3acf5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0edb0291ff3e97197269d77dc4"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentInternalNoteFile"`);
  }
}
