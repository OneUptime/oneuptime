import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNetworkEndpointAttachmentSource1790700000000
  implements MigrationInterface
{
  public name: string = "AddNetworkEndpointAttachmentSource1790700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Nullable with no default, deliberately. Every existing row was written
     * without recording which walk placed it, and NULL is the honest answer
     * to that — backfilling them all to 'FDB' would invent provenance for
     * ARP-only rows, and inventing provenance is what lets the topology map
     * draw a cable that does not exist (issue #3489). The next walk that
     * touches a row stamps it; until then it simply reads as unknown, which
     * refuses.
     */
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD "attachmentSource" character varying(100)`,
    );
    /*
     * The two timestamps exist because "lastSeenAt" answers a DIFFERENT
     * question from the one inference has to ask.
     *
     * Any sighting of the MAC refreshes lastSeenAt — including a router ARP
     * sighting, which says nothing about which port the device is on. So a
     * row can be seconds fresh and still carry a switch attachment that aged
     * out months ago, or an address a different box has since taken over.
     * Drawing a cable from either is exactly the stale, confidently-wrong
     * link that #3489 exists to stop, so each fact carries the time it was
     * last actually confirmed.
     */
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD "attachmentLastSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD "ipAddressLastSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP COLUMN "ipAddressLastSeenAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP COLUMN "attachmentLastSeenAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP COLUMN "attachmentSource"`,
    );
  }
}
