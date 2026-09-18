import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStatusPageOIDC1778522070962 implements MigrationInterface {
  public name = "AddStatusPageOIDC1778522070962";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "StatusPageOIDC" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "statusPageId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying NOT NULL, "discoveryURL" text NOT NULL, "issuerURL" text NOT NULL, "clientId" character varying(100) NOT NULL, "clientSecret" character varying NOT NULL, "scopes" character varying(100) NOT NULL, "emailClaimName" character varying(100) NOT NULL, "nameClaimName" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, "isEnabled" boolean NOT NULL DEFAULT false, "isTested" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_d48cc7131b1383a0c293e1142f4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da08a1ff289745767b094724f7" ON "StatusPageOIDC" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_13c9b134ba46772392bdfb760f" ON "StatusPageOIDC" ("statusPageId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOIDC" ADD CONSTRAINT "FK_da08a1ff289745767b094724f79" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOIDC" ADD CONSTRAINT "FK_13c9b134ba46772392bdfb760fd" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOIDC" ADD CONSTRAINT "FK_8e3b6fea29c79c99389893961f1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOIDC" ADD CONSTRAINT "FK_47054926e3844c88872599d5d55" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageOIDC" DROP CONSTRAINT "FK_47054926e3844c88872599d5d55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOIDC" DROP CONSTRAINT "FK_8e3b6fea29c79c99389893961f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOIDC" DROP CONSTRAINT "FK_13c9b134ba46772392bdfb760fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOIDC" DROP CONSTRAINT "FK_da08a1ff289745767b094724f79"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_13c9b134ba46772392bdfb760f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_da08a1ff289745767b094724f7"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageOIDC"`);
  }
}
