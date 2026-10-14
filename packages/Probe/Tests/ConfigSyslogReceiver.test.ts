import {
  DEFAULT_SYSLOG_RATE_LIMIT_PER_MINUTE,
  DEFAULT_SYSLOG_RECEIVER_PORT,
} from "Common/Types/Syslog/SyslogReceiverDefaults";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * The syslog receiver's settings: on unless turned off - as the trap
 * receiver and the flow collector are - on a port above 1024, with a limit
 * an operator can raise.
 *
 * It used to be off unless turned on. A probe that was started with the
 * old opt-in value still has its receiver on.
 */

const SYSLOG_KEYS: Array<string> = [
  "PROBE_SYSLOG_RECEIVER_ENABLED",
  "PROBE_SYSLOG_RECEIVER_PORT",
  "PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE",
];

interface SyslogReceiverConfig {
  PROBE_SYSLOG_RECEIVER_ENABLED: boolean;
  PROBE_SYSLOG_RECEIVER_PORT: number;
  PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE: number;
}

const original: Record<string, string | undefined> = {};

function load(values: Record<string, string>): SyslogReceiverConfig {
  for (const key of SYSLOG_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }

  let config: SyslogReceiverConfig | null = null;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    config = require("../Config") as SyslogReceiverConfig;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  return config!;
}

describe("syslog receiver configuration", () => {
  beforeAll(() => {
    for (const key of [...SYSLOG_KEYS, "ONEUPTIME_URL", "PROBE_KEY"]) {
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

  test("is on by default, on port 5140, forwarding 600 messages a minute", () => {
    const config: SyslogReceiverConfig = load({});

    expect(config.PROBE_SYSLOG_RECEIVER_ENABLED).toBe(true);
    expect(config.PROBE_SYSLOG_RECEIVER_PORT).toBe(
      DEFAULT_SYSLOG_RECEIVER_PORT,
    );
    expect(config.PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE).toBe(
      DEFAULT_SYSLOG_RATE_LIMIT_PER_MINUTE,
    );
    expect([
      DEFAULT_SYSLOG_RECEIVER_PORT,
      DEFAULT_SYSLOG_RATE_LIMIT_PER_MINUTE,
    ]).toEqual([5140, 600]);
  });

  test("the default port needs no privileges", () => {
    expect(DEFAULT_SYSLOG_RECEIVER_PORT).toBeGreaterThan(1024);
  });

  test("turns off only for an explicit false", () => {
    expect(
      load({ PROBE_SYSLOG_RECEIVER_ENABLED: "false" })
        .PROBE_SYSLOG_RECEIVER_ENABLED,
    ).toBe(false);

    // The old opt-in value keeps it on; anything else does too.
    for (const value of ["true", "", "0", "no", "FALSE"]) {
      expect({
        value,
        enabled: load({ PROBE_SYSLOG_RECEIVER_ENABLED: value })
          .PROBE_SYSLOG_RECEIVER_ENABLED,
      }).toEqual({ value, enabled: true });
    }
  });

  test("the port moves, to the standard 514 too, and a value that is not a port keeps the default", () => {
    expect(
      load({ PROBE_SYSLOG_RECEIVER_PORT: "514" }).PROBE_SYSLOG_RECEIVER_PORT,
    ).toBe(514);
    expect(
      load({ PROBE_SYSLOG_RECEIVER_PORT: "65535" }).PROBE_SYSLOG_RECEIVER_PORT,
    ).toBe(65535);

    for (const value of ["0", "-1", "65536", "70000", "syslog", ""]) {
      expect({
        value,
        port: load({ PROBE_SYSLOG_RECEIVER_PORT: value })
          .PROBE_SYSLOG_RECEIVER_PORT,
      }).toEqual({ value, port: DEFAULT_SYSLOG_RECEIVER_PORT });
    }
  });

  test("takes an operator's own limit, and keeps the default for one that is not a limit", () => {
    expect(
      load({ PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE: "60000" })
        .PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE,
    ).toBe(60000);

    for (const value of ["0", "-5", "many", ""]) {
      expect(
        load({ PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE: value })
          .PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE,
      ).toBe(DEFAULT_SYSLOG_RATE_LIMIT_PER_MINUTE);
    }
  });
});
