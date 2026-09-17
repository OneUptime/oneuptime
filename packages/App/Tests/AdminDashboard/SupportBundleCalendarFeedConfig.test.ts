import {
  SECRET_KEY_PATTERN_EXCEPTIONS,
  SUPPORT_CONFIG_ALLOW_LIST,
  getRedactedConfig,
} from "../../API/AdminHealth";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The support bundle's redacted config is what an operator attaches to a
 * support request. The two on-call-calendar-feed troubleshooting scenarios in
 * the docs — "503 on every feed" and "429 for a whole office" — are answered
 * by the kill switch and the rate-limit tuning, so those four variables have
 * to be in the bundle. None of them is a secret: a boolean and three small
 * integers.
 *
 * The PER_TOKEN limit is the interesting one: it contains the substring
 * "TOKEN", which the defence-in-depth SECRET_KEY_PATTERN matches, so without
 * an explicit carve-out it would be dropped from the bundle silently.
 */

const FEED_KEYS: Array<string> = [
  "DISABLE_ON_CALL_CALENDAR_FEED",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW",
];

/*
 * A copy of AdminHealth's defence-in-depth pattern. Deliberately duplicated:
 * this test asserts what the bundle promises ("no key that looks like a
 * credential is ever emitted"), so it should fail if the module's pattern is
 * weakened, not follow it.
 */
const SECRET_LOOKING_PATTERN: RegExp =
  /PASSWORD|SECRET|TOKEN|PRIVATE|CREDENTIAL|APIKEY|_KEY|HEADERS|CERT|_CA$|_SSL|AUTH/i;

const touchedEnvKeys: Array<string> = [];

function setEnv(key: string, value: string): void {
  touchedEnvKeys.push(key);
  process.env[key] = value;
}

describe("support bundle: on-call calendar feed configuration", () => {
  afterEach(() => {
    for (const key of touchedEnvKeys) {
      delete process.env[key];
    }
    touchedEnvKeys.length = 0;
  });

  test("all four feed variables are allow-listed", () => {
    for (const key of FEED_KEYS) {
      expect(SUPPORT_CONFIG_ALLOW_LIST).toContain(key);
    }
  });

  test("their effective values reach the bundle — the PER_TOKEN limit included", () => {
    setEnv("DISABLE_ON_CALL_CALENDAR_FEED", "true");
    setEnv("ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS", "60");
    setEnv("ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW", "12");
    setEnv("ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW", "120");

    const config: JSONObject = getRedactedConfig();

    expect(config["DISABLE_ON_CALL_CALENDAR_FEED"]).toBe("true");
    expect(config["ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS"]).toBe(
      "60",
    );
    expect(
      config["ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW"],
    ).toBe("12");
    expect(config["ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW"]).toBe(
      "120",
    );
  });

  test("a variable that is not set is simply absent", () => {
    const config: JSONObject = getRedactedConfig();

    for (const key of FEED_KEYS) {
      expect(key in config).toBe(false);
    }
  });

  test("the secret-pattern carve-out is narrow: only provably non-secret keys, and each one allow-listed", () => {
    expect([...SECRET_KEY_PATTERN_EXCEPTIONS]).toEqual([
      "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW",
    ]);

    for (const key of SECRET_KEY_PATTERN_EXCEPTIONS) {
      expect(SUPPORT_CONFIG_ALLOW_LIST).toContain(key);
    }
  });

  test("secret-looking keys are still kept out of the bundle", () => {
    /*
     * Nothing matching the pattern (other than the carve-out) may be emitted,
     * even if someone adds it to the allow-list later.
     */
    const secretLooking: Array<string> = SUPPORT_CONFIG_ALLOW_LIST.filter(
      (key: string) => {
        return (
          !SECRET_KEY_PATTERN_EXCEPTIONS.has(key) &&
          SECRET_LOOKING_PATTERN.test(key)
        );
      },
    );

    for (const key of secretLooking) {
      setEnv(key, "sensitive-value");
    }

    const config: JSONObject = getRedactedConfig();

    for (const key of secretLooking) {
      expect(key in config).toBe(false);
    }
  });
});
