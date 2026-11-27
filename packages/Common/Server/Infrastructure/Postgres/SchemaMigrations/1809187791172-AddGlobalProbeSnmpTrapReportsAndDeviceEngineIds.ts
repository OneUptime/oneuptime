import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * SNMPv3 traps from devices that share an address, from global probes, and
 * from devices not added yet (OneUptime issues #11172, #11173, #11174):
 *
 *   - "GlobalProbeSnmpTrapReport": each project's share of a global probe's
 *     refused SNMPv3 traps, one row per project and probe. A new, empty
 *     table, so its indexes and keys are built as generated.
 *   - "NetworkDevice"."snmpEngineId": the engine ID a device's agent
 *     answered its last SNMPv3 poll with. Nullable, no default: adding it
 *     rewrites nothing.
 */
export class AddGlobalProbeSnmpTrapReportsAndDeviceEngineIds1809187791172
  implements MigrationInterface
{
  public name = "AddGlobalProbeSnmpTrapReportsAndDeviceEngineIds1809187791172";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "GlobalProbeSnmpTrapReport" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "probeId" uuid NOT NULL, "refusals" jsonb, CONSTRAINT "PK_83c302ea1dd1fdec5b373e3bf6c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_95e806d70f91e4c235e565b2af" ON "GlobalProbeSnmpTrapReport" ("probeId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_963c2b2f0b6486b4282935412c" ON "GlobalProbeSnmpTrapReport" ("projectId", "probeId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpEngineId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalProbeSnmpTrapReport" ADD CONSTRAINT "FK_7345bacc0a8c22b5dc09e0af618" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalProbeSnmpTrapReport" ADD CONSTRAINT "FK_95e806d70f91e4c235e565b2afd" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalProbeSnmpTrapReport" DROP CONSTRAINT "FK_95e806d70f91e4c235e565b2afd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalProbeSnmpTrapReport" DROP CONSTRAINT "FK_7345bacc0a8c22b5dc09e0af618"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpEngineId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_963c2b2f0b6486b4282935412c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_95e806d70f91e4c235e565b2af"`,
    );
    await queryRunner.query(`DROP TABLE "GlobalProbeSnmpTrapReport"`);
  }
}
