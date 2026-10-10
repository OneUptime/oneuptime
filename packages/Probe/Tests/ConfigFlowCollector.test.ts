import {
  DEFAULT_IPFIX_COLLECTOR_PORT,
  DEFAULT_NETFLOW_COLLECTOR_PORT,
  DEFAULT_SFLOW_COLLECTOR_PORT,
} from "Common/Types/NetFlow/NetworkFlowCollectorPorts";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * The flow collector's settings: on unless turned off, the three
 * conventional ports, each movable or closable on its own, and a datagram
 * limit that fits a busy router's export.
 */

const FLOW_KEYS: Array<string> = [
  "PROBE_NETFLOW_RECEIVER_ENABLED",
  "PROBE_NETFLOW_RECEIVER_PORT",
  "PROBE_IPFIX_RECEIVER_PORT",
  "PROBE_SFLOW_RECEIVER_PORT",
  "PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE",
];

interface FlowCollectorConfig {
  PROBE_NETFLOW_RECEIVER_ENABLED: boolean;
  PROBE_NETFLOW_RECEIVER_PORT: number;
  PROBE_IPFIX_RECEIVER_PORT: number;
  PROBE_SFLOW_RECEIVER_PORT: number;
  PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE: number;
}

const original: Record<string, string | undefined> = {};

function load(values: Record<string, string>): FlowCollectorConfig {
  for (const key of FLOW_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }

  let config: FlowCollectorConfig | null = null;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    config = require("../Config") as FlowCollectorConfig;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  return config!;
}

describe("flow collector configuration", () => {
  beforeAll(() => {
    for (const key of [...FLOW_KEYS, "ONEUPTIME_URL", "PROBE_KEY"]) {
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

  test("is on by default, on the conventional NetFlow, IPFIX and sFlow ports", () => {
    const config: FlowCollectorConfig = load({});

    expect(config.PROBE_NETFLOW_RECEIVER_ENABLED).toBe(true);
    expect(config.PROBE_NETFLOW_RECEIVER_PORT).toBe(
      DEFAULT_NETFLOW_COLLECTOR_PORT,
    );
    expect(config.PROBE_IPFIX_RECEIVER_PORT).toBe(DEFAULT_IPFIX_COLLECTOR_PORT);
    expect(config.PROBE_SFLOW_RECEIVER_PORT).toBe(DEFAULT_SFLOW_COLLECTOR_PORT);
    expect([2055, 4739, 6343]).toEqual([
      DEFAULT_NETFLOW_COLLECTOR_PORT,
      DEFAULT_IPFIX_COLLECTOR_PORT,
      DEFAULT_SFLOW_COLLECTOR_PORT,
    ]);
  });

  test("turns off only for an explicit false", () => {
    expect(
      load({ PROBE_NETFLOW_RECEIVER_ENABLED: "false" })
        .PROBE_NETFLOW_RECEIVER_ENABLED,
    ).toBe(false);

    // The old opt-in value keeps it on; anything else does too.
    for (const value of ["true", "", "0", "no"]) {
      expect(
        load({ PROBE_NETFLOW_RECEIVER_ENABLED: value })
          .PROBE_NETFLOW_RECEIVER_ENABLED,
      ).toBe(true);
    }
  });

  test("each port moves on its own, 0 closes one, and a value that is not a port keeps the default", () => {
    const moved: FlowCollectorConfig = load({
      PROBE_NETFLOW_RECEIVER_PORT: "9995",
      PROBE_IPFIX_RECEIVER_PORT: "0",
      PROBE_SFLOW_RECEIVER_PORT: "70000",
    });

    expect(moved.PROBE_NETFLOW_RECEIVER_PORT).toBe(9995);
    expect(moved.PROBE_IPFIX_RECEIVER_PORT).toBe(0);
    expect(moved.PROBE_SFLOW_RECEIVER_PORT).toBe(DEFAULT_SFLOW_COLLECTOR_PORT);

    expect(
      load({ PROBE_NETFLOW_RECEIVER_PORT: "-1" }).PROBE_NETFLOW_RECEIVER_PORT,
    ).toBe(DEFAULT_NETFLOW_COLLECTOR_PORT);
  });

  test("accepts 6000 datagrams a minute by default, and an operator's own limit", () => {
    expect(load({}).PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE).toBe(6000);
    expect(
      load({ PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE: "60000" })
        .PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE,
    ).toBe(60000);
    expect(
      load({ PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE: "0" })
        .PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE,
    ).toBe(6000);
  });
});
