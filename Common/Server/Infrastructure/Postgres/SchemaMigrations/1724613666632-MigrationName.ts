import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1724613666632 implements MigrationInterface {
  public name = "MigrationName1724613666632";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_199e3572d19b75e59f2082251f8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "markedAsMutedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "markedAsMutedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "markedAsArchivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "markedAsArchivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "isResolved" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_3def22373f0cb84e16cb355b5e5" FOREIGN KEY ("markedAsArchivedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_3def22373f0cb84e16cb355b5e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "isArchived"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "isResolved"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "markedAsArchivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "markedAsArchivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "markedAsMutedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "markedAsMutedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_199e3572d19b75e59f2082251f8" FOREIGN KEY ("markedAsMutedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
