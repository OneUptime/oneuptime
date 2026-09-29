import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1768583966447 implements MigrationInterface {
  public name = "MigrationName1768583966447";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ProjectSCIMLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "projectScimId" uuid NOT NULL, "operationType" character varying(100) NOT NULL, "status" character varying(100) NOT NULL, "statusMessage" character varying(500), "logBody" text, "httpMethod" character varying(100), "requestPath" character varying(500), "httpStatusCode" integer, "affectedUserEmail" character varying(100), "affectedGroupName" character varying(100), "deletedByUserId" uuid, CONSTRAINT "PK_34ebb18e06358cda3a5fa42b7f5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd00098373b7d8e93bfefc91c6" ON "ProjectSCIMLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0724e5b4be4059cac2b15651e1" ON "ProjectSCIMLog" ("projectScimId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_df8b4cb02b89ef3f6ad29f8f9a" ON "ProjectSCIMLog" ("affectedUserEmail") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7799e790e5ea4949d0d6a91693" ON "ProjectSCIMLog" ("affectedGroupName") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StatusPageSCIMLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "statusPageId" uuid NOT NULL, "statusPageScimId" uuid NOT NULL, "operationType" character varying(100) NOT NULL, "status" character varying(100) NOT NULL, "statusMessage" character varying(500), "logBody" text, "httpMethod" character varying(100), "requestPath" character varying(500), "httpStatusCode" integer, "affectedUserEmail" character varying(100), "deletedByUserId" uuid, CONSTRAINT "PK_1f134bf6bb2c5821843fef09d8b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_471e2e23a7fac2347c349ab7aa" ON "StatusPageSCIMLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0578ea0d995fc31caec5307eee" ON "StatusPageSCIMLog" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28bda116a05cba76bd0ef09c21" ON "StatusPageSCIMLog" ("statusPageScimId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_719561fe6e01bc475e255b4a87" ON "StatusPageSCIMLog" ("affectedUserEmail") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMLog" ADD CONSTRAINT "FK_bd00098373b7d8e93bfefc91c6a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMLog" ADD CONSTRAINT "FK_0724e5b4be4059cac2b15651e19" FOREIGN KEY ("projectScimId") REFERENCES "ProjectSCIM"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMLog" ADD CONSTRAINT "FK_3a3dea844d9d75b76a2531294d2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIMLog" ADD CONSTRAINT "FK_471e2e23a7fac2347c349ab7aae" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIMLog" ADD CONSTRAINT "FK_0578ea0d995fc31caec5307eee2" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIMLog" ADD CONSTRAINT "FK_28bda116a05cba76bd0ef09c21c" FOREIGN KEY ("statusPageScimId") REFERENCES "StatusPageSCIM"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIMLog" ADD CONSTRAINT "FK_004a49a480f499f41c0afda2b01" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIMLog" DROP CONSTRAINT "FK_004a49a480f499f41c0afda2b01"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIMLog" DROP CONSTRAINT "FK_28bda116a05cba76bd0ef09c21c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIMLog" DROP CONSTRAINT "FK_0578ea0d995fc31caec5307eee2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIMLog" DROP CONSTRAINT "FK_471e2e23a7fac2347c349ab7aae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMLog" DROP CONSTRAINT "FK_3a3dea844d9d75b76a2531294d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMLog" DROP CONSTRAINT "FK_0724e5b4be4059cac2b15651e19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMLog" DROP CONSTRAINT "FK_bd00098373b7d8e93bfefc91c6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_719561fe6e01bc475e255b4a87"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_28bda116a05cba76bd0ef09c21"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0578ea0d995fc31caec5307eee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_471e2e23a7fac2347c349ab7aa"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageSCIMLog"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7799e790e5ea4949d0d6a91693"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_df8b4cb02b89ef3f6ad29f8f9a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0724e5b4be4059cac2b15651e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd00098373b7d8e93bfefc91c6"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectSCIMLog"`);
  }
}
