import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1749813704371 implements MigrationInterface {
  public name = "MigrationName1749813704371";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "StatusPageAnnouncementTemplate" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "templateName" character varying(100) NOT NULL, "templateDescription" character varying(500), "title" character varying(100) NOT NULL, "description" text NOT NULL, "shouldStatusPageSubscribersBeNotified" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_42d7cd04fe3d2c2e25288483072" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_19d05157cdb68a582d2489bc9e" ON "StatusPageAnnouncementTemplate" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AnnouncementTemplateStatusPage" ("announcementTemplateId" uuid NOT NULL, "statusPageId" uuid NOT NULL, CONSTRAINT "PK_8434706f7e047041ee73a3e8b76" PRIMARY KEY ("announcementTemplateId", "statusPageId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_182e3a7c2c910755382971e473" ON "AnnouncementTemplateStatusPage" ("announcementTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d64c5bcc98bd6a09fee1f5b247" ON "AnnouncementTemplateStatusPage" ("statusPageId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncementTemplate" ADD CONSTRAINT "FK_19d05157cdb68a582d2489bc9e1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncementTemplate" ADD CONSTRAINT "FK_9f1b244a75d53bd2d208934551a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncementTemplate" ADD CONSTRAINT "FK_ced5ce354456a65d71e39cd8e7d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AnnouncementTemplateStatusPage" ADD CONSTRAINT "FK_182e3a7c2c910755382971e4739" FOREIGN KEY ("announcementTemplateId") REFERENCES "StatusPageAnnouncementTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AnnouncementTemplateStatusPage" ADD CONSTRAINT "FK_d64c5bcc98bd6a09fee1f5b2473" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AnnouncementTemplateStatusPage" DROP CONSTRAINT "FK_d64c5bcc98bd6a09fee1f5b2473"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AnnouncementTemplateStatusPage" DROP CONSTRAINT "FK_182e3a7c2c910755382971e4739"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncementTemplate" DROP CONSTRAINT "FK_ced5ce354456a65d71e39cd8e7d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncementTemplate" DROP CONSTRAINT "FK_9f1b244a75d53bd2d208934551a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncementTemplate" DROP CONSTRAINT "FK_19d05157cdb68a582d2489bc9e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d64c5bcc98bd6a09fee1f5b247"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_182e3a7c2c910755382971e473"`,
    );
    await queryRunner.query(`DROP TABLE "AnnouncementTemplateStatusPage"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_19d05157cdb68a582d2489bc9e"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageAnnouncementTemplate"`);
  }
}
