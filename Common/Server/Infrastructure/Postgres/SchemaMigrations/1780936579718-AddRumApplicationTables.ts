import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Phase 3: Browser / Mobile RUM resource type. Creates the RumApplication
 * resource table, its owner-user / owner-team tables, and the label join
 * table — mirroring the other telemetry-resource shapes so the polymorphic
 * telemetry serviceId can point at a RumApplication row. RUM is keyed per
 * application (service.name), never per end-user device.
 */
export class AddRumApplicationTables1780936579718
  implements MigrationInterface
{
  public name = "AddRumApplicationTables1780936579718";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RumApplication" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "appIdentifier" character varying(100) NOT NULL, "clientType" character varying(100), "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "agentVersion" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_RumApplication" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumApplication_projectId" ON "RumApplication" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_RumApplication_project_appId" ON "RumApplication" ("projectId", "appIdentifier") `,
    );

    await queryRunner.query(
      `CREATE TABLE "RumApplicationOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "rumApplicationId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_RumApplicationOwnerTeam" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppOwnerTeam_projectId" ON "RumApplicationOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppOwnerTeam_teamId" ON "RumApplicationOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppOwnerTeam_appId" ON "RumApplicationOwnerTeam" ("rumApplicationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppOwnerTeam_notified" ON "RumApplicationOwnerTeam" ("isOwnerNotified") `,
    );

    await queryRunner.query(
      `CREATE TABLE "RumApplicationOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "rumApplicationId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_RumApplicationOwnerUser" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppOwnerUser_projectId" ON "RumApplicationOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppOwnerUser_userId" ON "RumApplicationOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppOwnerUser_appId" ON "RumApplicationOwnerUser" ("rumApplicationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppOwnerUser_notified" ON "RumApplicationOwnerUser" ("isOwnerNotified") `,
    );

    await queryRunner.query(
      `CREATE TABLE "RumApplicationLabel" ("rumApplicationId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_RumApplicationLabel" PRIMARY KEY ("rumApplicationId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumApplicationLabel_appId" ON "RumApplicationLabel" ("rumApplicationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumApplicationLabel_labelId" ON "RumApplicationLabel" ("labelId") `,
    );

    // Foreign keys: RumApplication
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD CONSTRAINT "FK_RumApplication_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD CONSTRAINT "FK_RumApplication_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD CONSTRAINT "FK_RumApplication_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: RumApplicationOwnerTeam
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerTeam" ADD CONSTRAINT "FK_RumAppOwnerTeam_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerTeam" ADD CONSTRAINT "FK_RumAppOwnerTeam_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerTeam" ADD CONSTRAINT "FK_RumAppOwnerTeam_appId" FOREIGN KEY ("rumApplicationId") REFERENCES "RumApplication"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerTeam" ADD CONSTRAINT "FK_RumAppOwnerTeam_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerTeam" ADD CONSTRAINT "FK_RumAppOwnerTeam_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: RumApplicationOwnerUser
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerUser" ADD CONSTRAINT "FK_RumAppOwnerUser_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerUser" ADD CONSTRAINT "FK_RumAppOwnerUser_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerUser" ADD CONSTRAINT "FK_RumAppOwnerUser_appId" FOREIGN KEY ("rumApplicationId") REFERENCES "RumApplication"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerUser" ADD CONSTRAINT "FK_RumAppOwnerUser_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerUser" ADD CONSTRAINT "FK_RumAppOwnerUser_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: RumApplicationLabel join table
    await queryRunner.query(
      `ALTER TABLE "RumApplicationLabel" ADD CONSTRAINT "FK_RumApplicationLabel_appId" FOREIGN KEY ("rumApplicationId") REFERENCES "RumApplication"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationLabel" ADD CONSTRAINT "FK_RumApplicationLabel_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplicationLabel" DROP CONSTRAINT "FK_RumApplicationLabel_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationLabel" DROP CONSTRAINT "FK_RumApplicationLabel_appId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerUser" DROP CONSTRAINT "FK_RumAppOwnerUser_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerUser" DROP CONSTRAINT "FK_RumAppOwnerUser_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerUser" DROP CONSTRAINT "FK_RumAppOwnerUser_appId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerUser" DROP CONSTRAINT "FK_RumAppOwnerUser_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerUser" DROP CONSTRAINT "FK_RumAppOwnerUser_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerTeam" DROP CONSTRAINT "FK_RumAppOwnerTeam_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerTeam" DROP CONSTRAINT "FK_RumAppOwnerTeam_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerTeam" DROP CONSTRAINT "FK_RumAppOwnerTeam_appId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerTeam" DROP CONSTRAINT "FK_RumAppOwnerTeam_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerTeam" DROP CONSTRAINT "FK_RumAppOwnerTeam_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP CONSTRAINT "FK_RumApplication_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP CONSTRAINT "FK_RumApplication_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP CONSTRAINT "FK_RumApplication_projectId"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_RumApplicationLabel_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_RumApplicationLabel_appId"`,
    );
    await queryRunner.query(`DROP TABLE "RumApplicationLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_RumAppOwnerUser_notified"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_RumAppOwnerUser_appId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_RumAppOwnerUser_userId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_RumAppOwnerUser_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "RumApplicationOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_RumAppOwnerTeam_notified"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_RumAppOwnerTeam_appId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_RumAppOwnerTeam_teamId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_RumAppOwnerTeam_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "RumApplicationOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_RumApplication_project_appId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_RumApplication_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "RumApplication"`);
  }
}
