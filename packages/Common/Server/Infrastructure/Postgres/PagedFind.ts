import {
  FindManyOptions,
  FindOperator,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from "typeorm";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";
import { JoinAttribute } from "typeorm/query-builder/JoinAttribute";
import { FindOptionsUtils } from "typeorm/find-options/FindOptionsUtils";
import { DriverUtils } from "typeorm/driver/DriverUtils";
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
 *    findOneById with relations selected, also when the permission checks
 *    add conditions on the id beside it (And). At most one record matches,
 *    so the query that returns all its joined rows is the page.
 *
 * A read that joins a to-many relation only to SELECT it - a list's Labels
 * or Monitors column - keeps two queries, but not TypeORM's first one.
 * TypeORM finds the page's ids by wrapping the whole read, every join in
 * it, in SELECT DISTINCT ... ORDER BY ... LIMIT: Postgres builds every
 * matching record times its labels times its monitors (the Alerts list
 * selects a dozen such relations) before it can keep ten. A join made only
 * to select a relation decides neither which records match nor their
 * order: a LEFT JOIN keeps every record, and the order is the record's own
 * columns. So the page's ids come from the table itself instead, with only
 * the joins its filter and order need (to-one joins, one row per record),
 * paged by LIMIT and OFFSET in index order; then the rows of those ids
 * come from TypeORM's own second query, exactly as TypeORM writes it
 * (readIdPage, restrictToIds). A read that filters or orders through a
 * to-many relation keeps TypeORM's two queries: there the join does decide.
 *
 * Every other read keeps TypeORM's two queries. PagedFindSql.test.ts holds
 * the plans to the SQL they make, PagedFindPostgres.test.ts holds the pages
 * to TypeORM's own on a real Postgres.
 *
 * A read may also hand an adjuster (FindBuilderAdjuster): it is given every
 * builder the read makes from its options - the read's own and its id
 * page's - once TypeORM has built it, before it runs. DatabaseService hands
 * PendingInviteeProfiles' order of a person's profile, as its reader sees
 * them (#9895).
 */

/*
 * What a read does to the builder TypeORM makes from its find options,
 * before it runs (see above).
 */
export type FindBuilderAdjuster = <TEntity extends ObjectLiteral>(
  queryBuilder: SelectQueryBuilder<TEntity>,
) => void;

export default class PagedFind {
  /*
   * The find options the id page knows how to read. A read that sets any
   * other (a lock, a cache, a hand-written join, a relation load strategy)
   * keeps TypeORM's two queries.
   */
  private static readonly ID_PAGE_OPTIONS: ReadonlySet<string> =
    new Set<string>([
      "where",
      "order",
      "withDeleted",
      "skip",
      "take",
      "select",
      "relations",
      "loadEagerRelations",
    ]);

  /*
   * What repository.find(options) returns, through the query builder
   * repository.find builds (EntityManager.find), with the page taken in one
   * query when that gives the same page, and from the table itself when
   * only a selected relation joins to many.
   */
  public static async find<TEntity extends ObjectLiteral>(
    repository: Repository<TEntity>,
    options: FindManyOptions<TEntity>,
    adjust?: FindBuilderAdjuster | null | undefined,
  ): Promise<Array<TEntity>> {
    // A repository that is not TypeORM's (a test's stand-in) reads itself.
    if (!(repository instanceof Repository)) {
      return await (repository as Repository<TEntity>).find(options);
    }

    /*
     * So does every repository on a TypeORM other than the one this was
     * written for (TypeOrmPatchVersion): as repository.find builds it
     * (EntityManager.find), and with the read's adjuster, which no TypeORM
     * may skip - it is what the reader may see.
     */
    if (!TypeOrmPatchVersion.isPatchedVersion()) {
      if (!adjust) {
        return await repository.find(options);
      }

      const typeOrmBuilder: SelectQueryBuilder<TEntity> = repository.manager
        .createQueryBuilder<TEntity>(
          repository.metadata.target as never,
          FindOptionsUtils.extractFindManyOptionsAlias(options) ||
            repository.metadata.name,
        )
        .setFindOptions(options || {});

      adjust(typeOrmBuilder);

      return await typeOrmBuilder.getMany();
    }

    const queryBuilder: SelectQueryBuilder<TEntity> =
      PagedFind.createQueryBuilder(repository, options, adjust);

    const idPageBuilder: SelectQueryBuilder<TEntity> | null =
      PagedFind.createIdPageQueryBuilder(
        repository,
        options,
        queryBuilder,
        adjust,
      );

    if (!idPageBuilder) {
      return await queryBuilder.getMany();
    }

    const ids: Array<unknown> = await PagedFind.readIdPage(idPageBuilder);

    // No record on the page: no second query, as TypeORM does.
    if (ids.length === 0) {
      return [];
    }

    PagedFind.restrictToIds(queryBuilder, ids);

    return await queryBuilder.getMany();
  }

  /*
   * Whether a builder still takes its page in TypeORM's two queries (the
   * condition executeEntitiesAndRawResults pages by): skip or take set on
   * a read that joins.
   */
  public static isTypeOrmTwoQueryPage<TEntity extends ObjectLiteral>(
    queryBuilder: SelectQueryBuilder<TEntity>,
  ): boolean {
    const expressionMap: SelectQueryBuilder<TEntity>["expressionMap"] =
      queryBuilder?.expressionMap;

    if (!expressionMap) {
      return false;
    }

    return (
      Boolean(expressionMap.skip || expressionMap.take) &&
      expressionMap.joinAttributes.length > 0
    );
  }

  /*
   * The query that reads the ids of a page from the table itself, for a
   * read TypeORM would page in two queries because a relation it SELECTS
   * joins to many: the same filter, order, page and deleted rows, the
   * primary key alone selected, and no relation joined but those the filter
   * and order name. Null when that query would not give the same page:
   *
   *  - the read is not TypeORM's two-query page (PagedFind takes it in one,
   *    or it is not paged);
   *  - the filter or the order goes through a to-many relation, so the ids
   *    query would join to many itself;
   *  - the read sets an option this does not read (ID_PAGE_OPTIONS), or
   *    its table has a primary key of several columns.
   *
   * The page is ordered by the primary key last, as TypeORM's own ids query
   * is, so the order has no ties for the two plans to break differently.
   */
  public static createIdPageQueryBuilder<TEntity extends ObjectLiteral>(
    repository: Repository<TEntity>,
    options: FindManyOptions<TEntity>,
    queryBuilder?: SelectQueryBuilder<TEntity> | undefined,
    adjust?: FindBuilderAdjuster | null | undefined,
  ): SelectQueryBuilder<TEntity> | null {
    const fullBuilder: SelectQueryBuilder<TEntity> =
      queryBuilder || PagedFind.createQueryBuilder(repository, options, adjust);

    if (!PagedFind.isTypeOrmTwoQueryPage(fullBuilder)) {
      return null;
    }

    // Set by hand on the builder; this only rewrites what find options set.
    if (
      fullBuilder.expressionMap.limit !== undefined ||
      fullBuilder.expressionMap.offset !== undefined
    ) {
      return null;
    }

    const optionNames: Array<string> = Object.keys(options || {}).filter(
      (name: string): boolean => {
        return (options as Record<string, unknown>)[name] !== undefined;
      },
    );

    if (
      !optionNames.every((name: string): boolean => {
        return PagedFind.ID_PAGE_OPTIONS.has(name);
      })
    ) {
      return null;
    }

    const metadata: EntityMetadata = repository.metadata;

    if (metadata.primaryColumns.length !== 1) {
      return null;
    }

    const primaryColumn: EntityMetadata["primaryColumns"][number] =
      metadata.primaryColumns[0]!;

    if (primaryColumn.embeddedMetadata) {
      return null;
    }

    const idOptions: FindManyOptions<TEntity> = {
      select: {
        [primaryColumn.propertyName]: true,
      } as NonNullable<FindManyOptions<TEntity>["select"]>,
      // Joined to select only: they decide neither the records nor their order.
      loadEagerRelations: false,
    };

    // The read's own filter, order, page and deleted rows, as it set them.
    if (options.where !== undefined) {
      idOptions.where = options.where;
    }

    if (options.order !== undefined) {
      idOptions.order = options.order;
    }

    if (options.withDeleted !== undefined) {
      idOptions.withDeleted = options.withDeleted;
    }

    if (options.skip !== undefined) {
      idOptions.skip = options.skip;
    }

    if (options.take !== undefined) {
      idOptions.take = options.take;
    }

    // Ordered as the read is: its adjuster too.
    const idBuilder: SelectQueryBuilder<TEntity> = PagedFind.createQueryBuilder(
      repository,
      idOptions,
      adjust,
    );

    /*
     * Its joins, if any, are the ones its filter and order name. Each must
     * keep one row per record - then its page, by LIMIT and OFFSET in its
     * own SQL (takePageInOneQueryWherePossible), is a page of records.
     */
    if (
      !idBuilder.expressionMap.joinAttributes.every(
        (join: JoinAttribute): boolean => {
          return PagedFind.isOneRowPerRecordJoin(join);
        },
      )
    ) {
      return null;
    }

    // The primary key last, as TypeORM's own ids query orders.
    const primaryKeyOrder: string = `${idBuilder.expressionMap.mainAlias!.name}.${primaryColumn.propertyPath}`;

    if (!(primaryKeyOrder in idBuilder.expressionMap.orderBys)) {
      idBuilder.addOrderBy(primaryKeyOrder, "ASC");
    }

    return idBuilder;
  }

  /*
   * The ids of the page, in its order, as the id page's query returns them
   * (raw: no entity is built for an id).
   */
  public static async readIdPage<TEntity extends ObjectLiteral>(
    idPageBuilder: SelectQueryBuilder<TEntity>,
  ): Promise<Array<unknown>> {
    const metadata: EntityMetadata =
      idPageBuilder.expressionMap.mainAlias!.metadata;

    const idAlias: string = DriverUtils.buildAlias(
      idPageBuilder.connection.driver,
      undefined,
      idPageBuilder.expressionMap.mainAlias!.name,
      metadata.primaryColumns[0]!.databaseName,
    );

    const rows: Array<Record<string, unknown>> =
      await idPageBuilder.getRawMany();

    const ids: Array<unknown> = [];
    const seen: Set<unknown> = new Set<unknown>();

    for (const row of rows) {
      const id: unknown = row[idAlias];

      if (id === undefined || id === null || seen.has(id)) {
        continue;
      }

      seen.add(id);
      ids.push(id);
    }

    return ids;
  }

  /*
   * Turns the read into TypeORM's own second query of its two-query page:
   * the same read, unpaged, kept to the page's ids by the condition and the
   * parameter TypeORM itself appends (executeEntitiesAndRawResults), so its
   * SQL is TypeORM's to the character.
   */
  public static restrictToIds<TEntity extends ObjectLiteral>(
    queryBuilder: SelectQueryBuilder<TEntity>,
    ids: Array<unknown>,
  ): void {
    const mainAliasName: string = queryBuilder.expressionMap.mainAlias!.name;
    const metadata: EntityMetadata =
      queryBuilder.expressionMap.mainAlias!.metadata;
    const primaryColumn: EntityMetadata["primaryColumns"][number] =
      metadata.primaryColumns[0]!;

    queryBuilder.skip(undefined);
    queryBuilder.take(undefined);

    const areAllNumbers: boolean = ids.every((id: unknown): boolean => {
      return typeof id === "number";
    });

    /*
     * What TypeORM's mergeExpressionMap({ extraAppendedAndWhereCondition })
     * sets (a protected method): createWhereExpression appends it to the
     * read's conditions.
     */
    if (areAllNumbers) {
      queryBuilder.expressionMap.extraAppendedAndWhereCondition = `${mainAliasName}.${primaryColumn.propertyPath} IN (${ids.join(", ")})`;
      return;
    }

    queryBuilder.expressionMap.extraAppendedAndWhereCondition = `${mainAliasName}.${primaryColumn.propertyPath} IN (:...orm_distinct_ids)`;
    queryBuilder.setParameters({ orm_distinct_ids: ids });
  }

  public static createQueryBuilder<TEntity extends ObjectLiteral>(
    repository: Repository<TEntity>,
    options: FindManyOptions<TEntity>,
    adjust?: FindBuilderAdjuster | null | undefined,
  ): SelectQueryBuilder<TEntity> {
    const metadata: EntityMetadata = repository.metadata;

    // As EntityManager.find builds it.
    const queryBuilder: SelectQueryBuilder<TEntity> = repository.manager
      .createQueryBuilder<TEntity>(
        metadata.target as never,
        FindOptionsUtils.extractFindManyOptionsAlias(options) || metadata.name,
      )
      .setFindOptions(options || {});

    // What the read does to its builder, once TypeORM has built it.
    if (adjust) {
      adjust(queryBuilder);
    }

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
   * value, so at most one record matches whatever else it asks - or that
   * value with more conditions on the column beside it, all of which must
   * hold (And): a read by id that the permission checks narrow by
   * conditions on the record's own id (the labels a grant is limited to, a
   * block with labels, the records the caller owns) is
   * `_id: And(Equal(id), ...)`, and still names one record.
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

    return PagedFind.isOneValue(value);
  }

  /*
   * Whether a condition on a column holds for one value of it at most: the
   * value itself, `Equal(value)`, or an And() one of whose parts is.
   */
  private static isOneValue(condition: unknown): boolean {
    if (typeof condition === "string") {
      return condition.length > 0;
    }

    if (!(condition instanceof FindOperator)) {
      return false;
    }

    if (condition.type === "equal") {
      return (
        typeof condition.value === "string" &&
        (condition.value as string).length > 0
      );
    }

    if (condition.type === "and" && Array.isArray(condition.value)) {
      return (condition.value as Array<unknown>).some(
        (part: unknown): boolean => {
          return PagedFind.isOneValue(part);
        },
      );
    }

    return false;
  }
}
