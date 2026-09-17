import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1739209832500 implements MigrationInterface {
  public name = "MigrationName1739209832500";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "WorkspaceUserAuthToken" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "authToken" text NOT NULL, "workspaceUserId" character varying(500) NOT NULL, "workspaceType" character varying(500) NOT NULL, "miscData" jsonb NOT NULL, "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_ae2f1b46b7e26f58a1f4a56b6ea" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bee888f5782b9585e01f13455f" ON "WorkspaceUserAuthToken" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4b7c7d1a8b2259df8c790db094" ON "WorkspaceUserAuthToken" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkspaceProjectAuthToken" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "authToken" text NOT NULL, "workspaceType" character varying(500) NOT NULL, "workspaceProjectId" character varying(500) NOT NULL, "miscData" jsonb NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c0caa6a69da614ee74d8c1291da" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_73f5887268b09c0abccf04ef02" ON "WorkspaceProjectAuthToken" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkspaceSetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "settings" jsonb NOT NULL, "workspaceType" character varying(500) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_eb98d42edd6489fbe1cf3f34515" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c68f38e2b2b061c40209e85bf2" ON "WorkspaceSetting" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkspaceNotificationRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(500) NOT NULL, "description" character varying(500), "notificationRule" jsonb NOT NULL, "eventType" character varying NOT NULL, "workspaceType" character varying(500) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_d1485681c7695ac9841dc52a451" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_349b022afa9a50a597d6c91ec9" ON "WorkspaceNotificationRule" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserAuthToken" ADD CONSTRAINT "FK_bee888f5782b9585e01f13455fb" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserAuthToken" ADD CONSTRAINT "FK_4b7c7d1a8b2259df8c790db0940" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserAuthToken" ADD CONSTRAINT "FK_ec5cbf4536681fe4bea883c98ea" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserAuthToken" ADD CONSTRAINT "FK_1b2cb71eaf9e665e4556d1b1263" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceProjectAuthToken" ADD CONSTRAINT "FK_73f5887268b09c0abccf04ef02e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceProjectAuthToken" ADD CONSTRAINT "FK_8aa5804c7a728039564bf5d967d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceProjectAuthToken" ADD CONSTRAINT "FK_6287095997a16f1cbdd4fb24b61" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceSetting" ADD CONSTRAINT "FK_c68f38e2b2b061c40209e85bf22" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceSetting" ADD CONSTRAINT "FK_c8fdd61b95bfd0a2ca268b8c602" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceSetting" ADD CONSTRAINT "FK_cb3b7931417a4b4ee05d487b614" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationRule" ADD CONSTRAINT "FK_349b022afa9a50a597d6c91ec95" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationRule" ADD CONSTRAINT "FK_55f4e43427fc217ed32cf640a28" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationRule" ADD CONSTRAINT "FK_65ac673d16286be2dcd5229fe24" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationRule" DROP CONSTRAINT "FK_65ac673d16286be2dcd5229fe24"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationRule" DROP CONSTRAINT "FK_55f4e43427fc217ed32cf640a28"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationRule" DROP CONSTRAINT "FK_349b022afa9a50a597d6c91ec95"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceSetting" DROP CONSTRAINT "FK_cb3b7931417a4b4ee05d487b614"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceSetting" DROP CONSTRAINT "FK_c8fdd61b95bfd0a2ca268b8c602"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceSetting" DROP CONSTRAINT "FK_c68f38e2b2b061c40209e85bf22"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceProjectAuthToken" DROP CONSTRAINT "FK_6287095997a16f1cbdd4fb24b61"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceProjectAuthToken" DROP CONSTRAINT "FK_8aa5804c7a728039564bf5d967d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceProjectAuthToken" DROP CONSTRAINT "FK_73f5887268b09c0abccf04ef02e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserAuthToken" DROP CONSTRAINT "FK_1b2cb71eaf9e665e4556d1b1263"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserAuthToken" DROP CONSTRAINT "FK_ec5cbf4536681fe4bea883c98ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserAuthToken" DROP CONSTRAINT "FK_4b7c7d1a8b2259df8c790db0940"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserAuthToken" DROP CONSTRAINT "FK_bee888f5782b9585e01f13455fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_349b022afa9a50a597d6c91ec9"`,
    );
    await queryRunner.query(`DROP TABLE "WorkspaceNotificationRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c68f38e2b2b061c40209e85bf2"`,
    );
    await queryRunner.query(`DROP TABLE "WorkspaceSetting"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_73f5887268b09c0abccf04ef02"`,
    );
    await queryRunner.query(`DROP TABLE "WorkspaceProjectAuthToken"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4b7c7d1a8b2259df8c790db094"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bee888f5782b9585e01f13455f"`,
    );
    await queryRunner.query(`DROP TABLE "WorkspaceUserAuthToken"`);
  }
}
