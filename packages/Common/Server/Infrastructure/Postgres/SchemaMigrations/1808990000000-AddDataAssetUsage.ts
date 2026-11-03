import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The services seen reading and writing each table (DataAssetUsage), and the
 * database each data store's collection read (DataStore.tableHealthTarget),
 * which ties their spans to its tables. A new table: its indexes and foreign
 * keys are made with it, before it holds a row.
 */
export class AddDataAssetUsage1808990000000 implements MigrationInterface {
  public name: string = "AddDataAssetUsage1808990000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataAssetUsage" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataAssetId" uuid NOT NULL, "dataStoreId" uuid NOT NULL, "serviceId" uuid NOT NULL, "serviceName" character varying(100) NOT NULL, "accessKind" character varying(100) NOT NULL, "usageKey" character varying(100) NOT NULL, "operations" jsonb, "callCount" integer, "errorCount" integer, "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_71a480db625e9dd767e4cf5d89f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a38014b2088f0924a4e4c662cd" ON "DataAssetUsage" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e21fb8952b9490fabc6916666" ON "DataAssetUsage" ("dataAssetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a6eb2ef4be02d657ef2850416b" ON "DataAssetUsage" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9dad34725751d2edb5ca0ba85c" ON "DataAssetUsage" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ebb954a4afacf76e7ab8104f3" ON "DataAssetUsage" ("projectId", "lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_88aecead5021e75de31931c525" ON "DataAssetUsage" ("dataAssetId", "usageKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "tableHealthTarget" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetUsage" ADD CONSTRAINT "FK_a38014b2088f0924a4e4c662cd2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetUsage" ADD CONSTRAINT "FK_7e21fb8952b9490fabc69166666" FOREIGN KEY ("dataAssetId") REFERENCES "DataAsset"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetUsage" ADD CONSTRAINT "FK_9dad34725751d2edb5ca0ba85c9" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetUsage" ADD CONSTRAINT "FK_a8923111a12effdf15826151634" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetUsage" ADD CONSTRAINT "FK_0248ed56e7c732fdd73af6b733b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAssetUsage" DROP CONSTRAINT "FK_0248ed56e7c732fdd73af6b733b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetUsage" DROP CONSTRAINT "FK_a8923111a12effdf15826151634"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetUsage" DROP CONSTRAINT "FK_9dad34725751d2edb5ca0ba85c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetUsage" DROP CONSTRAINT "FK_7e21fb8952b9490fabc69166666"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetUsage" DROP CONSTRAINT "FK_a38014b2088f0924a4e4c662cd2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "tableHealthTarget"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_88aecead5021e75de31931c525"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1ebb954a4afacf76e7ab8104f3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9dad34725751d2edb5ca0ba85c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a6eb2ef4be02d657ef2850416b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e21fb8952b9490fabc6916666"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a38014b2088f0924a4e4c662cd"`,
    );
    await queryRunner.query(`DROP TABLE "DataAssetUsage"`);
  }
}
