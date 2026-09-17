import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Bucket B: live-inventory child tables for the new telemetry resource types.
 *  - ServerlessFunctionInstance (faas.instance)
 *  - CloudResourceInstance (service.instance.id + container cpu/mem)
 *  - RumApplicationClient (browser.platform / device.model, coarse by platform)
 * Populated from the ingest auto-discovery path; not user-editable.
 */
export class AddTelemetryResourceInventoryTables1780941762204
  implements MigrationInterface
{
  public name = "AddTelemetryResourceInventoryTables1780941762204";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ServerlessFunctionInstance
    await queryRunner.query(
      `CREATE TABLE "ServerlessFunctionInstance" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serverlessFunctionId" uuid NOT NULL, "instanceName" character varying(100) NOT NULL, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_SrvlessFnInstance" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnInstance_projectId" ON "ServerlessFunctionInstance" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnInstance_fnId" ON "ServerlessFunctionInstance" ("serverlessFunctionId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_SrvlessFnInstance" ON "ServerlessFunctionInstance" ("projectId", "serverlessFunctionId", "instanceName") `,
    );

    // CloudResourceInstance
    await queryRunner.query(
      `CREATE TABLE "CloudResourceInstance" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, "instanceName" character varying(100) NOT NULL, "latestCpuPercent" numeric, "latestMemoryBytes" bigint, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_CloudResInstance" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResInstance_projectId" ON "CloudResourceInstance" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResInstance_resId" ON "CloudResourceInstance" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_CloudResInstance" ON "CloudResourceInstance" ("projectId", "cloudResourceId", "instanceName") `,
    );

    // RumApplicationClient
    await queryRunner.query(
      `CREATE TABLE "RumApplicationClient" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "rumApplicationId" uuid NOT NULL, "clientName" character varying(100) NOT NULL, "clientType" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_RumAppClient" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppClient_projectId" ON "RumApplicationClient" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppClient_appId" ON "RumApplicationClient" ("rumApplicationId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_RumAppClient" ON "RumApplicationClient" ("projectId", "rumApplicationId", "clientName") `,
    );

    // Foreign keys
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionInstance" ADD CONSTRAINT "FK_SrvlessFnInstance_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionInstance" ADD CONSTRAINT "FK_SrvlessFnInstance_fn" FOREIGN KEY ("serverlessFunctionId") REFERENCES "ServerlessFunction"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionInstance" ADD CONSTRAINT "FK_SrvlessFnInstance_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "CloudResourceInstance" ADD CONSTRAINT "FK_CloudResInstance_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceInstance" ADD CONSTRAINT "FK_CloudResInstance_res" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceInstance" ADD CONSTRAINT "FK_CloudResInstance_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "RumApplicationClient" ADD CONSTRAINT "FK_RumAppClient_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationClient" ADD CONSTRAINT "FK_RumAppClient_app" FOREIGN KEY ("rumApplicationId") REFERENCES "RumApplication"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationClient" ADD CONSTRAINT "FK_RumAppClient_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "RumApplicationClient"`);
    await queryRunner.query(`DROP TABLE "CloudResourceInstance"`);
    await queryRunner.query(`DROP TABLE "ServerlessFunctionInstance"`);
  }
}
