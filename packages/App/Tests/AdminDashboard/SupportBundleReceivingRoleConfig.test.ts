import {
  SUPPORT_CONFIG_ALLOW_LIST,
  getRedactedConfig,
} from "../../API/AdminHealth";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #2825: time OneUptime was not receiving data is never held against a
 * host or a monitor - as long as the processes that record "receiving" are
 * the ones ingress reaches. On a deployment with separate workers, a worker
 * left on the default (RECEIVES_INGRESS_TRAFFIC unset, so true) keeps
 * recording while every ingress replica is down, and the outage counts as
 * downtime again. So the support bundle has to say which role the process
 * that wrote it has. The value is a boolean, never a secret.
 */

const KEY: string = "RECEIVES_INGRESS_TRAFFIC";

/*
 * A copy of AdminHealth's defence-in-depth pattern, as in the other support
 * bundle tests: an allow-listed key that looks like a credential is dropped.
 */
const SECRET_LOOKING_PATTERN: RegExp =
  /PASSWORD|SECRET|TOKEN|PRIVATE|CREDENTIAL|APIKEY|_KEY|HEADERS|CERT|_CA$|_SSL|AUTH/i;

let saved: string | undefined;

describe("support bundle: whether this process records that OneUptime is receiving", () => {
  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = saved;
    }
  });

  test("it is allow-listed once, next to the queue-worker switch it goes with", () => {
    expect(
      SUPPORT_CONFIG_ALLOW_LIST.filter((entry: string): boolean => {
        return entry === KEY;
      }),
    ).toHaveLength(1);
    expect(SUPPORT_CONFIG_ALLOW_LIST.indexOf(KEY)).toBe(
      SUPPORT_CONFIG_ALLOW_LIST.indexOf("DISABLE_QUEUE_WORKERS") + 1,
    );
  });

  test("its name does not look like a credential, so the value is not dropped", () => {
    expect(SECRET_LOOKING_PATTERN.test(KEY)).toBe(false);
  });

  test("a worker's 'false' reaches the bundle", () => {
    process.env[KEY] = "false";

    expect(getRedactedConfig()[KEY]).toBe("false");
  });

  test("unset (every process records) is simply absent", () => {
    const config: JSONObject = getRedactedConfig();

    expect(KEY in config).toBe(false);
  });
});
