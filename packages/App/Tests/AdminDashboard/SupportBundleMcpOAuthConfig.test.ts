import {
  SECRET_KEY_PATTERN_EXCEPTIONS,
  SUPPORT_CONFIG_ALLOW_LIST,
  getRedactedConfig,
} from "../../API/AdminHealth";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The support bundle's redacted config is what an operator attaches to a
 * support request. "MCP clients cannot sign in at all" and "clients register
 * but are never recognised by their metadata document" are each answered by
 * one switch - DISABLE_MCP_OAUTH and
 * DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS - so both have to be in the
 * bundle. Neither is a secret: each is a boolean.
 *
 * The trap is in the names. The bundle's defence-in-depth pattern drops any
 * key that LOOKS like a credential, and "AUTH" is on its list - so
 * DISABLE_MCP_OAUTH matches it on the "AUTH" inside "OAUTH". An allow-listed
 * key that trips the pattern is dropped from the bundle silently, exactly as
 * ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW was before it got its
 * carve-out (SupportBundleCalendarFeedConfig.test.ts). Being on the
 * allow-list is therefore not enough; what is pinned here is that the values
 * actually arrive.
 */

const MCP_OAUTH_KEYS: Array<string> = [
  "DISABLE_MCP_OAUTH",
  "DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS",
];

/*
 * A copy of AdminHealth's defence-in-depth pattern. Deliberately duplicated:
 * this test asserts what the bundle promises ("no key that looks like a
 * credential is ever emitted"), so it should fail if the module's pattern is
 * weakened, not follow it.
 */
const SECRET_LOOKING_PATTERN: RegExp =
  /PASSWORD|SECRET|TOKEN|PRIVATE|CREDENTIAL|APIKEY|_KEY|HEADERS|CERT|_CA$|_SSL|AUTH/i;

const savedEnv: Map<string, string | undefined> = new Map<
  string,
  string | undefined
>();

function setEnv(key: string, value: string): void {
  if (!savedEnv.has(key)) {
    savedEnv.set(key, process.env[key]);
  }

  process.env[key] = value;
}

function clearEnv(key: string): void {
  if (!savedEnv.has(key)) {
    savedEnv.set(key, process.env[key]);
  }

  delete process.env[key];
}

describe("support bundle: MCP OAuth configuration", () => {
  beforeEach(() => {
    // config.example.env ships both set to false; start from "not set".
    for (const key of MCP_OAUTH_KEYS) {
      clearEnv(key);
    }
  });

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    savedEnv.clear();
  });

  test("both switches are allow-listed, once each", () => {
    for (const key of MCP_OAUTH_KEYS) {
      expect(
        SUPPORT_CONFIG_ALLOW_LIST.filter((entry: string): boolean => {
          return entry === key;
        }),
      ).toHaveLength(1);
    }
  });

  test("both names trip the secret-looking pattern, which is why being allow-listed is not enough", () => {
    for (const key of MCP_OAUTH_KEYS) {
      expect(SECRET_LOOKING_PATTERN.test(key)).toBe(true);
    }
  });

  test("their effective values reach the bundle", () => {
    setEnv("DISABLE_MCP_OAUTH", "true");
    setEnv("DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS", "true");

    const config: JSONObject = getRedactedConfig();

    expect(config["DISABLE_MCP_OAUTH"]).toBe("true");
    expect(config["DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS"]).toBe(
      "true",
    );
  });

  test("the shipped defaults reach the bundle too: 'false' is an answer, not an absence", () => {
    setEnv("DISABLE_MCP_OAUTH", "false");
    setEnv("DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS", "false");

    const config: JSONObject = getRedactedConfig();

    expect(config["DISABLE_MCP_OAUTH"]).toBe("false");
    expect(config["DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS"]).toBe(
      "false",
    );
  });

  test("each switch is reported on its own", () => {
    setEnv("DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS", "true");

    const config: JSONObject = getRedactedConfig();

    expect(config["DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS"]).toBe(
      "true",
    );
    expect("DISABLE_MCP_OAUTH" in config).toBe(false);
  });

  test("a switch that is not set is simply absent", () => {
    const config: JSONObject = getRedactedConfig();

    for (const key of MCP_OAUTH_KEYS) {
      expect(key in config).toBe(false);
    }
  });

  test("whatever lets them through stays narrow: every carve-out is allow-listed and provably not a secret", () => {
    /*
     * The carve-out list is for keys whose VALUE cannot be a credential. The
     * two switches are booleans; the one entry that was already there is a
     * small integer.
     */
    const KNOWN_NON_SECRETS: Array<string> = [
      "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW",
      ...MCP_OAUTH_KEYS,
    ];

    for (const key of SECRET_KEY_PATTERN_EXCEPTIONS) {
      expect(SUPPORT_CONFIG_ALLOW_LIST).toContain(key);
      expect(KNOWN_NON_SECRETS).toContain(key);
    }
  });

  test("secret-looking keys are still kept out of the bundle", () => {
    /*
     * Nothing else matching the pattern may be emitted, even if someone adds
     * it to the allow-list later: letting two booleans through must not have
     * loosened the rule for anything that could hold a credential.
     */
    const nonSecrets: Set<string> = new Set<string>([
      ...SECRET_KEY_PATTERN_EXCEPTIONS,
      ...MCP_OAUTH_KEYS,
    ]);

    const secretLooking: Array<string> = SUPPORT_CONFIG_ALLOW_LIST.filter(
      (key: string): boolean => {
        return !nonSecrets.has(key) && SECRET_LOOKING_PATTERN.test(key);
      },
    );

    for (const key of secretLooking) {
      setEnv(key, "sensitive-value");
    }

    const config: JSONObject = getRedactedConfig();

    for (const key of secretLooking) {
      expect(key in config).toBe(false);
    }

    expect(JSON.stringify(config)).not.toContain("sensitive-value");
  });

  test("an OAuth SECRET would still be dropped: the carve-out is by name, not by 'OAUTH'", () => {
    /*
     * The fix for these two keys must not be "stop treating AUTH as
     * sensitive": a key such as an OAuth client secret is exactly what the
     * pattern is there to catch.
     */
    for (const key of [
      "MCP_OAUTH_CLIENT_SECRET",
      "OAUTH_SIGNING_KEY",
      "SLACK_APP_CLIENT_SECRET",
      "BASIC_AUTH_PASSWORD",
    ]) {
      expect(SECRET_LOOKING_PATTERN.test(key)).toBe(true);
      expect(SECRET_KEY_PATTERN_EXCEPTIONS.has(key)).toBe(false);
    }
  });
});
