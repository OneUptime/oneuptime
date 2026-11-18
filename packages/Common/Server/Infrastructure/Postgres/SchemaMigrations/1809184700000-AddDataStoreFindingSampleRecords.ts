import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written to match TypeORM's migration:generate for the model, and
 * numbered after the last registered migration.
 *
 * Which records a telemetry finding was found in (#9549): each scan of a
 * service's telemetry keeps, with the finding, up to ten records of its
 * sample whose value held the data - when each was written and its trace,
 * span or session, never a value (DataStoreFinding.sampleRecords) - so the
 * issue's page reads exactly those records again, instead of looking for
 * them among the service's newest ones and finding none.
 *
 * One nullable JSON column, no default, no index, no key, nothing
 * backfilled: adding it rewrites no row, a server of the release before
 * ignores it, and the next scan of each service's telemetry fills it in.
 */
export class AddDataStoreFindingSampleRecords1809184700000
  implements MigrationInterface
{
  public name: string = "AddDataStoreFindingSampleRecords1809184700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "sampleRecords" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "sampleRecords"`,
    );
  }
}
