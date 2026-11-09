import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Marks the discovered devices people changed before
 * AddDiscoveredDeviceRetention1809080263890 as edited, so the job that
 * removes the devices no longer seen (DiscoveredDeviceAgeOut) keeps them, as
 * it keeps the ones people change from now on.
 *
 * Nothing recorded who changed a device, but the table tells the server's
 * writes from everybody else's. The server writes discovered devices with
 * statements of its own (NetworkEndpointService's upserts), which insert
 * "version" 0 and never change it. Everything else goes through the API -
 * the Dashboard's forms, a bulk change of the list, an API key - and so
 * through TypeORM, which inserts 1 and adds one on every update. A live
 * device whose "version" is above 0 was added or changed that way.
 *
 * Its "editedAt" becomes its "updatedAt": when the change was is not
 * recorded, and it was then or before. A device only ever classified is
 * marked too, which keeps nothing more: a classified device stays anyway.
 *
 * Its own migration, after the column's: it reads the whole table but
 * writes only the few rows people changed, and holds no lock on the table
 * that stops the walks writing meanwhile. Run again, it changes nothing.
 *
 * Hand-written: it changes data, not the schema, so the generator produces
 * nothing for it and the schema-drift check is unaffected.
 */
export class KeepEditedDiscoveredDevices1809080263892
  implements MigrationInterface
{
  public name: string = "KeepEditedDiscoveredDevices1809080263892";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "NetworkEndpoint" SET "editedAt" = "updatedAt" WHERE "deletedAt" IS NULL AND "editedAt" IS NULL AND "version" > 0`,
    );
  }

  public async down(): Promise<void> {
    /*
     * Nothing to undo: the column it wrote goes with
     * AddDiscoveredDeviceRetention1809080263890's down.
     */
  }
}
