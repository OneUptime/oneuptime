import NetworkSiteHierarchyLock from "./NetworkSiteHierarchyLock";
import FindBy from "../../Types/Database/FindBy";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import logger from "../Logger";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { And, FindOperator, Raw } from "typeorm";

/*
 * THE RETENTION PURGE OF NETWORK SITES AND NETWORK SITE TYPES: rows that name
 * each other. A site names its parent site; a site type names its parent
 * type, and sites name their type.
 *
 * The daily retention job (HardDelete:HardDeleteItemsInDatabase) asks, as
 * OneUptime, for the rows deleted more than 30 days ago in every project,
 * again and again until a call removes nothing. A row that another row still
 * names - live, deleted too recently to purge, or due itself - is held by
 * that row's foreign key (NO ACTION), which would refuse the whole DELETE.
 * So each call removes only rows nothing names:
 *
 *   1. The leaves: the due rows that no row names, deleted or not, chosen in
 *      one query. A deleted tree goes from the leaves up, a level a call.
 *   2. When no leaf is left, the closed cycles: due rows whose parent links
 *      run round in a cycle that no row outside it names. Only a write from
 *      outside the app can make one, since the forms refuse them. A cycle
 *      goes whole, in one DELETE: the foreign keys are checked at the end of
 *      the statement, when no row of it is left to name another.
 *   3. When neither is left: nothing. This is the job's last call for the
 *      table, so the due rows that stay are logged here, once a run.
 *
 * Every call that finds rows to remove removes them, so the job's loop ends
 * once a call finds none. The rows chosen are deleted by their ids inside the
 * hierarchy lock of their projects, and the delete's hook reads them again,
 * deleted rows included, checks that nothing outside the batch names them,
 * and holds the DELETE to them (findRowsAndHoldDeleteToThem).
 *
 * The rows are chosen outside the lock. Nothing in the app can name a due
 * row in between: every validated write that sets a parent or a type reads it
 * with findOneById, which never finds a deleted row. A write from outside the
 * app could; then the hook or the foreign key refuses that one DELETE, nothing
 * is removed wrongly, and the job tries again the next day.
 */

// A column whose rows name a row of the purged table. One such row, deleted or not, keeps it.
export interface NamingColumn {
  table: string;
  column: string;
}

// What sets one table's purge apart from the other's.
export interface LeafPurgeShape {
  // What the log calls the rows: "network sites".
  rowsName: string;
  // The table's own column naming a row's parent: the one a cycle runs along.
  parentColumn: string;
  // Every column whose rows keep a row: its child rows, and the rows that use it.
  namedBy: Array<NamingColumn>;
}

export interface LeafPurgeBatch<TBaseModel extends BaseModel> {
  shape: LeafPurgeShape;
  // The rows due for purge: the retention job's query.
  due: Query<TBaseModel>;
  // At most this many rows go in one call.
  limit: number;
  skip: number;
  // Reads rows, the ones deleted before included (DatabaseService.findByWithDeleted).
  read: (findBy: FindBy<TBaseModel>) => Promise<Array<TBaseModel>>;
  // Hard deletes exactly these rows (DatabaseService.hardDeleteBy, held to their ids).
  hardDeleteByIds: (ids: Array<ObjectID>) => Promise<number>;
}

// How many of the rows that stay the log names by id.
export const ROWS_NAMED_IN_LOG: number = 100;

// A table or column name that is safe to write into SQL as it is.
const PLAIN_IDENTIFIER: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A row the purge removes: by its id, in the lock of its project.
interface PurgeRow {
  id: ObjectID;
  projectId: ObjectID;
}

function normalizeId(id: ObjectID | string): string {
  return id.toString().toLowerCase();
}

function quoted(identifier: string): string {
  if (!PLAIN_IDENTIFIER.test(identifier)) {
    throw new BadDataException(
      `"${identifier}" is not a table or column name the retention purge can read.`,
    );
  }

  return `"${identifier}"`;
}

/*
 * The cycles in a map from a row to its parent, each once. A walk from a row
 * follows the parents while they are in the map; a walk that comes back to a
 * row it passed has found a cycle, the rows from there on. Walks start from
 * the rows in order and never cross a row walked before, so every row is
 * walked once and every cycle found once.
 */
export function findCycles(
  parentOf: ReadonlyMap<string, string>,
): Array<Array<string>> {
  const cycles: Array<Array<string>> = [];
  const walked: Set<string> = new Set<string>();

  for (const start of [...parentOf.keys()].sort()) {
    const path: Array<string> = [];
    const placeOnPath: Map<string, number> = new Map<string, number>();
    let current: string | undefined = start;

    while (
      current !== undefined &&
      parentOf.has(current) &&
      !walked.has(current)
    ) {
      walked.add(current);
      placeOnPath.set(current, path.length);
      path.push(current);
      current = parentOf.get(current);
    }

    const cycleStart: number | undefined =
      current === undefined ? undefined : placeOnPath.get(current);

    if (cycleStart !== undefined) {
      cycles.push(path.slice(cycleStart));
    }
  }

  return cycles;
}

export default class NetworkSiteLeafPurge {
  /*
   * One call of the retention job for one table: the leaves, or else the
   * closed cycles, deleted in the lock of their projects. How many rows went.
   */
  public static async purgeBatch<TBaseModel extends BaseModel>(
    batch: LeafPurgeBatch<TBaseModel>,
  ): Promise<number> {
    if (batch.limit <= 0) {
      return 0;
    }

    const leaves: Array<PurgeRow> = await this.readLeaves(batch);

    if (leaves.length > 0) {
      return await this.hardDeleteInLock(batch, leaves);
    }

    /*
     * A page past the first found no leaf. The cycles and the log belong to
     * a call from the first row: a cycle has no pages, and rows only skipped
     * are no reason to say rows stay. The job always asks from the first.
     */
    if (batch.skip > 0) {
      return 0;
    }

    const cycles: Array<PurgeRow> = await this.readClosedCycles(batch);

    if (cycles.length > 0) {
      return await this.hardDeleteInLock(batch, cycles);
    }

    await this.logRowsThatStay(batch);

    return 0;
  }

  /*
   * The row at `alias` is named by no row in any of the columns: NOT EXISTS,
   * for each, a row - live or deleted - whose column holds its id.
   */
  public static namedByNoRow(
    namedBy: Array<NamingColumn>,
  ): FindOperator<unknown> {
    const clauses: Array<(alias: string) => string> = namedBy.map(
      (naming: NamingColumn, index: number): ((alias: string) => string) => {
        const table: string = quoted(naming.table);
        const column: string = quoted(naming.column);
        const row: string = quoted(`leafPurgeNamingRow${index}`);

        return (alias: string): string => {
          return `NOT EXISTS (SELECT 1 FROM ${table} AS ${row} WHERE ${row}.${column} = ${alias})`;
        };
      },
    );

    return Raw((alias: string): string => {
      return `(${clauses
        .map((clause: (alias: string) => string): string => {
          return clause(alias);
        })
        .join(" AND ")})`;
    });
  }

  /*
   * The row at `alias` is named by exactly one row across all the columns.
   * Every row of a closed cycle is: the row before it in the cycle names it,
   * and nothing else does. Counted once for the whole table, grouped by the
   * id named, so the read costs one pass over the naming columns.
   */
  public static namedByOneRow(
    namedBy: Array<NamingColumn>,
  ): FindOperator<unknown> {
    const namedIds: string = namedBy
      .map((naming: NamingColumn, index: number): string => {
        const table: string = quoted(naming.table);
        const column: string = quoted(naming.column);
        const row: string = quoted(`leafPurgeNamingRow${index}`);

        return `SELECT ${row}.${column} AS "namedId" FROM ${table} AS ${row} WHERE ${row}.${column} IS NOT NULL`;
      })
      .join(" UNION ALL ");

    return Raw((alias: string): string => {
      return `(${alias} IN (SELECT "named"."namedId" FROM (${namedIds}) AS "named" GROUP BY "named"."namedId" HAVING COUNT(*) = 1))`;
    });
  }

  /*
   * The query, with `condition` added on the row's id. A condition the query
   * already puts on the id is kept beside it, as QueryUtil.serializeQuery
   * keeps one beside its own.
   */
  public static withIdCondition<TBaseModel extends BaseModel>(
    query: Query<TBaseModel>,
    condition: FindOperator<unknown>,
  ): Query<TBaseModel> {
    const asked: unknown = (query as Record<string, unknown>)["_id"];

    if (asked === undefined) {
      return { ...query, _id: condition } as Query<TBaseModel>;
    }

    if (asked instanceof FindOperator) {
      return {
        ...query,
        _id: And(asked as FindOperator<unknown>, condition),
      } as Query<TBaseModel>;
    }

    if (typeof asked === "string") {
      return {
        ...query,
        _id: And(
          QueryHelper.equalTo(asked) as FindOperator<unknown>,
          condition,
        ),
      } as Query<TBaseModel>;
    }

    throw new BadDataException(
      "The retention purge cannot combine this query's condition on the row id with its own.",
    );
  }

  private static async readLeaves<TBaseModel extends BaseModel>(
    batch: LeafPurgeBatch<TBaseModel>,
  ): Promise<Array<PurgeRow>> {
    const rows: Array<TBaseModel> = await batch.read({
      query: this.withIdCondition(
        batch.due,
        this.namedByNoRow(batch.shape.namedBy),
      ),
      select: { _id: true, projectId: true } as Select<TBaseModel>,
      sort: { _id: SortOrder.Ascending } as Sort<TBaseModel>,
      limit: batch.limit,
      skip: batch.skip,
      props: { isRoot: true },
    });

    return this.purgeRowsOf(rows);
  }

  /*
   * The closed cycles of due rows, whole, as many as fit in the limit. Its
   * rows are all named by exactly one row, so they are among the due rows
   * read here; a cycle this read cannot see whole is not one it removes.
   */
  private static async readClosedCycles<TBaseModel extends BaseModel>(
    batch: LeafPurgeBatch<TBaseModel>,
  ): Promise<Array<PurgeRow>> {
    const parentColumn: string = batch.shape.parentColumn;

    const rows: Array<TBaseModel> = await batch.read({
      query: this.withIdCondition(
        batch.due,
        this.namedByOneRow(batch.shape.namedBy),
      ),
      select: {
        _id: true,
        projectId: true,
        [parentColumn]: true,
      } as Select<TBaseModel>,
      sort: { _id: SortOrder.Ascending } as Sort<TBaseModel>,
      limit: batch.limit,
      skip: 0,
      props: { isRoot: true },
    });

    const rowById: Map<string, PurgeRow> = new Map<string, PurgeRow>();
    const parentOf: Map<string, string> = new Map<string, string>();

    for (const row of rows) {
      const purgeRow: PurgeRow | null = this.purgeRowOf(row);
      const parentId: unknown = (row as unknown as Record<string, unknown>)[
        parentColumn
      ];

      if (!purgeRow || !parentId) {
        continue;
      }

      rowById.set(normalizeId(purgeRow.id), purgeRow);
      parentOf.set(normalizeId(purgeRow.id), normalizeId(String(parentId)));
    }

    const chosen: Array<PurgeRow> = [];

    for (const cycle of findCycles(parentOf)) {
      // A cycle goes whole: a part would leave a row naming one deleted.
      if (chosen.length + cycle.length > batch.limit) {
        continue;
      }

      for (const id of cycle) {
        chosen.push(rowById.get(id)!);
      }
    }

    return chosen;
  }

  private static async hardDeleteInLock<TBaseModel extends BaseModel>(
    batch: LeafPurgeBatch<TBaseModel>,
    rows: Array<PurgeRow>,
  ): Promise<number> {
    return await NetworkSiteHierarchyLock.runExclusive({
      projectIds: rows.map((row: PurgeRow): ObjectID => {
        return row.projectId;
      }),
      operation: async (): Promise<number> => {
        return await batch.hardDeleteByIds(
          rows.map((row: PurgeRow): ObjectID => {
            return row.id;
          }),
        );
      },
    });
  }

  /*
   * No row can go, so every due row is named by some other row: a live one,
   * one deleted too recently, or a row of a cycle that a row outside it
   * names. They wait for those rows; the log says which they are.
   */
  private static async logRowsThatStay<TBaseModel extends BaseModel>(
    batch: LeafPurgeBatch<TBaseModel>,
  ): Promise<void> {
    const rows: Array<TBaseModel> = await batch.read({
      query: batch.due,
      select: { _id: true } as Select<TBaseModel>,
      sort: { _id: SortOrder.Ascending } as Sort<TBaseModel>,
      limit: ROWS_NAMED_IN_LOG + 1,
      skip: 0,
      props: { isRoot: true },
    });

    if (rows.length === 0) {
      return;
    }

    const ids: Array<string> = rows
      .slice(0, ROWS_NAMED_IN_LOG)
      .map((row: TBaseModel): string => {
        return row.id ? row.id.toString() : "";
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      });
    const howMany: string =
      rows.length > ROWS_NAMED_IN_LOG
        ? `more than ${ROWS_NAMED_IN_LOG}`
        : `${rows.length}`;

    logger.warn(
      `Retention purge kept the ${batch.shape.rowsName} due for purge that other rows still name: a live row, a row deleted too recently, or a cycle of parents that a row outside it names. Count: ${howMany}. Ids: ${ids.join(", ")}`,
    );
  }

  private static purgeRowsOf<TBaseModel extends BaseModel>(
    rows: Array<TBaseModel>,
  ): Array<PurgeRow> {
    return rows
      .map((row: TBaseModel): PurgeRow | null => {
        return this.purgeRowOf(row);
      })
      .filter((row: PurgeRow | null): row is PurgeRow => {
        return row !== null;
      });
  }

  // A row with its id and project, or null for one without: no lock can take it.
  private static purgeRowOf<TBaseModel extends BaseModel>(
    row: TBaseModel,
  ): PurgeRow | null {
    const projectId: unknown = (row as unknown as Record<string, unknown>)[
      "projectId"
    ];

    if (!row.id || !projectId) {
      return null;
    }

    return {
      id: row.id,
      projectId: projectId as ObjectID,
    };
  }
}
