import UNSYNCHRONIZED_INDEX from "../../../Types/Database/UnsynchronizedIndex";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import Service from "../../../Models/DatabaseModels/Service";
import { describe, expect, test } from "@jest/globals";
import {
  Column,
  DataSource,
  Entity,
  EntityMetadata,
  getMetadataArgsStorage,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { IndexMetadata } from "typeorm/metadata/IndexMetadata";

/*
 * An index a migration owns is declared on its entity by name with
 * UNSYNCHRONIZED_INDEX, so TypeORM's schema builder neither drops it (it
 * drops every index it cannot match by name) nor builds a copy of its own.
 * That only holds while TypeORM actually reads `synchronize: false` from
 * these options all the way through to the metadata the schema builder
 * works from - which is what these tests pin, rather than the literal.
 */

@Index("IDX_UNSYNC_TEST_OWNED_BY_MIGRATION", ["name"], UNSYNCHRONIZED_INDEX)
@Index("IDX_UNSYNC_TEST_PLAIN", ["kind"])
@Entity({ name: "UnsynchronizedIndexTestEntity" })
class UnsynchronizedIndexTestEntity {
  @PrimaryGeneratedColumn("uuid")
  public id?: string;

  @Column({ type: "varchar" })
  public name?: string;

  @Column({ type: "varchar" })
  public kind?: string;
}

type IndexArgsOfFunction = (
  target: unknown,
  name: string,
) => IndexMetadataArgs | undefined;

const indexArgsOf: IndexArgsOfFunction = (
  target: unknown,
  name: string,
): IndexMetadataArgs | undefined => {
  return getMetadataArgsStorage().indices.find(
    (index: IndexMetadataArgs): boolean => {
      return index.target === target && index.name === name;
    },
  );
};

describe("UNSYNCHRONIZED_INDEX", () => {
  test("says synchronize: false and nothing else", () => {
    // Anything more (unique, where, ...) would change every index using it.
    expect({ ...UNSYNCHRONIZED_INDEX }).toEqual({ synchronize: false });
    expect(
      (UNSYNCHRONIZED_INDEX as { synchronize?: boolean }).synchronize,
    ).toBe(false);
  });

  test("the @Index decorator forwards it into the index's metadata args", () => {
    const args: IndexMetadataArgs | undefined = indexArgsOf(
      UnsynchronizedIndexTestEntity,
      "IDX_UNSYNC_TEST_OWNED_BY_MIGRATION",
    );

    expect(args).toBeDefined();
    expect(args!.synchronize).toBe(false);
    // Nothing else of the index changes.
    expect(args!.unique).toBe(false);
    expect(args!.where).toBeUndefined();
  });

  test("an index declared without it stays synchronized", () => {
    const args: IndexMetadataArgs | undefined = indexArgsOf(
      UnsynchronizedIndexTestEntity,
      "IDX_UNSYNC_TEST_PLAIN",
    );

    expect(args).toBeDefined();
    expect(args!.synchronize).toBe(true);
  });

  test("reaches the built entity metadata the schema builder reads", async () => {
    // Metadata is built without connecting to any database.
    const dataSource: DataSource = new DataSource({
      type: "postgres",
      entities: [UnsynchronizedIndexTestEntity],
    });

    await (
      dataSource as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();

    const metadata: EntityMetadata = dataSource.getMetadata(
      UnsynchronizedIndexTestEntity,
    );

    const byName: Map<string, IndexMetadata> = new Map<string, IndexMetadata>(
      metadata.indices.map((index: IndexMetadata): [string, IndexMetadata] => {
        return [index.name, index];
      }),
    );

    const owned: IndexMetadata | undefined = byName.get(
      "IDX_UNSYNC_TEST_OWNED_BY_MIGRATION",
    );
    const plain: IndexMetadata | undefined = byName.get(
      "IDX_UNSYNC_TEST_PLAIN",
    );

    // Declared by name, so dropOldIndices finds it and skips it ...
    expect(owned).toBeDefined();
    expect(owned!.synchronize).toBe(false);
    // ... while createNewIndices only builds the synchronized ones.
    expect(
      metadata.indices
        .filter((index: IndexMetadata): boolean => {
          return index.synchronize;
        })
        .map((index: IndexMetadata): string => {
          return index.name;
        }),
    ).not.toContain("IDX_UNSYNC_TEST_OWNED_BY_MIGRATION");

    expect(plain).toBeDefined();
    expect(plain!.synchronize).toBe(true);
  });

  describe("the migration-owned indexes declared with it", () => {
    test.each([
      ["Service", "IDX_SERVICE_PROJECT_LOWER_NAME", Service],
      ["LlmLog", "IDX_LLM_LOG_PROJECT_CREATED_AT", LlmLog],
    ])(
      "%s declares %s unsynchronized",
      (_model: string, name: string, target: unknown) => {
        const args: IndexMetadataArgs | undefined = indexArgsOf(target, name);

        expect(args).toBeDefined();
        expect(args!.synchronize).toBe(false);
      },
    );
  });
});
