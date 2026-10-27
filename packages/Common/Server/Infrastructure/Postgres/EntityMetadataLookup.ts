import TypeOrmPatchVersion from "./TypeOrmPatchVersion";
import { DataSource, EntityMetadata } from "typeorm";

/*
 * TYPEORM FINDS AN ENTITY BY ITS NAME IN CONSTANT TIME.
 *
 * DataSource.findMetadata answers a class from a Map, but a STRING - an
 * entity name, a table name or a table path - by walking every entity it
 * knows, about 520 of them, comparing each. OneUptime asks by string on
 * every query it sends: each service gets its repository by the model's name
 * (DatabaseService.getRepository), and a repository looks its metadata up by
 * that name every time it is used; and a read that pages a joined select
 * (take with a relation) wraps itself in a subquery whose text TypeORM looks
 * up as a table path too, which matches nothing and so walks all of them. On
 * a monitor's check that was 7% of the App's CPU.
 *
 * install() puts an index in front of the walk, built from the data source's
 * own metadata map and rebuilt whenever that map changes. It answers what
 * the walk answers - the first entity, in the map's order, whose table path
 * is a target with a dot in it, or whose name or table name is any other
 * target - and leaves every target that is not a string to TypeORM's own
 * code. EntityMetadataLookup.test.ts holds it to TypeORM's answer for every
 * entity and many targets that are none.
 */

type FindMetadataFunction = (
  this: DataSource,
  target: unknown,
) => EntityMetadata | undefined;

const INDEXED: unique symbol = Symbol("oneuptime.entityMetadataLookup");

type IndexedFindMetadataFunction = FindMetadataFunction & {
  [INDEXED]?: FindMetadataFunction | undefined;
};

// TypeORM's DataSource, or a stand-in with its findMetadata().
export interface DataSourceClass {
  prototype: unknown;
}

export interface EntityMetadataStringIndex {
  // The metadata map the index was built from, and its size then.
  source: Map<unknown, EntityMetadata>;
  size: number;
  // Targets with a dot: table paths ("schema.table").
  byTablePath: Map<string, EntityMetadata>;
  // Every other target: entity names and table names.
  byNameOrTableName: Map<string, EntityMetadata>;
}

const indexes: WeakMap<DataSource, EntityMetadataStringIndex> = new WeakMap();

export default class EntityMetadataLookup {
  /*
   * The index of a metadata map: for every key, the first entity in the
   * map's order that the walk would stop at.
   */
  public static buildIndex(
    entityMetadatasMap: Map<unknown, EntityMetadata>,
  ): EntityMetadataStringIndex {
    const byTablePath: Map<string, EntityMetadata> = new Map();
    const byNameOrTableName: Map<string, EntityMetadata> = new Map();

    for (const metadata of entityMetadatasMap.values()) {
      if (
        typeof metadata.tablePath === "string" &&
        !byTablePath.has(metadata.tablePath)
      ) {
        byTablePath.set(metadata.tablePath, metadata);
      }

      if (
        typeof metadata.name === "string" &&
        !byNameOrTableName.has(metadata.name)
      ) {
        byNameOrTableName.set(metadata.name, metadata);
      }

      if (
        typeof metadata.tableName === "string" &&
        !byNameOrTableName.has(metadata.tableName)
      ) {
        byNameOrTableName.set(metadata.tableName, metadata);
      }
    }

    return {
      source: entityMetadatasMap,
      size: entityMetadatasMap.size,
      byTablePath: byTablePath,
      byNameOrTableName: byNameOrTableName,
    };
  }

  // What findMetadata answers for a string target, through the index.
  public static findByString(
    dataSource: DataSource,
    target: string,
  ): EntityMetadata | undefined {
    const map: Map<unknown, EntityMetadata> =
      dataSource.entityMetadatasMap as Map<unknown, EntityMetadata>;

    // A target the map is keyed by comes first, as in TypeORM.
    const fromMap: EntityMetadata | undefined = map.get(target);

    if (fromMap) {
      return fromMap;
    }

    let index: EntityMetadataStringIndex | undefined = indexes.get(dataSource);

    if (!index || index.source !== map || index.size !== map.size) {
      index = EntityMetadataLookup.buildIndex(map);
      indexes.set(dataSource, index);
    }

    return target.indexOf(".") !== -1
      ? index.byTablePath.get(target)
      : index.byNameOrTableName.get(target);
  }

  /*
   * Index findMetadata once per process. PostgresDatabase.connect calls
   * this before it opens the pool. Not against a TypeORM other than the one
   * this was written for (TypeOrmPatchVersion): its own walk runs there.
   */
  public static install(
    dataSourceClass: DataSourceClass = DataSource as unknown as DataSourceClass,
  ): void {
    if (!TypeOrmPatchVersion.isPatchedVersion()) {
      return;
    }

    const prototype: { findMetadata: IndexedFindMetadataFunction } =
      dataSourceClass.prototype as {
        findMetadata: IndexedFindMetadataFunction;
      };
    const original: IndexedFindMetadataFunction = prototype.findMetadata;

    if (original[INDEXED]) {
      return;
    }

    const indexed: IndexedFindMetadataFunction = function (
      this: DataSource,
      target: unknown,
    ): EntityMetadata | undefined {
      if (typeof target !== "string") {
        return original.call(this, target);
      }

      return EntityMetadataLookup.findByString(this, target);
    };

    indexed[INDEXED] = original;
    prototype.findMetadata = indexed;
  }

  // Whether install() has run on this class (tests).
  public static isInstalled(
    dataSourceClass: DataSourceClass = DataSource as unknown as DataSourceClass,
  ): boolean {
    const prototype: { findMetadata: IndexedFindMetadataFunction } =
      dataSourceClass.prototype as {
        findMetadata: IndexedFindMetadataFunction;
      };

    return Boolean(prototype.findMetadata[INDEXED]);
  }

  // Undo install() (tests).
  public static uninstall(
    dataSourceClass: DataSourceClass = DataSource as unknown as DataSourceClass,
  ): void {
    const prototype: { findMetadata: IndexedFindMetadataFunction } =
      dataSourceClass.prototype as {
        findMetadata: IndexedFindMetadataFunction;
      };
    const original: FindMetadataFunction | undefined =
      prototype.findMetadata[INDEXED];

    if (original) {
      prototype.findMetadata = original;
    }
  }
}
