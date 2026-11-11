import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Saved funnels and retention tables (OneUptime issue #6630):
 * RumProductAnalyticsSavedView keeps, for a RUM application, a funnel's or
 * a retention table's definition under a name, for its page to open again
 * and for the Funnel and Retention dashboard widgets to read.
 *
 * The indexes and foreign keys are on the new table, which is empty.
 */
export class AddRumProductAnalyticsSavedViews1809110100000
  implements MigrationInterface
{
  public name: string = "AddRumProductAnalyticsSavedViews1809110100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RumProductAnalyticsSavedView" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "rumApplicationId" uuid NOT NULL, "name" character varying(100) NOT NULL, "viewType" character varying(100) NOT NULL, "definition" jsonb NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_e96562bec3d133a2a8ba37b2bfd" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_663c6648b4a890365e43123643" ON "RumProductAnalyticsSavedView" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a7a1b2081696a7addac92d3f21" ON "RumProductAnalyticsSavedView" ("rumApplicationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f57c27b1eb741c6780d9a5a896" ON "RumProductAnalyticsSavedView" ("projectId", "rumApplicationId", "viewType") `,
    );
    await queryRunner.query(
      `ALTER TABLE "RumProductAnalyticsSavedView" ADD CONSTRAINT "FK_663c6648b4a890365e431236431" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumProductAnalyticsSavedView" ADD CONSTRAINT "FK_a7a1b2081696a7addac92d3f21e" FOREIGN KEY ("rumApplicationId") REFERENCES "RumApplication"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumProductAnalyticsSavedView" ADD CONSTRAINT "FK_4cff73c21e4a53a4a67353ab2d7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumProductAnalyticsSavedView" ADD CONSTRAINT "FK_0aa61ec1c6534301b840ed96bca" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumProductAnalyticsSavedView" DROP CONSTRAINT "FK_0aa61ec1c6534301b840ed96bca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumProductAnalyticsSavedView" DROP CONSTRAINT "FK_4cff73c21e4a53a4a67353ab2d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumProductAnalyticsSavedView" DROP CONSTRAINT "FK_a7a1b2081696a7addac92d3f21e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumProductAnalyticsSavedView" DROP CONSTRAINT "FK_663c6648b4a890365e431236431"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f57c27b1eb741c6780d9a5a896"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a7a1b2081696a7addac92d3f21"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_663c6648b4a890365e43123643"`,
    );
    await queryRunner.query(`DROP TABLE "RumProductAnalyticsSavedView"`);
  }
}
