import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * NetworkDevice.lastPollReceivedAt: when OneUptime received the poll whose
 * verdict the device row holds (OneUptime issue #7389). A device's
 * reachability is written only by a poll received after it, so a poll that
 * was retried, or that waited longer in the queue than the poll after it, no
 * longer overwrites the newer verdict.
 *
 * Nullable, with no default, so adding it does not rewrite the table. NULL
 * means no verdict carries a receipt time yet, and the next poll writes one.
 */
export class AddNetworkDeviceLastPollReceivedAt1809123800000
  implements MigrationInterface
{
  public name = "AddNetworkDeviceLastPollReceivedAt1809123800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "lastPollReceivedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "lastPollReceivedAt"`,
    );
  }
}
