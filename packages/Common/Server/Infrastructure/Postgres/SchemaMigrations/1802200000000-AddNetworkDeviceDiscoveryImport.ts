import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Imports of discovered hosts as network devices, on the server (Network >
 * Discovery > Review Results > Import; OneUptime issues #4811-#4815).
 *
 * NetworkDeviceDiscoveryImport is one import: the hosts the person ticked,
 * how the devices are monitored (settings), what happened to each host
 * (results) and the counts the progress bars read (progress). Internal: no
 * CRUD API, written by the import job and read through its own API.
 *
 * NetworkDeviceAutoImportRule.pollingIntervalInMinutes is the "Check every"
 * a rule's devices are polled at - the same choice the import offers - and
 * is nullable, so every existing rule keeps importing at the devices'
 * default.
 *
 * Generated with npm run generate-postgres-migration, then renumbered to the
 * next round slot above the registered migrations
 * (SchemaMigrationsOrdering.test). The table is new, so its indexes and
 * foreign keys are built while nothing writes to it, and the rule column is
 * nullable with no default, which Postgres adds without rewriting a row.
 */
export class AddNetworkDeviceDiscoveryImport1802200000000
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceDiscoveryImport1802200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceDiscoveryImport" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "networkDeviceDiscoveryScanId" uuid NOT NULL, "status" character varying(100) NOT NULL, "settings" jsonb NOT NULL, "hosts" jsonb NOT NULL, "results" jsonb NOT NULL, "progress" jsonb NOT NULL, "monitorTemplateName" character varying(100), "error" text, "stopRequestedAt" TIMESTAMP WITH TIME ZONE, "resumeCount" integer NOT NULL DEFAULT '0', "retryOfImportId" uuid, "createdByUserId" uuid, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_cb1e3db41ef54cfbdd0e06f3d71" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_029d4cde201042e86c02d2456d" ON "NetworkDeviceDiscoveryImport" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1b9012cbf0bc6f399bbcdd77d7" ON "NetworkDeviceDiscoveryImport" ("networkDeviceDiscoveryScanId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_89223ff196c1431e266e87f670" ON "NetworkDeviceDiscoveryImport" ("projectId", "status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" ADD "pollingIntervalInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryImport" ADD CONSTRAINT "FK_029d4cde201042e86c02d2456d4" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryImport" ADD CONSTRAINT "FK_78f2275b4b7f117d0e762347b0e" FOREIGN KEY ("networkDeviceDiscoveryScanId") REFERENCES "NetworkDeviceDiscoveryScan"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryImport" ADD CONSTRAINT "FK_f1ed771fb467a77ac93386f9aea" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryImport" DROP CONSTRAINT "FK_f1ed771fb467a77ac93386f9aea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryImport" DROP CONSTRAINT "FK_78f2275b4b7f117d0e762347b0e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryImport" DROP CONSTRAINT "FK_029d4cde201042e86c02d2456d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" DROP COLUMN "pollingIntervalInMinutes"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_89223ff196c1431e266e87f670"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b9012cbf0bc6f399bbcdd77d7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_029d4cde201042e86c02d2456d"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkDeviceDiscoveryImport"`);
  }
}
