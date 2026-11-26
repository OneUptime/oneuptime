import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStorageArrayConnections1809187740000
  implements MigrationInterface
{
  public name = "AddStorageArrayConnections1809187740000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "StorageArrayConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "storageSystem" character varying(100) NOT NULL DEFAULT 'dell.powermax', "address" character varying(500) NOT NULL, "username" character varying(500) NOT NULL, "password" text, "isPasswordSet" boolean NOT NULL DEFAULT false, "credentialsUpdatedAt" TIMESTAMP WITH TIME ZONE, "collectionProbeId" uuid, "trustedCertificateFingerprint" character varying(100), "collectionIntervalInMinutes" integer NOT NULL DEFAULT '5', "collectionStatus" character varying(100), "collectionErrorCode" character varying(100), "collectionError" character varying(500), "presentedCertificate" jsonb, "collectionSummary" jsonb, "nextCollectionAt" TIMESTAMP WITH TIME ZONE, "lastCollectionAt" TIMESTAMP WITH TIME ZONE, "lastSuccessfulCollectionAt" TIMESTAMP WITH TIME ZONE, "collectionSettingsVersion" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, CONSTRAINT "PK_5799e9a15dc35963ec6bd8e86da" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f84da69ccc64e41449a5e5820" ON "StorageArrayConnection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9601113f38ce4340dde8d36ec5" ON "StorageArrayConnection" ("collectionProbeId", "nextCollectionAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0aaa3d6414639f81caf70b6ed7" ON "StorageArrayConnection" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayConnectionTest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "createdByUserId" uuid, "storageArrayConnectionId" uuid, "probeId" uuid NOT NULL, "storageSystem" character varying(100) NOT NULL DEFAULT 'dell.powermax', "address" character varying(500) NOT NULL, "username" character varying(500) NOT NULL, "password" text, "trustedCertificateFingerprint" character varying(100), "status" character varying(100) NOT NULL DEFAULT 'Pending', "errorCode" character varying(100), "errorMessage" character varying(500), "presentedCertificate" jsonb, "summary" jsonb, "claimedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e60607748e5e8d93cbba4e6ac98" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28c2fd7d43e758c14270f88745" ON "StorageArrayConnectionTest" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_602490deab77df652d846a02e1" ON "StorageArrayConnectionTest" ("probeId", "status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnection" ADD CONSTRAINT "FK_8f84da69ccc64e41449a5e5820e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnection" ADD CONSTRAINT "FK_ee58ed0032ba3a1b5d2456d7412" FOREIGN KEY ("collectionProbeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnection" ADD CONSTRAINT "FK_841b30a45eecfd74e32cd3f1698" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnectionTest" ADD CONSTRAINT "FK_28c2fd7d43e758c14270f88745c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnectionTest" ADD CONSTRAINT "FK_777a1bec2b4605bc9a0f0c603e2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnectionTest" ADD CONSTRAINT "FK_d878461489249c0cc99f810ac0a" FOREIGN KEY ("storageArrayConnectionId") REFERENCES "StorageArrayConnection"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnectionTest" ADD CONSTRAINT "FK_00ffe85b18bc4c78c278da0fe3e" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnectionTest" DROP CONSTRAINT "FK_00ffe85b18bc4c78c278da0fe3e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnectionTest" DROP CONSTRAINT "FK_d878461489249c0cc99f810ac0a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnectionTest" DROP CONSTRAINT "FK_777a1bec2b4605bc9a0f0c603e2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnectionTest" DROP CONSTRAINT "FK_28c2fd7d43e758c14270f88745c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnection" DROP CONSTRAINT "FK_841b30a45eecfd74e32cd3f1698"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnection" DROP CONSTRAINT "FK_ee58ed0032ba3a1b5d2456d7412"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayConnection" DROP CONSTRAINT "FK_8f84da69ccc64e41449a5e5820e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_602490deab77df652d846a02e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_28c2fd7d43e758c14270f88745"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayConnectionTest"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0aaa3d6414639f81caf70b6ed7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9601113f38ce4340dde8d36ec5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f84da69ccc64e41449a5e5820"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayConnection"`);
  }
}
