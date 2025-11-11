import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1762890441920 implements MigrationInterface {
    public name = 'MigrationName1762890441920'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "StatusPagePrivateUserSession" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "statusPageId" uuid NOT NULL, "statusPagePrivateUserId" uuid NOT NULL, "refreshToken" character varying(64) NOT NULL, "refreshTokenExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastActiveAt" TIMESTAMP WITH TIME ZONE, "deviceName" character varying(100), "deviceType" character varying(100), "deviceOS" character varying(100), "deviceBrowser" character varying(100), "ipAddress" character varying(100), "userAgent" text, "isRevoked" boolean NOT NULL DEFAULT false, "revokedAt" TIMESTAMP WITH TIME ZONE, "revokedReason" character varying(100), "additionalInfo" jsonb, CONSTRAINT "UQ_12ce827a16d121bf6719260b8a9" UNIQUE ("refreshToken"), CONSTRAINT "PK_cbace84fe4c9712b94e571dc133" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ac5f4c13d6bc9696cbfb8e5a79" ON "StatusPagePrivateUserSession" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_7b8d9b6e068c045d56b47a484b" ON "StatusPagePrivateUserSession" ("statusPageId") `);
        await queryRunner.query(`CREATE INDEX "IDX_365d602943505272f8f651ff4e" ON "StatusPagePrivateUserSession" ("statusPagePrivateUserId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_12ce827a16d121bf6719260b8a" ON "StatusPagePrivateUserSession" ("refreshToken") `);
        await queryRunner.query(`CREATE TABLE "UserSession" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "userId" uuid NOT NULL, "refreshToken" character varying(64) NOT NULL, "refreshTokenExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastActiveAt" TIMESTAMP WITH TIME ZONE, "deviceName" character varying(100), "deviceType" character varying(100), "deviceOS" character varying(100), "deviceBrowser" character varying(100), "ipAddress" character varying(100), "userAgent" text, "isRevoked" boolean NOT NULL DEFAULT false, "revokedAt" TIMESTAMP WITH TIME ZONE, "revokedReason" character varying(100), "additionalInfo" jsonb, CONSTRAINT "UQ_d66bd8342b0005c7192bdb17efc" UNIQUE ("refreshToken"), CONSTRAINT "PK_9dcd180f25755bab5fcebcbeb14" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7353eaf92987aeaf38c2590e94" ON "UserSession" ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d66bd8342b0005c7192bdb17ef" ON "UserSession" ("refreshToken") `);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "StatusPagePrivateUserSession" ADD CONSTRAINT "FK_ac5f4c13d6bc9696cbfb8e5a794" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "StatusPagePrivateUserSession" ADD CONSTRAINT "FK_7b8d9b6e068c045d56b47a484be" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "StatusPagePrivateUserSession" ADD CONSTRAINT "FK_365d602943505272f8f651ff4e8" FOREIGN KEY ("statusPagePrivateUserId") REFERENCES "StatusPagePrivateUser"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserSession" ADD CONSTRAINT "FK_7353eaf92987aeaf38c2590e943" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "UserSession" DROP CONSTRAINT "FK_7353eaf92987aeaf38c2590e943"`);
        await queryRunner.query(`ALTER TABLE "StatusPagePrivateUserSession" DROP CONSTRAINT "FK_365d602943505272f8f651ff4e8"`);
        await queryRunner.query(`ALTER TABLE "StatusPagePrivateUserSession" DROP CONSTRAINT "FK_7b8d9b6e068c045d56b47a484be"`);
        await queryRunner.query(`ALTER TABLE "StatusPagePrivateUserSession" DROP CONSTRAINT "FK_ac5f4c13d6bc9696cbfb8e5a794"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d66bd8342b0005c7192bdb17ef"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7353eaf92987aeaf38c2590e94"`);
        await queryRunner.query(`DROP TABLE "UserSession"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_12ce827a16d121bf6719260b8a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_365d602943505272f8f651ff4e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7b8d9b6e068c045d56b47a484b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ac5f4c13d6bc9696cbfb8e5a79"`);
        await queryRunner.query(`DROP TABLE "StatusPagePrivateUserSession"`);
    }

}
