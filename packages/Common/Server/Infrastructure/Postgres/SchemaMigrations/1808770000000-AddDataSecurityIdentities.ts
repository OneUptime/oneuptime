import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Who can reach a project's data, one identity at a time
 * (Models/DatabaseModels/DataSecurityIdentity): one row per principal that
 * reaches at least one data store - what it reaches, how sensitive that
 * is, whether it can change it, whether it is outside the connected
 * accounts, when it was last used and its risk score - written by the
 * Data Security evaluator alone, and deleted with its project. The table
 * is new and empty, so its indexes and its foreign key are built here.
 *
 * And a store's access entry says whether the principal has gone unused
 * for 90 days (DataStoreAccess.isUnused): a column with a constant
 * default, which Postgres adds without rewriting the table; every entry
 * already there reads as not unused until its cloud is read again.
 */
export class AddDataSecurityIdentities1808770000000
  implements MigrationInterface
{
  public name: string = "AddDataSecurityIdentities1808770000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataSecurityIdentity" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "identityKey" character varying(500) NOT NULL, "principal" character varying(500) NOT NULL, "principalName" character varying(500), "principalType" character varying(100), "provider" character varying(100), "isExternal" boolean NOT NULL DEFAULT false, "isPublic" boolean NOT NULL DEFAULT false, "isUnused" boolean NOT NULL DEFAULT false, "isSeenInTraces" boolean NOT NULL DEFAULT false, "storeCount" integer NOT NULL DEFAULT '0', "sensitiveStoreCount" integer NOT NULL DEFAULT '0', "restrictedStoreCount" integer NOT NULL DEFAULT '0', "highestSensitivity" character varying(100) NOT NULL DEFAULT 'Public', "highestAccessLevel" character varying(100), "canChangeSensitiveData" boolean NOT NULL DEFAULT false, "dataTypeIds" jsonb, "estimatedRecords" integer, "riskScore" integer NOT NULL DEFAULT '0', "lastUsedAt" TIMESTAMP WITH TIME ZONE, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_05969aea8141a187e1f67e18c85" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_30326e8c66d3263545da0ffdcb" ON "DataSecurityIdentity" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_959cce1ae0cba484b5893e5115" ON "DataSecurityIdentity" ("projectId", "riskScore") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b64fc0d5ba828f27683b7200be" ON "DataSecurityIdentity" ("projectId", "identityKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreAccess" ADD "isUnused" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIdentity" ADD CONSTRAINT "FK_30326e8c66d3263545da0ffdcbd" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIdentity" DROP CONSTRAINT "FK_30326e8c66d3263545da0ffdcbd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreAccess" DROP COLUMN "isUnused"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b64fc0d5ba828f27683b7200be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_959cce1ae0cba484b5893e5115"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30326e8c66d3263545da0ffdcb"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityIdentity"`);
  }
}
