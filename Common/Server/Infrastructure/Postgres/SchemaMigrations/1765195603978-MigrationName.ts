import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1765195603978 implements MigrationInterface {
  public name = "MigrationName1765195603978";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "StatusPageSubscriberNotificationTemplate" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "templateName" character varying(100) NOT NULL, "templateDescription" character varying(500), "eventType" character varying(100) NOT NULL, "notificationMethod" character varying(100) NOT NULL, "emailSubject" character varying(100), "templateBody" text NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_888aab2dd71014a62b1e63d0a84" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4e26098c2348c3c174445f684c" ON "StatusPageSubscriberNotificationTemplate" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a96cca1609d2b6c6c304591919" ON "StatusPageSubscriberNotificationTemplate" ("eventType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2e059fde7e7d36c351b9781aee" ON "StatusPageSubscriberNotificationTemplate" ("notificationMethod") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StatusPageSubscriberNotificationTemplateStatusPage" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "statusPageId" uuid NOT NULL, "statusPageSubscriberNotificationTemplateId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_4e9d88b250d2b9ade6e9ed8835a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f5949a20800915de6803e1c90" ON "StatusPageSubscriberNotificationTemplateStatusPage" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8c9b514bad5354de082eb0df3f" ON "StatusPageSubscriberNotificationTemplateStatusPage" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9bdd3b77bb407157739b625d66" ON "StatusPageSubscriberNotificationTemplateStatusPage" ("statusPageSubscriberNotificationTemplateId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplate" ADD CONSTRAINT "FK_4e26098c2348c3c174445f684c8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplate" ADD CONSTRAINT "FK_bf757acb0d1e9fc9fa8275e9253" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplate" ADD CONSTRAINT "FK_3816e7182ec941de644cd50f0c6" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplateStatusPage" ADD CONSTRAINT "FK_0f5949a20800915de6803e1c90c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplateStatusPage" ADD CONSTRAINT "FK_8c9b514bad5354de082eb0df3f1" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplateStatusPage" ADD CONSTRAINT "FK_9bdd3b77bb407157739b625d66e" FOREIGN KEY ("statusPageSubscriberNotificationTemplateId") REFERENCES "StatusPageSubscriberNotificationTemplate"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplateStatusPage" ADD CONSTRAINT "FK_0a2c2209fd6900274784ca6e0ec" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplateStatusPage" ADD CONSTRAINT "FK_4284edba6904c9f02ce7d85c445" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplateStatusPage" DROP CONSTRAINT "FK_4284edba6904c9f02ce7d85c445"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplateStatusPage" DROP CONSTRAINT "FK_0a2c2209fd6900274784ca6e0ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplateStatusPage" DROP CONSTRAINT "FK_9bdd3b77bb407157739b625d66e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplateStatusPage" DROP CONSTRAINT "FK_8c9b514bad5354de082eb0df3f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplateStatusPage" DROP CONSTRAINT "FK_0f5949a20800915de6803e1c90c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplate" DROP CONSTRAINT "FK_3816e7182ec941de644cd50f0c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplate" DROP CONSTRAINT "FK_bf757acb0d1e9fc9fa8275e9253"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberNotificationTemplate" DROP CONSTRAINT "FK_4e26098c2348c3c174445f684c8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9bdd3b77bb407157739b625d66"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8c9b514bad5354de082eb0df3f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f5949a20800915de6803e1c90"`,
    );
    await queryRunner.query(
      `DROP TABLE "StatusPageSubscriberNotificationTemplateStatusPage"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2e059fde7e7d36c351b9781aee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a96cca1609d2b6c6c304591919"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4e26098c2348c3c174445f684c"`,
    );
    await queryRunner.query(
      `DROP TABLE "StatusPageSubscriberNotificationTemplate"`,
    );
  }
}
