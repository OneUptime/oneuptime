import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Drop the foreign key from TelemetryUsageBilling.serviceId -> Service.
 *
 * Telemetry ingested without an OTel service.name is metered against a
 * synthetic "unattributed" bucket whose serviceId is the projectId
 * (ServiceType.Unknown). That id has no matching Service row, so the FK
 * would reject the billing row. serviceId stays a required column; it is
 * just no longer constrained to the Service table (it is polymorphic,
 * mirroring the analytics telemetry rows). The TypeORM relation is kept
 * for read-side joins and resolves to null for the unattributed bucket.
 */
export class MigrationName1780381124553 implements MigrationInterface {
  public name = "MigrationName1780381124553";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" DROP CONSTRAINT IF EXISTS "FK_b9f49cd8318a35757fc843ee900"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" ADD CONSTRAINT "FK_b9f49cd8318a35757fc843ee900" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
