import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * VMware monitoring without an agent: a vCenter's probe collection settings
 * (collectionMethod, the address, the read-only account - its password
 * encrypted and write-only - the probe, a trusted certificate fingerprint and
 * the interval) and what the probe last found, on VMwareVCenter; and
 * VMwareVCenterConnectionTest, the "Test connection" a person runs before
 * saving.
 *
 * Every existing vCenter becomes collectionMethod 'Agent' - how its data
 * reaches OneUptime today - with no password, so nothing about it changes.
 * The index and foreign key on VMwareVCenter, which already exists, are in
 * AddVMwareProbeCollectionIndexes1801350000000, built online.
 */
export class AddVMwareProbeCollection1801300000000
  implements MigrationInterface
{
  public name: string = "AddVMwareProbeCollection1801300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterConnectionTest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "vmwareVCenterId" uuid, "probeId" uuid NOT NULL, "vcenterUrl" character varying(500) NOT NULL, "vcenterUsername" character varying(500) NOT NULL, "vcenterPassword" text, "trustedCertificateFingerprint" character varying(100), "status" character varying(100) NOT NULL DEFAULT 'Pending', "errorCode" character varying(100), "errorMessage" character varying(500), "presentedCertificate" jsonb, "summary" jsonb, "claimedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_b00ffbc7d3939ec72f486025b43" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0d2cc22af5db542a67ff9d0de5" ON "VMwareVCenterConnectionTest" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_07c9fc3d521cdda5c5443ad152" ON "VMwareVCenterConnectionTest" ("probeId", "status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "collectionMethod" character varying(100) NOT NULL DEFAULT 'Agent'`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "vcenterUrl" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "vcenterUsername" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "vcenterPassword" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "isVCenterPasswordSet" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "vcenterCredentialsUpdatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "collectionProbeId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "trustedCertificateFingerprint" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "collectionIntervalInMinutes" integer NOT NULL DEFAULT '2'`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "collectionStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "collectionErrorCode" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "collectionError" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "presentedCertificate" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "collectionSummary" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "nextCollectionAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "lastCollectionAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "lastSuccessfulCollectionAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "collectionSettingsVersion" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterConnectionTest" ADD CONSTRAINT "FK_0d2cc22af5db542a67ff9d0de5c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterConnectionTest" ADD CONSTRAINT "FK_c59d3bf21e9a0784f1ae5950fd9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterConnectionTest" ADD CONSTRAINT "FK_c52a9d89c13d337aa0b50f80da9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterConnectionTest" ADD CONSTRAINT "FK_6fc03ba1443dc694e3e847a59b0" FOREIGN KEY ("vmwareVCenterId") REFERENCES "VMwareVCenter"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterConnectionTest" ADD CONSTRAINT "FK_817c8c96428c1d952ca4eb0d3a1" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterConnectionTest" DROP CONSTRAINT "FK_817c8c96428c1d952ca4eb0d3a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterConnectionTest" DROP CONSTRAINT "FK_6fc03ba1443dc694e3e847a59b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterConnectionTest" DROP CONSTRAINT "FK_c52a9d89c13d337aa0b50f80da9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterConnectionTest" DROP CONSTRAINT "FK_c59d3bf21e9a0784f1ae5950fd9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterConnectionTest" DROP CONSTRAINT "FK_0d2cc22af5db542a67ff9d0de5c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "collectionSettingsVersion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "lastSuccessfulCollectionAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "lastCollectionAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "nextCollectionAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "collectionSummary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "presentedCertificate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "collectionError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "collectionErrorCode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "collectionStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "collectionIntervalInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "trustedCertificateFingerprint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "collectionProbeId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "vcenterCredentialsUpdatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "isVCenterPasswordSet"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "vcenterPassword"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "vcenterUsername"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "vcenterUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "collectionMethod"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_07c9fc3d521cdda5c5443ad152"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0d2cc22af5db542a67ff9d0de5"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareVCenterConnectionTest"`);
  }
}
