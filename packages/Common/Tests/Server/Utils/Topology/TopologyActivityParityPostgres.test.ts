import {
  activeSql,
  epochMsSql,
} from "../../../../Server/Utils/Topology/TopologySql";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import {
  ActivityFields,
  isEntityActive,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyActivity";
import { DataSource, QueryRunner } from "typeorm";

/*
 * "Did this resource report in the range?" is answered twice: by Postgres
 * (activeSql, which picks each resource's active container, counts active
 * collection items and runs-on targets) and by the browser
 * (TopologyActivity.isEntityActive, which decides what the maps draw). The
 * browser judges the rows the server shipped — `source` and `lastSeenAt`
 * floored to epoch milliseconds (epochMsSql) — against the range start the
 * server echoed. If the two ever disagree, a resource is drawn inactive
 * inside the container the server chose as its ACTIVE one, or counted as
 * active in a total the map then leaves out.
 *
 * This runs the real predicate text through a real Postgres over a truth
 * table, feeds the same rows through the browser predicate exactly as the
 * decoder would hand them over, and requires the answers to match — at
 * microsecond precision around the range start, and whatever the session
 * time zone is. No table is read or written: the rows are an unnest() of
 * bound arrays.
 *
 * Opt in with RUN_POSTGRES_TOPOLOGY_TESTS=true (the flag the other Topology
 * Postgres suite uses). Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from TOPOLOGY_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from TOPOLOGY_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_TOPOLOGY_TESTS"] === "true"
    ? describe
    : describe.skip;

/* The server floors the range start to the minute; this one already is. */
const RANGE_START_ISO: string = "2026-09-20T10:00:00.000Z";

interface ParityCase {
  label: string;
  source: string | null;
  /* timestamptz input text (microseconds and offsets allowed), or null. */
  lastSeenAt: string | null;
  active: boolean;
}

const CASES: Array<ParityCase> = [
  {
    label: "discovered, exactly at the range start",
    source: EntitySource.Discovered,
    lastSeenAt: "2026-09-20T10:00:00.000000Z",
    active: true,
  },
  {
    label: "discovered, 1 microsecond before the range start",
    source: EntitySource.Discovered,
    lastSeenAt: "2026-09-20T09:59:59.999999Z",
    active: false,
  },
  {
    label: "discovered, 1 microsecond after the range start",
    source: EntitySource.Discovered,
    lastSeenAt: "2026-09-20T10:00:00.000001Z",
    active: true,
  },
  {
    label: "discovered, half a millisecond before (floors below the start)",
    source: EntitySource.Discovered,
    lastSeenAt: "2026-09-20T09:59:59.999500Z",
    active: false,
  },
  {
    label: "discovered, 999 microseconds after (floors onto the start)",
    source: EntitySource.Discovered,
    lastSeenAt: "2026-09-20T10:00:00.000999Z",
    active: true,
  },
  {
    label: "discovered, the start written in another offset",
    source: EntitySource.Discovered,
    lastSeenAt: "2026-09-20T12:00:00+02:00",
    active: true,
  },
  {
    label: "discovered, 1 ms before the start in another offset",
    source: EntitySource.Discovered,
    lastSeenAt: "2026-09-20T05:59:59.999-04:00",
    active: false,
  },
  {
    label: "discovered, a day stale",
    source: EntitySource.Discovered,
    lastSeenAt: "2026-09-19T10:00:00Z",
    active: false,
  },
  {
    label: "discovered, never reported",
    source: EntitySource.Discovered,
    lastSeenAt: null,
    active: true,
  },
  {
    label: "no source, stale",
    source: null,
    lastSeenAt: "2026-09-19T10:00:00Z",
    active: false,
  },
  {
    label: "no source, never reported",
    source: null,
    lastSeenAt: null,
    active: true,
  },
  {
    label: "blank source, stale",
    source: "",
    lastSeenAt: "2026-09-19T10:00:00Z",
    active: false,
  },
  {
    label: "blank source, in range",
    source: "",
    lastSeenAt: "2026-09-20T10:05:00Z",
    active: true,
  },
  {
    label: "manual, a year stale",
    source: EntitySource.Manual,
    lastSeenAt: "2025-09-20T10:00:00Z",
    active: true,
  },
  {
    label: "inventory-mirrored, stale",
    source: EntitySource.Inventory,
    lastSeenAt: "2026-09-19T10:00:00Z",
    active: true,
  },
  {
    label: "manual, never reported",
    source: EntitySource.Manual,
    lastSeenAt: null,
    active: true,
  },
  {
    label: "'Discovered' in another case is not discovered",
    source: "Discovered",
    lastSeenAt: "2026-09-19T10:00:00Z",
    active: true,
  },
  {
    label: "a whitespace source is not blank",
    source: " ",
    lastSeenAt: "2026-09-19T10:00:00Z",
    active: true,
  },
];

interface ParityRow {
  ord: number;
  active: boolean;
  lastSeenAt: number | null;
}

/* The row as the Dashboard decoder hands it to isEntityActive. */
function decodedFields(
  source: string | null,
  lastSeenAt: number | null,
): ActivityFields {
  const fields: ActivityFields = {};
  if (typeof source === "string") {
    fields.source = source;
  }
  if (typeof lastSeenAt === "number") {
    fields.lastSeenAt = new Date(lastSeenAt);
  }
  return fields;
}

async function evaluate(runner: QueryRunner): Promise<Array<ParityRow>> {
  const sql: string =
    `SELECT t."ord" AS "ord", ${activeSql("t", "$1")} AS "active", ` +
    `${epochMsSql('t."lastSeenAt"')} AS "lastSeenAt" ` +
    `FROM unnest($2::int[], $3::text[], $4::timestamptz[]) ` +
    `AS t("ord", "source", "lastSeenAt") ORDER BY t."ord"`;
  return (await runner.query(sql, [
    RANGE_START_ISO,
    CASES.map((_testCase: ParityCase, index: number): number => {
      return index;
    }),
    CASES.map((testCase: ParityCase): string | null => {
      return testCase.source;
    }),
    CASES.map((testCase: ParityCase): string | null => {
      return testCase.lastSeenAt;
    }),
  ])) as Array<ParityRow>;
}

describePostgres("Topology activity: SQL and browser agree on Postgres", () => {
  let database: DataSource;
  let runner: QueryRunner;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["TOPOLOGY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["TOPOLOGY_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["TOPOLOGY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: [],
      synchronize: false,
    });
    await database.initialize();
    /* One connection, so the session time zone below sticks. */
    runner = database.createQueryRunner();
    await runner.connect();
  });

  afterAll(async () => {
    await runner?.release();
    if (database?.isInitialized) {
      await database.destroy();
    }
  });

  test.each(["UTC", "America/Los_Angeles", "Asia/Kolkata"])(
    "every row agrees, with the session time zone at %s",
    async (timeZone: string) => {
      await runner.query(`SELECT set_config('TimeZone', $1, false)`, [
        timeZone,
      ]);
      const rows: Array<ParityRow> = await evaluate(runner);
      const rangeStart: Date = new Date(RANGE_START_ISO);

      expect(rows).toHaveLength(CASES.length);
      for (const row of rows) {
        const testCase: ParityCase = CASES[row.ord]!;
        const browser: boolean = isEntityActive(
          decodedFields(testCase.source, row.lastSeenAt),
          rangeStart,
        );
        expect({ label: testCase.label, sql: row.active, browser }).toEqual({
          label: testCase.label,
          sql: testCase.active,
          browser: testCase.active,
        });
      }
    },
  );

  test("the epoch the browser receives is the floor of the stored instant", async () => {
    await runner.query(`SELECT set_config('TimeZone', 'UTC', false)`);
    const rows: Array<ParityRow> = await evaluate(runner);
    const byLabel: Map<string, number | null> = new Map<string, number | null>(
      rows.map((row: ParityRow): [string, number | null] => {
        return [CASES[row.ord]!.label, row.lastSeenAt];
      }),
    );

    expect(
      byLabel.get(
        "discovered, half a millisecond before (floors below the start)",
      ),
    ).toBe(Date.parse("2026-09-20T09:59:59.999Z"));
    expect(
      byLabel.get("discovered, 999 microseconds after (floors onto the start)"),
    ).toBe(Date.parse(RANGE_START_ISO));
    expect(byLabel.get("discovered, never reported")).toBeNull();
  });
});
