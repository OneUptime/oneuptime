import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1724607603707 implements MigrationInterface {
    public name = 'MigrationName1724607603707'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "TelemetryExceptionStatus" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "telemetryServiceId" uuid NOT NULL, "message" character varying, "stackTrace" character varying, "exceptionType" character varying, "fingerPrint" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, "markedAsResolvedAt" TIMESTAMP WITH TIME ZONE, "markedAsMutedAt" TIMESTAMP WITH TIME ZONE, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "assignToUserId" uuid, "assignToTeamId" uuid, "markedAsResolvedByUserId" uuid, "markedAsMutedByUserId" uuid, CONSTRAINT "PK_8db287c0fc7516e22d53876137c" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7c02d07bf73bfdac7301a6c86d" ON "TelemetryExceptionStatus" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_0f66442452b5a89efa085ede0f" ON "TelemetryExceptionStatus" ("telemetryServiceId") `);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" ADD CONSTRAINT "FK_7c02d07bf73bfdac7301a6c86d5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" ADD CONSTRAINT "FK_0f66442452b5a89efa085ede0fd" FOREIGN KEY ("telemetryServiceId") REFERENCES "TelemetryService"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" ADD CONSTRAINT "FK_fe9e43b2cf2278894f9fe67c92f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" ADD CONSTRAINT "FK_3b402ffb6fe47992c38f4cd5e7a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" ADD CONSTRAINT "FK_88a1d97d74c54cd80b384f2a911" FOREIGN KEY ("assignToUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" ADD CONSTRAINT "FK_1c8cc9368c92f60cb093af277f8" FOREIGN KEY ("assignToTeamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" ADD CONSTRAINT "FK_fe156e1dce6bdae3f349d33e293" FOREIGN KEY ("markedAsResolvedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" ADD CONSTRAINT "FK_9d7647bf6d537f5afbd00ef4a8b" FOREIGN KEY ("markedAsMutedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" DROP CONSTRAINT "FK_9d7647bf6d537f5afbd00ef4a8b"`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" DROP CONSTRAINT "FK_fe156e1dce6bdae3f349d33e293"`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" DROP CONSTRAINT "FK_1c8cc9368c92f60cb093af277f8"`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" DROP CONSTRAINT "FK_88a1d97d74c54cd80b384f2a911"`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" DROP CONSTRAINT "FK_3b402ffb6fe47992c38f4cd5e7a"`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" DROP CONSTRAINT "FK_fe9e43b2cf2278894f9fe67c92f"`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" DROP CONSTRAINT "FK_0f66442452b5a89efa085ede0fd"`);
        await queryRunner.query(`ALTER TABLE "TelemetryExceptionStatus" DROP CONSTRAINT "FK_7c02d07bf73bfdac7301a6c86d5"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0f66442452b5a89efa085ede0f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7c02d07bf73bfdac7301a6c86d"`);
        await queryRunner.query(`DROP TABLE "TelemetryExceptionStatus"`);
    }

}
