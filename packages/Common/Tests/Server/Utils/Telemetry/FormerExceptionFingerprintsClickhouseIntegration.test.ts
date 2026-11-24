import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import {
  ClickhousePassword,
  ClickhouseUsername,
} from "../../../../Server/EnvironmentConfig";
import FormerExceptionFingerprints from "../../../../Server/Utils/Telemetry/FormerExceptionFingerprints";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHICH FORMER EXCEPTION FINGERPRINTS AN OCCURRENCE STILL CARRIES, AS
 * CLICKHOUSE ANSWERS (#10619).
 *
 * The row that keeps an exception's former fingerprint is deleted once no
 * occurrence carries it (FormerExceptionFingerprints). Its unit test fakes
 * ClickHouse; this runs the read against a real one: the project's own
 * occurrences only, those past their retention left out, a repeat of a
 * crash counted as carrying it, and each fingerprint answered once.
 *
 * Opt in against a local ClickHouse server, for example
 *   docker run --rm -p 127.0.0.1:8193:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:24.8
 * then TEST_CLICKHOUSE_URL=http://localhost:8193 CLICKHOUSE_PASSWORD=test npx jest <this file>.
 * The suite creates and removes only its own uniquely named database.
 */
const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `former_fingerprints_${process.pid}_${Date.now()}`;
const PROJECT_ID: string = "10000000-0000-4000-8000-000000010619";
const OTHER_PROJECT_ID: string = "20000000-0000-4000-8000-000000010619";
let client: ClickHouseClient;

async function run(statement: Statement): Promise<Array<string>> {
  const result: { json: () => Promise<unknown> } = await client.query({
    query: statement.query,
    query_params: statement.query_params,
    format: "JSON",
  });

  return ((await result.json()) as { data: Array<JSONObject> }).data
    .map((row: JSONObject): string => {
      return String(row["fingerprint"]);
    })
    .sort();
}

integration("former exception fingerprints, in a real ClickHouse", () => {
  beforeAll(async (): Promise<void> => {
    // The real ClickHouse HTTP client needs Node timers with unref().
    jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
    jest.spyOn(globalThis, "clearTimeout").mockImplementation(nodeClearTimeout);

    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "This integration suite requires a local ClickHouse server.",
      );
    }

    const admin: ClickHouseClient = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
      request_timeout: 120000,
    });
    await admin.command({ query: `CREATE DATABASE ${database}` });
    await admin.close();

    client = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
      database,
      request_timeout: 120000,
    });

    // The columns the read names, typed and keyed as the model's table is.
    await client.command({
      query: `CREATE TABLE ${AnalyticsTableName.ExceptionInstance} (projectId String, primaryEntityId String, time DateTime64(9), fingerprint String, duplicateOf String, retentionDate DateTime) ENGINE = MergeTree PARTITION BY toYYYYMMDD(time) ORDER BY (projectId, time, primaryEntityId, fingerprint)`,
    });

    const kept: string = "2099-01-01 00:00:00";
    const expired: string = "2001-01-01 00:00:00";

    await client.insert({
      table: AnalyticsTableName.ExceptionInstance,
      format: "JSONEachRow",
      values: (
        [
          ["fp-kept", PROJECT_ID, kept, ""],
          ["fp-kept", PROJECT_ID, kept, ""],
          ["fp-expired", PROJECT_ID, expired, ""],
          ["fp-repeat", PROJECT_ID, kept, "an-earlier-report"],
          ["fp-elsewhere", OTHER_PROJECT_ID, kept, ""],
        ] as Array<[string, string, string, string]>
      ).map((row: [string, string, string, string]): JSONObject => {
        const [fingerprint, projectId, retentionDate, duplicateOf] = row;

        return {
          projectId,
          primaryEntityId: "30000000-0000-4000-8000-000000010619",
          time: "2026-11-01 10:00:00.000000000",
          fingerprint,
          duplicateOf,
          retentionDate,
        };
      }),
    });
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      await client.close();
    }
    jest.restoreAllMocks();
  });

  test("an occurrence the project still keeps carries its fingerprint, each fingerprint answered once", async () => {
    expect(
      await run(
        FormerExceptionFingerprints.buildCarriedStatement({
          projectId: new ObjectID(PROJECT_ID),
          fingerprints: [
            "fp-kept",
            "fp-expired",
            "fp-repeat",
            "fp-elsewhere",
            "fp-never-seen",
          ],
        }),
      ),
    ).toEqual(["fp-kept", "fp-repeat"]);
  });

  test("past their retention, its occurrences carry it no more", async () => {
    expect(
      await run(
        FormerExceptionFingerprints.buildCarriedStatement({
          projectId: new ObjectID(PROJECT_ID),
          fingerprints: ["fp-expired"],
        }),
      ),
    ).toEqual([]);
  });

  test("another project's occurrences never answer for this one's", async () => {
    expect(
      await run(
        FormerExceptionFingerprints.buildCarriedStatement({
          projectId: new ObjectID(OTHER_PROJECT_ID),
          fingerprints: ["fp-kept", "fp-elsewhere"],
        }),
      ),
    ).toEqual(["fp-elsewhere"]);
  });
});
