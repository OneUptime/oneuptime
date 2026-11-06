import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOpenStackProjectNotices1808994120000
  implements MigrationInterface
{
  public name: string = "AddOpenStackProjectNotices1808994120000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "OpenStackProjectNotice" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "openStackCloudId" uuid NOT NULL, "openStackProjectId" character varying(100) NOT NULL, "email" character varying(100), "webhookUrl" character varying, "statusPageId" uuid, "statusPageRows" jsonb, "isEnabled" boolean NOT NULL DEFAULT false, "previewSeenAt" TIMESTAMP WITH TIME ZONE, "previewSeenByUserId" uuid, "previewedRecipient" character varying(100), "previewToken" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_493ed7390c721a90f2fcd8e7352" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac99a9e35cfa2eef7780a2486e" ON "OpenStackProjectNotice" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_49025d84a4e38d6c71abf91755" ON "OpenStackProjectNotice" ("openStackCloudId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8efb1990922e878de204a18ec0" ON "OpenStackProjectNotice" ("openStackProjectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_49675c639a17d558892c367bb7" ON "OpenStackProjectNotice" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ae72a19c58b236d6a3ecdaf29" ON "OpenStackProjectNotice" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OpenStackProjectNoticeDelivery" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "openStackCloudId" uuid NOT NULL, "openStackProjectNoticeId" uuid NOT NULL, "openStackProjectId" character varying(100) NOT NULL, "event" character varying(100) NOT NULL, "dedupeKey" character varying(100) NOT NULL, "partKey" character varying(500) NOT NULL, "incidentId" uuid, "scheduledMaintenanceId" uuid, "statusPageAnnouncementId" uuid, "facts" jsonb NOT NULL, "status" character varying(100) NOT NULL DEFAULT 'Pending', "statusMessage" character varying(500), "attempts" integer NOT NULL DEFAULT '0', "nextAttemptAt" TIMESTAMP WITH TIME ZONE, "sentAt" TIMESTAMP WITH TIME ZONE, "closedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_74f31d3f7d6d2a74d41de370d7c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8884fcecd75f7c34f001677db4" ON "OpenStackProjectNoticeDelivery" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_877f7fc3c8eb746da695d9bf33" ON "OpenStackProjectNoticeDelivery" ("openStackCloudId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b90372080d960faef31825d386" ON "OpenStackProjectNoticeDelivery" ("openStackProjectNoticeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccd676c2ff86f1a5e6e7711b80" ON "OpenStackProjectNoticeDelivery" ("openStackProjectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12f65160ffabd00278788d08fe" ON "OpenStackProjectNoticeDelivery" ("partKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f3bfa7c83818aff12ef65e3f12" ON "OpenStackProjectNoticeDelivery" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd045fee3b17baaa5ff4587d94" ON "OpenStackProjectNoticeDelivery" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ef1ad0d078ae9f9056686bd78" ON "OpenStackProjectNoticeDelivery" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_077544c18e4a4d19e63d19d0ae" ON "OpenStackProjectNoticeDelivery" ("status", "nextAttemptAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_42d1887f1ccd5b103c2bc16423" ON "OpenStackProjectNoticeDelivery" ("openStackProjectNoticeId", "dedupeKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "openStackParts" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" ADD CONSTRAINT "FK_ac99a9e35cfa2eef7780a2486ef" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" ADD CONSTRAINT "FK_49025d84a4e38d6c71abf91755c" FOREIGN KEY ("openStackCloudId") REFERENCES "OpenStackCloud"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" ADD CONSTRAINT "FK_49675c639a17d558892c367bb75" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" ADD CONSTRAINT "FK_bc08386aae3ed122ad77286ca92" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" ADD CONSTRAINT "FK_3e3453e6d6b4987447bbfdba0eb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNoticeDelivery" ADD CONSTRAINT "FK_8884fcecd75f7c34f001677db4e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNoticeDelivery" ADD CONSTRAINT "FK_877f7fc3c8eb746da695d9bf33c" FOREIGN KEY ("openStackCloudId") REFERENCES "OpenStackCloud"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNoticeDelivery" ADD CONSTRAINT "FK_b90372080d960faef31825d3869" FOREIGN KEY ("openStackProjectNoticeId") REFERENCES "OpenStackProjectNotice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNoticeDelivery" ADD CONSTRAINT "FK_d4be9d9671dad56d13e7e636c0e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNoticeDelivery" ADD CONSTRAINT "FK_215eaa78939d58f5e038f975ade" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNoticeDelivery" DROP CONSTRAINT "FK_215eaa78939d58f5e038f975ade"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNoticeDelivery" DROP CONSTRAINT "FK_d4be9d9671dad56d13e7e636c0e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNoticeDelivery" DROP CONSTRAINT "FK_b90372080d960faef31825d3869"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNoticeDelivery" DROP CONSTRAINT "FK_877f7fc3c8eb746da695d9bf33c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNoticeDelivery" DROP CONSTRAINT "FK_8884fcecd75f7c34f001677db4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" DROP CONSTRAINT "FK_3e3453e6d6b4987447bbfdba0eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" DROP CONSTRAINT "FK_bc08386aae3ed122ad77286ca92"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" DROP CONSTRAINT "FK_49675c639a17d558892c367bb75"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" DROP CONSTRAINT "FK_49025d84a4e38d6c71abf91755c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" DROP CONSTRAINT "FK_ac99a9e35cfa2eef7780a2486ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "openStackParts"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42d1887f1ccd5b103c2bc16423"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_077544c18e4a4d19e63d19d0ae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ef1ad0d078ae9f9056686bd78"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd045fee3b17baaa5ff4587d94"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f3bfa7c83818aff12ef65e3f12"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12f65160ffabd00278788d08fe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ccd676c2ff86f1a5e6e7711b80"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b90372080d960faef31825d386"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_877f7fc3c8eb746da695d9bf33"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8884fcecd75f7c34f001677db4"`,
    );
    await queryRunner.query(`DROP TABLE "OpenStackProjectNoticeDelivery"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1ae72a19c58b236d6a3ecdaf29"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_49675c639a17d558892c367bb7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8efb1990922e878de204a18ec0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_49025d84a4e38d6c71abf91755"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac99a9e35cfa2eef7780a2486e"`,
    );
    await queryRunner.query(`DROP TABLE "OpenStackProjectNotice"`);
  }
}
