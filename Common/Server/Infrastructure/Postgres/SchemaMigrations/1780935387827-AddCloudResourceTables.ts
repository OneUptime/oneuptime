import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Phase 2: Cloud platform compute resource type. Creates the CloudResource
 * resource table, its owner-user / owner-team tables, and the label join
 * table — mirroring the ServerlessFunction shape so the polymorphic telemetry
 * serviceId can point at a CloudResource row.
 */
export class AddCloudResourceTables1780935387827 implements MigrationInterface {
  public name = "AddCloudResourceTables1780935387827";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "resourceIdentifier" character varying(100) NOT NULL, "cloudPlatform" character varying(100), "cloudProvider" character varying(100), "cloudRegion" character varying(100), "cloudAccountId" character varying(100), "runtimeName" character varying(100), "runtimeVersion" character varying(100), "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "agentVersion" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_CloudResource" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResource_projectId" ON "CloudResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_CloudResource_project_resId" ON "CloudResource" ("projectId", "resourceIdentifier") `,
    );

    await queryRunner.query(
      `CREATE TABLE "CloudResourceOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_CloudResourceOwnerTeam" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResOwnerTeam_projectId" ON "CloudResourceOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResOwnerTeam_teamId" ON "CloudResourceOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResOwnerTeam_resId" ON "CloudResourceOwnerTeam" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResOwnerTeam_notified" ON "CloudResourceOwnerTeam" ("isOwnerNotified") `,
    );

    await queryRunner.query(
      `CREATE TABLE "CloudResourceOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_CloudResourceOwnerUser" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResOwnerUser_projectId" ON "CloudResourceOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResOwnerUser_userId" ON "CloudResourceOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResOwnerUser_resId" ON "CloudResourceOwnerUser" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResOwnerUser_notified" ON "CloudResourceOwnerUser" ("isOwnerNotified") `,
    );

    await queryRunner.query(
      `CREATE TABLE "CloudResourceLabel" ("cloudResourceId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_CloudResourceLabel" PRIMARY KEY ("cloudResourceId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResourceLabel_resId" ON "CloudResourceLabel" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResourceLabel_labelId" ON "CloudResourceLabel" ("labelId") `,
    );

    // Foreign keys: CloudResource
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD CONSTRAINT "FK_CloudResource_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD CONSTRAINT "FK_CloudResource_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD CONSTRAINT "FK_CloudResource_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: CloudResourceOwnerTeam
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerTeam" ADD CONSTRAINT "FK_CloudResOwnerTeam_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerTeam" ADD CONSTRAINT "FK_CloudResOwnerTeam_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerTeam" ADD CONSTRAINT "FK_CloudResOwnerTeam_resId" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerTeam" ADD CONSTRAINT "FK_CloudResOwnerTeam_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerTeam" ADD CONSTRAINT "FK_CloudResOwnerTeam_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: CloudResourceOwnerUser
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerUser" ADD CONSTRAINT "FK_CloudResOwnerUser_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerUser" ADD CONSTRAINT "FK_CloudResOwnerUser_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerUser" ADD CONSTRAINT "FK_CloudResOwnerUser_resId" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerUser" ADD CONSTRAINT "FK_CloudResOwnerUser_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerUser" ADD CONSTRAINT "FK_CloudResOwnerUser_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: CloudResourceLabel join table
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabel" ADD CONSTRAINT "FK_CloudResourceLabel_resId" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabel" ADD CONSTRAINT "FK_CloudResourceLabel_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabel" DROP CONSTRAINT "FK_CloudResourceLabel_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabel" DROP CONSTRAINT "FK_CloudResourceLabel_resId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerUser" DROP CONSTRAINT "FK_CloudResOwnerUser_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerUser" DROP CONSTRAINT "FK_CloudResOwnerUser_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerUser" DROP CONSTRAINT "FK_CloudResOwnerUser_resId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerUser" DROP CONSTRAINT "FK_CloudResOwnerUser_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerUser" DROP CONSTRAINT "FK_CloudResOwnerUser_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerTeam" DROP CONSTRAINT "FK_CloudResOwnerTeam_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerTeam" DROP CONSTRAINT "FK_CloudResOwnerTeam_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerTeam" DROP CONSTRAINT "FK_CloudResOwnerTeam_resId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerTeam" DROP CONSTRAINT "FK_CloudResOwnerTeam_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerTeam" DROP CONSTRAINT "FK_CloudResOwnerTeam_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP CONSTRAINT "FK_CloudResource_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP CONSTRAINT "FK_CloudResource_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP CONSTRAINT "FK_CloudResource_projectId"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_CloudResourceLabel_labelId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_CloudResourceLabel_resId"`);
    await queryRunner.query(`DROP TABLE "CloudResourceLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_CloudResOwnerUser_notified"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_CloudResOwnerUser_resId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_CloudResOwnerUser_userId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_CloudResOwnerUser_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "CloudResourceOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_CloudResOwnerTeam_notified"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_CloudResOwnerTeam_resId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_CloudResOwnerTeam_teamId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_CloudResOwnerTeam_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "CloudResourceOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_CloudResource_project_resId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_CloudResource_projectId"`);
    await queryRunner.query(`DROP TABLE "CloudResource"`);
  }
}
