import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then numbered after
 * the last registered migration.
 *
 * A data pipeline's circuit breaker (#6548): whether a late table it reads
 * stops it too (circuitBreakerStopsOnLateTables, off for every pipeline),
 * when the breaker was last asked, since when it has stopped the pipeline,
 * and why. Four columns on an existing table: the three nullable ones with
 * no default change only its catalog entry, and the boolean's constant
 * default is kept in the catalog too (Postgres 11 and later), so nothing is
 * rewritten or scanned and no write waits. A server of the release before
 * ignores them.
 */
export class AddDataPipelineCircuitBreaker1809184870000
  implements MigrationInterface
{
  public name: string = "AddDataPipelineCircuitBreaker1809184870000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" ADD "circuitBreakerStopsOnLateTables" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" ADD "circuitBreakerCheckedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" ADD "circuitBreakerStoppedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" ADD "circuitBreakerReasons" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" DROP COLUMN "circuitBreakerReasons"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" DROP COLUMN "circuitBreakerStoppedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" DROP COLUMN "circuitBreakerCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" DROP COLUMN "circuitBreakerStopsOnLateTables"`,
    );
  }
}
