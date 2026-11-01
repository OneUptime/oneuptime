import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A Network Endpoint can now come from a network controller's client list as
 * well as from a walked switch or router (OneUptime issue #5379). It keeps
 * what the controller calls the client (hostname), and which controller
 * placed it where it is (attachmentSource): that outranks a walk while it is
 * current, and it is read far less often than a switch is walked.
 *
 * Two nullable varchar columns on an existing table, with no default, no
 * index and no key: adding them rewrites nothing and blocks nothing. Nothing
 * to backfill - every endpoint so far came from a walk, which NULL says.
 */
export class AddNetworkEndpointHostnameAndAttachmentSource1808720000000
  implements MigrationInterface
{
  public name: string =
    "AddNetworkEndpointHostnameAndAttachmentSource1808720000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD "hostname" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD "attachmentSource" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP COLUMN "attachmentSource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP COLUMN "hostname"`,
    );
  }
}
