import {
  SUPPORT_CONFIG_ALLOW_LIST,
  getRedactedConfig,
} from "../../API/AdminHealth";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #7920: queue jobs and probe scheduling get bounded shares of each
 * process's Postgres pool, so sign-ins always find a connection. When
 * sign-ins still time out, or probes are answered busy, the support bundle
 * has to say whether those shares were overridden. Small integers, never
 * secrets.
 */

const KEYS: Array<string> = [
  "DATABASE_MAX_QUEUE_JOB_CONNECTIONS",
  "PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS",
  // Issue #10819: the Test Monitor lane's slots, beside the work lane's.
  "PROBE_SCHEDULING_MAX_CONCURRENT_MONITOR_TEST_REQUESTS",
];

// AdminHealth's defence-in-depth pattern, as in the other bundle tests.
const SECRET_LOOKING_PATTERN: RegExp =
  /PASSWORD|SECRET|TOKEN|PRIVATE|CREDENTIAL|APIKEY|_KEY|HEADERS|CERT|_CA$|_SSL|AUTH/i;

const saved: Map<string, string | undefined> = new Map<
  string,
  string | undefined
>();

describe("support bundle: how the Postgres pool is shared", () => {
  beforeEach(() => {
    for (const key of KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value: string | undefined = saved.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("each is allow-listed once, beside the pool size they share", () => {
    for (const key of KEYS) {
      expect(
        SUPPORT_CONFIG_ALLOW_LIST.filter((entry: string): boolean => {
          return entry === key;
        }),
      ).toHaveLength(1);
      expect(SECRET_LOOKING_PATTERN.test(key)).toBe(false);
    }
    expect(SUPPORT_CONFIG_ALLOW_LIST).toContain(
      "DATABASE_MAX_OPEN_CONNECTIONS",
    );
  });

  test("an override reaches the bundle; the defaults are simply absent", () => {
    process.env["DATABASE_MAX_QUEUE_JOB_CONNECTIONS"] = "40";

    const config: JSONObject = getRedactedConfig();

    expect(config["DATABASE_MAX_QUEUE_JOB_CONNECTIONS"]).toBe("40");
    expect("PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS" in config).toBe(false);
    expect(
      "PROBE_SCHEDULING_MAX_CONCURRENT_MONITOR_TEST_REQUESTS" in config,
    ).toBe(false);
  });

  test("an override of the Test Monitor lane reaches the bundle", () => {
    process.env["PROBE_SCHEDULING_MAX_CONCURRENT_MONITOR_TEST_REQUESTS"] = "4";

    const config: JSONObject = getRedactedConfig();

    expect(
      config["PROBE_SCHEDULING_MAX_CONCURRENT_MONITOR_TEST_REQUESTS"],
    ).toBe("4");
  });
});
