import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1766754182870 implements MigrationInterface {
  name = "MigrationName1766754182870";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AIAgentTaskTelemetryException" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "aiAgentTaskId" uuid NOT NULL, "telemetryExceptionId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_83fcb4f4cefaa15c024e9b67509" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f3c6679e1b584abf3bf32d8b29" ON "AIAgentTaskTelemetryException" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db7e9c49d02e475240f643fdd6" ON "AIAgentTaskTelemetryException" ("aiAgentTaskId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_20bed0f07b86ae84616567a6c7" ON "AIAgentTaskTelemetryException" ("telemetryExceptionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskTelemetryException" ADD CONSTRAINT "FK_f3c6679e1b584abf3bf32d8b294" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskTelemetryException" ADD CONSTRAINT "FK_db7e9c49d02e475240f643fdd6a" FOREIGN KEY ("aiAgentTaskId") REFERENCES "AIAgentTask"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskTelemetryException" ADD CONSTRAINT "FK_20bed0f07b86ae84616567a6c71" FOREIGN KEY ("telemetryExceptionId") REFERENCES "TelemetryException"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskTelemetryException" ADD CONSTRAINT "FK_a9d0100fe62231694441d5757d8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskTelemetryException" ADD CONSTRAINT "FK_eb913bd67e00d8eff18094c525d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskTelemetryException" DROP CONSTRAINT "FK_eb913bd67e00d8eff18094c525d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskTelemetryException" DROP CONSTRAINT "FK_a9d0100fe62231694441d5757d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskTelemetryException" DROP CONSTRAINT "FK_20bed0f07b86ae84616567a6c71"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskTelemetryException" DROP CONSTRAINT "FK_db7e9c49d02e475240f643fdd6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskTelemetryException" DROP CONSTRAINT "FK_f3c6679e1b584abf3bf32d8b294"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_20bed0f07b86ae84616567a6c7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db7e9c49d02e475240f643fdd6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f3c6679e1b584abf3bf32d8b29"`,
    );
    await queryRunner.query(`DROP TABLE "AIAgentTaskTelemetryException"`);
  }
}
