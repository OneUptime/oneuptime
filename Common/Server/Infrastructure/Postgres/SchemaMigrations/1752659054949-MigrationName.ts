import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1752659054949 implements MigrationInterface {
  public name = "MigrationName1752659054949";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserPush" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "deviceToken" character varying(500) NOT NULL, "deviceType" character varying(100) NOT NULL, "deviceName" character varying(100), "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, "isVerified" boolean NOT NULL DEFAULT false, "lastUsedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_bc3271178002ba8d92824d36db6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24d281c51868189d985c4a81cb" ON "UserPush" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_507f0b3fea4f091410f99d2170" ON "UserPush" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD "userPushId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "alertByPush" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e6d756cbda1e68aae728531269" ON "UserNotificationRule" ("userPushId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserPush" ADD CONSTRAINT "FK_24d281c51868189d985c4a81cb8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserPush" ADD CONSTRAINT "FK_507f0b3fea4f091410f99d2170a" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserPush" ADD CONSTRAINT "FK_2d2819503cd8a8517e9ce502bd8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserPush" ADD CONSTRAINT "FK_964b240ccbb12a9a8c947272540" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_e6d756cbda1e68aae7285312694" FOREIGN KEY ("userPushId") REFERENCES "UserPush"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_e6d756cbda1e68aae7285312694"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserPush" DROP CONSTRAINT "FK_964b240ccbb12a9a8c947272540"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserPush" DROP CONSTRAINT "FK_2d2819503cd8a8517e9ce502bd8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserPush" DROP CONSTRAINT "FK_507f0b3fea4f091410f99d2170a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserPush" DROP CONSTRAINT "FK_24d281c51868189d985c4a81cb8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e6d756cbda1e68aae728531269"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByPush"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "userPushId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_507f0b3fea4f091410f99d2170"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24d281c51868189d985c4a81cb"`,
    );
    await queryRunner.query(`DROP TABLE "UserPush"`);
  }
}
