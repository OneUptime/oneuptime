import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * What a pipeline's runs teach about it (DataPipelineSchedule): how long a
 * run usually takes, and the longest it goes between runs on its schedule,
 * relearned as runs start and end. And when each run was scheduled for, when
 * its producer says (OpenLineage's nominalTime facet), so a backfill's burst
 * of runs still reads as the pipeline's schedule.
 *
 * Nullable, with no default and no row written: each is learned from the
 * next runs. Adding them is a catalogue change, not a rewrite.
 */
export class AddDataPipelineSchedule1808991600000
  implements MigrationInterface
{
  public name = "AddDataPipelineSchedule1808991600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" ADD "typicalRunDurationInSeconds" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" ADD "expectedRunIntervalInSeconds" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineRun" ADD "scheduledAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataPipelineRun" DROP COLUMN "scheduledAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" DROP COLUMN "expectedRunIntervalInSeconds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" DROP COLUMN "typicalRunDurationInSeconds"`,
    );
  }
}
