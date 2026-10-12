import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Packet captures run on a project's probes: PacketCapture is one capture
 * (its probe, interface, filter and limits, where it is in its run, and the
 * pcap file it produced, a private File of the project), and
 * Probe.packetCaptureCapability is what each probe last reported about
 * capturing. The table is new, so its indexes and foreign keys are built
 * while nothing writes to it; the probe column is nullable with no default,
 * so adding it rewrites nothing.
 */
export class AddPacketCapture1800800000000 implements MigrationInterface {
  public name: string = "AddPacketCapture1800800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "PacketCapture" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "probeId" uuid, "networkDeviceId" uuid, "name" character varying(100), "interfaceName" character varying(100) NOT NULL, "bpfFilter" character varying(500), "maxDurationInSeconds" integer NOT NULL DEFAULT '60', "maxPackets" integer NOT NULL DEFAULT '100000', "maxFileSizeInMB" integer NOT NULL DEFAULT '10', "status" character varying(100) NOT NULL DEFAULT 'Pending', "statusMessage" character varying(500), "endReason" character varying(100), "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "stopRequestedAt" TIMESTAMP WITH TIME ZONE, "packetCount" integer, "fileSizeInBytes" integer, "fileId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_5ffaad74914284b1c21e783ee09" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6076e48ca00897ca66fdde326b" ON "PacketCapture" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08650232584ce028fd78402ec6" ON "PacketCapture" ("probeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_83aa85a13308f3fc0faefdcc37" ON "PacketCapture" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c6d0645ec9fd803121c499166" ON "PacketCapture" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_412f032f24a2dd55d8f3706904" ON "PacketCapture" ("projectId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bb92268518d5f39ef807f3e44e" ON "PacketCapture" ("probeId", "status", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD "packetCaptureCapability" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" ADD CONSTRAINT "FK_6076e48ca00897ca66fdde326b1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" ADD CONSTRAINT "FK_08650232584ce028fd78402ec64" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" ADD CONSTRAINT "FK_83aa85a13308f3fc0faefdcc370" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" ADD CONSTRAINT "FK_d3b5b7489eb61e6f1b529676213" FOREIGN KEY ("fileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" ADD CONSTRAINT "FK_5acd8022586676feee963f83abd" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" ADD CONSTRAINT "FK_3c8350d5a9f304a9e0096c6aaeb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" DROP CONSTRAINT "FK_3c8350d5a9f304a9e0096c6aaeb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" DROP CONSTRAINT "FK_5acd8022586676feee963f83abd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" DROP CONSTRAINT "FK_d3b5b7489eb61e6f1b529676213"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" DROP CONSTRAINT "FK_83aa85a13308f3fc0faefdcc370"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" DROP CONSTRAINT "FK_08650232584ce028fd78402ec64"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PacketCapture" DROP CONSTRAINT "FK_6076e48ca00897ca66fdde326b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP COLUMN "packetCaptureCapability"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb92268518d5f39ef807f3e44e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_412f032f24a2dd55d8f3706904"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c6d0645ec9fd803121c499166"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_83aa85a13308f3fc0faefdcc37"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08650232584ce028fd78402ec6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6076e48ca00897ca66fdde326b"`,
    );
    await queryRunner.query(`DROP TABLE "PacketCapture"`);
  }
}
