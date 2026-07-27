// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import URL from "Common/Types/API/URL";
import { RequestOptions } from "Common/Utils/API";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";

/*
 * Every control-plane request the probe sends (alive heartbeat, list
 * fetches, result ingest, registration) is assembled here. The options are
 * what fixed the customer's Disconnected-probe incident: axios's default
 * timeout is 0 — infinite — so before getDefaultRequestOptions existed, a
 * server that accepted the TCP connection but never answered wedged the
 * request forever while cron ticks piled new ones on top. These tests pin
 * the deadline, its env override, and the exact clamp semantics.
 */

const aliveUrl: URL = URL.fromString(
  "https://oneuptime.example.com/probe-ingest/alive",
);

describe("getDefaultRequestBody", () => {
  test("authenticates as this probe: probeKey and probeId from the environment", () => {
    expect(ProbeAPIRequest.getDefaultRequestBody()).toEqual({
      probeKey: "test-probe-key",
      probeId: "11111111-2222-3333-4444-555555555555",
    });
  });
});

describe("getDefaultRequestOptions", () => {
  test("carries the 45s default deadline", () => {
    const options: RequestOptions =
      ProbeAPIRequest.getDefaultRequestOptions(aliveUrl);

    expect(options.timeout).toBe(45000);
  });

  test("with no proxy configured, no agent keys leak into the options", () => {
    const options: RequestOptions =
      ProbeAPIRequest.getDefaultRequestOptions(aliveUrl);

    /*
     * ProxyConfig.getRequestProxyAgents returns {} when no proxy is
     * configured, so the request rides axios's default agents. Pinned as
     * exact shape: an accidental httpAgent/httpsAgent key here would apply
     * to every control-plane request the probe makes.
     */
    expect(options).toEqual({ timeout: 45000 });
    expect("httpAgent" in options).toBe(false);
    expect("httpsAgent" in options).toBe(false);
  });
});

describe("PROBE_API_REQUEST_TIMEOUT_IN_MS — env override and clamp semantics", () => {
  /*
   * Config.ts reads the env var at import time, so each scenario re-requires
   * a fresh Config inside jest.isolateModules. The synchronous require is
   * deliberate: a static import would be hoisted and bound to the module
   * this file already loaded.
   */
  function loadConfiguredTimeout(envValue: string | undefined): number {
    if (envValue === undefined) {
      delete process.env["PROBE_API_REQUEST_TIMEOUT_IN_MS"];
    } else {
      process.env["PROBE_API_REQUEST_TIMEOUT_IN_MS"] = envValue;
    }

    let timeout: number = 0;

    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const config: { PROBE_API_REQUEST_TIMEOUT_IN_MS: number } =
        require("../../Config") as { PROBE_API_REQUEST_TIMEOUT_IN_MS: number };
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      timeout = config.PROBE_API_REQUEST_TIMEOUT_IN_MS;
    });

    return timeout;
  }

  afterEach(() => {
    delete process.env["PROBE_API_REQUEST_TIMEOUT_IN_MS"];
  });

  test("unset: defaults to 45000", () => {
    expect(loadConfiguredTimeout(undefined)).toBe(45000);
  });

  test("a valid override is honored", () => {
    expect(loadConfiguredTimeout("60000")).toBe(60000);
  });

  test("the 1000ms minimum itself is accepted", () => {
    expect(loadConfiguredTimeout("1000")).toBe(1000);
  });

  test("a sub-minimum value falls back to the 45000 default, not the minimum", () => {
    /*
     * NumberUtil.parseNumberWithDefault REJECTS below-min values back to the
     * default — it does not floor them to min. So "500" yields 45000, not
     * 1000: a nonsense deadline is treated the same as no configuration at
     * all rather than silently becoming the most aggressive legal one.
     */
    expect(loadConfiguredTimeout("500")).toBe(45000);
  });

  test("a non-numeric value falls back to the 45000 default", () => {
    expect(loadConfiguredTimeout("not-a-number")).toBe(45000);
  });
});
