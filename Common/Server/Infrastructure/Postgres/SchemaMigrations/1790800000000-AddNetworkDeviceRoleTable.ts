import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Device roles become a per-project lookup instead of a fixed union.
 *
 * "deviceRole" (the inline string on NetworkDevice) is NOT touched here: the
 * BackfillNetworkDeviceRoles data migration still reads it to point every
 * device that has one at its new NetworkDeviceRole row. It is dropped in a
 * follow-up once that backfill has run everywhere.
 *
 * networkDeviceRoleId is ON DELETE SET NULL on purpose. Deleting a role from
 * the project's settings must not delete the devices using it - they simply go
 * back to being classified from their own SNMP identity, which is exactly what
 * a NULL role has always meant.
 */
export class AddNetworkDeviceRoleTable1790800000000
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceRoleTable1790800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceRole" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "key" character varying(100) NOT NULL, "description" character varying(500), "topologyShape" character varying(100), "isCoreLayer" boolean NOT NULL DEFAULT false, "isSnmpWalkable" boolean NOT NULL DEFAULT true, "order" integer, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_10fb79a5d66950e4a9c6d774d07" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_188009b80d1281f1d7ccecdf74" ON "NetworkDeviceRole" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "networkDeviceRoleId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41f59fed52c5ec4ff6a2725ad9" ON "NetworkDevice" ("networkDeviceRoleId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceRole" ADD CONSTRAINT "FK_188009b80d1281f1d7ccecdf74d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceRole" ADD CONSTRAINT "FK_9860e7a5b4d23cf1c4192c468cd" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceRole" ADD CONSTRAINT "FK_9dc66fa19636ba160af1521f45d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_41f59fed52c5ec4ff6a2725ad9a" FOREIGN KEY ("networkDeviceRoleId") REFERENCES "NetworkDeviceRole"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_41f59fed52c5ec4ff6a2725ad9a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceRole" DROP CONSTRAINT "FK_9dc66fa19636ba160af1521f45d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceRole" DROP CONSTRAINT "FK_9860e7a5b4d23cf1c4192c468cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceRole" DROP CONSTRAINT "FK_188009b80d1281f1d7ccecdf74d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_41f59fed52c5ec4ff6a2725ad9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "networkDeviceRoleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_188009b80d1281f1d7ccecdf74"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkDeviceRole"`);
  }
}
