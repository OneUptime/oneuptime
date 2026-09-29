import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_PORT,
  ParsedConfig,
  parseConfig,
  parseInterval,
  parsePort,
  parseSwitch,
  parseWriteNamespaces,
} from "../Config";

const VALID: Record<string, string> = {
  ONEUPTIME_URL: "https://oneuptime.example.com",
  ONEUPTIME_API_KEY: "ingestion-key",
  ONEUPTIME_KUBERNETES_CLUSTER_NAME: "prod-us",
};

function parse(env: Record<string, string | undefined>): ParsedConfig {
  return parseConfig({ ...VALID, ...env });
}

describe("required settings", () => {
  test("a complete environment has no problems", () => {
    const parsed: ParsedConfig = parse({});

    assert.deepStrictEqual(parsed.problems, []);
    assert.strictEqual(parsed.config.oneuptimeUrl, VALID["ONEUPTIME_URL"]);
    assert.strictEqual(parsed.config.apiKey, "ingestion-key");
    assert.strictEqual(parsed.config.clusterName, "prod-us");
  });

  test("an empty environment is three problems, never an exception", () => {
    const parsed: ParsedConfig = parseConfig({});

    assert.strictEqual(parsed.problems.length, 3);
    assert.match(
      parsed.problems[0]!,
      /ONEUPTIME_URL is not set.*oneuptime\.url/,
    );
    assert.match(
      parsed.problems[1]!,
      /ONEUPTIME_API_KEY is not set.*oneuptime\.apiKey/,
    );
    assert.match(
      parsed.problems[2]!,
      /ONEUPTIME_KUBERNETES_CLUSTER_NAME is not set.*clusterName/,
    );
  });

  test("whitespace-only values count as missing", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_API_KEY: "   ",
      ONEUPTIME_KUBERNETES_CLUSTER_NAME: "\t",
    });

    assert.strictEqual(parsed.problems.length, 2);
  });

  test("the URL loses trailing slashes and surrounding whitespace", () => {
    assert.strictEqual(
      parse({ ONEUPTIME_URL: "  https://oneuptime.example.com///  " }).config
        .oneuptimeUrl,
      "https://oneuptime.example.com",
    );
    assert.strictEqual(
      parse({ ONEUPTIME_URL: "http://oneuptime.oneuptime.svc:80/" }).config
        .oneuptimeUrl,
      "http://oneuptime.oneuptime.svc:80",
    );
  });

  test("a URL that is not http(s) is a problem", () => {
    for (const url of [
      "ftp://oneuptime.example.com",
      "oneuptime.example.com",
    ]) {
      const parsed: ParsedConfig = parse({ ONEUPTIME_URL: url });

      assert.strictEqual(parsed.problems.length, 1, url);
      assert.match(parsed.problems[0]!, /is not an http\(s\) URL/);
    }
  });

  test("the cluster name and key are trimmed", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_API_KEY: " key ",
      ONEUPTIME_KUBERNETES_CLUSTER_NAME: " Prod-US ",
    });

    assert.strictEqual(parsed.config.apiKey, "key");
    // Case is kept: the server compares cluster identifiers case-insensitively.
    assert.strictEqual(parsed.config.clusterName, "Prod-US");
  });
});

describe("kubectl switches", () => {
  test('only "true" turns a switch on', () => {
    for (const on of ["true", "TRUE", " True ", "tRuE"]) {
      assert.strictEqual(parseSwitch(on), true, on);
    }

    for (const off of [
      undefined,
      null,
      "",
      "false",
      "yes",
      "1",
      "on",
      "enabled",
      "readonly",
      "true-ish",
    ]) {
      assert.strictEqual(parseSwitch(off), false, String(off));
    }
  });

  test("writes are off by default (read-only)", () => {
    const parsed: ParsedConfig = parse({});

    assert.strictEqual(parsed.config.allowWrites, false);
    assert.strictEqual(parsed.config.allowWritesSetting, null);
    assert.strictEqual(parsed.config.allowNodeOperations, false);
    assert.strictEqual(parsed.config.allowNodeOperationsSetting, null);
    assert.deepStrictEqual(parsed.warnings, []);
  });

  test("the chart's switches are read", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
      ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS: "true",
    });

    assert.strictEqual(parsed.config.allowWrites, true);
    assert.strictEqual(parsed.config.allowWritesSetting, "true");
    assert.strictEqual(parsed.config.allowNodeOperations, true);
  });

  test("an unrecognised switch value refuses and says so once", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "yes",
      ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS: "enabled",
    });

    assert.strictEqual(parsed.config.allowWrites, false);
    assert.strictEqual(parsed.config.allowWritesSetting, "yes");
    assert.strictEqual(parsed.config.allowNodeOperations, false);
    assert.strictEqual(parsed.warnings.length, 2);
    assert.match(parsed.warnings[0]!, /ONEUPTIME_KUBECTL_ALLOW_WRITES="yes"/);
    assert.match(
      parsed.warnings[1]!,
      /ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS/,
    );
  });

  test('"false" is recognised: no warning', () => {
    assert.deepStrictEqual(
      parse({ ONEUPTIME_KUBECTL_ALLOW_WRITES: "false" }).warnings,
      [],
    );
  });
});

describe("write namespaces", () => {
  test("a comma list, trimmed, lowercased, without blanks or duplicates", () => {
    assert.deepStrictEqual(parseWriteNamespaces(" Web, api ,,WEB ,  "), [
      "web",
      "api",
    ]);
  });

  test("empty or unset means cluster-wide", () => {
    assert.deepStrictEqual(parseWriteNamespaces(""), []);
    assert.deepStrictEqual(parseWriteNamespaces(undefined), []);
    assert.deepStrictEqual(parse({}).config.writeNamespaces, []);
  });

  test("the chart's list reaches the config", () => {
    assert.deepStrictEqual(
      parse({ ONEUPTIME_KUBECTL_WRITE_NAMESPACES: "web,api" }).config
        .writeNamespaces,
      ["web", "api"],
    );
  });
});

describe("pod namespace, versions and intervals", () => {
  test("the downward-API namespace is trimmed and lowercased", () => {
    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_POD_NAMESPACE: " OneUptime-Agent " }).config
        .podNamespace,
      "oneuptime-agent",
    );
    assert.strictEqual(parse({}).config.podNamespace, null);
  });

  test("versions are optional", () => {
    assert.strictEqual(parse({}).config.agentVersion, null);
    assert.strictEqual(parse({}).config.chartVersion, null);

    const parsed: ParsedConfig = parse({
      APP_VERSION: "14.0.9",
      ONEUPTIME_KUBERNETES_AGENT_CHART_VERSION: "14.0.9",
    });
    assert.strictEqual(parsed.config.agentVersion, "14.0.9");
    assert.strictEqual(parsed.config.chartVersion, "14.0.9");
  });

  test("the health port defaults to 3876 and ignores nonsense", () => {
    assert.strictEqual(DEFAULT_PORT, 3876);
    assert.strictEqual(parsePort(undefined), 3876);
    assert.strictEqual(parsePort("abc"), 3876);
    assert.strictEqual(parsePort("0"), 3876);
    assert.strictEqual(parsePort("70000"), 3876);
    assert.strictEqual(parsePort("4000"), 4000);
    assert.strictEqual(parse({ PORT: "4001" }).config.port, 4001);
  });

  test("the poll interval defaults to 3s with a 1s floor", () => {
    assert.strictEqual(DEFAULT_POLL_INTERVAL_MS, 3_000);
    assert.strictEqual(parse({}).config.pollIntervalMs, 3_000);
    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS: "500" }).config
        .pollIntervalMs,
      1_000,
    );
    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS: "5000" }).config
        .pollIntervalMs,
      5_000,
    );
    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS: "fast" }).config
        .pollIntervalMs,
      3_000,
    );
  });

  test("the heartbeat interval defaults to 30s with a 5s floor", () => {
    assert.strictEqual(DEFAULT_HEARTBEAT_INTERVAL_MS, 30_000);
    assert.strictEqual(parse({}).config.heartbeatIntervalMs, 30_000);
    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_HEARTBEAT_INTERVAL_MS: "1000" }).config
        .heartbeatIntervalMs,
      5_000,
    );
    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_HEARTBEAT_INTERVAL_MS: "60000" }).config
        .heartbeatIntervalMs,
      60_000,
    );
  });

  test("parseInterval rejects negatives, zero and decimals", () => {
    for (const value of ["-5", "0", "1.5", "1e4", ""]) {
      assert.strictEqual(
        parseInterval({ value, defaultValue: 7, min: 1 }),
        7,
        value,
      );
    }
  });
});
