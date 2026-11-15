import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCreatedNotificationHeldAt1809174700000, and moved into a migration of
 * its own: "Incident" and "Alert" already hold rows, so their indexes are
 * built online, without blocking the incidents and alerts written
 * meanwhile. Each is partial - only the records whose owners' Created
 * notification is held, a few at any moment - so each stays as small as
 * what it finds: the Created job's read of a hold nobody let go. Safe to
 * run again after a stop part way.
 */
export class AddCreatedNotificationHeldAtIndexes1809174710000
  implements MigrationInterface
{
  public name: string = "AddCreatedNotificationHeldAtIndexes1809174710000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_4ac07dd547a85779a03fd13272" ON "Incident" ("createdNotificationHeldAt") WHERE "createdNotificationHeldAt" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_5b2a0df8114b3ccf91efec3861" ON "Alert" ("createdNotificationHeldAt") WHERE "createdNotificationHeldAt" IS NOT NULL AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_5b2a0df8114b3ccf91efec3861"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_4ac07dd547a85779a03fd13272"`,
    );
  }
}
