import {
  SUPPORT_CONFIG_ALLOW_LIST,
  getRedactedConfig,
} from "../../API/AdminHealth";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, describe, expect, test } from "@jest/globals";

const SERVER_OTLP_ENDPOINT_ENV_KEY: string =
  "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT";
const SERVER_OTLP_HEADERS_ENV_KEY: string =
  "OPENTELEMETRY_EXPORTER_OTLP_HEADERS";

const originalEndpoint: string | undefined =
  process.env[SERVER_OTLP_ENDPOINT_ENV_KEY];
const originalHeaders: string | undefined =
  process.env[SERVER_OTLP_HEADERS_ENV_KEY];

function restoreEnvironmentVariable(
  key: string,
  originalValue: string | undefined,
): void {
  if (typeof originalValue === "undefined") {
    delete process.env[key];
    return;
  }

  process.env[key] = originalValue;
}

describe("support bundle: server OTLP configuration security", () => {
  afterEach(() => {
    restoreEnvironmentVariable(SERVER_OTLP_ENDPOINT_ENV_KEY, originalEndpoint);
    restoreEnvironmentVariable(SERVER_OTLP_HEADERS_ENV_KEY, originalHeaders);
  });

  test("does not allow-list either server exporter setting", () => {
    expect(SUPPORT_CONFIG_ALLOW_LIST).not.toContain(
      SERVER_OTLP_ENDPOINT_ENV_KEY,
    );
    expect(SUPPORT_CONFIG_ALLOW_LIST).not.toContain(
      SERVER_OTLP_HEADERS_ENV_KEY,
    );
  });

  test.each([
    [
      "URL userinfo",
      "https://support-user:support-password@collector.internal:4318",
      ["support-user", "support-password"],
    ],
    [
      "sensitive query parameters",
      "https://collector.example:4318?api_key=query-secret&token=query-token",
      ["query-secret", "query-token"],
    ],
    [
      "URL fragments",
      "https://collector.example:4318/#authorization=fragment-secret",
      ["fragment-secret"],
    ],
  ])(
    "omits an endpoint containing %s",
    (
      _description: string,
      endpoint: string,
      secretSentinels: Array<string>,
    ) => {
      process.env[SERVER_OTLP_ENDPOINT_ENV_KEY] = endpoint;

      const config: JSONObject = getRedactedConfig();
      const serializedConfig: string = JSON.stringify(config);

      expect(config).not.toHaveProperty(SERVER_OTLP_ENDPOINT_ENV_KEY);
      expect(serializedConfig).not.toContain(endpoint);

      for (const sentinel of secretSentinels) {
        expect(serializedConfig).not.toContain(sentinel);
      }
    },
  );

  test("omits arbitrary server exporter authorization headers", () => {
    process.env[SERVER_OTLP_HEADERS_ENV_KEY] =
      "authorization=Bearer support-bundle-secret;x-oneuptime-token=server-key";

    const config: JSONObject = getRedactedConfig();
    const serializedConfig: string = JSON.stringify(config);

    expect(config).not.toHaveProperty(SERVER_OTLP_HEADERS_ENV_KEY);
    expect(serializedConfig).not.toContain("support-bundle-secret");
    expect(serializedConfig).not.toContain("server-key");
  });
});
