import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOpenStackCloudCheck1808993900000 implements MigrationInterface {
    name = 'AddOpenStackCloudCheck1808993900000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "OpenStackCloudCheck" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "openStackCloudId" uuid NOT NULL, "probeId" uuid, "authUrl" character varying(500), "endpointInterface" character varying(100), "regions" jsonb, "trustedCertificateFingerprints" jsonb, "credentialKind" character varying(100), "applicationCredentialId" character varying(500), "keystoneUsername" character varying(500), "userDomainName" character varying(500), "credentialProjectName" character varying(500), "credentialProjectDomainName" character varying(500), "credentialSecret" text, "isCredentialSet" boolean NOT NULL DEFAULT false, "credentialsUpdatedAt" TIMESTAMP WITH TIME ZONE, "credentialBinding" jsonb, "isApiCheckEnabled" boolean NOT NULL DEFAULT false, "apiCheckIntervalInMinutes" integer NOT NULL DEFAULT '1', "nextApiCheckAt" TIMESTAMP WITH TIME ZONE, "lastApiCheckAt" TIMESTAMP WITH TIME ZONE, "apiCheckResult" jsonb, "isLifecycleCheckEnabled" boolean NOT NULL DEFAULT false, "lifecycleCheckIntervalInMinutes" integer NOT NULL DEFAULT '30', "lifecycleProjectName" character varying(500), "pinnedLifecycleProjectId" character varying(500), "lifecycleCheckOptions" jsonb, "nextLifecycleCheckAt" TIMESTAMP WITH TIME ZONE, "lastLifecycleCheckAt" TIMESTAMP WITH TIME ZONE, "lifecycleRunRequestedAt" TIMESTAMP WITH TIME ZONE, "lifecycleRecords" jsonb, "isSweepPending" boolean NOT NULL DEFAULT false, "osProfilerKey" text, "isOsProfilerKeySet" boolean NOT NULL DEFAULT false, "settingsVersion" integer NOT NULL DEFAULT '0', "checkError" character varying(500), CONSTRAINT "PK_c821c55fc16b9d61d8eaaeb89ac" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_518ccf463548bcf93049117132" ON "OpenStackCloudCheck" ("projectId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_21f9f6228a2f8f88258add609c" ON "OpenStackCloudCheck" ("openStackCloudId") `);
        await queryRunner.query(`CREATE INDEX "IDX_235da136e89f602c2f8e85704b" ON "OpenStackCloudCheck" ("probeId") `);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudCheck" ADD CONSTRAINT "FK_518ccf463548bcf930491171328" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudCheck" ADD CONSTRAINT "FK_42b08de14d7ab5b68bbfbfa7093" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudCheck" ADD CONSTRAINT "FK_f14a2086bddc129ea19f2f1aa1b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudCheck" ADD CONSTRAINT "FK_21f9f6228a2f8f88258add609cb" FOREIGN KEY ("openStackCloudId") REFERENCES "OpenStackCloud"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudCheck" ADD CONSTRAINT "FK_235da136e89f602c2f8e85704b9" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OpenStackCloudCheck" DROP CONSTRAINT "FK_235da136e89f602c2f8e85704b9"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudCheck" DROP CONSTRAINT "FK_21f9f6228a2f8f88258add609cb"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudCheck" DROP CONSTRAINT "FK_f14a2086bddc129ea19f2f1aa1b"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudCheck" DROP CONSTRAINT "FK_42b08de14d7ab5b68bbfbfa7093"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudCheck" DROP CONSTRAINT "FK_518ccf463548bcf930491171328"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_235da136e89f602c2f8e85704b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_21f9f6228a2f8f88258add609c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_518ccf463548bcf93049117132"`);
        await queryRunner.query(`DROP TABLE "OpenStackCloudCheck"`);
    }

}
