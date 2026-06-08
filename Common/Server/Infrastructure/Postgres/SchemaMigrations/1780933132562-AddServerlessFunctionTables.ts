import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Phase 1: Serverless / FaaS resource type. Creates the ServerlessFunction
 * resource table, its owner-user / owner-team tables, and the label join
 * table — mirroring the Host/DockerHost/KubernetesCluster shape so the
 * polymorphic telemetry serviceId can point at a ServerlessFunction row.
 */
export class AddServerlessFunctionTables1780933132562
  implements MigrationInterface
{
  public name = "AddServerlessFunctionTables1780933132562";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServerlessFunction" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "functionIdentifier" character varying(100) NOT NULL, "cloudPlatform" character varying(100), "cloudProvider" character varying(100), "cloudRegion" character varying(100), "cloudAccountId" character varying(100), "functionVersion" character varying(100), "runtimeName" character varying(100), "runtimeVersion" character varying(100), "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "agentVersion" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_ServerlessFunction" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ServerlessFunction_projectId" ON "ServerlessFunction" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ServerlessFunction_project_fnId" ON "ServerlessFunction" ("projectId", "functionIdentifier") `,
    );

    await queryRunner.query(
      `CREATE TABLE "ServerlessFunctionOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "serverlessFunctionId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_ServerlessFunctionOwnerTeam" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnOwnerTeam_projectId" ON "ServerlessFunctionOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnOwnerTeam_teamId" ON "ServerlessFunctionOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnOwnerTeam_fnId" ON "ServerlessFunctionOwnerTeam" ("serverlessFunctionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnOwnerTeam_notified" ON "ServerlessFunctionOwnerTeam" ("isOwnerNotified") `,
    );

    await queryRunner.query(
      `CREATE TABLE "ServerlessFunctionOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "serverlessFunctionId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_ServerlessFunctionOwnerUser" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnOwnerUser_projectId" ON "ServerlessFunctionOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnOwnerUser_userId" ON "ServerlessFunctionOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnOwnerUser_fnId" ON "ServerlessFunctionOwnerUser" ("serverlessFunctionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnOwnerUser_notified" ON "ServerlessFunctionOwnerUser" ("isOwnerNotified") `,
    );

    await queryRunner.query(
      `CREATE TABLE "ServerlessFunctionLabel" ("serverlessFunctionId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ServerlessFunctionLabel" PRIMARY KEY ("serverlessFunctionId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ServerlessFunctionLabel_fnId" ON "ServerlessFunctionLabel" ("serverlessFunctionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ServerlessFunctionLabel_labelId" ON "ServerlessFunctionLabel" ("labelId") `,
    );

    // Foreign keys: ServerlessFunction
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunction" ADD CONSTRAINT "FK_ServerlessFunction_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunction" ADD CONSTRAINT "FK_ServerlessFunction_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunction" ADD CONSTRAINT "FK_ServerlessFunction_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: ServerlessFunctionOwnerTeam
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerTeam" ADD CONSTRAINT "FK_SrvlessFnOwnerTeam_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerTeam" ADD CONSTRAINT "FK_SrvlessFnOwnerTeam_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerTeam" ADD CONSTRAINT "FK_SrvlessFnOwnerTeam_fnId" FOREIGN KEY ("serverlessFunctionId") REFERENCES "ServerlessFunction"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerTeam" ADD CONSTRAINT "FK_SrvlessFnOwnerTeam_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerTeam" ADD CONSTRAINT "FK_SrvlessFnOwnerTeam_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: ServerlessFunctionOwnerUser
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerUser" ADD CONSTRAINT "FK_SrvlessFnOwnerUser_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerUser" ADD CONSTRAINT "FK_SrvlessFnOwnerUser_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerUser" ADD CONSTRAINT "FK_SrvlessFnOwnerUser_fnId" FOREIGN KEY ("serverlessFunctionId") REFERENCES "ServerlessFunction"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerUser" ADD CONSTRAINT "FK_SrvlessFnOwnerUser_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerUser" ADD CONSTRAINT "FK_SrvlessFnOwnerUser_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: ServerlessFunctionLabel join table
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionLabel" ADD CONSTRAINT "FK_ServerlessFunctionLabel_fnId" FOREIGN KEY ("serverlessFunctionId") REFERENCES "ServerlessFunction"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionLabel" ADD CONSTRAINT "FK_ServerlessFunctionLabel_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionLabel" DROP CONSTRAINT "FK_ServerlessFunctionLabel_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionLabel" DROP CONSTRAINT "FK_ServerlessFunctionLabel_fnId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerUser" DROP CONSTRAINT "FK_SrvlessFnOwnerUser_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerUser" DROP CONSTRAINT "FK_SrvlessFnOwnerUser_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerUser" DROP CONSTRAINT "FK_SrvlessFnOwnerUser_fnId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerUser" DROP CONSTRAINT "FK_SrvlessFnOwnerUser_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerUser" DROP CONSTRAINT "FK_SrvlessFnOwnerUser_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerTeam" DROP CONSTRAINT "FK_SrvlessFnOwnerTeam_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerTeam" DROP CONSTRAINT "FK_SrvlessFnOwnerTeam_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerTeam" DROP CONSTRAINT "FK_SrvlessFnOwnerTeam_fnId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerTeam" DROP CONSTRAINT "FK_SrvlessFnOwnerTeam_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerTeam" DROP CONSTRAINT "FK_SrvlessFnOwnerTeam_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunction" DROP CONSTRAINT "FK_ServerlessFunction_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunction" DROP CONSTRAINT "FK_ServerlessFunction_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunction" DROP CONSTRAINT "FK_ServerlessFunction_projectId"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_ServerlessFunctionLabel_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ServerlessFunctionLabel_fnId"`,
    );
    await queryRunner.query(`DROP TABLE "ServerlessFunctionLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_SrvlessFnOwnerUser_notified"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_SrvlessFnOwnerUser_fnId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_SrvlessFnOwnerUser_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_SrvlessFnOwnerUser_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "ServerlessFunctionOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_SrvlessFnOwnerTeam_notified"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_SrvlessFnOwnerTeam_fnId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_SrvlessFnOwnerTeam_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_SrvlessFnOwnerTeam_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "ServerlessFunctionOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_ServerlessFunction_project_fnId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ServerlessFunction_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "ServerlessFunction"`);
  }
}
