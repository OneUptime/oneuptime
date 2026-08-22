import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAcquisitionAttribution1787700000000
  implements MigrationInterface
{
  public name: string = "AddAcquisitionAttribution1787700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD "acquisitionAttribution" jsonb`);
    await queryRunner.query(`ALTER TABLE "Project" ADD "acquisitionAttribution" jsonb`);
    await queryRunner.query(`CREATE TABLE "MarketingTouchpoint" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "eventId" character varying(100) NOT NULL, "anonymousVisitorId" character varying(100) NOT NULL, "touchpointType" character varying(100) NOT NULL, "consentState" character varying(100) NOT NULL, "attribution" jsonb NOT NULL, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "userId" uuid, "projectId" uuid, "externalReferenceId" character varying(100), CONSTRAINT "PK_MarketingTouchpoint_id" PRIMARY KEY ("_id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_marketing_touchpoint_event_id" ON "MarketingTouchpoint" ("eventId")`);
    await queryRunner.query(`CREATE INDEX "idx_marketing_touchpoint_visitor" ON "MarketingTouchpoint" ("anonymousVisitorId")`);
    await queryRunner.query(`CREATE INDEX "idx_marketing_touchpoint_user_id" ON "MarketingTouchpoint" ("userId")`);
    await queryRunner.query(`CREATE INDEX "idx_marketing_touchpoint_project_id" ON "MarketingTouchpoint" ("projectId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_marketing_touchpoint_project_id"`);
    await queryRunner.query(`DROP INDEX "idx_marketing_touchpoint_user_id"`);
    await queryRunner.query(`DROP INDEX "idx_marketing_touchpoint_visitor"`);
    await queryRunner.query(`DROP INDEX "uq_marketing_touchpoint_event_id"`);
    await queryRunner.query(`DROP TABLE "MarketingTouchpoint"`);
    await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "acquisitionAttribution"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "acquisitionAttribution"`);
  }
}
