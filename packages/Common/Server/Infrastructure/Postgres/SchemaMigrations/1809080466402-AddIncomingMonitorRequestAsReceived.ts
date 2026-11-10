import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * An Incoming Request monitor's latest request is kept twice (#6402): as it
 * came, in this new column, which only the server reads - the heartbeat job
 * judges the request again, and a filter on its body needs what the sender
 * sent - and as people read it, cut as the monitor's logs are, in
 * Monitor.incomingMonitorRequest (LatestIncomingRequest).
 *
 * Nullable, with no default: adding it rewrites no row. The requests kept
 * before it are split by the Workers data migration
 * RedactLatestIncomingRequests; until then the heartbeat reads the request
 * from incomingMonitorRequest, as before (LatestIncomingRequest.getAsReceived).
 */
export class AddIncomingMonitorRequestAsReceived1809080466402
  implements MigrationInterface
{
  public name: string = "AddIncomingMonitorRequestAsReceived1809080466402";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "incomingMonitorRequestAsReceived" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "incomingMonitorRequestAsReceived"`,
    );
  }
}
