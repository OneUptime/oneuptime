import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1724610006927 implements MigrationInterface {
  public name = "MigrationName1724610006927";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TelemetryException" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "telemetryServiceId" uuid NOT NULL, "message" character varying, "stackTrace" character varying, "exceptionType" character varying, "fingerprint" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, "markedAsResolvedAt" TIMESTAMP WITH TIME ZONE, "markedAsMutedAt" TIMESTAMP WITH TIME ZONE, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "assignToUserId" uuid, "assignToTeamId" uuid, "markedAsResolvedByUserId" uuid, "markedAsMutedByUserId" uuid, CONSTRAINT "PK_53717afe73c3e72c11713e5e25f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3310c3a807a7e8bca9d1bd8e0e" ON "TelemetryException" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6470c69cb5f53c5899c0483df5" ON "TelemetryException" ("telemetryServiceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e270eb229cd583c653c2176db9" ON "TelemetryException" ("fingerprint") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_3310c3a807a7e8bca9d1bd8e0eb" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_6470c69cb5f53c5899c0483df5f" FOREIGN KEY ("telemetryServiceId") REFERENCES "TelemetryService"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_d2e1b4f5dcaebbf14ed6cbd303d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_757f473e68b584bc42fcfbd9373" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_f7ec3f51dae2b4963cfb8fe5c46" FOREIGN KEY ("assignToUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_63221e8bd973ab71a49598d6c88" FOREIGN KEY ("assignToTeamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_10c7733499d5afa9b857f4a00c5" FOREIGN KEY ("markedAsResolvedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_199e3572d19b75e59f2082251f8" FOREIGN KEY ("markedAsMutedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_199e3572d19b75e59f2082251f8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_10c7733499d5afa9b857f4a00c5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_63221e8bd973ab71a49598d6c88"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_f7ec3f51dae2b4963cfb8fe5c46"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_757f473e68b584bc42fcfbd9373"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_d2e1b4f5dcaebbf14ed6cbd303d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_6470c69cb5f53c5899c0483df5f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_3310c3a807a7e8bca9d1bd8e0eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e270eb229cd583c653c2176db9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6470c69cb5f53c5899c0483df5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3310c3a807a7e8bca9d1bd8e0e"`,
    );
    await queryRunner.query(`DROP TABLE "TelemetryException"`);
  }
}
