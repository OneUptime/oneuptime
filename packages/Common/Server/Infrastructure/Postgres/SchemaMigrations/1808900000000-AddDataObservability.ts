import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data Observability: the tables of connected data stores (DataAsset), each
 * table's timeline (DataAssetFeed), and the columns on DataStore that
 * schedule and report its table-health collections. The index on
 * DataStore's new "nextTableHealthCollectionAt" is built online, in
 * AddDataObservabilityStoreIndex1808900100000.
 */
export class AddDataObservability1808900000000 implements MigrationInterface {
  public name = "AddDataObservability1808900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataAsset" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataStoreId" uuid NOT NULL, "dataStoreName" character varying(100), "dataStoreKind" character varying(100), "assetKey" character varying(500) NOT NULL, "schemaName" character varying(500), "name" character varying(500) NOT NULL, "assetKind" character varying(100) NOT NULL DEFAULT 'Table', "description" text, "columns" jsonb, "columnCount" integer, "rowCount" bigint, "sizeInBytes" bigint, "lastChangedAt" TIMESTAMP WITH TIME ZONE, "updateIntervalInSeconds" integer, "lastCollectedAt" TIMESTAMP WITH TIME ZONE, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "isDropped" boolean NOT NULL DEFAULT false, "droppedAt" TIMESTAMP WITH TIME ZONE, "collectionState" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a646002f6fc6dbba03526a15711" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d70153071a021b9bbc5eda290b" ON "DataAsset" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da49f8a61373d6a959338d63b6" ON "DataAsset" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_062e06e3dd628239b1c59aef95" ON "DataAsset" ("projectId", "lastChangedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2cfbddeabb55cc0f758d36076d" ON "DataAsset" ("projectId", "isDropped") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4a3c8f53c8c668500c2cb8cbb2" ON "DataAsset" ("dataStoreId", "assetKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataAssetFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataAssetId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "dataAssetFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0a2b31566d8fdda6b77c501ed3a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_38eedeb91a7aa752519fcadc3e" ON "DataAssetFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8ddfc43c60bd4f1bf2a43dc2e9" ON "DataAssetFeed" ("dataAssetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_67f4d244c3fa393ebf98b2ee7e" ON "DataAssetFeed" ("dataAssetId", "postedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "isTableHealthEnabled" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "tableHealthCollectedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "tableHealthStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "tableHealthMessage" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "tableHealthAssetCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "nextTableHealthCollectionAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" ADD CONSTRAINT "FK_d70153071a021b9bbc5eda290b3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" ADD CONSTRAINT "FK_da49f8a61373d6a959338d63b6b" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" ADD CONSTRAINT "FK_afa4c4991a6772e0cf53a1cb6fd" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" ADD CONSTRAINT "FK_0b5fb1a03b2c31ab8460b4247f4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetFeed" ADD CONSTRAINT "FK_38eedeb91a7aa752519fcadc3e3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetFeed" ADD CONSTRAINT "FK_8ddfc43c60bd4f1bf2a43dc2e93" FOREIGN KEY ("dataAssetId") REFERENCES "DataAsset"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetFeed" ADD CONSTRAINT "FK_1ab81545fb57ef4353c042fca8c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetFeed" ADD CONSTRAINT "FK_be74636aaa7066b77843e6159e1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAssetFeed" DROP CONSTRAINT "FK_be74636aaa7066b77843e6159e1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetFeed" DROP CONSTRAINT "FK_1ab81545fb57ef4353c042fca8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetFeed" DROP CONSTRAINT "FK_8ddfc43c60bd4f1bf2a43dc2e93"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetFeed" DROP CONSTRAINT "FK_38eedeb91a7aa752519fcadc3e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" DROP CONSTRAINT "FK_0b5fb1a03b2c31ab8460b4247f4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" DROP CONSTRAINT "FK_afa4c4991a6772e0cf53a1cb6fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" DROP CONSTRAINT "FK_da49f8a61373d6a959338d63b6b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" DROP CONSTRAINT "FK_d70153071a021b9bbc5eda290b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "nextTableHealthCollectionAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "tableHealthAssetCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "tableHealthMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "tableHealthStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "tableHealthCollectedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "isTableHealthEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_67f4d244c3fa393ebf98b2ee7e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8ddfc43c60bd4f1bf2a43dc2e9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_38eedeb91a7aa752519fcadc3e"`,
    );
    await queryRunner.query(`DROP TABLE "DataAssetFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a3c8f53c8c668500c2cb8cbb2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2cfbddeabb55cc0f758d36076d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_062e06e3dd628239b1c59aef95"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_da49f8a61373d6a959338d63b6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d70153071a021b9bbc5eda290b"`,
    );
    await queryRunner.query(`DROP TABLE "DataAsset"`);
  }
}
