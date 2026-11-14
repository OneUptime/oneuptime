import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated for the model (TypeORM's migration:generate statement): the
 * index the inventory mirror's reverse pass reads its pages from
 * (InventoryEntityRegistry.removeOrphans). Every fifteen minutes the mirror
 * reads each type's mirrored registry rows in keyset pages - `entityType =
 * $1 AND source = 'inventory' AND _id > $cursor ORDER BY _id LIMIT 1000` -
 * and each page is now a range of this.
 *
 * Nothing else on "InventoryItem" leads with entityType. Paged by OFFSET in
 * creation order, as it was, every page read all of a type's mirrored rows
 * and sorted them (100,000 network devices: 2,400 buffers and a 5.7 MB sort
 * spilled to disk, a hundred times a pass). Paged by key without this, a
 * page walks the primary key through the rows of every type - most of them
 * entities telemetry discovered - to find a thousand of its own (5,300
 * buffers a page, on a registry of 520,000 rows). With it a page reads its
 * thousand rows (1,000 buffers), and a type with no mirrored rows reads
 * three.
 *
 * Partial: only mirrored rows are in it. The entities telemetry discovers,
 * most of the table and all of its busy writes, carry none of it.
 *
 * InventoryItem already holds data, so the index is built online
 * (Docs/migrations/README.md): CONCURRENTLY, blocking no read or write. The
 * name and definition are the generated ones, so the drift check still
 * matches.
 */
export class AddInventoryItemMirrorKeysetIndex1809164100000
  implements MigrationInterface
{
  public name: string = "AddInventoryItemMirrorKeysetIndex1809164100000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_5ba328d0cab9ac05fec674827e" ON "InventoryItem" ("entityType", "_id") WHERE "source" = 'inventory'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_5ba328d0cab9ac05fec674827e"`,
    );
  }
}
