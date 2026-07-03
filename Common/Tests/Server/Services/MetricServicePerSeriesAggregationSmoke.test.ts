import "../TestingUtils/Init";
import {
  ClickHouseClient,
  ResponseJSON,
  createClient,
} from "@clickhouse/client";

/*
 * The repo's default jest environment is JSDOM-based, whose
 * setTimeout/setInterval return plain numbers. @clickhouse/client's
 * node connection calls `.unref()` on timer handles, so wrap the
 * globals with handles that expose no-op ref/unref and unwrap
 * correctly in clearTimeout/clearInterval. Scoped to this file (it is
 * the only suite that opens real sockets).
 */
type TimerShimHandle = {
  id: unknown;
  ref: () => TimerShimHandle;
  unref: () => TimerShimHandle;
};

const realSetTimeout: typeof globalThis.setTimeout =
  globalThis.setTimeout.bind(globalThis);
const realClearTimeout: typeof globalThis.clearTimeout =
  globalThis.clearTimeout.bind(globalThis);
const realSetInterval: typeof globalThis.setInterval =
  globalThis.setInterval.bind(globalThis);
const realClearInterval: typeof globalThis.clearInterval =
  globalThis.clearInterval.bind(globalThis);

const wrapTimerId: (id: unknown) => unknown = (id: unknown): unknown => {
  if (typeof id === "object" && id !== null) {
    // Real Node timers already support ref/unref.
    return id;
  }
  const handle: TimerShimHandle = {
    id: id,
    ref: (): TimerShimHandle => {
      return handle;
    },
    unref: (): TimerShimHandle => {
      return handle;
    },
  };
  return handle;
};

const unwrapTimerId: (handle: unknown) => unknown = (
  handle: unknown,
): unknown => {
  if (
    typeof handle === "object" &&
    handle !== null &&
    "id" in (handle as TimerShimHandle)
  ) {
    return (handle as TimerShimHandle).id;
  }
  return handle;
};

(globalThis as unknown as Record<string, unknown>)["setTimeout"] = (
  ...args: Parameters<typeof globalThis.setTimeout>
): unknown => {
  return wrapTimerId(realSetTimeout(...args));
};
(globalThis as unknown as Record<string, unknown>)["clearTimeout"] = (
  handle: unknown,
): void => {
  realClearTimeout(
    unwrapTimerId(handle) as Parameters<typeof globalThis.clearTimeout>[0],
  );
};
(globalThis as unknown as Record<string, unknown>)["setInterval"] = (
  ...args: Parameters<typeof globalThis.setInterval>
): unknown => {
  return wrapTimerId(realSetInterval(...args));
};
(globalThis as unknown as Record<string, unknown>)["clearInterval"] = (
  handle: unknown,
): void => {
  realClearInterval(
    unwrapTimerId(handle) as Parameters<typeof globalThis.clearInterval>[0],
  );
};
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test, beforeAll, afterAll } from "@jest/globals";

/*
 * Integration smoke test for the per-series aggregation statement
 * pattern: per-attribute-key scalar extraction (`attributes[{k:String}]
 * AS seriesAttributeN`) with parameter binding, grouped by the scalar
 * aliases — NOT by the Map column itself, which the @clickhouse/client
 * parameter binding mishandles (returns 0 rows; the reason the legacy
 * in-process aggregation path existed).
 *
 * Runs only when a ClickHouse instance is reachable; skips gracefully
 * otherwise (CI without the docker compose stack, plain laptops, etc.).
 *
 * Reachability candidates, in order:
 *   1. CLICKHOUSE_TEST_URL (explicit override, e.g. the docker-published
 *      port of oneuptime-clickhouse-1: http://localhost:<mapped-port>)
 *   2. http://$CLICKHOUSE_HOST:$CLICKHOUSE_PORT (config.env values)
 *   3. http://localhost:8123 (default local ClickHouse)
 */
describe("MetricService per-series aggregation (ClickHouse smoke)", () => {
  const tableName: string = `PerSeriesAggregationSmoke_${Date.now().toString(36)}`;

  let client: ClickHouseClient | null = null;

  const candidateUrls: Array<string> = [];
  if (process.env["CLICKHOUSE_TEST_URL"]) {
    candidateUrls.push(process.env["CLICKHOUSE_TEST_URL"] as string);
  }
  if (process.env["CLICKHOUSE_HOST"]) {
    candidateUrls.push(
      `${
        process.env["CLICKHOUSE_IS_HOST_HTTPS"] === "true" ? "https" : "http"
      }://${process.env["CLICKHOUSE_HOST"]}:${
        process.env["CLICKHOUSE_PORT"] || "8123"
      }`,
    );
  }
  candidateUrls.push("http://localhost:8123");

  beforeAll(async () => {
    for (const url of candidateUrls) {
      const candidate: ClickHouseClient = createClient({
        url: url,
        username: process.env["CLICKHOUSE_USER"] || "default",
        password: process.env["CLICKHOUSE_PASSWORD"] || "",
        request_timeout: 5000,
      });

      try {
        const ping: { success: boolean } = await candidate.ping();
        if (ping.success) {
          client = candidate;
          break;
        }
        await candidate.close();
      } catch {
        await candidate.close().catch(() => {
          return undefined;
        });
      }
    }

    if (!client) {
      // eslint-disable-next-line no-console
      console.warn(
        "ClickHouse not reachable on any candidate URL — skipping per-series aggregation smoke test.",
      );
      return;
    }

    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${tableName} (
          time DateTime64(9),
          value Nullable(Float64),
          attributes Map(String, String)
        ) ENGINE = Memory
      `,
    });

    await client.insert({
      table: tableName,
      format: "JSONEachRow",
      values: [
        // minute 10:00 — device-a: avg 10, device-b: avg 20
        {
          time: "2026-07-03 10:00:05",
          value: 5,
          attributes: { "device.id": "device-a", "iot.scope": "fleet" },
        },
        {
          time: "2026-07-03 10:00:35",
          value: 15,
          attributes: { "device.id": "device-a", "iot.scope": "fleet" },
        },
        {
          time: "2026-07-03 10:00:10",
          value: 20,
          attributes: { "device.id": "device-b", "iot.scope": "fleet" },
        },
        // minute 10:01 — device-c only
        {
          time: "2026-07-03 10:01:59",
          value: 30,
          attributes: { "device.id": "device-c", "iot.scope": "fleet" },
        },
        // outside the queried window — must not appear
        {
          time: "2026-07-03 11:00:00",
          value: 999,
          attributes: { "device.id": "device-z", "iot.scope": "fleet" },
        },
      ],
    });
  }, 60000);

  afterAll(async () => {
    if (client) {
      await client
        .command({ query: `DROP TABLE IF EXISTS ${tableName}` })
        .catch(() => {
          return undefined;
        });
      await client.close();
    }
  }, 60000);

  test("GROUP BY over scalar-extracted Map keys with bound parameters returns every series and reports rows_before_limit_at_least", async () => {
    if (!client) {
      // ClickHouse unreachable — smoke test intentionally skipped.
      return;
    }

    /*
     * Mirrors the statement MetricService.toPerSeriesAggregateStatement
     * generates: scalar per-key extraction with a bound String param,
     * GROUP BY on the aliases, ORDER BY seriesBucketTime DESC,
     * parameterized LIMIT. The bucket alias is deliberately NOT `time`
     * — ClickHouse substitutes SELECT aliases into WHERE, and `AS
     * time` would rewrite the window predicate to compare bucket
     * starts (see the alias-shadowing test below).
     */
    const resultSet: Awaited<ReturnType<ClickHouseClient["query"]>> =
      await client.query({
        query: `
            SELECT avg(value) AS value,
                   toStartOfMinute(time) AS seriesBucketTime,
                   attributes[{k0:String}] AS seriesAttribute0
            FROM ${tableName}
            WHERE TRUE
              AND time >= {windowStart:DateTime64(9)}
              AND time <= {windowEnd:DateTime64(9)}
            GROUP BY seriesBucketTime, seriesAttribute0
            ORDER BY seriesBucketTime DESC
            LIMIT {rowCap:Int32}
          `,
        query_params: {
          k0: "device.id",
          windowStart: "2026-07-03 10:00:00.000000000",
          windowEnd: "2026-07-03 10:05:00.000000000",
          rowCap: 100000,
        },
        format: "JSON",
      });

    const response: ResponseJSON<JSONObject> =
      (await resultSet.json<JSONObject>()) as ResponseJSON<JSONObject>;
    const rows: Array<JSONObject> = response.data || [];

    /*
     * Three (series × minute) buckets inside the window. If the driver
     * mishandled the grouped Map access this would be 0 rows — the
     * exact historical failure mode.
     */
    expect(rows).toHaveLength(3);

    const seriesValues: Map<string, number> = new Map<string, number>();
    for (const row of rows) {
      seriesValues.set(String(row["seriesAttribute0"]), Number(row["value"]));
    }

    expect(seriesValues.get("device-a")).toBe(10);
    expect(seriesValues.get("device-b")).toBe(20);
    expect(seriesValues.get("device-c")).toBe(30);
    expect(seriesValues.has("device-z")).toBe(false);

    /*
     * Truncation telemetry depends on this being reported (and exact
     * for GROUP BY queries).
     */
    expect(response.rows_before_limit_at_least).toBe(3);
  }, 60000);

  test("non-minute-aligned window start: rows in the first partial minute are included (bucket alias must not shadow the time column)", async () => {
    if (!client) {
      // ClickHouse unreachable — smoke test intentionally skipped.
      return;
    }

    /*
     * Regression for the alias-shadowing defect: with the bucket
     * aliased `AS time`, ClickHouse (prefer_column_name_to_alias = 0)
     * substitutes the alias into WHERE, turning the window predicate
     * into `toStartOfMinute(time) >= windowStart`. With windowStart =
     * 10:00:30, the whole 10:00 bucket (start 10:00:00 < 10:00:30)
     * would vanish — including device-a's 10:00:35 sample that is
     * INSIDE the window. Monitor windows are relative to "now" and
     * essentially never minute-aligned, so this shaved the first
     * partial minute off every evaluation.
     *
     * With the non-colliding `seriesBucketTime` alias the raw-time
     * predicate is preserved:
     *   - device-a@10:00:35 (v=15) -> bucket 10:00, avg 15
     *     (its 10:00:05/v=5 sample is BEFORE the window start and must
     *     be excluded from the average)
     *   - device-b@10:00:10 -> before the window, excluded entirely
     *   - device-c@10:01:59 (v=30) -> bucket 10:01, avg 30
     */
    const resultSet: Awaited<ReturnType<ClickHouseClient["query"]>> =
      await client.query({
        query: `
            SELECT avg(value) AS value,
                   toStartOfMinute(time) AS seriesBucketTime,
                   attributes[{k0:String}] AS seriesAttribute0
            FROM ${tableName}
            WHERE TRUE
              AND time >= {windowStart:DateTime64(9)}
              AND time <= {windowEnd:DateTime64(9)}
            GROUP BY seriesBucketTime, seriesAttribute0
            ORDER BY seriesBucketTime DESC
            LIMIT {rowCap:Int32}
          `,
        query_params: {
          k0: "device.id",
          windowStart: "2026-07-03 10:00:30.000000000",
          windowEnd: "2026-07-03 10:05:00.000000000",
          rowCap: 100000,
        },
        format: "JSON",
      });

    const response: ResponseJSON<JSONObject> =
      (await resultSet.json<JSONObject>()) as ResponseJSON<JSONObject>;
    const rows: Array<JSONObject> = response.data || [];

    const seriesValues: Map<string, number> = new Map<string, number>();
    for (const row of rows) {
      seriesValues.set(String(row["seriesAttribute0"]), Number(row["value"]));
    }

    /*
     * device-a's first-partial-minute bucket MUST be present. Under
     * the shadowed-alias bug this row disappears (only device-c
     * survives), so this assertion is the empirical guard against
     * reintroducing `AS time`.
     */
    expect(rows).toHaveLength(2);
    expect(seriesValues.get("device-a")).toBe(15);
    expect(seriesValues.get("device-c")).toBe(30);
    // Entirely-before-window series stays excluded by the raw predicate.
    expect(seriesValues.has("device-b")).toBe(false);
  }, 60000);
});
