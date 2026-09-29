import {
  ClickHouseFixtureLocation,
  ClickHouseFixtureSettings,
  resolveClickHouseFixtureLocation,
} from "../Dashboard/Helpers/ExceptionOccurrenceFixture";
import { expect, test } from "@playwright/test";

/*
 * ExceptionDetailPages.spec.ts seeds its occurrence by writing to ClickHouse
 * directly, and this resolver decides where that write goes. The e2e container
 * runs with network_mode: host and receives config.env's CLICKHOUSE_HOST, the
 * compose-network name "clickhouse", which it cannot resolve. Before the e2e
 * service was given those settings the resolver fell back to 127.0.0.1:8123 -
 * a port no stack publishes - and every CI e2e job failed in beforeAll with
 * ECONNREFUSED.
 *
 * The compose half of the contract (the loopback port both local stacks
 * publish) is pinned by
 * Common/Tests/Server/Infrastructure/E2EClickHouseFixtureAccess.test.ts.
 */

// What config.env and docker-compose.base.yml hand the e2e container.
const LOCAL_STACK: ClickHouseFixtureSettings = {
  database: "oneuptime",
  explicitUrl: "",
  explicitPort: "",
  configuredHost: "clickhouse",
  configuredPort: "8123",
  isHttps: false,
  browserTarget: "http://localhost",
};

test.describe("ClickHouse fixture location", () => {
  test("maps config.env's compose hostname to the loopback port a local stack publishes", () => {
    for (const browserTarget of ["http://localhost", "http://127.0.0.1"]) {
      const location: ClickHouseFixtureLocation =
        resolveClickHouseFixtureLocation({ ...LOCAL_STACK, browserTarget });

      expect(location.database).toBe("oneuptime");
      expect(location.endpoint.toString()).toBe("http://127.0.0.1:8189/");
    }
  });

  test("lets an explicit port replace the published local port", () => {
    const location: ClickHouseFixtureLocation =
      resolveClickHouseFixtureLocation({
        ...LOCAL_STACK,
        explicitPort: "9123",
      });

    expect(location.endpoint.toString()).toBe("http://127.0.0.1:9123/");
  });

  test("keeps a remote target on its configured host, port and protocol", () => {
    const location: ClickHouseFixtureLocation =
      resolveClickHouseFixtureLocation({
        ...LOCAL_STACK,
        configuredHost: "clickhouse.internal",
        configuredPort: "8443",
        isHttps: true,
        browserTarget: "https://staging.example.com",
      });

    expect(location.endpoint.toString()).toBe(
      "https://clickhouse.internal:8443/",
    );
  });

  test("lets E2E_CLICKHOUSE_URL override host, port and protocol", () => {
    const location: ClickHouseFixtureLocation =
      resolveClickHouseFixtureLocation({
        ...LOCAL_STACK,
        explicitUrl: " https://analytics.example.com:9440/clickhouse ",
        explicitPort: "8123",
      });

    expect(location.endpoint.toString()).toBe(
      "https://analytics.example.com:9440/clickhouse",
    );
  });

  test("refuses a non-http fixture URL and a database name it would splice into SQL", () => {
    expect(() => {
      resolveClickHouseFixtureLocation({
        ...LOCAL_STACK,
        explicitUrl: "tcp://127.0.0.1:9000",
      });
    }).toThrow("E2E_CLICKHOUSE_URL must use http or https.");

    expect(() => {
      resolveClickHouseFixtureLocation({
        ...LOCAL_STACK,
        database: "oneuptime; DROP TABLE x",
      });
    }).toThrow("Invalid ClickHouse database");
  });
});
