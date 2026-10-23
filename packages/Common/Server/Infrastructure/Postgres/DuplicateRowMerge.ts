import logger from "../../Utils/Logger";
import { QueryRunner } from "typeorm";

/*
 * Merges rows that are one thing twice into the oldest of them - before a
 * unique index that would refuse the second one can be built.
 *
 * WHY
 *
 * Ingest creates a host the first time telemetry names it, and nothing in
 * the database stopped two batches that met a new host at once from both
 * creating it (issue #5214: a re-installed Docker agent's first batches made
 * two "test01"). A unique index stops that from now on, and it cannot be
 * built while a project still holds such a pair. Deleting the extra rows
 * would throw away what hangs off them - the containers they list, their
 * labels and owners, the incidents, alerts, monitors and maintenance events
 * that name them, their feed, their AI agent - so they are merged instead.
 *
 * WHAT IT DOES
 *
 * Rows are duplicates when `duplicateKey` (SQL over the table's columns, as
 * the coming index compares them) is the same, among the rows `where`
 * selects. In each group the oldest row (createdAt, then _id) is kept, and
 * each other row, in turn:
 *
 *   - hands every row that refers to it to the kept row: each table with a
 *     foreign key to this table, read from the catalog when the merge runs
 *     (so a table added by any migration before this one is included), and
 *     the columns that hold its id without a foreign key
 *     (`columnsWithoutForeignKey` - a resource AI agent, a recommendation
 *     dismissed for it, an inventory item linked to it);
 *   - where a row cannot move because the kept row already has its twin
 *     (a unique index of that table over the referring column - the kept
 *     host already lists that container, already has that label, that owner,
 *     that incident), the kept row's twin stays, and what refers to the moved
 *     row's twin is handed to it first, the same way (an incident's link to
 *     a container that both hosts listed is kept, on the kept host's
 *     container);
 *   - is deleted, now that nothing refers to it.
 *
 * The kept row then takes what the group knew: what the agent reports
 * (`latestOf` - the last-seen time, the status, the versions) from the row
 * the agent wrote to last, which may well be a duplicate; what a person
 * set (`keptOrFirstOf` - a description, a retention) only where the kept
 * row has none of its own; and columns that only make sense together
 * (`takenTogether` - whether it is archived, with when and by whom; the AI
 * settings an operator chose) from one row: its own where they are what is
 * wanted, else the row seen last where they are.
 *
 * Each group is merged in a transaction of its own, so locks are held for one
 * group at a time and a run stopped part way leaves whole groups merged; run
 * again, it merges what is left. A unique index it cannot read (an expression,
 * or a WHERE other than "deletedAt" IS NULL) over a referring column stops the
 * merge with its name rather than guess - no such index exists on a table
 * that refers to a host today.
 */

export interface ColumnWithoutForeignKey {
  // The table, as written in SQL without quotes: "ResourceAiAgent".
  table: string;
  // The column that holds an id of the merged table: "resourceId".
  column: string;
}

/*
 * Columns the kept row takes from one row of the group, all at once: its
 * own when `where` holds for it, else those of the row seen last for which
 * it holds, and still its own when it holds for none. For what is set
 * together and has no empty value to tell "not set" by - an archived flag
 * with when and by whom, AI settings with the time an operator chose them.
 */
export interface ColumnsTakenTogether {
  // The columns, without quotes: "isArchived", "archivedAt".
  columns: ReadonlyArray<string>;
  /*
   * SQL over one row of the table, aliased `member`, true where its values
   * are the ones to keep: `member."isArchived" IS NOT TRUE`.
   */
  where: string;
}

export interface DuplicateRowMergeOptions {
  // The table whose duplicates are merged, without quotes: "DockerHost".
  table: string;
  /*
   * What makes rows duplicates, as SQL over the table's columns - exactly
   * what the unique index about to be built compares:
   * `"projectId", LOWER("hostIdentifier")`.
   */
  duplicateKey: string;
  // Which rows take part, as SQL: `"deletedAt" IS NULL`.
  where: string;
  // Columns of other tables that hold this table's ids without a foreign key.
  columnsWithoutForeignKey: ReadonlyArray<ColumnWithoutForeignKey>;
  /*
   * Columns the kept row takes from the group's rows seen last (by
   * `latestBy`): the first value there is, newest first - its own included.
   */
  latestOf: ReadonlyArray<string>;
  /*
   * Columns the kept row keeps when it has a value, and otherwise takes from
   * the group's rows seen last that have one.
   */
  keptOrFirstOf: ReadonlyArray<string>;
  /*
   * Columns taken together from one row (ColumnsTakenTogether). A column is
   * in one of latestOf, keptOrFirstOf and these, never two.
   */
  takenTogether?: ReadonlyArray<ColumnsTakenTogether> | undefined;
  // The column that says which row was seen last: "lastSeenAt".
  latestBy: string;
}

export interface DuplicateRowMergeResult {
  // Groups of duplicates found and merged.
  groupsMerged: number;
  // Duplicate rows merged into the row kept, and deleted.
  rowsMerged: number;
  // Rows of other tables now referring to a kept row instead of a duplicate.
  referencesMoved: number;
  // Rows of other tables dropped because the kept row already had their twin.
  twinsDropped: number;
}

// A table that refers to another, by one column.
interface Referrer {
  // The referring table, as SQL: "DockerResource" (regclass text, quoted).
  table: string;
  // The referring column, as SQL: "dockerHostId" (quoted).
  column: string;
}

// A unique index of a referring table that includes its referring column.
interface ReferrerUniqueIndex {
  // As SQL, quoted: "IDX_0355903ed10c35eed76eacefb4".
  name: string;
  // Its other columns, as SQL (quoted), compared between the two rows.
  otherColumns: Array<string>;
  // Whether the index is partial on "deletedAt" IS NULL.
  isOnLiveRowsOnly: boolean;
  // NULLS NOT DISTINCT (Postgres 15): NULLs compare equal.
  nullsAreEqual: boolean;
}

interface Counts {
  referencesMoved: number;
  twinsDropped: number;
}

// How deep twins are followed: a host, its containers, their incident links.
const MAX_DEPTH: number = 4;

// The only partial unique index predicate the merge reads.
const LIVE_ROWS_ONLY_PREDICATE: string = '("deletedAt" IS NULL)';

export default class DuplicateRowMerge {
  /*
   * Merges every group of duplicates of `options.table`. Needs a migration
   * with `transaction = false`: each group gets a transaction of its own.
   */
  public static async merge(
    queryRunner: QueryRunner,
    options: DuplicateRowMergeOptions,
  ): Promise<DuplicateRowMergeResult> {
    const result: DuplicateRowMergeResult = {
      groupsMerged: 0,
      rowsMerged: 0,
      referencesMoved: 0,
      twinsDropped: 0,
    };

    const groups: Map<string, Array<string>> = await this.findDuplicates(
      queryRunner,
      options,
    );

    if (groups.size === 0) {
      return result;
    }

    const merge: DuplicateRowMerge = new DuplicateRowMerge(queryRunner);

    for (const [keptId, duplicateIds] of groups.entries()) {
      await queryRunner.startTransaction();

      try {
        const counts: Counts = await merge.mergeGroup({
          options: options,
          keptId: keptId,
          duplicateIds: duplicateIds,
        });

        await queryRunner.commitTransaction();

        result.groupsMerged++;
        result.rowsMerged += duplicateIds.length;
        result.referencesMoved += counts.referencesMoved;
        result.twinsDropped += counts.twinsDropped;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      }
    }

    logger.info(
      `Merged ${result.rowsMerged} duplicate ${options.table} row(s) into ${result.groupsMerged} kept row(s): ${result.referencesMoved} referring row(s) moved, ${result.twinsDropped} dropped as twins of the kept row's.`,
    );

    return result;
  }

  /*
   * Each group's kept row (the oldest), with the ids of the rows merged into
   * it, oldest first.
   */
  public static async findDuplicates(
    queryRunner: QueryRunner,
    options: Pick<DuplicateRowMergeOptions, "table" | "duplicateKey" | "where">,
  ): Promise<Map<string, Array<string>>> {
    const rows: Array<{ duplicateId: string; keptId: string }> =
      await queryRunner.query(
        `SELECT "_id"::text AS "duplicateId", "keptId"::text AS "keptId"
           FROM (
             SELECT "_id", "createdAt",
                    first_value("_id") OVER (
                      PARTITION BY ${options.duplicateKey}
                      ORDER BY "createdAt" ASC, "_id" ASC
                    ) AS "keptId"
               FROM "${options.table}"
              WHERE ${options.where}
           ) grouped
          WHERE "_id" <> "keptId"
          ORDER BY "keptId", "createdAt" ASC, "_id" ASC`,
      );

    const groups: Map<string, Array<string>> = new Map<string, Array<string>>();

    for (const row of rows) {
      const duplicates: Array<string> = groups.get(row.keptId) || [];
      duplicates.push(row.duplicateId);
      groups.set(row.keptId, duplicates);
    }

    return groups;
  }

  private queryRunner: QueryRunner;

  // Catalog reads, per table, for one merge run.
  private referrers: Map<string, Array<Referrer>> = new Map<
    string,
    Array<Referrer>
  >();

  private uniqueIndexes: Map<string, Array<ReferrerUniqueIndex>> = new Map<
    string,
    Array<ReferrerUniqueIndex>
  >();

  private idColumnTables: Map<string, boolean> = new Map<string, boolean>();

  private constructor(queryRunner: QueryRunner) {
    this.queryRunner = queryRunner;
  }

  private async mergeGroup(data: {
    options: DuplicateRowMergeOptions;
    keptId: string;
    duplicateIds: Array<string>;
  }): Promise<Counts> {
    const counts: Counts = { referencesMoved: 0, twinsDropped: 0 };
    const table: string = `"${data.options.table}"`;

    const referrers: Array<Referrer> = [
      ...(await this.getReferrers(table)),
      ...(await this.getColumnsWithoutForeignKey(
        data.options.columnsWithoutForeignKey,
      )),
    ];

    // Read before the duplicates go: what the group knew.
    await this.takeOver({
      table: table,
      keptId: data.keptId,
      memberIds: [data.keptId, ...data.duplicateIds],
      latestOf: data.options.latestOf,
      keptOrFirstOf: data.options.keptOrFirstOf,
      takenTogether: data.options.takenTogether || [],
      latestBy: data.options.latestBy,
    });

    for (const duplicateId of data.duplicateIds) {
      await this.moveReferences({
        referrers: referrers,
        fromId: duplicateId,
        toId: data.keptId,
        depth: 0,
        counts: counts,
      });
    }

    await this.queryRunner.query(
      `DELETE FROM ${table} WHERE "_id" = ANY($1::uuid[])`,
      [data.duplicateIds],
    );

    return counts;
  }

  /*
   * Every row that refers to `fromId` refers to `toId` instead - but a row
   * whose twin already refers to `toId` (a unique index over the referring
   * column says they are one) is dropped, after what refers to it is handed
   * to the twin.
   */
  private async moveReferences(data: {
    referrers: Array<Referrer>;
    fromId: string;
    toId: string;
    depth: number;
    counts: Counts;
  }): Promise<void> {
    for (const referrer of data.referrers) {
      for (const index of await this.getUniqueIndexes(referrer)) {
        await this.dropTwins({
          referrer: referrer,
          index: index,
          fromId: data.fromId,
          toId: data.toId,
          depth: data.depth,
          counts: data.counts,
        });
      }

      const moved: number = this.countOf(
        await this.queryRunner.query(
          `WITH "moved" AS (
             UPDATE ${referrer.table} SET ${referrer.column} = $2
              WHERE ${referrer.column} = $1
             RETURNING 1
           )
           SELECT COUNT(*)::int AS "count" FROM "moved"`,
          [data.fromId, data.toId],
        ),
      );

      data.counts.referencesMoved += moved;
    }
  }

  /*
   * The rows referring to `fromId` that would break `index` once they
   * referred to `toId`: the row referring to `toId` with the same values
   * stays, and theirs go - after their own referrers are handed to it, when
   * other tables refer to them.
   */
  private async dropTwins(data: {
    referrer: Referrer;
    index: ReferrerUniqueIndex;
    fromId: string;
    toId: string;
    depth: number;
    counts: Counts;
  }): Promise<void> {
    const conditions: Array<string> = data.index.otherColumns.map(
      (column: string): string => {
        return data.index.nullsAreEqual
          ? `kept.${column} IS NOT DISTINCT FROM twin.${column}`
          : `kept.${column} = twin.${column}`;
      },
    );

    if (data.index.isOnLiveRowsOnly) {
      conditions.push(`twin."deletedAt" IS NULL`, `kept."deletedAt" IS NULL`);
    }

    const matches: string = [
      `twin.${data.referrer.column} = $1`,
      `kept.${data.referrer.column} = $2`,
      ...conditions,
    ].join(" AND ");

    const twinReferrers: Array<Referrer> =
      data.depth + 1 < MAX_DEPTH &&
      (await this.hasIdColumn(data.referrer.table))
        ? await this.getReferrers(data.referrer.table)
        : [];

    if (twinReferrers.length > 0) {
      const pairs: Array<{ twinId: string; keptId: string }> =
        await this.queryRunner.query(
          `SELECT twin."_id"::text AS "twinId", kept."_id"::text AS "keptId"
             FROM ${data.referrer.table} twin, ${data.referrer.table} kept
            WHERE ${matches}`,
          [data.fromId, data.toId],
        );

      for (const pair of pairs) {
        await this.moveReferences({
          referrers: twinReferrers,
          fromId: pair.twinId,
          toId: pair.keptId,
          depth: data.depth + 1,
          counts: data.counts,
        });
      }
    }

    const dropped: number = this.countOf(
      await this.queryRunner.query(
        `WITH "dropped" AS (
           DELETE FROM ${data.referrer.table} twin
            USING ${data.referrer.table} kept
            WHERE ${matches}
           RETURNING 1
         )
         SELECT COUNT(*)::int AS "count" FROM "dropped"`,
        [data.fromId, data.toId],
      ),
    );

    data.counts.twinsDropped += dropped;
  }

  /*
   * The kept row takes what the group knew: each group of takenTogether
   * from one row, all at once - first, while every row is as it was - then,
   * column by column, for latestOf the first value of the rows seen last,
   * for keptOrFirstOf its own value, else that.
   */
  private async takeOver(data: {
    table: string;
    keptId: string;
    memberIds: Array<string>;
    latestOf: ReadonlyArray<string>;
    keptOrFirstOf: ReadonlyArray<string>;
    takenTogether: ReadonlyArray<ColumnsTakenTogether>;
    latestBy: string;
  }): Promise<void> {
    const seenLastFirst: string = `ORDER BY member."${data.latestBy}" DESC NULLS LAST, member."createdAt" ASC, member."_id" ASC`;

    for (const together of data.takenTogether) {
      if (together.columns.length === 0) {
        continue;
      }

      /*
       * Nothing to do when the kept row's own hold; else the row seen last
       * whose do - none, and the FROM is empty, so nothing changes.
       */
      await this.queryRunner.query(
        `UPDATE ${data.table} kept
            SET ${together.columns
              .map((column: string): string => {
                return `"${column}" = source."${column}"`;
              })
              .join(", ")}
           FROM (
             SELECT member.* FROM ${data.table} member
              WHERE member."_id" = ANY($2::uuid[]) AND (${together.where})
              ${seenLastFirst}
              LIMIT 1
           ) source
          WHERE kept."_id" = $1
            AND NOT EXISTS (
              SELECT 1 FROM ${data.table} member
               WHERE member."_id" = $1 AND (${together.where})
            )`,
        [data.keptId, data.memberIds],
      );
    }

    const newestValueOf: (column: string) => string = (
      column: string,
    ): string => {
      return `(SELECT member."${column}" FROM ${data.table} member
                WHERE member."_id" = ANY($2::uuid[]) AND member."${column}" IS NOT NULL
                ${seenLastFirst}
                LIMIT 1)`;
    };

    const assignments: Array<string> = [
      ...data.latestOf.map((column: string): string => {
        return `"${column}" = COALESCE(${newestValueOf(column)}, kept."${column}")`;
      }),
      ...data.keptOrFirstOf.map((column: string): string => {
        return `"${column}" = COALESCE(kept."${column}", ${newestValueOf(column)})`;
      }),
    ];

    if (assignments.length === 0) {
      return;
    }

    await this.queryRunner.query(
      `UPDATE ${data.table} kept SET ${assignments.join(", ")}
        WHERE kept."_id" = $1`,
      [data.keptId, data.memberIds],
    );
  }

  // The tables with a one-column foreign key to `table`'s rows.
  private async getReferrers(table: string): Promise<Array<Referrer>> {
    const known: Array<Referrer> | undefined = this.referrers.get(table);

    if (known) {
      return known;
    }

    const rows: Array<Referrer> = await this.queryRunner.query(
      `SELECT c.conrelid::regclass::text AS "table",
              quote_ident(a.attname) AS "column"
         FROM pg_constraint c
         JOIN pg_attribute a
           ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f'
          AND c.confrelid = to_regclass($1)
          AND array_length(c.conkey, 1) = 1
        ORDER BY 1, 2`,
      [table],
    );

    this.referrers.set(table, rows);

    return rows;
  }

  // The columns without a foreign key, of the tables that exist.
  private async getColumnsWithoutForeignKey(
    columns: ReadonlyArray<ColumnWithoutForeignKey>,
  ): Promise<Array<Referrer>> {
    const referrers: Array<Referrer> = [];

    for (const entry of columns) {
      const rows: Array<{ table: string | null; column: string | null }> =
        await this.queryRunner.query(
          `SELECT to_regclass($1)::text AS "table",
                  (SELECT quote_ident(a.attname)
                     FROM pg_attribute a
                    WHERE a.attrelid = to_regclass($1)
                      AND a.attname = $2
                      AND NOT a.attisdropped) AS "column"`,
          [`"${entry.table}"`, entry.column],
        );

      const row: { table: string | null; column: string | null } | undefined =
        rows[0];

      if (!row || !row.table || !row.column) {
        logger.warn(
          `DuplicateRowMerge: "${entry.table}"."${entry.column}" does not exist here; nothing of it to move.`,
        );
        continue;
      }

      referrers.push({ table: row.table, column: row.column });
    }

    return referrers;
  }

  /*
   * The unique indexes of a referring table that include its referring
   * column, with their other columns.
   */
  private async getUniqueIndexes(
    referrer: Referrer,
  ): Promise<Array<ReferrerUniqueIndex>> {
    const key: string = `${referrer.table}.${referrer.column}`;
    const known: Array<ReferrerUniqueIndex> | undefined =
      this.uniqueIndexes.get(key);

    if (known) {
      return known;
    }

    const rows: Array<{
      name: string;
      columns: Array<string>;
      hasExpressions: boolean;
      predicate: string | null;
      nullsAreEqual: boolean;
    }> = await this.queryRunner.query(
      `SELECT i.indexrelid::regclass::text AS "name",
              ARRAY(
                SELECT quote_ident(a.attname)
                  FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
                  JOIN pg_attribute a
                    ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                 ORDER BY k.position
              ) AS "columns",
              i.indexprs IS NOT NULL AS "hasExpressions",
              pg_get_expr(i.indpred, i.indrelid) AS "predicate",
              COALESCE((to_jsonb(i) ->> 'indnullsnotdistinct')::boolean, false) AS "nullsAreEqual"
         FROM pg_index i
        WHERE i.indrelid = to_regclass($1)
          AND i.indisunique`,
      [referrer.table],
    );

    const indexes: Array<ReferrerUniqueIndex> = [];

    for (const row of rows) {
      const columns: Array<string> = Array.isArray(row.columns)
        ? row.columns
        : [];

      if (!columns.includes(referrer.column)) {
        continue;
      }

      if (
        row.hasExpressions ||
        (row.predicate !== null && row.predicate !== LIVE_ROWS_ONLY_PREDICATE)
      ) {
        throw new Error(
          `DuplicateRowMerge cannot tell which rows of ${referrer.table} the unique index ${row.name} counts as twins (an expression, or WHERE ${row.predicate}), so it does not move ${referrer.table}.${referrer.column}. Merge that table's rows by hand, then run the migration again.`,
        );
      }

      indexes.push({
        name: row.name,
        otherColumns: columns.filter((column: string): boolean => {
          return column !== referrer.column;
        }),
        isOnLiveRowsOnly: row.predicate === LIVE_ROWS_ONLY_PREDICATE,
        nullsAreEqual: row.nullsAreEqual === true,
      });
    }

    this.uniqueIndexes.set(key, indexes);

    return indexes;
  }

  // Whether a table's rows have an "_id" others can refer to.
  private async hasIdColumn(table: string): Promise<boolean> {
    const known: boolean | undefined = this.idColumnTables.get(table);

    if (known !== undefined) {
      return known;
    }

    const rows: Array<{ hasId: boolean }> = await this.queryRunner.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = to_regclass($1)
            AND a.attname = '_id'
            AND NOT a.attisdropped
       ) AS "hasId"`,
      [table],
    );

    const hasId: boolean = rows[0]?.hasId === true;

    this.idColumnTables.set(table, hasId);

    return hasId;
  }

  private countOf(rows: unknown): number {
    const first: { count?: unknown } | undefined = Array.isArray(rows)
      ? (rows[0] as { count?: unknown } | undefined)
      : undefined;

    const count: number = Number(first?.count ?? 0);

    return Number.isFinite(count) ? count : 0;
  }
}
