import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * The flow collector's name lookups (issue #5340), as the probe's
 * environment sets them: on unless turned off, a few hundred addresses a
 * minute, the host's own resolver unless servers are named, and private
 * addresses looked up everywhere but on a hosted instance's shared global
 * probes.
 */

const KEYS: Array<string> = [
  "PROBE_FLOW_NAME_LOOKUP_ENABLED",
  "PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE",
  "PROBE_FLOW_NAME_DNS_SERVERS",
  "REGISTER_PROBE_KEY",
  "BILLING_ENABLED",
];

interface FlowNameConfig {
  PROBE_FLOW_NAME_LOOKUP_ENABLED: boolean;
  PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE: number;
  PROBE_FLOW_NAME_DNS_SERVERS: Array<string>;
  PROBE_FLOW_NAME_LOOKUP_PRIVATE_ADDRESSES: boolean;
}

const original: Record<string, string | undefined> = {};

function load(values: Record<string, string>): FlowNameConfig {
  for (const key of KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }

  let config: FlowNameConfig | null = null;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    config = require("../Config") as FlowNameConfig;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  return config!;
}

describe("flow name lookups configuration", () => {
  beforeAll(() => {
    for (const key of [...KEYS, "ONEUPTIME_URL", "PROBE_KEY"]) {
      original[key] = process.env[key];
    }

    process.env["ONEUPTIME_URL"] = "http://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("on by default: 300 addresses a minute, on the host's own resolver, private ones included", () => {
    const config: FlowNameConfig = load({});

    expect(config.PROBE_FLOW_NAME_LOOKUP_ENABLED).toBe(true);
    expect(config.PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE).toBe(300);
    expect(config.PROBE_FLOW_NAME_DNS_SERVERS).toEqual([]);
    expect(config.PROBE_FLOW_NAME_LOOKUP_PRIVATE_ADDRESSES).toBe(true);
  });

  test("turns off only for an explicit false", () => {
    expect(
      load({ PROBE_FLOW_NAME_LOOKUP_ENABLED: "false" })
        .PROBE_FLOW_NAME_LOOKUP_ENABLED,
    ).toBe(false);

    for (const value of ["true", "", "0", "no"]) {
      expect(
        load({ PROBE_FLOW_NAME_LOOKUP_ENABLED: value })
          .PROBE_FLOW_NAME_LOOKUP_ENABLED,
      ).toBe(true);
    }
  });

  test("an operator's own rate, 0 to turn lookups off, never past 6000 a minute", () => {
    expect(
      load({ PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE: "1200" })
        .PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE,
    ).toBe(1200);
    expect(
      load({ PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE: "0" })
        .PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE,
    ).toBe(0);
    for (const value of ["-1", "6001", "lots"]) {
      expect(
        load({ PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE: value })
          .PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE,
      ).toBe(300);
    }
  });

  test("named DNS servers are asked instead; what is not one is left out", () => {
    expect(
      load({
        PROBE_FLOW_NAME_DNS_SERVERS: "10.0.0.53, dns.corp.example, [fd00::53]:5353",
      }).PROBE_FLOW_NAME_DNS_SERVERS,
    ).toEqual(["10.0.0.53", "[fd00::53]:5353"]);
  });

  test("a hosted instance's shared global probe looks up public addresses only", () => {
    expect(
      load({ REGISTER_PROBE_KEY: "registration-key", BILLING_ENABLED: "true" })
        .PROBE_FLOW_NAME_LOOKUP_PRIVATE_ADDRESSES,
    ).toBe(false);
    // A self-hosted instance's own global probe runs in its operator's network.
    expect(
      load({ REGISTER_PROBE_KEY: "registration-key" })
        .PROBE_FLOW_NAME_LOOKUP_PRIVATE_ADDRESSES,
    ).toBe(true);
    // A project's own probe, on any instance.
    expect(
      load({ BILLING_ENABLED: "true" }).PROBE_FLOW_NAME_LOOKUP_PRIVATE_ADDRESSES,
    ).toBe(true);
  });
});
