// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { RequestOptions } from "Common/Utils/API";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import ProbeKeyHeaders from "Common/Types/Probe/ProbeKeyHeaders";
import ProbeReportOpening from "Common/Server/Utils/Probe/ProbeReportOpening";
import http from "http";

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
      /*
       * The capability list rides every request: the server hands
       * credential-less (ping-only) network devices only to probes that
       * declare "networkDevicePing", because an older probe would walk
       * such a device with community "public" and report it Down. A walk
       * from a probe that declares "snmpTables" and carries no
       * tableResults was handed no tables; from one that does not, the
       * server says the probe has to be updated to walk them. Only a probe
       * that declares "snmpWalk" is handed SNMP walks, and the device's
       * credentials with them; only one that declares "dataSecurityScan"
       * is handed databases to scan for Data Security. One that declares
       * "retryWhenBusy" is answered 429 by a busy scheduling endpoint,
       * rather than an empty batch, and one that declares
       * "retryAllWorkWhenBusy" by every other busy work endpoint too.
       */
      probeCapabilities: [
        "networkDevicePing",
        "snmpTables",
        "snmpWalk",
        "dataSecurityScan",
        "dataObservabilityCollect",
        "retryWhenBusy",
        "retryAllWorkWhenBusy",
        /*
         * Only a probe that declares "totpCodes" is handed a step that
         * needs a one-time code; an older custom probe's step fails with a
         * sentence saying to update it (#9759).
         */
        "totpCodes",
        /*
         * Only a probe that declares "anyRequestBody" is handed an API step
         * whose body is a JSON array, a single value or text; an older
         * custom probe's step fails with a sentence saying to update it
         * (#10737).
         */
        "anyRequestBody",
      ],
      /*
       * The release this probe runs, from APP_VERSION: kept with its
       * liveness stamp, so its page and the monitor forms can say when it
       * is too old for something (#9759). "unknown" for a build without
       * one, as this test's is.
       */
      probeVersion: "unknown",
    });
  });

  test("says the release baked into the image", () => {
    jest.isolateModules(() => {
      const previous: string | undefined = process.env["APP_VERSION"];
      process.env["APP_VERSION"] = "17.0.1";

      try {
        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const fresh: typeof import("../../Utils/ProbeAPIRequest") = require("../../Utils/ProbeAPIRequest");
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

        expect(fresh.default.getDefaultRequestBody()["probeVersion"]).toBe(
          "17.0.1",
        );
        expect(fresh.getProbeBuildDeclaration()).toEqual({
          probeCapabilities: fresh.PROBE_CAPABILITIES,
          probeVersion: "17.0.1",
        });
      } finally {
        if (previous === undefined) {
          delete process.env["APP_VERSION"];
        } else {
          process.env["APP_VERSION"] = previous;
        }
      }
    });
  });

  test("declares one-time codes, so the server hands this probe steps that need them", () => {
    expect(
      ProbeAPIRequest.getDefaultRequestBody()["probeCapabilities"],
    ).toContain(ProbeCapability.TotpCodes);
  });

  test("declares any request body, so the server hands this probe an array, a single value or a text body", () => {
    expect(
      ProbeAPIRequest.getDefaultRequestBody()["probeCapabilities"],
    ).toContain(ProbeCapability.AnyRequestBody);
  });

  /*
   * #10222: OneUptime reads the key and id off the start of a collection
   * from a probe that does not send them in headers too, before it parses
   * the rest (ProbeReportOpening). Every release writes them first.
   */
  test("opens with the key, then the id, so a server can read them before the rest", () => {
    const body: JSONObject = ProbeAPIRequest.getDefaultRequestBody();

    expect(Object.keys(body).slice(0, 2)).toEqual(["probeKey", "probeId"]);
    expect(
      ProbeReportOpening.read(
        Buffer.from(JSON.stringify({ ...body, status: "Succeeded" })),
      ),
    ).toEqual({
      probeId: "11111111-2222-3333-4444-555555555555",
      probeKey: "test-probe-key",
    });
  });
});

/*
 * A vCenter's or an OpenStack cloud's collection carries the probe's id and
 * key in headers as well (#10222), so OneUptime checks the key before it
 * reads a byte of the report.
 */
describe("getProbeKeyHeaders", () => {
  test("names this probe: its id and key from the environment", () => {
    expect(ProbeAPIRequest.getProbeKeyHeaders()).toEqual({
      "x-oneuptime-probe-id": "11111111-2222-3333-4444-555555555555",
      "x-oneuptime-probe-key": "test-probe-key",
    });
  });

  test("carries a key an operator typed, whatever its characters, as a value HTTP can send", () => {
    const typed: string = " pr0be (key)! clé 東京 🚀 ";

    jest.isolateModules(() => {
      const previous: string | undefined = process.env["PROBE_KEY"];
      process.env["PROBE_KEY"] = typed;

      try {
        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const fresh: typeof import("../../Utils/ProbeAPIRequest") = require("../../Utils/ProbeAPIRequest");
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

        const headers: Dictionary<string> = fresh.default.getProbeKeyHeaders();

        for (const [name, value] of Object.entries(headers)) {
          expect(() => {
            http.validateHeaderValue(name, value);
          }).not.toThrow();
        }

        expect(ProbeKeyHeaders.read(headers)).toEqual({
          probeId: "11111111-2222-3333-4444-555555555555",
          probeKey: typed,
        });
      } finally {
        process.env["PROBE_KEY"] = previous;
      }
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
    expect(Object.keys(options).sort()).toEqual([
      "onRequestComplete",
      "sameServerRedirectsOnly",
      "timeout",
    ]);
    expect("httpAgent" in options).toBe(false);
    expect("httpsAgent" in options).toBe(false);
  });

  test("keeps every request's redirects on the server it was sent to: each one carries the probe's key", () => {
    /*
     * An HTTP client hands a redirected request's headers, and a 307 or
     * 308's body, to wherever the redirect points; the probe's key and the
     * key that registers a global probe ride in that body.
     */
    for (const options of [
      ProbeAPIRequest.getDefaultRequestOptions(aliveUrl),
      ProbeAPIRequest.getDefaultRequestOptions(aliveUrl, { timeout: 30000 }),
    ]) {
      expect(options.sameServerRedirectsOnly).toBe(true);
      expect(options.doNotFollowRedirects).toBeUndefined();
    }
  });

  test("a caller's own deadline wins over the 45s default", () => {
    /*
     * The syslog / NetFlow / SNMP-trap forwarders flush on a much shorter
     * deadline than the control-plane default, and they still have to get
     * the diagnostics observer.
     */
    const options: RequestOptions = ProbeAPIRequest.getDefaultRequestOptions(
      aliveUrl,
      { timeout: 30000 },
    );

    expect(options.timeout).toBe(30000);
    expect(typeof options.onRequestComplete).toBe("function");
  });

  test("every request carries the diagnostics observer", () => {
    /*
     * This hook is the only reason a failed control-plane request can say
     * WHERE it stalled. It is attached here, once, rather than at each of
     * the probe's call sites — so losing it here silently reverts every
     * route to the bare "timeout of 45000ms exceeded" that told support
     * nothing.
     */
    const options: RequestOptions =
      ProbeAPIRequest.getDefaultRequestOptions(aliveUrl);

    expect(typeof options.onRequestComplete).toBe("function");
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
