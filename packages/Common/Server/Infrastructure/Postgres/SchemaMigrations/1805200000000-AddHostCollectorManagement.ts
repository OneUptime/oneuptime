import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Hosts OneUptime installs and configures (the one-command install: the
 * OpenTelemetry Collector run by the OpAMP supervisor, which phones home to
 * OneUptime for its config).
 *
 *   - HostCollectorConfig: the Collector Configs of a project - their YAML,
 *     the system and labels of the hosts they are for, and their place in
 *     the drag-ordered list - with HostCollectorConfigLabel, their labels.
 *   - HostCollectorConfigVersion: every saved version of a config.
 *   - Host: what the collector OneUptime manages on a host reports - its
 *     instance, last contact, the config it should run (or was picked for
 *     it), the version it runs, whether that applied, its health, and
 *     what the installer found on the host for the default config to read.
 *
 * Generated with npm run generate-postgres-migration. The new tables are
 * empty, so their indexes and keys are made here. Every column added to
 * "Host" is nullable or has a constant default, so none rewrites the table;
 * nothing is backfilled, and every existing host reads as one whose
 * collector was installed by hand. The indexes and keys on "Host", which
 * already holds rows, are built online in the migration registered right
 * after this one: AddHostCollectorManagementIndexesAndKeys1805250000000.
 */
export class AddHostCollectorManagement1805200000000
  implements MigrationInterface
{
  public name: string = "AddHostCollectorManagement1805200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "HostCollectorConfig" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "osType" character varying(100) NOT NULL DEFAULT 'linux', "order" integer, "configYaml" text, "currentVersionNumber" integer NOT NULL DEFAULT '1', "configHash" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_25f2a01b7a3d37f55a7a906e2cb" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f447ee70a8a00cf0a5d5c04f0" ON "HostCollectorConfig" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1617308c4bf1d40fb8cbbd443a" ON "HostCollectorConfig" ("order") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostCollectorConfigVersion" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "hostCollectorConfigId" uuid NOT NULL, "versionNumber" integer NOT NULL, "configYaml" text NOT NULL, "configHash" character varying(100) NOT NULL, "changeNote" character varying(100), "createdByUserId" uuid, CONSTRAINT "PK_bb63f21bb7ffb99754c9fabd3fe" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9373b7de8ac2e0b7cb6ea71eb" ON "HostCollectorConfigVersion" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_60b5313c39ef5130dadda1a24e" ON "HostCollectorConfigVersion" ("hostCollectorConfigId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3bc2372fe915b076b997469843" ON "HostCollectorConfigVersion" ("configHash") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a6eced439492c07cf742f5ee7d" ON "HostCollectorConfigVersion" ("hostCollectorConfigId", "versionNumber") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostCollectorConfigLabel" ("hostCollectorConfigId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_0ca23b666f0a4701ae7198df409" PRIMARY KEY ("hostCollectorConfigId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6c866e23593dd475c1fe47498" ON "HostCollectorConfigLabel" ("hostCollectorConfigId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_571d2abd88f19e4f3f4a8379ab" ON "HostCollectorConfigLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "collectorInstanceUid" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "collectorLastContactAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "collectorRegisteredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "Host" ADD "collectorConfigId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "isCollectorConfigPinned" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "collectorConfigVersionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "collectorConfigHash" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "collectorConfigStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "collectorConfigError" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "collectorFailedConfigHash" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "isCollectorHealthy" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "collectorHealthError" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "collectorHostFeatures" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfig" ADD CONSTRAINT "FK_6f447ee70a8a00cf0a5d5c04f01" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfig" ADD CONSTRAINT "FK_ce51db7b020916032c2bcc9af14" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfig" ADD CONSTRAINT "FK_15014197ee6332c1fa46c3702b8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfigVersion" ADD CONSTRAINT "FK_f9373b7de8ac2e0b7cb6ea71eb9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfigVersion" ADD CONSTRAINT "FK_60b5313c39ef5130dadda1a24e9" FOREIGN KEY ("hostCollectorConfigId") REFERENCES "HostCollectorConfig"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfigVersion" ADD CONSTRAINT "FK_301a7e4cd6a6310088756217b36" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfigLabel" ADD CONSTRAINT "FK_f6c866e23593dd475c1fe47498c" FOREIGN KEY ("hostCollectorConfigId") REFERENCES "HostCollectorConfig"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfigLabel" ADD CONSTRAINT "FK_571d2abd88f19e4f3f4a8379ab8" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfigLabel" DROP CONSTRAINT "FK_571d2abd88f19e4f3f4a8379ab8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfigLabel" DROP CONSTRAINT "FK_f6c866e23593dd475c1fe47498c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfigVersion" DROP CONSTRAINT "FK_301a7e4cd6a6310088756217b36"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfigVersion" DROP CONSTRAINT "FK_60b5313c39ef5130dadda1a24e9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfigVersion" DROP CONSTRAINT "FK_f9373b7de8ac2e0b7cb6ea71eb9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfig" DROP CONSTRAINT "FK_15014197ee6332c1fa46c3702b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfig" DROP CONSTRAINT "FK_ce51db7b020916032c2bcc9af14"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostCollectorConfig" DROP CONSTRAINT "FK_6f447ee70a8a00cf0a5d5c04f01"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "collectorHostFeatures"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "collectorHealthError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "isCollectorHealthy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "collectorFailedConfigHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "collectorConfigError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "collectorConfigStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "collectorConfigHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "collectorConfigVersionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "isCollectorConfigPinned"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "collectorConfigId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "collectorRegisteredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "collectorLastContactAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "collectorInstanceUid"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_571d2abd88f19e4f3f4a8379ab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f6c866e23593dd475c1fe47498"`,
    );
    await queryRunner.query(`DROP TABLE "HostCollectorConfigLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a6eced439492c07cf742f5ee7d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3bc2372fe915b076b997469843"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_60b5313c39ef5130dadda1a24e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9373b7de8ac2e0b7cb6ea71eb"`,
    );
    await queryRunner.query(`DROP TABLE "HostCollectorConfigVersion"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1617308c4bf1d40fb8cbbd443a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f447ee70a8a00cf0a5d5c04f0"`,
    );
    await queryRunner.query(`DROP TABLE "HostCollectorConfig"`);
  }
}
