import { IndexOptions } from "typeorm";

/*
 * Options for an index whose definition TypeORM cannot express, and which must
 * therefore be owned by a migration rather than by the schema builder.
 *
 * WHY THIS EXISTS
 *
 * TypeORM's schema builder matches database indexes to entity metadata BY NAME
 * (RdbmsSchemaBuilder.dropOldIndices: `metadata.indices.find((i) => i.name ===
 * tableIndex.name)`) and DROPS every index it cannot find a match for. An index
 * created only in a migration is invisible to entity metadata, so the next
 * `npm run generate-postgres-migration` emits a DROP for it — silently, mixed
 * in with whatever change was actually being made.
 *
 * That is not hypothetical. An audit of every hand-named index ever created by
 * a migration against a fully-migrated database found ten that had been deleted
 * this way and never restored, including the unique guards on six `slug`
 * columns and the LOWER(name) index serving the telemetry ingest hot path.
 * Migration 1775735059360 is a representative example: two unrelated column
 * default changes, plus a DROP of an expression index, plus a down() that
 * "restores" it without the expression.
 *
 * HOW THIS FIXES IT
 *
 * Declaring the index on the entity BY NAME with these options makes the schema
 * builder skip it in both directions: `dropOldIndices` returns early on
 * `synchronize === false`, and `createNewIndices` only considers indexes with
 * `synchronize === true`. The migration stays the single source of truth for
 * the real definition, and the declaration exists purely so TypeORM leaves it
 * alone.
 *
 * The columns passed alongside these options are documentation — the schema
 * builder never reads them for an unsynchronized index. Where the real
 * definition is partial or an expression, say so in a comment at the call site.
 *
 * THE CAST
 *
 * `synchronize` is a real, supported option: the @Index decorator forwards it
 * into IndexMetadataArgs (typeorm/decorator/Index.js), IndexMetadataArgs
 * declares it, and RdbmsSchemaBuilder reads it. Only the public IndexOptions
 * type omits it — a gap in TypeORM's own typings rather than a misuse.
 */
const UNSYNCHRONIZED_INDEX: IndexOptions = {
  synchronize: false,
} as IndexOptions;

export default UNSYNCHRONIZED_INDEX;
