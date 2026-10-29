import {
  FindManyOptions,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from "typeorm";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";
import { JoinAttribute } from "typeorm/query-builder/JoinAttribute";
import { FindOptionsUtils } from "typeorm/find-options/FindOptionsUtils";
import TypeOrmPatchVersion from "./TypeOrmPatchVersion";

/*
 * A PAGE OF A JOINED READ IN ONE QUERY WHEREVER ONE QUERY GIVES THE SAME PAGE.
 *
 * TypeORM reads a page (skip / take) of a select that joins a relation in
 * two queries: the ids of the page first - SELECT DISTINCT over the whole
 * read wrapped in a subquery, ordered and limited - then the rows of those
 * ids. That is what a page of records needs when a join can return several
 * rows for one record (a monitor's labels): a LIMIT on the joined rows would
 * cut a record's rows short. It costs a second round trip, a second query to
 * build, and a subquery as long as the read for Postgres to plan, on every
 * read DatabaseService makes with a relation in it - a monitor's check makes
 * three of them.
 *
 * Two kinds of read get their page from one query instead, and the same
 * rows in the same order:
 *
 *  - A read whose every join returns at most one row for a record: a
 *    many-to-one relation, or the owning side of a one-to-one, joined on the
 *    related table's primary key (an incident's state, a monitor probe's
 *    probe). Each record is one row, so LIMIT and OFFSET on the rows are the
 *    page of records. DatabaseService always orders by the primary key last,
 *    so the order has no ties for the two plans to break differently.
 *  - A read of the first page that names its record by primary key - a
 *    findOneById with relations selected. At most one record matches, so the
 *    query that returns all its joined rows is the page.
 *
 * Every other read keeps TypeORM's two queries. PagedFindSql.test.ts holds
 * the plans to the SQL they make, PagedFindPostgres.test.ts holds the pages
 * to TypeORM's own on a real Postgres.
 */
export default class PagedFind {
  /*
   * What repository.find(options) returns, through the query builder
   * repository.find builds (EntityManager.find), with the page taken in one
   * query when that gives the same page.
   */
  public static async find<TEntity extends ObjectLiteral>(
    repository: Repository<TEntity>,
    options: FindManyOptions<TEntity>,
  ): Promise<Array<TEntity>> {
    /*
     * A repository that is not TypeORM's (a test's stand-in) reads itself,
     * and so does every repository on a TypeORM other than the one this was
     * written for (TypeOrmPatchVersion).
     */
    if (
      !(repository instanceof Repository) ||
      !TypeOrmPatchVersion.isPatchedVersion()
    ) {
      return await (repository as Repository<TEntity>).find(options);
    }

    return await PagedFind.createQueryBuilder(repository, options).getMany();
  }

  public static createQueryBuilder<TEntity extends ObjectLiteral>(
    repository: Repository<TEntity>,
    options: FindManyOptions<TEntity>,
  ): SelectQueryBuilder<TEntity> {
    const metadata: EntityMetadata = repository.metadata;

    // As EntityManager.find builds it.
    const queryBuilder: SelectQueryBuilder<TEntity> = repository.manager
      .createQueryBuilder<TEntity>(
        metadata.target as never,
        FindOptionsUtils.extractFindManyOptionsAlias(options) || metadata.name,
      )
      .setFindOptions(options || {});

    PagedFind.takePageInOneQueryWherePossible(queryBuilder, options);

    return queryBuilder;
  }

  /*
   * Turns TypeORM's two-query page into one query for the reads described
   * above, and leaves every other read as it is.
   */
  public static takePageInOneQueryWherePossible<TEntity extends ObjectLiteral>(
    queryBuilder: SelectQueryBuilder<TEntity>,
    options: FindManyOptions<TEntity>,
  ): void {
    const skip: number | undefined = queryBuilder.expressionMap.skip;
    const take: number | undefined = queryBuilder.expressionMap.take;
    const joins: Array<JoinAttribute> =
      queryBuilder.expressionMap.joinAttributes;

    // Not TypeORM's two-query page: nothing to change.
    if (!(skip || take) || joins.length === 0) {
      return;
    }

    // Set by hand on the builder; this only rewrites what find options set.
    if (
      queryBuilder.expressionMap.limit !== undefined ||
      queryBuilder.expressionMap.offset !== undefined
    ) {
      return;
    }

    if (
      joins.every((join: JoinAttribute): boolean => {
        return PagedFind.isOneRowPerRecordJoin(join);
      })
    ) {
      queryBuilder.skip(undefined);
      queryBuilder.take(undefined);
      queryBuilder.offset(skip);
      queryBuilder.limit(take);
      return;
    }

    if (
      !skip &&
      PagedFind.namesOneRecordByPrimaryKey(
        queryBuilder.expressionMap.mainAlias?.metadata,
        options,
      )
    ) {
      queryBuilder.skip(undefined);
      queryBuilder.take(undefined);
    }
  }

  /*
   * Whether a join returns at most one row for each row it is joined to: a
   * relation the joined-from row holds the key of (many-to-one, or the
   * owning side of a one-to-one), whose join columns are the related
   * table's whole primary key.
   */
  public static isOneRowPerRecordJoin(join: JoinAttribute): boolean {
    if (join.isMappingMany !== undefined) {
      return false;
    }

    let relation: RelationMetadata | undefined = undefined;

    try {
      relation = join.relation;
    } catch {
      // TypeORM's own build of the join says what is wrong with it.
      return false;
    }

    if (!relation) {
      return false;
    }

    if (!(relation.isManyToOne || relation.isOneToOneOwner)) {
      return false;
    }

    const primaryColumns: number =
      relation.inverseEntityMetadata.primaryColumns.length;

    return (
      relation.joinColumns.length > 0 &&
      relation.joinColumns.length === primaryColumns &&
      relation.joinColumns.every(
        (joinColumn: RelationMetadata["joinColumns"][number]): boolean => {
          return Boolean(joinColumn.referencedColumn?.isPrimary);
        },
      )
    );
  }

  /*
   * Whether the find names one record by its whole primary key: one where
   * (not a list of alternatives) giving the single primary column a plain
   * value, so at most one record matches whatever else it asks.
   */
  public static namesOneRecordByPrimaryKey<TEntity extends ObjectLiteral>(
    metadata: EntityMetadata | undefined,
    options: FindManyOptions<TEntity>,
  ): boolean {
    if (!metadata || metadata.primaryColumns.length !== 1) {
      return false;
    }

    const where: unknown = options?.where;

    if (!where || typeof where !== "object" || Array.isArray(where)) {
      return false;
    }

    const primaryKey: string = metadata.primaryColumns[0]!.propertyName;
    const value: unknown = (where as Record<string, unknown>)[primaryKey];

    return typeof value === "string" && value.length > 0;
  }
}
