import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNetworkDeviceDiagnostic1792800000000
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceDiagnostic1792800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceDiagnostic" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "networkDeviceId" uuid NOT NULL, "probeId" uuid, "diagnosticType" character varying(100) NOT NULL, "hostname" character varying(100), "status" character varying(100) NOT NULL DEFAULT 'Pending', "statusMessage" character varying(500), "pingResult" jsonb, "traceRouteResult" jsonb, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_0e5c2708afc3c926bf99bc51c40" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8659f71bad567d47b495dd4c6f" ON "NetworkDeviceDiagnostic" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4961dcfecdb594d5061c923608" ON "NetworkDeviceDiagnostic" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_423b6adb0bf7889d961a342178" ON "NetworkDeviceDiagnostic" ("probeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f7546ffb98420343c4528f156b" ON "NetworkDeviceDiagnostic" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2a7ba3245c473ca84debc8581b" ON "NetworkDeviceDiagnostic" ("probeId", "status", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_070c0234feb0ea18739972c038" ON "NetworkDeviceDiagnostic" ("projectId", "networkDeviceId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" ADD CONSTRAINT "FK_8659f71bad567d47b495dd4c6ff" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" ADD CONSTRAINT "FK_4961dcfecdb594d5061c9236087" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" ADD CONSTRAINT "FK_423b6adb0bf7889d961a3421782" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" ADD CONSTRAINT "FK_0844a7513a2f2d6ccf50e16d320" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" ADD CONSTRAINT "FK_2f81372c0b481cc7c9aa5f90c6d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" DROP CONSTRAINT "FK_2f81372c0b481cc7c9aa5f90c6d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" DROP CONSTRAINT "FK_0844a7513a2f2d6ccf50e16d320"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" DROP CONSTRAINT "FK_423b6adb0bf7889d961a3421782"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" DROP CONSTRAINT "FK_4961dcfecdb594d5061c9236087"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" DROP CONSTRAINT "FK_8659f71bad567d47b495dd4c6ff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_070c0234feb0ea18739972c038"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2a7ba3245c473ca84debc8581b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f7546ffb98420343c4528f156b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_423b6adb0bf7889d961a342178"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4961dcfecdb594d5061c923608"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8659f71bad567d47b495dd4c6f"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkDeviceDiagnostic"`);
  }
}
