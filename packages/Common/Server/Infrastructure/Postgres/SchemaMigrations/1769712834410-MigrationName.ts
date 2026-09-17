import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769712834410 implements MigrationInterface {
  public name = "MigrationName1769712834410";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentRole" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, "color" character varying(10) NOT NULL, CONSTRAINT "PK_372270d60fac535c07c635b7796" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45b1590e55eec2f941af527fbd" ON "IncidentRole" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentMember" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "incidentId" uuid NOT NULL, "incidentRoleId" uuid NOT NULL, "startsAt" TIMESTAMP WITH TIME ZONE, "endsAt" TIMESTAMP WITH TIME ZONE, "notes" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_052d57e9e08c9d9f0fc237c620e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8480c759999c55038e3bca732b" ON "IncidentMember" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e3b387fb6d5fedfd39794909eb" ON "IncidentMember" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_652e181523fa7ba5c037c4eb8d" ON "IncidentMember" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6e8334ec5b25d596548c88d083" ON "IncidentMember" ("incidentRoleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c347aea8f6f70b4ea27a1cf40b" ON "IncidentMember" ("incidentId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" ADD CONSTRAINT "FK_45b1590e55eec2f941af527fbd0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" ADD CONSTRAINT "FK_03d983341743218aa455c9cb897" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" ADD CONSTRAINT "FK_ca13ae495a9a6412995e2e123f7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" ADD CONSTRAINT "FK_8480c759999c55038e3bca732b3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" ADD CONSTRAINT "FK_e3b387fb6d5fedfd39794909eb5" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" ADD CONSTRAINT "FK_652e181523fa7ba5c037c4eb8dd" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" ADD CONSTRAINT "FK_6e8334ec5b25d596548c88d0832" FOREIGN KEY ("incidentRoleId") REFERENCES "IncidentRole"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" ADD CONSTRAINT "FK_bbcd6caa5ecb3a2331e030f548c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" ADD CONSTRAINT "FK_d4fa23e478940bab6bbcfd556b8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" DROP CONSTRAINT "FK_d4fa23e478940bab6bbcfd556b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" DROP CONSTRAINT "FK_bbcd6caa5ecb3a2331e030f548c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" DROP CONSTRAINT "FK_6e8334ec5b25d596548c88d0832"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" DROP CONSTRAINT "FK_652e181523fa7ba5c037c4eb8dd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" DROP CONSTRAINT "FK_e3b387fb6d5fedfd39794909eb5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" DROP CONSTRAINT "FK_8480c759999c55038e3bca732b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" DROP CONSTRAINT "FK_ca13ae495a9a6412995e2e123f7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" DROP CONSTRAINT "FK_03d983341743218aa455c9cb897"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" DROP CONSTRAINT "FK_45b1590e55eec2f941af527fbd0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c347aea8f6f70b4ea27a1cf40b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e8334ec5b25d596548c88d083"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_652e181523fa7ba5c037c4eb8d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e3b387fb6d5fedfd39794909eb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8480c759999c55038e3bca732b"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentMember"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_45b1590e55eec2f941af527fbd"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentRole"`);
  }
}
