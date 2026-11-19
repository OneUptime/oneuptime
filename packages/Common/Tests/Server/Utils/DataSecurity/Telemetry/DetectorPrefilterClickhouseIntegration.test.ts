import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import {
  ClickhousePassword,
  ClickhouseUsername,
} from "../../../../../Server/EnvironmentConfig";
import {
  SQL,
  Statement,
} from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import TableColumnType from "../../../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../../../Types/JSON";
import BUILT_IN_DETECTORS from "../../../../../Utils/DataSecurity/Detectors/Index";
import {
  getDataTypePrefilter,
  toRe2Prefilter,
} from "../../../../../Utils/DataSecurity/DetectorPrefilter";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";
import { positivesOf } from "../../../../Utils/DataSecurity/DetectorPositives";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A DATA TYPE'S PATTERNS, AS CLICKHOUSE RUNS THEM (issue #9549).
 *
 * A search for the records a telemetry finding was seen in narrows by the
 * type's detectors written for RE2 (DetectorPrefilter): match(value,
 * expression), the expression bound as a parameter. Its unit test holds
 * the expressions to RE2's syntax and runs them as JavaScript; this sends
 * them to a real ClickHouse, which parses them itself before RE2 does:
 * every built-in detector's expression, and each data type's, must compile
 * there and match every text the detector's own pattern finds a candidate
 * in - a record it missed would be a record nobody is shown.
 *
 * Opt in against a local ClickHouse server, for example
 *   docker run --rm -p 127.0.0.1:8193:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 * then TEST_CLICKHOUSE_URL=http://localhost:8193 CLICKHOUSE_PASSWORD=test npx jest <this file>.
 * The suite creates and removes only its own uniquely named database.
 */
const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `detector_prefilter_${process.pid}_${Date.now()}`;
const random: SeededRandom = seededRandom(9549);
let client: ClickHouseClient;

interface Pair {
  dataTypeId: string;
  expression: string;
  typeExpression: string;
  text: string;
}

function pairsOfEveryDetector(): Array<Pair> {
  const pairs: Array<Pair> = [];

  for (const detector of BUILT_IN_DETECTORS) {
    for (const text of positivesOf(detector, 20, random)) {
      pairs.push({
        dataTypeId: detector.dataTypeId,
        expression:
          toRe2Prefilter(detector.pattern.source, detector.pattern.flags) || "",
        typeExpression:
          getDataTypePrefilter({ dataTypeId: detector.dataTypeId }) || "",
        text,
      });
    }
  }

  return pairs;
}

async function rowsOf(query: string): Promise<Array<JSONObject>> {
  const result: { json: () => Promise<unknown> } = await client.query({
    query,
    format: "JSONEachRow",
  });

  return (await result.json()) as Array<JSONObject>;
}

integration("a data type's patterns, in a real ClickHouse", () => {
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
    await client.command({
      query:
        "CREATE TABLE pairs (dataTypeId String, expression String, typeExpression String, text String) ENGINE = Memory",
    });
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      try {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      } finally {
        await client.close();
      }
    }

    jest.restoreAllMocks();
  });

  test("every built-in detector's expression, and its type's, compiles and matches every text its pattern finds a candidate in", async () => {
    const pairs: Array<Pair> = pairsOfEveryDetector();

    // Every detector is drawn from, and written for RE2.
    expect(
      new Set(
        pairs.map((pair: Pair): string => {
          return pair.dataTypeId;
        }),
      ).size,
    ).toBe(
      new Set(
        BUILT_IN_DETECTORS.map((detector: { dataTypeId: string }): string => {
          return detector.dataTypeId;
        }),
      ).size,
    );
    expect(
      pairs.filter((pair: Pair): boolean => {
        return !pair.expression || !pair.typeExpression;
      }),
    ).toEqual([]);

    await client.insert({
      table: "pairs",
      values: pairs as unknown as Array<JSONObject>,
      format: "JSONEachRow",
    });

    const missed: Array<JSONObject> = await rowsOf(
      "SELECT dataTypeId, text FROM pairs WHERE NOT match(text, expression) OR NOT match(text, typeExpression)",
    );

    expect(missed).toEqual([]);
  });

  test("an expression bound as a statement's parameter reaches match() as written", async () => {
    const card: string = getDataTypePrefilter({
      dataTypeId: "credit-card-number",
    })!;
    const statement: Statement = SQL`SELECT match(${{
      type: TableColumnType.Text,
      value: "Charge failed for 4539 1488 0343 6467 at checkout",
    }}, ${{ type: TableColumnType.Text, value: card }}) AS found, match(${{
      type: TableColumnType.Text,
      value: "Charge failed: order 4417",
    }}, ${{ type: TableColumnType.Text, value: card }}) AS missing`;
    const result: { json: () => Promise<unknown> } = await client.query({
      query: statement.query,
      query_params: statement.query_params,
      format: "JSONEachRow",
    });

    expect(await result.json()).toEqual([{ found: 1, missing: 0 }]);
  });
});
