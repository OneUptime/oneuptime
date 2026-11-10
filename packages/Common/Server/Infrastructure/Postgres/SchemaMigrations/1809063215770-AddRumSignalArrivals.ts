import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written as TypeORM's migration:generate writes these statements for the
 * model, and numbered after the last registered migration.
 *
 * When each kind of telemetry last arrived from a RUM application (issue
 * #5770): tracesLastReceivedAt, logsLastReceivedAt and
 * metricsLastReceivedAt, written by the OpenTelemetry ingest path. They say
 * WHAT an application reports, so an empty Exceptions or Logs chart can
 * say whether that signal is set up, quiet in the range, or not arriving.
 * Nullable: nothing has arrived until something does.
 *
 * signalArrivalsTrackedSince says since when the three are kept. Its
 * DEFAULT now() gives every existing application the moment this ran -
 * on Postgres 11 and later the ADD changes the table's metadata only, and
 * now() is read once for the whole statement, so no row is rewritten - and
 * every application created later the moment it was created. "No logs
 * have arrived since <that moment>" then stays true for an application
 * that sent logs only before the upgrade.
 */
export class AddRumSignalArrivals1809063215770 implements MigrationInterface {
  public name: string = "AddRumSignalArrivals1809063215770";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "tracesLastReceivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "logsLastReceivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "metricsLastReceivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "signalArrivalsTrackedSince" TIMESTAMP WITH TIME ZONE DEFAULT now()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "signalArrivalsTrackedSince"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "metricsLastReceivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "logsLastReceivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "tracesLastReceivedAt"`,
    );
  }
}
