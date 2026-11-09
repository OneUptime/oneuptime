import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * An Azure connection's stream is read by OneUptime from the Event Hubs the
 * setup command makes (Types/CloudConnection/CloudStreamAzure), and where
 * each event hub was read to must outlive a restart. "CloudConnection" gains
 * one nullable column with no default:
 *
 *   - "streamState": the subscription that holds the event hubs, and the
 *     next offset of each partition. Server only.
 *
 * No index or foreign key is added to the existing table, so nothing scans,
 * locks or rewrites it.
 */
export class AddCloudConnectionStreamState1808995100000
  implements MigrationInterface
{
  public name: string = "AddCloudConnectionStreamState1808995100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" ADD "streamState" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" DROP COLUMN "streamState"`,
    );
  }
}
