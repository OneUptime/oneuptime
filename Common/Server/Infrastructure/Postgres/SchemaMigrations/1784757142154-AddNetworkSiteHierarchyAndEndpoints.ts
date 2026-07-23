import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNetworkSiteHierarchyAndEndpoints1784757142154
  implements MigrationInterface
{
  public name: string = "AddNetworkSiteHierarchyAndEndpoints1784757142154";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkSite" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "siteType" character varying(100) NOT NULL, "parentSiteId" uuid, "materializedPath" character varying(500), "depth" integer, "address" character varying(100), "latitude" numeric, "longitude" numeric, "currentMonitorStatusId" uuid, "lastRollupAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "UQ_44b0b3eea7a9e7cf24971cfc5ce" UNIQUE ("slug"), CONSTRAINT "PK_d1d037108064aa9faeefdcf16e4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a031dd77eae1f84dbb90bd116a" ON "NetworkSite" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a0ff4b340d45f8c48ba5f9a306" ON "NetworkSite" ("materializedPath") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_84ecdbc606d4bb610a7c30ffeb" ON "NetworkSite" ("currentMonitorStatusId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_83b4c9217c1fa93d076ca57b37" ON "NetworkSite" ("projectId", "parentSiteId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "NetworkEndpoint" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "macAddress" character varying(100) NOT NULL, "ipAddress" character varying(100), "vendor" character varying(100), "classification" character varying(100), "attachedNetworkDeviceId" uuid NOT NULL, "attachedInterfaceIndex" integer, "attachedPortName" character varying(100), "vlanId" integer, "siteId" uuid, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_8e6365b7580ec30d132fabc34ef" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0d9fa0c6d7aee91c12d604ff7" ON "NetworkEndpoint" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_485e26a3be64e410cfdc678328" ON "NetworkEndpoint" ("macAddress") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5dcd4a28195a5d504a5a4e4986" ON "NetworkEndpoint" ("attachedNetworkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b56f3f50eb346ced70c7c7fce6" ON "NetworkEndpoint" ("siteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7c40f683dcf5ec9bb68ffe32e1" ON "NetworkEndpoint" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_91e00aa0bbe2c0cdcfbf884a2d" ON "NetworkEndpoint" ("projectId", "macAddress") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2dd018060e4731180e5f09329d" ON "NetworkEndpoint" ("projectId", "attachedNetworkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "NetworkSiteStatusTimeline" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "siteId" uuid NOT NULL, "monitorStatusId" uuid NOT NULL, "startsAt" TIMESTAMP WITH TIME ZONE, "endsAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_39c54e45b3d29ed6da668c78fba" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f5ec0bad81ea269cabd751222e" ON "NetworkSiteStatusTimeline" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf275671ebcf8ce8f2732175ac" ON "NetworkSiteStatusTimeline" ("siteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8886e21e28e5287abb5b26475a" ON "NetworkSiteStatusTimeline" ("monitorStatusId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_96ccda5707ff2ce88675430a23" ON "NetworkSiteStatusTimeline" ("startsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80816dba23e4a15bf99c49898b" ON "NetworkSiteStatusTimeline" ("endsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fa9ef29b9decf9c8b99ab426ae" ON "NetworkSiteStatusTimeline" ("siteId", "startsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a46ee81cc7ef454701aa4c6bc3" ON "NetworkSiteStatusTimeline" ("siteId", "projectId", "startsAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "NetworkSiteLink" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100), "fromSiteId" uuid NOT NULL, "toSiteId" uuid NOT NULL, "monitorId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_f6f59fbf7044c3c38463365650d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9f09c434d86234d067aacdbebb" ON "NetworkSiteLink" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fa5ad7fb4f2d810edf59512250" ON "NetworkSiteLink" ("fromSiteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c77ecd954a2bfddbbb89b8176" ON "NetworkSiteLink" ("toSiteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c7e06d3445f2310f5405577d8b" ON "NetworkSiteLink" ("projectId", "fromSiteId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "NetworkSiteAssignmentRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "siteId" uuid NOT NULL, "subnetCidr" character varying(100), "hostnamePattern" character varying(100), "priority" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_0214e0904ecf02dc20c157b4f90" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b48e3f4f68d1e87a11e80288e8" ON "NetworkSiteAssignmentRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f7c77a3a30e4b6c76291a92ce" ON "NetworkSiteAssignmentRule" ("siteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8bdf457188931404a057ca732b" ON "NetworkSiteAssignmentRule" ("projectId", "siteId") `,
    );
    await queryRunner.query(`ALTER TABLE "NetworkDevice" ADD "siteId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "currentMonitorStatusId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0d8f7c2fd4ff4f44d3673aac85" ON "NetworkDevice" ("currentMonitorStatusId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_a031dd77eae1f84dbb90bd116a6" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_33a461f17262b0a4d5be6948ebe" FOREIGN KEY ("parentSiteId") REFERENCES "NetworkSite"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_84ecdbc606d4bb610a7c30ffebf" FOREIGN KEY ("currentMonitorStatusId") REFERENCES "MonitorStatus"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_279bbf16862fa565b60350a883c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_732e91b59f88426fb871a111e9b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_9470aaee908130a11c04a90fcf1" FOREIGN KEY ("siteId") REFERENCES "NetworkSite"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_0d8f7c2fd4ff4f44d3673aac853" FOREIGN KEY ("currentMonitorStatusId") REFERENCES "MonitorStatus"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD CONSTRAINT "FK_f0d9fa0c6d7aee91c12d604ff74" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD CONSTRAINT "FK_5dcd4a28195a5d504a5a4e49865" FOREIGN KEY ("attachedNetworkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD CONSTRAINT "FK_b56f3f50eb346ced70c7c7fce6f" FOREIGN KEY ("siteId") REFERENCES "NetworkSite"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD CONSTRAINT "FK_531a978b8052ccaeea7b3e371a4" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD CONSTRAINT "FK_ac25adccac14df0db12c27070b2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" ADD CONSTRAINT "FK_f5ec0bad81ea269cabd751222e0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" ADD CONSTRAINT "FK_bf275671ebcf8ce8f2732175ac0" FOREIGN KEY ("siteId") REFERENCES "NetworkSite"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" ADD CONSTRAINT "FK_8886e21e28e5287abb5b26475a1" FOREIGN KEY ("monitorStatusId") REFERENCES "MonitorStatus"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" ADD CONSTRAINT "FK_5fcadf902f4fe3d91393f8e7081" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" ADD CONSTRAINT "FK_32a3194a2fa1a7e070614064bcb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" ADD CONSTRAINT "FK_9f09c434d86234d067aacdbebbc" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" ADD CONSTRAINT "FK_fa5ad7fb4f2d810edf595122500" FOREIGN KEY ("fromSiteId") REFERENCES "NetworkSite"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" ADD CONSTRAINT "FK_0c77ecd954a2bfddbbb89b8176c" FOREIGN KEY ("toSiteId") REFERENCES "NetworkSite"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" ADD CONSTRAINT "FK_229b8d76c20baddc9b543b81659" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" ADD CONSTRAINT "FK_88b6918c967d2d562b55a6e2ec6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" ADD CONSTRAINT "FK_5a2cb3c1eefea043877ccbf248e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" ADD CONSTRAINT "FK_b48e3f4f68d1e87a11e80288e8b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" ADD CONSTRAINT "FK_0f7c77a3a30e4b6c76291a92ce0" FOREIGN KEY ("siteId") REFERENCES "NetworkSite"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" ADD CONSTRAINT "FK_4941b467bd26ff302181c0c38cd" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" ADD CONSTRAINT "FK_2fcbff1ec5859717f2731f37555" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" DROP CONSTRAINT "FK_2fcbff1ec5859717f2731f37555"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" DROP CONSTRAINT "FK_4941b467bd26ff302181c0c38cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" DROP CONSTRAINT "FK_0f7c77a3a30e4b6c76291a92ce0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" DROP CONSTRAINT "FK_b48e3f4f68d1e87a11e80288e8b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" DROP CONSTRAINT "FK_5a2cb3c1eefea043877ccbf248e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" DROP CONSTRAINT "FK_88b6918c967d2d562b55a6e2ec6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" DROP CONSTRAINT "FK_229b8d76c20baddc9b543b81659"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" DROP CONSTRAINT "FK_0c77ecd954a2bfddbbb89b8176c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" DROP CONSTRAINT "FK_fa5ad7fb4f2d810edf595122500"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLink" DROP CONSTRAINT "FK_9f09c434d86234d067aacdbebbc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" DROP CONSTRAINT "FK_32a3194a2fa1a7e070614064bcb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" DROP CONSTRAINT "FK_5fcadf902f4fe3d91393f8e7081"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" DROP CONSTRAINT "FK_8886e21e28e5287abb5b26475a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" DROP CONSTRAINT "FK_bf275671ebcf8ce8f2732175ac0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" DROP CONSTRAINT "FK_f5ec0bad81ea269cabd751222e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP CONSTRAINT "FK_ac25adccac14df0db12c27070b2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP CONSTRAINT "FK_531a978b8052ccaeea7b3e371a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP CONSTRAINT "FK_b56f3f50eb346ced70c7c7fce6f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP CONSTRAINT "FK_5dcd4a28195a5d504a5a4e49865"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP CONSTRAINT "FK_f0d9fa0c6d7aee91c12d604ff74"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_0d8f7c2fd4ff4f44d3673aac853"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_9470aaee908130a11c04a90fcf1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_732e91b59f88426fb871a111e9b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_279bbf16862fa565b60350a883c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_84ecdbc606d4bb610a7c30ffebf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_33a461f17262b0a4d5be6948ebe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_a031dd77eae1f84dbb90bd116a6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0d8f7c2fd4ff4f44d3673aac85"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "currentMonitorStatusId"`,
    );
    await queryRunner.query(`ALTER TABLE "NetworkDevice" DROP COLUMN "siteId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8bdf457188931404a057ca732b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f7c77a3a30e4b6c76291a92ce"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b48e3f4f68d1e87a11e80288e8"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkSiteAssignmentRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c7e06d3445f2310f5405577d8b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c77ecd954a2bfddbbb89b8176"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa5ad7fb4f2d810edf59512250"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f09c434d86234d067aacdbebb"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkSiteLink"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a46ee81cc7ef454701aa4c6bc3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa9ef29b9decf9c8b99ab426ae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80816dba23e4a15bf99c49898b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_96ccda5707ff2ce88675430a23"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8886e21e28e5287abb5b26475a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bf275671ebcf8ce8f2732175ac"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5ec0bad81ea269cabd751222e"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkSiteStatusTimeline"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2dd018060e4731180e5f09329d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_91e00aa0bbe2c0cdcfbf884a2d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c40f683dcf5ec9bb68ffe32e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b56f3f50eb346ced70c7c7fce6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5dcd4a28195a5d504a5a4e4986"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_485e26a3be64e410cfdc678328"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0d9fa0c6d7aee91c12d604ff7"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkEndpoint"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_83b4c9217c1fa93d076ca57b37"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_84ecdbc606d4bb610a7c30ffeb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a0ff4b340d45f8c48ba5f9a306"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a031dd77eae1f84dbb90bd116a"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkSite"`);
  }
}
