import { describe, expect, test } from "@jest/globals";
import DataStoreEnvironment, {
  ALL_DATA_STORE_ENVIRONMENTS,
  inferDataStoreEnvironment,
  isNonProduction,
} from "../../../Types/DataSecurity/DataStoreEnvironment";

/*
 * WHICH ENVIRONMENT A STORE SERVES: ITS TAGS FIRST, THEN ITS NAME.
 *
 * Words are read whole, so "devices" is no development store and
 * "contest" no test one.
 */

describe("inferDataStoreEnvironment", () => {
  test("reads the environment tags teams use, in any case", () => {
    expect(inferDataStoreEnvironment("orders", { env: "prod" })).toBe(
      DataStoreEnvironment.Production,
    );
    expect(
      inferDataStoreEnvironment("orders", { Environment: "Staging" }),
    ).toBe(DataStoreEnvironment.Staging);
    expect(inferDataStoreEnvironment("orders", { stage: "uat" })).toBe(
      DataStoreEnvironment.Staging,
    );
    expect(inferDataStoreEnvironment("orders", { tier: "qa" })).toBe(
      DataStoreEnvironment.Test,
    );
    expect(
      inferDataStoreEnvironment("orders", {
        "deployment.environment": "development",
      }),
    ).toBe(DataStoreEnvironment.Development);
    expect(inferDataStoreEnvironment("orders", { "app-env": "eu-prd-1" })).toBe(
      DataStoreEnvironment.Production,
    );
  });

  test("lets a tag win over the name", () => {
    expect(inferDataStoreEnvironment("orders-dev", { env: "production" })).toBe(
      DataStoreEnvironment.Production,
    );
  });

  test("ignores other tags, and environment tags whose value names none", () => {
    expect(inferDataStoreEnvironment("orders-dev", { team: "prod" })).toBe(
      DataStoreEnvironment.Development,
    );
    expect(inferDataStoreEnvironment("orders-staging", { env: "blue" })).toBe(
      DataStoreEnvironment.Staging,
    );
  });

  test("reads the words of a store's name", () => {
    expect(inferDataStoreEnvironment("orders-prod-db", null)).toBe(
      DataStoreEnvironment.Production,
    );
    expect(inferDataStoreEnvironment("live_events", undefined)).toBe(
      DataStoreEnvironment.Production,
    );
    expect(inferDataStoreEnvironment("my_staging_bucket", {})).toBe(
      DataStoreEnvironment.Staging,
    );
    expect(inferDataStoreEnvironment("preprod.analytics", {})).toBe(
      DataStoreEnvironment.Staging,
    );
    expect(inferDataStoreEnvironment("dev.analytics", {})).toBe(
      DataStoreEnvironment.Development,
    );
    expect(inferDataStoreEnvironment("Sandbox Exports", {})).toBe(
      DataStoreEnvironment.Development,
    );
    expect(inferDataStoreEnvironment("e2e-results", {})).toBe(
      DataStoreEnvironment.Test,
    );
    expect(inferDataStoreEnvironment("ci/cache", {})).toBe(
      DataStoreEnvironment.Test,
    );
  });

  test("reads whole words only", () => {
    expect(inferDataStoreEnvironment("devices", {})).toBe(
      DataStoreEnvironment.Unknown,
    );
    expect(inferDataStoreEnvironment("contest-entries", {})).toBe(
      DataStoreEnvironment.Unknown,
    );
    expect(inferDataStoreEnvironment("product-catalog", {})).toBe(
      DataStoreEnvironment.Unknown,
    );
    expect(inferDataStoreEnvironment("delivery", {})).toBe(
      DataStoreEnvironment.Unknown,
    );
  });

  test("takes production first when a name holds several", () => {
    expect(inferDataStoreEnvironment("prod-copy-for-dev", {})).toBe(
      DataStoreEnvironment.Production,
    );
  });

  test("is Unknown with nothing to go on", () => {
    expect(inferDataStoreEnvironment("", null)).toBe(
      DataStoreEnvironment.Unknown,
    );
    expect(
      inferDataStoreEnvironment("customer-exports", { owner: "data" }),
    ).toBe(DataStoreEnvironment.Unknown);
  });
});

describe("isNonProduction", () => {
  test("is true for staging, development and test only", () => {
    expect(ALL_DATA_STORE_ENVIRONMENTS.filter(isNonProduction)).toEqual([
      DataStoreEnvironment.Staging,
      DataStoreEnvironment.Development,
      DataStoreEnvironment.Test,
    ]);
    expect(isNonProduction(undefined)).toBe(false);
    expect(isNonProduction("Something else")).toBe(false);
  });
});
