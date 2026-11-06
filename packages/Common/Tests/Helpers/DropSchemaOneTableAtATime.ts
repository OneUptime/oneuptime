import { DataSource } from "typeorm";

export type DropSchemaOneTableAtATimeFunction = (
  database: DataSource,
  schema: string,
) => Promise<void>;

/*
 * For a suite that clones every table of the database into a schema of its own.
 *
 * `DROP SCHEMA ... CASCADE` locks everything in the schema inside one transaction: each table,
 * each of its indexes, its TOAST table. A clone of every table now holds more of those than a
 * stock Postgres has room for in its lock table (max_locks_per_transaction, 64, for each of 100
 * connections), so the drop failed with "out of shared memory", failing a suite whose tests had
 * all passed. One table at a time never holds more than a few locks.
 */
export const dropSchemaOneTableAtATime: DropSchemaOneTableAtATimeFunction =
  async (database: DataSource, schema: string): Promise<void> => {
    const tables: Array<{ tablename: string }> = await database.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = $1",
      [schema],
    );

    for (const table of tables) {
      await database.query(
        `DROP TABLE IF EXISTS "${schema}"."${table.tablename}" CASCADE`,
      );
    }

    await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  };
