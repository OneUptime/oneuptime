import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The instance's receiving ledger (OneUptime issue #2825): one row per
 * unbroken stretch of time OneUptime was up and receiving data, so the time
 * between two rows - a restart, an upgrade, an unreachable datastore - is
 * never held against a host or a monitor. A new table, so its indexes are
 * built on an empty table and need no online DDL. Existing installations
 * start with an empty ledger: everything before the first heartbeat reads as
 * it always did.
 */
export class AddInstanceReceivingPeriod1801150000000
  implements MigrationInterface
{
  public name: string = "AddInstanceReceivingPeriod1801150000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "InstanceReceivingPeriod" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastReceivingAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_304bbc0c96ca27b33c5b23f35ef" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9997eb26f1d7a31e22935905fd" ON "InstanceReceivingPeriod" ("startedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_179ce64c1c0b541261488f4b2f" ON "InstanceReceivingPeriod" ("lastReceivingAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_179ce64c1c0b541261488f4b2f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9997eb26f1d7a31e22935905fd"`,
    );
    await queryRunner.query(`DROP TABLE "InstanceReceivingPeriod"`);
  }
}
