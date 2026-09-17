import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1742302093234 implements MigrationInterface {
  public name = "MigrationName1742302093234";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MonitorFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "monitorId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "monitorFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_9966ea209535f456f02654b300e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff44b198d069485d5a1b67c800" ON "MonitorFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24b84143b15a609c310bbbe0a1" ON "MonitorFeed" ("monitorId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorFeed" ADD CONSTRAINT "FK_ff44b198d069485d5a1b67c8000" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorFeed" ADD CONSTRAINT "FK_24b84143b15a609c310bbbe0a10" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorFeed" ADD CONSTRAINT "FK_211b1c90f65e6f121771964039c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorFeed" ADD CONSTRAINT "FK_175252c1e94dbb49d7a8c921c21" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorFeed" ADD CONSTRAINT "FK_0bbe0d94cdca54573f3f9860619" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorFeed" DROP CONSTRAINT "FK_0bbe0d94cdca54573f3f9860619"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorFeed" DROP CONSTRAINT "FK_175252c1e94dbb49d7a8c921c21"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorFeed" DROP CONSTRAINT "FK_211b1c90f65e6f121771964039c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorFeed" DROP CONSTRAINT "FK_24b84143b15a609c310bbbe0a10"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorFeed" DROP CONSTRAINT "FK_ff44b198d069485d5a1b67c8000"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24b84143b15a609c310bbbe0a1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff44b198d069485d5a1b67c800"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorFeed"`);
  }
}
