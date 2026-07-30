import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with `npm run generate-postgres-migration`. Two unrelated
 * `OnCallDutyPolicyScheduleLayer` default-value statements the generator also
 * emitted (whitespace-only drift between the entity's serialized JSON default
 * and the one already in the database) were removed by hand — they belong to
 * neither this feature nor this PR, and re-writing those defaults would churn
 * every existing row's column default for no behavioural change.
 */
export class AddRecommendationDismissalTable1785397674289
  implements MigrationInterface
{
  public name = "AddRecommendationDismissalTable1785397674289";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RecommendationDismissal" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "recommendationType" character varying(100) NOT NULL, "recommendationId" character varying(100) NOT NULL, "resourceType" character varying(100), "resourceId" uuid, "dismissalReason" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_d36e7bc61a5ad3a4ce43d83f29d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b9b04eb32e1e2b49131fdf3dd6" ON "RecommendationDismissal" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_119f2c4f157c931d3b11eb339d" ON "RecommendationDismissal" ("projectId", "recommendationType", "resourceType", "resourceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "RecommendationDismissal" ADD CONSTRAINT "FK_b9b04eb32e1e2b49131fdf3dd67" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RecommendationDismissal" ADD CONSTRAINT "FK_c81cd63783d39af4d9b690e3df0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RecommendationDismissal" ADD CONSTRAINT "FK_9c62a79e18419e3fba90d38a3db" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RecommendationDismissal" DROP CONSTRAINT "FK_9c62a79e18419e3fba90d38a3db"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RecommendationDismissal" DROP CONSTRAINT "FK_c81cd63783d39af4d9b690e3df0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RecommendationDismissal" DROP CONSTRAINT "FK_b9b04eb32e1e2b49131fdf3dd67"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_119f2c4f157c931d3b11eb339d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b9b04eb32e1e2b49131fdf3dd6"`,
    );
    await queryRunner.query(`DROP TABLE "RecommendationDismissal"`);
  }
}
