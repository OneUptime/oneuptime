import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #7541) after
 * NetworkEndpoint gained attachmentSeenAt: when the device an endpoint is
 * attached to last saw it there. A walk of that device older than it,
 * processed after a newer one, no longer moves the endpoint back to the
 * port it left (EndpointAttachmentUtil.decideUpsert).
 *
 * Nullable, with no default, and in no index: adding it rewrites nothing,
 * and a walk's write of it can still be a HOT update. No backfill: NULL
 * reads as no time, and the next write that sets an endpoint's attachment
 * sets it.
 */
export class AddNetworkEndpointAttachmentSeenAt1809180000000
  implements MigrationInterface
{
  public name: string = "AddNetworkEndpointAttachmentSeenAt1809180000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD "attachmentSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP COLUMN "attachmentSeenAt"`,
    );
  }
}
