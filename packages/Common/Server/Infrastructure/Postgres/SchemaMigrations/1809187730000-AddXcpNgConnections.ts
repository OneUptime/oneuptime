import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * XCP-ng pools read from a probe, with nothing to install (#10996, #10999):
 * the connections a probe reads - a Xen Orchestra, or a pool's own XAPI -
 * and their connection tests (Models/DatabaseModels/XcpNgConnection,
 * XcpNgConnectionTest), and how each pool is read (XcpNgPool's
 * collectionMethod, every existing pool the XCP-ng Agent's, and
 * xcpNgConnectionId).
 *
 * Exactly as `npm run generate-postgres-migration` wrote it, but for the
 * foreign key from the existing XcpNgPool table to XcpNgConnection, which
 * AddXcpNgPoolConnectionKey1809187730010 adds online. The two new tables are
 * empty, so their indexes and keys need nothing of OnlineDdl; the pool's two
 * new columns are a nullable one and one with a constant default, which
 * Postgres adds without rewriting the table.
 */
export class AddXcpNgConnections1809187730000 implements MigrationInterface {
  public name: string = "AddXcpNgConnections1809187730000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "XcpNgConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "connectionType" character varying(100) NOT NULL, "address" character varying(500) NOT NULL, "collectionProbeId" uuid, "trustedCertificateFingerprint" character varying(100), "collectionIntervalInMinutes" integer NOT NULL DEFAULT '1', "openMetricsSecret" text, "isOpenMetricsSecretSet" boolean NOT NULL DEFAULT false, "apiToken" text, "isApiTokenSet" boolean NOT NULL DEFAULT false, "apiTokenExpiresAt" TIMESTAMP WITH TIME ZONE, "apiTokenExpiryWarnedAt" TIMESTAMP WITH TIME ZONE, "username" character varying(500), "password" text, "isPasswordSet" boolean NOT NULL DEFAULT false, "xapiAccountKind" character varying(100), "xapiPoolId" character varying(100), "xapiMasterAddress" character varying(500), "xapiPoolHosts" jsonb, "messageWatermark" jsonb, "credentialsUpdatedAt" TIMESTAMP WITH TIME ZONE, "collectionStatus" character varying(100), "collectionErrorCode" character varying(100), "collectionError" character varying(500), "presentedCertificate" jsonb, "collectionSummary" jsonb, "nextCollectionAt" TIMESTAMP WITH TIME ZONE, "lastCollectionAt" TIMESTAMP WITH TIME ZONE, "lastSuccessfulCollectionAt" TIMESTAMP WITH TIME ZONE, "collectionSettingsVersion" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, CONSTRAINT "PK_0adee37562f1bfadea4f03563a1" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_707a6aa3409d0f78699b28acd5" ON "XcpNgConnection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0b7c7a13b3bbc1ee8fee84ccb2" ON "XcpNgConnection" ("collectionProbeId", "nextCollectionAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgConnectionTest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "createdByUserId" uuid, "xcpNgConnectionId" uuid, "probeId" uuid NOT NULL, "connectionType" character varying(100) NOT NULL, "address" character varying(500) NOT NULL, "username" character varying(500), "openMetricsSecret" text, "apiToken" text, "password" text, "trustedCertificateFingerprint" character varying(100), "status" character varying(100) NOT NULL DEFAULT 'Pending', "errorCode" character varying(100), "errorMessage" character varying(500), "presentedCertificate" jsonb, "summary" jsonb, "claimedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_d78fa39b77761f012c1be890820" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d3f9128ec5e64f5ecd6b709b39" ON "XcpNgConnectionTest" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_773559ad473ba0a4a721430ec6" ON "XcpNgConnectionTest" ("probeId", "status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "collectionMethod" character varying(100) NOT NULL DEFAULT 'Agent'`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "xcpNgConnectionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnection" ADD CONSTRAINT "FK_707a6aa3409d0f78699b28acd53" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnection" ADD CONSTRAINT "FK_223669d88459e70414c834e3679" FOREIGN KEY ("collectionProbeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnection" ADD CONSTRAINT "FK_08e671060c7ac6ea3ffd90a4cfa" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnectionTest" ADD CONSTRAINT "FK_d3f9128ec5e64f5ecd6b709b397" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnectionTest" ADD CONSTRAINT "FK_fac24c59d6faced23ed498969fe" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnectionTest" ADD CONSTRAINT "FK_99d0d1d711d05781dfee1b3354c" FOREIGN KEY ("xcpNgConnectionId") REFERENCES "XcpNgConnection"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnectionTest" ADD CONSTRAINT "FK_9fcfdd8b2a978ac9bb9d2b4261e" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnectionTest" DROP CONSTRAINT "FK_9fcfdd8b2a978ac9bb9d2b4261e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnectionTest" DROP CONSTRAINT "FK_99d0d1d711d05781dfee1b3354c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnectionTest" DROP CONSTRAINT "FK_fac24c59d6faced23ed498969fe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnectionTest" DROP CONSTRAINT "FK_d3f9128ec5e64f5ecd6b709b397"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnection" DROP CONSTRAINT "FK_08e671060c7ac6ea3ffd90a4cfa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnection" DROP CONSTRAINT "FK_223669d88459e70414c834e3679"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgConnection" DROP CONSTRAINT "FK_707a6aa3409d0f78699b28acd53"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "xcpNgConnectionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "collectionMethod"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_773559ad473ba0a4a721430ec6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d3f9128ec5e64f5ecd6b709b39"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgConnectionTest"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0b7c7a13b3bbc1ee8fee84ccb2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_707a6aa3409d0f78699b28acd5"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgConnection"`);
  }
}
