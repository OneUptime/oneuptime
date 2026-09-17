import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769772215532 implements MigrationInterface {
  public name = "MigrationName1769772215532";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ProjectUserProfile" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "customFields" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_2fd2054e182a7603f7032745eb9" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3ba2d6a8eaeb966afa8820dbf0" ON "ProjectUserProfile" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_39df4735afea8ab70c00674575" ON "ProjectUserProfile" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "TeamMemberCustomField" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "customFieldType" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c0a4e92fd1fb77fe4cbb2f85ad4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e11389841b4ca122ec4a36c472" ON "TeamMemberCustomField" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserProfile" ADD CONSTRAINT "FK_3ba2d6a8eaeb966afa8820dbf0a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserProfile" ADD CONSTRAINT "FK_39df4735afea8ab70c006745752" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserProfile" ADD CONSTRAINT "FK_b9db61caf3923a882e09943f367" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserProfile" ADD CONSTRAINT "FK_5fe8245962849bde50687e2c707" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" ADD CONSTRAINT "FK_e11389841b4ca122ec4a36c4720" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" ADD CONSTRAINT "FK_5ea46786eae26e125d07bbfddfa" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" ADD CONSTRAINT "FK_35409d7ec1b559d4de58913e522" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" DROP CONSTRAINT "FK_35409d7ec1b559d4de58913e522"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" DROP CONSTRAINT "FK_5ea46786eae26e125d07bbfddfa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" DROP CONSTRAINT "FK_e11389841b4ca122ec4a36c4720"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserProfile" DROP CONSTRAINT "FK_5fe8245962849bde50687e2c707"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserProfile" DROP CONSTRAINT "FK_b9db61caf3923a882e09943f367"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserProfile" DROP CONSTRAINT "FK_39df4735afea8ab70c006745752"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserProfile" DROP CONSTRAINT "FK_3ba2d6a8eaeb966afa8820dbf0a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e11389841b4ca122ec4a36c472"`,
    );
    await queryRunner.query(`DROP TABLE "TeamMemberCustomField"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_39df4735afea8ab70c00674575"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3ba2d6a8eaeb966afa8820dbf0"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectUserProfile"`);
  }
}
