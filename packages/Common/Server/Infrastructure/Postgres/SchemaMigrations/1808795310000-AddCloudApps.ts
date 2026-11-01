import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * App Platforms' apps and their revisions (CloudApp, CloudAppRevision): one
 * row per app the telemetry of an environment names - an ECS task
 * definition family, a Cloud Run service, a Container App - and one per
 * revision it ran, its deploy history. Both tables are new, so their
 * indexes and keys are built in place. CloudResourceInstance gains the app
 * and the revision an instance runs: two nullable columns, so every
 * existing instance keeps its row as it is and is linked the next time it
 * reports. The index and the foreign key on CloudResourceInstance, which
 * ingest writes all the time, are built online by
 * AddCloudResourceInstanceAppIndexAndKey1808795320000. Generated with
 * npm run generate-postgres-migration.
 */
export class AddCloudApps1808795310000 implements MigrationInterface {
  public name: string = "AddCloudApps1808795310000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudApp" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, "name" character varying(100) NOT NULL, "appKey" character varying(100) NOT NULL, "groupName" character varying(100), "cloudPlatform" character varying(100), "telemetryAttributes" jsonb, "serviceName" character varying(100), "image" character varying(500), "revisionAttribute" character varying(100), "currentRevision" character varying(100), "currentRevisionSince" TIMESTAMP WITH TIME ZONE, "previousRevision" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b3aecf8014e91029063378ba017" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5e2fab18f49233aebff2f5f11d" ON "CloudApp" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b4836a7cae6aa7aad5aa5ad4a" ON "CloudApp" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3559fd131c468d3c10e62f6c30" ON "CloudApp" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_418ab51d303b2e518e6f6f65ec" ON "CloudApp" ("projectId", "cloudResourceId", "appKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudAppRevision" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, "cloudAppId" uuid NOT NULL, "revision" character varying(100) NOT NULL, "previousRevision" character varying(100), "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "serviceVersion" character varying(100), "image" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_38fd814efeefff4be8a2f74d230" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_463e6e1a286ee2613f3b1a2422" ON "CloudAppRevision" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_58ba31f3013b4f52d47736c1de" ON "CloudAppRevision" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0eacb58b2f61a895f4a074c54" ON "CloudAppRevision" ("cloudAppId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12891b008878d30b8a0ce7682f" ON "CloudAppRevision" ("firstSeenAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_436c20189dd530b12e8fc13d4e" ON "CloudAppRevision" ("projectId", "cloudAppId", "revision") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceInstance" ADD "cloudAppId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceInstance" ADD "revision" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudApp" ADD CONSTRAINT "FK_5e2fab18f49233aebff2f5f11dc" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudApp" ADD CONSTRAINT "FK_8b4836a7cae6aa7aad5aa5ad4a4" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudApp" ADD CONSTRAINT "FK_a2c20e2834c9e16220eaaf580d5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAppRevision" ADD CONSTRAINT "FK_463e6e1a286ee2613f3b1a2422d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAppRevision" ADD CONSTRAINT "FK_58ba31f3013b4f52d47736c1de3" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAppRevision" ADD CONSTRAINT "FK_f0eacb58b2f61a895f4a074c544" FOREIGN KEY ("cloudAppId") REFERENCES "CloudApp"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAppRevision" ADD CONSTRAINT "FK_ed2057c6284a0a0fcda65c2f35c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudAppRevision" DROP CONSTRAINT "FK_ed2057c6284a0a0fcda65c2f35c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAppRevision" DROP CONSTRAINT "FK_f0eacb58b2f61a895f4a074c544"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAppRevision" DROP CONSTRAINT "FK_58ba31f3013b4f52d47736c1de3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAppRevision" DROP CONSTRAINT "FK_463e6e1a286ee2613f3b1a2422d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudApp" DROP CONSTRAINT "FK_a2c20e2834c9e16220eaaf580d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudApp" DROP CONSTRAINT "FK_8b4836a7cae6aa7aad5aa5ad4a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudApp" DROP CONSTRAINT "FK_5e2fab18f49233aebff2f5f11dc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceInstance" DROP COLUMN "revision"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceInstance" DROP COLUMN "cloudAppId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_436c20189dd530b12e8fc13d4e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12891b008878d30b8a0ce7682f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0eacb58b2f61a895f4a074c54"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_58ba31f3013b4f52d47736c1de"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_463e6e1a286ee2613f3b1a2422"`,
    );
    await queryRunner.query(`DROP TABLE "CloudAppRevision"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_418ab51d303b2e518e6f6f65ec"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3559fd131c468d3c10e62f6c30"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b4836a7cae6aa7aad5aa5ad4a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5e2fab18f49233aebff2f5f11d"`,
    );
    await queryRunner.query(`DROP TABLE "CloudApp"`);
  }
}
