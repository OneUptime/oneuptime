import {
  FindManyOptions,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from "typeorm";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";
import { FindOptionsUtils } from "typeorm/find-options/FindOptionsUtils";
import TypeOrmPatchVersion from "./TypeOrmPatchVersion";

/*
 * HOW MANY RECORDS MATCH, COUNTED NO FURTHER THAN A LIST NEEDS.
 *
 * A list's count (BaseAPI.getList) used to read every matching record: on a
 * project that keeps its alerts forever, a million index entries and their
 * rows, every time the list was read - and a live list reads itself again
 * as often as every five seconds. Past a point the number stops telling the
 * reader anything a "10,000+" does not.
 *
 * So a count can be capped: the records counted are those of the read's own
 * query - the same filter, the same joins, the same deleted rows - with
 * LIMIT upTo + 1 on it, and the answer is how many it found. More than upTo
 * means "more than upTo"; anything else is exact. Postgres stops at the
 * limit: the count costs at most upTo + 1 records, however many match.
 *
 * The query is TypeORM's own count (SelectQueryBuilder.executeCountQuery),
 * with what it counts moved into a subquery so a LIMIT can apply: the
 * records themselves when the read joins nothing (TypeORM counts COUNT(1)),
 * each record's primary key once when it joins (TypeORM counts
 * COUNT(DISTINCT pk)) - a record with two labels a filter goes through is
 * one record here as there. CappedCountSql.test.ts holds the SQL to that,
 * CappedCountPostgres.test.ts the answers to repository.count's on a real
 * Postgres.
 */
export default class CappedCount {
  /*
   * How many records repository.count(options) would count, but no more
   * than upTo + 1: more than upTo matched when the answer is upTo + 1.
   * On a TypeORM other than the one this was written for, or a repository
   * that is not TypeORM's, the exact count (TypeOrmPatchVersion).
   */
  public static async count<TEntity extends ObjectLiteral>(
    repository: Repository<TEntity>,
    options: FindManyOptions<TEntity>,
    upTo: number,
  ): Promise<number> {
    CappedCount.assertUpTo(upTo);

    if (
      !(repository instanceof Repository) ||
      !TypeOrmPatchVersion.isPatchedVersion()
    ) {
      return await (repository as Repository<TEntity>).count(options);
    }

    const countBuilder: SelectQueryBuilder<ObjectLiteral> =
      CappedCount.createQueryBuilder(repository, options, upTo);

    const row: Record<string, unknown> | undefined =
      await countBuilder.getRawOne();

    const counted: number = parseInt(String(row?.["cnt"] ?? "0"), 10);

    return Number.isFinite(counted) ? counted : 0;
  }

  /*
   * The capped count's query: SELECT COUNT(*) over the read's records, at
   * most upTo + 1 of them.
   */
  public static createQueryBuilder<TEntity extends ObjectLiteral>(
    repository: Repository<TEntity>,
    options: FindManyOptions<TEntity>,
    upTo: number,
  ): SelectQueryBuilder<ObjectLiteral> {
    CappedCount.assertUpTo(upTo);

    const metadata: EntityMetadata = repository.metadata;

    // As EntityManager.count builds it.
    const readBuilder: SelectQueryBuilder<TEntity> = repository.manager
      .createQueryBuilder<TEntity>(
        metadata.target as never,
        FindOptionsUtils.extractFindManyOptionsAlias(options) || metadata.name,
      )
      .setFindOptions(options || {});

    const counted: SelectQueryBuilder<TEntity> = readBuilder
      .clone()
      .orderBy()
      .groupBy()
      .offset(undefined)
      .limit(upTo + 1)
      .skip(undefined)
      .take(undefined)
      .select(CappedCount.getCountedSelection(readBuilder), "counted")
      .setOption("disable-global-order");

    return repository.manager.connection
      .createQueryBuilder()
      .select("COUNT(*)", "cnt")
      .from(`(${counted.getQuery()})`, "counted_records")
      .setParameters(counted.getParameters())
      .setNativeParameters(counted.expressionMap.nativeParameters);
  }

  /*
   * What the subquery returns one row of per record: what TypeORM's count
   * counts (computeCountExpression), as a row rather than an aggregate.
   */
  public static getCountedSelection<TEntity extends ObjectLiteral>(
    readBuilder: SelectQueryBuilder<TEntity>,
  ): string {
    const expressionMap: SelectQueryBuilder<TEntity>["expressionMap"] =
      readBuilder.expressionMap;

    if (
      expressionMap.joinAttributes.length === 0 &&
      expressionMap.relationIdAttributes.length === 0 &&
      expressionMap.relationCountAttributes.length === 0
    ) {
      return "1";
    }

    const alias: string = readBuilder.escape(expressionMap.mainAlias!.name);

    return `DISTINCT ${expressionMap
      .mainAlias!.metadata.primaryColumns.map(
        (column: EntityMetadata["primaryColumns"][number]): string => {
          return `${alias}.${readBuilder.escape(column.databaseName)}`;
        },
      )
      .join(", ")}`;
  }

  private static assertUpTo(upTo: number): void {
    if (!Number.isSafeInteger(upTo) || upTo < 1) {
      throw new Error(
        `A capped count needs a whole number of records of at least 1 to count up to, not ${upTo}.`,
      );
    }
  }
}
