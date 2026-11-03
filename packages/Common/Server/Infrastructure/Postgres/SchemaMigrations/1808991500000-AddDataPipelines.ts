import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data pipelines from OpenLineage (DataPipeline), their runs
 * (DataPipelineRun) and the lineage between tables (DataAssetLineage). New
 * tables: their indexes and foreign keys are made with them, before they
 * hold a row.
 */
export class AddDataPipelines1808991500000 implements MigrationInterface {
  public name: string = "AddDataPipelines1808991500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataPipeline" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "jobNamespace" character varying(500) NOT NULL, "jobName" character varying(500) NOT NULL, "pipelineKey" character varying(500) NOT NULL, "description" text, "lastRunId" character varying(100), "lastRunState" character varying(100), "lastRunStartedAt" TIMESTAMP WITH TIME ZONE, "lastRunEndedAt" TIMESTAMP WITH TIME ZONE, "lastRunDurationInSeconds" integer, "lastSuccessAt" TIMESTAMP WITH TIME ZONE, "lastFailureAt" TIMESTAMP WITH TIME ZONE, "lastErrorMessage" text, "runCount" integer, "inputs" jsonb, "outputs" jsonb, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_53455c39447413a0960588d362f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_427a1aa3299db01aef8f6f67f7" ON "DataPipeline" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08a9ace753ebdee634eed19f88" ON "DataPipeline" ("projectId", "lastRunEndedAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b44a951ce6a2b87167075f286f" ON "DataPipeline" ("projectId", "pipelineKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataPipelineRun" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataPipelineId" uuid NOT NULL, "runId" character varying(100) NOT NULL, "state" character varying(100) NOT NULL, "startedAt" TIMESTAMP WITH TIME ZONE, "endedAt" TIMESTAMP WITH TIME ZONE, "durationInSeconds" integer, "errorMessage" text, "inputs" jsonb, "outputs" jsonb, "outputDataAssetIds" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_550dca7123a3f0ccaedc9959da6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_be52afad87c6e38241b44299e0" ON "DataPipelineRun" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ecffb189613e545106d672202d" ON "DataPipelineRun" ("dataPipelineId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_edfdb67a2680d94a2b3f44fec4" ON "DataPipelineRun" ("dataPipelineId", "startedAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8f915094921ec34b98e73d87e5" ON "DataPipelineRun" ("dataPipelineId", "runId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataAssetLineage" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "upstreamDataAssetId" uuid, "downstreamDataAssetId" uuid NOT NULL, "dataPipelineId" uuid, "edgeKey" character varying(500) NOT NULL, "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c94259ec891068a8f88ec9196dc" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e6b52a9b00112194b1c22ad6fa" ON "DataAssetLineage" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e205a7c38fe577947e8e319d73" ON "DataAssetLineage" ("upstreamDataAssetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_abebbc563c5a2efb4d1573043d" ON "DataAssetLineage" ("downstreamDataAssetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e77b0782f4095697d9f454c70c" ON "DataAssetLineage" ("dataPipelineId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a60bb6dda575158e49e3e97bad" ON "DataAssetLineage" ("projectId", "edgeKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" ADD CONSTRAINT "FK_427a1aa3299db01aef8f6f67f76" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" ADD CONSTRAINT "FK_6846902dacb9f0e17e0fbd46913" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" ADD CONSTRAINT "FK_52110bf4f9f264798586ca893bf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineRun" ADD CONSTRAINT "FK_be52afad87c6e38241b44299e01" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineRun" ADD CONSTRAINT "FK_ecffb189613e545106d672202d3" FOREIGN KEY ("dataPipelineId") REFERENCES "DataPipeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineRun" ADD CONSTRAINT "FK_65cd607513e36af50ab05e3a910" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineRun" ADD CONSTRAINT "FK_ae4f478e055b47baa17afb2fc90" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" ADD CONSTRAINT "FK_e6b52a9b00112194b1c22ad6fab" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" ADD CONSTRAINT "FK_e205a7c38fe577947e8e319d739" FOREIGN KEY ("upstreamDataAssetId") REFERENCES "DataAsset"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" ADD CONSTRAINT "FK_abebbc563c5a2efb4d1573043d0" FOREIGN KEY ("downstreamDataAssetId") REFERENCES "DataAsset"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" ADD CONSTRAINT "FK_e77b0782f4095697d9f454c70c9" FOREIGN KEY ("dataPipelineId") REFERENCES "DataPipeline"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" ADD CONSTRAINT "FK_dee5c60215a6f573e59f42354a5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" ADD CONSTRAINT "FK_bfb3351cf6698fd14724773f5b5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" DROP CONSTRAINT "FK_bfb3351cf6698fd14724773f5b5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" DROP CONSTRAINT "FK_dee5c60215a6f573e59f42354a5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" DROP CONSTRAINT "FK_e77b0782f4095697d9f454c70c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" DROP CONSTRAINT "FK_abebbc563c5a2efb4d1573043d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" DROP CONSTRAINT "FK_e205a7c38fe577947e8e319d739"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" DROP CONSTRAINT "FK_e6b52a9b00112194b1c22ad6fab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineRun" DROP CONSTRAINT "FK_ae4f478e055b47baa17afb2fc90"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineRun" DROP CONSTRAINT "FK_65cd607513e36af50ab05e3a910"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineRun" DROP CONSTRAINT "FK_ecffb189613e545106d672202d3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineRun" DROP CONSTRAINT "FK_be52afad87c6e38241b44299e01"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" DROP CONSTRAINT "FK_52110bf4f9f264798586ca893bf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" DROP CONSTRAINT "FK_6846902dacb9f0e17e0fbd46913"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" DROP CONSTRAINT "FK_427a1aa3299db01aef8f6f67f76"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a60bb6dda575158e49e3e97bad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e77b0782f4095697d9f454c70c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_abebbc563c5a2efb4d1573043d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e205a7c38fe577947e8e319d73"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e6b52a9b00112194b1c22ad6fa"`,
    );
    await queryRunner.query(`DROP TABLE "DataAssetLineage"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f915094921ec34b98e73d87e5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_edfdb67a2680d94a2b3f44fec4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ecffb189613e545106d672202d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_be52afad87c6e38241b44299e0"`,
    );
    await queryRunner.query(`DROP TABLE "DataPipelineRun"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b44a951ce6a2b87167075f286f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08a9ace753ebdee634eed19f88"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_427a1aa3299db01aef8f6f67f7"`,
    );
    await queryRunner.query(`DROP TABLE "DataPipeline"`);
  }
}
