import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProjectOIDC1778506655291 implements MigrationInterface {
  public name = "AddProjectOIDC1778506655291";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ProjectOIDC" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying NOT NULL, "discoveryURL" text NOT NULL, "issuerURL" text NOT NULL, "clientId" character varying(100) NOT NULL, "clientSecret" character varying NOT NULL, "scopes" character varying(100) NOT NULL, "emailClaimName" character varying(100) NOT NULL, "nameClaimName" character varying(100) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isEnabled" boolean NOT NULL DEFAULT false, "isTested" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_22abf8119bac3f7f4f9f03b201f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b5b93c3e2885549c370b816194" ON "ProjectOIDC" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ProjectOidcTeam" ("projectOidcId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_bdae022f28d23653e2aa4a40abb" PRIMARY KEY ("projectOidcId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8c317a3effac6698ad8dfbc82d" ON "ProjectOidcTeam" ("projectOidcId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_456cebe2924528d694b29f91bc" ON "ProjectOidcTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOIDC" ADD CONSTRAINT "FK_b5b93c3e2885549c370b8161940" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOIDC" ADD CONSTRAINT "FK_df47207e1005bef42ca062f7a4b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOIDC" ADD CONSTRAINT "FK_3f386ff54e38e36f4c016187648" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOidcTeam" ADD CONSTRAINT "FK_8c317a3effac6698ad8dfbc82d4" FOREIGN KEY ("projectOidcId") REFERENCES "ProjectOIDC"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOidcTeam" ADD CONSTRAINT "FK_456cebe2924528d694b29f91bc9" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectOidcTeam" DROP CONSTRAINT "FK_456cebe2924528d694b29f91bc9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOidcTeam" DROP CONSTRAINT "FK_8c317a3effac6698ad8dfbc82d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOIDC" DROP CONSTRAINT "FK_3f386ff54e38e36f4c016187648"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOIDC" DROP CONSTRAINT "FK_df47207e1005bef42ca062f7a4b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOIDC" DROP CONSTRAINT "FK_b5b93c3e2885549c370b8161940"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_456cebe2924528d694b29f91bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8c317a3effac6698ad8dfbc82d"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectOidcTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b5b93c3e2885549c370b816194"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectOIDC"`);
  }
}
