import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1773402621107 implements MigrationInterface {
  public name = "MigrationName1773402621107";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "LogPipeline" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "filterQuery" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_563f923c5169ef1e28c09dfa586" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a6bff623cedf515ae3680d8735" ON "LogPipeline" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_70fc1c15d7770bf0646001b907" ON "LogPipeline" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "LogPipelineProcessor" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "logPipelineId" uuid NOT NULL, "name" character varying(50) NOT NULL, "processorType" character varying(100) NOT NULL, "configuration" jsonb NOT NULL DEFAULT '{}', "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, CONSTRAINT "PK_1f78f02415229abb3ff3fa0805a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6236eaae19a7b0ffb57b6d8b05" ON "LogPipelineProcessor" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b6281d545398353d360a05d10c" ON "LogPipelineProcessor" ("logPipelineId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e7194996a6547d4557a26739d6" ON "LogPipelineProcessor" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "LogDropFilter" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "filterQuery" character varying(500) NOT NULL, "action" character varying(100) NOT NULL DEFAULT 'drop', "samplePercentage" integer, "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_4d5244c285955b534cbeb55b330" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2651bf0f1b0981f3c1a15201fd" ON "LogDropFilter" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_95cd1d1be21a2d7f620698ac48" ON "LogDropFilter" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipeline" ADD CONSTRAINT "FK_a6bff623cedf515ae3680d87355" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipeline" ADD CONSTRAINT "FK_460794d1df27630235f2d543ba6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipeline" ADD CONSTRAINT "FK_ffe95c5c8cbcea614d33c255d24" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipelineProcessor" ADD CONSTRAINT "FK_6236eaae19a7b0ffb57b6d8b053" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipelineProcessor" ADD CONSTRAINT "FK_b6281d545398353d360a05d10ce" FOREIGN KEY ("logPipelineId") REFERENCES "LogPipeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipelineProcessor" ADD CONSTRAINT "FK_b2e03f9db1555a4f5ff6bc7778c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" ADD CONSTRAINT "FK_2651bf0f1b0981f3c1a15201fd7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" ADD CONSTRAINT "FK_b613c2da8abed05bb4d1a94a277" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" ADD CONSTRAINT "FK_7702956f8707c3d3525ddb299c9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" DROP CONSTRAINT "FK_7702956f8707c3d3525ddb299c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" DROP CONSTRAINT "FK_b613c2da8abed05bb4d1a94a277"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" DROP CONSTRAINT "FK_2651bf0f1b0981f3c1a15201fd7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipelineProcessor" DROP CONSTRAINT "FK_b2e03f9db1555a4f5ff6bc7778c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipelineProcessor" DROP CONSTRAINT "FK_b6281d545398353d360a05d10ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipelineProcessor" DROP CONSTRAINT "FK_6236eaae19a7b0ffb57b6d8b053"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipeline" DROP CONSTRAINT "FK_ffe95c5c8cbcea614d33c255d24"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipeline" DROP CONSTRAINT "FK_460794d1df27630235f2d543ba6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipeline" DROP CONSTRAINT "FK_a6bff623cedf515ae3680d87355"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_95cd1d1be21a2d7f620698ac48"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2651bf0f1b0981f3c1a15201fd"`,
    );
    await queryRunner.query(`DROP TABLE "LogDropFilter"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e7194996a6547d4557a26739d6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b6281d545398353d360a05d10c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6236eaae19a7b0ffb57b6d8b05"`,
    );
    await queryRunner.query(`DROP TABLE "LogPipelineProcessor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_70fc1c15d7770bf0646001b907"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a6bff623cedf515ae3680d8735"`,
    );
    await queryRunner.query(`DROP TABLE "LogPipeline"`);
  }
}
