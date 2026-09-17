import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDeletedProjectTable1786461136170 implements MigrationInterface {
  public name: string = "AddDeletedProjectTable1786461136170";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DeletedProject" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "projectName" character varying(100) NOT NULL, "projectSlug" character varying(100), "projectCreatedAt" TIMESTAMP WITH TIME ZONE, "projectDeletedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "deletionReason" text, "projectDeletedByUserId" uuid, "projectDeletedByUserName" character varying(50), "projectDeletedByUserEmail" character varying(100), "projectCreatedByUserId" uuid, "projectCreatedByUserName" character varying(50), "projectCreatedByUserEmail" character varying(100), "companyName" character varying(100), "companyPhoneNumber" character varying(30), "companySize" character varying(100), "jobRole" character varying(100), "planName" character varying(100), "paymentProviderPlanId" character varying(100), "paymentProviderCustomerId" character varying(100), "paymentProviderSubscriptionId" character varying(100), "paymentProviderSubscriptionStatus" character varying(100), "paymentProviderSubscriptionSeats" integer, "trialEndsAt" TIMESTAMP WITH TIME ZONE, "activeMonitorCount" integer, "wasProjectBlocked" boolean, CONSTRAINT "PK_bd397da7b51a8649b38c3c8b272" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_deleted_project_project_id" ON "DeletedProject" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_deleted_project_project_deleted_at" ON "DeletedProject" ("projectDeletedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DeletedProject" ADD CONSTRAINT "FK_bb76f7ebe3ee418ffd79346f203" FOREIGN KEY ("projectDeletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DeletedProject" ADD CONSTRAINT "FK_084492367421031e80cd0fdbf1e" FOREIGN KEY ("projectCreatedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DeletedProject" DROP CONSTRAINT "FK_084492367421031e80cd0fdbf1e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DeletedProject" DROP CONSTRAINT "FK_bb76f7ebe3ee418ffd79346f203"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_deleted_project_project_deleted_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_deleted_project_project_id"`,
    );
    await queryRunner.query(`DROP TABLE "DeletedProject"`);
  }
}
