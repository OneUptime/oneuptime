import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumSessionChunk from "Common/Models/AnalyticsModels/RumSessionChunk";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import {
  PAGES_WITH_PERSONAL_DATA,
  PAGES_WITH_SECRETS,
  PageSpellingCase,
} from "Common/Tests/Helpers/PageSpellings";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * ScrubSessionReplayAddresses against a real ClickHouse (#8490).
 *
 * The unit suite pins the statements. This one runs them on Session
 * Replay's headers and chunks as an install holds them - tables built from
 * the models' own columns and keys - with the addresses the scrubber kept
 * before #8385 and #8489 (a JSON Web Token, an address escaped twice, a
 * token in standard base64), and shows that:
 *
 *   - a session's entry and exit URLs and routes, and a chunk's url and
 *     routes, are redacted, its pinned copy too, and each address keeps its
 *     scheme and host, its allowlisted query and the rest as written;
 *   - an address that names no one, and a chunk's recording, are untouched;
 *   - over thousands of stored addresses, what SQL writes is what the
 *     scrubber writes now (once scrubbed again), keeps none of what the
 *     scrubber removes, and leaves alone what it keeps;
 *   - running it again changes nothing.
 *
 * The CI server is a single node without a cluster, so ON CLUSTER is left
 * out of the statements and the tables are plain engines under the local
 * tables' names - the statements are otherwise the migration's own. The
 * product analytics tables are not created here, so their steps are
 * skipped (ScrubProductAnalyticsAddressesClickhouse runs those). The App
 * Test workflow provides the server; the guard at the bottom fails the run
 * there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/ScrubSessionReplayAddressesClickhouse.test.ts
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/AnalyticsDatabase/ClusterConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/AnalyticsDatabase/ClusterConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    onClusterClause: (): string => {
      return "";
    },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import ScrubSessionReplayAddresses from "../../../FeatureSet/Workers/DataMigrations/ScrubSessionReplayAddresses";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `scrub_replay_addresses_test_${process.pid}_${Date.now()}`;
const SESSIONS: string = ScrubSessionReplayAddresses.getSessionStorageTable();
const CHUNKS: string = ScrubSessionReplayAddresses.getChunkStorageTable();

const projectId: ObjectID = new ObjectID("6600000000000000000000e5");
const applicationId: ObjectID = new ObjectID("6600000000000000000000e6");

const POLL_INTERVAL_MS: number = 250;
const WAIT_LIMIT_MS: number = 180000;

const ORIGIN: string = "https://shop.example.com";
const ALLOWLIST: Array<string> = ["coupon"];

const JWT: string =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const BASE64: string = "dGhpcyBpcyBhIHNlY3JldCB0b2tlbiBmb3IgdGVzdGluZw==";

// What names someone or is a secret, in any address below.
const PERSONAL_DATA: Array<string> = [
  "someone",
  "First.Last",
  "eyJhbGci",
  "%2540",
  "%2534",
  "dGhpcyBp",
  "k3J",
  "3f1a9c7e",
  "5f8d0d55b54764421b7156c9",
  "4111111111111111",
];

/*
 * What the scrubber stored for a location before #8385 and #8489: the
 * origin and the path, and a hash router's route, each as the location had
 * it - the rows of PAGES_WITH_SECRETS are the shapes it kept.
 */
function storedBefore(row: PageSpellingCase): string {
  const route: string | null = UrlScrubber.getHashRoute(row.location.hash);

  return `${ORIGIN}${row.location.pathname}${
    route === null
      ? ""
      : `${row.location.hash.slice(0, row.location.hash.indexOf("/"))}${route}`
  }`;
}

const tokenSession: string = "a1".repeat(16);
// A copy a pinned recording keeps past the retention, of its own key here.
const pinnedSession: string = "a2".repeat(16);
const cleanSession: string = "b1".repeat(16);
const startedAt: Date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

const TOKEN_ENTRY: string = `${ORIGIN}/auth/callback/${JWT}?coupon=[redacted]`;
const TOKEN_EXIT: string = `${ORIGIN}/#/verify/${BASE64}`;
const TOKEN_ROUTES: Array<string> = [
  TOKEN_ENTRY,
  `${ORIGIN}/app/#!/reset/k3J+vT9mL4pR7sW1yB6nC3dF5gH0jKq2Zx8`,
  `${ORIGIN}/users/someone%2540example.com/orders`,
  "app://com.example.shop/Session/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
  "null/Invite/someone%2540example.com",
  `${ORIGIN}/pricing`,
  TOKEN_EXIT,
];

const CLEAN_ENTRY: string = `${ORIGIN}/caf%C3%A9?coupon=[redacted]#/orders/[redacted]`;
const CLEAN_ROUTES: Array<string> = [
  CLEAN_ENTRY,
  `${ORIGIN}/pricing`,
  `${ORIGIN}/files/report-2026-11-15.pdf`,
  "app://com.example.shop/Home",
  "null/Home",
];

/*
 * The rows of the shared tables, as a scrubber that did not take them would
 * have stored them: each in the spelling the URL parser writes, so what the
 * scrubber writes now differs from it only where it takes something out.
 */
const TABLE_ADDRESSES: Array<string> = Array.from(
  new Set(
    [...PAGES_WITH_PERSONAL_DATA, ...PAGES_WITH_SECRETS].map(
      (row: PageSpellingCase): string => {
        return storedBefore(row);
      },
    ),
  ),
);

function header(data: {
  sessionId: string;
  entryUrl: string;
  exitUrl: string;
  routes: Array<string>;
  pinned?: boolean;
}): JSONObject {
  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    rumApplicationId: applicationId.toString(),
    primaryEntityId: applicationId.toString(),
    primaryEntityType: "RealUserMonitor",
    startTime: OneUptimeDate.toClickhouseDateTime64(startedAt),
    clientReportedStartTime: OneUptimeDate.toClickhouseDateTime64(startedAt),
    sessionId: data.sessionId,
    version: String(startedAt.getTime() + (data.pinned ? 2000 : 1000)),
    visitorId: data.sessionId,
    identifiedUserKey: "",
    identifiedUserLabel: "",
    deviceType: "desktop",
    browserName: "Chrome",
    browserVersion: "141",
    osName: "macOS",
    recorderKind: "dom",
    countryCode: "DE",
    entryUrl: data.entryUrl,
    exitUrl: data.exitUrl,
    routes: data.routes,
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    endTime: OneUptimeDate.toClickhouseDateTime64(
      new Date(startedAt.getTime() + 90000),
    ),
    isFinalized: true,
    durationMs: "90000",
    pageCount: data.routes.length,
    errorCount: 0,
    isPinnedCopy: Boolean(data.pinned),
    retentionDate: data.pinned
      ? "2299-01-01"
      : OneUptimeDate.toClickhouseDateTime(
          OneUptimeDate.addRemoveDays(new Date(), 30),
        ).substring(0, 10),
  };
}

function chunk(data: {
  sessionId: string;
  chunkIndex: number;
  url: string;
  routes: Array<string>;
}): JSONObject {
  return {
    projectId: projectId.toString(),
    sessionId: data.sessionId,
    tabId: "c1".repeat(8),
    chunkIndex: data.chunkIndex,
    version: String(startedAt.getTime()),
    rumApplicationId: applicationId.toString(),
    primaryEntityId: applicationId.toString(),
    primaryEntityType: "RealUserMonitor",
    sessionStartTime: OneUptimeDate.toClickhouseDateTime64(startedAt),
    chunkStartOffsetMs: data.chunkIndex * 15000,
    chunkEndOffsetMs: (data.chunkIndex + 1) * 15000,
    chunkStartTime: OneUptimeDate.toClickhouseDateTime64(startedAt),
    chunkEndTime: OneUptimeDate.toClickhouseDateTime64(startedAt),
    eventCount: 12,
    hasFullSnapshot: data.chunkIndex === 0,
    isFinal: false,
    isPinnedCopy: false,
    recorderKind: "dom",
    payloadEncoding: "gzip",
    schemaVersion: 1,
    // The recording names the page too; it is never rewritten.
    payload: Buffer.from(
      JSON.stringify([{ type: 4, data: { href: data.url } }]),
    ).toString("base64"),
    payloadBytes: 64,
    url: data.url,
    routes: data.routes,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(), 30),
    ).substring(0, 10),
  };
}

integration("ScrubSessionReplayAddresses against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: Record<string, unknown> | undefined;

  async function rows<T>(
    query: string,
    queryParams: Record<string, unknown> = {},
  ): Promise<Array<T>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query: query,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    return (await result.json()) as Array<T>;
  }

  async function createTable(
    modelType: { new (): AnalyticsBaseModel },
    name: string,
  ): Promise<void> {
    const model: AnalyticsBaseModel = new modelType();
    const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    }).toColumnsCreateStatement(model.tableColumns);

    const engine: string =
      model.tableEngine === AnalyticsTableEngine.ReplacingMergeTree
        ? "ReplacingMergeTree(version)"
        : "MergeTree";

    await client.command({
      query: `CREATE TABLE ${database}.${name} (${columns.query}) ENGINE = ${engine} PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
      query_params: columns.query_params,
    });
  }

  async function mutationsDone(): Promise<void> {
    const deadline: number = Date.now() + WAIT_LIMIT_MS;

    while (
      Number(
        (
          await rows<{ pending: string | number }>(
            `SELECT count() AS pending FROM system.mutations WHERE database = {database:String} AND NOT is_done`,
            { database: database },
          )
        )[0]?.pending,
      ) > 0
    ) {
      if (Date.now() > deadline) {
        throw new Error("Timed out waiting for the scrubbing to finish");
      }

      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, POLL_INTERVAL_MS);
      });
    }
  }

  async function failedMutations(): Promise<Array<string>> {
    return (
      await rows<{ reason: string }>(
        `SELECT latest_fail_reason AS reason FROM system.mutations WHERE database = {database:String} AND latest_fail_reason != ''`,
        { database: database },
      )
    ).map((row: { reason: string }): string => {
      return row.reason;
    });
  }

  interface HeaderRow {
    sessionId: string;
    isPinnedCopy: boolean;
    entryUrl: string;
    exitUrl: string;
    routes: Array<string>;
  }

  async function headers(sessionId: string): Promise<Array<HeaderRow>> {
    return rows<HeaderRow>(
      `SELECT sessionId, isPinnedCopy, entryUrl, exitUrl, routes FROM ${database}.${SESSIONS} WHERE sessionId = {sessionId:String} ORDER BY version`,
      { sessionId: sessionId },
    );
  }

  interface ChunkRow {
    chunkIndex: number;
    url: string;
    routes: Array<string>;
    payload: string;
    payloadBytes: string | number;
  }

  async function chunks(sessionId: string): Promise<Array<ChunkRow>> {
    return rows<ChunkRow>(
      `SELECT chunkIndex, url, routes, payload, payloadBytes FROM ${database}.${CHUNKS} WHERE sessionId = {sessionId:String} ORDER BY chunkIndex`,
      { sessionId: sessionId },
    );
  }

  async function fingerprint(): Promise<Array<string>> {
    const found: Array<string> = [];

    for (const [table, columns] of [
      [SESSIONS, "sessionId, version, entryUrl, exitUrl, toString(routes)"],
      [CHUNKS, "sessionId, chunkIndex, url, toString(routes), payload"],
    ] as Array<[string, string]>) {
      const result: Array<{ f: string }> = await rows<{ f: string }>(
        `SELECT toString(count()) || ':' || toString(sum(cityHash64(${columns}))) AS f FROM ${database}.${table}`,
      );

      found.push(`${table} ${result[0]!.f}`);
    }

    return found;
  }

  let cleanBefore: string;
  let payloadsBefore: Array<string>;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    original = {
      database: MetricService.database,
      databaseClient: MetricService.databaseClient,
      migrationDatabase: MetricService.migrationDatabase,
      migrationDatabaseClient: MetricService.migrationDatabaseClient,
    };

    MetricService.database = clickhouse;
    MetricService.databaseClient = client;
    MetricService.migrationDatabase = clickhouse;
    MetricService.migrationDatabaseClient = client;

    await createTable(
      RumSession as unknown as { new (): AnalyticsBaseModel },
      SESSIONS,
    );
    await createTable(
      RumSessionChunk as unknown as { new (): AnalyticsBaseModel },
      CHUNKS,
    );

    // One session per address of the shared tables, as stored before.
    const tableSessions: Array<JSONObject> = TABLE_ADDRESSES.map(
      (address: string, index: number): JSONObject => {
        return header({
          sessionId: (1000 + index).toString(16).padStart(32, "0"),
          entryUrl: address,
          exitUrl: address,
          routes: [address],
        });
      },
    );

    await client.insert({
      table: `${database}.${SESSIONS}`,
      values: [
        header({
          sessionId: tokenSession,
          entryUrl: TOKEN_ENTRY,
          exitUrl: TOKEN_EXIT,
          routes: TOKEN_ROUTES,
        }),
        header({
          sessionId: pinnedSession,
          entryUrl: TOKEN_ENTRY,
          exitUrl: TOKEN_EXIT,
          routes: TOKEN_ROUTES,
          pinned: true,
        }),
        header({
          sessionId: cleanSession,
          entryUrl: CLEAN_ENTRY,
          exitUrl: `${ORIGIN}/pricing`,
          routes: CLEAN_ROUTES,
        }),
        ...tableSessions,
      ],
      format: "JSONEachRow",
    });

    await client.insert({
      table: `${database}.${CHUNKS}`,
      values: [
        chunk({
          sessionId: tokenSession,
          chunkIndex: 0,
          url: TOKEN_ENTRY,
          routes: [TOKEN_ENTRY],
        }),
        chunk({
          sessionId: tokenSession,
          chunkIndex: 1,
          url: TOKEN_EXIT,
          routes: TOKEN_ROUTES.slice(1),
        }),
        chunk({
          sessionId: cleanSession,
          chunkIndex: 0,
          url: CLEAN_ENTRY,
          routes: CLEAN_ROUTES,
        }),
      ],
      format: "JSONEachRow",
    });

    cleanBefore = JSON.stringify([
      await headers(cleanSession),
      await chunks(cleanSession),
    ]);
    payloadsBefore = (await chunks(tokenSession)).map(
      (row: ChunkRow): string => {
        return row.payload;
      },
    );
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(MetricService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("before it runs, a session's addresses hold tokens and an escaped address", async () => {
    const stored: string = JSON.stringify(await headers(tokenSession));

    expect(stored).toContain("eyJhbGci");
    expect(stored).toContain("dGhpcyBp");
    expect(stored).toContain("someone%2540example.com");
    expect(TABLE_ADDRESSES.length).toBeGreaterThan(20);
  });

  test("it redacts a session's entry and exit URLs and routes, its pinned copy too, and keeps the rest of each address", async () => {
    await new ScrubSessionReplayAddresses().migrate();
    await mutationsDone();

    expect(await failedMutations()).toEqual([]);

    const expected: Omit<HeaderRow, "isPinnedCopy" | "sessionId"> = {
      entryUrl: `${ORIGIN}/auth/callback/[redacted]?coupon=[redacted]`,
      exitUrl: `${ORIGIN}/#/verify/[redacted]`,
      routes: [
        `${ORIGIN}/auth/callback/[redacted]?coupon=[redacted]`,
        `${ORIGIN}/app/#!/reset/[redacted]`,
        `${ORIGIN}/users/[redacted]/orders`,
        "app://com.example.shop/Session/[redacted]",
        "null/Invite/[redacted]",
        `${ORIGIN}/pricing`,
        `${ORIGIN}/#/verify/[redacted]`,
      ],
    };

    expect(await headers(tokenSession)).toEqual([
      { sessionId: tokenSession, isPinnedCopy: false, ...expected },
    ]);
    expect(await headers(pinnedSession)).toEqual([
      { sessionId: pinnedSession, isPinnedCopy: true, ...expected },
    ]);
  });

  test("a chunk's url and routes are redacted, and its recording is untouched", async () => {
    const stored: Array<ChunkRow> = await chunks(tokenSession);

    expect(
      stored.map((row: ChunkRow): [string, Array<string>] => {
        return [row.url, row.routes];
      }),
    ).toEqual([
      [
        `${ORIGIN}/auth/callback/[redacted]?coupon=[redacted]`,
        [`${ORIGIN}/auth/callback/[redacted]?coupon=[redacted]`],
      ],
      [
        `${ORIGIN}/#/verify/[redacted]`,
        [
          `${ORIGIN}/app/#!/reset/[redacted]`,
          `${ORIGIN}/users/[redacted]/orders`,
          "app://com.example.shop/Session/[redacted]",
          "null/Invite/[redacted]",
          `${ORIGIN}/pricing`,
          `${ORIGIN}/#/verify/[redacted]`,
        ],
      ],
    ]);
    expect(
      stored.map((row: ChunkRow): string => {
        return row.payload;
      }),
    ).toEqual(payloadsBefore);
  });

  test("a session that names no one is untouched", async () => {
    expect(
      JSON.stringify([await headers(cleanSession), await chunks(cleanSession)]),
    ).toBe(cleanBefore);
  });

  test("every address of the shared tables is stored as the scrubber stores it now", async () => {
    const stored: Array<{
      entryUrl: string;
      exitUrl: string;
      routes: Array<string>;
    }> = await rows(
      `SELECT entryUrl, exitUrl, routes FROM ${database}.${SESSIONS} WHERE sessionId NOT IN ({token:String}, {pinned:String}, {clean:String}) ORDER BY sessionId`,
      { token: tokenSession, pinned: pinnedSession, clean: cleanSession },
    );

    expect(stored).toHaveLength(TABLE_ADDRESSES.length);

    stored.forEach(
      (
        row: { entryUrl: string; exitUrl: string; routes: Array<string> },
        index: number,
      ): void => {
        const address: string = TABLE_ADDRESSES[index]!;
        const now: string = UrlScrubber.scrub(address, ALLOWLIST);

        expect([address, row.entryUrl]).toEqual([address, now]);
        expect([address, row.exitUrl]).toEqual([address, now]);
        expect([address, row.routes]).toEqual([address, [now]]);
      },
    );
  });

  /*
   * What the scrubber never stores, but a redaction keeps as written all the
   * same: a query inside a hash route, a fragment that is no route, an
   * address with no scheme.
   */
  test("keeps every part of an address but its identifiers as written", async () => {
    const cases: Array<[string, string]> = [
      [
        `${ORIGIN}/#/u/someone%2540example.com?tab=1`,
        `${ORIGIN}/#/u/[redacted]?tab=1`,
      ],
      [
        `${ORIGIN}/app/#!/t/${JWT}?next=%2F#again`,
        `${ORIGIN}/app/#!/t/[redacted]?next=%2F#again`,
      ],
      [`${ORIGIN}/t/${JWT}#plans`, `${ORIGIN}/t/[redacted]#plans`],
      [`/t/${BASE64}?coupon=[redacted]`, "/t/[redacted]?coupon=[redacted]"],
      [`//cdn.example.com/t/${BASE64}`, "//cdn.example.com/t/[redacted]"],
      [`${ORIGIN}/#/pricing?tab=1`, `${ORIGIN}/#/pricing?tab=1`],
    ];

    for (const [address, redacted] of cases) {
      const found: Array<{ redacted: string }> = await rows<{
        redacted: string;
      }>(
        `SELECT ${ScrubSessionReplayAddresses.redactedSql("{address:String}")} AS redacted`,
        { address: address },
      );

      expect([address, found[0]!.redacted]).toEqual([address, redacted]);
    }
  });

  test("running it again changes nothing", async () => {
    const before: Array<string> = await fingerprint();

    await new ScrubSessionReplayAddresses().migrate();
    await mutationsDone();

    expect(await failedMutations()).toEqual([]);
    expect(await fingerprint()).toEqual(before);
  });

  /*
   * The redaction against the scrubber, over stored addresses: what SQL
   * writes, scrubbed again, is what the scrubber writes now; it keeps none
   * of what the scrubber takes out; and an address the scrubber keeps as it
   * is, SQL keeps as it is.
   */
  test("redacts a stored address as the scrubber does, over thousands of addresses", async () => {
    const random: SeededRandom = seededRandom(84900);
    const segments: Array<string> = [
      "orders",
      "42",
      "caf%C3%A9",
      "[redacted]",
      "someone%2540example.com",
      "First.Last%252Bnews%2540Example.co.uk",
      JWT,
      "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.",
      BASE64,
      "k3J+vT9mL4pR7sW1yB6nC3dF5gH0jKq2Zx8",
      "k3J%2BvT9mL4pR7sW1yB6nC3dF5gH0jK%2Fq2Zx8%3D%3D",
      "%2534%2531%2531%2531%2531%2531%2531%2531%2531",
      "report-2026-11-15.pdf",
      "c++",
      "size=large",
      "a%2Fb",
      "50%2525-off",
    ];
    const origins: Array<string> = [
      ORIGIN,
      "http://shop.example.com:8080",
      "app://com.example.shop",
      "null",
    ];
    const queries: Array<string> = ["", "?coupon=[redacted]"];
    const fragments: Array<string> = ["", "#/", "#/u/", "#!/a/"];
    const addresses: Array<string> = [];

    for (let index: number = 0; index < 3000; index++) {
      let path: string = "";
      const count: number = 1 + random(4);

      for (let part: number = 0; part < count; part++) {
        path += `/${segments[random(segments.length)]}`;
      }

      const fragment: string = fragments[random(fragments.length)]!;
      const route: string = fragment
        ? `${fragment}${segments[random(segments.length)]}`
        : "";

      addresses.push(
        `${origins[random(origins.length)]}${path}${queries[random(queries.length)]}${route}`,
      );
    }

    await client.command({
      query: `CREATE TABLE ${database}.addresses (position UInt32, address String) ENGINE = MergeTree ORDER BY position`,
    });
    await client.insert({
      table: `${database}.addresses`,
      values: addresses.map((address: string, position: number) => {
        return { position: position, address: address };
      }),
      format: "JSONEachRow",
    });

    const sql: Array<{ address: string; redacted: string }> = await rows<{
      address: string;
      redacted: string;
    }>(
      `SELECT address, ${ScrubSessionReplayAddresses.redactedSql("address")} AS redacted FROM ${database}.addresses ORDER BY position`,
    );

    expect(sql).toHaveLength(addresses.length);

    let changed: number = 0;

    for (const row of sql) {
      // A screen stored as null/<route> is read as its route (#8384).
      const read: (address: string) => string = (address: string): string => {
        return address.startsWith("null/") ? address.slice(4) : address;
      };
      const now: string = UrlScrubber.scrub(read(row.address), ALLOWLIST);

      expect([
        row.address,
        UrlScrubber.scrub(read(row.redacted), ALLOWLIST),
      ]).toEqual([row.address, now]);

      for (const personal of PERSONAL_DATA) {
        if (!now.includes(personal)) {
          expect([
            row.address,
            personal,
            row.redacted.includes(personal),
          ]).toEqual([row.address, personal, false]);
        }
      }

      // SQL changes an address exactly when the scrubber does.
      expect([row.address, row.redacted !== row.address]).toEqual([
        row.address,
        now !== read(row.address),
      ]);

      if (row.redacted !== row.address) {
        changed++;
      }
    }

    expect(changed).toBeGreaterThan(1000);
  });
});

describe("ScrubSessionReplayAddresses ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
