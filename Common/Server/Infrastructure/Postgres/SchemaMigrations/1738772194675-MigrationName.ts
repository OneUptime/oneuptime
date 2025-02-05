import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1738772194675 implements MigrationInterface {
  public name = "MigrationName1738772194675";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceProviderUserAuthToken" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "authToken" text NOT NULL, "serviceProviderUserId" character varying(500) NOT NULL, "serviceProviderType" character varying(500) NOT NULL, "miscData" jsonb NOT NULL, "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_d16320dcfcb0ebb0c340e888507" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ee9d305ca2fe8d488d2a62427e" ON "ServiceProviderUserAuthToken" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d822e61467a94b8f369df4faed" ON "ServiceProviderUserAuthToken" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceProviderProjectAuthToken" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "authToken" text NOT NULL, "serviceProviderType" character varying(500) NOT NULL, "serviceProviderProjectId" character varying(500) NOT NULL, "miscData" jsonb NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_4f1e7a83253e520ab31d81596f0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41ed33a7df1d96aa9a29b4c568" ON "ServiceProviderProjectAuthToken" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" ADD CONSTRAINT "FK_ee9d305ca2fe8d488d2a62427e5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" ADD CONSTRAINT "FK_d822e61467a94b8f369df4faed0" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" ADD CONSTRAINT "FK_539084afd2895cf223b4d434827" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" ADD CONSTRAINT "FK_32d31d8a370a31cb02619b47c9b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" ADD CONSTRAINT "FK_41ed33a7df1d96aa9a29b4c568f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" ADD CONSTRAINT "FK_90d33ae3ffafc76bfaf5308292c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" ADD CONSTRAINT "FK_efdf4b9a3b0dc87a9bc9ed99746" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" DROP CONSTRAINT "FK_efdf4b9a3b0dc87a9bc9ed99746"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" DROP CONSTRAINT "FK_90d33ae3ffafc76bfaf5308292c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderProjectAuthToken" DROP CONSTRAINT "FK_41ed33a7df1d96aa9a29b4c568f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" DROP CONSTRAINT "FK_32d31d8a370a31cb02619b47c9b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" DROP CONSTRAINT "FK_539084afd2895cf223b4d434827"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" DROP CONSTRAINT "FK_d822e61467a94b8f369df4faed0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderUserAuthToken" DROP CONSTRAINT "FK_ee9d305ca2fe8d488d2a62427e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_41ed33a7df1d96aa9a29b4c568"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceProviderProjectAuthToken"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d822e61467a94b8f369df4faed"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ee9d305ca2fe8d488d2a62427e"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceProviderUserAuthToken"`);
  }
}
