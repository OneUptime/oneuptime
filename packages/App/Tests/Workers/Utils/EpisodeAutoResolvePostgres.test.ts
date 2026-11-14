import ObjectID from "Common/Types/ObjectID";
import { DataSource } from "Common/node_modules/typeorm";
import {
  EpisodeMemberTables,
  getEpisodeMemberCountsSql,
} from "../../../FeatureSet/Workers/Utils/EpisodeAutoResolve";

/*
 * THE EPISODE AUTO-RESOLVE AGGREGATE QUERY, ON POSTGRES.
 *
 * AlertEpisode:AutoResolve and IncidentEpisode:AutoResolve count each
 * page's episode members, and how many are unresolved, in one raw query
 * (getEpisodeMemberCountsSql) where they used to read members and records
 * episode by episode. EpisodeAutoResolve.test.ts pins the engine around it
 * against an in-memory stand-in; this runs the SQL itself against the
 * migrated tables' structure and pins that it counts as the old reads did:
 *
 *   - members whose row was soft-deleted, or that name no record, do not
 *     count;
 *   - a member whose record was deleted counts as a member, not as
 *     unresolved (the old alert read skipped it);
 *   - a record in a state at or after its project's resolved state is
 *     resolved; one whose state is gone or unset counts as order 0;
 *   - an episode with no members returns no row;
 *   - each episode is judged by its own resolved order.
 *
 * Opt in with RUN_POSTGRES_EPISODE_AUTO_RESOLVE_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The tables' STRUCTURE is
 * cloned into a unique schema, dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * EPISODE_AUTO_RESOLVE_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * EPISODE_AUTO_RESOLVE_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EPISODE_AUTO_RESOLVE_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;

const ALERT_TABLES: EpisodeMemberTables = {
  memberTable: "AlertEpisodeMember",
  memberEpisodeColumn: "alertEpisodeId",
  memberRecordColumn: "alertId",
  recordTable: "Alert",
  recordStateColumn: "currentAlertStateId",
  stateTable: "AlertState",
};

const INCIDENT_TABLES: EpisodeMemberTables = {
  memberTable: "IncidentEpisodeMember",
  memberEpisodeColumn: "incidentEpisodeId",
  memberRecordColumn: "incidentId",
  recordTable: "Incident",
  recordStateColumn: "currentIncidentStateId",
  stateTable: "IncidentState",
};

interface Counts {
  episodeId: string;
  memberCount: number;
  unresolvedCount: number;
}

describePostgres("the episode auto-resolve aggregate query", () => {
  const schema: string = `episode_auto_resolve_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["EPISODE_AUTO_RESOLVE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["EPISODE_AUTO_RESOLVE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["EPISODE_AUTO_RESOLVE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      synchronize: false,
      // The query names its tables bare: these resolve to the clones.
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();

    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const tables of [ALERT_TABLES, INCIDENT_TABLES]) {
      for (const table of [
        tables.memberTable,
        tables.recordTable,
        tables.stateTable,
      ]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING INDEXES)`,
        );

        // Only the columns the query reads are written: let the rest be empty.
        const columns: Array<{ column_name: string }> = await database.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_name <> '_id'`,
          [schema, table],
        );

        for (const { column_name } of columns) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column_name}" DROP NOT NULL`,
          );
        }
      }
    }
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function addState(
    tables: EpisodeMemberTables,
    order: number,
    deleted: boolean = false,
  ): Promise<string> {
    const id: string = ObjectID.generate().toString();
    await database.query(
      `INSERT INTO "${tables.stateTable}" ("_id", "order", "deletedAt") VALUES ($1, $2, $3)`,
      [id, order, deleted ? new Date() : null],
    );
    return id;
  }

  async function addRecord(
    tables: EpisodeMemberTables,
    stateId: string | null,
    deleted: boolean = false,
  ): Promise<string> {
    const id: string = ObjectID.generate().toString();
    await database.query(
      `INSERT INTO "${tables.recordTable}" ("_id", "${tables.recordStateColumn}", "deletedAt") VALUES ($1, $2, $3)`,
      [id, stateId, deleted ? new Date() : null],
    );
    return id;
  }

  async function addMember(
    tables: EpisodeMemberTables,
    episodeId: string,
    recordId: string | null,
    deleted: boolean = false,
  ): Promise<void> {
    await database.query(
      `INSERT INTO "${tables.memberTable}" ("_id", "${tables.memberEpisodeColumn}", "${tables.memberRecordColumn}", "deletedAt") VALUES ($1, $2, $3, $4)`,
      [
        ObjectID.generate().toString(),
        episodeId,
        recordId,
        deleted ? new Date() : null,
      ],
    );
  }

  async function count(
    tables: EpisodeMemberTables,
    page: Array<{ episodeId: string; resolvedOrder: number }>,
  ): Promise<Map<string, Counts>> {
    const rows: Array<Counts> = await database.query(
      getEpisodeMemberCountsSql(tables),
      [
        page.map((entry: { episodeId: string }) => {
          return entry.episodeId;
        }),
        page.map((entry: { resolvedOrder: number }) => {
          return entry.resolvedOrder;
        }),
      ],
    );

    return new Map(
      rows.map((row: Counts): [string, Counts] => {
        return [row.episodeId, row];
      }),
    );
  }

  for (const tables of [ALERT_TABLES, INCIDENT_TABLES]) {
    test(`${tables.recordTable} episodes are counted as the old reads counted them`, async () => {
      // A project's list: open (1), acknowledged (2), resolved (3), after it (4).
      const open: string = await addState(tables, 1);
      const acknowledged: string = await addState(tables, 2);
      const resolved: string = await addState(tables, 3);
      const afterResolved: string = await addState(tables, 4);
      const deletedState: string = await addState(tables, 3, true);

      // 1. All resolved, one placed after the resolved state.
      const allResolved: string = ObjectID.generate().toString();
      await addMember(tables, allResolved, await addRecord(tables, resolved));
      await addMember(
        tables,
        allResolved,
        await addRecord(tables, afterResolved),
      );

      // 2. One open, one acknowledged, one resolved.
      const mixed: string = ObjectID.generate().toString();
      await addMember(tables, mixed, await addRecord(tables, open));
      await addMember(tables, mixed, await addRecord(tables, acknowledged));
      await addMember(tables, mixed, await addRecord(tables, resolved));

      // 3. Its open member left the episode, and a member names no record.
      const left: string = ObjectID.generate().toString();
      await addMember(tables, left, await addRecord(tables, resolved));
      await addMember(tables, left, await addRecord(tables, open), true);
      await addMember(tables, left, null);

      // 4. Its open record was deleted: a member still, not unresolved.
      const recordGone: string = ObjectID.generate().toString();
      await addMember(tables, recordGone, await addRecord(tables, resolved));
      await addMember(tables, recordGone, await addRecord(tables, open, true));

      // 5. A record with no state, and one whose state was deleted: order 0.
      const noState: string = ObjectID.generate().toString();
      await addMember(tables, noState, await addRecord(tables, null));
      await addMember(tables, noState, await addRecord(tables, deletedState));

      // 6. No members at all.
      const empty: string = ObjectID.generate().toString();

      const counts: Map<string, Counts> = await count(tables, [
        { episodeId: allResolved, resolvedOrder: 3 },
        { episodeId: mixed, resolvedOrder: 3 },
        { episodeId: left, resolvedOrder: 3 },
        { episodeId: recordGone, resolvedOrder: 3 },
        { episodeId: noState, resolvedOrder: 3 },
        { episodeId: empty, resolvedOrder: 3 },
      ]);

      expect(counts.get(allResolved)).toEqual({
        episodeId: allResolved,
        memberCount: 2,
        unresolvedCount: 0,
      });
      expect(counts.get(mixed)).toEqual({
        episodeId: mixed,
        memberCount: 3,
        unresolvedCount: 2,
      });
      expect(counts.get(left)).toEqual({
        episodeId: left,
        memberCount: 1,
        unresolvedCount: 0,
      });
      expect(counts.get(recordGone)).toEqual({
        episodeId: recordGone,
        memberCount: 2,
        unresolvedCount: 0,
      });
      expect(counts.get(noState)).toEqual({
        episodeId: noState,
        memberCount: 2,
        unresolvedCount: 2,
      });
      expect(counts.has(empty)).toBe(false);
    });

    test(`${tables.recordTable} episodes are each judged by their own project's resolved order`, async () => {
      const second: string = await addState(tables, 2);

      const episodeA: string = ObjectID.generate().toString();
      const episodeB: string = ObjectID.generate().toString();
      await addMember(tables, episodeA, await addRecord(tables, second));
      await addMember(tables, episodeB, await addRecord(tables, second));

      const counts: Map<string, Counts> = await count(tables, [
        // Resolved at 2 in A's project, at 3 in B's.
        { episodeId: episodeA, resolvedOrder: 2 },
        { episodeId: episodeB, resolvedOrder: 3 },
      ]);

      expect(counts.get(episodeA)!.unresolvedCount).toBe(0);
      expect(counts.get(episodeB)!.unresolvedCount).toBe(1);
    });
  }
});
