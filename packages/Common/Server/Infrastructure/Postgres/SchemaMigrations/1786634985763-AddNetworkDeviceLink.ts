import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The generator was run against a database that did not yet have
 * 1786625176831-AddMonitoringMethodToNetworkDevice applied, so it also
 * emitted that migration's NetworkDevice.monitoringMethod / monitorId
 * statements. Those are removed here: running them twice fails with
 * "column already exists", and each migration owns one change.
 */
export class AddNetworkDeviceLink1786634985763 implements MigrationInterface {
  public name: string = "AddNetworkDeviceLink1786634985763";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceLink" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100), "fromDeviceId" uuid NOT NULL, "toDeviceId" uuid NOT NULL, "fromPortName" character varying(100), "toPortName" character varying(100), "monitorId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_44f9eb8a79f74fbad22970dcd69" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c13d3b043b6ff5b1f6b3875e7c" ON "NetworkDeviceLink" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3aa05e29761d9144b2fab79ddd" ON "NetworkDeviceLink" ("fromDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_860dd94c53f67b093d90f8acd9" ON "NetworkDeviceLink" ("toDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3382158f7a89861165c7bf040d" ON "NetworkDeviceLink" ("projectId", "fromDeviceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" ADD CONSTRAINT "FK_c13d3b043b6ff5b1f6b3875e7c2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" ADD CONSTRAINT "FK_3aa05e29761d9144b2fab79ddda" FOREIGN KEY ("fromDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" ADD CONSTRAINT "FK_860dd94c53f67b093d90f8acd91" FOREIGN KEY ("toDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" ADD CONSTRAINT "FK_56a26ec58d99b2c70061ea1d737" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" ADD CONSTRAINT "FK_1c0841ce17c095d7dc06f1bdb73" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" ADD CONSTRAINT "FK_60fb427dfafc613acacdbf58125" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" DROP CONSTRAINT "FK_60fb427dfafc613acacdbf58125"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" DROP CONSTRAINT "FK_1c0841ce17c095d7dc06f1bdb73"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" DROP CONSTRAINT "FK_56a26ec58d99b2c70061ea1d737"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" DROP CONSTRAINT "FK_860dd94c53f67b093d90f8acd91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" DROP CONSTRAINT "FK_3aa05e29761d9144b2fab79ddda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" DROP CONSTRAINT "FK_c13d3b043b6ff5b1f6b3875e7c2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3382158f7a89861165c7bf040d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_860dd94c53f67b093d90f8acd9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3aa05e29761d9144b2fab79ddd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c13d3b043b6ff5b1f6b3875e7c"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkDeviceLink"`);
  }
}
