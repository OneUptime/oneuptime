import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTracePipelineTables1776505976155 implements MigrationInterface {
  public name: string = "AddTracePipelineTables1776505976155";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // TracePipeline
    await queryRunner.query(
      `CREATE TABLE "TracePipeline" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "filterQuery" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_tp_01f23b5b9aa4c5e0a9a8f5b1c9d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tp_projectId_02a13c6caab5d6f1" ON "TracePipeline" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tp_isEnabled_03b24d7dbbc6e7a2" ON "TracePipeline" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipeline" ADD CONSTRAINT "FK_tp_projectId_04c35e8eccd7f8b3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipeline" ADD CONSTRAINT "FK_tp_createdBy_05d46f9fdde809c4" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipeline" ADD CONSTRAINT "FK_tp_deletedBy_06e5700feef90ad5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // TracePipelineProcessor
    await queryRunner.query(
      `CREATE TABLE "TracePipelineProcessor" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "tracePipelineId" uuid NOT NULL, "name" character varying(50) NOT NULL, "processorType" character varying(100) NOT NULL, "configuration" jsonb NOT NULL DEFAULT '{}', "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, CONSTRAINT "PK_tpp_07f6811fffa1bb16" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tpp_projectId_08075422000b2c27" ON "TracePipelineProcessor" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tpp_pipelineId_09186533111c3d38" ON "TracePipelineProcessor" ("tracePipelineId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tpp_isEnabled_0a297644222d4e49" ON "TracePipelineProcessor" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipelineProcessor" ADD CONSTRAINT "FK_tpp_projectId_0b3a8755333e5f5a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipelineProcessor" ADD CONSTRAINT "FK_tpp_pipelineId_0c4b9866444f606b" FOREIGN KEY ("tracePipelineId") REFERENCES "TracePipeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipelineProcessor" ADD CONSTRAINT "FK_tpp_createdBy_0d5ca9775550717c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // TraceDropFilter
    await queryRunner.query(
      `CREATE TABLE "TraceDropFilter" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "filterQuery" character varying(500) NOT NULL, "action" character varying(100) NOT NULL DEFAULT 'drop', "samplePercentage" integer, "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_tdf_0e6dba886661828d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tdf_projectId_0f7ecb99777293" ON "TraceDropFilter" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tdf_isEnabled_108fdcaa8883a4be" ON "TraceDropFilter" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" ADD CONSTRAINT "FK_tdf_projectId_1190edbb9994b5cf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" ADD CONSTRAINT "FK_tdf_createdBy_12a1fecca0a5c6e0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" ADD CONSTRAINT "FK_tdf_deletedBy_13b30ffddbb6d7f1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // TraceScrubRule
    await queryRunner.query(
      `CREATE TABLE "TraceScrubRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "patternType" character varying(100) NOT NULL, "customRegex" character varying(500), "scrubAction" character varying(100) NOT NULL DEFAULT 'redact', "fieldsToScrub" character varying(100) NOT NULL DEFAULT 'all', "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_tsr_14c4210eecc7e802" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tsr_projectId_15d532200dd8f913" ON "TraceScrubRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tsr_isEnabled_16e643311ee90a24" ON "TraceScrubRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" ADD CONSTRAINT "FK_tsr_projectId_17f75442200a1b35" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" ADD CONSTRAINT "FK_tsr_createdBy_1808655333112c46" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" ADD CONSTRAINT "FK_tsr_deletedBy_1919766444223d57" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // TraceRecordingRule
    await queryRunner.query(
      `CREATE TABLE "TraceRecordingRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "outputMetricName" character varying(100) NOT NULL, "definition" jsonb NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_trr_1a2a877555334e68" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_trr_projectId_1b3b988666445f79" ON "TraceRecordingRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_trr_isEnabled_1c4ca99777556080" ON "TraceRecordingRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceRecordingRule" ADD CONSTRAINT "FK_trr_projectId_1d5dbaa888667191" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceRecordingRule" ADD CONSTRAINT "FK_trr_createdBy_1e6ecbb9997782a2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceRecordingRule" ADD CONSTRAINT "FK_trr_deletedBy_1f7fdccaaa8893b3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // TraceRecordingRule
    await queryRunner.query(
      `ALTER TABLE "TraceRecordingRule" DROP CONSTRAINT "FK_trr_deletedBy_1f7fdccaaa8893b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceRecordingRule" DROP CONSTRAINT "FK_trr_createdBy_1e6ecbb9997782a2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceRecordingRule" DROP CONSTRAINT "FK_trr_projectId_1d5dbaa888667191"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_trr_isEnabled_1c4ca99777556080"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_trr_projectId_1b3b988666445f79"`,
    );
    await queryRunner.query(`DROP TABLE "TraceRecordingRule"`);

    // TraceScrubRule
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" DROP CONSTRAINT "FK_tsr_deletedBy_1919766444223d57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" DROP CONSTRAINT "FK_tsr_createdBy_1808655333112c46"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" DROP CONSTRAINT "FK_tsr_projectId_17f75442200a1b35"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tsr_isEnabled_16e643311ee90a24"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tsr_projectId_15d532200dd8f913"`,
    );
    await queryRunner.query(`DROP TABLE "TraceScrubRule"`);

    // TraceDropFilter
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" DROP CONSTRAINT "FK_tdf_deletedBy_13b30ffddbb6d7f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" DROP CONSTRAINT "FK_tdf_createdBy_12a1fecca0a5c6e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" DROP CONSTRAINT "FK_tdf_projectId_1190edbb9994b5cf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tdf_isEnabled_108fdcaa8883a4be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tdf_projectId_0f7ecb99777293"`,
    );
    await queryRunner.query(`DROP TABLE "TraceDropFilter"`);

    // TracePipelineProcessor
    await queryRunner.query(
      `ALTER TABLE "TracePipelineProcessor" DROP CONSTRAINT "FK_tpp_createdBy_0d5ca9775550717c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipelineProcessor" DROP CONSTRAINT "FK_tpp_pipelineId_0c4b9866444f606b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipelineProcessor" DROP CONSTRAINT "FK_tpp_projectId_0b3a8755333e5f5a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tpp_isEnabled_0a297644222d4e49"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tpp_pipelineId_09186533111c3d38"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tpp_projectId_08075422000b2c27"`,
    );
    await queryRunner.query(`DROP TABLE "TracePipelineProcessor"`);

    // TracePipeline
    await queryRunner.query(
      `ALTER TABLE "TracePipeline" DROP CONSTRAINT "FK_tp_deletedBy_06e5700feef90ad5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipeline" DROP CONSTRAINT "FK_tp_createdBy_05d46f9fdde809c4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipeline" DROP CONSTRAINT "FK_tp_projectId_04c35e8eccd7f8b3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tp_isEnabled_03b24d7dbbc6e7a2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tp_projectId_02a13c6caab5d6f1"`,
    );
    await queryRunner.query(`DROP TABLE "TracePipeline"`);
  }
}
