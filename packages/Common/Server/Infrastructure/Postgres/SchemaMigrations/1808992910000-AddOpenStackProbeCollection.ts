import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOpenStackProbeCollection1808992910000 implements MigrationInterface {
    name = 'AddOpenStackProbeCollection1808992910000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "OpenStackCloudConnectionTest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "openStackCloudId" uuid, "probeId" uuid NOT NULL, "authUrl" character varying(500) NOT NULL, "endpointInterface" character varying(100) NOT NULL DEFAULT 'public', "collectionRegions" jsonb, "credentialKind" character varying(100), "applicationCredentialId" character varying(500), "keystoneUsername" character varying(500), "userDomainName" character varying(500), "projectName" character varying(500), "projectDomainName" character varying(500), "credentialSecret" text, "trustedCertificateFingerprints" jsonb, "status" character varying(100) NOT NULL DEFAULT 'Pending', "errorCode" character varying(100), "errorMessage" character varying(500), "presentedCertificate" jsonb, "summary" jsonb, "claimedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_9df3a3a36a5d3a733d9185d5fdd" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f990b3afad9353a5fc12751001" ON "OpenStackCloudConnectionTest" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_424e5e7b4e90af1f825b612eca" ON "OpenStackCloudConnectionTest" ("probeId", "status") `);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "collectionMethod" character varying(100) NOT NULL DEFAULT 'Agent'`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "authUrl" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "endpointInterface" character varying(100) NOT NULL DEFAULT 'public'`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "collectionRegions" jsonb`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "credentialKind" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "applicationCredentialId" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "keystoneUsername" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "userDomainName" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "projectName" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "projectDomainName" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "credentialSecret" text`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "isCredentialSet" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "credentialsUpdatedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "collectionProbeId" uuid`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "trustedCertificateFingerprints" jsonb`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "collectionIntervalInMinutes" integer NOT NULL DEFAULT '2'`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "collectionOptions" jsonb`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "collectionStatus" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "collectionErrorCode" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "collectionError" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "presentedCertificate" jsonb`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "collectionSummary" jsonb`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "nextCollectionAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "lastCollectionAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "lastSuccessfulCollectionAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "collectionSettingsVersion" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudConnectionTest" ADD CONSTRAINT "FK_f990b3afad9353a5fc12751001d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudConnectionTest" ADD CONSTRAINT "FK_336794820803518bae4bf576bc2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudConnectionTest" ADD CONSTRAINT "FK_58ada20095cb2252e69b712d736" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudConnectionTest" ADD CONSTRAINT "FK_de876efb794f90fef230841a7a0" FOREIGN KEY ("openStackCloudId") REFERENCES "OpenStackCloud"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudConnectionTest" ADD CONSTRAINT "FK_853661eff3f7403468460f3815d" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OpenStackCloudConnectionTest" DROP CONSTRAINT "FK_853661eff3f7403468460f3815d"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudConnectionTest" DROP CONSTRAINT "FK_de876efb794f90fef230841a7a0"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudConnectionTest" DROP CONSTRAINT "FK_58ada20095cb2252e69b712d736"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudConnectionTest" DROP CONSTRAINT "FK_336794820803518bae4bf576bc2"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloudConnectionTest" DROP CONSTRAINT "FK_f990b3afad9353a5fc12751001d"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "collectionSettingsVersion"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "lastSuccessfulCollectionAt"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "lastCollectionAt"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "nextCollectionAt"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "collectionSummary"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "presentedCertificate"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "collectionError"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "collectionErrorCode"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "collectionStatus"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "collectionOptions"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "collectionIntervalInMinutes"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "trustedCertificateFingerprints"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "collectionProbeId"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "credentialsUpdatedAt"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "isCredentialSet"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "credentialSecret"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "projectDomainName"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "projectName"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "userDomainName"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "keystoneUsername"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "applicationCredentialId"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "credentialKind"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "collectionRegions"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "endpointInterface"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "authUrl"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "collectionMethod"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_424e5e7b4e90af1f825b612eca"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f990b3afad9353a5fc12751001"`);
        await queryRunner.query(`DROP TABLE "OpenStackCloudConnectionTest"`);
    }

}
