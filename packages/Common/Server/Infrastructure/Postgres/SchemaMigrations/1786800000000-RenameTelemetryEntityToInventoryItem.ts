import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The entity registry is now the Inventory product, so its two tables take
 * the product's name: TelemetryEntity -> InventoryItem, and
 * TelemetryEntityRelationship -> InventoryItemRelationship.
 *
 * Written by hand rather than generated, because a generator cannot express a
 * rename: TypeORM sees an unknown table plus a missing one and emits
 * DROP + CREATE, which would discard every row. `ALTER TABLE ... RENAME`
 * preserves the data, and preserves each row's `_id` — which matters here
 * beyond the usual reasons, because the relationship rows reference items by
 * `entityKey` rather than by id, and `entityKey` is a hash of the entity's
 * identifying attributes. Nothing about the identity of an item changes.
 *
 * The bulk of this file exists because Postgres does NOT rename a table's
 * indexes and constraints along with the table — they keep names derived from
 * the old one. TypeORM's default naming strategy derives those names from the
 * table name:
 *
 *   indexName      = "IDX_" + sha1(`${table}_${sortedColumns.join("_")}`)[0..26]
 *   foreignKeyName = "FK_"  + sha1(`${table}_${sortedColumns.join("_")}`)[0..27]
 *
 * so after the rename TypeORM expects entirely different names, and the
 * Postgres Schema Drift job (which migrates an empty database and then tries
 * to generate a migration against the result) would find every index and
 * foreign key misnamed and fail. Each new name below is that formula applied
 * to the new table name; each old name is the one actually in the database
 * today, taken from the migration history.
 *
 * Primary keys are renamed too, for tidiness rather than necessity — they are
 * hand-named (PK_TelemetryEntity) rather than hashed, and the drift check does
 * not compare them.
 */

interface RenamePair {
  from: string;
  to: string;
}

const INVENTORY_ITEM_INDEXES: Array<RenamePair> = [
  // (projectId)
  {
    from: "IDX_4e1ef427f431558a59263d6463",
    to: "IDX_0bb390eced5f2ad83ebe9e3f89",
  },
  // (lastSeenAt)
  {
    from: "IDX_6f5b6d2bb634b2396f2dee6ab1",
    to: "IDX_f624a34cbb01fafd0bada7ae34",
  },
  // (source)
  {
    from: "IDX_8106b1d6443d982b12e3318318",
    to: "IDX_02f47bb3925e22998491eaf45f",
  },
  // (projectId, entityType)
  {
    from: "IDX_e2ad53c6527cd8d74a63d2fda7",
    to: "IDX_658398f4f8df74f7e7e52da917",
  },
  // (projectId, resourceType, resourceId)
  {
    from: "IDX_64e28273ad4bc2543316ef82d2",
    to: "IDX_0fae1af0a94799f56e054c7287",
  },
  // UNIQUE (projectId, entityType, entityKey) - the ingest upsert conflict target
  {
    from: "IDX_cd0b36552d8224cbb200eedc4e",
    to: "IDX_924abab6b3627f33e8128eb68a",
  },
];

const INVENTORY_ITEM_FOREIGN_KEYS: Array<RenamePair> = [
  // (projectId)
  {
    from: "FK_4e1ef427f431558a59263d6463d",
    to: "FK_0bb390eced5f2ad83ebe9e3f895",
  },
  // (createdByUserId)
  {
    from: "FK_5c79b80b19265b19b2f40b3f6bb",
    to: "FK_56782122cd3d6c3571b6aecb630",
  },
  // (deletedByUserId)
  {
    from: "FK_28d95749a9f6f712448c371eb7d",
    to: "FK_c27f19553f14afe37b7658e26f3",
  },
];

const RELATIONSHIP_INDEXES: Array<RenamePair> = [
  // (projectId)
  {
    from: "IDX_69e77606b8cd6b0a340b561ee8",
    to: "IDX_31c667da9702b73b9b14dde9f8",
  },
  // (lastSeenAt)
  {
    from: "IDX_ff3c08f70cd90cd30909ab4508",
    to: "IDX_5ff147fc0c3c2d8c1c3cd4a945",
  },
  // (source)
  {
    from: "IDX_26ea726e2ee8fa622348581ac1",
    to: "IDX_4ba505deea1919c5af962e9e99",
  },
  // (projectId, fromEntityKey)
  {
    from: "IDX_cf1de4c74c6034f957103e6434",
    to: "IDX_be7667908537bf39191c74efa6",
  },
  // (projectId, toEntityKey)
  {
    from: "IDX_0207b1a581cc3b588835a526f5",
    to: "IDX_a4063035857f6ae859f576a9a6",
  },
  // UNIQUE (projectId, fromEntityKey, toEntityKey, relationshipType)
  {
    from: "IDX_1b26aa0f1dc0856218b446b82e",
    to: "IDX_bd1369d920d9653e1fddfd8de6",
  },
];

const RELATIONSHIP_FOREIGN_KEYS: Array<RenamePair> = [
  // (projectId)
  {
    from: "FK_69e77606b8cd6b0a340b561ee88",
    to: "FK_31c667da9702b73b9b14dde9f82",
  },
  // (createdByUserId)
  {
    from: "FK_e3bcf3792c0290f28e0c151ff61",
    to: "FK_66d2a100b0bb0d0fe4c76b415f1",
  },
  // (deletedByUserId)
  {
    from: "FK_358f60285a6b280da4b7ce1703d",
    to: "FK_ecb3b77afca41cef653ab8e0e33",
  },
];

const PRIMARY_KEYS: Array<RenamePair> = [
  { from: "PK_TelemetryEntity", to: "PK_InventoryItem" },
  {
    from: "PK_TelemetryEntityRelationship",
    to: "PK_InventoryItemRelationship",
  },
];

export class RenameTelemetryEntityToInventoryItem1786800000000
  implements MigrationInterface
{
  public name = "RenameTelemetryEntityToInventoryItem1786800000000";

  private async renameIndexes(
    queryRunner: QueryRunner,
    pairs: Array<RenamePair>,
    reverse: boolean,
  ): Promise<void> {
    for (const pair of pairs) {
      const from: string = reverse ? pair.to : pair.from;
      const to: string = reverse ? pair.from : pair.to;

      await queryRunner.query(
        `ALTER INDEX "public"."${from}" RENAME TO "${to}"`,
      );
    }
  }

  private async renameConstraints(
    queryRunner: QueryRunner,
    tableName: string,
    pairs: Array<RenamePair>,
    reverse: boolean,
  ): Promise<void> {
    for (const pair of pairs) {
      const from: string = reverse ? pair.to : pair.from;
      const to: string = reverse ? pair.from : pair.to;

      await queryRunner.query(
        `ALTER TABLE "${tableName}" RENAME CONSTRAINT "${from}" TO "${to}"`,
      );
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Tables first: every statement after this one addresses them by their
     * new name, and an index rename is table-independent anyway (index names
     * are unique per schema, not per table).
     */
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" RENAME TO "InventoryItem"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" RENAME TO "InventoryItemRelationship"`,
    );

    await this.renameIndexes(queryRunner, INVENTORY_ITEM_INDEXES, false);
    await this.renameIndexes(queryRunner, RELATIONSHIP_INDEXES, false);

    await this.renameConstraints(
      queryRunner,
      "InventoryItem",
      INVENTORY_ITEM_FOREIGN_KEYS,
      false,
    );
    await this.renameConstraints(
      queryRunner,
      "InventoryItemRelationship",
      RELATIONSHIP_FOREIGN_KEYS,
      false,
    );

    await queryRunner.query(
      `ALTER TABLE "InventoryItem" RENAME CONSTRAINT "${PRIMARY_KEYS[0]!.from}" TO "${PRIMARY_KEYS[0]!.to}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemRelationship" RENAME CONSTRAINT "${PRIMARY_KEYS[1]!.from}" TO "${PRIMARY_KEYS[1]!.to}"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "InventoryItemRelationship" RENAME CONSTRAINT "${PRIMARY_KEYS[1]!.to}" TO "${PRIMARY_KEYS[1]!.from}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItem" RENAME CONSTRAINT "${PRIMARY_KEYS[0]!.to}" TO "${PRIMARY_KEYS[0]!.from}"`,
    );

    await this.renameConstraints(
      queryRunner,
      "InventoryItemRelationship",
      RELATIONSHIP_FOREIGN_KEYS,
      true,
    );
    await this.renameConstraints(
      queryRunner,
      "InventoryItem",
      INVENTORY_ITEM_FOREIGN_KEYS,
      true,
    );

    await this.renameIndexes(queryRunner, RELATIONSHIP_INDEXES, true);
    await this.renameIndexes(queryRunner, INVENTORY_ITEM_INDEXES, true);

    await queryRunner.query(
      `ALTER TABLE "InventoryItemRelationship" RENAME TO "TelemetryEntityRelationship"`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItem" RENAME TO "TelemetryEntity"`,
    );
  }
}
