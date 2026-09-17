import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Auto-import rules for network device discovery (issue #3378): a rule table
 * whose conditions decide which discovered hosts become Network Devices with
 * no manual review step, plus a processed-marker column on the scan so the
 * worker that evaluates the rules knows which results it has already seen.
 */
export class AddNetworkDeviceAutoImportRule1789100000000
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceAutoImportRule1789100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceAutoImportRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "ipMatchTarget" character varying(100), "sysNamePattern" character varying(500), "sysDescrPattern" character varying(500), "includePingOnlyHosts" boolean NOT NULL DEFAULT false, "isExclusion" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_network_device_auto_import_rule_id" PRIMARY KEY ("_id"))`,
    );

    for (const column of ["projectId", "name", "isEnabled", "isExclusion"]) {
      await queryRunner.query(
        `CREATE INDEX "IDX_network_device_auto_import_rule_${column}" ON "NetworkDeviceAutoImportRule" ("${column}")`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" ADD CONSTRAINT "FK_nd_auto_import_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" ADD CONSTRAINT "FK_nd_auto_import_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" ADD CONSTRAINT "FK_nd_auto_import_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "autoImportProcessedAt" TIMESTAMP WITH TIME ZONE`,
    );

    /*
     * Backfill EVERY existing scan as already-processed, making the feature
     * forward-only. One-shot scans stay "Completed" forever, so without this
     * every scan ever run would sit unprocessed and the first rule a project
     * creates would mass-import months-old results — the opposite of what an
     * operator writing a rule about FUTURE discoveries intends. Old results
     * remain reachable on purpose through the rule's explicit "Run Now".
     */
    await queryRunner.query(
      `UPDATE "NetworkDeviceDiscoveryScan" SET "autoImportProcessedAt" = now()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "autoImportProcessedAt"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "NetworkDeviceAutoImportRule"`,
    );
  }
}
