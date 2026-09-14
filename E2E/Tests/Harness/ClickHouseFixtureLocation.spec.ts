import {
  ClickHouseFixtureLocation,
  resolveClickHouseFixtureLocation,
} from "../Dashboard/Helpers/ExceptionOccurrenceFixture";
import { expect, test } from "@playwright/test";

test.describe("ClickHouse fixture location", () => {
  test("maps the compose hostname to the loopback-published port for a local browser target", () => {
    const location: ClickHouseFixtureLocation =
      resolveClickHouseFixtureLocation({
        database: "oneuptime",
        explicitUrl: "",
        configuredHost: "clickhouse",
        browserTarget: "http://localhost",
        explicitPort: "",
        configuredPort: "8123",
        isHttps: false,
      });

    expect(location.database).toBe("oneuptime");
    expect(location.endpoint.toString()).toBe("http://127.0.0.1:8189/");
  });

  test("honors an explicit fixture port without changing the local host", () => {
    const location: ClickHouseFixtureLocation =
      resolveClickHouseFixtureLocation({
        database: "oneuptime",
        explicitUrl: "",
        configuredHost: "clickhouse",
        browserTarget: "http://127.0.0.1",
        explicitPort: "9123",
        configuredPort: "8123",
        isHttps: false,
      });

    expect(location.endpoint.toString()).toBe("http://127.0.0.1:9123/");
  });

  test("leaves a non-local test target on its configured ClickHouse endpoint", () => {
    const location: ClickHouseFixtureLocation =
      resolveClickHouseFixtureLocation({
        database: "oneuptime",
        explicitUrl: "",
        configuredHost: "clickhouse.internal",
        browserTarget: "https://staging.example.com",
        explicitPort: "",
        configuredPort: "8443",
        isHttps: true,
      });

    expect(location.endpoint.toString()).toBe(
      "https://clickhouse.internal:8443/",
    );
  });

  test("lets the explicit fixture URL override host, port and protocol", () => {
    const location: ClickHouseFixtureLocation =
      resolveClickHouseFixtureLocation({
        database: "oneuptime",
        explicitUrl: "https://analytics.example.com:9440/clickhouse",
        configuredHost: "ignored",
        browserTarget: "http://localhost",
        explicitPort: "8123",
        configuredPort: "8123",
        isHttps: false,
      });

    expect(location.endpoint.toString()).toBe(
      "https://analytics.example.com:9440/clickhouse",
    );
  });
});
