import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductFeedback1809123000000 implements MigrationInterface {
  public name: string = "AddProductFeedback1809123000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ProductFeedback" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "kind" character varying(100) NOT NULL, "topic" character varying(100), "score" smallint, "isPositive" boolean, "details" text, "page" character varying(500), "productVersion" character varying(100), CONSTRAINT "PK_c4f887daef93a9bd78d2166afe8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a0cba8a4e43aff85ac6cc9bcdc" ON "ProductFeedback" ("kind", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "disableFeedbackQuestions" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "feedbackQuestionsAsked" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "disableProductFeedback" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "disableProductFeedback"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "feedbackQuestionsAsked"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "disableFeedbackQuestions"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a0cba8a4e43aff85ac6cc9bcdc"`,
    );
    await queryRunner.query(`DROP TABLE "ProductFeedback"`);
  }
}
